/** Model-facing field validation shared by the tool bodies. */

/**
 * Reject an empty or non-string model-facing value.
 * @param {unknown} value - candidate value.
 * @param {string} field - model-facing field name.
 * @returns {void}
 */
export function assertNonEmpty(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("`" + field + "` must be a non-empty string");
  }
}

/**
 * Reject a present value that is not a boolean.
 * @param {unknown} value - candidate value.
 * @param {string} field - model-facing field name.
 * @returns {void}
 */
export function assertBoolean(value, field) {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error("`" + field + "` must be a boolean");
  }
}

/**
 * Reject an argument the tool does not declare. The host advertises a raw
 * `parameters` object to the model but leaves argument validation to the tool,
 * so an undeclared key would otherwise be dropped without a trace.
 * @param {object} args - model-facing arguments.
 * @param {readonly string[]} declared - declared parameter names.
 * @returns {void}
 */
export function assertDeclaredArguments(args, declared) {
  if (typeof args !== "object" || args === null) {
    throw new Error("tool arguments must be an object");
  }
  const known = new Set(declared);
  const unknown = Object.keys(args).filter((key) => !known.has(key));
  if (unknown.length === 0) return;
  throw new Error(
    "undeclared argument" + (unknown.length === 1 ? "" : "s") + ": " + unknown.join(", ")
    + "; declared: " + declared.join(", ")
  );
}
