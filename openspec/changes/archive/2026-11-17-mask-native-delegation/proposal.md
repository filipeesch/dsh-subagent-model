# Proposal

## Why

DSH 0.2.2 changed the shipped agent presets: the native `subagent` tool now enables
`modelSelection` and `modelDiscovery`, so it advertises `provider`, `model`, and
`reasoning_effort` while execution stays gated by a per-Session model-selection policy that is
absent by default. The model sees a familiar delegation tool with route fields, uses it, and gets
a hard rejection; the policy-filtered `list_subagent_models` then reports a single route, so the
agent concludes delegation to another model is impossible. Meanwhile this plugin's
`subagent_model` — the one tool built to route work to any model — sits unused.

A real conversation showed the cost: an agent tried a different model twice, received
`child LLM route "claude/claude-opus-5-5" is not allowed for this Session`, queried the native
catalog, and gave up on the second model entirely. Nothing in the model-facing text distinguishes
the policy-gated pair from the ungated pair, so the failure is a discoverability defect of the
delegation surface, not a missing capability.

## What Changes

- **BREAKING** (behavioral): loading the plugin removes the native delegation surface from every
  agent — `subagent`, `subagent_fork`, `list_subagent_models`, and `workflow` — using
  agent-scoped tool restrictions plus an execution guard backstop. The mask is reversible: it is
  released per agent on disposal and with the plugin fiber, so uninstalling restores the host
  tools.
- `subagent_model` becomes the single delegation path and absorbs the native tool's behavior:
  `model` and `provider` become optional and fall back to the calling agent's current route, so
  same-model delegation no longer requires naming a model.
- Model-facing guidance moves into the plugin: descriptions that state the ungated surface, a
  system-prompt section describing the rule and the recovery path, a delegation-depth notice, and
  the parallel-delegation guidance the native tool used to render.
- The guidance adapts to the composition it detects. It only claims a masked native tool when a
  restricted name actually existed, and it reports any name it could not hide instead of
  pretending the sanitized catalog is guaranteed.
- Guard denials name the replacement tool, so an execution that bypasses a mask still steers the
  model to `subagent_model`.
- Backend names stop being hard-coded: the fresh and inheriting backends become plugin
  configuration, defaulting to `spawn` and `fork`, and an unknown name fails loud.
- Model-facing strings become a single module consumed by both tools, and the duplicate
  context-backend resolution in the delegation body collapses into one revalidating helper.
- The loader lane clones `headless` and applies a profile overlay that turns on the native
  `modelSelection` and `modelDiscovery` fields, so this class of upstream change fails
  verification rather than a user's delegation.

## Capabilities

### New Capabilities

None. The change alters one plugin's existing behavior rather than introducing a new capability.

### Modified Capabilities

- `subagent-model-tools`: the tool surface becomes exclusive — the plugin masks the native
  delegation tools it previously coexisted with; `subagent_model` no longer requires an explicit
  model; new requirements cover the mask, its guard backstop, adaptive model-facing guidance,
  configurable backend names, and prompt-level delegation-depth guidance.

## Impact

- `index.js`: additional injected services (`agents`, `systemPrompt`) and one new registration
  for the guidance section; the delegation and catalog factories keep receiving services instead
  of reading module state.
- New modules: native-delegation masking, model-facing text, prompt guidance; a single
  context-backend resolution helper replaces the duplicated calls in `lib/delegation.js`.
- `package.json`: version `0.5.0`; the engine range is unchanged because the host contract this
  release relies on already shipped in `0.2.2-rc.1`.
- Tests: mask lifecycle and guard coverage, adaptive guidance, optional-model delegation, backend
  configuration, and the existing lanes extended for the new wiring.
- `scripts/smoke.mjs`: apply the `tool-subagent` overlay on the `headless` clone and assert the
  masked surface (parent and child catalogs, both guard refusals, the rendered guidance) plus a real
  delegation through the plugin.
- Documentation: `README.md` must state that installing the plugin hides those four tools, what
  replaces each capability, and that the behavior is released on uninstall. The project context in
  `openspec/config.yaml` and the architecture rules in `AGENTS.md` currently say the plugin
  "never claims" the native names; they need to say it suppresses them instead.
- Risk: the plugin becomes the only delegation path, so an upstream break in
  `ctx.subagents.startActivation` removes delegation entirely. The loader lane is the control for
  that risk.
