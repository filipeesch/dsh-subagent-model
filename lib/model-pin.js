/** Pin a seeded child model selection to the route its tool call resolved. */

import { missingModelSeamText } from "./descriptions.js";

/**
 * Install the pin that makes a seeded child run on its selected route.
 *
 * A seeded child inherits the parent completed-turn prefix, and that prefix carries the parent
 * `request/header`. The host prefers a recorded selection over the child creation options, so a
 * seeded child would otherwise run on the parent provider, model, and effort no matter what the
 * activation asked for. `agent.model.select` is the supported seam for that choice (the
 * deprecated `agent/request` waterfall names it as the replacement), and the host runs
 * `agent/created` listeners to completion before releasing the child queued work.
 *
 * Only a seeded local child needs this: a fresh child records no selection to outrank, and an
 * external backend runs outside this host log. The caller decides which children are reserved.
 * @param {object} options - activation inputs.
 * @param {object} options.events - registrar carrying the host event seam.
 * @returns {{ register: Function, settle: Function, dispose: Function }} pin handle.
 */
export function installModelPin({ events }) {
  const pending = new Map();
  const applied = new Set();
  const unsubscribe = events.on("agent/created", ({ agent }) => {
    const route = pending.get(agent?.id);
    if (route === undefined) return undefined;
    pending.delete(agent.id);
    // A reserved child that cannot take the selection would silently run the parent route, so the
    // listener fails loudly instead of leaving the tool result claiming a route it never applied.
    if (typeof agent.model?.select !== "function") {
      throw new Error(missingModelSeamText(route.backend));
    }
    agent.model.select({
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort })
    });
    applied.add(agent.id);
    return undefined;
  }, { global: true });

  return {
    /**
     * Reserve the route for one child identity.
     * @param {string} childId - identity the activation will use.
     * @param {{ provider: string, model: string, reasoningEffort?: string, backend?: string }} route - settled route.
     * @returns {void}
     */
    register(childId, route) {
      pending.set(childId, route);
    },
    /**
     * End one reservation and report whether the pin was actually applied.
     * @param {string} childId - identity the activation attempted.
     * @returns {boolean} whether the child took the pinned selection.
     */
    settle(childId) {
      pending.delete(childId);
      return applied.delete(childId);
    },
    dispose() {
      pending.clear();
      applied.clear();
      if (typeof unsubscribe === "function") unsubscribe();
    }
  };
}
