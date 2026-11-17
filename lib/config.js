/** Plugin configuration: which subagent backend serves each context mode. */

/** Backend name used when the configuration omits one. */
export const DEFAULT_BACKENDS = Object.freeze({ fresh: "spawn", inherit: "fork" });

/** Configuration keys this plugin reads. */
const CONFIG_KEYS = ["backends"];
/** Context-mode keys a configuration may set. */
const MODE_KEYS = Object.keys(DEFAULT_BACKENDS);

/**
 * Reject a value that is not a plain configuration object.
 * @param {unknown} value - candidate value.
 * @param {string} subject - what the value configures.
 * @param {readonly string[]} accepted - keys that object may carry.
 * @returns {void}
 */
function assertRecord(value, subject, accepted) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(subject + " must be an object; accepted keys: " + accepted.join(", "));
  }
}

/**
 * Reject a key the configuration does not declare.
 * @param {string} key - candidate key.
 * @param {readonly string[]} accepted - accepted keys.
 * @param {string} subject - what the keys configure.
 * @returns {void}
 */
function assertKnownKey(key, accepted, subject) {
  if (!accepted.includes(key)) {
    throw new Error('unknown ' + subject + ' key "' + key + '"; accepted keys: ' + accepted.join(", "));
  }
}

/**
 * Resolve a backend name for one context mode.
 * @param {unknown} value - configured value, when present.
 * @param {"fresh"|"inherit"} mode - context mode the name serves.
 * @returns {string} the validated backend name.
 */
function resolveBackendName(value, mode) {
  if (value === undefined) return DEFAULT_BACKENDS[mode];
  if (typeof value !== "string" || value.length === 0) {
    const received = typeof value === "string" ? JSON.stringify(value) : String(value) + " (" + typeof value + ")";
    throw new Error(
      "backends." + mode + " must be a non-empty string; received " + received
      + "; accepted value: a registered subagent provider name"
    );
  }
  return value;
}

/**
 * Build the resolved configuration from validated backend names.
 * @param {{ fresh: string, inherit: string }} backends - backend names per context mode.
 * @returns {{ backends: { fresh: string, inherit: string }, contextModes: object }} resolved configuration.
 */
function buildConfig(backends) {
  return {
    backends: { fresh: backends.fresh, inherit: backends.inherit },
    contextModes: Object.freeze({
      fresh: Object.freeze({ provider: backends.fresh, inheritsParentContext: false }),
      inherit: Object.freeze({ provider: backends.inherit, inheritsParentContext: true })
    })
  };
}

/**
 * Read and validate the plugin configuration.
 * @param {unknown} config - raw plugin configuration from the composition row.
 * @returns {{ backends: { fresh: string, inherit: string }, contextModes: object }} resolved configuration.
 */
export function resolveConfig(config) {
  if (config === undefined || config === null) return buildConfig(DEFAULT_BACKENDS);
  assertRecord(config, "plugin config", CONFIG_KEYS);
  for (const key of Object.keys(config)) assertKnownKey(key, CONFIG_KEYS, "plugin config");

  const rawBackends = config.backends;
  if (rawBackends !== undefined) {
    assertRecord(rawBackends, "`backends`", MODE_KEYS);
    for (const key of Object.keys(rawBackends)) assertKnownKey(key, MODE_KEYS, "`backends`");
  }

  return buildConfig({
    fresh: resolveBackendName(rawBackends?.fresh, "fresh"),
    inherit: resolveBackendName(rawBackends?.inherit, "inherit")
  });
}
