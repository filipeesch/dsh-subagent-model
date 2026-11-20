import { describe, expect, it } from "vitest";
import { createCatalogTool } from "../lib/catalog.js";
import { LIST_TOOL_NAME, nonEmptyFieldText } from "../lib/descriptions.js";
import { createExec, createLlm } from "./helpers/fakes.js";

const providers = [
  { id: "deepseek-official", name: "DeepSeek Official" },
  { id: "openai-codex", name: "ChatGPT Subscription" }
];

const models = {
  "deepseek-official": [
    { id: "deepseek-flash", name: "DeepSeek Flash", description: "Fast tier" },
    { id: "deepseek-pro", name: "DeepSeek Pro" }
  ],
  "openai-codex": [{ id: "gpt-6.2-sol", name: "GPT-6.2-Sol" }]
};

const details = {
  "deepseek-official/deepseek-flash": {
    id: "deepseek-flash",
    name: "DeepSeek Flash",
    description: "Fast tier",
    reasoning: {
      defaultEffort: "high",
      efforts: [
        { id: "low", name: "Low" },
        { id: "high", name: "High", description: "Deeper reasoning" }
      ]
    }
  },
  "deepseek-official/deepseek-pro": { id: "deepseek-pro", name: "DeepSeek Pro" },
  "openai-codex/gpt-6.2-sol": {
    id: "gpt-6.2-sol",
    name: "GPT-6.2-Sol",
    reasoning: { efforts: [{ id: "medium", name: "Medium" }] }
  }
};

/**
 * Run the catalog tool body.
 * @param {object} llm - LLM runtime double.
 * @param {object} [args] - model-facing arguments.
 * @param {AbortSignal} [signal] - cancellation signal.
 * @returns {Promise<object>} catalog value.
 */
async function run(llm, args = {}, signal) {
  const tool = createCatalogTool(llm);
  return tool.execute(args, createExec({ signal }));
}

describe("list_subagent_routes definition", () => {
  it("describes discovery without policy filtering and declares a structured output", () => {
    const tool = createCatalogTool(createLlm());

    expect(tool.name).toBe(LIST_TOOL_NAME);
    expect(tool.description).toContain("subagent_model");
    expect(tool.description).toContain("not limited by the Session's authorized model list");
    expect(tool.description).toContain("provider` and `model` are separate arguments");
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.parameters.properties.provider.type).toBe("string");
    expect(tool.parameters.properties).not.toHaveProperty("model");
    expect(tool.output.schema.type).toBe("object");
    expect(tool.output.schema.required).toEqual(["providers"]);
  });

  it("renders the value as JSON text", () => {
    const tool = createCatalogTool(createLlm());
    const value = { providers: [] };

    expect(tool.output.render({}, value)).toEqual([{ type: "text", text: JSON.stringify(value) }]);
  });
});

