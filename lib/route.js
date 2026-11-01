/** Child LLM route resolution for explicit-route delegation. */

import { assertNonEmpty } from "./fields.js";

/** @typedef {{ provider?: string, model?: string, reasoningEffort?: string }} Route */

/**
 * Read the route the calling agent is currently using. The latest request
 * header owns the route after request-time selection; creation options are the
 * fallback before the first request.
 * @param {object} parent - calling agent.
 * @returns {Route} detached provider, model, and optional reasoning effort.
 */
export function parentRoute(parent) {
  const config = parent?.session?.requestHeader?.()?.config;
  if (config === undefined) {
    return { provider: parent?.options?.provider, model: parent?.options?.model };
  }
  return {
    provider: config.provider,
    model: config.model,
    ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort })
  };
}

/**
 * Resolve the child route and prove it on a live adapter before a child starts.
 * @param {object|undefined} llm - LLM runtime, when the host provides one.
 * @param {object} parent - calling agent whose route may supply the provider.
 * @param {{ provider?: string, model?: string, reasoning_effort?: string }} args - model-facing selection.
 * @param {AbortSignal} signal - tool-call cancellation signal.
 * @returns {Promise<Route>} validated provider, model, and optional effort.
 */
export async function resolveRoute(llm, parent, args, signal) {
  if (args.provider !== undefined && args.model === undefined) {
    throw new Error("`provider` and `model` must be supplied together");
  }
  if (args.model === undefined) throw new Error("`model` must be a non-empty string");
  assertNonEmpty(args.model, "model");
  if (args.provider !== undefined) assertNonEmpty(args.provider, "provider");
  if (args.reasoning_effort !== undefined) assertNonEmpty(args.reasoning_effort, "reasoning_effort");

  const inherited = parentRoute(parent);
  const provider = args.provider ?? inherited.provider;
  if (typeof provider !== "string" || provider.length === 0) {
    throw new Error("no LLM provider route: pass `provider` or run under an agent that has one");
  }
  if (llm === undefined) {
    throw new Error("cannot resolve the selected child LLM route because the `llm` service is unavailable");
  }

  const route = {
    provider,
    model: args.model,
    ...(args.reasoning_effort === undefined ? {} : { reasoningEffort: args.reasoning_effort })
  };
  try {
    await llm.resolveCallConfig({
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort })
    }, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    const detail = String((error && error.message) || error);
    const subject = route.reasoningEffort === undefined
      ? 'model "' + route.model + '"'
      : 'model "' + route.model + '" with reasoning effort "' + route.reasoningEffort + '"';
    throw new Error(subject + ' is not available on provider "' + route.provider + '": ' + detail);
  }
  return route;
}
