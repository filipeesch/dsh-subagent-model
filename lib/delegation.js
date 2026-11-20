/** Model-facing delegation to a subagent on an explicitly selected model. */

import { randomUUID } from "node:crypto";

import { buildActivationTask } from "./activation.js";
import { resolveModeBackend } from "./context-modes.js";
import {
  activationResultText,
  unpinnedChildText,
  DELEGATE_TOOL_NAME,
  DELEGATION_DESCRIPTION,
  DELEGATION_PROPERTIES,
  DELEGATION_REQUIRED,
  NO_CALLING_AGENT_TEXT,
  NO_MANAGED_ACTIVATIONS_TEXT
} from "./descriptions.js";
import { assertBoolean, assertDeclaredArguments, assertNonEmpty } from "./fields.js";
import { resolveRoute } from "./route.js";

/**
 * Build the explicit-route delegation tool. Every call starts one managed
 * activation and lets the runtime deliver the child's answer to the parent;
 * the Host's resolved depth limit is forwarded so recursion stays governed in
 * one place. An omitted model delegates on the calling agent's own route, and
 * the context-mode registry selects the fresh or inheriting backend.
 * @param {object} services - injected host services.
 * @param {object|undefined} services.llm - LLM runtime.
 * @param {object} services.subagents - subagent runtime exposing activations.
 * @param {object|undefined} services.modelPin - pins a seeded child to its resolved route.
 * @param {object} [services.contextModes] - context-mode backend registry.
 * @returns {object} tool definition.
 */
export function createDelegationTool({ llm, subagents, modelPin, contextModes }) {
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
          name: { type: "string" },
          reasoningEffort: { type: "string" }
        },
        required: ["kind", "subagentId", "name"]
      },
      // The effective effort is reported because a requested effort the model does not offer is
      // dropped in favor of the model default, and a silent substitution would be invisible here.
      render: (_args, value) => [{ type: "text", text: activationResultText(value) }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      assertDeclaredArguments(args, Object.keys(properties));
      const parent = exec.agent;
      if (parent === undefined) {
        throw new Error(NO_CALLING_AGENT_TEXT);
      }
      assertNonEmpty(args.description, "description");
      assertNonEmpty(args.prompt, "prompt");
      assertBoolean(args.inherit_context, "inherit_context");
      if (args.cwd !== undefined) assertNonEmpty(args.cwd, "cwd");
      if (args.name !== undefined) assertNonEmpty(args.name, "name");
      if (typeof subagents.startActivation !== "function") {
        throw new Error(NO_MANAGED_ACTIVATIONS_TEXT);
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
      //
      // A seeded local child replays the parent request header, and the host prefers a recorded
      // selection over creation options, so its resolved route is pinned by identity. A reserved id
      // is only legal for a local backend, and an external backend treats the creation options as
      // its own defaults, so only a seeded pinnable child is reserved at all.
      const pins = modelPin !== undefined && backend.pinnable && args.inherit_context === true;
      const childId = pins ? randomUUID() : undefined;
      if (childId !== undefined) modelPin.register(childId, { ...route, backend: backend.provider });
      let started;
      let pinned = true;
      try {
        started = await subagents.startActivation({
          ...task,
          provider: backend.provider,
          ...(childId === undefined ? {} : { childId }),
          ...(args.name === undefined ? {} : { name: args.name }),
          label: args.description,
          signal: exec.signal,
          delivery: "parent"
        });
        if (childId !== undefined) pinned = modelPin.settle(childId);
      } catch (error) {
        // A start that produced no child leaves a reservation nobody will consume.
        if (childId !== undefined) modelPin.settle(childId);
        throw error;
      }
      // Reporting the route for a child that never took it would be the same silent divergence the
      // pin exists to remove, so an unapplied pin fails the call instead. The child is already live
      // and may be working on the wrong route, so it is stopped before the caller can retry and
      // leave a second copy running.
      if (!pinned) {
        let stopped = true;
        let disposeError;
        try {
          await started.dispose();
        } catch (error) {
          stopped = false;
          disposeError = error;
        }
        // The recovery advice depends on whether the wrong-route child was actually stopped.
        const failure = new Error(unpinnedChildText(backend.provider, { childId: started.childId, stopped }));
        if (disposeError !== undefined) failure.cause = disposeError;
        throw failure;
      }
      return {
        kind: "activation",
        subagentId: started.childId,
        name: started.name,
        ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort })
      };
    }
  };
}
