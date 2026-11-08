# Project Instructions

## Language

- Write specifications, planning artifacts, code, comments, and commit messages in US English.

## Architecture rules

- The plugin keeps **zero `@deepseek-ai` imports**. It talks to the host only through the injected
  `ctx.tools`, `ctx.subagents`, and `ctx.llm` services, so it loads from any profile without
  resolving host packages. Do not add peer or runtime dependencies without revisiting that rule.
- Tool definitions are plain JSON-Schema objects registered from `apply()`; registration is
  owner-scoped and disposing the plugin fiber unregisters both tools.
- One module, one responsibility: `lib/route.js` resolves and validates a child route,
  `lib/context-modes.js` maps a context mode to its subagent backend and validates the backend
  contract, `lib/activation.js` builds the task fields spread onto the activation spec,
  `lib/catalog.js` renders discovery, `lib/delegation.js` starts activations, and `index.js` only
  wires them. Pass services into factories instead of reading module-level state.
- Never register a name the host owns: `subagent`, `subagent_fork`, and `list_subagent_models`
  belong to `@deepseek-ai/dsh-tool-subagent`. The plugin's own catalog is `list_subagent_routes`.
- Delegation uses managed activations with `delivery: 'parent'` and forwards the Host's resolved
  depth limit (`ctx.subagents.resolveMaxDepth()`, omitting the field only when the Host delegates
  depth to the provider). Never add a plugin-local cap.
- Context inheritance selects the `fork` backend through the injected context-mode registry
  (`fresh` -> `spawn`, `inherit` -> `fork`). Never hardcode a backend in the tool body; validate
  `inheritsParentContext` and `agentOptions` and fail loud when the backend cannot honor the mode.
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
   resolution, the exact activation spec, catalog rendering, and rejection messages.
2. `pnpm smoke` — isolated loader lane. Clones a throwaway `$DSH_HOME` from the `headless`
   template, links this checkout, and drives scripted calls through the real runtime against a
   local Messages-API stub: `list_subagent_routes`, then a real `subagent_model` delegation, then
   an undeclared argument that must be rejected. It needs a host with the flattened activation
   spec, so set `DSH_DEV_CLI=<checkout>/apps/cli/src/bin.ts`; the installed desktop runtime can
   predate it and must not be the default.

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
  the README and the OpenSpec change that introduces them.

## OpenSpec

- Planning artifacts live under `openspec/`; keep them in `en-US` and record behavior changes as
  spec deltas. Do not edit archived changes.
