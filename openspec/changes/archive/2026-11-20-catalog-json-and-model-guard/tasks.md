# Tasks

## 1. Catalog: structured output

- [x] 1.1 Rewrite `lib/catalog.js` so every call returns `{ providers: [...] }` with `provider`
      and `models`, and each model carries `id`, `efforts` ids, and `defaultEffort` when declared;
      declare the tool's `output.schema` as that object and render it as compact JSON. Verify with
      `tests/catalog.test.js` asserting the parsed shape for a provider with efforts.
- [x] 1.2 Resolve one `llm.resolveModelInfo` per advertised model with `Promise.allSettled`, merging
      effort metadata and keeping a rejected model's entry without `efforts`. Verify a unit case
      where one model rejects and the response still reports every model.
- [x] 1.3 Remove the `model` argument from the catalog tool and from its parameter descriptions, and
      keep `provider` as the only optional filter that narrows the same `providers` array. Verify
      `tests/catalog.test.js` covers no-argument, filtered, and undeclared-`model` rejection.
- [x] 1.4 Drop display names and descriptions from every rendered field, leaving ids only. Verify no
      catalog test fixture asserts a display name and the rendered JSON contains no `name` key.

## 2. Delegation: catalog membership guard

- [x] 2.1 Add a model-membership check in `lib/route.js` that reads `llm.listModels(provider)` and
      rejects a supplied `model` the provider advertises but does not contain, skipping the check
      when the provider advertises nothing. Verify with a `tests/route.test.js` case for a rejected
      unknown model and a case for a provider with an empty catalog.
- [x] 2.2 Compose the guard error so it names the `model` field and points at
      `list_subagent_routes` without repeating the rejected id. Verify the assertion checks the
      absence of the id in the message text.
- [x] 2.3 Confirm the guard runs only for an explicit `model` and leaves an inherited route
      untouched. Verify a `tests/route.test.js` case where `model` is omitted and no catalog read is
      recorded.

## 3. Delegation: reasoning effort fallback

- [x] 3.1 Replace the effort rejection with a retry: on `UNSUPPORTED_REASONING_EFFORT` re-resolve the
      same route without the effort and adopt the returned config. Verify with a `tests/route.test.js`
      case where the first call rejects with that code and the second resolves.
- [x] 3.2 Propagate any other `resolveCallConfig` failure unchanged, and preserve cancellation.
      Verify the existing rejection and cancellation cases still pass.
- [x] 3.3 Return the effective effort from route resolution and add `reasoningEffort` to the
      `subagent_model` output schema and renderer when present. Verify `tests/delegation.test.js`
      asserts the field for a valid effort, a fallback, and the omitted-effort case.

## 4. Wording and documentation

- [x] 4.1 Update `lib/descriptions.js` so the catalog description states the structured shape and the
      ids-only contract, and the guard and fallback wording live there. Verify
      `tests/descriptions.test.js` asserts the new strings.
- [x] 4.2 Update `README.md`: the catalog argument table loses `model`, both tools document the new
      output, and an upgrade note records the two breaking changes with the rollback path. Verify by
      reading the rendered section against the shipped schema.
- [x] 4.3 Bump `package.json` to `0.6.0`. Verify the version field and that no other manifest field
      drifts.

## 5. Lane verification

- [x] 5.1 Run `pnpm test` and confirm the full unit suite passes, including the rewritten catalog
      suite and the new guard and fallback cases.
- [x] 5.2 Update the catalog assertion in `scripts/smoke.mjs` to read the structured result instead
      of matching text, then run `pnpm smoke` with `DSH_DEV_CLI` pointed at the checkout and confirm
      the loader lane passes.
- [x] 5.3 Run `openspec validate catalog-json-and-model-guard --strict` and confirm the change
      validates with no warnings.
- [x] 5.4 Cover the cleared-effort contract: a route resolving no effort starts the child with an
      explicit `undefined` override and omits it from the result; an inherited route keeps the
      caller effort; an omitted effort with a materialized default reports that default in both
      the activation options and the result. Verify with `tests/delegation.test.js`.
- [x] 5.5 Cover the real failure paths: `NO_ADAPTER` raised from the catalog lookup gets the
      actionable message and never reaches the resolver; any other catalog failure keeps its
      identity; an already-cancelled call dispatches no lookup; a cancellation during the effort
      retry rejects with the exact signal reason before the adapter settles. Verify with
      `tests/route.test.js`.
- [x] 5.6 Move the model-facing activation-result wording into `lib/descriptions.js` and keep the
      render assertion in `tests/delegation.test.js`.
- [x] 5.7 Pin a delegated child own model selection after creation, so a seeded child runs the
      route the result reports instead of the parent route. Verify `tests/model-pin.test.js`.
- [x] 5.8 Extend the loader lane with a resumed pass that delegates with `inherit_context: true`
      on a model the parent does not use, and asserts the child own request header. Verify
      `pnpm smoke` passes, and fails when the pin is removed.
- [x] 5.9 Scope the reservation to a local backend (one declaring `prepareContinuable`), so an
      external backend keeps its ordinary activation path and is never handed an id the host
      rejects. Verify the external-backend case in `tests/delegation.test.js` and the pinnable
      distinction in `tests/context-modes.test.js`.
- [x] 5.10 Read the seeded delegation receipt in the loader lane, identify the child by the
      reported id, check its seeded header differs from the requested route, and assert the
      reported effort against the child own header and against the parent effort. Verify
      `pnpm smoke`, and that it fails when the pin is neutralized.
- [x] 5.11 Dispose a started-but-unpinned child before surfacing the pin error, preserving that
      error if disposal also fails. Verify in `tests/delegation.test.js`.
- [x] 5.12 Locate the first own request header through the durable `session/end-seed` marker with
      `data.inherited === true`, read the receipt from the resumed parent log only, and require the
      scripted effort in both the header and the receipt. Verify `pnpm smoke`, and that it fails
      when the pin is neutralized.
- [x] 5.13 Keep the pin-failure recovery wording in `lib/descriptions.js`, naming the selected
      backend, and correct the README and design so they do not claim the host enforces what an
      external backend eventually requests.
- [x] 5.14 Centralize every remaining model-facing diagnostic in `lib/descriptions.js` (catalog
      provider alternatives, route recovery, context-backend refusals, field validation) and keep
      detection in the owning modules. Verify `tests/descriptions.test.js` covers each template.
- [x] 5.15 Narrow the pin diagnostics to what the failure establishes, naming the backend and
      making `inherit_context: false` conditional on a fresh backend being available.
- [x] 5.16 Qualify the effort promise in the delegation description and the spec so an external
      backend is not presented as an observed request.
- [x] 5.17 Validate the catalog `provider` filter with the shared non-empty validator, so a
      non-string value is refused instead of reaching the lookup. Verify the null and number cases in
      `tests/catalog.test.js`.
- [x] 5.18 Scope the reasoning-effort requirement and scenarios to host-created children, and
      qualify the default with 'when the adapter declares one' in both the spec and the parameter
      help.
- [x] 5.19 Condition the pin-retry advice on `backends.fresh` selecting a compatible backend, and
      avoid recommending an immediate retry when termination was not confirmed.
- [x] 5.20 Scope the effort scenarios to host-created children, require a supplied `model` in the
      omitted-effort scenario, and state that a route resolving no effort omits the field.
- [x] 5.21 Align the README tool reference and result contract with the qualified effort wording.
- [x] 5.22 Report a refused teardown as unconfirmed termination rather than a running child, naming
      the activation id so the caller checks the right child.
