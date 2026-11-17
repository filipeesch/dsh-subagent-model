import { describe, expect, it } from "vitest";
import { MASKED_TOOLS, installNativeMask } from "../lib/native-mask.js";
import { createAgent, createAgents, createEvents, createTools } from "./helpers/fakes.js";

/**
 * Build the host fixture the mask runs against.
 *
 * The registry notifies on every restriction change the way the host does (synchronously inside
 * `restrict()` and inside its disposer), so a re-entrant mask fails here instead of only in
 * production.
 * @param {object} [options] - composition fixtures.
 * @param {string[]} [options.registered] - names the composition registers.
 * @param {object[]} [options.agents] - agents that already exist.
 * @returns {object} installed mask and its doubles.
 */
function setup({ registered = [...MASKED_TOOLS], agents: initial = [] } = {}) {
  const events = createEvents();
  const tools = createTools({ registered, onChange: () => events.emit("tools/change", {}) });
  const agents = createAgents(initial);
  const restrictCalls = [];
  const restrictFor = tools.restrictFor.bind(tools);
  tools.restrictFor = (agent, filter) => {
    restrictCalls.push({ agent, filter });
    return restrictFor(agent, filter);
  };
  const warnings = [];
  const mask = installNativeMask({
    events,
    agents,
    tools,
    logger: { warn: (message) => warnings.push(message) }
  });
  return { tools, events, agents, mask, restrictCalls, warnings };
}

/**
 * Assert every masked name is visible again for one agent.
 * @param {object} tools - tool registry double.
 * @param {object} agent - agent under test.
 * @returns {void}
 */
function expectRestored(tools, agent) {
  for (const name of MASKED_TOOLS) expect(tools.get(name, agent)).toEqual({ name });
}

