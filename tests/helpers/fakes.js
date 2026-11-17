/** Test doubles for the host services the plugin consumes. */

/**
 * Capture registrations with the registry's disposer contract, and model the scoped view the mask
 * reads: a global name is visible unless a restriction hides it, and an agent-local registration
 * is visible but cannot be restricted (the host exempts the viewing scope's own registrations).
 * @param {object} [options] - seeded global names and the change notification.
 * @param {string[]} [options.registered] - tool names already registered globally.
 * @param {() => void} [options.onChange] - called after a registration or restriction changes, the
 *   way the host emits `tools/change` synchronously from inside `restrict()` and its disposer.
 * @returns {object} tool registry double.
 */
export function createTools({ registered = [], onChange } = {}) {
  const definitions = [];
  const globals = new Set(registered);
  const restricted = new WeakMap();
  const own = new WeakMap();
  const guards = [];
  return {
    definitions,
    globals,
    guards,
    register(definition) {
      definitions.push(definition);
      onChange?.();
      return () => {
        const index = definitions.indexOf(definition);
        if (index !== -1) definitions.splice(index, 1);
        onChange?.();
      };
    },
    registerForAgent(agent, name) {
      const names = own.get(agent) ?? new Set();
      names.add(name);
      own.set(agent, names);
    },
    restrictFor(agent, filter) {
      const names = [...(filter.deny ?? []), ...(filter.allow ?? [])];
      for (const name of names) {
        if (!globals.has(name)) {
          throw new Error('tools.restrict() names unknown global tool "' + name + '"');
        }
      }
      // One compiled filter per call, kept in a stack: the host appends a separate restriction and
      // requires every layer to admit the name, so a duplicate call is not idempotent here.
      const compiled = {
        deny: new Set(filter.deny ?? []),
        allow: filter.allow === undefined ? undefined : new Set(filter.allow)
      };
      const stack = restricted.get(agent) ?? [];
      stack.push(compiled);
      restricted.set(agent, stack);
      onChange?.();
      return () => {
        const current = restricted.get(agent) ?? [];
        const index = current.indexOf(compiled);
        if (index !== -1) current.splice(index, 1);
        onChange?.();
      };
    },
    get(name, scope) {
      if (scope !== undefined) {
        // The viewing scope's own registration stays visible regardless of inherited restrictions.
        if (own.get(scope)?.has(name) === true) return { name };
        const stack = restricted.get(scope) ?? [];
        const denied = stack.some(
          (filter) => (filter.allow !== undefined && !filter.allow.has(name)) || filter.deny.has(name)
        );
        if (denied) return undefined;
      }
      return globals.has(name) ? { name } : undefined;
    },
    guard(handler) {
      guards.push(handler);
      return () => {
        const index = guards.indexOf(handler);
        if (index !== -1) guards.splice(index, 1);
      };
    },
    deny(exec) {
      for (const guard of guards) {
        const denial = guard(exec);
        if (denial !== undefined) return denial;
      }
      return undefined;
    }
  };
}

/**
 * Build an event registrar double, used as the plugin context's event seam.
 * @returns {{ on: Function, emit: Function, handlers: Map<string, Function[]> }} event registrar.
 */
export function createEvents() {
  const handlers = new Map();
  return {
    handlers,
    on(name, handler) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
      return () => {
        const current = handlers.get(name) ?? [];
        const index = current.indexOf(handler);
        if (index !== -1) current.splice(index, 1);
      };
    },
    emit(name, payload) {
      for (const handler of handlers.get(name) ?? []) handler(payload);
    }
  };
}

/**
 * Build the agent registry double.
 * @param {object[]} [initial] - agents that already exist.
 * @returns {{ list: Function, add: Function, remove: Function, agents: object[] }} agent registry.
 */
export function createAgents(initial = []) {
  const agents = [...initial];
  return {
    agents,
    list: () => [...agents],
    add(agent) {
      agents.push(agent);
    },
    remove(agent) {
      const index = agents.indexOf(agent);
      if (index !== -1) agents.splice(index, 1);
    }
  };
}

/**
 * Build the system-prompt service double.
 * @param {object} [options] - placement fixtures.
 * @param {Record<string, number>} [options.sectionOrders] - published section placements.
 * @param {Record<string, number>} [options.contextOrders] - published context placements.
 * @returns {object} system-prompt double with recorded contributions.
 */
export function createSystemPrompt({ sectionOrders = {}, contextOrders = {} } = {}) {
  const sections = new Map();
  const contexts = new Map();
  return {
    sections,
    contexts,
    getSectionOrder(name) {
      return sectionOrders[name];
    },
    getContextOrder(name) {
      return contextOrders[name];
    },
    section(definition) {
      sections.set(definition.name, definition);
      return () => sections.delete(definition.name);
    },
    context(definition) {
      contexts.set(definition.name, definition);
      return () => contexts.delete(definition.name);
    }
  };
}

