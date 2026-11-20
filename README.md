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

**Upgrading to 0.6.0 (breaking):** `list_subagent_routes` now returns the structured object shown
below instead of text, and no longer accepts the `model` argument. A caller that parsed the old
lines, or passed `provider` with `model` to read one model's efforts, must read `providers[].models[]`
from a single response instead. The delegation tool's arguments are unchanged; its result gains the
optional `reasoningEffort`. To roll back, downgrade to `0.5.0` or disable the plugin, which restores
the native tools.

## Tools

### `list_subagent_routes`

Enumerates the LLM routes available for delegation.

| Argument | Required | Meaning |
| --- | --- | --- |
| `provider` | no | Registered provider id; omit to list every provider. |

Every call returns the same JSON shape, whether or not `provider` narrowed it:

```json
{
  "providers": [
    {
      "provider": "claude",
      "models": [
        { "id": "claude-opus-5-5", "efforts": ["low", "medium", "high", "xhigh", "max"], "defaultEffort": "high" }
      ]
    }
  ]
}
```

Providers, models, and efforts are identified by **id alone**: no display names or descriptions are
reported, and no combined `provider/model` route is printed. `efforts` is omitted for a model that
exposes none, and `defaultEffort` only appears when the provider declares one.

Pass `models[].id` to `subagent_model` exactly as written. `provider` and `model` are separate
arguments; `model` is never a provider-prefixed route.

Results are **not** filtered by the Session's authorized model list. That is deliberate: the
plugin exists to route work to any model the host can reach, and this is the catalog to read before
delegating to a different model.

Efforts are read one model at a time from the provider, in parallel: about 0.6 s for a 15-model
provider and about 1 s for every registered provider. A model whose metadata cannot be read keeps
its entry without `efforts` rather than failing the response.

### `subagent_model`

Starts one managed subagent activation, optionally on an explicitly selected route.

| Argument | Required | Meaning |
| --- | --- | --- |
| `description` | yes | Short (3-5 word) task label shown in the transcript. |
| `prompt` | yes | The task for the child. With `inherit_context: true`, build on the inherited turns; otherwise include everything it needs. |
| `inherit_context` | no | When `true`, seed the child with this conversation's completed turns from the immediate caller. Defaults to `false` (fresh context). |
| `model` | no | Model id taken verbatim from `list_subagent_routes`'s `models[].id`. It is the id alone, never a `provider/model` route. An id absent from a provider that advertises models is refused before a child starts. Omit to run the child on the caller's current route. |
| `name` | no | Child name, unique among this agent's children: 1-32 lower-case letters, digits, or hyphens starting with a letter, other than `lead`. The host validates it and assigns `agent-N` when omitted. When a nested agent delegates, the reported name is that agent's slash-separated path to the child (for example `agent-1/verifier`), or the child session id when an ancestor is unnamed. |
| `provider` | no | Provider id for `model`, separate from the model id; supply it together with `model`, or omit both to inherit the caller's route. |
| `reasoning_effort` | no | Model-specific effort id from the model's `efforts`. Requires `model`. An effort the model does not offer is dropped and the model's default applies instead when the adapter declares one; the result reports the effort this call resolved and forwarded. When the route resolves no effort at all, the route carries none and the result omits the field, rather than inheriting the caller's effort that this call never validated. |
| `cwd` | no | Child working directory; omitted inherits the caller's. |

The call returns `{ kind: "activation", subagentId, name, reasoningEffort? }` immediately, where
`name` is the addressable name the host recorded for the child (see the `name` row) and
`reasoningEffort` is the effort this call resolved and forwarded, absent when the route declares
none. For a child this host creates, that is the effort it runs with. For a backend that executes
the child elsewhere, the host forwards the route without observing the external request, so a
provider that applies its own default can differ; see the backend contract above.
The transcript renders it as `started subagent <name> (<session id>)`, followed by
`on reasoning effort <id>` when one applies. The child's answer arrives later as a completion notice in
the parent conversation; use `send_message` with either the name or the session id to steer a
running child or to continue it after it settles. Delegation depth is the Host's resolved limit
(`ctx.subagents.resolveMaxDepth()`), forwarded with each request; the plugin applies no cap of its
own.

#### Model id validation

A supplied `model` is checked against the models its provider advertises. The check is skipped for a
provider that advertises no models at all (for example a local runtime with no catalog), because
nothing can decide the call there and refusing would break a route that may work.

One consequence is worth knowing: a model the user disabled in the provider adapter's own
configuration is not advertised, so it is refused here even though the provider itself could run
it. That is the accepted cost of catching a mistyped or provider-prefixed id before a child starts.


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

A backend that declares `prepareContinuable` runs the child locally; the host calls those *local*
backends. Only a local backend can be pinned to a route:

- **Local backend** (the shipped `spawn` and `fork`): an inheriting child is seeded with the
  parent completed turns, including the parent request header. The host prefers a recorded
  selection over the creation options, so the plugin reserves the child identity and applies the
  resolved route through `agent.model.select` before the first request. Without that, a forked
  child would silently run the caller model and effort.
- **External backend** (no `prepareContinuable`, for example a separate-process agent): the host
  rejects a reserved child identity, so the plugin reserves nothing and leaves the call on the
  ordinary activation path, forwarding the resolved route as `agentOptions`. Execution belongs to
  the external provider: this host does not observe or enforce the request it eventually makes, and
  a separate runtime may apply its own defaults. The delegation result therefore describes the
  route this plugin resolved and forwarded, not an independently observed external request.

If a local backend is handed a seeded child that the host refuses to pin, the call fails loudly
rather than reporting a route the child does not run.

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

A second pass adopts the recorded parent session with `--session-id` and delegates with
`inherit_context: true`, asking for a model the parent does not use. That child is *seeded*: its log
starts with the parent request header, and the host prefers a recorded selection over the creation
options. The pass asserts the child own request header matches the route the tool result reported,
which is what catches a forked child silently running the parent route.

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
