#!/usr/bin/env ts-node
/**
 * validate-release-manifest.ts
 *
 * Reads the release manifest (release-manifest.json) and blocks any contract
 * upgrade that introduces incompatible storage changes without a covering
 * approved migration record.
 *
 * The release manifest describes what is about to be deployed:
 *
 * ```json
 * {
 *   "release": "2026-08-30",
 *   "contracts": [
 *     {
 *       "name": "core_vault",
 *       "proposed_wasm_hash": "abc123...",
 *       "proposed_schema": "tmp/schemas/core_vault.schema.json",
 *       "migrations": "contracts/migrations/core_vault.migrations.json"
 *     }
 *   ]
 * }
 * ```
 *
 * For each listed contract the validator:
 *
 *   1. Loads the baseline schema from contracts/schemas/<name>.schema.json.
 *   2. Loads the proposed schema from the path in the manifest entry.
 *   3. Loads migration records if provided.
 *   4. Runs the schema comparator.
 *   5. Fails (exit 1) if verdict is BREAKING.
 *   6. Fails if verdict is MIGRATION_REQUIRED and not all affected keys have
 *      a covering, approved, idempotent migration.
 *
 * Usage:
 *   ts-node scripts/validate-release-manifest.ts \
 *     --manifest release-manifest.json \
 *     [--baseline-schemas-dir contracts/schemas]
 */

import * as fs from "fs";
import * as path from "path";
import { compareSchemas } from "./compare-storage-schemas";
import type { ComparisonResult, MigrationRecord, ChangeKind } from "./compare-storage-schemas";
import type { ContractStorageSchema } from "./extract-storage-schema";

// ─── Manifest types ───────────────────────────────────────────────────────────

interface ManifestContractEntry {
  /** Contract workspace member name, e.g. "core_vault" */
  name: string;
  /** Optional: hash of the proposed WASM for audit trail */
  proposed_wasm_hash?: string;
  /** Path to the proposed schema JSON (relative to cwd or absolute) */
  proposed_schema: string;
  /** Optional path to migration records JSON */
  migrations?: string;
}

interface ReleaseManifest {
  /** Human-readable release tag, e.g. "2026-08-30" */
  release: string;
  contracts: ManifestContractEntry[];
}

// ─── Validation result ────────────────────────────────────────────────────────

interface ContractValidationResult {
  name: string;
  verdict: ChangeKind;
  comparison: ComparisonResult;
  /** True only if all migration-required changes are covered by approved migrations */
  migrations_complete: boolean;
  /** True if this contract is cleared to proceed */
  approved: boolean;
  blockers: string[];
}

interface ManifestValidationResult {
  release: string;
  validated_at: string;
  /** True if every contract passed */
  all_approved: boolean;
  contract_results: ContractValidationResult[];
  summary: string;
}

// ─── Validation logic ─────────────────────────────────────────────────────────

