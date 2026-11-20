import { describe, expect, it } from "vitest";
import { parentRoute, resolveRoute } from "../lib/route.js";
import { createAgent, createLlm } from "./helpers/fakes.js";

/** Build a live signal. */
function liveSignal() {
  return new AbortController().signal;
}

/** Providers and models every guard case reads from. */
const catalog = {
  providers: [
    { id: "claude", name: "claude" },
    { id: "openrouter", name: "openrouter" },
    { id: "grok", name: "grok" }
  ],
  models: {
    claude: [{ id: "claude-opus-5-5", name: "Claude Opus 5.5" }],
    openrouter: [{ id: "qwen/qwen3.8-flash", name: "Qwen 3.8 Flash" }]
  }
};

/**
 * Build an LLM double whose catalog is the shared fixture.
 * @param {object} [options] - additional fake options.
 * @returns {object} LLM double.
 */
function createCatalogLlm(options = {}) {
  return createLlm({ ...catalog, ...options });
}

/** Build an error carrying an adapter failure code. */
function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
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

  it("keeps the creation-time effort before the first request", () => {
    const parent = createAgent({
      options: { provider: "created-provider", model: "created-model", reasoningEffort: "high" }
    });

    expect(parentRoute(parent)).toEqual({
      provider: "created-provider",
      model: "created-model",
      reasoningEffort: "high"
    });
  });

  it("reports no route when neither source has one", () => {
    expect(parentRoute({ options: {}, session: { requestHeader: () => undefined } }))
      .toEqual({ provider: undefined, model: undefined });
  });
});

