import { describe, expect, it } from "vitest";
import { installGuidance } from "../lib/guidance.js";
import { createAgent, createSubagents, createSystemPrompt } from "./helpers/fakes.js";

/**
 * Build the mask double the guidance reads.
 * @param {{ hidden?: string[], surviving?: string[] }} surface - reported surface.
 * @returns {object} mask double.
 */
function maskWith({ hidden = [], surviving = [], absent = [] } = {}) {
  return { surface: () => ({ hidden, surviving, absent }) };
}

/**
 * Install the guidance over fresh doubles.
 * @param {object} [options] - placement and surface fixtures.
 * @returns {object} installed guidance and its doubles.
 */
function setup({ sectionOrders = {}, contextOrders = {}, mask = maskWith(), subagents = createSubagents() } = {}) {
  const systemPrompt = createSystemPrompt({ sectionOrders, contextOrders });
  const guidance = installGuidance({ systemPrompt, subagents, mask });
  return { systemPrompt, guidance, subagents };
}

describe("installGuidance", () => {
  it("places both contributions at the host-published slots", () => {
    const { systemPrompt } = setup({
      sectionOrders: { TOOL_SUBAGENT: 1234 },
      contextOrders: { SUBAGENT_DELEGATION: 99 }
    });

    expect([...systemPrompt.sections.keys()]).toEqual(["subagent-model:delegation"]);
    expect(systemPrompt.sections.get("subagent-model:delegation").order).toBe(1234);
    expect(systemPrompt.contexts.get("subagent-model:depth").order).toBe(99);
  });

  it("falls back to the shipped placement when the host no longer publishes the slot", () => {
    const { systemPrompt } = setup();

    expect(systemPrompt.sections.get("subagent-model:delegation").order).toBe(2800);
    expect(systemPrompt.contexts.get("subagent-model:depth").order).toBe(120);
  });

  it("renders the composition-aware guidance for an agent", () => {
    const { systemPrompt } = setup({
      mask: maskWith({ hidden: ["subagent", "subagent_fork", "list_subagent_models", "workflow"] })
    });
    const text = systemPrompt.sections.get("subagent-model:delegation").text({ agent: createAgent({ id: "a" }) });

    expect(text).toContain("`subagent_model`");
    expect(text).toContain("`list_subagent_routes`");
    expect(text).toContain("retry it with `subagent_model`");
    expect(text).toContain("Unavailable while this plugin is loaded");
    expect(text).not.toContain("Still visible");
  });

  it("reports a surviving name for that agent", () => {
    const { systemPrompt } = setup({ mask: maskWith({ hidden: ["subagent"], surviving: ["workflow"] }) });
    const text = systemPrompt.sections.get("subagent-model:delegation").text({ agent: createAgent({ id: "a" }) });

    expect(text).toContain("Still visible because this composition registers `workflow`");
    expect(text).toContain("Prefer `subagent_model` for any route the Session's model-selection policy does not authorize");
  });

  it("renders the base rule when no agent is being assembled", () => {
    const { systemPrompt } = setup({ mask: maskWith({ hidden: ["subagent"] }) });
    const text = systemPrompt.sections.get("subagent-model:delegation").text({});

    expect(text).toContain("`subagent_model`");
    expect(text).not.toContain("Unavailable");
  });

  it("renders the depth notice only when a numeric limit is reached", () => {
    const atLimit = setup({ subagents: createSubagents({ maxDepth: 2 }) });
    const notice = atLimit.systemPrompt.contexts.get("subagent-model:depth")
      .text({ agent: createAgent({ depth: 2 }) });

    expect(notice).toContain("current 2, maximum 2, remaining levels 0");

    const below = atLimit.systemPrompt.contexts.get("subagent-model:depth")
      .text({ agent: createAgent({ depth: 1 }) });
    expect(below).toBe("");
  });

  it("uses the deeper of the persisted and runtime depths", () => {
    const { systemPrompt } = setup({ subagents: createSubagents({ maxDepth: 3 }) });
    const notice = systemPrompt.contexts.get("subagent-model:depth")
      .text({ agent: createAgent({ depth: 1, options: { subagentDepth: 3 } }) });

    expect(notice).toContain("current 3, maximum 3");
  });

  it("renders no notice when the limit is provider-managed", () => {
    const { systemPrompt } = setup({ subagents: createSubagents({ maxDepth: undefined }) });

    expect(systemPrompt.contexts.get("subagent-model:depth").text({ agent: createAgent({ depth: 9 }) })).toBe("");
  });

  it("renders no notice and no guidance without an agent", () => {
    const { systemPrompt } = setup({ subagents: createSubagents({ maxDepth: 2 }) });

    expect(systemPrompt.contexts.get("subagent-model:depth").text({})).toBe("");
  });

  it("survives a host that fails to report the depth policy", () => {
    const subagents = {
      resolveMaxDepth() {
        throw new Error("no policy");
      }
    };
    const { systemPrompt } = setup({ subagents });

    expect(systemPrompt.contexts.get("subagent-model:depth").text({ agent: createAgent({ depth: 5 }) })).toBe("");
  });

  it("removes both contributions when the plugin unloads", () => {
    const { systemPrompt, guidance } = setup();

    guidance.dispose();

    expect(systemPrompt.sections.size).toBe(0);
    expect(systemPrompt.contexts.size).toBe(0);
  });
});
