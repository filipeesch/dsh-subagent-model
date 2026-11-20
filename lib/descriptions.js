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
  "Inspect every LLM route available for `subagent_model`. Returns one JSON shape, "
  + "`{ providers: [{ provider, models: [{ id, efforts?, defaultEffort? }] }] }`, identified by id "
  + "alone. Omit `provider` to read every registered provider, each with its models; pass `provider` "
  + "to narrow the same shape to one. Take `id` from `models` and pass it as `subagent_model`'s "
  + "`model` exactly as written: `provider` and `model` are separate arguments, never one combined "
  + "route. Results are not limited by the Session's authorized model list, so this is the catalog "
  + "to read before delegating to a model other than your own.";

/** Catalog parameter descriptions. */
export const CATALOG_PROPERTIES = Object.freeze({
  provider: { type: "string", description: "Registered LLM provider id; omit to list every provider." }
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
  + "afterwards. The result reports the reasoning effort this call resolved and forwarded, which may "
  + "differ from the one requested when the model does not offer it; a backend that runs the child "
  + "outside this host may apply its own default, so the receipt describes what was resolved here.";

/** Delegation parameter descriptions. */
export const DELEGATION_PROPERTIES = Object.freeze({
  description: { type: "string", description: "A short (3-5 word) description of the delegated task, for display." },
  prompt: { type: "string", description: "The task for the subagent. With `inherit_context: true` the child already sees this conversation's completed turns, so build on them and state only what is new. Otherwise it does not share this conversation's context, so include everything it needs." },
  inherit_context: { type: "boolean", description: "When true, seed the child with this conversation's completed turns from the immediate calling agent (the current in-flight turn is excluded). Those turns are sent to the selected provider, and changing the route can prevent provider-side reuse of the inherited prefix. Defaults to false: a fresh child with its own context." },
  model: { type: "string", description: "Optional model id, taken verbatim from `list_subagent_routes`'s `models[].id`. It is the id alone, never a `provider/model` route. Omit to run the child on your current route." },
  name: { type: "string", description: "Optional short name for the child, unique among this agent's children: 1-32 lower-case letters, digits, or hyphens starting with a letter, other than `lead`. Omit to let the host assign `agent-N`." },
  provider: { type: "string", description: "Optional LLM provider id for `model`, separate from the model id; omit to use your current provider. Supply it together with `model`." },
  reasoning_effort: { type: "string", description: "Model-specific reasoning effort id, taken from the model's `efforts` in `list_subagent_routes`. Requires `model`. An effort the model does not offer is dropped and the model default applies when the adapter declares one; the result reports the effort this call resolved and forwarded." },
  cwd: { type: "string", description: "Child working directory; omit to inherit the caller's." }
});

/** Required delegation parameters. */
export const DELEGATION_REQUIRED = Object.freeze(["description", "prompt"]);

/**
 * Render the accepted delegation. The effort is included only when the child
 * actually runs with one, so a model whose effort could not be settled does not
 * appear to have a different one.
 * @param {{ name: string, subagentId: string, reasoningEffort?: string }} value - activation result.
 * @returns {string} transcript line.
 */
export function activationResultText(value) {
  return "started subagent " + value.name + " (" + value.subagentId + ")"
    + (value.reasoningEffort === undefined ? "" : " on reasoning effort " + value.reasoningEffort);
}

/**
 * Explain that a locally created child could not be pinned to its resolved route.
 * @param {string} backend - backend name the child was created on.
 * @returns {string} model-facing error message.
 */
/**
 * Explain that a seeded child could not be confirmed on its resolved route.
 *
 * The failure establishes that the route could not be confirmed, not which route the child will
 * end up running, so the message says exactly that and offers the recovery the caller can pick.
 * @param {string} backend - backend the child was created on.
 * @param {object} [outcome] - what the caller observed.
 * @param {string} [outcome.childId] - identity the caller can check.
 * @param {boolean} [outcome.stopped] - whether teardown was accepted.
 * @returns {string} model-facing error message.
 */
export function unpinnedChildText(backend, { childId, stopped = true } = {}) {
  return "the seeded child" + (childId === undefined ? "" : " " + childId)
    + " on backend " + JSON.stringify(backend) + " could not be confirmed on the route this call "
    + "resolved, so what it runs is not guaranteed; "
    + (stopped
      ? "the call stopped it, so retry with `inherit_context: false` only if `backends.fresh` "
        + "selects a compatible backend, which starts the child fresh and needs no pin"
      : "teardown was refused, so termination is unconfirmed rather than known: check whether "
        + "child " + (childId === undefined ? "this call started" : childId) + " is still running "
        + "before retrying, and retry with `inherit_context: false` only if `backends.fresh` "
        + "selects a compatible backend");
}

/**
 * Explain that this child exposed no model-selection seam, so it could not be pinned.
 * @param {string} backend - backend the child was created on.
 * @returns {string} model-facing error message.
 */
export function missingModelSeamText(backend) {
  return "the child on backend " + JSON.stringify(backend) + " exposed no `agent.model.select` seam, "
    + "so it could not be pinned to the route this call resolved; retry with "
    + "`inherit_context: false` only if `backends.fresh` selects a compatible backend";
}

/** Explain that no reasoning effort was settled, so none is reported. */
export const UNSETTLED_EFFORT_TEXT =
  "the reasoning effort for this child was not settled, so the result does not report one";

/**
 * Explain a provider id the catalog does not register, naming what is available.
 * @param {string} provider - provider id that was requested.
 * @param {readonly string[]} available - registered provider ids.
 * @returns {string} model-facing error message.
 */
export function unknownCatalogProviderText(provider, available) {
  return "LLM provider " + JSON.stringify(provider) + " is not registered; available providers: "
    + (available.length === 0 ? "(none)" : available.join(", "));
}

/** Explain that `provider` and `model` must travel together. */
export const PROVIDER_REQUIRES_MODEL_TEXT = "`provider` and `model` must be supplied together";

/** Explain that an effort cannot be supplied without a model. */
export const EFFORT_REQUIRES_MODEL_TEXT =
  "`reasoning_effort` requires `model`; supply both or omit `reasoning_effort`";

/** Explain that the caller has no provider route to delegate on. */
export const NO_PROVIDER_ROUTE_TEXT =
  "no LLM provider route: pass `provider` and `model` or run under an agent that has one";

/** Explain that the caller has no model route to delegate on. */
export const NO_MODEL_ROUTE_TEXT =
  "no LLM model route: pass `model` or run under an agent that has one";

/** Explain that the LLM runtime is unavailable, so no route can be resolved. */
export const NO_LLM_SERVICE_TEXT =
  "cannot resolve the selected child LLM route because the `llm` service is unavailable";

/**
 * Explain that the context mode has no registered contract.
 * @param {string} mode - requested context mode.
 * @returns {string} model-facing error message.
 */
export function missingContextModeText(mode) {
  return "no context-mode contract is registered for `inherit_context` mode " + JSON.stringify(mode);
}

/**
 * Explain that the backend serving a context mode is not registered.
 * @param {object} input - refusal inputs.
 * @param {string} input.mode - requested context mode.
 * @param {string} input.backend - backend the mode expects.
 * @returns {string} model-facing error message.
 */
export function missingBackendText({ mode, backend }) {
  return "inherit_context=" + (mode === "inherit" ? "true" : "false")
    + " requires the subagent backend " + JSON.stringify(backend)
    + ", which is not registered in this composition; register that provider or point "
    + "`backends." + mode + "` at a registered one";
}

/**
 * Explain that the backend contradicts the context mode it was selected for.
 * @param {object} input - refusal inputs.
 * @param {string} input.mode - requested context mode.
 * @param {string} input.backend - backend the mode expects.
 * @param {boolean} input.expected - contract value the mode requires.
 * @param {boolean|undefined} input.actual - value the backend declares.
 * @returns {string} model-facing error message.
 */
export function contextContractText({ mode, backend, expected, actual }) {
  return "subagent backend " + JSON.stringify(backend) + " does not satisfy the "
    + (mode === "inherit" ? "inheritance" : "fresh-context")
    + " contract required by `inherit_context`: expected inheritsParentContext="
    + expected + ", got " + String(actual);
}

/**
 * Explain that the backend cannot accept the child options this tool requires.
 * @param {object} input - refusal inputs.
 * @param {string} input.mode - requested context mode.
 * @param {string} input.backend - backend the mode expects.
 * @returns {string} model-facing error message.
 */
export function backendOptionsText({ mode, backend }) {
  return "subagent backend " + JSON.stringify(backend) + " cannot accept the child `agentOptions` "
    + "required by `subagent_model` (inherit_context="
    + (mode === "inherit" ? "true" : "false") + ")";
}

/**
 * Explain that a model-facing field must be a non-empty string.
 * @param {string} field - model-facing field name.
 * @returns {string} model-facing error message.
 */
export function nonEmptyFieldText(field) {
  return "`" + field + "` must be a non-empty string";
}

/**
 * Explain that a model-facing field must be a boolean.
 * @param {string} field - model-facing field name.
 * @returns {string} model-facing error message.
 */
export function booleanFieldText(field) {
  return "`" + field + "` must be a boolean";
}

/** Explain that the tool arguments were not an object. */
export const ARGUMENTS_NOT_OBJECT_TEXT = "tool arguments must be an object";

/**
 * Explain that the call supplied arguments the tool does not declare.
 * @param {readonly string[]} unknown - undeclared argument names.
 * @param {readonly string[]} declared - declared parameter names.
 * @returns {string} model-facing error message.
 */
export function undeclaredArgumentText(unknown, declared) {
  return "undeclared argument" + (unknown.length === 1 ? "" : "s") + ": " + unknown.join(", ")
    + "; declared: " + declared.join(", ");
}

/** Explain that delegation needs a calling agent. */
export const NO_CALLING_AGENT_TEXT =
  "subagent_model requires a calling agent (exec.agent was undefined)";

/** Explain that this DSH release offers no managed activations. */
export const NO_MANAGED_ACTIVATIONS_TEXT =
  "subagent_model requires managed activations (ctx.subagents.startActivation), which this DSH release does not provide";

/** Explain that the catalog cannot read providers without the LLM service. */
export const NO_CATALOG_SERVICE_TEXT =
  "cannot discover child LLM routes because the `llm` service is unavailable";

/**
 * Explain that a model id the provider does not advertise was rejected. The rejected value is
 * deliberately not echoed: repeating a concatenated route would teach the wrong
 * format to every later reader of this transcript.
 * @param {string} provider - provider the catalog was read from.
 * @returns {string} model-facing error message.
 */
export function unknownModelText(provider) {
  return "`model` is not one of the ids provider \"" + provider + "\" advertises; call `" + LIST_TOOL_NAME
    + "` with that provider and pass a `models[].id` verbatim. `model` is the id alone: `provider` is "
    + "a separate argument, not a prefix of it";
}

/**
 * Explain a provider id the runtime does not register, naming the recovery path
 * instead of leaving a bare registry message.
 * @param {string} provider - provider that was requested.
 * @returns {string} model-facing error message.
 */
export function unknownProviderText(provider) {
  return "provider " + JSON.stringify(provider) + " is not registered on this host; call `" + LIST_TOOL_NAME
    + "` to read the registered provider ids, or omit `provider` and `model` to delegate on "
    + "your own route";
}

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