describe("list_subagent_routes results", () => {
  it("reports every registered provider with its models and no arguments", async () => {
    const value = await run(createLlm({ providers, models, details }));

    expect(value).toEqual({
      providers: [
        {
          provider: "deepseek-official",
          models: [
            { id: "deepseek-flash", efforts: ["low", "high"], defaultEffort: "high" },
            { id: "deepseek-pro" }
          ]
        },
        { provider: "openai-codex", models: [{ id: "gpt-6.2-sol", efforts: ["medium"] }] }
      ]
    });
  });

  it("reports an empty provider registry with the same shape", async () => {
    await expect(run(createLlm())).resolves.toEqual({ providers: [] });
  });

  it("narrows the same shape to one provider", async () => {
    const value = await run(createLlm({ providers, models, details }), { provider: "openai-codex" });

    expect(value).toEqual({
      providers: [{ provider: "openai-codex", models: [{ id: "gpt-6.2-sol", efforts: ["medium"] }] }]
    });
  });

  it("carries routes the Session policy does not authorize", async () => {
    const policyKeys = new Set(["authorizedRoutes", "allowedRoutes", "sessionRoutes", "policy"]);
    const llm = new Proxy(createLlm({ providers, models, details }), {
      get(target, property, receiver) {
        if (policyKeys.has(property)) throw new Error("unexpected policy read: " + String(property));
        return Reflect.get(target, property, receiver);
      }
    });

    const value = await run(llm);
    expect(value.providers.flatMap((entry) => entry.models.map((model) => model.id)))
      .toEqual(["deepseek-flash", "deepseek-pro", "gpt-6.2-sol"]);
  });

  it("reports identifiers only, never display names, descriptions, or combined routes", async () => {
    const value = await run(createLlm({ providers, models, details }));
    const serialized = JSON.stringify(value);

    expect(serialized).not.toContain("DeepSeek Official");
    expect(serialized).not.toContain("DeepSeek Flash");
    expect(serialized).not.toContain("Fast tier");
    expect(serialized).not.toContain("Deeper reasoning");
    expect(serialized).not.toContain("deepseek-official/deepseek-flash");
    expect(Object.keys(value.providers[0])).toEqual(["provider", "models"]);
  });

  it("omits the effort list for a model without reasoning metadata", async () => {
    const llm = createLlm({ providers, models, details: { "deepseek-official/deepseek-pro": details["deepseek-official/deepseek-pro"] } });

    const value = await run(llm, { provider: "deepseek-official" });

    expect(value.providers[0].models).toEqual([{ id: "deepseek-flash" }, { id: "deepseek-pro" }]);
  });

  it("keeps the rest of the catalog when one model's metadata cannot be read", async () => {
    const llm = createLlm({
      providers,
      models,
      details: { "deepseek-official/deepseek-pro": details["deepseek-official/deepseek-pro"] }
    });

    const value = await run(llm, { provider: "deepseek-official" });

    expect(value.providers[0].models).toEqual([{ id: "deepseek-flash" }, { id: "deepseek-pro" }]);
  });

  it("keeps a readable model effort when a sibling lookup rejects", async () => {
    const deferred = new Map();
    const llm = createLlm({ providers, models: { "deepseek-official": models["deepseek-official"] } });
    // Both lookups must start before either settles, which proves parallel resolution.
    llm.resolveModelInfo = (_provider, model) => new Promise((resolve, reject) => {
      deferred.set(model, { resolve, reject });
    });

    const pending = run(llm, { provider: "deepseek-official" });
    // Drain the awaits that precede the per-model reads so both lookups are observable.
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();

    expect([...deferred.keys()].sort()).toEqual(["deepseek-flash", "deepseek-pro"]);

    deferred.get("deepseek-pro").reject(new Error("unreadable"));
    deferred.get("deepseek-flash").resolve(details["deepseek-official/deepseek-flash"]);

    const value = await pending;
    expect(value.providers[0].models).toEqual([
      { id: "deepseek-flash", efforts: ["low", "high"], defaultEffort: "high" },
      { id: "deepseek-pro" }
    ]);
  });
  it("resolves every model of a provider, not just the first", async () => {
    const llm = createLlm({ providers, models, details });

    await run(llm, { provider: "deepseek-official" });

    expect(llm.calls.resolveModelInfo.map((call) => call.model)).toEqual(["deepseek-flash", "deepseek-pro"]);
    expect(llm.calls.resolveModelInfo[0].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("list_subagent_routes rejections", () => {
  it("rejects the removed single-model argument", async () => {
    await expect(run(createLlm({ providers }), { provider: "deepseek-official", model: "deepseek-flash" }))
      .rejects.toThrow("undeclared argument: model");
  });

  it("rejects an empty provider", async () => {
    await expect(run(createLlm({ providers }), { provider: "" }))
      .rejects.toThrow(nonEmptyFieldText("provider"));
  });

  it("rejects a provider filter that is not a non-empty string", async () => {
    const llm = createLlm({ providers });

    // Each of these would otherwise reach the lookup comparison instead of being refused.
    await expect(run(llm, { provider: null })).rejects.toThrow("`provider` must be a non-empty string");
    await expect(run(llm, { provider: 42 })).rejects.toThrow("`provider` must be a non-empty string");
    expect(llm.calls.listProviders).toBe(0);
  });

  it("names the requested and registered providers for an unknown one", async () => {
    await expect(run(createLlm({ providers }), { provider: "missing" }))
      .rejects.toThrow(
        'LLM provider "missing" is not registered; available providers: deepseek-official, openai-codex'
      );
  });

  it("rejects an argument the schema does not declare", async () => {
    await expect(run(createLlm({ providers }), { unexpected_argument: true }))
      .rejects.toThrow("undeclared argument: unexpected_argument");
  });

  it("reports an unavailable LLM runtime", async () => {
    await expect(run(undefined))
      .rejects.toThrow("cannot discover child LLM routes because the `llm` service is unavailable");
  });
});
