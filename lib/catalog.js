/** Structured catalog of the LLM routes available for explicit delegation. */

import {
  CATALOG_DESCRIPTION,
  CATALOG_PROPERTIES,
  LIST_TOOL_NAME,
  NO_CATALOG_SERVICE_TEXT,
  unknownCatalogProviderText
} from "./descriptions.js";
import { assertDeclaredArguments, assertNonEmpty } from "./fields.js";

/**
 * Output schema every call answers with: one shape, whether or not a provider
 * filter narrowed it. Models and efforts are identified by id alone, because a
 * rendered `provider/model` route is what invites a caller to paste a provider
 * into the delegation's `model` field.
 */
const CATALOG_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    providers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          provider: { type: "string" },
          models: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                efforts: { type: "array", items: { type: "string" } },
                defaultEffort: { type: "string" }
              },
              required: ["id"]
            }
          }
        },
        required: ["provider", "models"]
      }
    }
  },
  required: ["providers"]
});

/**
 * Render one model entry from its advertised metadata and, when readable, its
 * resolved reasoning efforts. Display names and descriptions are dropped on
 * purpose: the caller decides from ids, not from prose.
 * @param {object} model - advertised model metadata.
 * @param {object|undefined} detail - resolved exact-model metadata, when readable.
 * @returns {{ id: string, efforts?: string[], defaultEffort?: string }} catalog entry.
 */
function modelEntry(model, detail) {
  const efforts = (detail?.reasoning?.efforts ?? []).map((effort) => effort.id);
  const defaultEffort = detail?.reasoning?.defaultEffort;
  return {
    id: model.id,
    ...(efforts.length === 0 ? {} : { efforts }),
    ...(defaultEffort === undefined ? {} : { defaultEffort })
  };
}

/**
 * Resolve every advertised model of one provider, in parallel, tolerating a
 * model whose metadata cannot be read so one failure cannot hide the rest of
 * the catalog.
 * @param {object} llm - LLM runtime.
 * @param {string} provider - provider id owning the models.
 * @param {object[]} models - advertised models.
 * @param {AbortSignal} signal - tool-call cancellation signal.
 * @returns {Promise<{ provider: string, models: object[] }>} one provider entry.
 */
async function providerEntry(llm, provider, models, signal) {
  const details = await Promise.allSettled(
    models.map((model) => llm.resolveModelInfo(provider, model.id, signal))
  );
  signal?.throwIfAborted();
  return {
    provider,
    models: models.map((model, index) => {
      const settled = details[index];
      return modelEntry(model, settled.status === "fulfilled" ? settled.value : undefined);
    })
  };
}

/**
 * Read the routes for one provider filter, or for every registered provider.
 * @param {object} llm - LLM runtime.
 * @param {{ provider?: string }} args - model-facing request.
 * @param {AbortSignal} signal - tool-call cancellation signal.
 * @returns {Promise<{ providers: object[] }>} the catalog value.
 */
async function catalog(llm, args, signal) {
  // The shared validator, not just its text: a supplied filter that is not a non-empty string
  // (null, a number, an object) must be refused rather than reaching a comparison.
  if (args.provider !== undefined) assertNonEmpty(args.provider, "provider");
  const providers = llm.listProviders();
  let selected;
  if (args.provider === undefined) {
    selected = providers;
  } else {
    const provider = providers.find((candidate) => candidate.id === args.provider);
    if (provider === undefined) {
      const available = providers.map((candidate) => candidate.id);
      throw new Error(unknownCatalogProviderText(args.provider, available));
    }
    selected = [provider];
  }

  const modelsByProvider = await Promise.all(selected.map((provider) => llm.listModels(provider.id)));
  signal?.throwIfAborted();
  const entries = await Promise.all(
    selected.map((provider, index) => providerEntry(llm, provider.id, modelsByProvider[index], signal))
  );
  return { providers: entries };
}

/**
 * Build the discovery tool for every route the host advertises. Unlike the
 * native catalog, results are not filtered by the Session's authorized model
 * list, because explicit selection is this plugin's purpose.
 * @param {object|undefined} llm - LLM runtime, when the host provides one.
 * @returns {object} tool definition.
 */
export function createCatalogTool(llm) {
  const properties = CATALOG_PROPERTIES;
  return {
    name: LIST_TOOL_NAME,
    description: CATALOG_DESCRIPTION,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties
    },
    output: {
      schema: CATALOG_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      assertDeclaredArguments(args, Object.keys(properties));
      if (llm === undefined) {
        throw new Error(NO_CATALOG_SERVICE_TEXT);
      }
      return catalog(llm, args, exec.signal);
    }
  };
}
