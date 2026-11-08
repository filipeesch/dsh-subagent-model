# Proposal

## Why

`subagent_model` is unusable on the current DSH main: every call fails before a child starts with
`TypeError: Cannot read properties of undefined (reading 'id')`, regardless of provider, model, or
reasoning effort. DSH commit `575606a356` ("flatten activation task options") removed the nested
`request` field from `SubagentActivationSpec`, and the plugin still sends that shape, so the host
reads `spec.parent` as `undefined` and dereferences it. The failure is silent about its cause, was
mistaken for a route or authorization problem, and cost a delegation round.

Nothing caught it: the unit fakes assert the removed shape, the loader smoke only lists routes
instead of delegating, and `engines.dsh` spans the breaking change so installation keeps accepting a
host whose activation spec no longer matches. The plugin must move to the current host API, and the
gaps that let the drift ship unnoticed must close with it.

## What Changes

- **BREAKING** — Delegation builds the flattened activation spec: `prompt`, `parent`,
  `agentOptions`, `maxDepth`, and `cwd` live on the spec itself, with `label`, `signal`, and
  `delivery` applied last. The removed `request` wrapper disappears from the code and from the
  module that existed to build it.
- **BREAKING** — `engines.dsh` narrows to `>=0.2.2-rc.1 <0.3.0`, the build line that carries the
  flattened spec. The README documents that the flattening landed after the published
  `0.2.2-rc.1` tag, so a host on that exact tag satisfies the range yet still needs the upgrade.
- **BREAKING** — The `subagent_model` parameter schema becomes strict: unknown arguments fail the
  call instead of being dropped, so a model cannot believe it set something the plugin ignored.
- Add optional `name` to `subagent_model`, forwarded to the host, which owns name validation and
  assigns the default `agent-N` when it is omitted.
- The tool output becomes `{ kind, subagentId, name }`, reporting the host-resolved name so the
  calling agent can address and steer the child by the name the host actually recorded.
- Package version becomes `0.4.0`.
- The loader smoke executes `subagent_model` end-to-end against the DSH development runtime, so a
  future host-seam change fails the lane that exists to catch it.
- `AGENTS.md` gains a Host API deprecations rule: check the pinned DSH source for `@deprecated`
  before using or changing a host API, prefer the documented replacement, and treat a missing
  replacement as a design problem with a recorded alternative.

## Capabilities

### New Capabilities

- None. The change repairs and tightens existing behavior.

### Modified Capabilities

- `subagent-model-tools`: the delegation call must build the host's current activation spec; the
  call gains an optional `name` and a strict parameter schema; the result reports the resolved
  child name; the supported host range narrows to the release line that provides the flattened
  spec.

## Impact

- `lib/activation.js`, `lib/delegation.js` — activation request construction and tool body.
- `index.js` — wiring if the activation module is absorbed or renamed.
- `package.json` — version and `engines.dsh`.
- `tests/delegation.test.js`, `tests/apply.test.js` — fakes assert the flattened spec, naming, and
  the strict schema.
- `scripts/smoke.mjs` — resolves the DSH development runtime, executes `subagent_model`, and
  verifies the child session exists.
- `README.md`, `AGENTS.md` — supported host range and the deprecation rule.
- Host dependency: DSH builds containing `575606a356`. No new runtime dependency and no
  `@deepseek-ai` import is introduced.
