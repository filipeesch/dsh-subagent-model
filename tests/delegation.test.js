import { describe, expect, it } from "vitest";
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
function setup({ agent = createAgent(), llm = createLlm(), subagents = createSubagents(), contextModes } = {}) {
  return {
    tool: createDelegationTool({
      llm,
      subagents,
      ...(contextModes === undefined ? {} : { contextModes })
    }),
    llm,
    subagents,
    agent
  };
}

describe("subagent_model definition", () => {
  it("requires the task and the model, without a background switch", () => {
    const { tool } = setup();

    expect(tool.name).toBe("subagent_model");
    expect(tool.parameters.required).toEqual(["description", "prompt", "model"]);
    expect(Object.keys(tool.parameters.properties).sort())
      .toEqual(["cwd", "description", "inherit_context", "model", "prompt", "provider", "reasoning_effort"]);
    expect(tool.parameters.properties.inherit_context.type).toBe("boolean");
    expect(tool.parameters.required).not.toContain("inherit_context");
    expect(tool.parameters.properties.run_in_background).toBeUndefined();
    expect(tool.output.schema.properties.kind.const).toBe("activation");
    expect(tool.output.render({}, { kind: "activation", subagentId: "child-1" }))
      .toEqual([{ type: "text", text: "started subagent child-1" }]);
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

    expect(result).toEqual({ kind: "activation", subagentId: "child-1" });
    expect(subagents.calls.startActivation).toHaveLength(1);
    expect(subagents.calls.startActivation).toEqual([{
      provider: backend,
      label: "review the diff",
      request: {
        prompt: [{ type: "text", text: "Review the staged diff." }],
        parent: agent,
        agentOptions: { provider: "openai-codex", model: "gpt-6.1-sol", reasoningEffort: "high" },
        maxDepth: 1,
        cwd: "/tmp/work"
      },
      signal,
      delivery: "parent"
    }]);
    expect(subagents.calls.getProvider).toEqual([backend, backend]);
    expect(subagents.calls.resolveMaxDepth).toBe(1);
  });

  it.each(modes)("uses the exact calling agent as the activation parent (inherit_context=$name)", async ({ args }) => {
    const immediate = createAgent({ id: "agent-nested" });
    const { tool, subagents } = setup({ agent: immediate });

    await tool.execute({ description: "d", prompt: "p", model: "m", ...args }, createExec({ agent: immediate }));

    expect(subagents.calls.startActivation[0].request.parent).toBe(immediate);
    expect(subagents.calls.startActivation[0].request.parent.id).toBe("agent-nested");
  });

  it.each(modes)("forwards the Host depth limit (inherit_context=$name)", async ({ args }) => {
    const subagents = createSubagents({ maxDepth: 4 });
    const { tool, agent } = setup({ subagents });

    await tool.execute({ description: "d", prompt: "p", model: "m", ...args }, createExec({ agent }));

    expect(subagents.calls.startActivation[0].request.maxDepth).toBe(4);
    expect(subagents.calls.resolveMaxDepth).toBe(1);
  });

  it.each(modes)("omits the depth limit when the Host delegates it to the provider (inherit_context=$name)", async ({ args }) => {
    const subagents = createSubagents({ maxDepth: undefined });
    const { tool, agent } = setup({ subagents });

    await tool.execute({ description: "d", prompt: "p", model: "m", ...args }, createExec({ agent }));

    expect(subagents.calls.startActivation[0].request).not.toHaveProperty("maxDepth");
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

  it("defaults the provider to the calling agent's live route", async () => {
    const agent = createAgent({ options: { provider: "created", model: "created" }, header: { provider: "live", model: "live" } });
    const { tool, subagents } = setup({ agent });

    await tool.execute({ description: "d", prompt: "p", model: "requested" }, createExec({ agent }));

    expect(subagents.calls.startActivation[0].request.agentOptions)
      .toEqual({ provider: "live", model: "requested" });
  });

  it("omits the working directory and effort when they are not requested", async () => {
    const { tool, subagents, agent } = setup();

    await tool.execute({ description: "d", prompt: "p", model: "m" }, createExec({ agent }));

    const spec = subagents.calls.startActivation[0];
    expect(spec.request).not.toHaveProperty("cwd");
    expect(spec.request.agentOptions).toEqual({ provider: "parent-provider", model: "m" });
  });

  it("requires a calling agent", async () => {
    const { tool, subagents } = setup();

    await expect(tool.execute({ description: "d", prompt: "p", model: "m" }, createExec()))
      .rejects.toThrow("subagent_model requires a calling agent (exec.agent was undefined)");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it("rejects an empty description, prompt, or working directory", async () => {
    const { tool, agent } = setup();

    await expect(tool.execute({ description: "", prompt: "p", model: "m" }, createExec({ agent })))
      .rejects.toThrow("`description` must be a non-empty string");
    await expect(tool.execute({ description: "d", prompt: "", model: "m" }, createExec({ agent })))
      .rejects.toThrow("`prompt` must be a non-empty string");
    await expect(tool.execute({ description: "d", prompt: "p", model: "m", cwd: "" }, createExec({ agent })))
      .rejects.toThrow("`cwd` must be a non-empty string");
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

  it.each(modes)("rejects a model the provider cannot resolve before starting a child (inherit_context=$name)", async ({ args }) => {
    const llm = createLlm({
      resolveCallConfig: async () => { throw new Error("unknown model"); }
    });
    const { tool, subagents, agent } = setup({ llm });

    await expect(tool.execute({
      description: "d",
      prompt: "p",
      provider: "p",
      model: "missing",
      ...args
    }, createExec({ agent }))).rejects.toThrow('model "missing" is not available on provider "p": unknown model');
    expect(subagents.calls.startActivation).toHaveLength(0);
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
