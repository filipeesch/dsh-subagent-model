import { describe, expect, it } from "vitest";
import { buildActivationTask } from "../lib/activation.js";
import { createAgent } from "./helpers/fakes.js";

describe("buildActivationTask", () => {
  it("builds the prompt, parent, route, depth, and working directory", () => {
    const parent = createAgent();

    const task = buildActivationTask({
      args: { prompt: "Review the staged diff.", cwd: "/tmp/work" },
      parent,
      route: { provider: "openai-codex", model: "gpt-6.1-sol", reasoningEffort: "high" },
      maxDepth: 2
    });

    expect(task).toEqual({
      prompt: [{ type: "text", text: "Review the staged diff." }],
      parent,
      agentOptions: {
        provider: "openai-codex",
        model: "gpt-6.1-sol",
        reasoningEffort: "high"
      },
      maxDepth: 2,
      cwd: "/tmp/work"
    });
    expect(task).not.toHaveProperty("request");
  });

  it("omits the effort, depth, and directory when they are absent", () => {
    const parent = createAgent();

    const task = buildActivationTask({
      args: { prompt: "p" },
      parent,
      route: { provider: "p", model: "m" },
      maxDepth: undefined
    });

    // `toEqual` treats a missing key and an `undefined` key as equal, so the effort override is
    // asserted by ownership: it must be present and explicitly undefined to clear inheritance.
    expect(task).toStrictEqual({
      prompt: [{ type: "text", text: "p" }],
      parent,
      agentOptions: { provider: "p", model: "m", reasoningEffort: undefined }
    });
    expect(Object.hasOwn(task.agentOptions, "reasoningEffort")).toBe(true);
    expect(task.agentOptions.reasoningEffort).toBeUndefined();
    expect(task).not.toHaveProperty("maxDepth");
    expect(task).not.toHaveProperty("cwd");
  });

  it("does not mutate the model-facing arguments", () => {
    const args = { prompt: "p", cwd: "/tmp" };

    buildActivationTask({
      args,
      parent: createAgent(),
      route: { provider: "p", model: "m" },
      maxDepth: 1
    });

    expect(args).toEqual({ prompt: "p", cwd: "/tmp" });
  });
});
