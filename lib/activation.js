/** Task fields for one explicit-route delegation. */

/**
 * Build the task portion of the host activation spec. The caller spreads these
 * fields onto `ctx.subagents.startActivation` together with the provider, label,
 * child name, cancellation signal, and delivery policy, which the activation
 * owns rather than the task.
 *
 * The host carries a parent effort into the child unless the route changed, so an
 * effort this delegation deliberately settled on nothing is stated as an explicit
 * `undefined` override. Omitting the key would let the caller effort reach a
 * child the plugin never validated it for.
 * @param {object} input - validated delegation inputs.
 * @param {object} input.args - model-facing arguments.
 * @param {object} input.parent - calling agent.
 * @param {{ provider: string, model: string, reasoningEffort?: string, clearsEffort?: boolean }} input.route - resolved child route.
 * @param {number|undefined} input.maxDepth - Host depth limit, when one applies.
 * @returns {object} task fields spread onto the activation spec.
 */
export function buildActivationTask({ args, parent, route, maxDepth }) {
  const agentOptions = {
    provider: route.provider,
    model: route.model,
    reasoningEffort: route.reasoningEffort
  };
  return {
    prompt: [{ type: "text", text: args.prompt }],
    parent,
    agentOptions,
    ...(maxDepth === undefined ? {} : { maxDepth }),
    ...(args.cwd === undefined ? {} : { cwd: args.cwd })
  };
}
