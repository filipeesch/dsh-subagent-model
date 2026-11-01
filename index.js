/**
 * dsh-subagent-model — model-selection subagent delegation tools.
 *
 * Host-half plugin that registers two model-facing tools on the host `tools`
 * registry (the same seam MCP client tools use):
 *   - `list_subagent_routes`: enumerate the LLM routes available for delegation.
 *   - `subagent_model`: delegate to a subagent on an explicitly selected route
 *     through the `ctx.subagents` activation seam.
 *
 * Publishes no service and imports no `@deepseek-ai` package, so it loads from
 * any profile bundle without resolving host packages.
 */

import { createCatalogTool } from "./lib/catalog.js";
import { createDelegationTool } from "./lib/delegation.js";

const name = "subagent-model";
const inject = ["tools", "subagents", "llm"];

/**
 * Register the catalog and delegation tools. Registration is owner-scoped: the
 * tool registry removes both when this plugin's fiber unloads.
 * @param {object} ctx - host context carrying `tools`, `subagents`, and `llm`.
 * @returns {void}
 */
function apply(ctx) {
  ctx.tools.register(createCatalogTool(ctx.llm));
  ctx.tools.register(createDelegationTool({ llm: ctx.llm, subagents: ctx.subagents }));
}

export { apply, inject, name };
