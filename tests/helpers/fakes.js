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
 * Build a subagent runtime double that records every activation spec.
 * @param {{ childId?: (index: number) => string }} [options] - child identity factory.
 * @returns {object} subagent runtime double with recorded calls.
 */
export function createSubagents({ childId } = {}) {
  const calls = { startActivation: [] };
  const nextChildId = childId ?? ((index) => "child-" + index);
  return {
    calls,
    async startActivation(spec) {
      calls.startActivation.push(spec);
      return { childId: nextChildId(calls.startActivation.length) };
    }
  };
}

/**
 * Build a calling-agent double.
 * @param {object} [options] - creation options and the latest request header.
 * @param {object} [options.options] - creation-time agent options.
 * @param {object} [options.header] - latest request header config.
 * @returns {object} agent double.
 */
export function createAgent({ options = {}, header } = {}) {
  return {
    id: "agent-parent",
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
