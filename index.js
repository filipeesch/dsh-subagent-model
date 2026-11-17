/**
 * dsh-subagent-model — model-selection subagent delegation tools.
 *
 * Host-half plugin that registers two model-facing tools on the host `tools`
 * registry (the same seam MCP client tools use):
 *   - `list_subagent_routes`: enumerate the LLM routes available for delegation.
 *   - `subagent_model`: delegate to a subagent on an explicitly selected route
 *     through the `ctx.subagents` activation seam.
 *
 * While loaded it hides the host delegation tools it replaces (`subagent`,
 * `subagent_fork`, `list_subagent_models`, `workflow`) and contributes the
 * model-facing guidance those tools used to carry. Publishes no service and
 * imports no `@deepseek-ai` package, so it loads from any profile bundle
 * without resolving host packages.
 */

import { createCatalogTool } from "./lib/catalog.js";
import { resolveConfig } from "./lib/config.js";
import { createDelegationTool } from "./lib/delegation.js";
import { installGuidance } from "./lib/guidance.js";
import { installNativeMask } from "./lib/native-mask.js";

const name = "subagent-model";
const inject = ["tools", "subagents", "llm", "agents", "systemPrompt"];

/**
 * Register the catalog and delegation tools, mask the host delegation surface,
 * and contribute the delegation guidance. Registration and the mask are
 * owner-scoped: disposing this plugin's fiber removes its tools, releases every
 * restriction it applied, and drops its prompt contributions.
 * @param {object} ctx - host context carrying the injected services.
 * @param {object} [config] - composition row configuration with `backends.fresh` and `backends.inherit`.
 * @returns {void}
 */
function apply(ctx, config) {
  const { contextModes } = resolveConfig(config);
  const mask = installNativeMask({
    events: ctx,
    agents: ctx.agents,
    tools: ctx.tools,
    logger: ctx.logger
  });
  const guidance = installGuidance({
    systemPrompt: ctx.systemPrompt,
    subagents: ctx.subagents,
    mask
  });
  ctx.effect(() => () => {
    guidance.dispose();
    mask.dispose();
  }, "subagent-model: native mask and guidance");

  ctx.tools.register(createCatalogTool(ctx.llm));
  ctx.tools.register(createDelegationTool({
    llm: ctx.llm,
    subagents: ctx.subagents,
    contextModes
  }));
}

export { apply, inject, name };
