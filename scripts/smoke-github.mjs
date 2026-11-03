#!/usr/bin/env node
// Network-dependent verification; the installed GitHub bundle is executable code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSmoke } from "./smoke.mjs";

export function repositoryFromSpec(spec) {
  const match = /^(?:git\+)?https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#([^\s]+))?$/.exec(spec);
  if (!match) throw new Error("Expected an HTTPS or git+https GitHub repository URL with an optional #reference");
  return { owner: match[1], repo: match[2] };
}

// Read the installer's lockfile, not a separate lookup of a potentially mutable ref.
export function installedCommit(lockfile, spec) {
  const { owner, repo } = repositoryFromSpec(spec);
  const block = /^      ['"]?dsh-subagent-model['"]?:\s*\n((?:        [^\n]*\n?)*)/m.exec(lockfile)?.[1];
  const version = /^        version: ['"]?([^'"\s]+)['"]?\s*$/m.exec(block || "")?.[1];
  if (!version) throw new Error("Cannot determine the installed plugin revision from the profile lockfile");
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const path = `${escape(owner)}/${escape(repo)}`;
  const match = new RegExp(`^(?:https://codeload\\.github\\.com/${path}/(?:tar\\.gz|legacy\\.tar\\.gz)/|(?:git\\+)?https://github\\.com/${path}(?:\\.git)?(?:/archive/|#))([a-f0-9]{40})(?:\\.tar\\.gz)?$`, "i").exec(version);
  if (!match) throw new Error("The profile lockfile does not identify an immutable commit for the requested repository: " + version);
  return match[1].toLowerCase();
}

export async function verifyGithub(spec, { smoke = runSmoke, readFile = readFileSync, log = console.log } = {}) {
  repositoryFromSpec(spec);
  log("GitHub installation verification: " + spec);
  let commit;
  await smoke({
    installSpec: spec,
    keep: false,
    isolatedEnvironment: true,
    onInstalled: ({ home, profile }) => {
      const lock = readFile(join(home, "profiles", profile, "pnpm-lock.yaml"), "utf8");
      commit = installedCommit(lock, spec);
      log("Installed commit (profile lockfile): " + commit);
    }
  });
  if (!commit) throw new Error("Installed revision was not verified");
  log("GitHub verification passed for " + spec + " at " + commit + "; local unpublished changes were not tested.");
  return commit;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/smoke-github.mjs [git+]https://github.com/OWNER/REPO[.git][#REF]");
    process.exitCode = 1;
  } else {
    verifyGithub(process.argv[2]).catch((error) => {
      console.error("GitHub verification failed or unverified: " + (error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    });
  }
}
