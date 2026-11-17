# Design

## Context

See `proposal.md` — Why. The constraints that shape the approach, all verified against the
development checkout of DSH (`0.2.2-rc.3`):

- The shipped `standard`/`ptc`/`cordis` presets set `modelSelection: true` and
  `modelDiscovery: true` on the native `tool-subagent` instance. The native tool therefore
  advertises `provider`/`model`/`reasoning_effort` and `list_subagent_models`, while
  `packages/subagent/tool-subagent/src/model-selection.ts` admits only the parent route unless the
  Session carries a `subagent/model-selection-policy` event. The host preference that records that
  policy (`subagentModelSelection`) ships disabled.
- `packages/core/tools/src/index.ts` restricts per scope and states the rule that matters here:
  "Restrictions across the scope chain intersect over inherited global and ancestor tools; the
  viewing scope's own registrations remain exempt."
- Agent presets mount once under a standing scope and sessions join by scope parentage, so the
  preset-registered `subagent` is inherited by the agent — maskable — and the exemption only bites
  an explicit agent-local registration.
- `packages/experimental/timeline` already masks host tools for every agent
  (`agent.ctx.tools.restrict` on `agent/created` with `{ global: true }`, released on
  `agent/disposed`, plus a `ctx.tools.guard` backstop). This change follows that pattern instead of
  inventing one.
- `ctx.systemPrompt.section()` requires a finite numeric `order`; `getSectionOrder('TOOL_SUBAGENT')`
  is the placement the native delegation guidance occupies.
- Cordis passes the row's raw `config` object to `apply(ctx, config)` when the plugin exports no
  `Config` validator (`resolveConfig` returns the config unchanged). The plugin can therefore accept
  configuration without importing any `@deepseek-ai` package.
- Both `agents` and `systemPrompt` are composed by `base`, `web-app`, and `sdk-minimal`.

## Goals / Non-Goals

**Goals:**

- One delegation surface: after the plugin loads, the model sees only `subagent_model` and
  `list_subagent_routes` for delegation and route discovery.
- Parity with the masked host tools, so removing them costs no capability the plugin does not
  replace.
- A mask that is truthful and reversible: per-agent release, release on unload, and an explicit
  report when a name could not be hidden.
- Model-facing text whose claims match the composition actually loaded.
- Configuration-driven backend names, so a composition that renames `spawn`/`fork` still works.

**Non-Goals:**

- Hiding anything beyond the four delegation names. `send_message`, `list_agents`, `interrupt`,
  and unrelated tools are untouched.
- Reintroducing `workflow` orchestration through a plugin tool. Removing `workflow` is accepted
  scope; PTC profiles never had it.
- An opt-out switch for masking in this release. The plugin's contract is that installing it makes
  it the delegation surface; a toggle would reopen the ambiguity the change exists to close.
- Replacing the Session model-selection policy. The plugin still routes outside it and does not
  record a policy on the user's behalf.

## Decisions

### Mask through agent-scoped restrictions, with a guard backstop

The masked names are the host's delegation surface as shipped: `subagent`, `subagent_fork`,
`list_subagent_models`, and `workflow`. On load, the plugin enumerates `ctx.agents.list()` and
subscribes to `agent/created` and `agent/disposed` with `{ global: true }`, applying one
`agent.ctx.tools.restrict({ deny: [name] })` per visible name and releasing the exact disposers on
disposal. Per name, rather than one filter, so a name the scope owns is reported without aborting
the rest of the mask. A `ctx.tools.guard` denies execution of the same names and names the
replacement tool in its reason.

The host emits `tools/change` synchronously from inside `restrict()` and from its disposer, so every
mutation runs behind one re-entrancy flag (the pattern `timeline` uses for the same event). Without
it, a refresh triggered by the plugin's own restriction would apply a second, untracked set that
outlives the plugin and survives unload. Both entry points (`refresh` and `attach`) record a dirty
bit when the flag is set, and the pass re-runs once afterwards, so an agent created or a tool
registered in the same tick is not lost.

- Why: it is the host's own pattern, it needs no composition edit, and it is per-agent so subagents
  are covered by the same loop.
- Alternative rejected — mask from the profile/preset: requires the user to own the preset, breaks
  on preset switches, and leaves the plugin's catalog contract dependent on configuration this repo
  cannot verify.
- Alternative rejected — deny only through the guard without restricting: the model would still see
  and attempt the tool, which is the discoverability defect being fixed.
- Alternative rejected — `ctx.tools.restrict` from the plugin's own context: the registry refuses a
  context-global restriction because it would mask every agent unconditionally.

Refresh on `tools/change` re-applies the mask for agents created before a late registration,
mirroring `timeline`. Each pass is idempotent (a map keyed by agent).

### Report what the mask could not hide

The mask does not assume success. Guidance text is computed at assembly time from the live
registry plus the restriction this agent actually received, so the three causes stay distinct:
hidden by this plugin, still visible because the scope owns the registration, and never registered
by the composition. Only the first is attributed to the plugin. The guard still refuses the call,
and building the text from live state keeps the report correct after HMR and preset switches.

- Alternative rejected — failing plugin load when a name survives: one exotic composition would
  remove delegation entirely, and the guard already prevents the failure mode.

### Guidance as one prompt section, placed at the delegation slot

