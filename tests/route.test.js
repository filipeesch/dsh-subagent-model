import { describe, expect, it } from "vitest";
import { parentRoute, resolveRoute } from "../lib/route.js";
import { createAgent, createLlm } from "./helpers/fakes.js";

/** Build a live signal. */
function liveSignal() {
  return new AbortController().signal;
}

describe("parentRoute", () => {
  it("prefers the latest request header over creation options", () => {
    const parent = createAgent({
      options: { provider: "created-provider", model: "created-model" },
      header: { provider: "live-provider", model: "live-model", reasoningEffort: "high" }
    });

    expect(parentRoute(parent)).toEqual({
      provider: "live-provider",
      model: "live-model",
      reasoningEffort: "high"
    });
  });

  it("falls back to creation options before the first request", () => {
    const parent = createAgent({ options: { provider: "created-provider", model: "created-model" } });

    expect(parentRoute(parent)).toEqual({ provider: "created-provider", model: "created-model" });
  });

  it("reports no route when neither source has one", () => {
    expect(parentRoute({ options: {}, session: { requestHeader: () => undefined } }))
      .toEqual({ provider: undefined, model: undefined });
  });
});

describe("resolveRoute", () => {
  it("defaults the provider to the calling agent's route", async () => {
    const llm = createLlm();
    const parent = createAgent({ header: { provider: "live-provider", model: "live-model" } });

    await expect(resolveRoute(llm, parent, { model: "requested-model" }, liveSignal()))
      .resolves.toEqual({ provider: "live-provider", model: "requested-model" });
  });

  it("rejects a provider without a model", async () => {
    await expect(resolveRoute(createLlm(), createAgent(), { provider: "some-provider" }, liveSignal()))
      .rejects.toThrow("`provider` and `model` must be supplied together");
  });

  it("rejects an empty model", async () => {
    await expect(resolveRoute(createLlm(), createAgent(), { model: "" }, liveSignal()))
      .rejects.toThrow("`model` must be a non-empty string");
  });

  it("rejects an empty provider", async () => {
    await expect(resolveRoute(createLlm(), createAgent(), { provider: "", model: "m" }, liveSignal()))
      .rejects.toThrow("`provider` must be a non-empty string");
  });

  it("rejects a call with no provider anywhere", async () => {
    const parent = { options: {}, session: { requestHeader: () => undefined } };

    await expect(resolveRoute(createLlm(), parent, { model: "m" }, liveSignal()))
      .rejects.toThrow("no LLM provider route: pass `provider` or run under an agent that has one");
  });

  it("validates the route and effort through the LLM runtime", async () => {
    const llm = createLlm();
    const signal = liveSignal();

    const route = await resolveRoute(llm, createAgent(), {
      provider: "p",
      model: "m",
      reasoning_effort: "high"
    }, signal);

    expect(route).toEqual({ provider: "p", model: "m", reasoningEffort: "high" });
    expect(llm.calls.resolveCallConfig).toEqual([{
      config: { provider: "p", model: "m", reasoningEffort: "high" },
      signal
    }]);
  });

  it("names the model and provider when the route does not resolve", async () => {
    const llm = createLlm({
      resolveCallConfig: async () => { throw new Error("unknown model"); }
    });

    await expect(resolveRoute(llm, createAgent(), { provider: "p", model: "m" }, liveSignal()))
      .rejects.toThrow('model "m" is not available on provider "p": unknown model');
  });

  it("names the effort when the model rejects it", async () => {
    const llm = createLlm({
      resolveCallConfig: async () => { throw new Error("unsupported effort"); }
    });

    await expect(resolveRoute(llm, createAgent(), { provider: "p", model: "m", reasoning_effort: "max" }, liveSignal()))
      .rejects.toThrow('model "m" with reasoning effort "max" is not available on provider "p": unsupported effort');
  });

  it("preserves cancellation instead of wrapping it", async () => {
    const controller = new AbortController();
    controller.abort();
    const llm = createLlm({
      resolveCallConfig: async () => { throw new Error("aborted"); }
    });

    await expect(resolveRoute(llm, createAgent(), { provider: "p", model: "m" }, controller.signal))
      .rejects.toThrow("aborted");
  });

  it("reports an unavailable LLM runtime", async () => {
    await expect(resolveRoute(undefined, createAgent(), { provider: "p", model: "m" }, liveSignal()))
      .rejects.toThrow("cannot resolve the selected child LLM route because the `llm` service is unavailable");
  });
});
