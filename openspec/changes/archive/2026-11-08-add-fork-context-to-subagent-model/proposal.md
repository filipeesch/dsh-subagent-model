# Proposal

## Why

`subagent_model` always starts a child with a fresh context, so a follow-up task that builds on
the current conversation must restate everything or lose the thread. The native `subagent_fork`
solves that but deliberately leaves out model selection to preserve provider-side prefix reuse.
Users need both: a forked child running on an explicitly chosen provider, model, and reasoning
effort.

## What Changes

- `subagent_model` gains an optional `inherit_context` boolean (default `false`). `false` keeps the
  current fresh child through the `spawn` backend; `true` selects the host's `fork` backend, which
  seeds the child with the calling agent's completed turns up to the last `turn/end` (the in-flight
  turn is excluded).
- The child is always forked from the immediate calling agent, matching the native
  `subagent_fork` contract; delegation depth, route validation, `cwd`, and parent delivery are
  unchanged.
- Backend selection moves out of the hardcoded `spawn` constant into an injected context-mode
  registry (`fresh -> spawn`, `inherit -> fork`). The registry fails loud when the backend is
  missing, does not declare the requested `inheritsParentContext` contract, or cannot accept the
  always-supplied child `agentOptions`.
- The tool description and parameter docs state that inheriting context sends the completed turns
  to the selected provider/model, and that changing the route may prevent provider-side reuse of
  the inherited prefix.
- The implementation is split into a context-mode registry and a pure activation-request builder,
  with the provider registry modeled in the test fakes. The package version becomes `0.3.0`; the
  declared DSH engine range and the isolated smoke stay unchanged.

Adding the optional parameter is backward compatible: calls without `inherit_context` keep the
current behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `subagent-model-tools`: explicit-route delegation gains optional context inheritance, backend
  contract validation, and model-facing wording that reflects whether the child is fresh or
  seeded with the calling conversation.

## Impact

- Code: [lib/delegation.js](../../../lib/delegation.js), [index.js](../../../index.js), and new
  context-mode and activation modules under `lib/`; [tests/helpers/fakes.js](../../../tests/helpers/fakes.js)
  and the delegation tests.
- Docs and metadata: [README.md](../../../README.md), [AGENTS.md](../../../AGENTS.md),
  [package.json](../../../package.json), and the `subagent-model-tools` spec delta.
- Host contract: no new dependencies or `@deepseek-ai` imports. The plugin uses the existing
  `ctx.subagents` provider registry and `SubagentProvider.inheritsParentContext` descriptor, both
  present in the declared minimum release.
- Behavior: default delegation is unchanged. With inheritance enabled, the calling conversation's
  completed turns reach the selected provider, and a route change can trade prefix reuse for model
  choice. The seed is captured once at child creation.
