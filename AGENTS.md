# Project Instructions

## Language

- Write specifications, planning artifacts, code, comments, and commit messages in US English.

## Architecture rules

- The plugin keeps **zero `@deepseek-ai` imports**. It talks to the host only through the injected
  `ctx.tools`, `ctx.subagents`, `ctx.llm`, `ctx.agents`, and `ctx.systemPrompt` services, so it
  loads from any profile without resolving host packages. Do not add peer or runtime dependencies
  without revisiting that rule.
- Tool definitions are plain JSON-Schema objects registered from `apply()`; registration is
  owner-scoped and disposing the plugin fiber unregisters both tools.
- One module, one responsibility: `lib/route.js` resolves and validates a child route,
  `lib/context-modes.js` maps a context mode to its subagent backend and validates the backend
  contract, `lib/config.js` reads and validates the composition row, `lib/activation.js` builds the
  task fields spread onto the activation spec, `lib/catalog.js` renders discovery, `lib/delegation.js`
  starts activations, `lib/native-mask.js` hides the host delegation surface, `lib/guidance.js`
  contributes the prompt section and the depth notice, `lib/descriptions.js` owns every static
  model-facing string, and `index.js` only wires them. Pass services into factories instead of
  reading module-level state.
- Never register a name the host owns: `subagent`, `subagent_fork`, and `list_subagent_models`
  belong to `@deepseek-ai/dsh-tool-subagent`. The plugin's own catalog is `list_subagent_routes`.
- The plugin **suppresses** those host names, plus `workflow`, while it is loaded. Masking is
  agent-scoped: apply `agent.ctx.tools.restrict` on `agent/created` and the initial agent sweep,
  release on `agent/disposed` and on unload, and keep the `ctx.tools.guard` backstop because the
  host exempts the viewing scope's own registrations from inherited restrictions. Never mask from
  the plugin's own context: the registry refuses a context-global restriction. A name that cannot be
  hidden is logged and reported by the guidance, never claimed as hidden. The host emits
  `tools/change` synchronously from inside `restrict()` and from its disposer, so every mask
  mutation runs behind one re-entrancy flag (and a skipped refresh is re-run once afterwards);
  never call `restrict` outside it.
- Delegation uses managed activations with `delivery: 'parent'` and forwards the Host's resolved
  depth limit (`ctx.subagents.resolveMaxDepth()`, omitting the field only when the Host delegates
  depth to the provider). Never add a plugin-local cap.
- Context inheritance selects the configured backend for each mode through the injected
  context-mode registry (defaults `fresh` -> `spawn`, `inherit` -> `fork`). The names come from the
  plugin configuration, never from a literal in the tool body; validate `inheritsParentContext` and
  `agentOptions` and fail loud when the backend cannot honor the mode.
- Model-facing text lives in `lib/descriptions.js`. Adding a delegation rule or availability claim
  elsewhere, or wording that the detected composition may contradict, is a defect.
- Fail loud with actionable messages that name the requested value and the known alternatives.
- Delegation spreads the task fields onto `ctx.subagents.startActivation` and writes the
  activation-owned fields (`provider`, `label`, `name`, `signal`, `delivery`) after the spread.
  The host removed the nested `request` object; never reintroduce it.

## Host API deprecations

- Before using or changing a DSH host API, check the pinned DSH source for `@deprecated` on the
  service, method, event, type, or slot.
- Prefer the documented replacement; never add a new use of a deprecated API.
- When no replacement exists, treat it as a design problem: look for an adjacent public hook, a
  local adapter, or another integration point, and record the chosen alternative and its
  trade-offs in the change design. Keep the deprecated use only as a temporary fallback until that
  alternative lands.
- Host contract changes reach this plugin only through the injected services, so an upstream
  breaking change must be caught by the loader lane, not by a user report.

## Verification

Two lanes, both required before claiming completion:

1. `pnpm test` — unit lane. Vitest over fakes: tool schemas, context-mode contracts, route
   resolution, the exact activation spec, catalog rendering, mask lifecycle and guard refusals,
   adaptive guidance, configuration, and rejection messages.
2. `pnpm smoke` — isolated loader lane. Clones a throwaway `$DSH_HOME` from the `headless`
   template, links this checkout, applies a profile overlay that turns on the native
   `modelSelection`/`modelDiscovery` fields, and drives scripted calls through the real runtime
   against a local Messages-API stub: `list_subagent_routes`, a call to a masked native tool that
   must be refused, a real `subagent_model` delegation, then an undeclared argument that must be
   rejected. It needs a host with the flattened activation spec, so set
   `DSH_DEV_CLI=<checkout>/apps/cli/src/bin.ts`; the installed desktop runtime can predate it and
   must not be the default. The overlay is what keeps this lane able to catch the upstream change
   that made cross-model delegation fail.

Rules for the loader lane:

- Never run it against the developer's live profile, `$DSH_HOME`, board, or session data.
- Keep it offline and credential-free: `DEEPSEEK_BASE_URL` points at the local stub and
  `DEEPSEEK_API_KEY` is a dummy. Never call a real model.
- `SMOKE_KEEP=1` keeps the throwaway home for inspection; otherwise the script removes it.
- If the adapter's stream shape changes, update `respondWithToolCall`/`respondWithText` in
  `scripts/smoke.mjs`; the failure is local to that script.

## Dependencies and registry

`.npmrc` pins the public npm registry because the machine-wide corporate registry is not always
reachable and does not carry the `@deepseek-ai` 0.2.x packages. `vitest` is the only dependency.
`pnpm-workspace.yaml` exists solely to allow esbuild's install script (`allowBuilds`).

## Compatibility and versioning

- `package.json` declares `engines.dsh` for the host range that provides managed activations
  **and** the flattened activation spec (`>=0.2.2-rc.1 <0.3.0`). The README carries the caveat that
  the flattening landed after the published `0.2.2-rc.1` tag, because the development checkout and
  that tag report the same version.
- Tool renames and parameter removals are breaking changes: bump the version and call them out in
  the README and the OpenSpec change that introduces them. Loosening a parameter (for example making
  `model` optional) is not breaking, but changing which tools the model can see is: bump the minor
  version, state the behavior change, and record how to undo it.

## OpenSpec

- Planning artifacts live under `openspec/`; keep them in `en-US` and record behavior changes as
  spec deltas. Do not edit archived changes.
