/** Child LLM route resolution for explicit-route delegation. */

import {
  EFFORT_REQUIRES_MODEL_TEXT,
  NO_LLM_SERVICE_TEXT,
  NO_MODEL_ROUTE_TEXT,
  NO_PROVIDER_ROUTE_TEXT,
  PROVIDER_REQUIRES_MODEL_TEXT,
  unknownModelText,
  unknownProviderText
} from "./descriptions.js";
import { assertNonEmpty } from "./fields.js";

/** Failure code an adapter raises when the model does not offer the requested effort. */
const UNSUPPORTED_REASONING_EFFORT = "UNSUPPORTED_REASONING_EFFORT";
/** Failure code the registry raises when a provider id is not registered. */
const NO_ADAPTER = "NO_ADAPTER";

/**
 * @typedef {object} Route
 * @property {string} provider - provider the child runs on.
 * @property {string} model - model the child runs on.
 * @property {string} [reasoningEffort] - effort the child runs with, when it has one. Absent
 *   means the child starts with no effort, which the activation states explicitly because the
 *   host would otherwise carry the caller effort into a child this plugin never validated it for.
 */

/**
 * Read the route the calling agent is currently using. The latest request
 * header owns the route after request-time selection; creation options are the
 * fallback before the first request.
 * @param {object} parent - calling agent.
 * @returns {{ provider?: string, model?: string, reasoningEffort?: string }} detached route.
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
 * Read the failure code from any thrown value without importing the host error
 * type: the shared base exposes it as a plain string property.
 * @param {unknown} error - thrown value.
 * @returns {string|undefined} the failure code, when one is present.
 */
