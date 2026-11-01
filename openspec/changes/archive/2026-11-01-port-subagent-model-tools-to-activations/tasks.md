# Tasks

## 1. Package and module skeleton

- [x] 1.1 Update `package.json`: version `0.2.0`, `engines.dsh` `>=0.2.1-alpha.2 <0.3.0`, `files` covering `index.js`, `lib/`, `cordis.patch.yml`, `README.md`, `repository`, and `test`/`smoke` scripts. Verify with `npm pack --dry-run --json` that exactly those paths are listed.
- [x] 1.2 Add `vitest` as the only devDependency and a repo `.npmrc` pinning `registry=https://registry.npmjs.org/` (the configured corporate registry is unreachable and carries no `@deepseek-ai` 0.2.x). Verify `pnpm install` and `pnpm test --run` succeed with a placeholder test.
- [x] 1.3 Create `lib/route.js`, `lib/catalog.js`, and `lib/delegation.js` as import-free stubs exporting their factory functions. Verify `node --check` passes for each and `index.js` still loads via `node -e "import('./index.js')"`.

## 2. Route resolution

- [x] 2.1 Implement `parentRoute(parent)` reading `parent.session.requestHeader()?.config` first and falling back to `parent.options`. Verify with unit tests covering a mid-Session route, a creation-time-only route, and a parent with neither.
- [x] 2.2 Implement `resolveRoute(llm, parent, args)` for the pair rules: non-empty `model`, `provider` and `model` supplied together, provider defaulted from `parentRoute`. Verify unit tests assert the exact error text for provider-without-model, empty model, and no resolvable parent provider.
- [x] 2.3 Validate `reasoning_effort` through `llm.resolveCallConfig({ provider, model, reasoningEffort }, signal)` before any child starts. Verify tests assert a rejected effort surfaces a model-correctable error and a valid effort is forwarded unchanged.

## 3. Catalog tool

- [x] 3.1 Build the `list_subagent_routes` definition: flat `provider`/`model` parameters, string output schema with a text renderer. Verify the unit test asserts the name, the provider description, the model description's `requires provider` wording, and that no `list_subagent_models` definition is produced.
- [x] 3.2 Implement the catalog body: providers when no arguments, advertised models for one provider, and model details with reasoning efforts when `provider` and `model` are given. Verify tests cover all three shapes against a fake `llm`.
- [x] 3.3 Implement catalog error paths: `model` without `provider`, unknown provider (naming the requested and registered providers), and unavailable `llm`. Verify each error message with a unit test.
- [x] 3.4 Verify the catalog is not filtered by Session policy: a fake `llm` returning routes outside any authorization list still yields all of them in the rendered text.

## 4. Delegation tool

- [x] 4.1 Build the `subagent_model` definition: required `description`, `prompt`, `model`; optional `provider`, `reasoning_effort`, `cwd`; activation output schema; no `run_in_background` parameter. Verify a unit test asserts the schema keys and the absence of a background switch.
- [x] 4.2 Implement the execute path so the activation spec is exactly `{ provider: 'spawn', label: args.description, request: { prompt, parent, agentOptions, maxDepth?, cwd? }, signal: exec.signal, delivery: 'parent' }`, then return `{ kind: 'activation', subagentId }`. Verify a fake `subagents` captures the spec and the test asserts every field, including the Host-resolved `maxDepth` and its omission when the Host delegates depth to the provider.
- [x] 4.3 Implement delegation error paths: missing calling agent, unresolvable model (naming model and provider), and provider/model pair violation. Verify each with a unit test asserting the message.
- [x] 4.4 Verify `exec.signal` is forwarded to both the LLM preflight and `startActivation`, and that an aborted signal prevents the child from starting.

## 5. Wiring and cleanup

- [x] 5.1 Implement `apply(ctx)` as wiring only: build both tools from the injected `ctx.llm`/`ctx.subagents` and register them; keep `inject = ['tools', 'subagents', 'llm']`. Verify with a fake `ctx` that exactly `list_subagent_routes` and `subagent_model` are registered and that disposal removes both.
- [x] 5.2 Delete the foreground settling code, the run-settling helpers, the `oneOf` output schema, and every `ctx.get` guard from the old `index.js`; keep one documented backend constant instead of the former duplicated one. Verify `grep -n "startContinuable\|run_in_background\|settleForegroundRun\|maxDepth: 3" index.js lib` returns nothing and `node --check index.js` passes.

## 6. Isolated smoke

- [x] 6.1 Write `scripts/smoke.mjs`: create a temp `$DSH_HOME`, `--from-default-profile headless`, `dsh plugin add link:<repo>`, start a local Messages-API stub, point `DEEPSEEK_BASE_URL` at it with a dummy `DEEPSEEK_API_KEY`, and run one headless turn whose scripted tool call is `list_subagent_routes`. Verify the script exits non-zero on assertion failure and zero on success, and cleans up the temp home.
- [x] 6.2 Assert in the smoke that the recorded request header (the tool catalog the model received) names `list_subagent_routes` and `subagent_model` once each and that the tool result text is recorded. Verify by running the script against the installed 0.2.1-rc.5 runtime and inspecting its output.
- [x] 6.3 Record the stub's request/response shape in a comment and fail the smoke with an actionable message when the adapter's SSE shape no longer matches, so the failure is local to the script.

## 7. Documentation

- [x] 7.1 Write `README.md`: install with `dsh plugin add link:<path>`, both tools with their parameters, activation-based result delivery, the deliberate difference from the native policy-limited tool, and the supported DSH range.
- [x] 7.2 Write `AGENTS.md` documenting the two verification lanes (`pnpm test --run`, `node scripts/smoke.mjs`), the isolated `$DSH_HOME` rule, and that the developer's live profile must not be used.
- [x] 7.3 Confirm `cordis.patch.yml` and the bundle row name are unchanged, so installed profiles keep resolving the plugin without edits.

## 8. Final verification

- [x] 8.1 Run `pnpm test --run` and `node scripts/smoke.mjs` against the installed runtime; both pass and the smoke leaves no `$DSH_HOME` behind.
- [x] 8.2 Run `openspec validate --change port-subagent-model-tools-to-activations --strict` and confirm it reports no issues.
- [x] 8.3 Re-read the final diff for scope: no TypeScript, no new runtime dependencies, no native tool names registered, and no changes outside the plugin package.
