# Spec Delta

## REMOVED Requirements

### Requirement: Route catalog tool

**Reason**: The catalog now answers every call with one structured shape and no longer has a
single-model mode whose only purpose was reporting reasoning efforts. Its `model` argument is
removed, so the two scenarios that exercised that mode no longer describe any behavior.

**Migration**: Call `list_subagent_routes` with no arguments, or with `provider` to narrow the same
response. Read effort ids from each model's `efforts` field instead of resolving one model at a
time, and take model ids from that response rather than from a concatenated provider/model string.

### Requirement: Reasoning effort and working directory selection

**Reason**: An effort the selected model does not advertise no longer fails the call; the child
starts with the model default and the result reports the effort actually used. The removed scenario
asserted the opposite behavior.

**Migration**: Stop pre-validating an effort before delegating. Read the model's `efforts` from
`list_subagent_routes` and read the effective effort from the `subagent_model` result.

## ADDED Requirements

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

## MODIFIED Requirements

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
