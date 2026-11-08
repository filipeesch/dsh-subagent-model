/** Task fields for one explicit-route delegation. */

/**
 * Build the task portion of the host activation spec. The caller spreads these
 * fields onto `ctx.subagents.startActivation` together with the provider, label,
 * child name, cancellation signal, and delivery policy, which the activation
 * owns rather than the task.
 * @param {object} input - validated delegation inputs.
 * @param {object} input.args - model-facing arguments.
 * @param {object} input.parent - calling agent.
 * @param {{ provider: string, model: string, reasoningEffort?: string }} input.route - resolved child route.
 * @param {number|undefined} input.maxDepth - Host depth limit, when one applies.
 * @returns {object} task fields spread onto the activation spec.
 */
export function buildActivationTask({ args, parent, route, maxDepth }) {
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
