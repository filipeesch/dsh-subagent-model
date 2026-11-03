import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installedCommit, repositoryFromSpec, verifyGithub } from "../scripts/smoke-github.mjs";
import { runSmoke } from "../scripts/smoke.mjs";

const spec = "https://github.com/example/dsh-subagent-model#release";
const sha = "a".repeat(40);
const lock = (version) => `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      dsh-subagent-model:\n        specifier: ${spec}\n        version: ${version}\n`;
const version = `https://codeload.github.com/example/dsh-subagent-model/tar.gz/${sha}`;
const originalBin = process.env.DSH_BIN;
const dirs = [];
afterEach(() => {
  if (originalBin === undefined) delete process.env.DSH_BIN;
  else process.env.DSH_BIN = originalBin;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("GitHub installation verification", () => {
  it("preserves the reference and reads the installed commit from the profile lock", async () => {
    const log = vi.fn();
    const smoke = vi.fn(async (options) => {
      expect(options).toMatchObject({ installSpec: spec, keep: false, isolatedEnvironment: true });
      await options.onInstalled({ home: "/isolated", profile: "test" });
    });
    const readFile = vi.fn(() => lock(version));
    await expect(verifyGithub(spec, { smoke, readFile, log })).resolves.toBe(sha);
    expect(readFile).toHaveBeenCalledWith(join("/isolated", "profiles", "test", "pnpm-lock.yaml"), "utf8");
    expect(log.mock.calls.flat().join(" ")).toContain(sha);
    expect(repositoryFromSpec("https://github.com/example/dsh-subagent-model.git#main")).toEqual({ owner: "example", repo: "dsh-subagent-model" });
  });

  it("preserves a git+https reference and accepts its installed immutable revision", async () => {
    const gitSpec = "git+https://github.com/example/dsh-subagent-model.git#release";
    const smoke = vi.fn(async ({ installSpec, onInstalled }) => {
      expect(installSpec).toBe(gitSpec);
      await onInstalled({ home: "/isolated", profile: "test" });
    });
    await expect(verifyGithub(gitSpec, { smoke, readFile: () => lock(version), log: () => {} })).resolves.toBe(sha);
    expect(installedCommit(lock(`git+https://github.com/example/dsh-subagent-model.git#${sha}`), gitSpec)).toBe(sha);
  });

  it("rejects unresolved, wrong-repository, mutable, or missing revisions", () => {
    for (const value of ["", lock("link:../checkout"), lock(version.replace("example", "other")), lock(version.replace(sha, "main"))]) {
      expect(() => installedCommit(value, spec)).toThrow();
    }
    expect(() => repositoryFromSpec("https://evil.example/repo")).toThrow();
  });

  it("never reports success when the installer, runtime, or lockfile fails", async () => {
    const log = vi.fn();
    await expect(verifyGithub(spec, { smoke: async () => { throw new Error("network unavailable"); }, log })).rejects.toThrow("network unavailable");
    await expect(verifyGithub(spec, { smoke: async () => {}, log })).rejects.toThrow("revision was not verified");
    await expect(verifyGithub(spec, { smoke: async ({ onInstalled }) => onInstalled({ home: "/x", profile: "p" }), readFile: () => { throw new Error("missing lockfile"); }, log })).rejects.toThrow("missing lockfile");
    expect(log.mock.calls.flat().join(" ")).not.toContain("verification passed");
  });

  it("reports the missing runtime instead of masking the spawn error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-github-test-"));
    dirs.push(dir);
    process.env.DSH_BIN = join(dir, "missing-dsh");
    await expect(verifyGithub(spec, { log: () => {} })).rejects.toThrow(/could not compose the isolated profile[\s\S]*ENOENT/);
  });

  it.each(["compose", "install", "lock", "runtime"])("cleans disposable home on %s failure without passing secrets or approving scripts", async (stage) => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-github-test-"));
    dirs.push(dir);
    const audit = join(dir, "audit");
    const fake = join(dir, "dsh");
    writeFileSync(fake, `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(audit)}, JSON.stringify({args: process.argv.slice(2), home: process.env.DSH_HOME, userHome: process.env.HOME, secret: process.env.GITHUB_TOKEN})+'\\n');\nconst args = process.argv.slice(2);\nif (${JSON.stringify(stage)} === 'compose' && args.includes('--dump-config')) process.exit(2);\nif (args.includes('add')) process.exit(${stage === "install" ? 3 : 0});\nif (!args.includes('--dump-config')) process.exit(4);\n`, { mode: 0o755 });
    process.env.DSH_BIN = fake;
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "real-secret-must-not-leak";
    try {
      await expect(runSmoke({ installSpec: spec, keep: false, isolatedEnvironment: true, onInstalled: () => {
        if (stage === "lock") throw new Error("lock unavailable");
      } })).rejects.toThrow();
      const calls = readFileSync(audit, "utf8").trim().split("\n").map(JSON.parse);
      expect(existsSync(calls[0].home)).toBe(false);
      expect(calls.every((call) => call.userHome === call.home && !call.secret)).toBe(true);
      if (stage !== "compose") expect(calls[1].args).toEqual(["plugin", "--profile", "subagent-model-smoke", "add", spec, "--ignore-scripts"]);
    } finally {
      if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = originalToken;
    }
  });
});
