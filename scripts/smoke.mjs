#!/usr/bin/env node
/**
 * Isolated loader smoke for dsh-subagent-model.
 *
 * Boots a DSH runtime in a throwaway `$DSH_HOME`, links this package into a
 * profile cloned from the `headless` template, and drives one-shot tasks
 * against a local Messages-API stub. The stub answers with scripted tool calls
 * so the smoke proves registration, execution, and — with `delegation` — a real
 * `subagent_model` activation under the real loader, without credentials or
 * outbound traffic.
 *
 * The host must provide the flattened activation spec (`>=0.2.2-rc.1`). The
 * installed desktop runtime can predate it, so a `.dsh` development checkout is
 * the expected host for the delegation lane.
 *
 * Stub script (per run):
 *   1. first main-agent request                    -> `list_subagent_routes` call
 *   2. after a result (mask lane)                  -> one call per masked probe tool
 *   3. after a result (delegation lane)            -> `subagent_model` call
 *   4. child-agent request                         -> final text for the child
 *   5. after a result (delegation lane)            -> `subagent_model` with an undeclared argument
 *   6. after a result                              -> final text for the parent
 *
 * Environment:
 *   DSH_BIN       runtime executable to boot (highest priority)
 *   DSH_DEV_CLI   DSH checkout entry, such as <checkout>/apps/cli/src/bin.ts;
 *                 booted as `node --import tsx/esm <entry>` from the checkout root
 *   SMOKE_KEEP    keep the throwaway `$DSH_HOME` for inspection
 *   SMOKE_DEBUG   print session event types and the stub request log
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROFILE = "subagent-model-smoke";
const RUN_TIMEOUT_MS = 120_000;
const TOOL_NAME = "list_subagent_routes";
const DELEGATION_TOOL_NAME = "subagent_model";
/** Route the scripted delegation asks for; the throwaway profile serves it from the stub. */
const PROVIDER = "deepseek-official";
const CHILD_MODEL = "deepseek-flash";
/** Model the seeded lane requests; it must differ from the parent route for the check to bite. */
const SEEDED_CHILD_MODEL = "deepseek-v4-pro";
/** Effort the seeded lane requests; the parent runs `high`, so this must not be `high`. */
const SEEDED_CHILD_EFFORT = "max";
/** Child name the seeded lane requests. */
const SEEDED_CHILD_NAME = "smoke-seeded";
/** Child name the scripted delegation requests, unique among the calling agent's children. */
const CHILD_NAME = "smoke-child";
/** Host delegation tools the plugin must hide from the model-facing catalog. */
const MASKED_TOOL_NAMES = ["subagent", "subagent_fork", "list_subagent_models", "workflow"];
/** Masked tools the scripted lane calls anyway; the guard must refuse each with its replacement. */
const MASKED_PROBES = ["subagent", "list_subagent_models"];

/**
 * Write the overlay that turns the native route fields on, reproducing the composition that
 * motivated this lane: `modelSelection` exposes provider/model on `subagent`, and
 * `modelDiscovery` registers the policy-filtered catalog.
 * @param {string} home - throwaway `$DSH_HOME`.
 * @returns {string} overlay path accepted by `--patch`.
 */
function writeMaskOverlay(home) {
  const path = join(home, "mask-overlay.patch.yml");
  writeFileSync(path, [
    "# Smoke overlay: expose the native route fields so the plugin's mask is exercised.",
    "- id: tool-subagent",
    "  config:",
    "    provider: spawn",
    "    toolName: subagent",
    "    modelSelection: true",
    "    modelDiscovery: true",
    ""
  ].join("\n"));
  return path;
}

/**
 * Flatten one tool result's model-facing text.
 * @param {object} message - recorded tool message.
 * @returns {string} concatenated text blocks.
 */
