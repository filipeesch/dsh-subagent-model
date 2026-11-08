/** Test doubles for the host services the plugin consumes. */

/**
 * Capture registrations with the registry's disposer contract.
 * @returns {{ definitions: object[], register: (definition: object) => () => void }}
 */
export function createTools() {
  const definitions = [];
  return {
    definitions,
    register(definition) {
      definitions.push(definition);
      return () => {
        const index = definitions.indexOf(definition);
        if (index !== -1) definitions.splice(index, 1);
      };
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
 * @param {object} [options] - identity, creation options, and the latest request header.
 * @param {string} [options.id] - agent identity.
 * @param {object} [options.options] - creation-time agent options.
 * @param {object} [options.header] - latest request header config.
 * @returns {object} agent double.
 */
export function createAgent({ id = "agent-parent", options = {}, header } = {}) {
  return {
    id,
    options: { provider: "parent-provider", model: "parent-model", ...options },
    session: { requestHeader: () => (header === undefined ? undefined : { config: header }) }
  };
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
