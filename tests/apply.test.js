import { describe, expect, it } from "vitest";
import { apply, inject, name } from "../index.js";
import { createLlm, createSubagents, createTools } from "./helpers/fakes.js";

/** Minimal stand-in for the native discovery tool registered by DSH 0.2.2 presets. */
const nativeDiscovery = {
  name: "list_subagent_models",
  description: "native",
  parameters: { type: "object", properties: {} },
  output: { schema: { type: "string" }, render: () => [] },
  execute: async () => ""
};

/**
 * Build a host context for the plugin.
 * @param {object} [services] - injected service doubles.
 * @returns {object} host context double.
 */
function createContext(services = {}) {
  return {
    tools: services.tools ?? createTools(),
    llm: services.llm ?? createLlm(),
    subagents: services.subagents ?? createSubagents()
  };
}

describe("plugin wiring", () => {
  it("exposes the plugin identity and its injected services", () => {
    expect(name).toBe("subagent-model");
    expect(inject).toEqual(["tools", "subagents", "llm"]);
  });

  it("registers exactly the catalog and delegation tools", () => {
    const tools = createTools();
    apply(createContext({ tools }));

    expect(tools.definitions.map((definition) => definition.name).sort())
      .toEqual(["list_subagent_routes", "subagent_model"]);
  });

  it("never claims the native discovery name", () => {
    const tools = createTools();
    tools.register(nativeDiscovery);
    apply(createContext({ tools }));

    expect(tools.definitions.filter((definition) => definition.name === "list_subagent_models")).toHaveLength(1);
    expect(tools.definitions.filter((definition) => definition.name === "list_subagent_routes")).toHaveLength(1);
  });

  it("removes both tools when the owning registration is disposed", () => {
    const disposers = [];
    const tools = {
      definitions: [],
      register(definition) {
        this.definitions.push(definition);
        const dispose = () => {
          const index = this.definitions.indexOf(definition);
          if (index !== -1) this.definitions.splice(index, 1);
        };
        disposers.push(dispose);
        return dispose;
      }
    };
    apply(createContext({ tools }));

    expect(tools.definitions).toHaveLength(2);
    for (const dispose of disposers) dispose();
    expect(tools.definitions).toHaveLength(0);
  });
});
