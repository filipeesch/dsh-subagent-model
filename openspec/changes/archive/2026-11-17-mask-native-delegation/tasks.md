# Tasks

## 1. Model-facing text and configuration foundations

- [x] 1.1 Create `lib/descriptions.js` holding every static model-facing string (both tool
  descriptions, every parameter description, and the guidance fragments), and make `lib/catalog.js`
  and `lib/delegation.js` consume it instead of inlining text. Verify with `pnpm test` and a new
  `tests/descriptions.test.js` that asserts each tool's schema text comes from that module and that
  the catalog text states it is independent of the Session policy.
- [x] 1.2 Add plugin configuration read from the cordis `config` argument: `backends.fresh` and
  `backends.inherit`, defaulting to `spawn` and `fork`, validated locally (non-empty strings, only
  those two mode keys) with errors that name the requested value and the accepted ones. Verify with
  unit tests for defaults, custom names, an unknown mode key, a non-string value, and an empty
  string.
- [x] 1.3 Add `resolveModeBackend` to `lib/context-modes.js` so the delegation body resolves and
  revalidates the backend through one helper instead of rebuilding the same argument object twice,
  and pass the configured mode names through it. Verify the existing context-mode tests still pass
  plus a case for a configured backend name with no registered provider naming the alternatives.

## 2. Delegation parity with the masked native tool

- [x] 2.1 Make `model` optional on `subagent_model`: omit it to run on the calling agent's current
  route, keep `provider` valid only together with `model`, and reject `reasoning_effort` supplied
  without `model`. Verify with delegation tests for a fresh child and an inheriting child with no
  model, `provider` without `model`, `reasoning_effort` without `model`, and an unresolvable
  supplied model still failing before any child starts.
- [x] 2.2 Update the `subagent_model` schema, its description, and the README argument table for the
  optional model, stating that omitting it delegates on the calling agent's route. Verify with
  `tests/descriptions.test.js`, `tests/delegation.test.js`, and a README check for the argument row.

## 3. Native delegation mask

- [x] 3.1 Create `lib/native-mask.js` targeting `subagent`, `subagent_fork`,
  `list_subagent_models`, and `workflow`: an initial pass over `agents.list()`, global
  `agent/created` and `agent/disposed` listeners, a `tools/change` refresh, one restriction per
  visible name keyed by agent in a map, applied behind a re-entrancy flag because the host notifies
  synchronously, and a disposer that releases every restriction when the plugin unloads.
  Verify with `tests/native-mask.test.js` covering attach on an existing agent, attach on a new
  agent, idempotent re-apply, release on agent disposal, release on plugin unload, and an unregistered
  target reported as absent rather than an error.
- [x] 3.2 Install a `tools.guard` that denies execution of the four targets and names the replacement
  (`subagent_model` for delegation, `list_subagent_routes` for the catalog). Verify with unit tests
  for each target's denial reason and for an unrelated tool passing through untouched.
- [x] 3.3 Expose `surface(agent)` from `lib/native-mask.js` so guidance renders from registry state
  plus the restrictions this agent actually received, classifying each name as hidden by this plugin,
  surviving, or absent. Verify with unit tests where an agent-local registration survives the
  restriction, where a target is registered after load, and where the composition never registers a
  name.

## 4. Adaptive guidance and wiring

- [x] 4.1 Create `lib/guidance.js` registering one prompt section named
  `subagent-model:delegation`, ordered by `getSectionOrder('TOOL_SUBAGENT')` with a documented
  numeric fallback, whose text states that `subagent_model` is the route-capable tool, that
  `list_subagent_routes` reports its routes, and the recovery path after a refusal. Verify with
  `tests/guidance.test.js` for the masked composition, the composition where a name survived, the
  order fallback when the host does not publish that key, and removal on unload.
- [x] 4.2 Register a prompt context rendering the delegation-depth notice only when the limit is
  numeric and reached, computing depth as the maximum of the session header and the agent option.
  Verify with unit tests at the limit (current depth, maximum, zero remaining), below the limit (no
  notice), and with no numeric limit (no notice).
- [x] 4.3 Wire `index.js`: inject `agents` and `systemPrompt` alongside the existing services,
  install the mask before guidance, pass the configured backends into the delegation tool, and
  dispose both on unload. Verify with `tests/apply.test.js` asserting the inject list, both tool
  registrations, the mask and guidance installation, and full disposal.

## 5. Verification lanes

- [x] 5.1 Extend `tests/helpers/fakes.js` with doubles for `restrict`, `guard`, the `agents`
  service, and `systemPrompt` (including `getSectionOrder`/`getContextOrder`), so the new unit
  tests exercise the real contracts rather than ad-hoc stubs. Verify with `pnpm test` green across
  every file.
- [x] 5.2 Extend `scripts/smoke.mjs` with a lane that overlays the throwaway profile's
  `tool-subagent` row with `modelSelection: true` and `modelDiscovery: true`, then asserts the
  parent and child request catalogs carry only the plugin's tools, that scripted calls to `subagent`
  and to `list_subagent_models` are refused with the replacement hint, that the rendered system
  prompt lists exactly the masked surface, and that `subagent_model` starts a real child. Verify with
  `DSH_DEV_CLI=<checkout>/apps/cli/src/bin.ts pnpm smoke`.
- [x] 5.3 Run both lanes end to end against the development checkout and confirm the handshake,
  delegation, undeclared-argument rejection, and the new mask lane all pass together. Verify with
  `pnpm test` and `DSH_DEV_CLI=<checkout>/apps/cli/src/bin.ts pnpm smoke` exiting zero.

## 6. Documentation and release

- [x] 6.1 Update `README.md`: the plugin hides `subagent`, `subagent_fork`, `list_subagent_models`,
  and `workflow` while loaded; what replaces each capability; the mask is released on uninstall; the
  `backends` configuration keys; the requirement that the composition provide `agents` and
  `systemPrompt`. Verify the README lists every masked name and every configuration key and that
  `tests/distribution.test.js` still passes.
- [x] 6.2 Update the architecture rule in `AGENTS.md` and the project context line in
  `openspec/config.yaml` so they state the plugin suppresses the native names instead of only
  avoiding them, and record the mask/guard requirement. Verify with a grep for the four names in both
  files.
- [x] 6.3 Bump `package.json` to `0.5.0` and leave `engines.dsh` unchanged. Verify with
  `tests/distribution.test.js` and a version check.
- [x] 6.4 Run `openspec validate mask-native-delegation --strict` and confirm the change validates
  cleanly before handing it to the apply workflow.