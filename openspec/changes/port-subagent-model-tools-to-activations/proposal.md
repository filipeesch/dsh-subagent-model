# Proposal

## Why

The plugin was written against the pre-0.2 delegation contract. DSH 0.2.1-alpha.1 removed
`ctx.subagents.start()` and `ctx.subagents.startContinuable()` in favor of managed
activations, so on the installed 0.2.1-rc.5 release `subagent_model` fails on its first call
with `startContinuable is not a function`. DSH 0.2.2 then ships native model selection and
discovery in the shipped Web/Desktop presets, which shadow the plugin's catalog tool with a
policy-limited one. The tool has to be ported before it can be used on any current release.

## What Changes

- **BREAKING** `subagent_model` delegates through `ctx.subagents.startActivation({ delivery: 'parent' })`
  and returns `{ kind: 'activation', subagentId }`; its result arrives as a parent completion
  notice instead of a foreground return value.
- **BREAKING** `subagent_model` drops the `run_in_background` parameter; every call is a managed
  activation, matching the native delegation tool.
- **BREAKING** The catalog tool is renamed `list_subagent_models` → `list_subagent_routes` so it
  never collides with, or is shadowed by, the native discovery tool added in 0.2.2.
- `subagent_model` gains `reasoning_effort` and `cwd`, requires `provider` and `model` to be
  supplied together, keeps `provider` optional (falling back to the parent route), and leaves the
  delegation depth to the Host setting instead of hard-coding 3.
- `list_subagent_routes` mirrors the native catalog's argument shape (`provider`, then optional
  `model` for reasoning efforts) but stays unfiltered by Session route policy, which is the
  plugin's reason to exist.
- `index.js` is split into wiring plus `lib/route.js`, `lib/catalog.js`, and `lib/delegation.js`;
  the plugin keeps zero runtime imports and explicit, unit-tested field validation.
- `package.json` declares `engines.dsh` (`>=0.2.1-alpha.1 <0.3.0`), bumps to `0.2.0`, and gains
  test and smoke scripts; `README.md` and `AGENTS.md` document install, behavior, and the two
  verification lanes.
- Adds a vitest unit lane and one isolated smoke that boots a throwaway `$DSH_HOME` against a
  local stub provider and script-calls the catalog tool.

## Capabilities

### New Capabilities

- `subagent-model-tools`: model-facing catalog and explicit-route delegation tools that let one
  agent delegate to a subagent on a caller-chosen provider/model on DSH 0.2.1 and later.

### Modified Capabilities

None. The repository had no specs before this change.

## Impact

- `index.js`, `package.json`, `cordis.patch.yml`, and new `lib/`, `tests/`, `scripts/`,
  `README.md`, `AGENTS.md` files.
- No runtime dependencies are added; the plugin keeps loading without resolving DSH packages.
- Installed profiles keep the same bundle row (`dsh-subagent-model`); only the tool names and
  parameters they expose change.
- Behavior differs from native `subagent` on purpose: explicit routes are not restricted to the
  Session's authorized model list.
- Verified against DSH 0.2.1-rc.5 (installed) and 0.2.2-alpha.2 (reference checkout); both provide
  `startActivation` and the `llm` route helpers used here.
