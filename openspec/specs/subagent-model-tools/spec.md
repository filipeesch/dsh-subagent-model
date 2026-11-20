# subagent-model-tools Specification

## Purpose
Lets one agent delegate a task to a subagent running on a caller-chosen provider and model,
optionally seeding the child with the caller's conversation, with a discovery tool that
enumerates every route the host offers.

## Requirements

### Requirement: Structured route catalog

The plugin SHALL register a model-facing tool named `list_subagent_routes` that enumerates the LLM
routes available for delegation. The call MUST accept an optional `provider` filter and MUST NOT
accept any other argument. Every call MUST return the same structured object shape,
`{ providers: [...] }`, where each entry carries `provider` and a `models` list, and each model
carries `id`, its advertised `efforts` ids, and `defaultEffort` when the provider declares one. The
response MUST identify providers, models, and efforts by id alone: it MUST NOT include display
names or descriptions. Catalog results MUST reflect every route the host advertises, independent of
any Session route authorization policy.

#### Scenario: Providers and models listed without arguments

- **WHEN** the model calls `list_subagent_routes` with no arguments
- **THEN** the result is a structured object whose `providers` list names every registered provider
- **AND** each provider entry lists that provider's advertised models

#### Scenario: Filtered response keeps the same shape

- **WHEN** the model calls `list_subagent_routes` with a registered `provider`
- **THEN** the result uses the same `{ providers: [...] }` shape and contains only that provider
- **AND** it lists every model the provider advertises
- **AND** the result includes routes that the Session route policy does not authorize

#### Scenario: Reasoning efforts reported per model

- **WHEN** the model reads a provider whose models advertise reasoning efforts
- **THEN** each model entry lists its advertised effort ids
- **AND** the provider-declared default effort is reported separately from the effort list

#### Scenario: Model without reasoning efforts

- **WHEN** an advertised model exposes no reasoning efforts
- **THEN** its catalog entry omits the effort list rather than failing the call
- **AND** the remaining models in the same response are still reported

#### Scenario: Model metadata unreadable

- **WHEN** the provider advertises a model whose effort metadata cannot be read
- **THEN** the call still succeeds for the rest of the catalog
- **AND** the unreadable model is reported without that metadata

#### Scenario: Result carries identifiers only

- **WHEN** the model reads any catalog result
- **THEN** providers, models, and efforts appear only as ids
- **AND** no display name, description, or concatenated provider/model route appears

#### Scenario: Removed single-model argument rejected

- **WHEN** the model calls `list_subagent_routes` with `model`
- **THEN** the call fails because the argument is not declared

#### Scenario: Unknown provider reported with the available set

- **WHEN** the model calls `list_subagent_routes` with a provider that is not registered
- **THEN** the call fails with an error naming the requested provider and the registered ones
### Requirement: Explicit-route delegation

The plugin SHALL register a model-facing tool named `subagent_model` that delegates a task to a
subagent, optionally on an explicitly selected model. The call MUST require `description` and
`prompt`; `model` is optional and, when omitted, the child MUST run on the calling agent's
current provider, model, and reasoning effort. `provider` and `reasoning_effort` MUST only be
accepted together with `model`. A supplied `model` MUST be validated against the models the
provider advertises before any child starts, except when the provider advertises no models at
all; an omitted `model` MUST NOT be validated against a catalog. The call MUST accept an optional
`inherit_context` boolean; when `true` the child's conversation inherits the calling agent's
completed turns, and when `false` or omitted the child starts with a fresh context. The call MUST
accept an optional `name`, forwarded to the host, which validates it against its own naming rules
before the child starts; omitting `name` MUST let the host assign its default child name. A
successful call MUST report the child's id together with the name the host recorded for that child
and the reasoning effort this call resolved and forwarded. For a child this host creates, that MUST
be the effort it runs with. For a backend that executes the child outside this host, the report
MUST NOT be presented as an observed external request: such a provider owns execution and may apply
its own defaults.

#### Scenario: Delegation accepted and child identity returned

- **WHEN** the model calls `subagent_model` with a valid description, prompt, and model
- **THEN** the call returns a canonical value of kind `activation` with the child's id, the child's
  name, and the effective reasoning effort
