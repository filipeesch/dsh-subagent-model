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
    return {
      provider: parent?.options?.provider,
      model: parent?.options?.model,
      ...(parent?.options?.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: parent.options.reasoningEffort })
    };
  }
  return {
    provider: config.provider,
    model: config.model,
    ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort })
  };
}

/**
 * Resolve the child route and prove it on a live adapter before a child starts.
 *
 * Omitting `model` delegates on the calling agent's current route, which keeps
 * same-model delegation free of a catalog lookup; a supplied route is always
 * validated, and `provider` without `model` stays an error.
 * @param {object|undefined} llm - LLM runtime, when the host provides one.
 * @param {object} parent - calling agent whose route may supply the provider and model.
 * @param {{ provider?: string, model?: string, reasoning_effort?: string }} args - model-facing selection.
 * @param {AbortSignal} signal - tool-call cancellation signal.
 * @returns {Promise<Route>} validated provider, model, and optional effort.
 */
export async function resolveRoute(llm, parent, args, signal) {
  if (args.provider !== undefined && args.model === undefined) {
    throw new Error("`provider` and `model` must be supplied together");
  }
  if (args.reasoning_effort !== undefined && args.model === undefined) {
    throw new Error("`reasoning_effort` requires `model`; supply both or omit `reasoning_effort`");
  }
  if (args.model !== undefined) assertNonEmpty(args.model, "model");
  if (args.provider !== undefined) assertNonEmpty(args.provider, "provider");
  if (args.reasoning_effort !== undefined) assertNonEmpty(args.reasoning_effort, "reasoning_effort");

  const inherited = parentRoute(parent);
  const provider = args.provider ?? inherited.provider;
  const model = args.model ?? inherited.model;
  if (typeof provider !== "string" || provider.length === 0) {
    throw new Error("no LLM provider route: pass `provider` and `model` or run under an agent that has one");
  }
  if (typeof model !== "string" || model.length === 0) {
    throw new Error("no LLM model route: pass `model` or run under an agent that has one");
  }
  if (llm === undefined) {
    throw new Error("cannot resolve the selected child LLM route because the `llm` service is unavailable");
  }

  // An omitted model keeps the calling agent's route, so its effort is forwarded explicitly; a
  // supplied model without an effort lets the selected model apply its own default.
  const effort = args.reasoning_effort !== undefined
    ? args.reasoning_effort
    : args.model === undefined ? inherited.reasoningEffort : undefined;
  const route = {
    provider,
    model,
    ...(effort === undefined ? {} : { reasoningEffort: effort })
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
