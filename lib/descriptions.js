/**
 * Every static model-facing string the plugin contributes.
 *
 * Tool descriptions, parameter descriptions, the delegation guidance, the masked-tool refusal,
 * and the depth notice live here so the surface the model reads has one source. Dynamic wording
 * (which host tools are actually hidden) belongs to the guidance module.
 */

/** Model-facing name of the route catalog tool. */
export const LIST_TOOL_NAME = "list_subagent_routes";

/** Model-facing name of the delegation tool. */
export const DELEGATE_TOOL_NAME = "subagent_model";

/**
 * Replacement named when a masked host tool is refused, keyed by the masked tool name.
 * The refusal reads this map, and a test asserts it covers every masked name, so a new target
 * cannot silently lose its hint.
 */
export const REPLACEMENTS = Object.freeze({
  subagent: DELEGATE_TOOL_NAME,
  subagent_fork: DELEGATE_TOOL_NAME,
  workflow: DELEGATE_TOOL_NAME,
  list_subagent_models: LIST_TOOL_NAME
});

/** Description of the route catalog tool. */
export const CATALOG_DESCRIPTION =
  "Inspect every LLM route available for `subagent_model`. No arguments: registered providers; "
  + "`provider`: that provider's advertised models; `provider` + `model`: the model and its reasoning "
  + "efforts. Results are not limited by the Session's authorized model list, so this is the catalog "
  + "to read before delegating to a model other than your own.";

/** Catalog parameter descriptions. */
export const CATALOG_PROPERTIES = Object.freeze({
  provider: { type: "string", description: "Registered LLM provider id; omit to list providers." },
  model: { type: "string", description: "Exact model id; requires provider." }
});

/** Description of the delegation tool. */
export const DELEGATION_DESCRIPTION =
  "Delegate a task to a subagent running a caller-chosen model. This is the delegation tool to use: "
  + "it is not limited to the Session's authorized model list. Omit `provider` and `model` to run the "
  + "child on your current route; pass both, after `list_subagent_routes`, to run it on another model. "
  + "By default the child starts in its own fresh context, so the prompt must be self-contained. Set "
  + "`inherit_context: true` to seed the child with this conversation's completed turns; it does not "
  + "see the current in-flight turn. Inherited turns are sent to the selected provider, and changing "
  + "the route can prevent provider-side reuse of the inherited prefix. The child returns its result "
  + "to you as a completion notice; use `send_message` to steer it while it runs or to continue it "
  + "afterwards.";

/** Delegation parameter descriptions. */
export const DELEGATION_PROPERTIES = Object.freeze({
  description: { type: "string", description: "A short (3-5 word) description of the delegated task, for display." },
  prompt: { type: "string", description: "The task for the subagent. With `inherit_context: true` the child already sees this conversation's completed turns, so build on them and state only what is new. Otherwise it does not share this conversation's context, so include everything it needs." },
  inherit_context: { type: "boolean", description: "When true, seed the child with this conversation's completed turns from the immediate calling agent (the current in-flight turn is excluded). Those turns are sent to the selected provider, and changing the route can prevent provider-side reuse of the inherited prefix. Defaults to false: a fresh child with its own context." },
  model: { type: "string", description: "Optional model id; pass it with `provider` (from `list_subagent_routes`) to run the child on another model. Omit to run the child on your current route." },
  name: { type: "string", description: "Optional short name for the child, unique among this agent's children: 1-32 lower-case letters, digits, or hyphens starting with a letter, other than `lead`. Omit to let the host assign `agent-N`." },
  provider: { type: "string", description: "Optional LLM provider id for `model`; omit to use your current provider. Supply it together with `model`." },
  reasoning_effort: { type: "string", description: "Model-specific reasoning effort id; requires `model`. When the effective route changes, an omitted effort uses the model's default; otherwise the caller's effort is inherited." },
  cwd: { type: "string", description: "Child working directory; omit to inherit the caller's." }
});

/** Required delegation parameters. */
export const DELEGATION_REQUIRED = Object.freeze(["description", "prompt"]);

/**
 * Render one comma-separated list of tool names.
 * @param {readonly string[]} names - tool names.
 * @returns {string} rendered list.
 */
function nameList(names) {
  return names.map((name) => "`" + name + "`").join(", ");
}

/**
 * Render the delegation guidance for the composition the plugin detected.
 * @param {object} surface - what the agent's tool surface actually shows.
 * @param {readonly string[]} surface.hidden - masked names that are absent.
 * @param {readonly string[]} surface.surviving - masked names that are still visible.
 * @returns {string} prompt-section text.
 */
export function guidanceText({ hidden = [], surviving = [] }) {
  const lines = [
    "Delegate with `" + DELEGATE_TOOL_NAME + "`. It is the delegation tool here that the Session's "
    + "model-selection policy does not gate: pass `provider` and `model` for any route `" + LIST_TOOL_NAME
    + "` reports, or omit them to delegate on your own route. `inherit_context: true` gives the child your "
    + "completed turns. If a delegation is refused because of its route, retry it with `" + DELEGATE_TOOL_NAME
    + "` instead of concluding that the route is unavailable.",
    "Start independent delegations together in one assistant message and keep working while they run. "
    + "When only their results remain, end your turn instead of polling: the next result starts a new "
    + "turn. Collect the results you need before answering. Bash, formatters, code generators, and "
    + "scripts can overwrite concurrent edits, so coordinate explicitly, and the agent integrating the "
    + "work must review the final diff and run the relevant tests."
  ];
  if (hidden.length > 0) {
    lines.push("Unavailable while this plugin is loaded: " + nameList(hidden) + ".");
  }
  if (surviving.length > 0) {
    lines.push(
      "Still visible because this composition registers " + nameList(surviving) + " where this plugin "
      + "cannot restrict it, so the sanitized delegation surface is not guaranteed here. Prefer `"
      + DELEGATE_TOOL_NAME + "` for any route the Session's model-selection policy does not authorize."
    );
  }
  return lines.join("\n\n");
}

/**
 * Render the refusal for a masked host tool.
 * @param {string} toolName - masked tool name.
 * @returns {string} model-facing reason.
 */
export function refusalText(toolName) {
  const replacement = REPLACEMENTS[toolName] ?? DELEGATE_TOOL_NAME;
  return "`" + toolName + "` is unavailable while the dsh-subagent-model plugin is loaded; use "
    + "`" + replacement + "` instead"
    + (replacement === DELEGATE_TOOL_NAME
      ? " (`inherit_context: true` gives the child your completed turns)"
      : "")
    + ".";
}

/**
 * Render the delegation-depth notice.
 * @param {object} state - depth accounting.
 * @param {number} state.current - the calling agent's delegation depth.
 * @param {number} state.maximum - the Host's configured maximum.
 * @returns {string} prompt-context text.
 */
export function depthNotice({ current, maximum }) {
  return "Delegation depth for `" + DELEGATE_TOOL_NAME + "`: current " + current + ", maximum " + maximum
    + ", remaining levels 0. Do not delegate at this depth; carry out the work directly.";
}