- **AND** the child's answer is delivered to the parent as a completion notice rather than as the
  tool result

#### Scenario: Named child reported under its addressable name

- **WHEN** the model calls `subagent_model` with a `name` the host accepts
- **THEN** the host records that name for the child
- **AND** the call reports the child's addressable name as the host recorded it, which is the
  requested segment for a root caller and the slash-separated path (or the session id when an
  ancestor is unnamed) for a nested caller

#### Scenario: Unnamed child reports the host-assigned name

- **WHEN** the model calls `subagent_model` without `name`
- **THEN** the host assigns its default child name
- **AND** the call reports the assigned name rather than an empty value

#### Scenario: Invalid child name rejected

- **WHEN** the model calls `subagent_model` with a `name` the host does not accept
- **THEN** the call fails before the child accepts work
- **AND** the error identifies the rejected name

#### Scenario: Model omitted delegates on the calling agent's route

- **WHEN** the model calls `subagent_model` with `description` and `prompt` and no `model`
- **THEN** the child runs on the provider and model the calling agent is currently using
- **AND** a route selected mid-Session takes precedence over the route the agent was created with
- **AND** this holds for both fresh and inheriting context

#### Scenario: Provider omitted uses the calling agent's route

- **WHEN** the model calls `subagent_model` with a `model` and no `provider`
- **THEN** the child runs on the provider the calling agent is currently using
- **AND** a route selected mid-Session takes precedence over the route the agent was created with

#### Scenario: Reasoning effort without a model is rejected

- **WHEN** the model calls `subagent_model` with `reasoning_effort` and no `model`
- **THEN** the call fails before a child starts
- **AND** the error states that `reasoning_effort` requires `model`

#### Scenario: Model the provider does not advertise is rejected

- **WHEN** the model calls `subagent_model` with a model id the provider does not advertise
- **THEN** the call fails before a child starts
- **AND** the error identifies the `model` field and directs the caller to the catalog tool
- **AND** the error does not repeat the rejected id

#### Scenario: Provider that advertises no models is not validated

- **WHEN** the model calls `subagent_model` with a `model` for a provider that advertises no
  models
- **THEN** the catalog check does not reject the call
- **AND** the route is resolved by the provider itself

#### Scenario: Provider without model is rejected

- **WHEN** the model calls `subagent_model` with `provider` but no `model`
- **THEN** the call fails with an error stating that `provider` and `model` must be supplied
  together

#### Scenario: Missing calling agent is rejected

- **WHEN** `subagent_model` executes outside an agent context
- **THEN** the call fails with an error stating that a calling agent is required

#### Scenario: Default delegation starts with fresh context

- **WHEN** the model calls `subagent_model` without `inherit_context`
- **THEN** the child starts on a backend that does not inherit the calling conversation
- **AND** it does not receive the calling agent's turns

#### Scenario: Non-boolean inherit_context rejected

- **WHEN** the model calls `subagent_model` with `inherit_context` set to a value that is not a
  boolean
- **THEN** the call fails before a child starts
- **AND** the error names `inherit_context` and its boolean requirement
### Requirement: Context inheritance from the calling agent

The plugin SHALL let `subagent_model` seed a child's conversation with the immediate calling
agent's completed turns. When `inherit_context` is `true`, the child MUST start on a backend that
declares that it inherits the parent conversation, and the inherited content MUST end at the
calling agent's last completed turn, excluding the in-flight turn that contains the tool call. The
seed MUST be captured when the child is created; later turns in the calling conversation MUST NOT
be added. Before the calling agent has completed a turn, the child MUST start without inherited
turns.

#### Scenario: Forked child inherits completed turns

- **WHEN** the calling agent has completed at least one turn
- **AND** the model calls `subagent_model` with `inherit_context: true`
- **THEN** the child starts on a backend that inherits the parent conversation
- **AND** the child's conversation contains the calling agent's turns up to and including the last completed turn
- **AND** the in-flight turn that contains this tool call is not included

#### Scenario: Nested delegation inherits from the immediate caller