describe("resolveRoute routing", () => {
  it("defaults the provider to the calling agent's route", async () => {
    const llm = createCatalogLlm();
    const parent = createAgent({ header: { provider: "claude", model: "parent-model" } });

    await expect(resolveRoute(llm, parent, { model: "claude-opus-5-5" }, liveSignal()))
      .resolves.toEqual({ provider: "claude", model: "claude-opus-5-5" });
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
      .rejects.toThrow("no LLM provider route: pass `provider` and `model` or run under an agent that has one");
  });

  it("uses the calling agent's route when the model is omitted", async () => {
    const llm = createCatalogLlm();
    const parent = createAgent({ header: { provider: "claude", model: "claude-opus-5-5" } });

    await expect(resolveRoute(llm, parent, {}, liveSignal()))
      .resolves.toEqual({ provider: "claude", model: "claude-opus-5-5" });
    expect(llm.calls.resolveCallConfig).toEqual([{
      config: { provider: "claude", model: "claude-opus-5-5" },
      signal: expect.any(AbortSignal)
    }]);
  });

  it("keeps the calling agent's effort when the model is omitted", async () => {
    const parent = createAgent({ header: { provider: "live-provider", model: "live-model", reasoningEffort: "high" } });

    await expect(resolveRoute(createLlm(), parent, {}, liveSignal()))
      .resolves.toEqual({ provider: "live-provider", model: "live-model", reasoningEffort: "high" });
  });

  it("uses the creation-time effort when no request header exists yet", async () => {
    const parent = createAgent({
      options: { provider: "created-provider", model: "created-model", reasoningEffort: "high" }
    });

    await expect(resolveRoute(createLlm(), parent, {}, liveSignal()))
      .resolves.toEqual({ provider: "created-provider", model: "created-model", reasoningEffort: "high" });
  });

  it("rejects a call with no model anywhere", async () => {
    const parent = { options: { provider: "p" }, session: { requestHeader: () => undefined } };

    await expect(resolveRoute(createLlm(), parent, {}, liveSignal()))
      .rejects.toThrow("no LLM model route: pass `model` or run under an agent that has one");
  });

  it("rejects a reasoning effort without a model", async () => {
    await expect(resolveRoute(createLlm(), createAgent(), { reasoning_effort: "high" }, liveSignal()))
      .rejects.toThrow("`reasoning_effort` requires `model`; supply both or omit `reasoning_effort`");
  });

  it("validates the route and effort through the LLM runtime", async () => {
    const llm = createCatalogLlm();
    const signal = liveSignal();

    const route = await resolveRoute(llm, createAgent(), {
      provider: "claude",
      model: "claude-opus-5-5",
      reasoning_effort: "high"
    }, signal);

    expect(route).toEqual({ provider: "claude", model: "claude-opus-5-5", reasoningEffort: "high" });
    expect(llm.calls.resolveCallConfig).toEqual([{
      config: { provider: "claude", model: "claude-opus-5-5", reasoningEffort: "high" },
      signal
    }]);
  });

  it("surfaces cancellation raised while the adapter call is in flight", async () => {
    const controller = new AbortController();
    const llm = createCatalogLlm({
      resolveCallConfig: async (config, signal) => new Promise((_resolve, reject) => {
        queueMicrotask(() => {
          controller.abort(new Error("caller cancelled"));
          reject(new Error("adapter later failed"));
        });
      })
    });

    await expect(resolveRoute(llm, createAgent(), { provider: "claude", model: "claude-opus-5-5" }, controller.signal))
      .rejects.toThrow("caller cancelled");
  });

  it("surfaces cancellation raised while the catalog lookup is in flight", async () => {
    const controller = new AbortController();
    const llm = createLlm({
      providers: catalog.providers,
      models: {},
      resolveCallConfig: async (config) => config
    });
    let settle;
    llm.listModels = () => new Promise((_resolve, reject) => { settle = reject; });

    const pending = resolveRoute(llm, createAgent(), { provider: "claude", model: "claude-opus-5-5" }, controller.signal);
    controller.abort(new Error("caller cancelled"));
    settle(new Error("catalog read failed after abort"));

    await expect(pending).rejects.toThrow("caller cancelled");
  });

  it("gives an unregistered provider the catalog hint from the catalog lookup itself", async () => {
    const llm = createLlm({ providers: [{ id: "p", name: "p" }], models: { p: [{ id: "m", name: "M" }] } });
    // The pinned registry raises NO_ADAPTER from listModels, before resolveCallConfig runs.
    llm.listModels = async () => {
      const error = new Error("No adapter registered for provider nope");
      error.code = "NO_ADAPTER";
      throw error;
    };

    const thrown = await resolveRoute(llm, createAgent(), { provider: "nope", model: "m" }, liveSignal())
      .catch((error) => error);

    expect(thrown.code).toBe("NO_ADAPTER");
    expect(thrown.message).toContain("is not registered on this host");
    expect(thrown.cause).toBeInstanceOf(Error);
    expect(llm.calls.resolveCallConfig).toEqual([]);
  });

  it("keeps a catalog failure that is not an unregistered provider", async () => {
    const catalogFailure = codedError("catalog unreadable", "INVALID_CATALOG");
    const llm = createCatalogLlm();
    llm.listModels = async () => { throw catalogFailure; };

    const thrown = await resolveRoute(llm, createAgent(), { provider: "claude", model: "claude-opus-5-5" }, liveSignal())
      .catch((error) => error);

    expect(thrown).toBe(catalogFailure);
  });

  it("does not dispatch the catalog lookup when the call is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    const llm = createCatalogLlm();

    await expect(resolveRoute(llm, createAgent(), {
      provider: "claude",
      model: "claude-opus-5-5"
    }, controller.signal)).rejects.toThrow("caller cancelled");
    expect(llm.calls.listModels).toEqual([]);
  });

  it("rejects the retry with the exact cancellation reason before the adapter settles", async () => {
    const controller = new AbortController();
    let settleRetry;
    let attempt = 0;
    const llm = createCatalogLlm({
      resolveCallConfig: async (config) => {
        attempt += 1;
        if (attempt === 1) throw codedError("effort not supported", "UNSUPPORTED_REASONING_EFFORT");
        return new Promise((_resolve, reject) => { settleRetry = reject; });
      }
    });
    const reason = codedError("caller cancelled", "ABORTED");

    const pending = resolveRoute(llm, createAgent(), {
      provider: "claude",
      model: "claude-opus-5-5",
      reasoning_effort: "max"
    }, controller.signal).catch((error) => error);

    // Let the catalog read, the first attempt, and the retry all start.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attempt).toBe(2);
    // The reason carries its own code, distinct from the failure the adapter settles with later.
    controller.abort(reason);
    // Asserted while the retry is still pending: the cancellation must win on its own.
    expect(await pending).toBe(reason);
    expect(reason.code).toBe("ABORTED");
    // Settling afterwards only proves nothing later overwrites the outcome.
    settleRetry(codedError("late adapter failure", "NO_ADAPTER"));
    expect(await pending).toBe(reason);
  });

  it("honors an abort raised synchronously by the adapter call itself", async () => {
    const controller = new AbortController();
    const reason = codedError("caller cancelled", "ABORTED");
    const llm = createCatalogLlm({
      resolveCallConfig: async () => {
        // An adapter that cancels before returning its own promise.
        controller.abort(reason);
        return { provider: "claude", model: "claude-opus-5-5" };
      }
    });

    const thrown = await resolveRoute(llm, createAgent(), {
      provider: "claude",
      model: "claude-opus-5-5"
    }, controller.signal).catch((error) => error);

    expect(thrown).toBe(reason);
  });
  it("reports an unavailable LLM runtime", async () => {
    await expect(resolveRoute(undefined, createAgent(), { provider: "p", model: "m" }, liveSignal()))
      .rejects.toThrow("cannot resolve the selected child LLM route because the `llm` service is unavailable");
  });
});

