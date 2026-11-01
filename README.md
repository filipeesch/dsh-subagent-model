# dsh-subagent-model

Model-selection delegation tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
The plugin lets one agent hand a self-contained task to a subagent running on a caller-chosen
provider, model, and reasoning effort, then receive that subagent's answer as a completion notice.

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
| `prompt` | yes | Complete, standalone task for the child. |
| `model` | yes | Model id obtained from `list_subagent_routes`. |
| `provider` | no | Provider id; defaults to the caller's current route. Supply together with `model`. |
| `reasoning_effort` | no | Model-specific effort id, validated against the model before the child starts. |
| `cwd` | no | Child working directory; omitted inherits the caller's. |

The call returns `{ kind: "activation", subagentId }` immediately. The child's answer arrives
later as a completion notice in the parent conversation; use `send_message` to steer a running
child or to continue it after it settles. Delegation depth follows the Host's subagent depth
setting — the plugin applies no cap of its own.

## Difference from the native delegation tool

DSH 0.2.1 and later ship `subagent`/`subagent_fork` with optional route fields and a
`list_subagent_models` catalog. Those honour the Session's authorized route list: without a
recorded policy only the parent route may be selected. Use them when that policy is what you
want; use this plugin when the agent must choose a model that the policy does not list.

Both may be installed at once. The plugin never registers `list_subagent_models`, so the native
catalog keeps its own name and scope.

## Requirements

- DSH `>=0.2.1-alpha.1 <0.3.0` (the release line that introduced managed activations and
  `ctx.subagents.startActivation`). The manifest declares this range through `engines.dsh`, so an
  incompatible profile refuses the bundle at install time.
- Node 24 for the test lanes only; the plugin itself runs inside the host runtime.

## Install

```sh
dsh plugin --profile <profile> add link:/path/to/dsh-subagent-model
```

The bundle row is declared in `cordis.patch.yml`; nothing else in the profile needs to change.
Restart the host after linking so the plugin reloads.

## Development

```sh
pnpm install          # vitest only; .npmrc points at the public registry
pnpm test             # unit lane: tool contracts, route resolution, activation spec
pnpm smoke            # isolated loader lane against the installed DSH runtime
```

The smoke is offline and credential-free: it clones a throwaway profile from the `headless`
template, links this checkout, starts a local Messages-API stub, and drives one scripted
`list_subagent_routes` call through the real loader. Set `DSH_BIN` to test another runtime,
`SMOKE_KEEP=1` to keep the throwaway `$DSH_HOME`, or `SMOKE_DEBUG=1` to print session event types
and the stub request log.

See [AGENTS.md](AGENTS.md) for the verification rules that lane must follow.

## License

MIT