- **WHEN** an agent that is already a subagent calls `subagent_model` with `inherit_context: true`
- **THEN** the child inherits that calling agent's completed turns
- **AND** it does not inherit the root conversation's turns instead

#### Scenario: No completed turn yields a fresh child

- **WHEN** the calling agent has not completed a turn
- **AND** the model calls `subagent_model` with `inherit_context: true`
- **THEN** the child starts without inherited turns

#### Scenario: Route selection applies to the forked child

- **WHEN** the model calls `subagent_model` with `inherit_context: true` and an explicit provider, model, and effort
- **THEN** the child runs on that selected route
- **AND** the route is validated before the child starts

#### Scenario: Inherited conversation reaches the selected provider

- **WHEN** the model calls `subagent_model` with `inherit_context: true`
- **THEN** the selected provider receives the calling agent's completed turns
- **AND** the tool's model-facing description states that inherited turns are sent to the selected provider
- **AND** the description states that changing the route can prevent provider-side reuse of the inherited prefix

### Requirement: Context-mode backend contract

The plugin SHALL resolve the backend for the requested context mode at call time and MUST fail
loud before starting a child when the resolved backend does not satisfy that mode's contract,
including when the backend is replaced after the initial resolution. A fresh-context backend MUST
declare that it does not inherit the parent conversation; an inheriting backend MUST declare that
it does. Both MUST accept the child `agentOptions` the plugin always supplies. The backend names
for the two modes MUST be configurable, defaulting to `spawn` for fresh context and `fork` for
inheritance, so a composition that renames its providers still works; a configured name with no
registered provider MUST fail loud and name the requested value, the context mode, and the
configuration key that selects it. The
`inherit_context` parameter MUST remain part of the tool schema whether or not an inheriting
backend is registered; availability MUST be enforced at call time, not by removing the parameter.
Errors MUST name `inherit_context`, the backend the plugin tried to use, and the unmet contract.

#### Scenario: Missing inheritance backend rejected

- **WHEN** the composition has no backend that satisfies the inheritance contract
- **AND** the model calls `subagent_model` with `inherit_context: true`
- **THEN** the call fails before a child starts
- **AND** the error names `inherit_context` and the missing backend
- **AND** the tool schema still exposes `inherit_context`

#### Scenario: Backend that does not inherit context rejected

- **WHEN** the backend reserved for inheritance is registered but does not declare that it
  inherits the parent conversation
- **THEN** the call fails before a child starts
- **AND** the error states that the backend does not satisfy the inheritance contract

#### Scenario: Fresh backend that inherits context rejected

- **WHEN** the backend reserved for fresh delegation declares that it inherits the parent
  conversation
- **THEN** the call fails before a child starts
- **AND** the error states that the backend does not satisfy the fresh-context contract

#### Scenario: Backend without child agent options rejected

- **WHEN** the backend for the requested context mode does not accept child `agentOptions`
- **THEN** the call fails before a child starts
- **AND** the error names `inherit_context`, the backend, and the missing capability

#### Scenario: Backend replaced after the initial contract check

- **WHEN** the requested backend contract is validated
- **AND** the same backend name is replaced with a provider that does not satisfy the mode's
  contract before the child starts
- **THEN** the call fails before a child starts
- **AND** the error states that the backend does not satisfy the contract

#### Scenario: Configured backend name is honored

- **WHEN** the plugin is configured with a backend name other than the default for a context mode
- **AND** a provider with that name is registered and satisfies the mode's contract
- **THEN** the delegation starts on that provider

#### Scenario: Configured backend name with no provider rejected

- **WHEN** the plugin is configured with a backend name that no provider registers
- **THEN** the call fails before a child starts
- **AND** the error names the requested backend, the context mode, and the configuration key that
  selects it

### Requirement: Reasoning effort fallback and working directory selection

