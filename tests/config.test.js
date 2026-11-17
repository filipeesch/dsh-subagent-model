import { describe, expect, it } from "vitest";
import { DEFAULT_BACKENDS, resolveConfig } from "../lib/config.js";
import { DEFAULT_CONTEXT_MODES } from "../lib/context-modes.js";

describe("resolveConfig", () => {
  it("defaults to spawn and fork when the composition configures nothing", () => {
    expect(resolveConfig(undefined)).toEqual({
      backends: { fresh: "spawn", inherit: "fork" },
      contextModes: {
        fresh: { provider: "spawn", inheritsParentContext: false },
        inherit: { provider: "fork", inheritsParentContext: true }
      }
    });
    expect(DEFAULT_BACKENDS).toEqual({ fresh: "spawn", inherit: "fork" });
    expect(DEFAULT_BACKENDS).toEqual({
      fresh: DEFAULT_CONTEXT_MODES.fresh.provider,
      inherit: DEFAULT_CONTEXT_MODES.inherit.provider
    });
  });

  it("honors configured backend names for either mode", () => {
    const resolved = resolveConfig({ backends: { fresh: "custom-spawn" } });

    expect(resolved.backends).toEqual({ fresh: "custom-spawn", inherit: "fork" });
    expect(resolved.contextModes.fresh.provider).toBe("custom-spawn");
    expect(resolved.contextModes.inherit.provider).toBe("fork");
  });

  it("rejects an unknown plugin config key", () => {
    expect(() => resolveConfig({ backend: { fresh: "spawn" } }))
      .toThrow('unknown plugin config key "backend"; accepted keys: backends');
  });

  it("rejects an unknown backend key", () => {
    expect(() => resolveConfig({ backends: { inherits: "fork" } }))
      .toThrow('unknown `backends` key "inherits"; accepted keys: fresh, inherit');
  });

  it("rejects a backend name that is not a non-empty string and quotes what it received", () => {
    expect(() => resolveConfig({ backends: { fresh: "" } })).toThrow(
      'backends.fresh must be a non-empty string; received ""; '
      + "accepted value: a registered subagent provider name"
    );
    expect(() => resolveConfig({ backends: { inherit: 7 } })).toThrow(
      "backends.inherit must be a non-empty string; received 7 (number); "
      + "accepted value: a registered subagent provider name"
    );
  });

  it("rejects a configuration that is not an object and names the keys it accepts there", () => {
    expect(() => resolveConfig("backends")).toThrow("plugin config must be an object; accepted keys: backends");
    expect(() => resolveConfig({ backends: [] })).toThrow(
      "`backends` must be an object; accepted keys: fresh, inherit"
    );
    expect(() => resolveConfig([])).toThrow("plugin config must be an object; accepted keys: backends");
  });
});
