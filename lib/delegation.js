/** Model-facing delegation to a subagent on an explicitly selected model. */

import { buildActivationTask } from "./activation.js";
import { DEFAULT_CONTEXT_MODES, resolveContextBackend } from "./context-modes.js";
import { assertBoolean, assertDeclaredArguments, assertNonEmpty } from "./fields.js";
import { resolveRoute } from "./route.js";

/**
 * Build the explicit-route delegation tool. Every call starts one managed
 * activation and lets the runtime deliver the child's answer to the parent;
 * the Host's resolved depth limit is forwarded so recursion stays governed in
 * one place. The context-mode registry selects the fresh or inheriting backend.
 * @param {{ llm: object|undefined, subagents: object, contextModes?: object }} services - injected host services.
 * @returns {object} tool definition.
 */
export function createDelegationTool({ llm, subagents, contextModes = DEFAULT_CONTEXT_MODES }) {
  const properties = {
    description: { type: "string", description: "A short (3-5 word) description of the delegated task, for display." },
    prompt: { type: "string", description: "The task for the subagent. With `inherit_context: true` the child already sees this conversation's completed turns, so build on them and state only what is new. Otherwise it does not share this conversation's context, so include everything it needs." },
    inherit_context: { type: "boolean", description: "When true, seed the child with this conversation's completed turns from the immediate calling agent (the current in-flight turn is excluded). Those turns are sent to the selected provider, and changing the route can prevent provider-side reuse of the inherited prefix. Defaults to false: a fresh child with its own context." },
    model: { type: "string", description: "The model id to run the subagent with (from `list_subagent_routes`)." },
    name: { type: "string", description: "Optional short name for the child, unique among this agent's children: 1-32 lower-case letters, digits, or hyphens starting with a letter, other than `lead`. Omit to let the host assign `agent-N`." },
    provider: { type: "string", description: "LLM provider id for `model`; defaults to the caller's current provider." },
    reasoning_effort: { type: "string", description: "Model-specific reasoning effort id. When the effective route changes, an omitted effort uses the model's default; otherwise the caller's effort is inherited." },
    cwd: { type: "string", description: "Child working directory; omit to inherit the caller's." }
  };
  return {
    name: "subagent_model",
    description:
      "Delegate a task to a subagent running a caller-chosen model. By default the child starts in its own "
      + "fresh context, so the prompt must be self-contained. Set `inherit_context: true` to seed the child "
      + "with this conversation's completed turns; it does not see the current in-flight turn. Inherited turns "
      + "are sent to the selected provider, and changing the route can prevent provider-side reuse of the "
      + "inherited prefix. The child returns its result to you as a completion notice; use `send_message` to "
      + "steer it while it runs or to continue it afterwards. Run `list_subagent_routes` first to obtain a "
      + "valid provider and model id.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties,
      required: ["description", "prompt", "model"]
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
      resolveContextBackend({
        subagents,
        inheritContext: args.inherit_context,
        modes: contextModes
      });

      const route = await resolveRoute(llm, parent, args, exec.signal);
      exec.signal.throwIfAborted();
      const maxDepth = subagents.resolveMaxDepth();
      const task = buildActivationTask({ args, parent, route, maxDepth });

      // The host looks the provider up again inside startActivation. Revalidate
      // after the awaited route resolution and immediately before the start call,
      // with no await in between, so a replacement cannot swap the context mode.
      const backend = resolveContextBackend({
        subagents,
        inheritContext: args.inherit_context,
        modes: contextModes
      });

      // The host flattened the activation spec: task fields sit on the spec
      // itself, and the activation-owned fields are written after them so a
      // task value can never replace them.
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