function failureCode(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

/**
 * Start an adapter call and follow it, but reject with the caller cancellation
 * reason the moment the signal fires. The call is started only after the abort
 * check, so an already-cancelled call never reaches the provider.
 * @param {() => Promise<unknown>} start - starts the adapter call.
 * @param {AbortSignal|undefined} signal - tool-call cancellation signal.
 * @returns {Promise<unknown>} the call own settlement, or the cancellation.
 */
function abortable(start, signal) {
  if (signal === undefined) return start();
  // The listener is installed before the call starts: a synchronous abort raised by the adapter
  // itself must still win over whatever that call later returns.
  const settled = Promise.withResolvers();
  const onAbort = () => settled.reject(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const release = () => signal.removeEventListener("abort", onAbort);
  if (signal.aborted) {
    release();
    settled.reject(signal.reason);
    return settled.promise;
  }
  try {
    start().then(
      (value) => { release(); settled.resolve(value); },
      (error) => { release(); settled.reject(error); }
    );
  } catch (error) {
    release();
    settled.reject(error);
  }
  return settled.promise;
}

/**
 * Give an unregistered provider the actionable wording the registry does not
 * carry. Every other failure is returned untouched so its code, type, and
 * identity survive to the caller.
 * @param {unknown} error - the failure to consider.
 * @param {string} provider - provider that was requested.
 * @returns {unknown} the caller-facing failure.
 */
function withProviderHint(error, provider) {
  if (failureCode(error) !== NO_ADAPTER) return error;
  const hinted = new Error(unknownProviderText(provider), { cause: error });
  hinted.code = NO_ADAPTER;
  return hinted;
}

/**
 * Prove a supplied model is one the provider advertises. A provider that
 * advertises no models cannot decide the call, so it is left to resolve the
 * route itself; that keeps backends without a catalog working. An unregistered
 * provider fails here, before any route resolution.
 * @param {object} llm - LLM runtime.
 * @param {string} provider - provider the child would run on.
 * @param {string} model - requested model id.
 * @param {AbortSignal} signal - tool-call cancellation signal.
 * @returns {Promise<void>} resolves when the model is advertised or undecidable.
 */
async function assertAdvertisedModel(llm, provider, model, signal) {
  let models;
  try {
    // The pinned `listModels` accepts no signal, so cancellation is observed around the call
    // rather than inside it; a catalog failure still surfaces while the signal is live.
    models = await abortable(() => llm.listModels(provider), signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw withProviderHint(error, provider);
  }
  signal?.throwIfAborted();
  if (models.length === 0) return;
  if (models.some((candidate) => candidate.id === model)) return;
  throw new Error(unknownModelText(provider));
}

/**
 * Compose the route the child actually runs with. An effort nothing resolved is
 * stated as cleared, never left absent, because the host would otherwise carry
 * the caller effort into a child the plugin never validated it for.
 * @param {{ provider: string, model: string, requestedEffort?: string }} requested - route to settle.
 * @param {object|undefined} resolved - config the adapter returned.
 * @returns {Route} the settled route.
 */
function settledRoute({ provider, model, requestedEffort }, resolved) {
  const effort = resolved?.reasoningEffort ?? requestedEffort;
  return {
    provider,
    model,
    ...(effort === undefined ? {} : { reasoningEffort: effort })
  };
}

/**
 * Resolve one route on a live adapter, dropping an effort the caller supplied
 * that the model does not offer so the child still starts with the model
 * default.
 * @param {object} llm - LLM runtime.
 * @param {{ provider: string, model: string, reasoningEffort?: string }} route - route to resolve.
 * @param {"explicit"|"inherited"|"none"} effortKind - where the requested effort came from.
 * @param {AbortSignal} signal - tool-call cancellation signal.
 * @returns {Promise<Route>} the settled route.
 */
async function proveRoute(llm, route, effortKind, signal) {
  const request = {
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort })
  };
  const settled = { provider: route.provider, model: route.model, requestedEffort: route.reasoningEffort };
  let resolved;
  try {
    resolved = await abortable(() => llm.resolveCallConfig(request, signal), signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    // Only an effort the caller supplied may fall back: an inherited effort belongs to the
    // route the caller already runs, so rejecting it is a route failure, not a bad pick.
    if (effortKind !== "explicit" || failureCode(error) !== UNSUPPORTED_REASONING_EFFORT) {
      throw withProviderHint(error, route.provider);
    }
    // The model does not offer this effort. Retry without it so the model default applies; the
    // rejected effort is not offered back, so nothing unvalidated reaches the child.
    try {
      resolved = await abortable(
        () => llm.resolveCallConfig({ provider: route.provider, model: route.model }, signal), signal
      );
    } catch (retryError) {
      if (signal?.aborted) throw retryError;
      throw withProviderHint(retryError, route.provider);
    }
    return settledRoute({ provider: route.provider, model: route.model }, resolved);
  }
  return settledRoute(settled, resolved);
}

/**
 * Resolve the child route and prove it on a live adapter before a child starts.
 *
 * Omitting `model` delegates on the calling agent current route, which keeps
 * same-model delegation free of a catalog lookup; a supplied route is always
 * checked against the provider advertised models, and `provider` without
 * `model` stays an error.
 * @param {object|undefined} llm - LLM runtime, when the host provides one.
 * @param {object} parent - calling agent whose route may supply the provider and model.
 * @param {{ provider?: string, model?: string, reasoning_effort?: string }} args - model-facing selection.
 * @param {AbortSignal} signal - tool-call cancellation signal.
 * @returns {Promise<Route>} validated provider, model, and settled effort.
 */
export async function resolveRoute(llm, parent, args, signal) {
  if (args.provider !== undefined && args.model === undefined) {
    throw new Error(PROVIDER_REQUIRES_MODEL_TEXT);
  }
  if (args.reasoning_effort !== undefined && args.model === undefined) {
    throw new Error(EFFORT_REQUIRES_MODEL_TEXT);
  }
  if (args.model !== undefined) assertNonEmpty(args.model, "model");
  if (args.provider !== undefined) assertNonEmpty(args.provider, "provider");
  if (args.reasoning_effort !== undefined) assertNonEmpty(args.reasoning_effort, "reasoning_effort");

  const inherited = parentRoute(parent);
  const provider = args.provider ?? inherited.provider;
  const model = args.model ?? inherited.model;
  if (typeof provider !== "string" || provider.length === 0) {
    throw new Error(NO_PROVIDER_ROUTE_TEXT);
  }
  if (typeof model !== "string" || model.length === 0) {
    throw new Error(NO_MODEL_ROUTE_TEXT);
  }
  if (llm === undefined) {
    throw new Error(NO_LLM_SERVICE_TEXT);
  }

  // An omitted model keeps the caller route, so its effort belongs to this child too. A supplied
  // model without an effort reads as "this model default": the caller effort is not carried over.
  const effort = args.reasoning_effort !== undefined
    ? args.reasoning_effort
    : args.model === undefined ? inherited.reasoningEffort : undefined;
  const effortKind = args.reasoning_effort !== undefined
    ? "explicit"
    : args.model === undefined ? "inherited" : "none";
  const requested = {
    provider,
    model,
    ...(effort === undefined ? {} : { reasoningEffort: effort })
  };
  // An inherited route already runs on the caller and needs no catalog lookup; only a supplied
  // model is checked, because that is the value a caller gets wrong.
  if (args.model !== undefined) await assertAdvertisedModel(llm, provider, model, signal);
  return proveRoute(llm, requested, effortKind, signal);
}