The plugin SHALL accept an optional `reasoning_effort` and an optional `cwd` on
`subagent_model`. A supplied effort the selected model advertises MUST be resolved and forwarded to
the child. A supplied effort the model does not advertise MUST NOT fail the call: the plugin MUST
resolve the model's own default effort instead, when the adapter declares one, and the result MUST
report the effort resolved and forwarded so the substitution is observable. For a child this host
creates, that reported effort MUST be the effort it runs with; for a backend that executes the
child elsewhere the plugin forwards the route and does not observe the child request. When no
effort is resolved for a supplied model, the route MUST carry no effort rather than inherit the
calling agent's, and the result MUST omit the effort: carrying the caller effort over would apply
an effort this call never validated. A calling agent route inherited by omitting `model` MUST keep
its effort. A supplied working directory MUST become the child's initial directory.

#### Scenario: Valid reasoning effort forwarded

- **WHEN** the model calls `subagent_model` with an effort the selected model advertises
- **THEN** the route carries that effort
- **AND** the result reports that same effort
- **AND** for a child this host creates, it starts with that effort

#### Scenario: Effort the model does not advertise falls back to the default

- **WHEN** the model calls `subagent_model` with an effort the selected model does not advertise
- **THEN** the route carries the effort the model defaults to, when the adapter declares one
- **AND** the call does not fail
- **AND** the result reports the effort resolved and forwarded

#### Scenario: Omitted effort uses the model default

- **WHEN** the model calls `subagent_model` with a supplied `model` and without `reasoning_effort`
- **THEN** the route carries the model's default effort, when the adapter declares one
- **AND** the result reports the effort resolved and forwarded
- **AND** when that route resolves no effort, the result omits the field instead

#### Scenario: Route resolving no effort does not inherit the caller effort

- **WHEN** the model supplies a `model` whose route resolves no reasoning effort
- **AND** the calling agent is running with a reasoning effort
- **THEN** the route carries no effort
- **AND** the result omits the effort
- **AND** for a child this host creates, it starts with no effort rather than the caller's

#### Scenario: Seeded child runs the route the result reported

- **WHEN** the model delegates on a local backend with `inherit_context: true` on a model other
  than the caller own
- **AND** the calling agent already completed a turn, so the child inherits that history
- **THEN** the child runs on the reported provider, model, and reasoning effort
- **AND** it does not silently continue on the calling agent route

#### Scenario: External backend is left on the ordinary activation path

- **WHEN** the configured backend declares no `prepareContinuable`, so it runs the child externally
- **THEN** the delegation passes no reserved child identity
- **AND** the backend creation options carry the selected route

#### Scenario: Local seeded child is pinned before its first request

- **WHEN** the configured backend runs the child locally and the call inherits context
- **THEN** the reported route is applied to the child before its first request
- **AND** the child own request header matches the reported provider, model, and effort

#### Scenario: Local seeded child that cannot be pinned fails the call

- **WHEN** a local seeded child is created without taking its pinned route
- **THEN** the call fails instead of reporting a route the child does not run

#### Scenario: Inherited route keeps the caller effort

- **WHEN** the model calls `subagent_model` without `model`
- **THEN** the child runs on the calling agent's route and reasoning effort
- **AND** the result reports that effort

#### Scenario: Working directory applied

- **WHEN** the model calls `subagent_model` with `cwd`
- **THEN** the child starts in that directory
- **AND** omitting `cwd` inherits the caller's directory
### Requirement: Model choice is not filtered by Session authorization

Because the tool exists to route work to arbitrary models, explicit selection MUST NOT be
restricted to the Session's authorized model list, unlike the native delegation tool. The
catalog MUST describe routes outside that list, and delegation to them MUST succeed when the
provider resolves the model.

#### Scenario: Unauthorized route still delegates

- **WHEN** the Session's authorized route list does not contain the requested provider/model
- **AND** the provider resolves that model
- **THEN** the delegation starts without a policy rejection

### Requirement: Delegation depth follows the Host setting

The plugin SHALL NOT impose its own delegation depth cap. Every delegation MUST resolve the Host's
configured subagent depth limit through the subagent service and forward it with the request, so
recursion stays governed in one place.

#### Scenario: Host default depth applies

- **WHEN** the Host depth setting is smaller than a hard-coded plugin value would be
- **THEN** the delegation is evaluated against the Host setting
- **AND** no plugin-specific override changes the outcome

### Requirement: Tool surface and lifecycle

