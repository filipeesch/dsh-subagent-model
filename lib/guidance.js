/** Model-facing delegation guidance: which tool to use, what is hidden, and when depth runs out. */

import { depthNotice, guidanceText } from "./descriptions.js";

/** Prompt-section name contributed by this plugin. */
const SECTION_NAME = "subagent-model:delegation";
/** Prompt-context name contributed by this plugin. */
const CONTEXT_NAME = "subagent-model:depth";
/** Placement used when the host no longer publishes the delegation section slot. */
const FALLBACK_SECTION_ORDER = 2800;
/** Placement used when the host no longer publishes the delegation context slot. */
const FALLBACK_CONTEXT_ORDER = 120;

/**
 * Read a host-owned placement, falling back to the value DSH shipped when the slot is gone.
 * @param {object} systemPrompt - system-prompt service.
 * @param {string} reader - placement reader name.
 * @param {string} slot - repository placement name.
 * @param {number} fallback - placement used when the host does not resolve the slot.
 * @returns {number} finite section or context order.
 */
function placement(systemPrompt, reader, slot, fallback) {
  if (typeof systemPrompt[reader] !== "function") return fallback;
  const value = systemPrompt[reader](slot);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Read an agent's delegation depth with the host's rule: the persisted header is the floor and
 * runtime options may deepen it, never lower it.
 * @param {object} agent - agent whose depth is read.
 * @returns {number} non-negative delegation depth.
 */
function delegationDepth(agent) {
  const persisted = agent?.session?.header?.delegationDepth ?? 0;
  const runtime = agent?.options?.subagentDepth ?? 0;
  return Math.max(persisted, runtime);
}

/**
 * Install the delegation guidance and the depth notice.
 * @param {object} services - injected host services.
 * @param {object} services.systemPrompt - system-prompt service.
 * @param {object} services.subagents - subagent runtime exposing the depth policy.
 * @param {{ surface: (agent: object) => { hidden: string[], surviving: string[], absent: string[] } }} services.mask - installed mask.
 * @returns {{ dispose: () => void }} installed guidance.
 */
export function installGuidance({ systemPrompt, subagents, mask }) {
  const disposeSection = systemPrompt.section({
    name: SECTION_NAME,
    order: placement(systemPrompt, "getSectionOrder", "TOOL_SUBAGENT", FALLBACK_SECTION_ORDER),
    text: (context) => {
      const agent = context?.agent;
      if (agent === undefined) return guidanceText({});
      return guidanceText(mask.surface(agent));
    }
  });

  const disposeContext = systemPrompt.context({
    name: CONTEXT_NAME,
    order: placement(systemPrompt, "getContextOrder", "SUBAGENT_DELEGATION", FALLBACK_CONTEXT_ORDER),
    text: (context) => {
      const agent = context?.agent;
      if (agent === undefined) return "";
      let maximum;
      try {
        maximum = subagents.resolveMaxDepth();
      } catch {
        return "";
      }
      if (maximum === undefined) return "";
      const current = delegationDepth(agent);
      return current < maximum ? "" : depthNotice({ current, maximum });
    }
  });

  return {
    dispose() {
      disposeContext();
      disposeSection();
    }
  };
}