describe("installNativeMask", () => {
  it("masks an agent that already exists when the plugin loads", () => {
    const events = createEvents();
    const tools = createTools({ registered: [...MASKED_TOOLS], onChange: () => events.emit("tools/change", {}) });
    const agent = createAgent({ id: "agent-1", tools });
    const agents = createAgents([agent]);

    const mask = installNativeMask({ events, agents, tools, logger: { warn() {} } });

    for (const name of MASKED_TOOLS) expect(tools.get(name, agent)).toBeUndefined();
    expect(tools.get("subagent")).toEqual({ name: "subagent" });
    mask.dispose();
  });

  it("masks an agent created after the plugin loaded", () => {
    const { tools, events, agents, mask } = setup();
    const agent = createAgent({ id: "agent-2", tools });
    agents.add(agent);

    events.emit("agent/created", { agent });

    for (const name of MASKED_TOOLS) expect(tools.get(name, agent)).toBeUndefined();
    mask.dispose();
  });

  it("masks a subagent the plugin delegates and leaves the plugin's tools visible", () => {
    const { tools, events, agents, mask } = setup({
      registered: [...MASKED_TOOLS, "subagent_model", "list_subagent_routes"]
    });
    const child = createAgent({ id: "child-1", tools });
    agents.add(child);

    events.emit("agent/created", { agent: child });

    for (const name of MASKED_TOOLS) expect(tools.get(name, child)).toBeUndefined();
    expect(tools.get("subagent_model", child)).toBeDefined();
    expect(tools.get("list_subagent_routes", child)).toBeDefined();
    mask.dispose();
  });

  it("applies one restriction per visible name even though the host notifies synchronously", () => {
    const { tools, events, agents, restrictCalls, mask } = setup();
    const agent = createAgent({ id: "agent-1", tools });
    agents.add(agent);

    events.emit("agent/created", { agent });

    expect(restrictCalls).toHaveLength(MASKED_TOOLS.length);
    expect(restrictCalls.every((call) => call.filter.deny.length === 1)).toBe(true);
    mask.dispose();
  });

  it("does not re-apply restrictions for an already masked agent", () => {
    const { tools, events, agents, restrictCalls, mask } = setup();
    const agent = createAgent({ id: "agent-1", tools });
    agents.add(agent);
    events.emit("agent/created", { agent });

    events.emit("tools/change", {});
    events.emit("agent/created", { agent });

    expect(restrictCalls).toHaveLength(MASKED_TOOLS.length);
    mask.dispose();
  });

  it("restores every masked name when the agent is disposed", () => {
    const { tools, events, agents, mask } = setup();
    const agent = createAgent({ id: "agent-1", tools });
    agents.add(agent);
    events.emit("agent/created", { agent });
    expect(tools.get("subagent", agent)).toBeUndefined();

    agents.remove(agent);
    events.emit("agent/disposed", { agent });

    expectRestored(tools, agent);
    mask.dispose();
  });

  it("restores every masked name when the plugin unloads", () => {
    const { tools, events, agents, mask } = setup();
    const agent = createAgent({ id: "agent-1", tools });
    agents.add(agent);
    events.emit("agent/created", { agent });

    mask.dispose();

    expectRestored(tools, agent);
  });

  it("does not accumulate restrictions across a reload", () => {
    const events = createEvents();
    const tools = createTools({ registered: [...MASKED_TOOLS], onChange: () => events.emit("tools/change", {}) });
    const agent = createAgent({ id: "agent-1", tools });
    const agents = createAgents([agent]);
    const restrictCalls = [];
    const restrictFor = tools.restrictFor.bind(tools);
    tools.restrictFor = (target, filter) => {
      restrictCalls.push({ agent: target, filter });
      return restrictFor(target, filter);
    };

    const first = installNativeMask({ events, agents, tools, logger: { warn() {} } });
    first.dispose();
    expectRestored(tools, agent);

    const second = installNativeMask({ events, agents, tools, logger: { warn() {} } });
    second.dispose();

    expectRestored(tools, agent);
    expect(restrictCalls).toHaveLength(2 * MASKED_TOOLS.length);
  });

  it("masks a target registered after the plugin loaded", () => {
    const { tools, events, agents, mask } = setup({ registered: ["subagent"] });
    const agent = createAgent({ id: "agent-1", tools });
    agents.add(agent);
    events.emit("agent/created", { agent });
    expect(mask.surface(agent)).toEqual({
      hidden: ["subagent"],
      surviving: [],
      absent: ["subagent_fork", "list_subagent_models", "workflow"]
    });

    // A late registration of an absent target must be picked up by the next registry change.
    tools.globals.add("workflow");
    events.emit("tools/change", {});

    expect(tools.get("workflow", agent)).toBeUndefined();
    expect(mask.surface(agent)).toEqual({
      hidden: ["subagent", "workflow"],
      surviving: [],
      absent: ["subagent_fork", "list_subagent_models"]
    });

    mask.dispose();
    expect(tools.get("subagent", agent)).toEqual({ name: "subagent" });
    expect(tools.get("workflow", agent)).toEqual({ name: "workflow" });
  });

  it("reports a name the scope also registers itself as surviving", () => {
    const events = createEvents();
    const tools = createTools({ registered: ["workflow"], onChange: () => events.emit("tools/change", {}) });
    const agent = createAgent({ id: "agent-1", tools });
    // Registered globally AND owned by the agent: the host keeps the own registration visible.
    tools.registerForAgent(agent, "workflow");
    const agents = createAgents([agent]);

    const mask = installNativeMask({ events, agents, tools, logger: { warn() {} } });

    expect(mask.surface(agent)).toEqual({ hidden: [], surviving: ["workflow"], absent: ["subagent", "subagent_fork", "list_subagent_models"] });
    mask.dispose();
  });

  it("masks an agent created while a pass is already running", () => {
    const events = createEvents();
    const tools = createTools({ registered: [...MASKED_TOOLS], onChange: () => events.emit("tools/change", {}) });
    const first = createAgent({ id: "agent-1", tools });
    const late = createAgent({ id: "late-agent", tools });
    const agents = createAgents([first, late]);
    // Emit agent/created synchronously from a registry change raised by the first pass.
    let announced = false;
    events.on("tools/change", () => {
      if (announced) return;
      announced = true;
      events.emit("agent/created", { agent: late });
    });

    const mask = installNativeMask({ events, agents, tools, logger: { warn() {} } });

    expect(announced).toBe(true);
    for (const name of MASKED_TOOLS) {
      expect(tools.get(name, late)).toBeUndefined();
      expect(tools.get(name, first)).toBeUndefined();
    }

    mask.dispose();
    expectRestored(tools, late);
    expectRestored(tools, first);
  });

  it("treats a composition without the masked names as nothing to do", () => {
    const { tools, restrictCalls, warnings, mask } = setup({ registered: [] });
    const agent = createAgent({ id: "agent-1", tools });

    expect(mask.surface(agent)).toEqual({ hidden: [], surviving: [], absent: [...MASKED_TOOLS] });
    expect(restrictCalls).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    mask.dispose();
  });

  it("reports a name it cannot restrict instead of claiming it is hidden", () => {
    const events = createEvents();
    const tools = createTools({ registered: ["subagent"], onChange: () => events.emit("tools/change", {}) });
    const agent = createAgent({ id: "agent-1", tools });
    // An agent-local registration is exempt from the scoped restriction.
    tools.registerForAgent(agent, "workflow");
    const agents = createAgents([agent]);
    const warnings = [];

    const mask = installNativeMask({ events, agents, tools, logger: { warn: (message) => warnings.push(message) } });

    expect(warnings.join("\n")).toContain('could not hide "workflow"');
    expect(mask.surface(agent)).toEqual({
      hidden: ['subagent'],
      surviving: ["workflow"],
      absent: ["subagent_fork", "list_subagent_models"]
    });
    expect(tools.deny({ name: "workflow" })).toBeDefined();
    mask.dispose();
  });

  it("denies every masked call and names the replacement", () => {
    const { tools, mask } = setup();

    expect(tools.deny({ name: "subagent" })).toEqual({
      reason: expect.stringContaining("`subagent_model`"),
      info: { name: "SubagentModelMaskError", code: "NATIVE_DELEGATION_MASKED" }
    });
    expect(tools.deny({ name: "subagent_fork" }).reason).toContain("`subagent_model`");
    expect(tools.deny({ name: "workflow" }).reason).toContain("`subagent_model`");
    expect(tools.deny({ name: "list_subagent_models" }).reason).toContain("`list_subagent_routes`");
    expect(tools.deny({ name: "read" })).toBeUndefined();
    expect(tools.deny({ name: "subagent_model" })).toBeUndefined();
    mask.dispose();
  });

  it("removes the guard when the plugin unloads", () => {
    const { tools, mask } = setup();

    mask.dispose();

    expect(tools.deny({ name: "subagent" })).toBeUndefined();
    expect(tools.guards).toHaveLength(0);
  });
});