The plugin SHALL expose exactly two model-facing tools, `list_subagent_routes` and
`subagent_model`. It MUST NOT register `subagent`, `subagent_fork`, or `list_subagent_models`,
which belong to the native delegation tool, and it MUST NOT expose a background/foreground switch.
Instead of coexisting with those host tools, the plugin MUST suppress them from the model-facing
surface as described by the native delegation masking requirement. The parameter schema of each
tool MUST accept only the parameters it declares, so an undeclared argument fails the call instead
of being silently ignored. Both tools MUST be removed when the plugin unloads.

#### Scenario: Native discovery name not claimed

- **WHEN** the plugin loads next to a native `list_subagent_models` tool in the same tool scope
- **THEN** the plugin registers only `list_subagent_routes` and `subagent_model`
- **AND** it does not register `list_subagent_models` under any name of its own

#### Scenario: Native delegation tools suppressed

- **WHEN** the plugin has loaded in a composition that registers the native delegation tools
- **THEN** the model-facing tool surface contains neither those tools nor their catalog
- **AND** the plugin's two tools remain present

#### Scenario: No foreground switch

- **WHEN** the model inspects the `subagent_model` parameter schema
- **THEN** the schema contains no `run_in_background` parameter

#### Scenario: Undeclared argument rejected

- **WHEN** the model calls a plugin tool with an argument its schema does not declare
- **THEN** the call fails before any delegation or discovery work starts
- **AND** the failure names the undeclared argument

#### Scenario: Tools removed on unload

- **WHEN** the owning plugin context is disposed
- **THEN** both registered tools are gone from the tool registry

### Requirement: Runs on current DSH releases without resolving DSH packages

The plugin SHALL load and operate on DSH releases that provide the flattened activation task
options, declaring the range `>=0.2.2-rc.1 <0.3.0`, using only the injected context services and
without importing `@deepseek-ai` packages at runtime. The package manifest MUST declare that
supported range so installation refuses an older host, and the project documentation MUST state
that the flattening landed after the published `0.2.2-rc.1` tag, so a host reporting that exact
version is not assumed compatible.

#### Scenario: Loads with no DSH imports

- **WHEN** the plugin is installed into a profile as a linked bundle
- **THEN** it loads without resolving any `@deepseek-ai` package
- **AND** both tools register

#### Scenario: Child starts on the supported host

- **WHEN** a profile on a DSH release inside the declared range loads the plugin
- **AND** the model calls `subagent_model` with a valid description, prompt, and model
- **THEN** the child starts and its session is recorded under the calling agent
- **AND** the call reports the child's id and name instead of a runtime error about an absent value

#### Scenario: Incompatible host refused at install

- **WHEN** a profile installs the bundle on a DSH release outside the declared engine range
- **THEN** installation refuses the bundle before it is loaded

### Requirement: Native delegation surface is masked

While the plugin is loaded, it SHALL hide the host delegation tools that compete with its own
route-capable delegation from every agent: `subagent`, `subagent_fork`, `list_subagent_models`,
and `workflow`. Hiding MUST be applied to every agent the plugin can observe, including agents
created after it loaded and agents that are themselves subagents. A name that is not registered in
the composition MUST be ignored rather than treated as an error. The mask MUST be released when
the affected agent is disposed and when the plugin unloads, so removing the plugin restores the
host tools without leaving the harness altered. When a name is registered but cannot be hidden, the
plugin MUST report the composition it detected instead of claiming a sanitized surface.

#### Scenario: Mask applied to an already running agent

- **WHEN** the plugin loads in a composition where the native delegation tools are registered
- **AND** an agent already exists
- **THEN** those tools are absent from that agent's model-facing surface
- **AND** the plugin's own tools remain visible

#### Scenario: Mask applied to a newly created agent

- **WHEN** an agent is created after the plugin loaded
- **THEN** the native delegation tools are absent from that agent's model-facing surface

#### Scenario: Subagents are masked too

- **WHEN** the plugin delegates a child
- **THEN** the child cannot see the native delegation tools
- **AND** it sees the plugin's delegation tools

#### Scenario: Absent native tool is not an error

