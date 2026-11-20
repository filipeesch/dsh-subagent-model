import { describe, expect, it } from "vitest";
import { resolveConfig } from "../lib/config.js";
import { createDelegationTool } from "../lib/delegation.js";
import { createAgent, createExec, createLlm, createSubagents } from "./helpers/fakes.js";

/** Context-mode matrix: omitted and false stay fresh; true inherits. */
const modes = [
  { name: "omitted", args: {}, backend: "spawn" },
  { name: "false", args: { inherit_context: false }, backend: "spawn" },
  { name: "true", args: { inherit_context: true }, backend: "fork" }
];

/**
 * Build the delegation tool over fresh doubles.
 * @param {object} [options] - agent, LLM, subagent, and registry overrides.
 * @returns {{ tool: object, llm: object, subagents: object, agent: object }}
 */
function setup({ agent = createAgent(), llm = createLlm(), subagents = createSubagents(), modelPin, contextModes } = {}) {
  return {
    tool: createDelegationTool({
      llm,
      subagents,
      ...(modelPin === undefined ? {} : { modelPin }),
      ...(contextModes === undefined ? {} : { contextModes })
    }),
    llm,
    subagents,
    agent
  };
}

describe("subagent_model definition", () => {
  it("requires the task, leaves the model optional, and has no background switch", () => {
    const { tool } = setup();

    expect(tool.name).toBe("subagent_model");
    expect(tool.parameters.required).toEqual(["description", "prompt"]);
    expect(Object.keys(tool.parameters.properties).sort())
      .toEqual(["cwd", "description", "inherit_context", "model", "name", "prompt", "provider", "reasoning_effort"]);
    expect(tool.parameters.properties.inherit_context.type).toBe("boolean");
    expect(tool.parameters.required).not.toContain("inherit_context");
    expect(tool.parameters.required).not.toContain("name");
    expect(tool.parameters.properties.run_in_background).toBeUndefined();
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.output.schema.properties.kind.const).toBe("activation");
    expect(tool.output.schema.required).toEqual(["kind", "subagentId", "name"]);
    expect(tool.output.schema.additionalProperties).toBe(false);
    expect(tool.output.render({}, { kind: "activation", subagentId: "child-1", name: "verifier" }))
      .toEqual([{ type: "text", text: "started subagent verifier (child-1)" }]);
    expect(tool.isConcurrencySafe()).toBe(true);
  });

  it("documents both context modes and the inherited-context trade-offs", () => {
    const { tool } = setup();
    const properties = tool.parameters.properties;

    expect(tool.description).toContain("fresh context");
    expect(tool.description).toContain("inherit_context: true");
    expect(tool.description).toContain("completed turns");
    expect(tool.description).toContain("in-flight turn");
    expect(tool.description).toContain("selected provider");
    expect(tool.description).toContain("inherited prefix");
    expect(properties.prompt.description).toContain("inherit_context: true");
    expect(properties.prompt.description).toContain("include everything it needs");
    expect(properties.inherit_context.description).toContain("completed turns");
    expect(properties.inherit_context.description).toContain("in-flight");
    expect(properties.inherit_context.description).toContain("selected provider");
    expect(properties.inherit_context.description).toContain("prefix");
  });

  it("keeps inherit_context in the schema when the fork backend is absent", () => {
    const { tool } = setup({ subagents: createSubagents({ providers: { fork: null } }) });

    expect(tool.parameters.properties.inherit_context.type).toBe("boolean");
  });
});

