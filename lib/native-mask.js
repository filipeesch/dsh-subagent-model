/** Hides the host delegation tools this plugin replaces, for every agent it can observe. */

import { refusalText } from "./descriptions.js";

/**
 * Host tools the plugin suppresses while it is loaded: the delegation tools that can compete with
 * `subagent_model`, plus the policy-filtered catalog that misleads route discovery.
 */
export const MASKED_TOOLS = Object.freeze([
  "subagent",
  "subagent_fork",
  "list_subagent_models",
  "workflow"
]);

/**
 * Report what an agent can see of the masked names: what this plugin restricted, what another
 * registration keeps visible, and what the composition never registered.
 * @param {object} tools - tool registry.
 * @param {object} agent - agent whose surface is inspected.
 * @param {string[]} restricted - names this plugin restricted for that agent.
 * @returns {{ hidden: string[], surviving: string[], absent: string[] }} masked names by cause.
 */
function surfaceOf(tools, agent, restricted) {
  const hidden = [];
  const surviving = [];
  const absent = [];
  for (const name of MASKED_TOOLS) {
    if (tools.get(name, agent) !== undefined) surviving.push(name);
    else if (restricted.includes(name)) hidden.push(name);
    else absent.push(name);
  }
  return { hidden, surviving, absent };
}

/**
 * Install the native-delegation mask.
 *
 * The plugin restricts the masked names per agent scope (the host refuses a context-global
 * restriction), refreshes when the registry changes, and adds an execution guard because a scope's
 * own registrations are exempt from inherited restrictions.
 *
 * The host emits `tools/change` synchronously from inside `restrict()` and from its disposer, so
 * every mutation runs behind one re-entrancy flag: without it, a refresh started by our own
 * restriction would apply a second, untracked set that outlives the plugin.
 * @param {object} services - injected host services and event source.
 * @param {{ on: (name: string, handler: Function, options?: object) => unknown }} services.events - event registrar; the plugin context in production.
 * @param {{ list: () => object[] }} services.agents - agent registry.
 * @param {object} services.tools - tool registry.
 * @param {object} [services.logger] - host logger.
 * @returns {{ surface: (agent: object) => { hidden: string[], surviving: string[], absent: string[] }, dispose: () => void }} installed mask.
 */
export function installNativeMask({ events, agents, tools, logger }) {
  /** @type {Map<object, { names: string[], seen: string[], disposers: Array<() => void> }>} */
  const masks = new Map();
  const subscribed = [];
  let applying = false;
  let disposed = false;
  let dirty = false;

  /**
   * Release every restriction applied for one agent.
   * @param {object} agent - agent whose restrictions are released.
   * @returns {void}
   */
  const release = (agent) => {
    const current = masks.get(agent);
    if (current === undefined) return;
    masks.delete(agent);
    for (const dispose of current.disposers) dispose();
  };

  /**
   * Apply the mask for one agent, reusing the existing restrictions when they already cover it.
   * @param {object} agent - agent to mask.
   * @returns {void}
   */
  const attach = (agent) => {
    if (disposed) return;
    if (applying) {
      // Both entry points share one re-run, so an agent created during a pass is never left
      // unmasked just because no later registry change happens to arrive.
      dirty = true;
      return;
    }
    if (agent?.ctx?.tools?.restrict === undefined) return;
    const current = masks.get(agent);
    // The agent's own restrictions hide the names they cover, so refresh may only reconsider names
    // this agent has never been checked for; re-reading a hidden name would look like an absent one.
    if (current !== undefined) {
      const unconsidered = MASKED_TOOLS.filter(
        (name) => !current.seen.includes(name) && tools.get(name, agent) !== undefined
      );
      if (unconsidered.length === 0) return;
    }

    applying = true;
    try {
      release(agent);
      const visible = MASKED_TOOLS.filter((name) => tools.get(name, agent) !== undefined);
      const names = [];
      const disposers = [];
      for (const name of visible) {
        try {
          disposers.push(agent.ctx.tools.restrict({ deny: [name] }));
          names.push(name);
        } catch (error) {
          // A name the scope owns cannot be restricted; the guard still refuses the call, and the
          // guidance reports the surviving name instead of claiming it is hidden.
          logger?.warn?.(
            "subagent-model: could not hide \"" + name + "\" for agent " + String(agent.id)
            + ": " + String((error && error.message) || error)
          );
        }
      }
      if (disposers.length > 0) masks.set(agent, { names, seen: [...visible], disposers });
    } finally {
      applying = false;
      // A change observed while this pass ran (including this plugin's own restriction) must not be
      // lost: re-run once outside the flag, where the recorded restrictions make the pass idempotent.
      if (dirty) {
        dirty = false;
        refresh();
      }
    }
  };

  /**
   * Re-apply the mask for every live agent.
   * @returns {void}
   */
  const refresh = () => {
    if (disposed) return;
    if (applying) {
      dirty = true;
      return;
    }
    for (const agent of agents.list()) attach(agent);
  };

  subscribed.push(events.on("agent/created", ({ agent }) => {
    attach(agent);
    return undefined;
  }, { global: true }));
  subscribed.push(events.on("agent/disposed", ({ agent }) => {
    release(agent);
    return undefined;
  }, { global: true }));
  subscribed.push(events.on("tools/change", refresh, { global: true }));

  const disposeGuard = tools.guard((exec) => {
    const name = exec?.name;
    return MASKED_TOOLS.includes(name)
      ? { reason: refusalText(name), info: { name: "SubagentModelMaskError", code: "NATIVE_DELEGATION_MASKED" } }
      : undefined;
  });

  refresh();

  return {
    surface: (agent) => surfaceOf(tools, agent, masks.get(agent)?.names ?? []),
    dispose() {
      disposed = true;
      for (const agent of [...masks.keys()]) release(agent);
      if (typeof disposeGuard === "function") disposeGuard();
      for (const unsubscribe of subscribed) {
        if (typeof unsubscribe === "function") unsubscribe();
      }
    }
  };
}
