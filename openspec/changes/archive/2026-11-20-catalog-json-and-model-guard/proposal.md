# Proposal

## Why

A delegated call fails silently when the model concatenates the provider into the model id.
The catalog renders routes as `provider/model`, the delegation tool takes `provider` and `model`
as separate fields, and `resolveCallConfig` accepts any string because the Cursor adapter returns
metadata for an id it does not know. The child is created and then dies with a provider rejection
(`Cannot use this model: cursor/claude-opus-5-5`) that the parent never sees; it only receives
"failed before it finished". The same defect reproduces on `codex` and `claude`.

## What Changes

- **BREAKING** `list_subagent_routes` returns a JSON object instead of text, always shaped
  `{ providers: [...] }`, with or without the `provider` filter.
- **BREAKING** The catalog drops the display names and descriptions it used to print: models,
  providers, and efforts are identified by id only, because display text is what invited the
  concatenation.
- **BREAKING** The catalog lists reasoning efforts for every model of a provider, and drops the
  single-model mode, so every response carries the same shape.
- **BREAKING** The catalog no longer accepts `model`; `provider` remains as an optional filter.
- `subagent_model` validates a supplied `model` against the provider's advertised catalog and fails
  before a child starts, naming the field and pointing at the catalog tool without repeating the
  rejected id. A provider that advertises no models is not validated.
- A supplied `reasoning_effort` the model does not advertise no longer fails the call: the effort is
  dropped and the model default applies. An omitted effort keeps today's behavior.
- The delegation result reports the effective reasoning effort, so a fallback is visible in the
  tool result rather than silent.
- The delegation signature is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `subagent-model-tools`: the route catalog tool's output contract changes to structured JSON with
  ids only, and its `model` argument is removed. The reasoning-effort requirement changes so an
  unadvertised effort falls back to the model default instead of failing, and the delegation result
  reports the effective effort.

## Impact

- `lib/catalog.js` — rewritten: structured output, one shape, parallel effort resolution, no
  `model` argument, no display names.
- `lib/route.js` — catalog membership validation and effort fallback.
- `lib/delegation.js` — the result schema gains the effective effort.
- `lib/descriptions.js` — catalog, guard, and fallback wording.
- `tests/catalog.test.js` — rewritten around the new shape.
- `tests/route.test.js`, `tests/delegation.test.js` — effort fallback and catalog guard cases.
- `scripts/smoke.mjs` — the catalog assertion reads structured output.
- `README.md`, `package.json` (0.5.0 -> 0.6.0), `openspec/specs/subagent-model-tools/spec.md`.
- Cost: the catalog resolves one model at a time per provider in parallel (~0.6 s for 15 models,
  ~1.0 s across all providers); each delegation with an explicit `model` adds one catalog read.
- Known limitation carried by design: a model the user disabled in the provider's own adapter
  configuration is absent from `listModels` and is therefore refused by the guard.
