/**
 * dsh-subagent-model — model-selection subagent delegation tools.
 *
 * Host-half plugin that registers two model-facing tools on the host `tools`
 * registry (same seam the MCP client uses):
 *   - `list_subagent_models`: enumerate models across registered LLM providers.
 *   - `subagent_model`: delegate to a subagent running a caller-chosen model
 *     (per-call provider/model override through the `ctx.subagents` seam).
 *
 * Publishes no service, so it needs no isolate realm. Zero runtime imports.
 */

const name = "subagent-model";
const inject = ["tools", "subagents", "llm"];

/** Subagent transport backend, mirroring the native `subagent` tool's spawn row. */
const SUBAGENT_BACKEND = "spawn";

function outputValueText(values) {
  return (Array.isArray(values) ? values : [])
    .filter((v) => v && typeof v === "object" && !Array.isArray(v) && v.type === "text" && typeof v.text === "string")
    .map((v) => v.text)
    .join("");
}

function stopReasonError(result) {
  switch (result && result.stopReason) {
    case "completed": return;
    case "aborted": return "subagent run was cancelled";
    case "error": return "subagent run failed";
    case "max-tokens": return "subagent run hit its token limit before finishing";
    case "refusal": return "subagent declined the task";
    default: return "subagent run ended abnormally (" + String(result && result.stopReason) + ")";
  }
}

function withPartialText(error, output) {
  const text = (Array.isArray(output) ? output : [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("");
  return text.length === 0 ? error : error + "\nPartial output before the run ended:\n" + text;
}

/** Await the child's result, then dispose (sequential — dispose cancels the run). */
async function settleForegroundRun(run) {
  const [execution] = await Promise.allSettled([
    run.result.then((result) => {
      const error = stopReasonError(result);
      if (error !== undefined) throw new Error(withPartialText(error, result.output));
      return { kind: "foreground", runId: run.id, output: result.output };
    })
  ]);
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())]);
  if (execution.status === "rejected") {
    if (disposal.status === "rejected") throw new Error("subagent run failed: " + String(execution.reason) + "; dispose failed: " + String(disposal.reason));
    throw execution.reason;
  }
  if (disposal.status === "rejected") throw disposal.reason;
  return execution.value;
}

function apply(ctx) {
  const llm = ctx.get("llm");
  const subagents = ctx.get("subagents");

  if (llm !== undefined) {
    ctx.tools.register({
      name: "list_subagent_models",
      description: "List the models available for subagent delegation, grouped by provider route. Call this before `subagent_model` to obtain a valid `model` id (and, optionally, a `provider` route).",
      parameters: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            description: "Optional provider route (or provider display name) to filter. Omit to list every registered provider."
          }
        }
      },
      output: {
        schema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              provider: { type: "string" },
              model: { type: "string" },
              name: { type: "string" },
              description: { type: "string" }
            },
            required: ["provider", "model"]
          }
        },
        render: (_args, value) => {
          const entries = Array.isArray(value) ? value : [];
          if (entries.length === 0) return [{ type: "text", text: "No models found for the requested provider(s)." }];
          const lines = entries.map((m) => m.provider + " :: " + m.model + (m.name ? " (" + m.name + ")" : "") + (m.description ? " - " + m.description : "")).join("\n");
          return [{ type: "text", text: lines }];
        }
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const providers = llm.listProviders();
        if (!Array.isArray(providers) || providers.length === 0) return [];
        const filter = args.provider;
        const selected = filter === undefined ? providers : providers.filter((p) => p && (p.id === filter || p.name === filter));
        const out = [];
        for (const p of selected) {
          if (!p || typeof p.id !== "string") continue;
          let models;
          try {
            models = await llm.listModels(p.id);
          } catch (error) {
            continue;
          }
          for (const m of Array.isArray(models) ? models : []) {
            if (!m || typeof m.id !== "string") continue;
            out.push({
              provider: p.id,
              model: m.id,
              ...(typeof m.name === "string" ? { name: m.name } : {}),
              ...(typeof m.description === "string" ? { description: m.description } : {})
            });
          }
        }
        return out;
      }
    });
  }

  if (subagents !== undefined) {
    ctx.tools.register({
      name: "subagent_model",
      description: "Delegate a self-contained task to a subagent running a specific model (a separate agent in its own context, seeded with no parent turns). The subagent returns its result, not its intermediate steps; give it a complete, standalone prompt. This tool runs in the background by default, immediately returning a durable subagent id; send `send_message` to continue that child later, and the runtime notifies you when it settles. Set `run_in_background: false` only when your next action depends on receiving the result. Use `list_subagent_models` to obtain a valid `model` id.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "A short (3-5 word) description of the delegated task, for display." },
          prompt: { type: "string", description: "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs." },
          model: { type: "string", description: "The model id to run the subagent with (from `list_subagent_models`)." },
          provider: { type: "string", description: "Optional LLM provider route for the model; defaults to this agent's own provider." },
          run_in_background: { type: "boolean", description: "Whether to run in the background and return a durable subagent id immediately. Defaults to true. Set false to wait for the result." }
        },
        required: ["description", "prompt", "model"]
      },
      output: {
        schema: {
          oneOf: [
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "continuable" },
                subagentId: { type: "string" }
              },
              required: ["kind", "subagentId"]
            },
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "foreground" },
                runId: { type: "string" },
                output: { type: "array", items: { type: "object" } }
              },
              required: ["kind", "runId", "output"]
            }
          ]
        },
        render: (_args, value) => [{
          type: "text",
          text: value.kind === "continuable" ? "started subagent " + value.subagentId : outputValueText(value.output)
        }]
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const parent = exec.agent;
        if (!parent) throw new Error("subagent_model requires a calling agent (exec.agent was undefined)");
        const llmProvider = args.provider !== undefined ? args.provider : parent.options.provider;
        if (typeof llmProvider !== "string" || llmProvider.length === 0) throw new Error("no LLM provider route: pass `provider` or run under an agent that has one");
        if (typeof args.model !== "string" || args.model.length === 0) throw new Error("`model` is required");

        if (llm !== undefined) {
          try {
            await llm.resolveModelInfo(llmProvider, args.model, exec.signal);
          } catch (error) {
            throw new Error('model "' + args.model + '" is not available on provider "' + llmProvider + '": ' + String((error && error.message) || error));
          }
        }

        const request = {
          label: args.description,
          prompt: [{ type: "text", text: args.prompt }],
          parent,
          agentOptions: { provider: llmProvider, model: args.model },
          maxDepth: 3
        };

        if (args.run_in_background !== false) {
          return {
            kind: "continuable",
            subagentId: (await subagents.startContinuable({
              provider: SUBAGENT_BACKEND,
              label: args.description,
              request,
              signal: exec.signal
            })).childId
          };
        }

        return settleForegroundRun(await subagents.start(SUBAGENT_BACKEND, {
          ...request,
          signal: exec.signal
        }));
      }
    });
  }
}

export { apply, inject, name };
