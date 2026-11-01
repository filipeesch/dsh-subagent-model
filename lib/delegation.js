/** Model-facing delegation to a subagent on an explicitly selected model. */

import { assertNonEmpty } from "./fields.js";
import { resolveRoute } from "./route.js";

/** Subagent backend this plugin delegates through, matching the shipped spawn row. */
const SUBAGENT_BACKEND = "spawn";

/**
 * Build the explicit-route delegation tool. Every call starts one managed
 * activation and lets the runtime deliver the child's answer to the parent;
 * the Host's resolved depth limit is forwarded so recursion stays governed in
 * one place.
 * @param {{ llm: object|undefined, subagents: object }} services - injected host services.
 * @returns {object} tool definition.
 */
export function createDelegationTool({ llm, subagents }) {
  return {
    name: "subagent_model",
    description:
      "Delegate a self-contained task to a subagent running a caller-chosen model (a separate agent in "
      + "its own context, seeded with no parent turns). The child returns its result to you as a completion "
      + "notice; use `send_message` to steer it while it runs or to continue it afterwards. Run "
      + "`list_subagent_routes` first to obtain a valid provider and model id.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "A short (3-5 word) description of the delegated task, for display." },
        prompt: { type: "string", description: "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs." },
        model: { type: "string", description: "The model id to run the subagent with (from `list_subagent_routes`)." },
        provider: { type: "string", description: "LLM provider id for `model`; defaults to the caller's current provider." },
        reasoning_effort: { type: "string", description: "Model-specific reasoning effort id. When the effective route changes, an omitted effort uses the model's default; otherwise the caller's effort is inherited." },
        cwd: { type: "string", description: "Child working directory; omit to inherit the caller's." }
      },
      required: ["description", "prompt", "model"]
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", const: "activation" },
          subagentId: { type: "string" }
        },
        required: ["kind", "subagentId"]
      },
      render: (_args, value) => [{ type: "text", text: "started subagent " + value.subagentId }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent;
      if (parent === undefined) {
        throw new Error("subagent_model requires a calling agent (exec.agent was undefined)");
      }
      assertNonEmpty(args.description, "description");
      assertNonEmpty(args.prompt, "prompt");
      if (args.cwd !== undefined) assertNonEmpty(args.cwd, "cwd");
      if (typeof subagents.startActivation !== "function") {
        throw new Error("subagent_model requires managed activations (ctx.subagents.startActivation), which this DSH release does not provide");
      }
      if (subagents.getProvider(SUBAGENT_BACKEND) === undefined) {
        throw new Error('subagent backend "' + SUBAGENT_BACKEND + '" is not registered in this composition');
      }

      const route = await resolveRoute(llm, parent, args, exec.signal);
      exec.signal.throwIfAborted();
      const maxDepth = subagents.resolveMaxDepth();

      const agentOptions = {
        provider: route.provider,
        model: route.model,
        ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort })
      };
      const started = await subagents.startActivation({
        provider: SUBAGENT_BACKEND,
        label: args.description,
        request: {
          prompt: [{ type: "text", text: args.prompt }],
          parent,
          agentOptions,
          ...(maxDepth === undefined ? {} : { maxDepth }),
          ...(args.cwd === undefined ? {} : { cwd: args.cwd })
        },
        signal: exec.signal,
        delivery: "parent"
      });
      return { kind: "activation", subagentId: started.childId };
    }
  };
}
