# Design

## Context

See `proposal.md` - Why. The constraints that shape this design:

- The installed desktop app is DSH 0.2.1-rc.5. Its `ctx.subagents` service exposes
  `startActivation()` and no longer exposes `start()` or `startContinuable()`; `request.label`,
  `delivery`, and per-request `agentOptions` are part of the activation spec, and
  `request.maxDepth` is optional.
- DSH 0.2.2 ships `modelSelection` and `modelDiscovery` in the Web/Desktop presets. The native
  `list_subagent_models` is registered per agent scope and scoped tools shadow global ones, so a
  global plugin tool with that name would be hidden inside those agents.
- `@deepseek-ai` packages are unavailable from the configured registry right now, and public npm
  stops at 0.2.1-alpha.1, so nothing may depend on installing them to build, test, or load.
- The plugin already registers raw JSON-Schema tool definitions, which the tool registry
  documents as a supported path (the same one MCP-sourced tools use).

## Goals / Non-Goals

**Goals:**

- Restore explicit-route delegation on DSH 0.2.1 and later with the current activation contract.
- Keep the plugin loadable and testable with zero `@deepseek-ai` imports and zero runtime
  dependencies.
- Keep the tool surface small enough that field validation can be written and unit-tested by hand.
- Give the repository two verification lanes: unit tests for contracts, one isolated smoke for the
  real loader.

**Non-Goals:**

- Aligning explicit selection with the Session route policy; that is what the native tool is for.
- Agent presets, per-instance depth configuration, or other native parameters this plugin does not
  need.
- TypeScript, a build step, or an npm release.
- Any change to the bundle row in `cordis.patch.yml` or to how profiles install the plugin.

## Decisions

### Managed activations with parent delivery

`subagent_model` calls `ctx.subagents.startActivation({ provider, label, request, signal, delivery: 'parent' })`
and returns `{ kind: 'activation', subagentId }`, mirroring the native delegation tool.

- *Alternative: caller delivery plus `activation.result` wait.* Restores a foreground result, but
  forces the tool to hold and dispose an activation, and contradicts the release that deliberately
  removed foreground delegation and jobs from subagent control.
- *Alternative: keep the existing `run.result`/`dispose` settle.* This is the broken path: those
  services do not exist, and the helper functions around them (`settleForegroundRun`,
  `stopReasonError`, `withPartialText`) exist only to serve it.

### Zero DSH imports with explicit validation

Tool definitions stay plain JSON-Schema objects registered through `ctx.tools.register()`, and
every parameter rule the schema cannot express is checked in the tool body: non-empty strings,
`provider` and `model` supplied together, model resolvable on the provider, effort advertised by
the model.

- *Alternative: import `defineTool` from `@deepseek-ai/dsh-tools`.* Better house style, but it
  cannot be installed for tests here and adds a runtime resolution coupling for a six-field tool.
- *Alternative: vendor a copy of `defineTool`.* Avoids the dependency but forks upstream's schema
  DSL and will drift.

### Catalog renamed to `list_subagent_routes`

The plugin's discovery tool becomes `list_subagent_routes`; the native `list_subagent_models` is
left untouched.

- *Alternative: keep the name.* On 0.2.2 the preset's scoped registration shadows the plugin's
  global one, so the model would see a policy-limited catalog that contradicts what
  `subagent_model` accepts.
- *Alternative: register only when the native name is absent.* Behavior becomes mount-order
  dependent and differs between releases.

### Explicit selection stays unfiltered by Session policy

The plugin validates that the provider resolves the model and nothing more.

- *Alternative: enforce the Session's authorized routes.* Makes the plugin a duplicate of the
  native tool and removes the reason it exists.
- *Alternative: enforce by default with an opt-out flag.* Adds configuration and a second code
  path for a capability the native tool already offers.

### Delegation depth from the Host

`maxDepth` is omitted from the request so `ctx.subagents.resolveMaxDepth()` applies the Host
setting (default `1`) instead of the plugin's hard-coded `3`.

### Module split with injected dependencies

```
index.js          name, inject, apply(): builds both tools and registers them
lib/route.js      parentRoute(parent), resolveRoute(llm, parent, args), assertRoutePair()
lib/catalog.js    createCatalogTool(llm) -> tool definition
lib/delegation.js createDelegationTool({ llm, subagents }) -> tool definition
```

`parentRoute` reproduces the upstream inheritance rule without importing it: the latest request
header wins, creation options are the fallback.

```
parentRoute(parent) =
  parent.session.requestHeader()?.config ?? parent.options
```

Each factory takes the services it uses, so tests inject fakes and no module reaches for a global.

### Verification lanes

- Unit: vitest with a fake `ctx` that captures registered definitions plus fake `llm` and
  `subagents`. Asserts tool names, parameter schema, the exact activation spec,
  route/effort rejection messages, catalog rendering, and that `list_subagent_models` is never
  registered.
- Smoke: a throwaway `$DSH_HOME`, a profile cloned from the `headless` template, the plugin added
  with `dsh plugin add link:<repo>`, `DEEPSEEK_BASE_URL` pointing at a local Messages-API stub, and
  one headless turn whose scripted tool call is `list_subagent_routes`. Asserts the persisted
  system prompt names both tools once and that the tool result is recorded.

### Package metadata

`engines.dsh` is `>=0.2.1-alpha.1 <0.3.0` (the release that introduced `startActivation`), the
version becomes `0.2.0` for the renamed tool and removed parameter, and `files` ships `index.js`,
`lib/`, `cordis.patch.yml`, and `README.md`.

## Risks / Trade-offs

- [Hand validation drifts from the host contract] → Unit tests assert the exact activation spec and
  the rejection messages; the smoke exercises registration and execution under the real registry.
- [Raw JSON-Schema definitions are less constrained than `defineTool`] → Keep parameters to flat
  scalars and cross-field rules in the body; the smoke proves the schema is accepted by the real
  registry.
- [The `requestHeader` inheritance rule is upstream behavior, not a contract we own] → Reproduce it
  in one small function with a documented fallback, and test both branches.
- [Free choice can bypass the Session route policy] → Deliberate and documented in the README, with
  the native tool named as the policy-respecting option.
- [The Messages-API stub must track the adapter's SSE shape] → Keep the stub minimal and assert only
  the persisted system prompt plus the tool result; if the adapter shape changes, the failure is
  local to the smoke script.
- [Native shadowing rules may change] → The plugin never registers a native-owned name, so shadowing
  cannot turn into a load failure.

## Migration Plan

1. Merge the port and re-link the profile bundle (`dsh plugin add link:<repo>` is unchanged; no
   patch edit is needed).
2. Restart the host so the plugin reloads and the new tool names appear.
3. Update any prompt or automation that referenced `list_subagent_models` or `run_in_background`.
4. Roll back by reverting the change and re-linking the previous tag; no persisted state is
   affected because the plugin owns no storage.
