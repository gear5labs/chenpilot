#!/usr/bin/env node
/**
 * Report duplicate direct dependencies across workspace boundaries.
 *
 * The monorepo has root, bot, and SDK package boundaries. When two workspaces
 * declare the same package at different version ranges the runtime can pull in
 * two copies of the same module (or two major versions), inflating bundle size
 * and creating subtle behavioural splits.
 *
 * Policy:
 *   - Every duplicate direct dependency is reported by package and version range.
 *   - Intentional duplicates are allowed through a reviewed exception list
 *     (scripts/repo/repo-check.config.json -> `duplicateDependencies.allow`).
 *   - Unexplained major-version splits fail the check.
 *
 * Usage: node scripts/repo/check-duplicate-dependencies.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readRepoConfig } from "./config.mjs";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies"];

/**
 * Split a semver range into its major version when the range is pinned tightly
 * enough to identify one (`^1.2.3`, `1.x`, `~2.0`, `>=3 <4`). Returns null when
 * the range is too loose to attribute a single major.
 */
export function majorOf(range) {
  const cleaned = String(range).trim();
  if (cleaned === "" || cleaned === "workspace:*") return null;
  const m = cleaned.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Collect direct dependencies from a workspace manifest.
 * Returns Map<packageName, [{ workspace, field, range }]>.
 */
export function inventory(root, workspaces) {
  const byPackage = new Map();
  for (const ws of workspaces) {
    const manifestPath = path.posix.join(ws, "package.json");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, manifestPath), "utf8")
    );
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (!byPackage.has(name)) byPackage.set(name, []);
        byPackage.get(name).push({ workspace: ws, field, range });
      }
    }
  }
  return byPackage;
}

function isAllowed(name, allow) {
  return (allow ?? []).some(
    (entry) => entry.name === name || entry.name === new RegExp(entry.name)
  );
}

/**
 * Compare declared ranges across workspaces and return a list of findings.
 * A finding is `{ name, entries, majors, kind }` where kind is
 * "duplicate" (same major, different ranges) or "major-split".
 */
export function findDuplicates(byPackage, config) {
  const allow = config.allow ?? [];
  const findings = [];
  for (const [name, entries] of byPackage) {
    if (entries.length < 2) continue;
    const workspaces = new Set(entries.map((e) => e.workspace));
    if (workspaces.size < 2) continue;

    const majors = [...new Set(entries.map((e) => majorOf(e.range)))];
    const ranges = [...new Set(entries.map((e) => e.range))];
    if (ranges.length < 2) continue;
    const majorSplit =
      majors.filter((m) => m !== null).length > 1 ||
      (majors.includes(null) && majors.filter((m) => m !== null).length >= 1);

    const kind = majorSplit ? "major-split" : "duplicate";
    if (isAllowed(name, allow)) continue;

    findings.push({
      name,
      kind,
      majors,
      entries: entries.map((e) => ({
        workspace: e.workspace,
        field: e.field,
        range: e.range,
      })),
    });
  }
  // Stable output ordering.
  findings.sort((a, b) => a.name.localeCompare(b.name));
  return findings;
}

export function checkDuplicateDependencies(root, config) {
  const byPackage = inventory(root, config.workspaces ?? [".", "packages/sdk", "packages/bot"]);
  return findDuplicates(byPackage, config);
}

function describeFinding(finding) {
  const lines = finding.entries.map(
    (e) => `    - ${e.workspace} (${e.field}): ${e.range}`
  );
  return `  ${finding.kind === "major-split" ? "FAIL" : "WARN"} ${finding.name}\n${lines.join("\n")}`;
}

function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, "../..");
  const config = (readRepoConfig(root).duplicateDependencies) ?? {};
  const findings = checkDuplicateDependencies(root, config);

  const failures = findings.filter((f) => f.kind === "major-split");
  const warnings = findings.filter((f) => f.kind !== "major-split");

  if (warnings.length > 0) {
    console.log("Duplicate direct dependencies across workspaces:");
    for (const f of warnings) console.log(describeFinding(f));
  }
  if (failures.length > 0) {
    console.error("Unexplained major-version splits:");
    for (const f of failures) console.error(describeFinding(f));
    process.exit(1);
  }
  if (warnings.length === 0) {
    console.log("No duplicate direct dependencies across workspaces.");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
