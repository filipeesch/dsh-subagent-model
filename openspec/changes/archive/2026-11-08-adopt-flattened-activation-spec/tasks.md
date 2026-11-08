# Tasks

## 1. Flatten the activation call

- [x] 1.1 Change `lib/activation.js` so `buildActivationTask` returns only the task fields
      (`prompt`, `parent`, `agentOptions`, optional `maxDepth` and `cwd`), and verify
      `tests/activation.test.js` asserts that shape and that no `request` key is returned.
- [x] 1.2 Spread the task into `subagents.startActivation` in `lib/delegation.js`, writing
      `provider`, `label`, `name`, `signal`, and `delivery` after the spread so activation-owned
      fields win, and verify `tests/delegation.test.js` records `prompt`, `parent`,
      `agentOptions`, `maxDepth`, and `cwd` at the top level of the spec.
- [x] 1.3 Delete the scaffolding that only existed to assemble the removed nested object, and
      verify no module builds or forwards an activation `request` property and `pnpm test` passes.

## 2. Tool surface

- [x] 2.1 Add the optional `name` parameter to the `subagent_model` schema, forward it into the
      activation, and verify a unit test records `name` in the spec and rejects an empty string.
- [x] 2.2 Report the host-resolved name in the tool output as `{ kind, subagentId, name }`, and
      verify a unit test asserts the value comes from the activation result rather than the
      argument.
- [x] 2.3 Declare `additionalProperties: false` on both tools' parameter schemas, and verify a
      unit test asserts the flag on each schema and that the tool catalog still exposes no
      `run_in_background`.

## 3. Unit lane

- [x] 3.1 Update the delegation fakes and assertions for the flattened spec, the `name` parameter,
      and the new output, and verify `pnpm test` passes.
- [x] 3.2 Update `tests/apply.test.js` and `tests/catalog.test.js` for the changed schemas and
      verify `pnpm test` still registers exactly the two plugin tools.

## 4. Package metadata

- [x] 4.1 Set `version` to `0.4.0` and `engines.dsh` to `>=0.2.2-rc.1 <0.3.0` in `package.json`,
      and verify `tests/distribution.test.js` asserts both values and passes.
- [x] 4.2 Verify `node -e` reading the manifest prints `0.4.0` and the new engine range, and
      `npm pack --dry-run` still lists `index.js`, `lib/`, and `cordis.patch.yml`.

## 5. Loader lane

- [x] 5.1 Rework host resolution in `scripts/smoke.mjs`: `DSH_BIN` when set, then `DSH_DEV_CLI` run
      as `node --import tsx/esm <entry>` from the checkout root, then `dsh` on `PATH`, and verify
      `PATH=/usr/bin:/bin node scripts/smoke.mjs` fails with the exact variable to set instead of a
      delegation error.
- [x] 5.2 Script a named `subagent_model` call with an explicit `cwd` under the throwaway home, add
      the scripted stub responses for the child's turn and for a second call carrying an undeclared
      argument, and verify the session log shows a non-error result naming the child and its id, the
      creator's catalog entry for that child, and a rejected undeclared-argument result.
- [x] 5.3 Verify the lane end-to-end against the development runtime by running
      `DSH_DEV_CLI=<checkout>/apps/cli/src/bin.ts pnpm smoke` and confirming the child session is
      recorded with a `subagent/descriptor`.

## 6. Documentation

- [x] 6.1 Add the README note that the flattened activation spec landed after the published
      `0.2.2-rc.1` tag (naming the commit and the declared range), and verify the note sits with the
      existing compatibility section that already states the `engines.dsh` contract.
- [x] 6.2 Add the Host API deprecations rule to `AGENTS.md`: check the pinned DSH source for
      `@deprecated` before using or changing a host API, prefer the documented replacement, never
      add a new deprecated use, and record a chosen alternative when none exists; verify the new
      section is present next to the architecture rules.

## 7. Final validation

- [x] 7.1 Run `pnpm test` and `DSH_DEV_CLI=<checkout>/apps/cli/src/bin.ts pnpm smoke` and verify both
      lanes are green.
- [x] 7.2 Run `openspec validate adopt-flattened-activation-spec --strict` and verify it passes.