function contentText(message) {
  return (message.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join(" ");
}

/** Throwaway `$DSH_HOME` of the current run, reported when the run fails and is kept. */
let currentHome;
let currentKeep = false;

/** How to boot the host runtime and where its own module resolution expects to run. */
function resolveHost() {
  const binary = process.env.DSH_BIN?.trim();
  if (binary !== undefined && binary.length > 0) {
    return { command: binary, prefix: [], cwd: undefined, source: "DSH_BIN" };
  }
  const devCli = process.env.DSH_DEV_CLI?.trim();
  if (devCli !== undefined && devCli.length > 0) {
    const entry = resolve(devCli);
    const root = checkoutRootFor(entry);
    if (root === undefined) {
      throw new Error(
        "DSH_DEV_CLI=" + devCli + " does not name a DSH checkout entry; expected a path such as"
        + " <checkout>/apps/cli/src/bin.ts"
      );
    }
    return { command: process.execPath, prefix: ["--import", "tsx/esm", entry], cwd: root, source: "DSH_DEV_CLI" };
  }
  return { command: "dsh", prefix: [], cwd: undefined, source: "PATH" };
}

/**
 * Walk up from a CLI entry to the checkout root that owns `apps/cli/src/bin.ts`.
 * @param {string} entry - absolute entry path.
 * @returns {string|undefined} the checkout root, or undefined when the entry is elsewhere.
 */
function checkoutRootFor(entry) {
  if (!existsSync(entry)) return undefined;
  let directory = dirname(entry);
  while (true) {
    if (existsSync(join(directory, "apps", "cli", "src", "bin.ts"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** Report the exact variables that select a supported runtime. */
function hostHint() {
  return "set DSH_BIN=<runtime executable> or DSH_DEV_CLI=<checkout>/apps/cli/src/bin.ts to a DSH build that"
    + " provides the flattened activation spec (>=0.2.2-rc.1)";
}

/**
 * Run one CLI step to completion.
 * @param {object} host - resolved runtime from {@link resolveHost}.
 * @param {string[]} args - CLI arguments.
 * @param {Record<string, string>} env - child environment.
 * @param {string} cwd - working directory when the host does not require its own.
 * @returns {{ status: number|null, stdout: string, stderr: string, error?: Error }}
 */
function runDsh(host, args, env, cwd) {
  return spawnSync(host.command, [...host.prefix, ...args], {
    cwd: host.cwd ?? cwd,
    env,
    encoding: "utf8",
    timeout: RUN_TIMEOUT_MS
  });
}

/**
 * Run one CLI pass to completion and capture its output.
 * @param {object} host - resolved runtime from {@link resolveHost}.
 * @param {object} options - run inputs.
 * @param {string[]} options.args - arguments after the profile flags.
 * @param {Record<string, string>} options.env - child environment.
 * @param {string} options.cwd - working directory.
 * @param {string} [options.overlay] - profile patch to apply.
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string }>} the finished run.
 */
async function runOnce(host, { args, env, cwd, overlay }) {
  const overlayArgs = overlay === undefined ? [] : ["--patch", overlay];
  return await new Promise((resolve) => {
    const child = spawn(host.command, [...host.prefix, "--profile", PROFILE, ...overlayArgs, ...args], { env, cwd: host.cwd ?? cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + "\nspawn error: " + String((error && error.message) || error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Append one SSE frame.
 * @param {import('node:http').ServerResponse} response - open response.
 * @param {Record<string, unknown>} payload - event payload; its `type` names the frame.
 * @returns {void}
 */
function writeEvent(response, payload) {
  response.write("event: " + payload.type + "\n");
  response.write("data: " + JSON.stringify(payload) + "\n\n");
}

/**
 * Answer a request with one scripted tool call.
 * @param {import('node:http').ServerResponse} response - open response.
 * @param {string} id - tool-use id echoed by the runtime.
 * @param {string} name - tool name to call.
 * @param {object} input - tool arguments.
 * @returns {void}
 */
function respondWithToolCall(response, id, name, input) {
  writeEvent(response, {
    type: "message_start",
    message: { id: "msg_smoke_" + id, type: "message", role: "assistant", content: [], usage: { input_tokens: 12 } }
  });
  writeEvent(response, {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id, name, input: {} }
  });
  writeEvent(response, {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: JSON.stringify(input) }
  });
  writeEvent(response, { type: "content_block_stop", index: 0 });
  writeEvent(response, { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } });
  writeEvent(response, { type: "message_stop" });
  response.end();
}

/**
 * Answer a request with a final assistant text.
 * @param {import('node:http').ServerResponse} response - open response.
 * @param {string} text - final answer.
 * @returns {void}
 */
function respondWithText(response, text) {
  writeEvent(response, {
    type: "message_start",
    message: { id: "msg_smoke_text", type: "message", role: "assistant", content: [], usage: { input_tokens: 42 } }
  });
  writeEvent(response, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  writeEvent(response, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
  writeEvent(response, { type: "content_block_stop", index: 0 });
  writeEvent(response, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } });
  writeEvent(response, { type: "message_stop" });
  response.end();
}

/**
 * Parse a JSON request body without making the stub fail on malformed input.
 * @param {string} body - raw request body.
 * @returns {object|undefined} parsed body when it is a JSON object.
 */
function parseBody(body) {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Start the local Messages-API stub.
 * @param {object} options - stub lane selection.
 * @param {boolean} options.delegation - script a real delegation.
 * @param {boolean} options.mask - probe the masked native tools.
 * @param {boolean} [options.seeded] - request an inheriting child on a resumed turn.
 * @param {string} options.workspace - child directory to request.
 * @returns {Promise<{ port: number, requests: string[], systemBody: () => string, close: () => Promise<void> }>}
 */
async function startStub({ delegation, mask, seeded = false, workspace }) {
  const requests = [];
  let catalogRequested = false;
  let catalogBody;
  let parentSteps = 0;
  /** Route the scripted delegation asked for, reported so a lane can assert it. */
  let scriptedRoute;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push(request.method + " " + request.url + (body.length === 0 ? "" : " " + body.slice(0, 400)));
      if (request.method === "GET" && request.url?.includes("/models")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }));
        return;
      }
      if (request.method !== "POST" || !request.url?.includes("/messages")) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { type: "not_found", message: "unknown stub route" } }));
        return;
      }
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      const advertised = parseBody(body)?.tools?.some((tool) => tool.name === TOOL_NAME) === true;
      // An auxiliary completion (for example a session title) advertises no catalog.
      if (!advertised) {
        respondWithText(response, "SMOKE_AUXILIARY_TURN");
        return;
      }
      if (seeded) {
        // The resumed pass already carries the first pass tool results in its history, so step
        // counting cannot plan it. It scripts exactly one thing: the inheriting delegation.
        if (scriptedRoute === undefined) {
          scriptedRoute = {
            provider: PROVIDER,
            model: SEEDED_CHILD_MODEL,
            reasoningEffort: SEEDED_CHILD_EFFORT
          };
          respondWithToolCall(response, "toolu_delegate", DELEGATION_TOOL_NAME, {
            description: "probe seeded child route",
            prompt: "Reply with the smoke result and use no tools.",
            model: SEEDED_CHILD_MODEL,
            reasoning_effort: SEEDED_CHILD_EFFORT,
            name: SEEDED_CHILD_NAME,
            inherit_context: true,
            cwd: workspace
          });
          return;
        }
        respondWithText(response, "SMOKE_TURN_COMPLETE");
        return;
      }
      if (body.includes('"tool_result"')) {
        parentSteps += 1;
        const plan = [];
        if (seeded) {
          // The resumed pass inherits the first pass tool results, so it must script only the
          // delegation it is meant to observe.
          plan.push("delegate");
        } else {
          if (mask) plan.push(...MASKED_PROBES.map((name) => "probe:" + name));
          if (delegation) plan.push("delegate", "undeclared");
        }
        const action = plan[parentSteps - 1];
        if (action === undefined) {
          respondWithText(response, "SMOKE_TURN_COMPLETE");
          return;
        }
        if (action.startsWith("probe:")) {
          // Each masked native tool must be refused even when the model asks for it anyway.
          respondWithToolCall(response, "toolu_probe_" + action.slice("probe:".length), action.slice("probe:".length), {
            description: "probe masked tool",
            prompt: "unused",
            model: CHILD_MODEL
          });
          return;
        }
        if (action === "delegate") {
          // The seeded lane asks for a model the parent does not use, so a child that silently
          // inherits the parent route cannot satisfy the assertion by accident.
          const requestedModel = seeded ? SEEDED_CHILD_MODEL : CHILD_MODEL;
          scriptedRoute = { provider: PROVIDER, model: requestedModel };
          respondWithToolCall(response, "toolu_delegate", DELEGATION_TOOL_NAME, {
            description: "probe child route",
            prompt: "Reply with the smoke result and use no tools.",
            model: requestedModel,
            name: CHILD_NAME,
            // Inheriting context is what makes the child seeded, so its route must hold against
            // the parent request header the seed carries.
            ...(seeded ? { inherit_context: true } : {}),
            cwd: workspace
          });
          return;
        }
        respondWithToolCall(response, "toolu_undeclared", DELEGATION_TOOL_NAME, {
          description: "reject undeclared argument",
          prompt: "unused",
          model: CHILD_MODEL,
          unexpected_argument: true
        });
        return;
      }
      if (!catalogRequested) {
        catalogRequested = true;
        catalogBody = body;
        respondWithToolCall(response, "toolu_catalog", TOOL_NAME, {});
        return;
      }
      // Any later main-agent-shaped request without a tool result is a child turn.
      respondWithText(response, "SMOKE_CHILD_TURN_COMPLETE");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    port: address.port,
    requests,
    /** The request body that first advertised the plugin catalog; it carries the system prompt. */
    systemBody: () => catalogBody ?? "",
    scriptedRoute: () => scriptedRoute,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

/**
 * Collect session files under the throwaway home.
 * @param {string} home - `$DSH_HOME`.
 * @returns {string[]} persisted session archives.
 */
function findSessionFiles(home) {
  const sessionsRoot = join(home, "sessions");
  if (!existsSync(sessionsRoot)) return [];
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const candidate = join(directory, entry);
      if (statSync(candidate).isDirectory()) walk(candidate);
      else if (entry === "session.v4.jsonl.zstd" || entry === "session.v4.jsonl") found.push(candidate);
    }
  };
  walk(sessionsRoot);
  return found;
}

/**
 * Read one persisted session as decoded events. A compressed log is an
 * append-only sequence of independently compressed zstd frames, so frames are
 * decoded one by one; a zstd magic sequence can also occur inside a payload, so
 * a segment that does not decode on its own is extended with the next one.
 * @param {string} file - session archive path.
 * @returns {object[]} decoded session events.
 */
function readSessionEvents(file) {
  const buffer = readFileSync(file);
  if (!file.endsWith(".zstd")) {
    return buffer.toString("utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
  }
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const offsets = [];
  let cursor = 0;
  while ((cursor = buffer.indexOf(magic, cursor)) !== -1) {
    offsets.push(cursor);
    cursor += magic.length;
  }
  const text = [];
  let pending = Buffer.alloc(0);
  for (let index = 0; index < offsets.length; index += 1) {
    const segment = buffer.subarray(offsets[index], offsets[index + 1] ?? buffer.length);
    pending = pending.length === 0 ? segment : Buffer.concat([pending, segment]);
    try {
      text.push(zstdDecompressSync(pending).toString("utf8"));
      pending = Buffer.alloc(0);
    } catch (error) {
      // Not a frame boundary (the magic occurred inside a payload): extend with the next segment.
      if (index === offsets.length - 1) throw error;
    }
  }
  return text
    .join("")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * Map each recorded tool call to its recorded result.
 * @param {object[]} events - decoded session events.
 * @returns {Map<string, object>} result message keyed by tool call id.
 */
function resultsByCallId(events) {
  const results = new Map();
  for (const event of events) {
    if (event.type !== "tool/result") continue;
    results.set(event.data.message.toolCallId, event.data.message);
  }
  return results;
}

/**
 * Read the tool results recorded for one tool name, in call order.
 * @param {object[]} events - decoded session events.
 * @param {string} name - model-facing tool name.
 * @returns {object[]} result messages.
 */
function resultsForTool(events, name) {
  const results = resultsByCallId(events);
  return events
    .filter((event) => event.type === "tool/call" && event.data.name === name)
    .map((event) => results.get(event.data.callId))
    .filter((message) => message !== undefined);
}

/**
 * Fail the smoke with a consistent report.
 * @param {string} detail - what failed.
 * @param {string[]} [context] - extra report lines.
 * @returns {never}
 */
function fail(detail, context = []) {
  const lines = ["smoke failed: " + detail, ...context, hostHint()];
  if (currentKeep && currentHome !== undefined) lines.push("kept session home: " + currentHome);
  throw new Error(lines.join("\n"));
}

/**
 * Run the smoke.
 * @param {object} [options] - install identity, hooks, and lane selection.
 * @param {string} [options.installSpec] - package spec installed into the throwaway profile.
 * @param {(info: { home: string, profile: string }) => void|Promise<void>} [options.onInstalled] - runs after installation.
 * @param {boolean} [options.keep] - keep the throwaway home.
 * @param {boolean} [options.isolatedEnvironment] - boot with a minimal environment.
 * @param {boolean} [options.delegation] - script a real `subagent_model` call; requires a host with the flattened spec.
 * @param {boolean} [options.mask] - compose the native route fields and assert the plugin hides them.
 * @param {boolean} [options.seededFork] - delegate with inherited context on a resumed turn and
 *   assert the seeded child runs on the route the tool result reported.
 * @returns {Promise<void>}
 */
export async function runSmoke({
  installSpec = "link:" + REPO_ROOT,
  onInstalled = () => {},
  keep = Boolean(process.env.SMOKE_KEEP),
  isolatedEnvironment = false,
  delegation = false,
  mask = delegation,
  seededFork = false
} = {}) {
  if (mask && !delegation) {
    throw new Error("smoke: the mask lane probes a real delegation, so it requires delegation: true");
  }
  const host = resolveHost();
  const home = mkdtempSync(join(tmpdir(), "dsh-subagent-model-smoke-"));
  currentHome = home;
  currentKeep = keep;
  const workspace = realpathSync(home);
  const env = isolatedEnvironment
    ? { PATH: process.env.PATH || "/usr/bin:/bin", HOME: home, DSH_HOME: home, GIT_TERMINAL_PROMPT: "0" }
    : { ...process.env, DSH_HOME: home };
  let stub;

  try {
    const compose = runDsh(host, ["--profile", PROFILE, "--from-default-profile", "headless", "--dump-config"], env, home);
    if (compose.status !== 0) {
      fail("could not compose the isolated profile", [
        "host: " + host.source + " (" + host.command + ")",
        compose.error === undefined ? "" : String(compose.error),
        (compose.stderr ?? "").slice(-2000)
      ].filter((line) => line.length > 0));
    }

    const installArgs = ["plugin", "--profile", PROFILE, "add", installSpec];
    if (!installSpec.startsWith("link:")) installArgs.push("--ignore-scripts");
    const install = runDsh(host, installArgs, env, home);
    if (install.status !== 0) {
      fail("could not install the plugin into the isolated profile", [
        install.error === undefined ? "" : String(install.error),
        (install.stdout ?? "").slice(-2000),
        (install.stderr ?? "").slice(-2000)
      ].filter((line) => line.length > 0));
    }
    await onInstalled({ home, profile: PROFILE });

    // Compose the composition that broke: the native tool advertises route fields.
    const overlay = mask ? writeMaskOverlay(home) : undefined;
    stub = await startStub({ delegation, mask, workspace });
    const runEnv = {
      ...env,
      DEEPSEEK_BASE_URL: "http://127.0.0.1:" + stub.port,
      DEEPSEEK_API_KEY: "smoke-key"
    };
    const run = await runOnce(host, {
      args: ["Reply with the smoke result."],
      env: runEnv,
      cwd: home,
      overlay
    });
    await stub.close();

    if (run.code !== 0) {
      fail("the one-shot task did not complete", [
        "host: " + host.source + " (" + host.command + ")",
        "stub requests:\n" + stub.requests.join("\n"),
        run.stdout.slice(-2000),
        run.stderr.slice(-2000)
      ]);
    }

    // The first pass is asserted on its own: the second pass adopts the same parent session and
    // appends to it, so its events must be snapshotted before that run starts.
    const firstRunSessions = findSessionFiles(home).map(readSessionEvents);

    // A seeded child only exists once the parent has a completed turn, which one shot cannot
    // produce. A second run adopts the recorded parent session and delegates with inheritance,
    // so the child really receives the parent request header through its seed.
    let seededRun;
    let seededRoute;
    let seededReceipt;
    let seededParentEffort;
    if (seededFork) {
      const parent = firstRunSessions.find((session) => session[0]?.type === "session"
        && session[0].origin !== "subagent");
      if (parent === undefined) fail("the seeded lane could not find the parent session to resume");
      const parentId = parent[0].id;
      const seededStub = await startStub({ delegation: true, mask, seeded: true, workspace });
      try {
        seededRun = await runOnce(host, {
          args: ["--session-id", parentId, "Reply with the smoke result."],
          env: { ...runEnv, DEEPSEEK_BASE_URL: "http://127.0.0.1:" + seededStub.port },
          cwd: home,
          overlay
        });
        seededRoute = seededStub.scriptedRoute();
      } finally {
        await seededStub.close();
      }
      if (seededRun.code !== 0) {
        fail("the seeded fork lane did not complete", [
          seededRun.stdout.slice(-2000),
          seededRun.stderr.slice(-2000)
        ]);
      }
      // The receipt must come from the resumed parent session, not from any child log: the parent
      // log is the only place this tool call is recorded.
      const resumedSessions = findSessionFiles(home).map(readSessionEvents);
      const resumedParent = resumedSessions.find((session) => session[0]?.type === "session"
        && session[0].origin !== "subagent");
      if (resumedParent === undefined) fail("the seeded pass recorded no parent session");
      const resumedResults = resultsForTool(resumedParent, DELEGATION_TOOL_NAME);
      const acceptedReceipts = resumedResults.filter((message) => message.isError === false);
      if (acceptedReceipts.length === 0) {
        fail("the seeded parent session recorded no accepted " + DELEGATION_TOOL_NAME + " result");
      }
      const receiptText = contentText(acceptedReceipts.at(-1));
      const receiptMatch = /^started subagent (.+) \(([0-9a-fA-F-]{36})\)(?: on reasoning effort (.+))?$/.exec(receiptText.trim());
      if (receiptMatch === null) {
        fail("the seeded delegation result does not report the child identity and effort", [receiptText.slice(0, 500)]);
      }
      seededReceipt = { id: receiptMatch[2], effort: receiptMatch[3] };
      // The parent effort is what an unpinned seeded child would keep, so it is the negative control.
      seededParentEffort = resumedParent.filter((event) => event.type === "request/header")
        .at(-1)?.data.header.config.reasoningEffort;
    }

    const sessions = firstRunSessions;
    if (sessions.length === 0) {
      fail("no session log (session.v4.jsonl[.zstd]) was persisted under the throwaway home");
    }
    const events = sessions.flat();
    if (process.env.SMOKE_DEBUG) {
      console.log("session event types:", [...new Set(events.map((event) => event.type))].join(", "));
      console.log("stub requests:\n" + stub.requests.join("\n"));
    }

    const parentSession = sessions.find((session) => session[0]?.type === "session" && session[0].origin !== "subagent");
    if (parentSession === undefined) fail("no parent session was recorded");
    const recordedChildSession = sessions.find((session) => session[0]?.type === "session" && session[0].origin === "subagent");
    const requestHeader = parentSession.find((event) => event.type === "request/header");
    if (requestHeader === undefined) fail("no request header was recorded: the tool catalog was never sent");
    const toolNames = (requestHeader.data.header.tools ?? []).map((tool) => tool.name);

    /**
     * Assert one agent's model-facing catalog.
     * @param {string[]} names - tool names in that catalog.
     * @param {string} label - which catalog is under test.
     * @returns {void}
     */
    const assertCatalog = (names, label) => {
      for (const required of [TOOL_NAME, DELEGATION_TOOL_NAME]) {
        const occurrences = names.filter((name) => name === required).length;
        if (occurrences !== 1) {
          fail("expected exactly one " + required + " in the " + label + " tool catalog, saw " + occurrences);
        }
      }
      if (!mask) return;
      for (const maskedName of MASKED_TOOL_NAMES) {
        if (names.includes(maskedName)) fail("the masked tool is still in the " + label + " tool catalog: " + maskedName);
      }
    };
    assertCatalog(toolNames, "request");

    if (mask) {
      // The child is an agent too: its catalog must carry the same sanitized surface.
      if (recordedChildSession === undefined) fail("no subagent session was recorded for the mask lane");
      const childHeader = recordedChildSession.find((event) => event.type === "request/header");
      if (childHeader === undefined) fail("the child session recorded no request header");
      assertCatalog((childHeader.data.header.tools ?? []).map((tool) => tool.name), "child");

      // A call that still reaches dispatch is refused by the execution guard with the replacement hint.
      for (const probed of MASKED_PROBES) {
        const replacement = probed === "list_subagent_models" ? TOOL_NAME : DELEGATION_TOOL_NAME;
        const refusal = events.find((event) => event.type === "tool/result"
          && contentText(event.data.message).includes("`" + probed + "` is unavailable while the dsh-subagent-model plugin is loaded"));
        if (refusal === undefined) {
          fail("the masked " + probed + " call was not refused by the plugin", [
            events.filter((event) => event.type === "tool/result")
              .map((event) => contentText(event.data.message).slice(0, 200))
              .join("\n")
          ]);
        }
        if (refusal.data.message.isError !== true) fail("the masked " + probed + " call did not fail");
        if (!contentText(refusal.data.message).includes("`" + replacement + "`")) {
          fail("the masked " + probed + " refusal does not name " + replacement);
        }
      }

      // The prompt carries the plugin's guidance, rendered against the composition it detected. The
      // exact unavailable list is the positive control that the overlay really registered the native
      // route fields: `list_subagent_models` exists only while `modelDiscovery` is on.
      const systemBody = stub.systemBody();
      if (!systemBody.includes("Delegate with `" + DELEGATION_TOOL_NAME + "`")) {
        fail("the delegation guidance is missing from the system prompt");
      }
      const unavailable = "Unavailable while this plugin is loaded: "
        + MASKED_TOOL_NAMES.map((name) => "`" + name + "`").join(", ") + ".";
      if (!systemBody.includes(unavailable)) {
        fail("the delegation guidance does not report the expected masked surface", [unavailable]);
      }
    }

    const catalogCall = events.find((event) => event.type === "tool/call" && event.data.name === TOOL_NAME);
    if (catalogCall === undefined) fail("the scripted " + TOOL_NAME + " call never reached the tool registry");
    const catalogResult = events.find((event) => event.type === "tool/result"
      && event.data.message?.toolCallId === catalogCall.data.callId);
    if (catalogResult === undefined) fail("the " + TOOL_NAME + " call produced no recorded result");
    if (catalogResult.data.message.isError !== false) fail("the " + TOOL_NAME + " call failed");
    // The catalog answers a structured value; read it rather than matching rendered text.
    const resultText = (catalogResult.data.message.content ?? [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    let catalog;
    try {
      catalog = JSON.parse(resultText);
    } catch {
      fail("the " + TOOL_NAME + " result is not JSON", [resultText.slice(0, 500)]);
    }
    if (!Array.isArray(catalog?.providers)) {
      fail("the " + TOOL_NAME + " result has no providers array", [resultText.slice(0, 500)]);
    }
    const entry = catalog.providers.find((provider) => provider.provider === "deepseek-official");
    if (entry === undefined) {
      fail("the " + TOOL_NAME + " result does not list the registered provider", [resultText.slice(0, 500)]);
    }
    if (!Array.isArray(entry.models) || entry.models.length === 0) {
      fail("the " + TOOL_NAME + " result lists no models for the registered provider", [resultText.slice(0, 500)]);
    }
    if (entry.models.some((model) => typeof model.id !== "string" || model.id.length === 0)) {
      fail("the " + TOOL_NAME + " result reports a model without an id", [JSON.stringify(entry).slice(0, 500)]);
    }
    if (resultText.includes("deepseek-official/") || resultText.includes(" — ")) {
      fail("the " + TOOL_NAME + " result renders a display name or combined route", [resultText.slice(0, 500)]);
    }
    if (resultsForTool(events, TOOL_NAME).length !== 1) {
      fail("expected exactly one " + TOOL_NAME + " result, saw " + resultsForTool(events, TOOL_NAME).length);
    }

    if (delegation) {
      const delegationResults = resultsForTool(events, DELEGATION_TOOL_NAME);
      if (delegationResults.length !== 2) {
        fail("expected two " + DELEGATION_TOOL_NAME + " results, saw " + delegationResults.length);
      }
      const [accepted, rejected] = delegationResults;
      if (accepted.isError !== false) {
        fail("the " + DELEGATION_TOOL_NAME + " call failed", [JSON.stringify(accepted.content).slice(0, 1000)]);
      }
      const started = (accepted.content ?? [])
        .map((block) => block.type === "text" ? block.text : "")
        .join(" ");
      // The render may append the effective reasoning effort after the child identity.
      const startMatch = /^started subagent (.+) \(([0-9a-fA-F-]{36})\)(?: on reasoning effort .+)?$/.exec(started.trim());
      if (startMatch === null) {
        fail("the " + DELEGATION_TOOL_NAME + " result does not report the child name and id", [started.slice(0, 500)]);
      }
      const [, startedName, startedId] = startMatch;
      if (rejected.isError !== true) {
        fail("an undeclared argument was accepted by " + DELEGATION_TOOL_NAME, [JSON.stringify(rejected.content).slice(0, 500)]);
      }
      if (!JSON.stringify(rejected.content).includes("unexpected_argument")) {
        fail("the undeclared argument rejection does not name the argument", [JSON.stringify(rejected.content).slice(0, 500)]);
      }

      const childSessions = sessions.filter((session) => session[0]?.type === "session" && session[0].origin === "subagent");
      if (childSessions.length !== 1) fail("expected one subagent session, saw " + childSessions.length);
      const childSession = childSessions[0];
      const childHeader = childSession[0];
      if (startedName !== CHILD_NAME) {
        fail("the " + DELEGATION_TOOL_NAME + " result reported name " + JSON.stringify(startedName));
      }
      if (startedId !== childHeader.id) {
        fail("the " + DELEGATION_TOOL_NAME + " result reported id " + startedId + " but the child session is " + childHeader.id);
      }
      const parentHeader = events.find((event) => event.type === "session" && event.origin !== "subagent");
      if (parentHeader === undefined) fail("no parent session header was recorded");
      if (childHeader.parentSession !== parentHeader.id) {
        fail("the child session is not recorded under the calling agent");
      }
      const catalogEntry = events.find((event) => event.type === "subagent/catalog" && event.data.childId === childHeader.id);
      if (catalogEntry === undefined) fail("the creator catalog records no entry for the child");
      if (catalogEntry.data.name !== CHILD_NAME) {
        fail("the creator catalog recorded name " + JSON.stringify(catalogEntry.data.name));
      }
      const descriptor = childSession.find((event) => event.type === "subagent/descriptor");
      if (descriptor === undefined) fail("the child session recorded no subagent/descriptor");
      if (descriptor.data.mode !== "continuable") fail("the child descriptor is not continuable: " + descriptor.data.mode);
      const directoryChange = childSession.filter((event) => event.type === "working-directory/change").at(-1);
      const childDirectory = directoryChange?.data.cwd ?? childSession[0].cwd;
      if (childDirectory !== workspace) {
        fail("the child session did not start in the requested directory: " + String(childDirectory));
      }
    }

    if (seededFork) {
      // The seeded child carries the parent request header in its seed, so this lane proves the
      // forked child really runs the route the tool result reported rather than the parent's.
      const seededSessions = findSessionFiles(home).map(readSessionEvents);
      if (seededReceipt === undefined) fail("the seeded delegation produced no recorded result");
      // Identify the child by the id the receipt reported, not by guessing from its model.
      const seededChild = seededSessions.find((session) => session[0]?.type === "session"
        && session[0].origin === "subagent"
        && session[0].id === seededReceipt.id);
      if (seededChild === undefined) {
        fail("no child session matches the reported id " + seededReceipt.id);
      }
      if (seededChild[0].isSeeded !== true) {
        fail("the reported child is not seeded, so the lane proves nothing about a forked child");
      }
      // The host writes a durable `session/end-seed` marker with `inherited: true` at the exact
      // seed boundary, so the child own FIRST request is the first header after it. Using the last
      // header instead would accept a child that started on the wrong route and switched later.
      const seedEnd = seededChild.findIndex((event) => event.type === "session/end-seed"
        && event.data?.inherited === true);
      if (seedEnd === -1) {
        fail("the seeded child recorded no inherited session/end-seed marker", [
          "event types: " + [...new Set(seededChild.map((event) => event.type))].join(", ")
        ]);
      }
      const headers = seededChild.filter((event) => event.type === "request/header");
      const seededInherited = headers.find((event) => event.seq < seededChild[seedEnd].seq);
      if (seededInherited === undefined) {
        fail("the seeded child log holds no inherited request header, so the lane proves nothing");
      }
      if (seededInherited.data.header.config.model === seededRoute?.model) {
        fail("the inherited header already carried the requested model, so the lane proves nothing", [
          "inherited header: " + JSON.stringify(seededInherited.data.header.config)
        ]);
      }
      const ownHeaderEvent = headers.find((event) => event.seq > seededChild[seedEnd].seq);
      if (ownHeaderEvent === undefined) {
        fail("the seeded child recorded no request header of its own after the seed boundary");
      }
      const ownHeader = ownHeaderEvent.data.header.config;
      if (seededRoute === undefined) fail("the seeded lane never scripted a delegation route");
      if (ownHeader.provider !== seededRoute.provider || ownHeader.model !== seededRoute.model) {
        fail("the seeded child ran on " + ownHeader.provider + "/" + ownHeader.model
          + " instead of the reported " + seededRoute.provider + "/" + seededRoute.model, [
          "second pass stdout: " + (seededRun?.stdout ?? "").slice(-1500),
          "second pass stderr: " + (seededRun?.stderr ?? "").slice(-1500)
        ]);
      }
      // The parent runs an effort of its own, so an inheriting child proves the pin only when its
      // effort differs from the parent and matches what the result reported.
      if (seededReceipt.effort === undefined) {
        fail("the seeded delegation reported no reasoning effort");
      }
      if (ownHeader.reasoningEffort !== seededReceipt.effort) {
        fail("the seeded child ran effort " + String(ownHeader.reasoningEffort)
          + " but the result reported " + seededReceipt.effort);
      }
      // Both must be exactly what the call asked for: matching each other while both drifted to a
      // different supported effort is still a route the caller did not request.
      if (ownHeader.reasoningEffort !== SEEDED_CHILD_EFFORT) {
        fail("the seeded child ran effort " + String(ownHeader.reasoningEffort)
          + " instead of the requested " + SEEDED_CHILD_EFFORT);
      }
      if (seededReceipt.effort !== SEEDED_CHILD_EFFORT) {
        fail("the seeded delegation reported effort " + String(seededReceipt.effort)
          + " instead of the requested " + SEEDED_CHILD_EFFORT);
      }
      if (ownHeader.reasoningEffort === seededParentEffort) {
        fail("the seeded child inherited the parent effort " + String(seededParentEffort)
          + ", so the result would be reporting a route the child does not run");
      }
    }

    console.log("smoke ok: " + sessions.length + " session(s), both tools registered"
      + (delegation ? ", delegation started with the flattened activation spec" : " and the catalog executed")
      + (mask ? ", native delegation surface masked" : "")
      + (seededFork ? ", seeded child ran on the requested route" : ""));
    if (keep) console.log("kept session home: " + home);
  } finally {
    await stub?.close();
    if (!keep) rmSync(home, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runSmoke({ delegation: true, seededFork: true }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
