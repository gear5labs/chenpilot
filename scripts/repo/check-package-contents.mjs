#!/usr/bin/env node
// Verifies the file list `npm pack` produces for each publishable package
// against an explicit allowlist, and fails when private files, test fixtures,
// local logs, or unexpected generated files enter a tarball (issue #999).
//
// Usage: node scripts/repo/check-package-contents.mjs
//
// Allowlist and deny patterns live in scripts/repo/repo-check.config.json
// under `packageContents`. A packed path that matches any deny pattern is
// always a problem; a packed path that matches no allow pattern is unexpected.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packArtifact } from "./check-package-manifests.mjs";
import { readRepoConfig } from "./config.mjs";

/** Convert a glob with `**` / `*` into an anchored RegExp. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else {
        re += ".*";
      }
    } else if (ch === "*") {
      re += "[^/]*";
    } else if (".+^$()|{}[]\\".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(rel, patterns) {
  return patterns.some((p) => globToRegExp(p).test(rel));
}

/**
 * Validate one packed file list against its allow/deny policy.
 * Returns a list of human-readable problems.
 */
export function validatePackedFiles(packedFiles, policy) {
  const problems = [];
  const allow = policy.allow ?? [];
  const deny = policy.deny ?? [];
  for (const rel of packedFiles) {
    const normalized = path.posix.normalize(rel);
    if (matchesAny(normalized, deny)) {
      problems.push(
        `"${normalized}" matches a denied pattern (private files, fixtures, logs, or development artifacts must not ship)`
      );
      continue;
    }
    if (!matchesAny(normalized, allow)) {
      problems.push(
        `"${normalized}" is not covered by the package allowlist [${allow.join(", ")}]`
      );
    }
  }
  return problems;
}

/** Pack every configured package and validate its contents. */
export function checkPackageContents(root, config) {
  const problems = [];
  const packages = config.packages ?? {};
  for (const [dir, policy] of Object.entries(packages)) {
    const manifestPath = path.posix.join(dir, "package.json");
    let artifact;
    try {
      artifact = packArtifact(root, dir);
    } catch (error) {
      problems.push(
        `${manifestPath}: npm pack failed: ${String(error.stderr || error.message).trim()}`
      );
      continue;
    }
    const found = validatePackedFiles(artifact.files, policy);
    for (const problem of found) {
      problems.push(`${manifestPath} (packed ${artifact.filename}): ${problem}`);
    }
  }
  return problems;
}

function main() {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  );
  const config = readRepoConfig(root).packageContents;
  const problems = checkPackageContents(root, config);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(
      `\n${problems.length} package content problem(s). Expected files are declared in scripts/repo/repo-check.config.json under "packageContents".`
    );
    process.exit(1);
  }
  const names = Object.keys(config.packages ?? {});
  console.log(`Package contents: OK (${names.join(", ")} match their allowlists).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