describe("subagent_model delegation", () => {
  it.each(modes)("starts one parent-delivered activation on the $backend backend (inherit_context=$name)", async ({ args, backend }) => {
    const { tool, subagents, agent } = setup();
    const signal = new AbortController().signal;

    const result = await tool.execute({
      description: "review the diff",
      prompt: "Review the staged diff.",
      provider: "openai-codex",
      model: "gpt-6.1-sol",
      reasoning_effort: "high",
      cwd: "/tmp/work",
      ...args
    }, createExec({ agent, signal }));

    expect(result).toEqual({
      kind: "activation",
      subagentId: "child-1",
      name: "agent-1",
      reasoningEffort: "high"
    });
    expect(subagents.calls.startActivation).toHaveLength(1);
    expect(subagents.calls.startActivation).toEqual([{
      provider: backend,
      prompt: [{ type: "text", text: "Review the staged diff." }],
      parent: agent,
      agentOptions: { provider: "openai-codex", model: "gpt-6.1-sol", reasoningEffort: "high" },
      maxDepth: 1,
      cwd: "/tmp/work",
      label: "review the diff",
      signal,
      delivery: "parent"
    }]);
    expect(subagents.calls.startActivation[0]).not.toHaveProperty("request");
    expect(subagents.calls.getProvider).toEqual([backend, backend]);
    expect(subagents.calls.resolveMaxDepth).toBe(1);
  });

  it.each(modes)("uses the exact calling agent as the activation parent (inherit_context=$name)", async ({ args }) => {
    const immediate = createAgent({ id: "agent-nested" });
    const { tool, subagents } = setup({ agent: immediate });

    await tool.execute({ description: "d", prompt: "p", model: "m", ...args }, createExec({ agent: immediate }));

    expect(subagents.calls.startActivation[0].parent).toBe(immediate);
    expect(subagents.calls.startActivation[0].parent.id).toBe("agent-nested");
  });

  it.each(modes)("forwards the Host depth limit (inherit_context=$name)", async ({ args }) => {
    const subagents = createSubagents({ maxDepth: 4 });
    const { tool, agent } = setup({ subagents });

    await tool.execute({ description: "d", prompt: "p", model: "m", ...args }, createExec({ agent }));

    expect(subagents.calls.startActivation[0].maxDepth).toBe(4);
    expect(subagents.calls.resolveMaxDepth).toBe(1);
  });

  it.each(modes)("omits the depth limit when the Host delegates it to the provider (inherit_context=$name)", async ({ args }) => {
    const subagents = createSubagents({ maxDepth: undefined });
    const { tool, agent } = setup({ subagents });

    await tool.execute({ description: "d", prompt: "p", model: "m", ...args }, createExec({ agent }));

    expect(subagents.calls.startActivation[0]).not.toHaveProperty("maxDepth");
  });

  it.each([
    { name: "omitted", args: {} },
    { name: "false", args: { inherit_context: false } }
  ])("fails loud when the fresh backend is not mounted (inherit_context=$name)", async ({ args }) => {
    const subagents = createSubagents({ providers: { spawn: null } });
    const { tool, agent } = setup({ subagents });

    await expect(tool.execute({ description: "d", prompt: "p", model: "m", ...args }, createExec({ agent })))
      .rejects.toThrow('inherit_context=false requires the subagent backend "spawn", which is not registered in this composition');
    expect(subagents.calls.startActivation).toHaveLength(0);
    expect(subagents.calls.getProvider).toEqual(["spawn"]);
  });

  it("fails loud when the inherit backend is not mounted", async () => {
    const subagents = createSubagents({ providers: { fork: null } });
    const { tool, agent } = setup({ subagents });

    await expect(tool.execute({ description: "d", prompt: "p", model: "m", inherit_context: true }, createExec({ agent })))
      .rejects.toThrow('inherit_context=true requires the subagent backend "fork", which is not registered in this composition');
    expect(subagents.calls.startActivation).toHaveLength(0);
    expect(subagents.calls.getProvider).toEqual(["fork"]);
  });

  it("fails loud on a host without managed activations", async () => {
    const tool = createDelegationTool({
      llm: createLlm(),
      subagents: { getProvider: () => ({ name: "spawn" }), resolveMaxDepth: () => 1 }
    });

    await expect(tool.execute({ description: "d", prompt: "p", model: "m" }, createExec({ agent: createAgent() })))
      .rejects.toThrow("subagent_model requires managed activations");
  });

  it.each([
    { name: "omitted", args: {} },
    { name: "false", args: { inherit_context: false } },
    { name: "true", args: { inherit_context: true } }
  ])("delegates on the calling agent's route when the model is omitted (inherit_context=$name)", async ({ args }) => {
    const agent = createAgent({ header: { provider: "live", model: "live" } });
    const { tool, subagents } = setup({ agent });

    await tool.execute({ description: "d", prompt: "p", ...args }, createExec({ agent }));

    expect(subagents.calls.startActivation).toHaveLength(1);
    expect(subagents.calls.startActivation[0].agentOptions).toEqual({ provider: "live", model: "live" });
  });

  it.each(modes)("rejects a reasoning effort without a model (inherit_context=$name)", async ({ args }) => {
    const { tool, subagents, agent } = setup();

    await expect(tool.execute(
      { description: "d", prompt: "p", reasoning_effort: "high", ...args },
      createExec({ agent })
    )).rejects.toThrow("`reasoning_effort` requires `model`; supply both or omit `reasoning_effort`");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it("defaults the provider to the calling agent's live route", async () => {
    const agent = createAgent({ options: { provider: "created", model: "created" }, header: { provider: "live", model: "live" } });
    const { tool, subagents } = setup({ agent });

    await tool.execute({ description: "d", prompt: "p", model: "requested" }, createExec({ agent }));

    expect(subagents.calls.startActivation[0].agentOptions)
      .toEqual({ provider: "live", model: "requested" });
  });

  it("omits the working directory and effort when they are not requested", async () => {
    const { tool, subagents, agent } = setup();

    await tool.execute({ description: "d", prompt: "p", model: "m" }, createExec({ agent }));

    const spec = subagents.calls.startActivation[0];
    expect(spec).not.toHaveProperty("cwd");
    expect(spec).not.toHaveProperty("name");
    expect(spec.agentOptions).toEqual({ provider: "parent-provider", model: "m" });
  });

  it("forwards the requested child name and reports the host-resolved one", async () => {
    const { tool, subagents, agent } = setup();

    const result = await tool.execute(
      { description: "d", prompt: "p", model: "m", name: "verifier" },
      createExec({ agent })
    );

    expect(subagents.calls.startActivation[0].name).toBe("verifier");
    expect(result).toEqual({ kind: "activation", subagentId: "child-1", name: "agent-1" });
  });

  it("reports the host-assigned name when no name is requested", async () => {
    const subagents = createSubagents({ childName: () => "verifier" });
    const { tool, agent } = setup({ subagents });

    const result = await tool.execute({ description: "d", prompt: "p", model: "m" }, createExec({ agent }));

    expect(result.name).toBe("verifier");
    expect(result.subagentId).toBe("child-1");
  });

  it("rejects an argument the schema does not declare", async () => {
    const { tool, subagents, agent } = setup();

    await expect(tool.execute(
      { description: "d", prompt: "p", model: "m", unexpected_argument: true },
      createExec({ agent })
    )).rejects.toThrow("undeclared argument: unexpected_argument");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it("requires a calling agent", async () => {
    const { tool, subagents } = setup();

    await expect(tool.execute({ description: "d", prompt: "p", model: "m" }, createExec()))
      .rejects.toThrow("subagent_model requires a calling agent (exec.agent was undefined)");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it("rejects an empty description, prompt, name, or working directory", async () => {
    const { tool, subagents, agent } = setup();

    await expect(tool.execute({ description: "", prompt: "p", model: "m" }, createExec({ agent })))
      .rejects.toThrow("`description` must be a non-empty string");
    await expect(tool.execute({ description: "d", prompt: "", model: "m" }, createExec({ agent })))
      .rejects.toThrow("`prompt` must be a non-empty string");
    await expect(tool.execute({ description: "d", prompt: "p", model: "m", cwd: "" }, createExec({ agent })))
      .rejects.toThrow("`cwd` must be a non-empty string");
    await expect(tool.execute({ description: "d", prompt: "p", model: "m", name: "" }, createExec({ agent })))
      .rejects.toThrow("`name` must be a non-empty string");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it("rejects a non-boolean inherit_context before resolving a backend", async () => {
    const { tool, subagents, agent } = setup();

    await expect(tool.execute({ description: "d", prompt: "p", model: "m", inherit_context: "yes" }, createExec({ agent })))
      .rejects.toThrow("`inherit_context` must be a boolean");
    expect(subagents.calls.getProvider).toHaveLength(0);
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it("fails loud when the inherit backend does not declare inheritance", async () => {
    const subagents = createSubagents({
      providers: { fork: { name: "fork", inheritsParentContext: false, capabilities: { agentOptions: true } } }
    });
    const { tool, agent } = setup({ subagents });

    await expect(tool.execute({ description: "d", prompt: "p", model: "m", inherit_context: true }, createExec({ agent })))
      .rejects.toThrow("does not satisfy the inheritance contract");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it("fails loud when the inherit backend cannot accept child agent options", async () => {
    const subagents = createSubagents({
      providers: { fork: { name: "fork", inheritsParentContext: true, capabilities: { agentOptions: false } } }
    });
    const { tool, agent } = setup({ subagents });

    await expect(tool.execute({ description: "d", prompt: "p", model: "m", inherit_context: true }, createExec({ agent })))
      .rejects.toThrow("cannot accept the child `agentOptions`");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it("fails loud when the fresh backend declares inheritance", async () => {
    const subagents = createSubagents({
      providers: { spawn: { name: "spawn", inheritsParentContext: true, capabilities: { agentOptions: true } } }
    });
    const { tool, agent } = setup({ subagents });

    await expect(tool.execute({ description: "d", prompt: "p", model: "m" }, createExec({ agent })))
      .rejects.toThrow("does not satisfy the fresh-context contract");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it.each([
    { name: "fresh to inheriting", inheritContext: false, backend: "spawn", replacementInherits: true, contract: "fresh-context" },
    { name: "inheriting to fresh", inheritContext: true, backend: "fork", replacementInherits: false, contract: "inheritance" }
  ])("revalidates the backend contract after route resolution ($name)", async ({ inheritContext, backend, replacementInherits, contract }) => {
    const subagents = createSubagents();
    const llm = createLlm({
      resolveCallConfig: async (config) => {
        subagents.setProvider(backend, {
          name: backend,
          inheritsParentContext: replacementInherits,
          capabilities: { agentOptions: true }
        });
        return config;
      }
    });
    const { tool, agent } = setup({ subagents, llm });

    await expect(tool.execute({
      description: "d",
      prompt: "p",
      model: "m",
      inherit_context: inheritContext
    }, createExec({ agent }))).rejects.toThrow("does not satisfy the " + contract + " contract");
    expect(subagents.calls.startActivation).toHaveLength(0);
    expect(subagents.calls.getProvider).toEqual([backend, backend]);
    expect(subagents.calls.setProvider).toEqual([backend]);
  });

  it("uses an injected context-mode registry", async () => {
    const subagents = createSubagents({
      providers: {
        "custom-spawn": {
          name: "custom-spawn",
          inheritsParentContext: false,
          capabilities: { agentOptions: true }
        }
      }
    });
    const contextModes = {
      fresh: { provider: "custom-spawn", inheritsParentContext: false },
      inherit: { provider: "fork", inheritsParentContext: true }
    };
    const { tool, agent } = setup({ subagents, contextModes });

    await tool.execute({ description: "d", prompt: "p", model: "m" }, createExec({ agent }));

    expect(subagents.calls.startActivation[0].provider).toBe("custom-spawn");
  });

  it("honors the configured backends resolved from the plugin configuration", async () => {
    const subagents = createSubagents({
      providers: {
        "custom-spawn": {
          name: "custom-spawn",
          inheritsParentContext: false,
          capabilities: { agentOptions: true }
        }
      }
    });
    const { contextModes } = resolveConfig({ backends: { fresh: "custom-spawn" } });
    const { tool, agent } = setup({ subagents, contextModes });

    await tool.execute({ description: "d", prompt: "p", model: "m" }, createExec({ agent }));

    expect(subagents.calls.startActivation[0].provider).toBe("custom-spawn");
  });

  it("forwards the calling agent's effort when the model is omitted", async () => {
    const agent = createAgent({ header: { provider: "live", model: "live", reasoningEffort: "high" } });
    const { tool, subagents } = setup({ agent });

    await tool.execute({ description: "d", prompt: "p" }, createExec({ agent }));

    expect(subagents.calls.startActivation[0].agentOptions)
      .toEqual({ provider: "live", model: "live", reasoningEffort: "high" });
  });

  it("omits the effective effort from the result when the route has none", async () => {
    const { tool, agent } = setup();

    const result = await tool.execute({ description: "d", prompt: "p", model: "m" }, createExec({ agent }));

    expect(result).not.toHaveProperty("reasoningEffort");
  });

  it("starts the child with the model default when the effort is not offered", async () => {
    const llm = createLlm({
      resolveCallConfig: async (config) => {
        if (config.reasoningEffort !== undefined) {
          const error = new Error("effort not supported");
          error.code = "UNSUPPORTED_REASONING_EFFORT";
          throw error;
        }
        return { ...config, reasoningEffort: "high" };
      }
    });
    const { tool, subagents, agent } = setup({ llm });

    const result = await tool.execute({
      description: "d",
      prompt: "p",
      provider: "p",
      model: "m",
      reasoning_effort: "max"
    }, createExec({ agent }));

    expect(result).toEqual({
      kind: "activation",
      subagentId: "child-1",
      name: "agent-1",
      reasoningEffort: "high"
    });
    expect(subagents.calls.startActivation[0].agentOptions)
      .toEqual({ provider: "p", model: "m", reasoningEffort: "high" });
  });

  it("does not carry the parent effort into a same-route child that resolved none", async () => {
    const llm = createLlm({ resolveCallConfig: async (config) => config });
    const agent = createAgent({
      header: { provider: "parent-provider", model: "same-model", reasoningEffort: "high" }
    });
    const { tool, subagents } = setup({ llm, agent });

    const result = await tool.execute({
      description: "d",
      prompt: "p",
      provider: "parent-provider",
      model: "same-model"
    }, createExec({ agent }));

    // The host would keep the parent effort when the route did not change, but this plugin never
    // validated `high` for the supplied model, so the activation states the cleared effort and the
    // result omits it rather than advertising something the child does not run with.
    expect(subagents.calls.startActivation[0].agentOptions)
      .toStrictEqual({ provider: "parent-provider", model: "same-model", reasoningEffort: undefined });
    expect(Object.hasOwn(subagents.calls.startActivation[0].agentOptions, "reasoningEffort")).toBe(true);
    expect(result).not.toHaveProperty("reasoningEffort");
  });

  it("clears an explicitly rejected same-route effort whose retry resolves no default", async () => {
    const llm = createLlm({
      resolveCallConfig: async (config) => {
        if (config.reasoningEffort !== undefined) {
          const error = new Error("effort not supported");
          error.code = "UNSUPPORTED_REASONING_EFFORT";
          throw error;
        }
        return config;
      }
    });
    const agent = createAgent({
      header: { provider: "parent-provider", model: "same-model", reasoningEffort: "high" }
    });
    const { tool, subagents } = setup({ llm, agent });

    const result = await tool.execute({
      description: "d",
      prompt: "p",
      provider: "parent-provider",
      model: "same-model",
      reasoning_effort: "max"
    }, createExec({ agent }));

    // `max` was rejected and the retry declared no default, so neither the rejected effort nor the
    // unvalidated parent `high` may reach the child.
    expect(subagents.calls.startActivation[0].agentOptions)
      .toStrictEqual({ provider: "parent-provider", model: "same-model", reasoningEffort: undefined });
    expect(result).not.toHaveProperty("reasoningEffort");
  });

  it("keeps the parent effort when the route is inherited", async () => {
    const llm = createLlm({ resolveCallConfig: async (config) => config });
    const agent = createAgent({
      header: { provider: "parent-provider", model: "parent-model", reasoningEffort: "high" }
    });
    const { tool, subagents } = setup({ llm, agent });

    const result = await tool.execute({ description: "d", prompt: "p" }, createExec({ agent }));

    expect(subagents.calls.startActivation[0].agentOptions)
      .toEqual({ provider: "parent-provider", model: "parent-model", reasoningEffort: "high" });
    expect(result.reasoningEffort).toBe("high");
  });

  it("uses the model default for an omitted effort, not the parent effort", async () => {
    const llm = createLlm({ resolveCallConfig: async (config) => ({ ...config, reasoningEffort: "low" }) });
    const agent = createAgent({
      header: { provider: "parent-provider", model: "parent-model", reasoningEffort: "high" }
    });
    const { tool, subagents } = setup({ llm, agent });

    const result = await tool.execute({
      description: "d",
      prompt: "p",
      provider: "other-provider",
      model: "other-model"
    }, createExec({ agent }));

    expect(subagents.calls.startActivation[0].agentOptions)
      .toEqual({ provider: "other-provider", model: "other-model", reasoningEffort: "low" });
    expect(result.reasoningEffort).toBe("low");
  });

  it("drops the parent effort when the route changed and none was requested", async () => {
    const llm = createLlm({ resolveCallConfig: async (config) => config });
    const agent = createAgent({
      header: { provider: "parent-provider", model: "parent-model", reasoningEffort: "high" }
    });
    const { tool, subagents } = setup({ llm, agent });

    const result = await tool.execute({
      description: "d",
      prompt: "p",
      provider: "other-provider",
      model: "other-model"
    }, createExec({ agent }));

    expect(subagents.calls.startActivation[0].agentOptions)
      .toEqual({ provider: "other-provider", model: "other-model" });
    expect(result).not.toHaveProperty("reasoningEffort");
  });
  it("renders the effective effort alongside the child identity", () => {
    const { tool } = setup();

    expect(tool.output.render({}, {
      kind: "activation",
      subagentId: "child-1",
      name: "verifier",
      reasoningEffort: "high"
    })).toEqual([{ type: "text", text: "started subagent verifier (child-1) on reasoning effort high" }]);
  });

  it.each(modes)("propagates the adapter failure before starting a child (inherit_context=$name)", async ({ args }) => {
    const failure = new Error("unknown model");
    const llm = createLlm({
      resolveCallConfig: async () => { throw failure; }
    });
    const { tool, subagents, agent } = setup({ llm });

    const thrown = await tool.execute({
      description: "d",
      prompt: "p",
      provider: "p",
      model: "missing",
      ...args
    }, createExec({ agent })).catch((error) => error);

    expect(thrown).toBe(failure);
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it.each(modes)("rejects a model the provider does not advertise (inherit_context=$name)", async ({ args }) => {
    const llm = createLlm({
      providers: [{ id: "p", name: "p" }],
      models: { p: [{ id: "real-model", name: "Real" }] }
    });
    const { tool, subagents, agent } = setup({ llm });

    const thrown = await tool.execute({
      description: "d",
      prompt: "p",
      provider: "p",
      model: "p/real-model",
      ...args
    }, createExec({ agent })).catch((error) => error);

    expect(thrown.message).toContain("`model` is not one of the ids provider");
    expect(thrown.message).not.toContain("p/real-model");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it.each(modes)("gives an unregistered provider an actionable message (inherit_context=$name)", async ({ args }) => {
    const llm = createLlm({
      resolveCallConfig: async () => {
        const error = new Error("No adapter registered for provider nope");
        error.code = "NO_ADAPTER";
        throw error;
      }
    });
    const { tool, subagents, agent } = setup({ llm });

    const thrown = await tool.execute({
      description: "d",
      prompt: "p",
      provider: "nope",
      model: "m",
      ...args
    }, createExec({ agent })).catch((error) => error);

    expect(thrown.code).toBe("NO_ADAPTER");
    expect(thrown.message).toContain("is not registered on this host");
    expect(thrown.message).toContain("list_subagent_routes");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it("does not reserve a child id for an external backend", async () => {
    // An external backend has no `prepareContinuable`, so the host rejects a reserved id. The
    // delegation must leave it on the ordinary activation path instead of regressing it.
    const subagents = createSubagents({
      providers: {
        "external-inherit": {
          name: "external-inherit",
          inheritsParentContext: true,
          start: async () => ({}),
          capabilities: { agentOptions: true }
        }
      }
    });
    // The configured inheriting backend is the external one, which is what the composition would
    // point at when it does not ship a local fork.
    const contextModes = {
      fresh: { provider: "spawn", inheritsParentContext: false },
      inherit: { provider: "external-inherit", inheritsParentContext: true }
    };
    const modelPin = { register: () => { throw new Error("must not reserve"); }, settle: () => false };
    const { tool } = setup({ subagents, modelPin, contextModes });

    await tool.execute({ description: "d", prompt: "p", model: "m", inherit_context: true }, createExec({ agent: createAgent() }));

    expect(subagents.calls.startActivation[0]).not.toHaveProperty("childId");
  });

  it("reserves a child id for a seeded local backend and reports the pinned route", async () => {
    const registered = [];
    const modelPin = {
      register: (id, route) => registered.push({ id, route }),
      // The created listener is what applies the selection, so a successful start settles true.
      settle: () => true
    };
    const { tool, subagents, agent } = setup({ modelPin });

    await tool.execute({ description: "d", prompt: "p", model: "m", inherit_context: true }, createExec({ agent }));

    expect(registered).toHaveLength(1);
    expect(subagents.calls.startActivation[0].childId).toBe(registered[0].id);
  });

  it("does not reserve for a fresh child, which records no selection", async () => {
    const modelPin = { register: () => { throw new Error("must not reserve"); }, settle: () => false };
    const { tool, subagents, agent } = setup({ modelPin });

    await tool.execute({ description: "d", prompt: "p", model: "m" }, createExec({ agent }));

    expect(subagents.calls.startActivation[0]).not.toHaveProperty("childId");
  });

  it("fails and disposes a seeded child created without taking its pinned route", async () => {
    const disposed = [];
    const modelPin = { register: () => {}, settle: () => false };
    const subagents = createSubagents();
    subagents.startActivation = async (spec) => {
      subagents.calls.startActivation.push(spec);
      return { childId: "child-1", name: "agent-1", dispose: async () => { disposed.push("child-1"); } };
    };
    const { tool } = setup({ subagents, modelPin });

    // The child is already live and may be working on the wrong route, so it must be stopped
    // before the caller retries and leaves a second copy running.
    await expect(tool.execute({ description: "d", prompt: "p", model: "m", inherit_context: true }, createExec({ agent: createAgent() })))
      .rejects.toThrow("could not be confirmed on the route this call resolved");
    expect(subagents.calls.startActivation).toHaveLength(1);
    expect(disposed).toEqual(["child-1"]);
  });

  it("keeps the pin failure when disposal also fails", async () => {
    const modelPin = { register: () => {}, settle: () => false };
    const subagents = createSubagents();
    subagents.startActivation = async (spec) => {
      subagents.calls.startActivation.push(spec);
      return {
        childId: "child-1",
        name: "agent-1",
        dispose: async () => { throw new Error("teardown failed"); }
      };
    };
    const { tool } = setup({ subagents, modelPin });

    const thrown = await tool.execute({ description: "d", prompt: "p", model: "m", inherit_context: true }, createExec({ agent: createAgent() }))
      .catch((error) => error);

    expect(thrown.message).toContain("could not be confirmed on the route this call resolved");
    // Termination was not confirmed, so the message must name the child and not suggest a retry.
    expect(thrown.message).toContain("termination is unconfirmed rather than known");
    expect(thrown.message).toContain("child-1");
    expect(thrown.message).not.toContain("the call stopped it");
    expect(thrown.cause?.message).toBe("teardown failed");
  });

  it("releases the reservation when the start fails", async () => {
    const settled = [];
    const modelPin = { register: () => {}, settle: (id) => { settled.push(id); return false; } };
    const subagents = createSubagents();
    subagents.startActivation = async () => { throw new Error("start refused"); };
    const { tool } = setup({ subagents, modelPin });

    await expect(tool.execute({ description: "d", prompt: "p", model: "m", inherit_context: true }, createExec({ agent: createAgent() })))
      .rejects.toThrow("start refused");
    expect(settled).toHaveLength(1);
  });
  it("rejects a provider without a model", async () => {
    const { tool, subagents, agent } = setup();

    await expect(tool.execute({ description: "d", prompt: "p", provider: "p" }, createExec({ agent })))
      .rejects.toThrow("`provider` and `model` must be supplied together");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it.each(modes)("does not start a child when the call is cancelled during route validation (inherit_context=$name)", async ({ args }) => {
    const controller = new AbortController();
    controller.abort();
    const llm = createLlm({
      resolveCallConfig: async () => { throw new Error("aborted"); }
    });
    const { tool, subagents, agent } = setup({ llm });

    await expect(tool.execute({
      description: "d",
      prompt: "p",
      model: "m",
      ...args
    }, createExec({ agent, signal: controller.signal }))).rejects.toThrow("aborted");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it.each(modes)("does not start a child when aborted after route resolution (inherit_context=$name)", async ({ args }) => {
    const controller = new AbortController();
    const llm = createLlm({
      resolveCallConfig: async (config) => {
        controller.abort();
        return config;
      }
    });
    const { tool, subagents, agent } = setup({ llm });

    await expect(tool.execute({
      description: "d",
      prompt: "p",
      model: "m",
      ...args
    }, createExec({ agent, signal: controller.signal }))).rejects.toThrow(/abort/i);
    expect(subagents.calls.startActivation).toHaveLength(0);
  });
});
