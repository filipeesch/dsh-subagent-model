import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const requiredFiles = [
  "package.json",
  "cordis.patch.yml",
  "index.js",
  "lib/catalog.js",
  "lib/delegation.js",
  "lib/fields.js",
  "lib/route.js",
  "README.md"
];

describe("DSH distribution", () => {
  it("declares the bundle patch and supported host range", () => {
    expect(manifest.name).toBe("dsh-subagent-model");
    expect(manifest.dsh?.bundle?.patch).toBe("./cordis.patch.yml");
    expect(manifest.engines?.dsh).toBe(">=0.2.1-alpha.2 <0.3.0");
  });

  it("inserts the package under the plugin's runtime identity", async () => {
    const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
    const entry = await import(pathToFileURL(fileURLToPath(new URL("../index.js", import.meta.url))));
    expect(patch).toMatch(/^\s*- insert:\s*\n\s*- id: subagent-model\s*\n\s*name: dsh-subagent-model\s*$/);
    expect(entry.name).toBe("subagent-model");
    expect(entry.apply).toBeTypeOf("function");
  });

  it("exposes the same ESM runtime entry through main and exports", async () => {
    expect(manifest.type).toBe("module");
    expect(manifest.main).toBe("index.js");
    expect(manifest.exports?.["."]).toBe("./index.js");
    expect(manifest.exports?.["./package.json"]).toBe("./package.json");
    const entry = await import(new URL(`../${manifest.main}`, import.meta.url));
    expect(entry.inject).toEqual(["tools", "subagents", "llm"]);
    expect(entry.apply).toBeTypeOf("function");
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  it("includes every required runtime file in the package payload", () => {
    // npm_execpath points to pnpm when the suite is run with pnpm test.
    const pnpm = process.env.npm_execpath;
    const output = pnpm
      ? execFileSync(process.execPath, [pnpm, "pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" })
      : execFileSync("pnpm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" });
    const files = JSON.parse(output).files.map(({ path }) => path);
    expect(files).toEqual(expect.arrayContaining(requiredFiles));
  });
});