function loadJson<T>(p: string): T {
  if (!fs.existsSync(p)) {
    throw new Error(`File not found: ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

function validateContract(
  entry: ManifestContractEntry,
  baselineSchemasDir: string
): ContractValidationResult {
  const baselinePath = path.join(baselineSchemasDir, `${entry.name}.schema.json`);

  let baseline: ContractStorageSchema;
  try {
    baseline = loadJson<ContractStorageSchema>(baselinePath);
  } catch (e) {
    return {
      name: entry.name,
      verdict: "BREAKING",
      comparison: {} as ComparisonResult,
      migrations_complete: false,
      approved: false,
      blockers: [
        `Baseline schema not found at ${baselinePath}. ` +
          `Run scripts/extract-storage-schema.ts to generate it.`,
      ],
    };
  }

  let proposed: ContractStorageSchema;
  try {
    proposed = loadJson<ContractStorageSchema>(entry.proposed_schema);
  } catch (e) {
    return {
      name: entry.name,
      verdict: "BREAKING",
      comparison: {} as ComparisonResult,
      migrations_complete: false,
      approved: false,
      blockers: [
        `Proposed schema not found at ${entry.proposed_schema}. ` +
          `Ensure the build step produces this file.`,
      ],
    };
  }

  // If source hash is unchanged, skip full comparison
  if (
    baseline.source_hash === proposed.source_hash &&
    baseline.schema_version === proposed.schema_version
  ) {
    const noopComparison: ComparisonResult = {
      contract: entry.name,
      baseline_version: baseline.schema_version,
      proposed_version: proposed.schema_version,
      baseline_hash: baseline.source_hash,
      proposed_hash: proposed.source_hash,
      verdict: "COMPATIBLE",
      key_changes: [],
      struct_changes: [],
      summary: `${entry.name}: source unchanged — skipping comparison`,
      compared_at: new Date().toISOString(),
    };
    return {
      name: entry.name,
      verdict: "COMPATIBLE",
      comparison: noopComparison,
      migrations_complete: true,
      approved: true,
      blockers: [],
    };
  }

  const migrations: MigrationRecord[] = entry.migrations
    ? loadJson<MigrationRecord[]>(entry.migrations)
    : [];

  const comparison = compareSchemas(baseline, proposed, migrations);
  const blockers: string[] = [];

  // Check for unapproved migrations
  if (!migrations.every((m) => m.approved_by && m.idempotent)) {
    const bad = migrations.filter((m) => !m.approved_by || !m.idempotent);
    for (const m of bad) {
      blockers.push(
        `Migration ${m.id}: missing ${!m.approved_by ? "approved_by" : ""}${!m.idempotent ? " idempotent=true" : ""}`
      );
    }
  }

  // All BREAKING changes are blockers
  for (const kc of comparison.key_changes) {
    if (kc.kind === "BREAKING") {
      blockers.push(
        `Key "${kc.key}": ${kc.description}`
      );
    }
  }
  for (const sc of comparison.struct_changes) {
    if (sc.kind === "BREAKING") {
      blockers.push(
        `Struct "${sc.struct_name}": ${sc.description}`
      );
    }
  }

  // MIGRATION_REQUIRED changes need a covering migration
  const migrationKeys = new Set(migrations.map((m) => m.key));
  for (const kc of comparison.key_changes) {
    if (kc.kind === "MIGRATION_REQUIRED" && !kc.migration) {
      if (!migrationKeys.has(kc.key)) {
        blockers.push(
          `Key "${kc.key}" requires migration but no migration record covers it`
        );
      }
    }
  }

  const migrationsComplete =
    comparison.key_changes
      .filter((c) => c.kind === "MIGRATION_REQUIRED")
      .every((c) => c.migration !== undefined || migrationKeys.has(c.key)) &&
    blockers.length === 0;

  const approved = comparison.verdict !== "BREAKING" && blockers.length === 0;

  return {
    name: entry.name,
    verdict: comparison.verdict,
    comparison,
    migrations_complete: migrationsComplete,
    approved,
    blockers,
  };
}

export function validateManifest(
  manifest: ReleaseManifest,
  baselineSchemasDir: string
): ManifestValidationResult {
  const contractResults: ContractValidationResult[] = [];

  for (const entry of manifest.contracts) {
    const result = validateContract(entry, baselineSchemasDir);
    contractResults.push(result);
  }

  const allApproved = contractResults.every((r) => r.approved);

  // Build human-readable summary
  const lines: string[] = [
    `Release: ${manifest.release}`,
    `Validation: ${allApproved ? "✅ APPROVED" : "❌ BLOCKED"}`,
    "",
  ];

  const blocked = contractResults.filter((r) => !r.approved);
  const cleared = contractResults.filter((r) => r.approved);

  if (blocked.length > 0) {
    lines.push(`Blocked (${blocked.length}):`);
    for (const r of blocked) {
      lines.push(`  ❌ ${r.name}  [${r.verdict}]`);
      for (const blocker of r.blockers) {
        lines.push(`       • ${blocker}`);
      }
    }
    lines.push("");
  }

  if (cleared.length > 0) {
    lines.push(`Cleared (${cleared.length}):`);
    for (const r of cleared) {
      const tag = r.verdict === "MIGRATION_REQUIRED" ? " (with migrations)" : "";
      lines.push(`  ✅ ${r.name}  [${r.verdict}]${tag}`);
    }
  }

  return {
    release: manifest.release,
    validated_at: new Date().toISOString(),
    all_approved: allApproved,
    contract_results: contractResults,
    summary: lines.join("\n"),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let manifestPath: string | undefined;
  let baselineSchemasDir = path.resolve(__dirname, "../contracts/schemas");
  let outputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest" && args[i + 1]) manifestPath = args[++i];
    else if (args[i] === "--baseline-schemas-dir" && args[i + 1])
      baselineSchemasDir = args[++i];
    else if (args[i] === "--output" && args[i + 1]) outputPath = args[++i];
  }

  if (!manifestPath) {
    console.error(
      "Usage: validate-release-manifest --manifest <path> " +
        "[--baseline-schemas-dir <path>] [--output <path>]"
    );
    process.exit(1);
  }

  let manifest: ReleaseManifest;
  try {
    manifest = loadJson<ReleaseManifest>(manifestPath);
  } catch (e) {
    console.error(`Failed to load manifest: ${(e as Error).message}`);
    process.exit(1);
  }

  const result = validateManifest(manifest, baselineSchemasDir);

  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
  }

  console.log(result.summary);

  process.exit(result.all_approved ? 0 : 1);
}

if (require.main === module) {
  main();
}
