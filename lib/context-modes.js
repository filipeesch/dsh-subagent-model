/** Context-mode selection and backend contract validation for explicit-route delegation. */

import {
  backendOptionsText,
  contextContractText,
  missingBackendText,
  missingContextModeText
} from "./descriptions.js";

/**
 * Default backend contract for each model-facing context mode.
 * `fresh` starts a child with its own context; `inherit` seeds it with the caller's completed turns.
 */
export const DEFAULT_CONTEXT_MODES = Object.freeze({
  fresh: Object.freeze({ provider: "spawn", inheritsParentContext: false }),
  inherit: Object.freeze({ provider: "fork", inheritsParentContext: true })
});

/**
 * Select the context mode requested by the model-facing flag.
 * @param {boolean|undefined} inheritContext - requested context inheritance.
 * @returns {"fresh"|"inherit"} selected mode.
 */
export function contextMode(inheritContext) {
  return inheritContext === true ? "inherit" : "fresh";
}

/**
/**
 * Read whether the selected backend creates a local child that can be pinned to a route.
 *
 * Only a local backend accepts a reserved child identity, and only a seeded local child needs the
 * pin: its log replays the parent request header, which a recorded selection outranks. An external
 * backend receives `agentOptions` as its own defaults and never replays the parent log, so its
 * creation options are already authoritative and it must stay on the ordinary activation path.
 * @param {object|undefined} provider - registered provider record.
 * @returns {boolean} whether this backend supports the local child pin.
 */
export function isPinnableBackend(provider) {
  return typeof provider?.prepareContinuable === "function";
}

/**
 * Resolve the backend for a context mode and prove it satisfies that mode's contract.
 * @param {object} options - resolution inputs.
 * @param {object} options.subagents - subagent runtime exposing `getProvider`.
 * @param {boolean|undefined} options.inheritContext - requested context inheritance.
 * @param {Record<string, { provider: string, inheritsParentContext: boolean }>} [options.modes] - mode registry.
 * @returns {{ mode: "fresh"|"inherit", provider: string }} the selected backend.
 */
export function resolveContextBackend({ subagents, inheritContext, modes = DEFAULT_CONTEXT_MODES }) {
  const mode = contextMode(inheritContext);
  const contract = modes[mode];
  if (contract === undefined) {
    throw new Error(missingContextModeText(mode));
  }
  const provider = subagents.getProvider(contract.provider);
  if (provider === undefined) {
    throw new Error(missingBackendText({ mode, backend: contract.provider }));
  }
  if (provider.inheritsParentContext !== contract.inheritsParentContext) {
    throw new Error(contextContractText({
      mode,
      backend: contract.provider,
      expected: contract.inheritsParentContext,
      actual: provider.inheritsParentContext
    }));
  }
  if (provider.capabilities?.agentOptions !== true) {
    throw new Error(backendOptionsText({ mode, backend: contract.provider }));
  }  return { mode, provider: contract.provider, pinnable: isPinnableBackend(provider) };
}

/**
 * Build a resolver that selects and revalidates the mode backend on every call.
 *
 * The delegation body resolves twice on purpose: once before the awaited route resolution and once
 * immediately before the activation, with no await between the check and the start. One resolver
 * keeps both calls on the same configured registry instead of rebuilding the inputs.
 * @param {object} services - resolution inputs.
 * @param {object} services.subagents - subagent runtime exposing `getProvider`.
 * @param {Record<string, { provider: string, inheritsParentContext: boolean }>} [services.modes] - mode registry.
 * @returns {(inheritContext: boolean|undefined) => { mode: "fresh"|"inherit", provider: string, pinnable: boolean }} bound resolver.
 */
export function resolveModeBackend({ subagents, modes = DEFAULT_CONTEXT_MODES }) {
  return (inheritContext) => resolveContextBackend({ subagents, inheritContext, modes });
}
