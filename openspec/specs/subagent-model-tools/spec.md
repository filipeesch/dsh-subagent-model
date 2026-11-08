# subagent-model-tools Specification

## Purpose
Lets one agent delegate a task to a subagent running on a caller-chosen provider and model,
optionally seeding the child with the caller's conversation, with a discovery tool that
enumerates every route the host offers.

## Requirements

### Requirement: Route catalog tool

The plugin SHALL register a model-facing tool named `list_subagent_routes` that enumerates the
LLM routes available for delegation: with no arguments it lists registered providers; with
`provider` it lists that provider's advertised models; with `provider` and `model` it reports
that model and its reasoning efforts. Catalog results MUST reflect every route the host
advertises, independent of any Session route authorization policy.

#### Scenario: Providers listed without arguments

- **WHEN** the model calls `list_subagent_routes` with no arguments
- **THEN** the result names each registered provider and its display name
- **AND** no model ids are included

#### Scenario: Models listed for one provider

- **WHEN** the model calls `list_subagent_routes` with a registered `provider`
- **THEN** the result lists every model the provider advertises for that provider
- **AND** the result includes routes that the Session route policy does not authorize

#### Scenario: Reasoning efforts reported for one model

- **WHEN** the model calls `list_subagent_routes` with `provider` and `model`
- **THEN** the result names the model and lists each advertised reasoning effort
- **AND** the default effort is marked

#### Scenario: Malformed catalog request rejected

- **WHEN** the model calls `list_subagent_routes` with `model` but no `provider`
- **THEN** the call fails with an error stating that `model` requires `provider`

#### Scenario: Unknown provider reported with the available set

- **WHEN** the model calls `list_subagent_routes` with a provider that is not registered
- **THEN** the call fails with an error naming the requested provider and the registered ones

### Requirement: Explicit-route delegation

The plugin SHALL register a model-facing tool named `subagent_model` that delegates a task to a
subagent on an explicitly selected model. The call MUST require `description`, `prompt`, and
`model`; `provider` is optional and defaults to the calling agent's effective route. When
supplied, `provider` and `model` MUST be given together and the selected route MUST resolve on a
live provider before any child starts. The call MUST accept an optional `inherit_context` boolean;
when `true` the child's conversation inherits the calling agent's completed turns, and when
`false` or omitted the child starts with a fresh context.

#### Scenario: Delegation accepted and child identity returned

- **WHEN** the model calls `subagent_model` with a valid description, prompt, model, and provider
- **THEN** the call returns a canonical value of kind `activation` with the child's id
- **AND** the child's answer is delivered to the parent as a completion notice rather than as
  the tool result

#### Scenario: Provider omitted uses the calling agent's route

- **WHEN** the model calls `subagent_model` without `provider`
- **THEN** the child runs on the provider the calling agent is currently using
- **AND** a route selected mid-Session takes precedence over the route the agent was created with

#### Scenario: Model the provider does not advertise is rejected

- **WHEN** the model calls `subagent_model` with a model id the provider cannot resolve
- **THEN** the call fails before a child starts
- **AND** the error names the requested model and provider

#### Scenario: Provider without model is rejected

- **WHEN** the model calls `subagent_model` with `provider` but no `model`
- **THEN** the call fails with an error stating that `provider` and `model` must be supplied together

#### Scenario: Missing calling agent is rejected

- **WHEN** `subagent_model` executes outside an agent context
- **THEN** the call fails with an error stating that a calling agent is required

#### Scenario: Default delegation starts with fresh context

- **WHEN** the model calls `subagent_model` without `inherit_context`
- **THEN** the child starts on a backend that does not inherit the calling conversation
- **AND** it does not receive the calling agent's turns

#### Scenario: Non-boolean inherit_context rejected

- **WHEN** the model calls `subagent_model` with `inherit_context` set to a value that is not a boolean
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
it does. Both MUST accept the child `agentOptions` the plugin always supplies. The
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

- **WHEN** the backend reserved for inheritance is registered but does not declare that it inherits the parent conversation
- **THEN** the call fails before a child starts
- **AND** the error states that the backend does not satisfy the inheritance contract

#### Scenario: Fresh backend that inherits context rejected

- **WHEN** the backend reserved for fresh delegation declares that it inherits the parent conversation
- **THEN** the call fails before a child starts
- **AND** the error states that the backend does not satisfy the fresh-context contract

#### Scenario: Backend without child agent options rejected

- **WHEN** the backend for the requested context mode does not accept child `agentOptions`
- **THEN** the call fails before a child starts
- **AND** the error names `inherit_context`, the backend, and the missing capability

#### Scenario: Backend replaced after the initial contract check

- **WHEN** the requested backend contract is validated
- **AND** the same backend name is replaced with a provider that does not satisfy the mode's contract before the child starts
- **THEN** the call fails before a child starts
- **AND** the error states that the backend does not satisfy the contract

### Requirement: Reasoning effort and working directory selection

The plugin SHALL accept an optional `reasoning_effort` and an optional `cwd` on
`subagent_model`. A supplied effort MUST be validated against the selected model before the
child starts, and a supplied working directory MUST become the child's initial directory.

#### Scenario: Valid reasoning effort forwarded

- **WHEN** the model calls `subagent_model` with an effort the selected model advertises
- **THEN** the child starts with that effort

#### Scenario: Effort the model does not advertise is rejected

- **WHEN** the model calls `subagent_model` with an effort the selected model does not advertise
- **THEN** the call fails before a child starts
- **AND** the error identifies the rejected effort

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
`subagent_model`. It MUST NOT register `list_subagent_models`, which is owned by the native
delegation tool, and it MUST NOT expose a background/foreground switch. Both tools MUST be
removed when the plugin unloads.

#### Scenario: Native discovery name not claimed

- **WHEN** the plugin loads next to a native `list_subagent_models` tool in the same tool scope
- **THEN** the plugin registers only `list_subagent_routes` and `subagent_model`
- **AND** the native catalog remains the one the model sees under its own name

#### Scenario: No foreground switch

- **WHEN** the model inspects the `subagent_model` parameter schema
- **THEN** the schema contains no `run_in_background` parameter

#### Scenario: Tools removed on unload

- **WHEN** the owning plugin context is disposed
- **THEN** both registered tools are gone from the tool registry

### Requirement: Runs on current DSH releases without resolving DSH packages

The plugin SHALL load and operate on DSH 0.2.1-alpha.2 and later using only the injected
context services, without importing `@deepseek-ai` packages at runtime. The package manifest
MUST declare the supported DSH release range so installation refuses incompatible hosts.

#### Scenario: Loads with no DSH imports

- **WHEN** the plugin is installed into a profile as a linked bundle
- **THEN** it loads without resolving any `@deepseek-ai` package
- **AND** both tools register

#### Scenario: Incompatible host refused at install

- **WHEN** a profile installs the bundle on a DSH release outside the declared engine range
- **THEN** installation refuses the bundle before it is loaded
