/** Model-facing delegation to a subagent on an explicitly selected model. */

import { buildActivationTask } from "./activation.js";
import { resolveModeBackend } from "./context-modes.js";
import {
  DELEGATE_TOOL_NAME,
  DELEGATION_DESCRIPTION,
  DELEGATION_PROPERTIES,
  DELEGATION_REQUIRED
} from "./descriptions.js";
import { assertBoolean, assertDeclaredArguments, assertNonEmpty } from "./fields.js";
import { resolveRoute } from "./route.js";

/**
 * Build the explicit-route delegation tool. Every call starts one managed
 * activation and lets the runtime deliver the child's answer to the parent;
 * the Host's resolved depth limit is forwarded so recursion stays governed in
 * one place. An omitted model delegates on the calling agent's own route, and
 * the context-mode registry selects the fresh or inheriting backend.
 * @param {{ llm: object|undefined, subagents: object, contextModes?: object }} services - injected host services.
 * @returns {object} tool definition.
 */
export function createDelegationTool({ llm, subagents, contextModes }) {
  const properties = DELEGATION_PROPERTIES;
  const backendFor = resolveModeBackend({ subagents, modes: contextModes });
  return {
    name: DELEGATE_TOOL_NAME,
    description: DELEGATION_DESCRIPTION,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties,
      required: DELEGATION_REQUIRED
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", const: "activation" },
          subagentId: { type: "string" },
          name: { type: "string" }
        },
        required: ["kind", "subagentId", "name"]
      },
      render: (_args, value) => [{ type: "text", text: "started subagent " + value.name + " (" + value.subagentId + ")" }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      assertDeclaredArguments(args, Object.keys(properties));
      const parent = exec.agent;
      if (parent === undefined) {
        throw new Error("subagent_model requires a calling agent (exec.agent was undefined)");
      }
      assertNonEmpty(args.description, "description");
      assertNonEmpty(args.prompt, "prompt");
      assertBoolean(args.inherit_context, "inherit_context");
      if (args.cwd !== undefined) assertNonEmpty(args.cwd, "cwd");
      if (args.name !== undefined) assertNonEmpty(args.name, "name");
      if (typeof subagents.startActivation !== "function") {
        throw new Error("subagent_model requires managed activations (ctx.subagents.startActivation), which this DSH release does not provide");
      }
      // Fail fast before the route call when the backend is missing or incompatible.
      backendFor(args.inherit_context);

      const route = await resolveRoute(llm, parent, args, exec.signal);
      exec.signal.throwIfAborted();
      const maxDepth = subagents.resolveMaxDepth();
      const task = buildActivationTask({ args, parent, route, maxDepth });

      // The host looks the provider up again inside startActivation. Revalidate after the awaited
      // route resolution and immediately before the start call, with no await in between, so a
      // replacement cannot swap the context mode.
      const backend = backendFor(args.inherit_context);

      // The host flattened the activation spec: task fields sit on the spec itself, and the
      // activation-owned fields are written after them so a task value can never replace them.
      const started = await subagents.startActivation({
        ...task,
        provider: backend.provider,
        ...(args.name === undefined ? {} : { name: args.name }),
        label: args.description,
        signal: exec.signal,
        delivery: "parent"
      });
      return { kind: "activation", subagentId: started.childId, name: started.name };
    }
  };
}
