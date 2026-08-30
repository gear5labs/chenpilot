#!/usr/bin/env ts-node
/**
 * compare-storage-schemas.ts
 *
 * Diffs a baseline schema against a proposed schema and classifies every
 * change as one of:
 *
 *   COMPATIBLE          – new keys added, TTL extensions, new optional struct
 *                         fields (append-only), value type unchanged.
 *   MIGRATION_REQUIRED  – value type changed but a registered MigrationRecord
 *                         covers the transition, or a key is removed but
 *                         marked as deprecated.
 *   BREAKING            – key removed without a migration, value type changed
 *                         without a migration, key_params changed, storage
 *                         class changed, struct field removed or reordered.
 *
 * Usage (CLI):
 *   ts-node scripts/compare-storage-schemas.ts \
 *     --baseline contracts/schemas/core_vault.schema.json \
 *     --proposed /tmp/proposed/core_vault.schema.json \
 *     [--migrations contracts/migrations/core_vault.migrations.json]
 *
 * Programmatic API: import { compareSchemas } from './compare-storage-schemas'
 */

import * as fs from "fs";
import * as path from "path";
import type { ContractStorageSchema, StorageKeySchema, StructSchema } from "./extract-storage-schema";

// ─── Change classification ────────────────────────────────────────────────────

export type ChangeKind = "COMPATIBLE" | "MIGRATION_REQUIRED" | "BREAKING";

export interface KeyChange {
  key: string;
  kind: ChangeKind;
  description: string;
  /** Baseline state (undefined if key is new) */
  baseline?: StorageKeySchema;
  /** Proposed state (undefined if key was removed) */
  proposed?: StorageKeySchema;
  /** Name of covering migration if kind === MIGRATION_REQUIRED */
  migration?: string;
}

export interface StructChange {
  struct_name: string;
  kind: ChangeKind;
  description: string;
  removed_fields?: string[];
  added_fields?: string[];
  reordered?: boolean;
}

export interface ComparisonResult {
  contract: string;
  baseline_version: string;
  proposed_version: string;
  baseline_hash: string;
  proposed_hash: string;
  /** Overall verdict — worst classification across all changes */
  verdict: ChangeKind;
  key_changes: KeyChange[];
  struct_changes: StructChange[];
  /** Human-readable summary */
  summary: string;
  compared_at: string;
}

// ─── Migration manifest type ──────────────────────────────────────────────────

export interface MigrationRecord {
  /** Unique migration ID, e.g. "core_vault_001" */
  id: string;
  /** DataKey name or symbol this migration covers */
  key: string;
  from_type: string;
  to_type: string;
  /** Idempotency guarantee — must be true to be accepted */
  idempotent: boolean;
  /** Who reviewed this migration */
  approved_by: string;
  approved_at: string;
  description: string;
}

// ─── Severity ordering ────────────────────────────────────────────────────────

const SEVERITY: Record<ChangeKind, number> = {
  COMPATIBLE: 0,
  MIGRATION_REQUIRED: 1,
  BREAKING: 2,
};

