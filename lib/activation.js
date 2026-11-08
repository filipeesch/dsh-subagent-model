/** Pure activation-request construction for explicit-route delegation. */

/**
 * Build the request passed to `ctx.subagents.startActivation`.
 * @param {object} input - validated delegation inputs.
 * @param {object} input.args - model-facing arguments.
 * @param {object} input.parent - calling agent.
 * @param {{ provider: string, model: string, reasoningEffort?: string }} input.route - resolved child route.
 * @param {number|undefined} input.maxDepth - Host depth limit, when one applies.
 * @returns {object} activation request.
 */
export function buildActivationRequest({ args, parent, route, maxDepth }) {
  const agentOptions = {
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort })
  };
  return {
    prompt: [{ type: "text", text: args.prompt }],
    parent,
    agentOptions,
    ...(maxDepth === undefined ? {} : { maxDepth }),
    ...(args.cwd === undefined ? {} : { cwd: args.cwd })
  };
}
