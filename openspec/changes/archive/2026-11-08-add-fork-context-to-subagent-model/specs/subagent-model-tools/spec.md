# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
