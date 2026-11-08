# Spec Delta

## MODIFIED Requirements

### Requirement: Explicit-route delegation

The plugin SHALL register a model-facing tool named `subagent_model` that delegates a task to a
subagent on an explicitly selected model. The call MUST require `description`, `prompt`, and
`model`; `provider` is optional and defaults to the calling agent's effective route. When
supplied, `provider` and `model` MUST be given together and the selected route MUST resolve on a
live provider before any child starts. The call MUST accept an optional `inherit_context` boolean;
when `true` the child's conversation inherits the calling agent's completed turns, and when
`false` or omitted the child starts with a fresh context. The call MUST accept an optional
`name`, forwarded to the host, which validates it against its own naming rules before the child
starts; omitting `name` MUST let the host assign its default child name. A successful call MUST
report the child's id together with the name the host recorded for that child.

#### Scenario: Delegation accepted and child identity returned

- **WHEN** the model calls `subagent_model` with a valid description, prompt, model, and provider
- **THEN** the call returns a canonical value of kind `activation` with the child's id and the
  child's name
- **AND** the child's answer is delivered to the parent as a completion notice rather than as
  the tool result

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

### Requirement: Tool surface and lifecycle

The plugin SHALL expose exactly two model-facing tools, `list_subagent_routes` and
`subagent_model`. It MUST NOT register `list_subagent_models`, which is owned by the native
delegation tool, and it MUST NOT expose a background/foreground switch. The parameter schema of
each tool MUST accept only the parameters it declares, so an undeclared argument fails the call
instead of being silently ignored. Both tools MUST be removed when the plugin unloads.

#### Scenario: Native discovery name not claimed

- **WHEN** the plugin loads next to a native `list_subagent_models` tool in the same tool scope
- **THEN** the plugin registers only `list_subagent_routes` and `subagent_model`
- **AND** the native catalog remains the one the model sees under its own name

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
