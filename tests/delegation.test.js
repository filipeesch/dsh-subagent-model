import { describe, expect, it } from "vitest";
import { createDelegationTool } from "../lib/delegation.js";
import { createAgent, createExec, createLlm, createSubagents } from "./helpers/fakes.js";

/**
 * Build the delegation tool over fresh doubles.
 * @param {object} [options] - agent and LLM overrides.
 * @returns {{ tool: object, llm: object, subagents: object, agent: object }}
 */
function setup({ agent = createAgent(), llm = createLlm(), subagents = createSubagents() } = {}) {
  return { tool: createDelegationTool({ llm, subagents }), llm, subagents, agent };
}

describe("subagent_model definition", () => {
  it("requires the task and the model, without a background switch", () => {
    const { tool } = setup();

    expect(tool.name).toBe("subagent_model");
    expect(tool.parameters.required).toEqual(["description", "prompt", "model"]);
    expect(Object.keys(tool.parameters.properties).sort())
      .toEqual(["cwd", "description", "model", "prompt", "provider", "reasoning_effort"]);
    expect(tool.parameters.properties.run_in_background).toBeUndefined();
    expect(tool.output.schema.properties.kind.const).toBe("activation");
    expect(tool.output.render({}, { kind: "activation", subagentId: "child-1" }))
      .toEqual([{ type: "text", text: "started subagent child-1" }]);
    expect(tool.isConcurrencySafe()).toBe(true);
  });
});

describe("subagent_model delegation", () => {
  it("starts one parent-delivered activation with the selected route", async () => {
    const { tool, subagents, agent } = setup();
    const signal = new AbortController().signal;

    const result = await tool.execute({
      description: "review the diff",
      prompt: "Review the staged diff.",
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
      cwd: "/tmp/work"
    }, createExec({ agent, signal }));

    expect(result).toEqual({ kind: "activation", subagentId: "child-1" });
    expect(subagents.calls.startActivation).toEqual([{
      provider: "spawn",
      label: "review the diff",
      request: {
        prompt: [{ type: "text", text: "Review the staged diff." }],
        parent: agent,
        agentOptions: { provider: "openai-codex", model: "gpt-5.6-sol", reasoningEffort: "high" },
        cwd: "/tmp/work"
      },
      signal,
      delivery: "parent"
    }]);
    expect(subagents.calls.startActivation[0].request).not.toHaveProperty("maxDepth");
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

  it("rejects a model the provider cannot resolve before starting a child", async () => {
    const llm = createLlm({
      resolveCallConfig: async () => { throw new Error("unknown model"); }
    });
    const { tool, subagents, agent } = setup({ llm });

    await expect(tool.execute({ description: "d", prompt: "p", provider: "p", model: "missing" }, createExec({ agent })))
      .rejects.toThrow('model "missing" is not available on provider "p": unknown model');
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it("rejects a provider without a model", async () => {
    const { tool, subagents, agent } = setup();

    await expect(tool.execute({ description: "d", prompt: "p", provider: "p" }, createExec({ agent })))
      .rejects.toThrow("`provider` and `model` must be supplied together");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it("does not start a child when the call is cancelled during route validation", async () => {
    const controller = new AbortController();
    controller.abort();
    const llm = createLlm({
      resolveCallConfig: async () => { throw new Error("aborted"); }
    });
    const { tool, subagents, agent } = setup({ llm });

    await expect(tool.execute({ description: "d", prompt: "p", model: "m" }, createExec({ agent, signal: controller.signal })))
      .rejects.toThrow("aborted");
    expect(subagents.calls.startActivation).toHaveLength(0);
  });
});
