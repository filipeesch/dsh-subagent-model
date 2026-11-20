import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_MODES, contextMode, resolveContextBackend } from "../lib/context-modes.js";
import { createSubagents } from "./helpers/fakes.js";

describe("contextMode", () => {
  it("selects inheritance only for an explicit true", () => {
    expect(contextMode(undefined)).toBe("fresh");
    expect(contextMode(false)).toBe("fresh");
    expect(contextMode(true)).toBe("inherit");
  });
});

describe("DEFAULT_CONTEXT_MODES", () => {
  it("maps fresh to spawn and inherit to fork", () => {
    expect(DEFAULT_CONTEXT_MODES).toEqual({
      fresh: { provider: "spawn", inheritsParentContext: false },
      inherit: { provider: "fork", inheritsParentContext: true }
    });
  });
});

describe("resolveContextBackend", () => {
  it("resolves the default backend for each mode", () => {
    const subagents = createSubagents();

    // A local backend declares `prepareContinuable`, which is what allows a reserved child id and
    // therefore what decides whether the resolved route can be pinned.
    expect(resolveContextBackend({ subagents, inheritContext: false }))
      .toEqual({ mode: "fresh", provider: "spawn", pinnable: true });
    expect(resolveContextBackend({ subagents, inheritContext: true }))
      .toEqual({ mode: "inherit", provider: "fork", pinnable: true });
    expect(subagents.calls.getProvider).toEqual(["spawn", "fork"]);
    expect(subagents.calls.startActivation).toHaveLength(0);
  });

  it("uses an injected mode registry", () => {
    const subagents = createSubagents({
      providers: {
        "custom-fresh": {
          name: "custom-fresh",
          inheritsParentContext: false,
          capabilities: { agentOptions: true }
        }
      }
    });
    const modes = {
      fresh: { provider: "custom-fresh", inheritsParentContext: false },
      inherit: { provider: "fork", inheritsParentContext: true }
    };

    // This backend declares no `prepareContinuable`, so it is external: the host would reject a
    // reserved child id, and the delegation must leave it on the ordinary activation path.
    expect(resolveContextBackend({ subagents, inheritContext: false, modes }))
      .toEqual({ mode: "fresh", provider: "custom-fresh", pinnable: false });
    expect(subagents.calls.getProvider).toEqual(["custom-fresh"]);
  });

  it("reports a local backend as pinnable and an external one as not", () => {
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
    const modes = {
      fresh: { provider: "spawn", inheritsParentContext: false },
      inherit: { provider: "external-inherit", inheritsParentContext: true }
    };

    expect(resolveContextBackend({ subagents, inheritContext: false, modes }).pinnable).toBe(true);
    expect(resolveContextBackend({ subagents, inheritContext: true, modes }).pinnable).toBe(false);
  });

  it("rejects a missing fresh backend", () => {
    const subagents = createSubagents({ providers: { spawn: null } });

    expect(() => resolveContextBackend({ subagents, inheritContext: false }))
      .toThrow('inherit_context=false requires the subagent backend "spawn", which is not registered in this composition');
  });

  it("rejects a missing inheritance backend", () => {
    const subagents = createSubagents({ providers: { fork: null } });

    expect(() => resolveContextBackend({ subagents, inheritContext: true }))
      .toThrow('inherit_context=true requires the subagent backend "fork", which is not registered in this composition');
  });

  it("rejects a backend that does not inherit context", () => {
    const subagents = createSubagents({
      providers: {
        fork: { name: "fork", inheritsParentContext: false, capabilities: { agentOptions: true } }
      }
    });

    expect(() => resolveContextBackend({ subagents, inheritContext: true }))
      .toThrow('subagent backend "fork" does not satisfy the inheritance contract required by `inherit_context`: expected inheritsParentContext=true, got false');
  });

  it("rejects a fresh backend that inherits context", () => {
    const subagents = createSubagents({
      providers: {
        spawn: { name: "spawn", inheritsParentContext: true, capabilities: { agentOptions: true } }
      }
    });

    expect(() => resolveContextBackend({ subagents, inheritContext: false }))
      .toThrow('subagent backend "spawn" does not satisfy the fresh-context contract required by `inherit_context`: expected inheritsParentContext=false, got true');
  });

  it("rejects a backend without child agent options", () => {
    const subagents = createSubagents({
      providers: {
        fork: { name: "fork", inheritsParentContext: true, capabilities: { agentOptions: false } }
      }
    });

    expect(() => resolveContextBackend({ subagents, inheritContext: true }))
      .toThrow('subagent backend "fork" cannot accept the child `agentOptions` required by `subagent_model` (inherit_context=true)');
  });

  it("names the requested backend, the mode, and the configuration key when a configured name has no provider", () => {
    const subagents = createSubagents();
    const modes = {
      fresh: { provider: "custom-fresh", inheritsParentContext: false },
      inherit: { provider: "fork", inheritsParentContext: true }
    };

    expect(() => resolveContextBackend({ subagents, inheritContext: false, modes })).toThrow(
      'inherit_context=false requires the subagent backend "custom-fresh", which is not registered '
      + "in this composition; register that provider or point `backends.fresh` at a registered one"
    );
  });

  it("rejects a registry without the selected mode", () => {
    const subagents = createSubagents();

    expect(() => resolveContextBackend({
      subagents,
      inheritContext: true,
      modes: { fresh: { provider: "spawn", inheritsParentContext: false } }
    })).toThrow('no context-mode contract is registered for `inherit_context` mode "inherit"');
  });
});
