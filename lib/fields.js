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