- **WHEN** the composition registers none of the masked names
- **THEN** the plugin loads normally
- **AND** it reports no masking failure

#### Scenario: Mask released when the agent is disposed

- **WHEN** a masked agent is disposed
- **THEN** the restriction applied for that agent is released

#### Scenario: Mask released when the plugin unloads

- **WHEN** the plugin context is disposed
- **THEN** every restriction it applied is released
- **AND** the host delegation tools become visible again to agents created afterwards

#### Scenario: Unhideable name is reported

- **WHEN** a masked name is registered in a scope the plugin cannot restrict
- **THEN** the plugin reports the detected composition
- **AND** it does not claim that the native tool is hidden

### Requirement: Masked delegation calls are refused with a replacement hint

The plugin SHALL deny execution of a masked delegation tool even when the call reaches dispatch,
covering an agent-local registration or an explicit override that bypasses the visibility mask. A
denial MUST be an error result, never a silent success or a silent drop, and its message MUST name
the replacement: `subagent_model` for delegation and `list_subagent_routes` for route discovery.

#### Scenario: Bypassed mask still refuses execution

- **WHEN** a call to a masked delegation tool reaches execution for an agent the plugin masks
- **THEN** the call fails with an error result
- **AND** the error names `subagent_model` as the replacement

#### Scenario: Refusal covers the masked catalog

- **WHEN** a call to the masked native catalog reaches execution
- **THEN** the call fails with an error result
- **AND** the error names `list_subagent_routes` as the replacement

#### Scenario: Unmasked names still execute

- **WHEN** a call targets a tool the plugin does not mask
- **THEN** the call is not affected by the plugin's denial

### Requirement: Adaptive delegation guidance

The plugin SHALL contribute model-facing guidance that states which delegation tool can select a
route outside the Session's model-selection policy, and how to recover when a delegation is
refused. The guidance MUST also state that delegating to a different model requires
`subagent_model` and that route discovery for it uses `list_subagent_routes`. The guidance MUST
adapt to the composition the plugin detected: it MUST state that a host delegation tool is
unavailable only when the plugin actually masked that name, and it MUST state which names it could
not hide. The guidance MUST be registered when the plugin loads and removed when it unloads.

#### Scenario: Guidance names the route-capable tool

- **WHEN** the plugin is loaded and its guidance section is rendered
- **THEN** the rendered text states that `subagent_model` is the way to delegate to another model
- **AND** it states that `list_subagent_routes` reports the routes that tool accepts

#### Scenario: Guidance describes the recovery path

- **WHEN** the guidance section is rendered
- **THEN** it states that a refused explicit route is retried with `subagent_model`
- **AND** it does not present the Session policy as the only outcome

#### Scenario: Guidance adapts to a sanitized composition

- **WHEN** the plugin masked the host delegation tools
- **THEN** the guidance states that those tools are unavailable
- **AND** it presents the plugin's tools as the delegation surface

#### Scenario: Guidance adapts when masking did not apply

- **WHEN** a host delegation tool remains visible because the plugin could not hide it
- **THEN** the guidance does not claim that the tool is unavailable
- **AND** it states that the sandboxed surface is not guaranteed

#### Scenario: Guidance removed on unload

- **WHEN** the plugin context is disposed
- **THEN** its guidance section is gone from the rendered prompt

### Requirement: Delegation depth guidance

The plugin SHALL tell the model when delegation is no longer possible because the Host's depth
limit is reached, so it does not attempt a delegation that must fail. The notice MUST report the
current depth, the maximum, and the remaining levels, and it MUST appear in the rendered prompt
only when the remaining levels are zero.

#### Scenario: Depth notice at the limit

- **WHEN** the calling agent's delegation depth equals the Host's configured maximum
- **THEN** the rendered prompt states the current depth, the maximum, and that no levels remain
- **AND** it instructs the agent not to delegate

#### Scenario: No notice below the limit

- **WHEN** the calling agent's delegation depth is below the Host's configured maximum
- **THEN** no depth notice is rendered

#### Scenario: No notice when the limit is provider-managed

- **WHEN** the Host reports no numeric depth limit
- **THEN** no depth notice is rendered