`ctx.systemPrompt.section({ name: 'subagent-model:delegation', order, text })` where `order` comes
from `getSectionOrder('TOOL_SUBAGENT')`, falling back to the literal `2800` if the host no longer
publishes that key (an unknown key returns `undefined` and would throw). The `text` closure renders
four things from live state: which delegation tool accepts an out-of-policy route, the recovery
path after a refusal, which host names this plugin actually hid, and the parallel-delegation and
concurrent-edit rules the masked native tool used to render.

- Why one section: it is registered and disposed with the plugin fiber, and it costs one prompt
  entry instead of per-tool text the model reads late.
- Alternative rejected — descriptions only: the card evidence shows the model burning turns before
  re-reading descriptions; the recovery rule has to be in the prompt.

### Depth guidance as runtime context, computed from public fields

`ctx.systemPrompt.context({ name: 'subagent-model:depth', order: getContextOrder('SUBAGENT_DELEGATION'), text })`
renders the depth notice only when the limit is numeric and reached. Depth is derived with the
host's documented rule from data the agent already carries — `max(agent.session.header.delegationDepth ?? 0, agent.options.subagentDepth ?? 0)` — rather than importing the host helper.

- Alternative rejected — skipping the notice: with `subagent` masked, the host section that used to
  warn about exhausted depth disappears with it, so the plugin must supply it.

### Optional model with parent-route fallback

`model` leaves the required list. When it is absent, `resolveRoute` uses the calling agent's
effective route (request header first, creation options as fallback) and skips provider/model
validation only if no route exists at all; `provider` without `model` still fails. `reasoning_effort`
without `model` is rejected with the pair rule.

- Why: this is what makes hiding `subagent` cost-free for the common "delegate to myself" case.
- Alternative rejected — keeping `model` required and documenting a catalog lookup: it inserts a
  round trip into every delegation, which the native tool never asked for.

### Configuration without host imports

`apply(ctx, config)` reads `config.backends.fresh` and `config.backends.inherit`, defaulting to
`spawn` and `fork`, and validates them itself (non-empty strings, known mode keys only) with errors
that name the requested value and the accepted ones. Unknown keys in `backends` fail loud rather
than being ignored, matching the tool-argument rule.

- Alternative rejected — a `Config` schema export: cordis accepts a Standard Schema instance, and
  hand-rolling one in a zero-dependency plugin adds surface for no benefit over a checked read.

### One module per responsibility

- `lib/descriptions.js`: every static model-facing string (tool descriptions, parameter
  descriptions, guidance template fragments), consumed by both tools.
- `lib/native-mask.js`: targets, attach/detach map, `tools/change` refresh with its re-entrancy
  flag, guard installation, and the live hidden/surviving/absent surface the guidance reads.
- `lib/guidance.js`: prompt section and context registration, depth computation, composition-aware
  text.
- `lib/context-modes.js`: gains `resolveModeBackend` so the delegation body calls one helper twice
  (pre-check, then pre-start revalidation) without rebuilding the argument object.
- `index.js` only wires: services in, registrations out.

### Verification lane

The loader lane gains a profile overlay that overrides the base `tool-subagent` row with
`modelSelection: true` and `modelDiscovery: true` — the exact condition that broke — and asserts
that the request catalog excludes every masked name, that a scripted call to `subagent` is refused
by the guard with the replacement hint, that the rendered system prompt carries the plugin's
guidance, and that `subagent_model` still starts a real child. Compose from `headless` with the
overlay instead of switching to the `web` template, so the lane stays offline and deterministic.

- Alternative rejected — switching the whole lane to the `web` template: it pulls the web surface
  into a lane that only needs the delegation composition.

## Risks / Trade-offs

- [The plugin becomes the only delegation path; an upstream `startActivation` break leaves the
  user with none] → the loader lane is the control, and it now exercises the composition that
  matters; release notes state the dependency.
- [Masking `workflow` removes scripted fan-out from `standard`-like presets] → accepted; it is
  absent from the PTC presets the board uses, and removing one name from the target list restores it.
- [A composition that renames a native tool name defeats the mask] → documented as a limitation of
  name-based masking; the guidance reports the surviving tool instead of claiming otherwise.
- [Guard denies a call the user expected to work] → the denial names the replacement tool, and it
  only fires for names the plugin masks.
- [The agent's own registration exemption means the tool can stay visible] → the guard closes the
  execution path, and the refusal message is actionable.
- [Extra injected services narrow where the plugin loads] → `agents` and `systemPrompt` ship in
  `base`, `web-app`, and `sdk-minimal`; the README records the requirement.
- [Depth computation duplicates a host helper] → one small function with the host's rule cited, no
  import; a host change to the rule surfaces in the spec's scenario for the notice.

## Migration Plan

1. Ship `0.5.0` with the mask, parity, guidance, and the configuration keys. Existing profiles
   need no edit: defaults preserve today's backend names.
2. On upgrade, the native delegation tools disappear and the plugin's tools take over. Nothing is
   stored, so a rollback to `0.4.x` restores the native tools on the next load — the mask has no
   durable state.
3. Update `README.md` (what is hidden, what replaces it, configuration keys, uninstall behavior),
   the `AGENTS.md` architecture rule that currently says the plugin only avoids claiming the native
   names, and the `openspec/config.yaml` context line that repeats it.

## Open Questions

None. The remaining unknowns are implementation-level (whether every agent in every shipped preset
inherits rather than owns the registration) and are covered by the mask's own reporting plus the
guard, so they do not change the specs, the approach, or the task breakdown.
