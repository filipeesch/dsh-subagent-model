# dsh-subagent-model

Model-selection delegation tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
The plugin lets one agent hand a task to a subagent running on a caller-chosen provider, model, and
reasoning effort, optionally seeding the child with the caller's conversation, then receive that
subagent's answer as a completion notice.

It is a host-half plugin: it publishes no service, ships no UI, and imports no `@deepseek-ai`
package, so it loads from any profile bundle without resolving host packages.

## Why this plugin exists

DSH 0.2.2 changed the shipped agent presets: the native `subagent` tool now enables
`modelSelection` and `modelDiscovery`, so it advertises `provider`, `model`, and
`reasoning_effort` while execution stays gated by a per-Session model-selection policy that is
absent by default. A model that uses those fields is rejected with
`child LLM route "provider/model" is not allowed for this Session`, and the policy-filtered
`list_subagent_models` then reports a single route, which makes cross-model delegation look
impossible.

This plugin is the ungated surface: it routes work to any model the host can reach. It also hides
the gated host tools while it is loaded, so the model sees one delegation path instead of two
near-identical ones.

## Native delegation surface

While the plugin is loaded it masks four host tools for every agent it can observe, including
agents created later and the plugin's own subagents:

| Masked host tool | Capability replaced by |
| --- | --- |
| `subagent` | `subagent_model` (omit `provider`/`model` to delegate on the caller's route) |
| `subagent_fork` | `subagent_model` with `inherit_context: true` |
| `list_subagent_models` | `list_subagent_routes` (not filtered by the Session policy) |
| `workflow` | `subagent_model` for single delegations; scripted fan-out is not replaced |

The mask is agent-scoped and reversible:

- it is applied with the host's scoped tool restriction, which is why the host tools disappear from
  the model-facing catalog;
- an execution that still reaches dispatch (for example through an agent-local registration the
  host exempts from inherited restrictions) is denied by an execution guard whose message names the
  replacement tool;
- the restriction is released when the agent is disposed and when the plugin unloads, so
  uninstalling the plugin restores the host tools.

If a masked name is registered where the plugin cannot restrict it, the plugin logs what it
detected and the guard still refuses the call; the model-facing guidance then reports the surviving
tool instead of claiming it is hidden. The plugin also contributes that guidance as a prompt
section (which delegation tool accepts an out-of-policy route, what to do when a route is refused, and
the parallel-delegation and concurrent-edit rules) and a depth notice that appears once the Host's
delegation limit is reached.

`send_message`, `list_agents`, and `interrupt` are not masked, so steering and inspecting
children keeps working.

**Upgrading note:** installing or enabling this plugin removes those four tools from the model
surface. That is a behavior change in the agent, not in stored data; disabling the plugin restores
them on the next load.

## Tools

### `list_subagent_routes`

Enumerates the LLM routes available for delegation.

| Argument | Required | Meaning |
| --- | --- | --- |
| `provider` | no | Registered provider id; omit to list providers. |
| `model` | no | Exact model id; requires `provider`. |

Results are **not** filtered by the Session's authorized model list. That is deliberate: the
plugin exists to route work to any model the host can reach, and this is the catalog to read before
delegating to a different model.

### `subagent_model`

Starts one managed subagent activation, optionally on an explicitly selected route.

| Argument | Required | Meaning |
| --- | --- | --- |
| `description` | yes | Short (3-5 word) task label shown in the transcript. |
| `prompt` | yes | The task for the child. With `inherit_context: true`, build on the inherited turns; otherwise include everything it needs. |
| `inherit_context` | no | When `true`, seed the child with this conversation's completed turns from the immediate caller. Defaults to `false` (fresh context). |
| `model` | no | Model id from `list_subagent_routes`. Omit to run the child on the caller's current route. |
| `name` | no | Child name, unique among this agent's children: 1-32 lower-case letters, digits, or hyphens starting with a letter, other than `lead`. The host validates it and assigns `agent-N` when omitted. When a nested agent delegates, the reported name is that agent's slash-separated path to the child (for example `agent-1/verifier`), or the child session id when an ancestor is unnamed. |
| `provider` | no | Provider id for `model`; supply it together with `model`, or omit both to inherit the caller's route. |
| `reasoning_effort` | no | Model-specific effort id, validated against the model before the child starts. Requires `model`. |
| `cwd` | no | Child working directory; omitted inherits the caller's. |

The call returns `{ kind: "activation", subagentId, name }` immediately, where `name` is the
addressable name the host recorded for the child (see the `name` row). The transcript renders it as
`started subagent <name> (<session id>)`. The child's answer arrives later as a completion notice in
the parent conversation; use `send_message` with either the name or the session id to steer a
running child or to continue it after it settles. Delegation depth is the Host's resolved limit
(`ctx.subagents.resolveMaxDepth()`), forwarded with each request; the plugin applies no cap of its
own.

Both tools declare `additionalProperties: false`, so an argument the schema does not declare fails
the call instead of being silently ignored.

#### Context inheritance

Set `inherit_context: true` to start the child on the configured inheriting backend (default `fork`,
see Configuration). The child is seeded
with the immediate calling agent's completed turns up to the last `turn/end`; the current
in-flight turn is not included. Before the caller has completed a turn, the child starts without
inherited turns. The seed is captured when the child is created, so later turns in the caller are
not added; `send_message` continues the child's own transcript.

Inheriting context sends those completed turns to the selected provider and model. The plugin does
not restrict that to the Session's authorized routes, so choose the route deliberately. Changing
the route can also prevent provider-side reuse of the inherited prefix; passing the caller's route
maximizes reuse.

If the composition does not provide a backend that satisfies the inheritance contract, the call
fails before the child starts instead of silently falling back to fresh context.

```json
{
  "description": "review the diff",
  "prompt": "Review the staged diff and report the findings.",
  "provider": "openai-codex",
  "model": "gpt-6.1-sol",
  "inherit_context": true
}
```

## Configuration

The composition row may configure which registered subagent backend serves each context mode. Both
default to the names DSH ships:

```yaml
- id: subagent-model
  name: dsh-subagent-model
  config:
    backends:
      fresh: spawn
      inherit: fork
```

A composition that renames its providers sets these instead of relying on the defaults. A name with
no registered provider fails loud at call time, naming the requested backend, the context mode, and
the key that selects it. Unknown keys are rejected rather than ignored.

## Requirements

- DSH `>=0.2.2-rc.1 <0.3.0`. The manifest declares this range through `engines.dsh`, so an
  incompatible profile refuses the bundle at install time. The floor covers managed activations
  **and** the flattened activation spec; the flattening landed after the published
  `0.2.2-rc.1` tag, so a host reporting that exact version is not assumed compatible.
- A profile that composes the `agents` and `systemPrompt` services, which `base`, `web-app`,
  and `sdk-minimal` all provide. The plugin injects them because the mask needs the agent registry
  and the guidance needs the prompt surface; a composition without them does not load the plugin.
- Node 24 for the test lanes only; the plugin itself runs inside the host runtime.
- No runtime dependencies: the plugin only uses the injected services.

## Install from GitHub

1. In DSH, open **Plugins**, select the arrow next to **Add plugin**, and choose **Install a
   third-party plugin**.
2. Enter `https://github.com/filipeesch/dsh-subagent-model` and install it.
3. Choose **Enable now** to request activation. Follow any restart notice and check that the
   plugin is enabled and its tools are available. Closing the installer without enabling it leaves
   the plugin installed but inactive.

No local checkout is required. The URL without a reference uses the revision selected by DSH and
its package manager. To request a specific revision, use a supported Git spec such as
`git+https://github.com/filipeesch/dsh-subagent-model.git#<commit>`. The plugin does not impose a
fixed version.

Installation affects the connected DSH host and its current profile. If the host is remote, the
plugin is installed on that host, not on the browser's computer. Install only repositories you trust:
plugin code runs in the host process, and approved installation scripts can execute code. Follow
DSH's own prompts and review any requested approvals.

### Local checkout for development

```sh
dsh plugin --profile <profile> add link:/path/to/dsh-subagent-model
```

The bundle row is declared in `cordis.patch.yml`; nothing else in the profile needs to change.
Restart the host after linking so the plugin reloads. Keep the linked checkout available.

## Development

```sh
pnpm install          # vitest only; .npmrc points at the public registry
pnpm test             # unit lane: tool contracts, mask lifecycle, guidance, configuration, activation spec
pnpm smoke            # isolated loader lane: registers both tools, masks the native surface, starts one real child
```

The smoke is offline and credential-free: it clones a throwaway profile from the `headless`
template, links this checkout, starts a local Messages-API stub, and drives scripted calls through
the real loader. It asserts the plugin's tools are registered, that the native delegation surface
is masked, that a call to a masked tool is refused with the replacement hint, and that a real child
is started and recorded with a continuable descriptor in the requested directory. To exercise the
mask, the lane applies a profile overlay that turns on the native `modelSelection` and
`modelDiscovery` fields, which is the composition that made cross-model delegation fail after DSH
0.2.2.

The lane needs a host that provides the flattened activation spec, so it does not default to the
installed desktop runtime:

```sh
DSH_DEV_CLI=/path/to/dsh-checkout/apps/cli/src/bin.ts pnpm smoke
```

`DSH_DEV_CLI` is booted as `node --import tsx/esm <entry>` from the checkout root; `DSH_BIN`
selects an explicit runtime executable instead, and a plain `dsh` on `PATH` is the last resort.
Use `SMOKE_KEEP=1` to keep the throwaway `$DSH_HOME` or `SMOKE_DEBUG=1` to print session event
types and the stub request log.

To verify a published GitHub revision separately, with network access, Git, and a compatible DSH
runtime available, run:

```sh
pnpm smoke:github 'https://github.com/filipeesch/dsh-subagent-model'
```

This check installs executable code from the supplied repository: use only a trusted URL. It uses a
fresh disposable DSH home and profile, disables package install scripts, and runs the model request
against the local stub. It reports the installed commit and fails if it cannot verify that revision
or load both tools. A URL with a supported reference may be supplied instead. It tests only published
content, not unpublished changes in the local checkout; network and host failures are not covered by
the offline lane.

See [AGENTS.md](AGENTS.md) for the verification rules that lane must follow.

## License

MIT
