/** Model-facing catalog of the LLM routes available for explicit delegation. */

/**
 * Render one registered provider.
 * @param {{ id: string, name: string }} provider - provider metadata.
 * @returns {string} one catalog line.
 */
function providerLine(provider) {
  return provider.id + " — " + provider.name;
}

/**
 * Render one advertised or resolved model.
 * @param {string} provider - provider id owning the model.
 * @param {{ id: string, name?: string, description?: string }} model - model metadata.
 * @returns {string} one catalog line.
 */
function modelLine(provider, model) {
  return provider + "/" + model.id + " — " + (model.name ?? model.id)
    + (model.description === undefined ? "" : ": " + model.description);
}

/**
 * Read providers, one provider's models, or one model's reasoning efforts.
 * @param {object} llm - LLM runtime.
 * @param {{ provider?: string, model?: string }} args - model-facing request.
 * @param {AbortSignal} signal - tool-call cancellation signal.
 * @returns {Promise<string>} the rendered catalog.
 */
async function catalog(llm, args, signal) {
  if (args.model !== undefined && args.provider === undefined) {
    throw new Error("`model` requires `provider`");
  }
  if (args.provider !== undefined && args.provider.length === 0) {
    throw new Error("`provider` must be non-empty");
  }
  if (args.model !== undefined && args.model.length === 0) throw new Error("`model` must be non-empty");

  const providers = llm.listProviders();
  if (args.provider === undefined) {
    return providers.length === 0 ? "(no LLM providers)" : providers.map(providerLine).join("\n");
  }
  const provider = providers.find((candidate) => candidate.id === args.provider);
  if (provider === undefined) {
    const available = providers.map((candidate) => candidate.id).join(", ") || "(none)";
    throw new Error('LLM provider "' + args.provider + '" is not registered; available providers: ' + available);
  }
  if (args.model === undefined) {
    const models = await llm.listModels(provider.id);
    signal?.throwIfAborted();
    return models.length === 0
      ? "(no advertised models for " + provider.id + ")"
      : models.map((model) => modelLine(provider.id, model)).join("\n");
  }

  const model = await llm.resolveModelInfo(provider.id, args.model, signal);
  signal?.throwIfAborted();
  const efforts = (model.reasoning?.efforts ?? [])
    .map((effort) => effort.id
      + (model.reasoning.defaultEffort === effort.id ? " (default)" : "")
      + " — " + effort.name
      + (effort.description === undefined ? "" : ": " + effort.description))
    .join("\n") || "(no advertised reasoning efforts)";
  return modelLine(provider.id, model) + "\nReasoning efforts:\n" + efforts;
}

/**
 * Build the discovery tool for every route the host advertises. Unlike the
 * native catalog, results are not filtered by the Session's authorized model
 * list, because explicit selection is this plugin's purpose.
 * @param {object|undefined} llm - LLM runtime, when the host provides one.
 * @returns {object} tool definition.
 */
export function createCatalogTool(llm) {
  return {
    name: "list_subagent_routes",
    description:
      "Inspect every LLM route available for `subagent_model`. No arguments: registered providers; "
      + "`provider`: that provider's advertised models; `provider` + `model`: the model and its reasoning "
      + "efforts. Results are not limited by the Session's authorized model list.",
    parameters: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Registered LLM provider id; omit to list providers." },
        model: { type: "string", description: "Exact model id; requires provider." }
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (llm === undefined) {
        throw new Error("cannot discover child LLM routes because the `llm` service is unavailable");
      }
      return catalog(llm, args, exec.signal);
    }
  };
}
