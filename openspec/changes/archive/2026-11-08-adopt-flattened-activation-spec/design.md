# Design

## Context

See [proposal.md](proposal.md) for motivation. Current state that shapes the approach:

- The plugin wires four small modules from `index.js`: `lib/route.js` (route resolution),
  `lib/context-modes.js` (mode to backend contract), `lib/activation.js` (activation request
  construction), and `lib/delegation.js` (the tool body), plus `lib/catalog.js` for discovery.
  Nothing imports `@deepseek-ai`; every host service arrives through `ctx.tools`, `ctx.subagents`,
  and `ctx.llm`.
- The delegation seam is `ctx.subagents.startActivation(spec)`. Host commit `575606a356` moved
  `prompt`, `parent`, `agentOptions`, `maxDepth`, and `cwd` onto `SubagentActivationSpec` itself and
  deleted the nested `request` field, per
  `docs/upgrade-guide/v0.2.1-rc.2/subagent-activation-options/guide.md` in the DSH checkout.
- The spec also carries `name?` and the resolved activation exposes `name`, so naming is a host
  capability the plugin can forward and report.
- Host argument validation supports the `additionalProperties` keyword and reports an undeclared
  property by name, so strictness is expressible in the tool schema.
- Verification is two lanes: `pnpm test` (vitest over fakes) and `pnpm smoke` (a throwaway
  `$DSH_HOME` driven against a local Messages-API stub). The smoke currently prefers the installed
  desktop runtime, which predates the flattened spec, and it never calls `subagent_model`.

## Goals / Non-Goals

**Goals:**

- One activation call shape that matches the declared supported host range, with no runtime
  compatibility branches.
- A loader lane that fails when the host delegation seam drifts again.
- A tool surface where every accepted argument is declared and the result carries the
  host-resolved child name.

**Non-Goals:**

- Serving hosts older than the flattened spec. No dual-shape spread and no feature detection.
- Changing route resolution, context-mode selection, catalog rendering, or delegation-depth policy.
- Adding a runtime guard that translates a host-side `TypeError` into a friendlier message; the
  declared engine range and the documented tag caveat carry that responsibility.

## Decisions

### Build task fields, spread them into the activation spec

`buildActivationTask` keeps its module and its single responsibility, but returns only the task
portion of the spec (`prompt`, `parent`, `agentOptions`, and the optional `maxDepth` and `cwd`).
`delegation.js` spreads that object into the `startActivation` argument and writes the
activation-owned fields after the spread, matching the host upgrade guide's instruction to keep
`label`, `signal`, and `delivery` last so they take precedence.

Alternatives considered:

- *Return the complete activation spec from `buildActivationTask`* — rejected: `label`,
  `signal`, and `delivery` belong to the activation, not the task, and the tool body is where
  cancellation is known.
- *Inline the construction in `delegation.js`* — rejected: the project rule is one module, one
  responsibility; the request shape stays a pure, unit-testable function.
- *Send both shapes to stay compatible with older hosts* — rejected by scope: hosts before the
  flattening fall outside the declared engine range.

### Forward `name` and report the host-resolved name

The plugin asserts only that a supplied `name` is a non-empty string and forwards it. The host owns
the naming rules (1–32 lower-case letters, digits, or hyphens starting with a letter, `lead`
reserved) and the `agent-N` default; duplicating that pattern here would fork a rule that must
stay single-sourced. The tool result reports `started.name`, not the requested argument, so an
omitted `name` still yields the assigned child name.

### Make the parameter schema strict

Both tools declare `additionalProperties: false`. The model-authored arguments are the only source
of tool input, so rejecting a typo or an unsupported convenience field costs nothing and prevents
the silent drop that let a model believe it had set a name. The existing `required` array and
per-parameter annotations stay as they are.

The host advertises a raw `parameters` object to the model but leaves argument validation to the
tool — only its own `defineTool` authoring path compiles a validator, and this plugin cannot import
that package. The loader lane proved the gap: the scripted call carrying an undeclared argument
reached the tool body and started a child. Each tool therefore rejects an undeclared key itself,
naming the key and the declared set, and the schema keyword remains the model-visible contract.

### Boot the DSH development runtime in the smoke lane

The installed desktop runtime predates the flattened spec, so the loader lane must resolve a host
that carries it. Resolution order becomes: `DSH_BIN` when set, then a `DSH_DEV_CLI` entry run as
`node --import tsx/esm <entry>` from the checkout root, then `dsh` on `PATH`; the installed desktop
path stops being the default. When no host can be resolved, the lane fails with the exact command
to set, instead of a misleading delegation error. The stub gains a third scripted response so the
child's own turn is served deterministically, and the scripted call passes an explicit `cwd` under
the throwaway home so the child never runs inside the checkout.

### Narrow the engine range and document the tag caveat

`engines.dsh` becomes `>=0.2.2-rc.1 <0.3.0`, and the package version becomes `0.4.0`. The published
`0.2.2-rc.1` tag and the development checkout report the same version string while only the
checkout carries the flattening, so no range can separate them. The README therefore states that
the flattening landed after that tag and names the commit, which is the only honest signal a
profile author has.

## Risks / Trade-offs

- **A host on the published 0.2.2-rc.1 tag installs yet fails at call time** → the README states the
  caveat and the smoke lane runs against the development runtime, so the mismatch is caught before
  release rather than by a user.
- **A future host adds an injected tool argument** → model-authored arguments are the only input
  today; if a host ever injects one, the schema gains it explicitly in the same change.
- **The loader lane now depends on a development checkout and a slower tsx boot** → the lane stays
  opt-in through an explicit entry variable, and the unit lane keeps covering the request shape.
- **Name errors now surface from the host instead of local validation** → accepted: one source of
  truth for naming rules; the plugin still rejects an empty string.

## Migration Plan

- No data migration. Release `0.4.0`; profiles must run a DSH build that contains the flattening.
- Rollback pairs versions: an older plugin works only with a pre-flattening host, so pin the plugin
  and the host together if a rollback is needed.

## Open Questions

None.
