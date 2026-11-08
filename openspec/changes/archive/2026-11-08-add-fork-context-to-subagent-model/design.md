# Design

## Context

See `proposal.md` - Why. The constraints that shape this approach:

- [lib/delegation.js](../../../lib/delegation.js) hardcodes a single `SUBAGENT_BACKEND = "spawn"`
  and always starts a fresh child. It already receives the LLM runtime and the subagent service
  through injected factories, and its tests assert the exact activation spec.
- The host registers two in-process subagent backends in the bundle composition: `spawn` (fresh)
  and `fork` (seeded with the parent's completed-turn prefix). `ctx.subagents` exposes
  `startActivation()` and `getProvider(name)`, but no provider listing.
- `SubagentProvider` describes inheritance with the boolean `inheritsParentContext` and advertises
  capability support through `capabilities`. The shipped fork provider declares
  `inheritsParentContext: true`, `agentOptions: true`, and `depthLimit: true`, implements
  `prepareContinuable`, and seeds the child with events up to the parent's last `turn/end`.
- The native `subagent_fork` tool leaves out model selection to preserve prefix reuse. The host
  documentation allows a custom fork tool to enable selection, provided the cache trade-off is
  explicit.
- The declared engine floor, DSH `0.2.1-alpha.2`, already provides the fork backend and these
  provider descriptors. The installed runtime (0.2.1-rc.5) and the reference checkout
  (0.2.2-rc.1) both confirm it, so `engines.dsh` does not change.
- The plugin keeps zero `@deepseek-ai` imports, registers plain JSON-Schema tools, and verifies
  through a unit lane plus one isolated loader smoke.

## Goals / Non-Goals

**Goals:**

- Add optional context inheritance without changing the default delegation behavior.
- Keep the model-facing surface at two tools and one new optional parameter.
- Resolve and validate the backend through injected data, not module-level state.
- Make the context source, data boundary, and cache trade-off explicit in the model-facing text.
- Keep `delegation.js` a wiring module and isolate the new decision in small units.
- Cover the new behavior with unit tests while leaving the loader smoke stable.

**Non-Goals:**

- Changing the native `subagent`, `subagent_fork`, or Session route-policy behavior.
- Restricting inheritance to the caller's route or enforcing Session authorization; the plugin
  exists to bypass that list, and the user accepted the data trade-off.
- Adding plugin configuration for provider names. The mode registry is injectable so a future
  configuration surface can supply alternatives without changing the tool contract.
- Changing the catalog, max depth, delivery mode, result shape, or follow-up messaging.
- Adding TypeScript, a build step, or runtime dependencies.

## Decisions

### Optional `inherit_context` boolean, default `false`

`subagent_model` gains `inherit_context: { type: "boolean" }`, not in `required`. Omitted or
`false` selects the fresh mode; `true` selects inheritance. When the field is present but not a
boolean, the tool rejects the call before any backend or route work.

- *Alternative: an enum `context: "fresh" | "fork"`.* More self-documenting and easier to extend
  with future modes, but it adds vocabulary the user did not ask for and changes the call shape
  more than needed now. A boolean matches the requested "load the context or not".
- *Alternative: a second tool `subagent_model_fork`.* Mirrors how the host registers one native
  tool per backend, but duplicates the schema, validation, and route logic, and grows the surface
  the model must choose from. A parameter keeps one contract and one implementation.
- *Alternative: a required boolean.* Forces every existing caller to change for a behavior that
  already works; rejected for backward compatibility.

### Fork from the immediate calling agent

The activation uses `exec.agent` as `request.parent`, which is what the fork backend seeds from.
Nested delegation therefore inherits the calling subagent's conversation, not the root's.

- *Alternative: fork the root agent via `ctx.subagents.rootOf(parent)`.* It would require passing a
  different agent as `parent`, changing child ownership and the effective delegation depth. The
  caller's depth check would be bypassed and the behavior would diverge from the native
  `subagent_fork`. Rejected.
- *Alternative: expose a "fork root" option.* Adds a second semantic and a second seed source for a
  use case the user did not request.

### Injected context-mode registry

A new `lib/context-modes.js` owns the mapping from the model-facing mode to the host backend and
the backend contract check:

```text
DEFAULT_CONTEXT_MODES = {
  fresh:   { provider: "spawn", inheritsParentContext: false },
  inherit: { provider: "fork",  inheritsParentContext: true  }
}
```

`createDelegationTool({ llm, subagents, contextModes })` receives the registry; `index.js` injects
the default. At call time the resolver:

1. Selects the mode (`fresh` unless `inherit_context === true`).
2. Looks the backend up with `subagents.getProvider(provider)` and fails loud when absent.
3. Requires the provider's `inheritsParentContext` to equal the mode's expectation.
4. Requires `provider.capabilities.agentOptions` because the plugin always supplies child route
   options.
5. Returns the backend name for the activation.

Depth capability stays enforced by `startActivation`, which already rejects a request carrying
`maxDepth` when the backend lacks `depthLimit`; duplicating that check would create a second source
of truth.

The resolver runs twice. The first pass fails fast before the route call when the backend is
missing or incompatible. The second pass runs after the awaited route resolution and immediately
before the start call, because the host looks the provider up again inside `startActivation`. No
`await` separates the second check from that lookup, so an HMR replacement cannot swap the mode's
contract between validation and activation.

- *Alternative: keep the hardcoded `spawn` constant and add a conditional `"fork"`.* The smallest
  diff, but it puts provider names, contract checks, and mode semantics back into `delegation.js`
  and cannot be exercised without a real host.
- *Alternative: discover a provider by capability.* `ctx.subagents` has no listing API, so this
  needs an event-maintained provider snapshot. That adds lifecycle state, HMR concerns, and an
  ambiguous choice when more than one backend inherits context. The registry keeps one explicit
  default per mode.
- *Alternative: let the model pass the backend name.* Leaks composition names into the model-facing
  contract, allows arbitrary backends, and bypasses the truthfulness check.

### Parameter always exposed, availability enforced per call

The tool definition is registered once, so `inherit_context` stays in the schema even when no fork
backend is mounted. A call with `true` then fails with an actionable error instead of hiding the
parameter.

- *Alternative: omit the parameter when the fork backend is absent.* The schema would depend on
  composition and load order, differ between profiles, and change under HMR. Rejected.
- *Alternative: register the tool only when both backends exist.* Hides the whole tool in
  compositions that only need model-selection, which is a regression.

### Pure activation-request builder and module split

`lib/activation.js` exports `buildActivationRequest({ args, parent, route, maxDepth })`, a pure
function returning the `request` object:

```text
{
  prompt: [{ type: "text", text: args.prompt }],
  parent,
  agentOptions: { provider, model, reasoningEffort? },
  maxDepth?, cwd?
}
```

`lib/delegation.js` keeps the tool definition and orchestration: field validation, managed
activation check, backend resolution, route resolution, request build, `startActivation`, and the
result. `index.js` only wires the catalog and delegation tools.

- *Alternative: keep everything in `execute`.* Adding backend selection and contract checks to an
  already mixed function makes the unit harder to reason about and to test independently.
- *Alternative: introduce a service class or a strategy object per mode.* Over-engineered for two
  modes; the registry plus a pure builder is enough structure.

### Wording and disclosure in the model-facing contract

The tool description explains both modes: default is a fresh child; `inherit_context: true` seeds
the child with this conversation's completed turns (not the in-flight turn), sends those turns to
the selected provider, and may lose prefix reuse when the route changes. The `prompt` description
stops claiming the child never sees the conversation, and the `inherit_context` description names
the source and the trade-off. The README carries the same points with more detail.

- *Alternative: README only.* The model would not know when it can build on prior turns or that
  the conversation reaches another provider.
- *Alternative: restrict inheritance to the caller's route.* Preserves cache and keeps data on one
  provider, but removes the feature's reason to exist: choosing a different model over a fork.
- *Alternative: enforce the Session route policy only for inheritance.* Duplicates native behavior,
  couples the plugin to a policy it deliberately ignores, and was rejected in the exploration.

### Verification and compatibility

- `tests/context-modes.test.js` covers mode selection, missing backend, mismatched
  `inheritsParentContext`, and missing `agentOptions`.
- `tests/delegation.test.js` covers the schema, default fresh call, exact fork activation spec,
  boolean validation, route validation, cancellation, and depth forwarding.
- `tests/helpers/fakes.js` models a provider registry with `spawn`/`fork` records instead of a
  single boolean flag.
- The isolated smoke stays catalog-only. Delegating a child would require scripted child turns and
  would make the loader lane slower and less deterministic; the unit lane owns the mode matrix.
- The package version becomes `0.3.0`; the DSH engine range and `files` list stay unchanged.

## Risks / Trade-offs

- [Inherited turns reach the selected provider] → The tool description and README state it
  explicitly. The plugin deliberately does not enforce Session authorization, so the model and the
  user retain the choice.
- [Changing the route can prevent provider-side prefix reuse] → Documented in the tool text and
  README; callers that want reuse can pass the caller's route. The plugin does not block route
  changes because model choice is its purpose.
- [The fork seed is a snapshot at child creation] → Documented; follow-up messages continue the
  child's own transcript, and later parent turns are not injected.
- [No completed turn produces a fresh child even with `inherit_context: true`] → This is the host's
  fork behavior; documented in the spec and README so callers are not surprised.
- [Backend names depend on the profile composition] → The registry is injected with documented
  defaults, and a missing or incompatible backend fails loud with the requested mode, backend name,
  and unmet contract. A future configuration surface can replace the defaults without touching the
  tool contract.
- [`inheritsParentContext` is descriptive] → The plugin uses it as a truthfulness check, while the
  host service still validates start-time capabilities. Unit tests pin the check and the shipped
  fork backend is the reference implementation.
- [The static description cannot vary per call] → The combined wording must be clear for both
  modes; unit tests assert the key disclosure sentences, and the parameter description carries the
  mode-specific detail.
- [Provider replacement between resolution and start] → The host looks the provider up again in
  `startActivation`, so the plugin re-validates the context-mode contract after the awaited route
  resolution and immediately before the start call. No `await` separates that re-check from the
  host lookup, and a replacement with the opposite `inheritsParentContext` fails before any child.

## Migration Plan

1. Merge the change and publish `0.3.0`; the bundle row in `cordis.patch.yml` is unchanged, so no
   profile edit is required.
2. Restart the host so the updated plugin registers the new parameter and wording.
3. Existing calls keep working unchanged; callers opt in by passing `inherit_context: true`.
4. Roll back by reverting the plugin version and restarting the host. The plugin owns no persisted
   state; fork children already created are host-managed sessions with their own descriptors.
