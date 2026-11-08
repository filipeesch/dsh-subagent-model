# Tasks

## 1. Context-mode registry

- [x] 1.1 Create `lib/context-modes.js` with `DEFAULT_CONTEXT_MODES` (`fresh -> spawn`, `inherit -> fork`) and a resolver that selects the mode from `inherit_context`; verify the exported mapping with a new `tests/context-modes.test.js` asserting both modes.
- [x] 1.2 Add the backend contract checks to the resolver: provider registered, `inheritsParentContext` matches the mode, and `capabilities.agentOptions` is true; verify each rejection message names `inherit_context`, the backend, and the unmet contract in `tests/context-modes.test.js`.

## 2. Activation request builder

- [x] 2.1 Extract `buildActivationRequest({ args, parent, route, maxDepth })` into `lib/activation.js`; verify it returns the exact prompt, parent, `agentOptions`, optional `maxDepth`, and optional `cwd` in a focused unit test.

## 3. Delegation tool wiring

- [x] 3.1 Add the optional boolean `inherit_context` to the `subagent_model` schema, update the tool, `prompt`, and `inherit_context` descriptions for both modes and the data/cache disclosure, and verify the schema and key wording in `tests/delegation.test.js`.
- [x] 3.2 Replace the hardcoded `SUBAGENT_BACKEND` in `lib/delegation.js` with the injected context-mode resolver and the pure request builder, add the boolean validation, and verify the default fresh activation spec and the `inherit_context: true` fork activation spec in `tests/delegation.test.js`.
- [x] 3.3 Inject `DEFAULT_CONTEXT_MODES` from `index.js` into `createDelegationTool`; verify the plugin still registers exactly `list_subagent_routes` and `subagent_model` in `tests/apply.test.js`.

## 4. Test fixtures and mode matrix

- [x] 4.1 Replace the single-backend `createSubagents` fake with a provider registry that models `spawn` and `fork` records (name, `inheritsParentContext`, capabilities) and records `getProvider` calls; verify existing delegation and apply tests still pass with the new fake shape.
- [x] 4.2 Add the full mode matrix over omitted/false/true: exact activation equality, nested immediate caller, missing backends, contract mismatches, non-boolean `inherit_context`, route rejection, cancellation (including after route resolution), and both depth cases; verify with `pnpm test`.
- [x] 4.3 Revalidate the context-mode backend after route resolution and add regressions that replace the provider during route validation in both directions; verify the call rejects before any activation.

## 5. Documentation and metadata

- [x] 5.1 Update `README.md` with the `inherit_context` row, a fork example, the difference from native `subagent_fork`, and the data-transfer and prefix-reuse caveats; verify the rendered table and sections name the new parameter.
- [x] 5.2 Update the module responsibilities in `AGENTS.md` for `lib/context-modes.js`, `lib/activation.js`, and the delegation wiring; verify the list matches the implemented files.
- [x] 5.3 Bump `package.json` to `0.3.0` and confirm the `engines.dsh` range is unchanged; verify with `node -e "console.log(require('./package.json').version)"`.

## 6. Verification

- [x] 6.1 Run `pnpm test` and confirm the unit lane covers the schema, both modes, contract errors, route validation, cancellation, and depth forwarding.
- [x] 6.2 Run `pnpm smoke` and confirm the isolated loader still registers both tools and completes the scripted catalog call.
- [x] 6.3 Run `openspec validate` for the change and confirm the proposal, spec delta, design, and tasks are coherent before requesting review.
