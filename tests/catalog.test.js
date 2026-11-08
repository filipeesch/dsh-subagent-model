import { describe, expect, it } from "vitest";
import { createCatalogTool } from "../lib/catalog.js";
import { createExec, createLlm } from "./helpers/fakes.js";

const providers = [
  { id: "deepseek-official", name: "DeepSeek Official" },
  { id: "openai-codex", name: "ChatGPT Subscription" }
];

const models = {
  "deepseek-official": [
    { id: "deepseek-flash", name: "DeepSeek Flash", description: "Fast tier" },
    { id: "deepseek-pro", name: "DeepSeek Pro" }
  ]
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
  }
};

/**
 * Run the catalog tool body.
 * @param {object} llm - LLM runtime double.
 * @param {object} [args] - model-facing arguments.
 * @param {AbortSignal} [signal] - cancellation signal.
 * @returns {Promise<string>} rendered catalog.
 */
async function run(llm, args = {}, signal) {
  const tool = createCatalogTool(llm);
  return tool.execute(args, createExec({ signal }));
}

describe("list_subagent_routes definition", () => {
  it("describes discovery without policy filtering", () => {
    const tool = createCatalogTool(createLlm());

    expect(tool.name).toBe("list_subagent_routes");
    expect(tool.description).toContain("subagent_model");
    expect(tool.description).toContain("not limited by the Session's authorized model list");
    expect(tool.parameters.properties.provider.type).toBe("string");
    expect(tool.parameters.properties.model.description).toContain("requires provider");
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.output.schema).toEqual({ type: "string" });
    expect(tool.output.render({}, "hello")).toEqual([{ type: "text", text: "hello" }]);
  });
});

describe("list_subagent_routes results", () => {
  it("lists registered providers with no arguments", async () => {
    await expect(run(createLlm({ providers }))).resolves.toBe(
      "deepseek-official — DeepSeek Official\nopenai-codex — ChatGPT Subscription"
    );
  });

  it("reports an empty provider registry", async () => {
    await expect(run(createLlm())).resolves.toBe("(no LLM providers)");
  });

  it("lists every advertised model for one provider", async () => {
    await expect(run(createLlm({ providers, models }), { provider: "deepseek-official" }))
      .resolves.toBe(
        "deepseek-official/deepseek-flash — DeepSeek Flash: Fast tier\n"
        + "deepseek-official/deepseek-pro — DeepSeek Pro"
      );
  });

  it("reports a provider without advertised models", async () => {
    await expect(run(createLlm({ providers }), { provider: "openai-codex" }))
      .resolves.toBe("(no advertised models for openai-codex)");
  });

  it("reads no Session route policy when listing models", async () => {
    const policyKeys = new Set(["authorizedRoutes", "allowedRoutes", "sessionRoutes", "policy"]);
    const llm = new Proxy(createLlm({ providers, models }), {
      get(target, property, receiver) {
        if (policyKeys.has(property)) throw new Error("unexpected policy read: " + String(property));
        return Reflect.get(target, property, receiver);
      }
    });

    await expect(run(llm, { provider: "deepseek-official" })).resolves.toContain("deepseek-flash");
    await expect(run(llm, { provider: "deepseek-official" })).resolves.toContain("deepseek-pro");
  });

  it("reports a model and marks its default reasoning effort", async () => {
    const llm = createLlm({ providers, models, details });

    await expect(run(llm, { provider: "deepseek-official", model: "deepseek-flash" }, new AbortController().signal))
      .resolves.toBe(
        "deepseek-official/deepseek-flash — DeepSeek Flash: Fast tier\n"
        + "Reasoning efforts:\n"
        + "low — Low\n"
        + "high (default) — High: Deeper reasoning"
      );
    expect(llm.calls.resolveModelInfo[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a model without advertised reasoning efforts", async () => {
    const llm = createLlm({ providers, details: { "deepseek-official/deepseek-pro": { id: "deepseek-pro", name: "DeepSeek Pro" } } });

    await expect(run(llm, { provider: "deepseek-official", model: "deepseek-pro" }))
      .resolves.toBe("deepseek-official/deepseek-pro — DeepSeek Pro\nReasoning efforts:\n(no advertised reasoning efforts)");
  });
});

describe("list_subagent_routes rejections", () => {
  it("requires a provider when a model is named", async () => {
    await expect(run(createLlm({ providers }), { model: "deepseek-flash" }))
      .rejects.toThrow("`model` requires `provider`");
  });

  it("rejects an empty provider", async () => {
    await expect(run(createLlm({ providers }), { provider: "" }))
      .rejects.toThrow("`provider` must be non-empty");
  });

  it("rejects an empty model", async () => {
    await expect(run(createLlm({ providers }), { provider: "deepseek-official", model: "" }))
      .rejects.toThrow("`model` must be non-empty");
  });

  it("names the requested and registered providers for an unknown one", async () => {
    await expect(run(createLlm({ providers }), { provider: "missing" }))
      .rejects.toThrow(
        'LLM provider "missing" is not registered; available providers: deepseek-official, openai-codex'
      );
  });

  it("rejects an argument the schema does not declare", async () => {
    await expect(run(createLlm({ providers }), { provider: "deepseek-official", unexpected_argument: true }))
      .rejects.toThrow("undeclared argument: unexpected_argument");
  });

  it("reports an unavailable LLM runtime", async () => {
    await expect(run(undefined))
      .rejects.toThrow("cannot discover child LLM routes because the `llm` service is unavailable");
  });
});
