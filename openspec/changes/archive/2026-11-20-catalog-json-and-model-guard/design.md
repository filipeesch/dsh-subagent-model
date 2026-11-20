# Design

## Context

See proposal.md - Why. The constraints below shape the approach and were verified against the DSH
checkout at `/Users/filipe.esch/projects/pessoal/private-dsh` and the live runtime.

- The plugin owns the route decision but not the request: `exec.signal`, `ctx.llm`, and
  `ctx.subagents` are the only seams, and the plugin keeps zero `@deepseek-ai` imports.
- `llm.listModels(provider)` returns `LlmModelInfo`, which has no reasoning field. Efforts exist
  only on `LlmResolvedModelInfo`, returned by `llm.resolveModelInfo(provider, model) — one model at a
  time.
- `llm.resolveCallConfig` validates the model against the adapter's `resolveModel`, which for the
  Cursor adapter fabricates metadata for an unknown id instead of failing. The check therefore
  proves the provider is registered, not that the model exists.
- An effort the model does not support raises `LlmError` with code
  `UNSUPPORTED_REASONING_EFFORT`, exposed as `error.code` (a plain string on the shared
  `HarnessError` base, so no host import is needed). `resolveCallConfig` materializes the model
  default into the returned config, so the caller can read the effort that will actually be used.
- Measured catalog cost in the live runtime: 15 models on one provider resolve in ~569 ms with
  `Promise.all`; all 43 models across 10 providers in ~1.05 s. Sequential resolution is ~1.3 s for
  one provider, which is why the parallel form is required.
- `grok`, `copilot`, `antigravity`, and `ollama-cloud` advertise no models today, so a catalog
  check cannot decide them either way.

## Goals / Non-Goals

**Goals:**

- Make the catalog incapable of suggesting a concatenated `provider/model` route.
- Reject an unknown model before a child exists, so the parent sees a cause instead of an opaque
  settlement notice.
- Keep one response shape for every catalog call.
- Keep the effort fallback observable without adding a message or a turn.

**Non-Goals:**

- Propagating the provider's failure reason from a child that fails after it starts. The local
  activation path returns `{ output: [], stopReason: 'error' }` with no `diagnostic`, and the host
  emits its settlement notice before the activation result resolves. Presenting that cause would
  require blocking the delegation or writing an extra user message, and both were rejected.
- Restricting model choice to the Session's authorized list, or adding a plugin-side depth cap.
- Validating an inherited route when `model` is omitted.

## Decisions

### Validate catalog membership in the plugin, not in `resolveCallConfig`

A supplied `model` is checked against `llm.listModels(provider)`. An empty catalog cannot decide
the call, so it passes through to the provider; a non-empty catalog that lacks the id fails the
call before any child starts.

The delegation body resolves the context-mode backend before the route, which is unchanged from the
plugin this replaces: `inherit_context` settles on its own contract first, so a composition missing
a backend reports that rather than a route problem that would not matter. When both inputs are
invalid the backend error wins, and that precedence is deliberate.

Alternatives rejected: keeping `resolveCallConfig` as the only check (it is the defect: a
fabricated model info makes any string resolvable); rejecting model ids that contain `/` (breaks
`openrouter` ids such as `qwen/qwen3.8-flash`, which are advertised and valid); checking only the
`provider/` prefix (narrower, and blind to a plain typo).

### The guard rejects on field shape and does not echo the rejected value

The error identifies the `model` field and points at `list_subagent_routes`. It deliberately does
not repeat the requested id, because echoing a concatenated route teaches the wrong format to the
next caller that reads the transcript.

### Efforts come from the provider catalog, resolved in parallel per model

Because `listModels` cannot report efforts, the catalog resolves each advertised model
individually and merges the effort metadata, using `Promise.allSettled` across models. A rejected
model keeps its entry without the effort list instead of failing the whole response.

Alternatives rejected: resolving sequentially (~1.3 s for one provider, ~2x the parallel cost);
omitting efforts entirely (leaves `xhigh`/`max` undiscoverable once the effort no longer errors).

### One response shape, with the filter narrowing the list

Every call returns `{ providers: [...] }`. The optional `provider` filter narrows the array rather
then switching to a different shape, so a caller parses one contract.

### The single-model catalog mode is removed

With efforts carried per model in the list, the `provider` + `model` mode has nothing left to
answer that the list does not, and keeping it would preserve the two-shape asymmetry the change
exists to remove.

### Identifiers only, no display text

Providers, models, and efforts appear as ids. Display names and descriptions are dropped: the
concatenated route rendering was the surface that invited the model to paste a provider into
`model`, and display text adds tokens without adding a decision the model can act on.

### Effort fallback retries without the effort

When `resolveCallConfig` reports `UNSUPPORTED_REASONING_EFFORT`, the plugin retries the same route
without `reasoning_effort` and adopts the config it returns, whose materialized default is the
effective effort. Any other failure propagates unchanged. This keeps `model` strict and `effort`
tolerant: a wrong model cannot work at all, while a wrong effort still produces a usable child.

### The effective effort rides the existing result object

The activation result gains `reasoningEffort` when the route has one. This is a field on a value
the tool already returns, so it adds no message, no turn, and no second tool call; the caller simply
sees what was used.

### The settled effort is stated, never left to inheritance

The pinned host builds child options from the parent route, applies the requested overrides, and
keeps the parent effort unless the route changed without a requested one. A plugin-side route that
merely omitted the effort would therefore let the caller effort reach a child this call never
validated it for: a same-route delegation whose model rejects `max`, whose retry resolves no
default, would still run with the parent `high` while the result claimed none.

So the plugin states the effort on every activation: the resolved id when there is one, an explicit
`undefined` when there is not. That is the host's own documented way to clear an inherited effort
(`resolveChildAgentOptions` keeps an explicit `undefined` override). The result reports the effort
only when the child actually runs with one.

Alternatives rejected: mirroring the host merge in the plugin (it reproduced the defect, because the
inherited effort was never validated against the selected model); letting the host inherit silently
(the tool would report an effort the child cannot run with).

### The child own selection is pinned after creation

The explicit `undefined` override only fixes a fresh child. For a seeded child (`inherit_context:`
`true`) it does not: the seed carries the parent `request/header`, the model-selection projection
folds it into the child state, and `AgentModel.current()` prefers a recorded selection over the
creation options. Probed against the pinned host, the same cleared options yield no effort for a
fresh child but the parent effort for a seeded one - and, worse, a seeded child asked for a
different model still runs the parent model, which defeats the reason for this plugin.

So the delegation reserves the child identity it passes to the activation, and an `agent/created`
listener pins `agent.model.select({ provider, model, reasoningEffort? })` for exactly that id.
That is the supported seam: the deprecated `agent/request` waterfall names it as the replacement,
and the host itself uses it to replace a restored Session selection. The host runs
`agent/created` listeners to completion before releasing the child queued work, so the pin lands
before the first request. A reservation is single-use and matching is by exact id, so concurrent
delegations from one parent cannot consume each other pin.

Reservation is scoped to a backend that can honour it. A reserved child identity is only legal for
a *local* backend - one declaring `prepareContinuable` - and the host rejects it with
`UNSUPPORTED_CAPABILITY` otherwise, so reserving unconditionally would regress every otherwise
compatible external backend, including in fresh mode. Only a fresh or seeded *local* child is
reserved, and only when inheriting: a fresh child records no selection to outrank.
An external backend runs outside this host log, so it is left on the ordinary activation path with
the resolved route forwarded as `agentOptions`. Execution itself belongs to the external provider:
this host neither observes nor enforces the request it eventually makes, so the receipt describes
the route this plugin resolved and forwarded rather than an independently observed external request.
The reservation ends with the start through `settle`, which also reports whether the selection was
applied. A local seeded child that never took its pin fails the call instead of reporting a route
it does not run, and a listener that finds no `agent.model.select` fails the creation rather than
leaving the child on the caller route.

Alternatives rejected: relying on the creation options alone (the defect); editing the seeded
header (the seed is the parent durable log, not the child property); a per-request waterfall
override (deprecated, and it cannot change the selection).

The loader lane covers this: a second pass resumes the parent so a real fork seeds, and the child
own request header is compared with the reported route. Removing the pin makes that lane fail.

### Every model-facing string is owned by one module

`lib/descriptions.js` owns all of it: tool descriptions, parameter text, the activation result, and
every diagnostic a model can read - the catalog provider alternatives, route argument and recovery
instructions, context-backend capability refusals, field validation, and the pin failures. The
detection, capability checks, and control flow stay in their own modules, which import the
templates. Composition-time configuration errors are not model-facing and stay in `lib/config.js`.

Two messages were also narrowed to what the failure establishes. An unconfirmed pin means the route
could not be confirmed, not that the child runs the caller route, and the failed call never
reported a route. One child without `agent.model.select` does not prove the host lacks the seam.
Both now name the backend and the observed failure, and make `inherit_context: false` conditional
on a fresh backend being available.

### Version and compatibility

`0.5.0` -> `0.6.0`. Two breaking changes land together: the catalog output is an object instead
of a string, and `list_subagent_routes` no longer accepts `model` (a parameter removal). Both are
recorded in the README upgrade note; disabling the plugin restores the native surface.

## Risks / Trade-offs

- **A model disabled in the provider adapter's own configuration is absent from `listModels` and is
  therefore refused.** No alternative was accepted; the refusal names the catalog tool, so the
  caller can discover what is selectable. Mitigation: document it in the README.
- **A provider that advertises no models cannot be validated.** Accepted: refusing would break
  working providers. The route then fails inside the provider, exactly as today.
- **The catalog now costs one adapter read per model.** Mitigated by parallel resolution and by the
  `provider` filter; without the filter the call takes ~1 s, which was accepted deliberately.
- **An effort fallback is only observable through the result object.** A caller that ignores the
  result cannot tell the substitution happened. Accepted, because the alternative (an extra
  message) was rejected.
- **The catalog diverges from the native `list_subagent_models` rendering.** Deliberate: the native
  format is the shape that caused the defect, and this plugin masks that tool.
- **[Risk] A nested caller keeps a stale concatenated id in its own transcript.** Mitigation: the
  guard fails fast with the catalog pointer instead of creating a doomed child.

## Migration Plan

1. Land the catalog, guard, effort fallback, and result field together; the spec delta describes the
   combined behavior and no intermediate state is coherent (a new catalog with the old guard would
   still accept a concatenated id).
2. Bump `package.json` to `0.6.0` and note in the README that `list_subagent_routes` now returns
   an object and no longer takes `model`, with the rollback being a downgrade to `0.5.0` or
   disabling the plugin to restore the native tools.
3. Verification is the two existing lanes: `pnpm test` for the unit contract and `pnpm smoke` for
   the loader lane, whose catalog assertion must read the structured result.

## Open Questions

None. The remaining unknowns (a model disabled in the adapter, a provider with no catalog) are
recorded as accepted limitations above, and neither changes the specs or the task breakdown.
