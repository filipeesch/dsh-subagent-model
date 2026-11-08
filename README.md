# dsh-subagent-model

Model-selection delegation tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
The plugin lets one agent hand a task to a subagent running on a caller-chosen provider, model, and
reasoning effort, optionally seeding the child with the caller's conversation, then receive that
subagent's answer as a completion notice.

It is a host-half plugin: it publishes no service, ships no UI, and imports no `@deepseek-ai`
package, so it loads from any profile bundle without resolving host packages.

## Tools

### `list_subagent_routes`

Enumerates the LLM routes available for delegation.

| Argument | Required | Meaning |
| --- | --- | --- |
| `provider` | no | Registered provider id; omit to list providers. |
| `model` | no | Exact model id; requires `provider`. |

Results are **not** filtered by the Session's authorized model list. That is deliberate: the
plugin exists to route work to any model the host can reach.

### `subagent_model`

Starts one managed subagent activation on an explicitly selected route.

| Argument | Required | Meaning |
| --- | --- | --- |
| `description` | yes | Short (3-5 word) task label shown in the transcript. |
| `prompt` | yes | The task for the child. With `inherit_context: true`, build on the inherited turns; otherwise include everything it needs. |
| `inherit_context` | no | When `true`, seed the child with this conversation's completed turns from the immediate caller. Defaults to `false` (fresh context). |
| `model` | yes | Model id obtained from `list_subagent_routes`. |
| `provider` | no | Provider id; defaults to the caller's current route. Supply together with `model`. |
| `reasoning_effort` | no | Model-specific effort id, validated against the model before the child starts. |
| `cwd` | no | Child working directory; omitted inherits the caller's. |

The call returns `{ kind: "activation", subagentId }` immediately. The child's answer arrives
later as a completion notice in the parent conversation; use `send_message` to steer a running
child or to continue it after it settles. Delegation depth is the Host's resolved limit
(`ctx.subagents.resolveMaxDepth()`), forwarded with each request; the plugin applies no cap of its
own.

#### Context inheritance

Set `inherit_context: true` to start the child on the host's `fork` backend. The child is seeded
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

## Difference from the native delegation tool

DSH 0.2.1 and later ship `subagent` (fresh) and `subagent_fork` (inherited context) with a
`list_subagent_models` catalog. The native fork tool deliberately omits route fields so the child
can reuse the parent's request prefix. This plugin exposes route fields on both context modes, so
choosing a different model over a fork is possible with the cache trade-off documented above.

The native tools honour the Session's authorized route list: without a recorded policy only the
parent route may be selected. Use them when that policy is what you want; use this plugin when the
agent must choose a model that the policy does not list.

Both may be installed at once. The plugin never registers `list_subagent_models`, so the native
catalog keeps its own name and scope.

## Requirements

- DSH `>=0.2.1-alpha.2 <0.3.0` (the release that introduced managed activations and
  `ctx.subagents.startActivation`). The manifest declares this range through `engines.dsh`, so an
  incompatible profile refuses the bundle at install time.
- Node 24 for the test lanes only; the plugin itself runs inside the host runtime.

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
pnpm test             # unit lane: tool contracts, context modes, route resolution, activation spec
pnpm smoke            # isolated loader lane against the installed DSH runtime
```

The smoke is offline and credential-free: it clones a throwaway profile from the `headless`
template, links this checkout, starts a local Messages-API stub, and drives one scripted
`list_subagent_routes` call through the real loader. Set `DSH_BIN` to test another runtime,
`SMOKE_KEEP=1` to keep the throwaway `$DSH_HOME`, or `SMOKE_DEBUG=1` to print session event types
and the stub request log.

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
