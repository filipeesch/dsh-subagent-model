/** Context-mode selection and backend contract validation for explicit-route delegation. */

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
    throw new Error('no context-mode contract is registered for `inherit_context` mode "' + mode + '"');
  }
  const flag = mode === "inherit" ? "true" : "false";

  const provider = subagents.getProvider(contract.provider);
  if (provider === undefined) {
    throw new Error(
      "inherit_context=" + flag + ' requires the subagent backend "' + contract.provider
      + '", which is not registered in this composition'
    );
  }
  if (provider.inheritsParentContext !== contract.inheritsParentContext) {
    throw new Error(
      'subagent backend "' + contract.provider + '" does not satisfy the '
      + (mode === "inherit" ? "inheritance" : "fresh-context")
      + " contract required by `inherit_context`: expected inheritsParentContext="
      + contract.inheritsParentContext + ", got " + String(provider.inheritsParentContext)
    );
  }
  if (provider.capabilities?.agentOptions !== true) {
    throw new Error(
      'subagent backend "' + contract.provider + '" cannot accept the child `agentOptions` required by '
      + "`subagent_model` (inherit_context=" + flag + ")"
    );
  }
  return { mode, provider: contract.provider };
}