/**
 * Build an LLM runtime double.
 * @param {object} [options] - provider, model, and detail fixtures.
 * @param {object[]} [options.providers] - registered providers.
 * @param {Record<string, object[]>} [options.models] - advertised models per provider.
 * @param {Record<string, object>} [options.details] - resolved model metadata keyed by "provider/model".
 * @param {(config: object, signal: AbortSignal) => Promise<object>} [options.resolveCallConfig] - route validation hook.
 * @returns {object} LLM runtime double with recorded calls.
 */
export function createLlm({ providers = [], models = {}, details = {}, resolveCallConfig } = {}) {
  const calls = { listProviders: 0, listModels: [], resolveModelInfo: [], resolveCallConfig: [] };
  return {
    calls,
    listProviders() {
      calls.listProviders += 1;
      return providers;
    },
    async listModels(provider) {
      calls.listModels.push(provider);
      return models[provider] ?? [];
    },
    async resolveModelInfo(provider, model, signal) {
      calls.resolveModelInfo.push({ provider, model, signal });
      const detail = details[provider + "/" + model];
      if (detail === undefined) throw new Error('model "' + model + '" is unknown on provider "' + provider + '"');
      return detail;
    },
    async resolveCallConfig(config, signal) {
      calls.resolveCallConfig.push({ config, signal });
      if (resolveCallConfig !== undefined) return resolveCallConfig(config, signal);
      return config;
    }
  };
}

/**
 * Default subagent provider records available in the shipped composition.
 * @returns {Record<string, object>} fresh and inheriting providers.
 */
function defaultProviders() {
  return {
    spawn: {
      name: "spawn",
      inheritsParentContext: false,
      capabilities: { agentOptions: true, depthLimit: true }
    },
    fork: {
      name: "fork",
      inheritsParentContext: true,
      capabilities: { agentOptions: true, depthLimit: true }
    }
  };
}

/**
 * Build a subagent runtime double that records every activation spec.
 * @param {object} [options] - child identity, depth policy, and provider overrides.
 * @param {(index: number) => string} [options.childId] - child identity factory.
 * @param {(index: number) => string} [options.childName] - host-assigned child name factory.
 * @param {number|undefined} [options.maxDepth] - resolved Host depth limit.
 * @param {Record<string, object|null>} [options.providers] - provider records merged over the defaults; a null entry removes a backend.
 * @returns {object} subagent runtime double with recorded calls.
 */
export function createSubagents(options = {}) {
  const { childId, childName, providers = {} } = options;
  const maxDepth = "maxDepth" in options ? options.maxDepth : 1;
  const calls = { startActivation: [], resolveMaxDepth: 0, getProvider: [], setProvider: [] };
  const nextChildId = childId ?? ((index) => "child-" + index);
  const nextChildName = childName ?? ((index) => "agent-" + index);
  const registry = new Map(
    Object.entries({ ...defaultProviders(), ...providers })
      .filter(([, provider]) => provider !== null && provider !== undefined)
  );
  return {
    calls,
    getProvider(name) {
      calls.getProvider.push(name);
      return registry.get(name);
    },
    setProvider(name, provider) {
      calls.setProvider.push(name);
      registry.set(name, provider);
    },
    resolveMaxDepth() {
      calls.resolveMaxDepth += 1;
      return maxDepth;
    },
    async startActivation(spec) {
      calls.startActivation.push(spec);
      const index = calls.startActivation.length;
      return { childId: nextChildId(index), name: nextChildName(index) };
    }
  };
}

/**
 * Build a calling-agent double.
 *
 * Passing `tools` gives the agent the scoped restriction seam the mask uses; a restriction naming a
 * tool the scope owns fails the way the host fails it, so the exemption is covered.
 * @param {object} [options] - identity, creation options, request header, depth, and the registry.
 * @param {string} [options.id] - agent identity.
 * @param {object} [options.options] - creation-time agent options.
 * @param {object} [options.header] - latest request header config.
 * @param {number} [options.depth] - persisted delegation depth.
 * @param {object} [options.tools] - tool registry whose scope this agent views.
 * @returns {object} agent double.
 */
export function createAgent({ id = "agent-parent", options = {}, header, depth, tools } = {}) {
  const agent = {
    id,
    options: { provider: "parent-provider", model: "parent-model", ...options },
    session: {
      requestHeader: () => (header === undefined ? undefined : { config: header }),
      header: depth === undefined ? {} : { delegationDepth: depth }
    }
  };
  if (tools !== undefined) {
    agent.ctx = {
      tools: { restrict: (filter) => tools.restrictFor(agent, filter) }
    };
  }
  return agent;
}

/**
 * Build the tool execution context.
 * @param {object} [options] - execution identity.
 * @param {object} [options.agent] - calling agent, when one exists.
 * @param {AbortSignal} [options.signal] - cancellation signal.
 * @returns {object} tool execution context.
 */
export function createExec({ agent, signal } = {}) {
  return { agent, signal: signal ?? new AbortController().signal };
}
