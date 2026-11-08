import { describe, expect, it } from "vitest";
import { buildActivationRequest } from "../lib/activation.js";
import { createAgent } from "./helpers/fakes.js";

describe("buildActivationRequest", () => {
  it("builds the prompt, parent, route, depth, and working directory", () => {
    const parent = createAgent();

    const request = buildActivationRequest({
      args: { prompt: "Review the staged diff.", cwd: "/tmp/work" },
      parent,
      route: { provider: "openai-codex", model: "gpt-6.1-sol", reasoningEffort: "high" },
      maxDepth: 2
    });

    expect(request).toEqual({
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
  });

  it("omits the effort, depth, and directory when they are absent", () => {
    const parent = createAgent();

    const request = buildActivationRequest({
      args: { prompt: "p" },
      parent,
      route: { provider: "p", model: "m" },
      maxDepth: undefined
    });

    expect(request).toEqual({
      prompt: [{ type: "text", text: "p" }],
      parent,
      agentOptions: { provider: "p", model: "m" }
    });
    expect(request).not.toHaveProperty("maxDepth");
    expect(request).not.toHaveProperty("cwd");
  });

  it("does not mutate the model-facing arguments", () => {
    const args = { prompt: "p", cwd: "/tmp" };

    buildActivationRequest({
      args,
      parent: createAgent(),
      route: { provider: "p", model: "m" },
      maxDepth: 1
    });

    expect(args).toEqual({ prompt: "p", cwd: "/tmp" });
  });
});