describe("resolveRoute catalog membership", () => {
  it("rejects a model the provider does not advertise", async () => {
    const llm = createCatalogLlm();

    await expect(resolveRoute(llm, createAgent(), { provider: "claude", model: "cursor/claude-opus-5-5" }, liveSignal()))
      .rejects.toThrow("`model` is not one of the ids provider");
    expect(llm.calls.resolveCallConfig).toEqual([]);
  });

  it("does not repeat the rejected id and points at the catalog tool", async () => {
    const llm = createCatalogLlm();
    const failure = await resolveRoute(llm, createAgent(), {
      provider: "claude",
      model: "cursor/claude-opus-5-5"
    }, liveSignal()).catch((error) => error);

    expect(failure.message).not.toContain("cursor/claude-opus-5-5");
    expect(failure.message).toContain("list_subagent_routes");
    expect(failure.message).toContain("separate argument");
  });

  it("accepts a model id that contains a slash when the provider advertises it", async () => {
    await expect(resolveRoute(createCatalogLlm(), createAgent(), {
      provider: "openrouter",
      model: "qwen/qwen3.8-flash"
    }, liveSignal())).resolves.toEqual({ provider: "openrouter", model: "qwen/qwen3.8-flash" });
  });

  it("does not validate a provider that advertises no models", async () => {
    const llm = createCatalogLlm();

    await expect(resolveRoute(llm, createAgent(), { provider: "grok", model: "anything" }, liveSignal()))
      .resolves.toEqual({ provider: "grok", model: "anything" });
  });

  it("does not read the catalog when the model is omitted", async () => {
    const llm = createCatalogLlm();
    const parent = createAgent({ header: { provider: "claude", model: "inherited-model" } });

    await resolveRoute(llm, parent, {}, liveSignal());

    expect(llm.calls.listModels).toEqual([]);
  });
});

describe("resolveRoute reasoning effort fallback", () => {
  it("drops an unsupported effort and keeps the model default", async () => {
    let attempt = 0;
    const llm = createCatalogLlm({
      resolveCallConfig: async (config) => {
        attempt += 1;
        if (config.reasoningEffort !== undefined) {
          throw codedError("effort not supported", "UNSUPPORTED_REASONING_EFFORT");
        }
        return { ...config, reasoningEffort: "high" };
      }
    });

    const route = await resolveRoute(llm, createAgent(), {
      provider: "claude",
      model: "claude-opus-5-5",
      reasoning_effort: "max"
    }, liveSignal());

    expect(attempt).toBe(2);
    expect(route).toEqual({ provider: "claude", model: "claude-opus-5-5", reasoningEffort: "high" });
  });

  it("propagates a non-effort failure unchanged, keeping its code and identity", async () => {
    let attempt = 0;
    const failure = codedError("no eligible account", "AUTH");
    const llm = createCatalogLlm({
      resolveCallConfig: async () => {
        attempt += 1;
        throw failure;
      }
    });

    const thrown = await resolveRoute(llm, createAgent(), {
      provider: "claude",
      model: "claude-opus-5-5",
      reasoning_effort: "max"
    }, liveSignal()).catch((error) => error);

    expect(thrown).toBe(failure);
    expect(thrown.code).toBe("AUTH");
    expect(attempt).toBe(1);
  });

  it("propagates the retry failure unchanged when the route itself fails", async () => {
    const routeFailure = codedError("pool exhausted", "RATE_LIMIT");
    const llm = createCatalogLlm({
      resolveCallConfig: async (config) => {
        if (config.reasoningEffort !== undefined) {
          throw codedError("effort not supported", "UNSUPPORTED_REASONING_EFFORT");
        }
        throw routeFailure;
      }
    });

    const thrown = await resolveRoute(llm, createAgent(), {
      provider: "claude",
      model: "claude-opus-5-5",
      reasoning_effort: "max"
    }, liveSignal()).catch((error) => error);

    expect(thrown).toBe(routeFailure);
    expect(thrown.code).toBe("RATE_LIMIT");
  });

  it("does not fall back for an inherited effort the adapter rejects", async () => {
    let attempt = 0;
    const failure = codedError("effort not supported", "UNSUPPORTED_REASONING_EFFORT");
    const llm = createCatalogLlm({
      resolveCallConfig: async () => {
        attempt += 1;
        throw failure;
      }
    });
    const parent = createAgent({ header: { provider: "claude", model: "claude-opus-5-5", reasoningEffort: "high" } });

    const thrown = await resolveRoute(llm, parent, {}, liveSignal()).catch((error) => error);

    expect(thrown).toBe(failure);
    expect(attempt).toBe(1);
  });

  it("reports the materialized default when no effort was requested", async () => {
    const llm = createCatalogLlm({
      resolveCallConfig: async (config) => ({ ...config, reasoningEffort: "medium" })
    });

    await expect(resolveRoute(llm, createAgent(), { provider: "claude", model: "claude-opus-5-5" }, liveSignal()))
      .resolves.toEqual({ provider: "claude", model: "claude-opus-5-5", reasoningEffort: "medium" });
  });
});
