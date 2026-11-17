import { describe, expect, it } from "vitest";
import { apply, inject, name } from "../index.js";
import {
  createAgent,
  createAgents,
  createEvents,
  createLlm,
  createSubagents,
  createSystemPrompt,
  createTools
} from "./helpers/fakes.js";

/** Host delegation tools the plugin masks while it is loaded. */
const NATIVE = ["subagent", "subagent_fork", "list_subagent_models", "workflow"];

/**
 * Build a host context for the plugin, with the cordis seams `apply` uses.
 * @param {object} [services] - injected service doubles.
 * @returns {{ ctx: object, effects: Function[], tools: object, events: object, agents: object, systemPrompt: object }} host fixture.
 */
function createContext(services = {}) {
  const events = services.events ?? createEvents();
  // The plugin-level fixture models the host too: every registry change notifies synchronously.
  const tools = services.tools ?? createTools({
    registered: NATIVE,
    onChange: () => events.emit("tools/change", {})
  });
  const agents = services.agents ?? createAgents();
  const systemPrompt = services.systemPrompt ?? createSystemPrompt();
  const effects = [];
  const ctx = {
    tools,
    llm: services.llm ?? createLlm(),
    subagents: services.subagents ?? createSubagents(),
    agents,
    systemPrompt,
    logger: services.logger ?? { warn() {} },
    on: events.on,
    effect(callback) {
      effects.push(callback());
    }
  };
  return { ctx, effects, tools, events, agents, systemPrompt };
}

describe("plugin wiring", () => {
  it("exposes the plugin identity and its injected services", () => {
    expect(name).toBe("subagent-model");
    expect(inject).toEqual(["tools", "subagents", "llm", "agents", "systemPrompt"]);
  });

  it("registers exactly the catalog and delegation tools", () => {
    const { ctx, tools } = createContext();
    apply(ctx);

    expect(tools.definitions.map((definition) => definition.name).sort())
      .toEqual(["list_subagent_routes", "subagent_model"]);
  });

  it("masks the host delegation surface and contributes the guidance", () => {
    const { ctx, tools, agents, systemPrompt } = createContext();
    const agent = createAgent({ id: "agent-1", tools });
    agents.add(agent);

    apply(ctx);

    for (const nativeName of NATIVE) expect(tools.get(nativeName, agent)).toBeUndefined();
    expect([...systemPrompt.sections.keys()]).toEqual(["subagent-model:delegation"]);
    expect([...systemPrompt.contexts.keys()]).toEqual(["subagent-model:depth"]);
  });

  it("never registers a native name of its own", () => {
    const { ctx, tools } = createContext();
    apply(ctx);

    for (const nativeName of NATIVE) {
      expect(tools.definitions.filter((definition) => definition.name === nativeName)).toHaveLength(0);
    }
    expect(tools.definitions.filter((definition) => definition.name === "list_subagent_routes")).toHaveLength(1);
  });

  it("releases the mask and the guidance when the owning fiber is disposed", () => {
    const { ctx, effects, tools, agents, systemPrompt } = createContext();
    const agent = createAgent({ id: "agent-1", tools });
    agents.add(agent);

    apply(ctx);
    expect(tools.get("subagent", agent)).toBeUndefined();

    for (const dispose of effects) dispose();

    expect(tools.get("subagent", agent)).toEqual({ name: "subagent" });
    expect(systemPrompt.sections.size).toBe(0);
    expect(systemPrompt.contexts.size).toBe(0);
  });

  it("removes both tools when their registrations are disposed", () => {
    const disposers = [];
    const tools = createTools({ registered: NATIVE });
    const register = tools.register.bind(tools);
    tools.register = (definition) => {
      const dispose = register(definition);
      disposers.push(dispose);
      return dispose;
    };
    const { ctx } = createContext({ tools });

    apply(ctx);
    expect(tools.definitions).toHaveLength(2);

    for (const dispose of disposers) dispose();
    expect(tools.definitions).toHaveLength(0);
  });

  it("accepts configured backends and rejects an invalid configuration", () => {
    const { ctx, tools } = createContext();
    apply(ctx, { backends: { fresh: "spawn", inherit: "fork" } });
    expect(tools.definitions).toHaveLength(2);

    const invalid = createContext();
    expect(() => apply(invalid.ctx, { backends: { fresh: "" } }))
      .toThrow("backends.fresh must be a non-empty string");
  });
});
