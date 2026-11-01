#!/usr/bin/env node
/**
 * Isolated loader smoke for dsh-subagent-model.
 *
 * Boots the installed DSH runtime in a throwaway `$DSH_HOME`, links this
 * package into a profile cloned from the `headless` template, and runs a single
 * one-shot task against a local Messages-API stub. The stub answers the first
 * request with a scripted `list_subagent_routes` tool call and the next request
 * with a final answer, so the smoke proves registration and execution under the
 * real loader without credentials or outbound traffic.
 *
 * The stub mirrors the stream shape the DeepSeek adapter consumes
 * (`message_start`, `content_block_start|delta|stop`, `message_delta`,
 * `message_stop`, all framed as SSE). If that shape changes, the run fails here
 * with the stub's request log attached; update `respondWithToolCall` and
 * `respondWithText` rather than guessing elsewhere.
 *
 * Environment:
 *   DSH_BIN     runtime CLI to boot (default: the installed macOS app, then `dsh`)
 *   SMOKE_KEEP  keep the throwaway `$DSH_HOME` for inspection
 *   SMOKE_DEBUG print session event types and the stub request log
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROFILE = "subagent-model-smoke";
const RUN_TIMEOUT_MS = 120_000;
const TOOL_NAME = "list_subagent_routes";
const DELEGATION_TOOL_NAME = "subagent_model";

/** Throwaway `$DSH_HOME` of the current run, reported when the run fails and is kept. */
let currentHome;

/** Resolve the runtime CLI the smoke boots. */
function resolveDshBin() {
  if (process.env.DSH_BIN) return process.env.DSH_BIN;
  const app = "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh";
  return existsSync(app) ? app : "dsh";
}

/**
 * Run one CLI step to completion.
 * @param {string} dsh - runtime CLI path.
 * @param {string[]} args - CLI arguments.
 * @param {Record<string, string>} env - child environment.
 * @param {string} cwd - child working directory.
 * @returns {{ status: number|null, stdout: string, stderr: string }}
 */
function runDsh(dsh, args, env, cwd) {
  return spawnSync(dsh, args, { cwd, env, encoding: "utf8", timeout: RUN_TIMEOUT_MS });
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
 * Answer a request with a scripted `list_subagent_routes` tool call.
 * @param {import('node:http').ServerResponse} response - open response.
 * @returns {void}
 */
function respondWithToolCall(response) {
  writeEvent(response, {
    type: "message_start",
    message: { id: "msg_smoke_1", type: "message", role: "assistant", content: [], usage: { input_tokens: 12 } }
  });
  writeEvent(response, {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_smoke_1", name: TOOL_NAME, input: {} }
  });
  writeEvent(response, {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: "{}" }
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
    message: { id: "msg_smoke_2", type: "message", role: "assistant", content: [], usage: { input_tokens: 42 } }
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
 * @returns {Promise<{ port: number, requests: string[], close: () => Promise<void> }>}
 */
async function startStub() {
  const requests = [];
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
      if (body.includes('"tool_result"')) respondWithText(response, "SMOKE_TURN_COMPLETE");
      else if (advertised) respondWithToolCall(response);
      else respondWithText(response, "SMOKE_AUXILIARY_TURN");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    port: address.port,
    requests,
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
 * Fail the smoke with a consistent report.
 * @param {string} detail - what failed.
 * @param {string[]} [context] - extra report lines.
 * @returns {never}
 */
function fail(detail, context = []) {
  const lines = ["smoke failed: " + detail, ...context];
  if (process.env.SMOKE_KEEP && currentHome !== undefined) lines.push("kept session home: " + currentHome);
  throw new Error(lines.join("\n"));
}

/**
 * Run the smoke.
 * @returns {Promise<void>}
 */
async function main() {
  const dsh = resolveDshBin();
  const home = mkdtempSync(join(tmpdir(), "dsh-subagent-model-smoke-"));
  currentHome = home;
  const env = { ...process.env, DSH_HOME: home };
  let stub;

  try {
    const compose = runDsh(dsh, ["--profile", PROFILE, "--from-default-profile", "headless", "--dump-config"], env, home);
    if (compose.status !== 0) {
      fail("could not compose the isolated profile", [
        compose.error === undefined ? "" : String(compose.error),
        compose.stderr.slice(-2000)
      ].filter((line) => line.length > 0));
    }

    const link = runDsh(dsh, ["plugin", "--profile", PROFILE, "add", "link:" + REPO_ROOT], env, home);
    if (link.status !== 0) {
      fail("could not link the plugin into the isolated profile", [
        link.error === undefined ? "" : String(link.error),
        link.stderr.slice(-2000)
      ].filter((line) => line.length > 0));
    }

    stub = await startStub();
    const runEnv = {
      ...env,
      DEEPSEEK_BASE_URL: "http://127.0.0.1:" + stub.port,
      DEEPSEEK_API_KEY: "smoke-key"
    };
    const run = await new Promise((resolve) => {
      const child = spawn(dsh, ["--profile", PROFILE, "Reply with the smoke result."], { env: runEnv, cwd: home });
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
    await stub.close();

    if (run.code !== 0) {
      fail("the one-shot task did not complete", [
        "stub requests:\n" + stub.requests.join("\n"),
        run.stdout.slice(-2000),
        run.stderr.slice(-2000)
      ]);
    }

    const sessionFiles = findSessionFiles(home);
    if (sessionFiles.length === 0) {
      fail("no session log (session.v4.jsonl[.zstd]) was persisted under the throwaway home");
    }
    const events = sessionFiles.flatMap(readSessionEvents);
    if (process.env.SMOKE_DEBUG) {
      console.log("session event types:", [...new Set(events.map((event) => event.type))].join(", "));
      console.log("stub requests:\n" + stub.requests.join("\n"));
    }

    const sessionText = events.map((event) => JSON.stringify(event)).join("\n");
    const requestHeader = events.find((event) => event.type === "request/header");
    if (requestHeader === undefined) fail("no request header was recorded: the tool catalog was never sent");
    const toolNames = (requestHeader.data.header.tools ?? []).map((tool) => tool.name);
    for (const required of [TOOL_NAME, DELEGATION_TOOL_NAME]) {
      const occurrences = toolNames.filter((name) => name === required).length;
      if (occurrences !== 1) fail("expected exactly one " + required + " in the request tool catalog, saw " + occurrences);
    }

    const catalogCall = events.find((event) => event.type === "tool/call" && event.data.name === TOOL_NAME);
    if (catalogCall === undefined) fail("the scripted " + TOOL_NAME + " call never reached the tool registry");
    const catalogResult = events.find((event) => event.type === "tool/result"
      && event.data.message?.toolCallId === catalogCall.data.callId);
    if (catalogResult === undefined) fail("the " + TOOL_NAME + " call produced no recorded result");
    if (catalogResult.data.message.isError !== false) fail("the " + TOOL_NAME + " call failed");
    const resultText = JSON.stringify(catalogResult.data.message.content);
    if (!resultText.includes("deepseek-official")) {
      fail("the " + TOOL_NAME + " result does not list the registered provider", [resultText.slice(0, 500)]);
    }
    if (!sessionText.includes(TOOL_NAME)) fail("the session log does not mention " + TOOL_NAME);

    console.log("smoke ok: " + sessionFiles.length + " session(s), both tools registered and the catalog executed");
    if (process.env.SMOKE_KEEP) console.log("kept session home: " + home);
  } finally {
    await stub?.close();
    if (!process.env.SMOKE_KEEP) rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