function worst(a: ChangeKind, b: ChangeKind): ChangeKind {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

// ─── Key comparison ───────────────────────────────────────────────────────────

function compareKey(
  baseline: StorageKeySchema,
  proposed: StorageKeySchema,
  migrations: MigrationRecord[]
): KeyChange {
  const issues: string[] = [];
  let kind: ChangeKind = "COMPATIBLE";

  // Storage class change is always breaking
  if (baseline.storage_class !== proposed.storage_class) {
    issues.push(
      `storage class changed from ${baseline.storage_class} to ${proposed.storage_class}`
    );
    kind = "BREAKING";
  }

  // Key params change (composite key structure changed) is always breaking
  const baseParams = baseline.key_params.join(", ");
  const propParams = proposed.key_params.join(", ");
  if (baseParams !== propParams) {
    issues.push(
      `key params changed from (${baseParams}) to (${propParams})`
    );
    kind = "BREAKING";
  }

  // Value type change — check for covering migration
  if (
    baseline.value_type !== proposed.value_type &&
    baseline.value_type !== "unknown" &&
    proposed.value_type !== "unknown"
  ) {
    const migration = migrations.find(
      (m) =>
        m.key === baseline.key &&
        m.from_type === baseline.value_type &&
        m.to_type === proposed.value_type &&
        m.idempotent
    );

    if (migration) {
      issues.push(
        `value type changed from ${baseline.value_type} to ${proposed.value_type} ` +
          `(covered by migration ${migration.id})`
      );
      kind = worst(kind, "MIGRATION_REQUIRED");
      return {
        key: baseline.key,
        kind,
        description: issues.join("; "),
        baseline,
        proposed,
        migration: migration.id,
      };
    } else {
      issues.push(
        `value type changed from ${baseline.value_type} to ${proposed.value_type} without a migration`
      );
      kind = "BREAKING";
    }
  }

  // TTL reduction is breaking (existing entries might expire sooner than expected)
  if (
    baseline.ttl_ledgers !== undefined &&
    proposed.ttl_ledgers !== undefined &&
    proposed.ttl_ledgers < baseline.ttl_ledgers
  ) {
    issues.push(
      `TTL reduced from ${baseline.ttl_ledgers} to ${proposed.ttl_ledgers} ledgers — ` +
        `existing entries may expire prematurely`
    );
    kind = worst(kind, "BREAKING");
  }

  if (issues.length === 0) {
    issues.push("no change");
  }

  return {
    key: baseline.key,
    kind,
    description: issues.join("; "),
    baseline,
    proposed,
  };
}

// ─── Struct comparison ────────────────────────────────────────────────────────

function compareStruct(
  baseline: StructSchema,
  proposed: StructSchema
): StructChange {
  const baseNames = baseline.fields.map((f) => f.name);
  const propNames = proposed.fields.map((f) => f.name);

  const removed = baseNames.filter((n) => !propNames.includes(n));
  const added = propNames.filter((n) => !baseNames.includes(n));

  // Check for field reordering (Soroban XDR encoding is positional)
  const common = baseNames.filter((n) => propNames.includes(n));
  const baseOrder = common.map((n) => baseNames.indexOf(n));
  const propOrder = common.map((n) => propNames.indexOf(n));
  const reordered = baseOrder.some((v, i) => v !== propOrder[i]) ||
    // also flag if existing fields shift due to insertion in middle
    common.some((n, i) => {
      const bi = baseNames.indexOf(n);
      const pi = propNames.indexOf(n);
      return bi !== pi;
    });

  let kind: ChangeKind = "COMPATIBLE";
  const issues: string[] = [];

  if (removed.length > 0) {
    issues.push(`fields removed: ${removed.join(", ")}`);
    kind = "BREAKING";
  }

  if (reordered) {
    issues.push("field order changed — XDR encoding will differ for existing entries");
    kind = worst(kind, "BREAKING");
  }

  // Check type changes for common fields
  for (const fieldName of common) {
    const bf = baseline.fields.find((f) => f.name === fieldName)!;
    const pf = proposed.fields.find((f) => f.name === fieldName)!;
    if (bf.type !== pf.type) {
      issues.push(`field ${fieldName} type changed from ${bf.type} to ${pf.type}`);
      kind = worst(kind, "BREAKING");
    }
  }

  if (added.length > 0) {
    // Adding fields at the end is compatible in Soroban's map encoding;
    // insertion in the middle is caught by reordering check above.
    if (kind === "COMPATIBLE") {
      issues.push(`fields added: ${added.join(", ")} (append-only — compatible)`);
    }
  }

  if (issues.length === 0) {
    issues.push("no change");
  }

  return {
    struct_name: baseline.name,
    kind,
    description: issues.join("; "),
    removed_fields: removed.length > 0 ? removed : undefined,
    added_fields: added.length > 0 ? added : undefined,
    reordered,
  };
}

// ─── Main comparison ──────────────────────────────────────────────────────────

export function compareSchemas(
  baseline: ContractStorageSchema,
  proposed: ContractStorageSchema,
  migrations: MigrationRecord[] = []
): ComparisonResult {
  const keyChanges: KeyChange[] = [];
  const structChanges: StructChange[] = [];

  const baseKeyMap = new Map(baseline.data_keys.map((k) => [k.key, k]));
  const propKeyMap = new Map(proposed.data_keys.map((k) => [k.key, k]));

  // Keys present in baseline
  for (const [key, bk] of baseKeyMap) {
    if (!propKeyMap.has(key)) {
      // Key removed — breaking unless covered by a migration that marks removal
      const migration = migrations.find(
        (m) => m.key === key && m.to_type === "removed" && m.idempotent
      );
      if (migration) {
        keyChanges.push({
          key,
          kind: "MIGRATION_REQUIRED",
          description: `key removed (covered by migration ${migration.id})`,
          baseline: bk,
          migration: migration.id,
        });
      } else {
        keyChanges.push({
          key,
          kind: "BREAKING",
          description: "key removed without a migration — existing state will be orphaned",
          baseline: bk,
        });
      }
    } else {
      const pk = propKeyMap.get(key)!;
      const change = compareKey(bk, pk, migrations);
      if (change.description !== "no change") {
        keyChanges.push(change);
      }
    }
  }

  // New keys in proposed (always compatible)
  for (const [key, pk] of propKeyMap) {
    if (!baseKeyMap.has(key)) {
      keyChanges.push({
        key,
        kind: "COMPATIBLE",
        description: "new key added",
        proposed: pk,
      });
    }
  }

  // Struct comparison
  const baseStructMap = new Map(baseline.structs.map((s) => [s.name, s]));
  const propStructMap = new Map(proposed.structs.map((s) => [s.name, s]));

  for (const [name, bs] of baseStructMap) {
    if (!propStructMap.has(name)) {
      // Struct removed — check if it was used as a value type for any key
      const usedByKey = baseline.data_keys.find((k) => k.value_type === name);
      if (usedByKey) {
        structChanges.push({
          struct_name: name,
          kind: "BREAKING",
          description: `struct removed — it was the value type for key ${usedByKey.key}`,
        });
      }
      // else: internal-only struct removal is compatible
    } else {
      const ps = propStructMap.get(name)!;
      const change = compareStruct(bs, ps);
      if (change.description !== "no change") {
        structChanges.push(change);
      }
    }
  }

  // Compute overall verdict
  let verdict: ChangeKind = "COMPATIBLE";
  for (const kc of keyChanges) verdict = worst(verdict, kc.kind);
  for (const sc of structChanges) verdict = worst(verdict, sc.kind);

  // Build summary
  const breaking = [
    ...keyChanges.filter((c) => c.kind === "BREAKING"),
    ...structChanges.filter((c) => c.kind === "BREAKING"),
  ];
  const migration = [
    ...keyChanges.filter((c) => c.kind === "MIGRATION_REQUIRED"),
    ...structChanges.filter((c) => c.kind === "MIGRATION_REQUIRED"),
  ];
  const compatible = [
    ...keyChanges.filter((c) => c.kind === "COMPATIBLE"),
    ...structChanges.filter((c) => c.kind === "COMPATIBLE"),
  ];

  const lines: string[] = [
    `Contract: ${baseline.contract}`,
    `Verdict: ${verdict}`,
  ];
  if (breaking.length > 0) {
    lines.push(`Breaking (${breaking.length}):`);
    for (const c of breaking) {
      const label = "key" in c ? `key ${(c as KeyChange).key}` : `struct ${(c as StructChange).struct_name}`;
      lines.push(`  • ${label}: ${c.description}`);
    }
  }
  if (migration.length > 0) {
    lines.push(`Migration required (${migration.length}):`);
    for (const c of migration) {
      const label = "key" in c ? `key ${(c as KeyChange).key}` : `struct ${(c as StructChange).struct_name}`;
      lines.push(`  • ${label}: ${c.description}`);
    }
  }
  if (compatible.length > 0) {
    lines.push(`Compatible (${compatible.length}):`);
    for (const c of compatible) {
      const label = "key" in c ? `key ${(c as KeyChange).key}` : `struct ${(c as StructChange).struct_name}`;
      lines.push(`  • ${label}: ${c.description}`);
    }
  }

  return {
    contract: baseline.contract,
    baseline_version: baseline.schema_version,
    proposed_version: proposed.schema_version,
    baseline_hash: baseline.source_hash,
    proposed_hash: proposed.source_hash,
    verdict,
    key_changes: keyChanges,
    struct_changes: structChanges,
    summary: lines.join("\n"),
    compared_at: new Date().toISOString(),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function loadJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

function main() {
  const args = process.argv.slice(2);
  let baselinePath: string | undefined;
  let proposedPath: string | undefined;
  let migrationsPath: string | undefined;
  let outputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--baseline" && args[i + 1]) baselinePath = args[++i];
    else if (args[i] === "--proposed" && args[i + 1]) proposedPath = args[++i];
    else if (args[i] === "--migrations" && args[i + 1]) migrationsPath = args[++i];
    else if (args[i] === "--output" && args[i + 1]) outputPath = args[++i];
  }

  if (!baselinePath || !proposedPath) {
    console.error(
      "Usage: compare-storage-schemas --baseline <path> --proposed <path> [--migrations <path>] [--output <path>]"
    );
    process.exit(1);
  }

  const baseline = loadJson<ContractStorageSchema>(baselinePath);
  const proposed = loadJson<ContractStorageSchema>(proposedPath);
  const migrations: MigrationRecord[] = migrationsPath
    ? loadJson<MigrationRecord[]>(migrationsPath)
    : [];

  const result = compareSchemas(baseline, proposed, migrations);

  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
  }

  console.log(result.summary);

  // Exit 1 for BREAKING, 2 for MIGRATION_REQUIRED without all migrations
  if (result.verdict === "BREAKING") {
    process.exit(1);
  }
  if (result.verdict === "MIGRATION_REQUIRED") {
    process.exit(2);
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}
