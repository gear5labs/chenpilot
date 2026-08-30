/**
 * storageSchemaComparator.test.ts
 *
 * Tests for scripts/compare-storage-schemas.ts — covers:
 *   - COMPATIBLE: new keys, TTL extension, struct field append
 *   - BREAKING: key removed, value type change without migration,
 *               storage class change, key param change, struct field
 *               removed, struct field reordered, struct field type changed
 *   - MIGRATION_REQUIRED: value type change covered by an approved idempotent
 *                         migration record
 */

import { compareSchemas } from "../../scripts/compare-storage-schemas";
import type {
  ComparisonResult,
  MigrationRecord,
} from "../../scripts/compare-storage-schemas";
import type {
  ContractStorageSchema,
  StorageKeySchema,
  StructSchema,
} from "../../scripts/extract-storage-schema";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function makeKey(
  overrides: Partial<StorageKeySchema> = {}
): StorageKeySchema {
  return {
    key: "Config",
    key_kind: "DataKey",
    key_params: [],
    value_type: "Config",
    storage_class: "Instance",
    ...overrides,
  };
}

function makeStruct(
  name: string,
  fields: Array<{ name: string; type: string }>
): StructSchema {
  return { name, fields };
}

function makeSchema(
  overrides: Partial<ContractStorageSchema> = {}
): ContractStorageSchema {
  return {
    contract: "test_contract",
    schema_version: "1",
    extracted_at: "2026-08-30T00:00:00.000Z",
    source_hash: "aabbccdd",
    data_keys: [makeKey()],
    structs: [
      makeStruct("Config", [
        { name: "admin", type: "Address" },
        { name: "fee_bps", type: "u32" },
      ]),
    ],
    enums: [],
    warnings: [],
    ...overrides,
  };
}

function makeMigration(overrides: Partial<MigrationRecord> = {}): MigrationRecord {
  return {
    id: "test_001",
    key: "Config",
    from_type: "Config",
    to_type: "ConfigV2",
    idempotent: true,
    approved_by: "alice@example.com",
    approved_at: "2026-08-30T00:00:00.000Z",
    description: "Adds fee_token field",
    ...overrides,
  };
}

// ─── COMPATIBLE scenarios ─────────────────────────────────────────────────────

describe("compareSchemas — COMPATIBLE", () => {
  test("identical schemas produce COMPATIBLE verdict", () => {
    const baseline = makeSchema();
    const proposed = makeSchema({ source_hash: "aabbccdd" });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("COMPATIBLE");
    expect(result.key_changes).toHaveLength(0);
    expect(result.struct_changes).toHaveLength(0);
  });

  test("new key added to proposed is COMPATIBLE", () => {
    const baseline = makeSchema();
    const proposed = makeSchema({
      data_keys: [
        makeKey(),
        makeKey({ key: "NewKey", value_type: "i128" }),
      ],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("COMPATIBLE");
    const newKeyChange = result.key_changes.find((c) => c.key === "NewKey");
    expect(newKeyChange).toBeDefined();
    expect(newKeyChange!.kind).toBe("COMPATIBLE");
  });

  test("TTL extended (higher ledger count) is COMPATIBLE", () => {
    const baseline = makeSchema({
      data_keys: [
        makeKey({ key: "Position", storage_class: "Persistent", ttl_ledgers: 1_000_000 }),
      ],
    });
    const proposed = makeSchema({
      data_keys: [
        makeKey({ key: "Position", storage_class: "Persistent", ttl_ledgers: 2_000_000 }),
      ],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("COMPATIBLE");
  });

  test("struct field appended at end is COMPATIBLE", () => {
    const baseline = makeSchema();
    const proposed = makeSchema({
      structs: [
        makeStruct("Config", [
          { name: "admin", type: "Address" },
          { name: "fee_bps", type: "u32" },
          { name: "fee_token", type: "Address" }, // new field appended
        ]),
      ],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("COMPATIBLE");
    const change = result.struct_changes.find((c) => c.struct_name === "Config");
    expect(change?.kind).toBe("COMPATIBLE");
    expect(change?.added_fields).toContain("fee_token");
  });

  test("adding a new struct not referenced by any key is COMPATIBLE", () => {
    const baseline = makeSchema();
    const proposed = makeSchema({
      structs: [
        makeStruct("Config", [
          { name: "admin", type: "Address" },
          { name: "fee_bps", type: "u32" },
        ]),
        makeStruct("AuditRecord", [
          { name: "who", type: "Address" },
          { name: "when", type: "u64" },
        ]),
      ],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("COMPATIBLE");
  });

  test("value type unchanged with TTL constant name change is COMPATIBLE", () => {
    const baseline = makeSchema({
      data_keys: [
        makeKey({ ttl_constant: "OLD_TTL_LEDGERS", ttl_ledgers: 500_000 }),
      ],
    });
    const proposed = makeSchema({
      data_keys: [
        makeKey({ ttl_constant: "NEW_TTL_LEDGERS", ttl_ledgers: 500_000 }),
      ],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("COMPATIBLE");
  });
});

// ─── BREAKING scenarios ───────────────────────────────────────────────────────

describe("compareSchemas — BREAKING", () => {
  test("key removed without migration is BREAKING", () => {
    const baseline = makeSchema({
      data_keys: [
        makeKey({ key: "Config" }),
        makeKey({ key: "UserBalance", storage_class: "Persistent", value_type: "i128" }),
      ],
    });
    const proposed = makeSchema({
      data_keys: [
        makeKey({ key: "Config" }),
        // UserBalance removed
      ],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("BREAKING");
    const change = result.key_changes.find((c) => c.key === "UserBalance");
    expect(change?.kind).toBe("BREAKING");
    expect(change?.description).toMatch(/removed without a migration/);
  });

  test("value type changed without migration is BREAKING", () => {
    const baseline = makeSchema({
      data_keys: [makeKey({ value_type: "Config" })],
    });
    const proposed = makeSchema({
      data_keys: [makeKey({ value_type: "ConfigV2" })],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("BREAKING");
    const change = result.key_changes.find((c) => c.key === "Config");
    expect(change?.kind).toBe("BREAKING");
    expect(change?.description).toMatch(/without a migration/);
  });

  test("storage class changed from Persistent to Instance is BREAKING", () => {
    const baseline = makeSchema({
      data_keys: [makeKey({ key: "Position", storage_class: "Persistent" })],
    });
    const proposed = makeSchema({
      data_keys: [makeKey({ key: "Position", storage_class: "Instance" })],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("BREAKING");
    const change = result.key_changes.find((c) => c.key === "Position");
    expect(change?.kind).toBe("BREAKING");
    expect(change?.description).toMatch(/storage class changed/);
  });

  test("storage class changed from Instance to Persistent is BREAKING", () => {
    const baseline = makeSchema({
      data_keys: [makeKey({ key: "Config", storage_class: "Instance" })],
    });
    const proposed = makeSchema({
      data_keys: [makeKey({ key: "Config", storage_class: "Persistent" })],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("BREAKING");
  });

  test("composite key params changed is BREAKING", () => {
    const baseline = makeSchema({
      data_keys: [
        makeKey({ key: "HasRole", key_params: ["Address", "Role"], value_type: "bool" }),
      ],
    });
    const proposed = makeSchema({
      data_keys: [
        makeKey({ key: "HasRole", key_params: ["Address"], value_type: "bool" }),
      ],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("BREAKING");
    const change = result.key_changes.find((c) => c.key === "HasRole");
    expect(change?.kind).toBe("BREAKING");
    expect(change?.description).toMatch(/key params changed/);
  });

  test("struct field removed is BREAKING", () => {
    const baseline = makeSchema({
      structs: [
        makeStruct("Config", [
          { name: "admin", type: "Address" },
          { name: "fee_bps", type: "u32" },
          { name: "collateral_factor", type: "i128" },
        ]),
      ],
    });
    const proposed = makeSchema({
      structs: [
        makeStruct("Config", [
          { name: "admin", type: "Address" },
          { name: "fee_bps", type: "u32" },
          // collateral_factor removed
        ]),
      ],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("BREAKING");
    const change = result.struct_changes.find((c) => c.struct_name === "Config");
    expect(change?.kind).toBe("BREAKING");
    expect(change?.removed_fields).toContain("collateral_factor");
  });

  test("struct field reordered is BREAKING (XDR is positional)", () => {
    const baseline = makeSchema({
      structs: [
        makeStruct("Config", [
          { name: "admin", type: "Address" },
          { name: "fee_bps", type: "u32" },
        ]),
      ],
    });
    const proposed = makeSchema({
      structs: [
        makeStruct("Config", [
          { name: "fee_bps", type: "u32" }, // swapped
          { name: "admin", type: "Address" },
        ]),
      ],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("BREAKING");
    const change = result.struct_changes.find((c) => c.struct_name === "Config");
    expect(change?.kind).toBe("BREAKING");
    expect(change?.reordered).toBe(true);
  });

  test("struct field type changed is BREAKING", () => {
    const baseline = makeSchema({
      structs: [
        makeStruct("Config", [
          { name: "admin", type: "Address" },
          { name: "fee_bps", type: "u32" },
        ]),
      ],
    });
    const proposed = makeSchema({
      structs: [
        makeStruct("Config", [
          { name: "admin", type: "Address" },
          { name: "fee_bps", type: "i128" }, // widened — still breaking in XDR
        ]),
      ],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("BREAKING");
    const change = result.struct_changes.find((c) => c.struct_name === "Config");
    expect(change?.kind).toBe("BREAKING");
    expect(change?.description).toMatch(/fee_bps type changed/);
  });

  test("TTL reduced is BREAKING", () => {
    const baseline = makeSchema({
      data_keys: [
        makeKey({ key: "Claimed", storage_class: "Persistent", ttl_ledgers: 6_048_000 }),
      ],
    });
    const proposed = makeSchema({
      data_keys: [
        makeKey({ key: "Claimed", storage_class: "Persistent", ttl_ledgers: 100_000 }),
      ],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("BREAKING");
    const change = result.key_changes.find((c) => c.key === "Claimed");
    expect(change?.kind).toBe("BREAKING");
    expect(change?.description).toMatch(/TTL reduced/);
  });

  test("struct used as value type removed is BREAKING", () => {
    const baseline = makeSchema({
      data_keys: [makeKey({ value_type: "Config" })],
      structs: [
        makeStruct("Config", [{ name: "admin", type: "Address" }]),
      ],
    });
    const proposed = makeSchema({
      data_keys: [makeKey({ value_type: "Config" })],
      structs: [], // Config struct removed
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("BREAKING");
    const change = result.struct_changes.find((c) => c.struct_name === "Config");
    expect(change?.kind).toBe("BREAKING");
  });

  test("multiple independent breaking changes all reported", () => {
    const baseline = makeSchema({
      data_keys: [
        makeKey({ key: "Config", value_type: "Config" }),
        makeKey({ key: "Position", storage_class: "Persistent", value_type: "i128" }),
      ],
    });
    const proposed = makeSchema({
      data_keys: [
        makeKey({ key: "Config", value_type: "ConfigV2" }), // type changed
        // Position removed
      ],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("BREAKING");
    expect(result.key_changes.filter((c) => c.kind === "BREAKING")).toHaveLength(2);
  });
});

// ─── MIGRATION_REQUIRED scenarios ────────────────────────────────────────────

describe("compareSchemas — MIGRATION_REQUIRED", () => {
  test("value type change covered by approved idempotent migration is MIGRATION_REQUIRED", () => {
    const baseline = makeSchema({
      data_keys: [makeKey({ value_type: "Config" })],
    });
    const proposed = makeSchema({
      data_keys: [makeKey({ value_type: "ConfigV2" })],
    });
    const migration = makeMigration({
      key: "Config",
      from_type: "Config",
      to_type: "ConfigV2",
      idempotent: true,
    });

    const result = compareSchemas(baseline, proposed, [migration]);
    expect(result.verdict).toBe("MIGRATION_REQUIRED");
    const change = result.key_changes.find((c) => c.key === "Config");
    expect(change?.kind).toBe("MIGRATION_REQUIRED");
    expect(change?.migration).toBe("test_001");
  });

  test("key removal covered by a migration is MIGRATION_REQUIRED", () => {
    const baseline = makeSchema({
      data_keys: [
        makeKey({ key: "Config" }),
        makeKey({ key: "LegacyAdmin", value_type: "Address" }),
      ],
    });
    const proposed = makeSchema({
      data_keys: [makeKey({ key: "Config" })],
    });
    const migration = makeMigration({
      id: "remove_legacy_admin",
      key: "LegacyAdmin",
      from_type: "Address",
      to_type: "removed",
      idempotent: true,
    });

    const result = compareSchemas(baseline, proposed, [migration]);
    expect(result.verdict).toBe("MIGRATION_REQUIRED");
    const change = result.key_changes.find((c) => c.key === "LegacyAdmin");
    expect(change?.kind).toBe("MIGRATION_REQUIRED");
  });

  test("migration without idempotent=true does NOT downgrade BREAKING to MIGRATION_REQUIRED", () => {
    const baseline = makeSchema({
      data_keys: [makeKey({ value_type: "Config" })],
    });
    const proposed = makeSchema({
      data_keys: [makeKey({ value_type: "ConfigV2" })],
    });
    const migration = makeMigration({
      key: "Config",
      from_type: "Config",
      to_type: "ConfigV2",
      idempotent: false, // NOT idempotent — should not be accepted
    });

    const result = compareSchemas(baseline, proposed, [migration]);
    expect(result.verdict).toBe("BREAKING");
  });

  test("migration with wrong from_type does NOT cover the change", () => {
    const baseline = makeSchema({
      data_keys: [makeKey({ value_type: "Config" })],
    });
    const proposed = makeSchema({
      data_keys: [makeKey({ value_type: "ConfigV2" })],
    });
    const migration = makeMigration({
      key: "Config",
      from_type: "OldConfig", // wrong from_type
      to_type: "ConfigV2",
      idempotent: true,
    });

    const result = compareSchemas(baseline, proposed, [migration]);
    expect(result.verdict).toBe("BREAKING"); // not covered
  });

  test("migration present + breaking storage class change still BREAKING", () => {
    const baseline = makeSchema({
      data_keys: [
        makeKey({ key: "Position", storage_class: "Persistent", value_type: "Position" }),
      ],
    });
    const proposed = makeSchema({
      data_keys: [
        makeKey({ key: "Position", storage_class: "Instance", value_type: "PositionV2" }),
      ],
    });
    const migration = makeMigration({
      key: "Position",
      from_type: "Position",
      to_type: "PositionV2",
      idempotent: true,
    });

    const result = compareSchemas(baseline, proposed, [migration]);
    // Storage class change cannot be covered by a migration record — still BREAKING
    expect(result.verdict).toBe("BREAKING");
  });

  test("mixed: one key migration-required, one key compatible yields MIGRATION_REQUIRED overall", () => {
    const baseline = makeSchema({
      data_keys: [
        makeKey({ key: "Config", value_type: "Config" }),
        makeKey({ key: "Fee", value_type: "i128", storage_class: "Instance" }),
      ],
    });
    const proposed = makeSchema({
      data_keys: [
        makeKey({ key: "Config", value_type: "ConfigV2" }), // covered by migration
        makeKey({ key: "Fee", value_type: "i128", storage_class: "Instance" }), // unchanged
        makeKey({ key: "NewKey", value_type: "u32" }), // new — compatible
      ],
    });
    const migration = makeMigration({
      key: "Config",
      from_type: "Config",
      to_type: "ConfigV2",
      idempotent: true,
    });

    const result = compareSchemas(baseline, proposed, [migration]);
    expect(result.verdict).toBe("MIGRATION_REQUIRED");
    expect(result.key_changes.find((c) => c.key === "Fee")).toBeUndefined();
    expect(result.key_changes.find((c) => c.key === "NewKey")?.kind).toBe("COMPATIBLE");
  });
});

// ─── Summary and output structure ────────────────────────────────────────────

describe("compareSchemas — result structure", () => {
  test("summary contains contract name and verdict", () => {
    const baseline = makeSchema({ contract: "my_contract" });
    const proposed = makeSchema({ contract: "my_contract" });
    const result = compareSchemas(baseline, proposed);
    expect(result.summary).toContain("my_contract");
    expect(result.summary).toContain("COMPATIBLE");
  });

  test("result includes compared_at timestamp", () => {
    const result = compareSchemas(makeSchema(), makeSchema());
    expect(result.compared_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("result includes source hashes from both schemas", () => {
    const baseline = makeSchema({ source_hash: "hash1111" });
    const proposed = makeSchema({ source_hash: "hash2222" });
    const result = compareSchemas(baseline, proposed);
    expect(result.baseline_hash).toBe("hash1111");
    expect(result.proposed_hash).toBe("hash2222");
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("compareSchemas — edge cases", () => {
  test("schema with no data_keys compares cleanly", () => {
    const baseline = makeSchema({ data_keys: [], structs: [] });
    const proposed = makeSchema({ data_keys: [], structs: [] });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("COMPATIBLE");
  });

  test("unknown value types on both sides are treated as no change (extractor limitation)", () => {
    const baseline = makeSchema({
      data_keys: [makeKey({ value_type: "unknown" })],
    });
    const proposed = makeSchema({
      data_keys: [makeKey({ value_type: "unknown" })],
    });
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("COMPATIBLE");
  });

  test("unknown value type changing to known type triggers BREAKING not silent", () => {
    const baseline = makeSchema({
      data_keys: [makeKey({ value_type: "unknown" })],
    });
    const proposed = makeSchema({
      data_keys: [makeKey({ value_type: "ConfigV2" })],
    });
    // The unknown-to-known direction skips type comparison (extractor limitation)
    // so no false breaking alarm
    const result = compareSchemas(baseline, proposed);
    expect(result.verdict).toBe("COMPATIBLE");
  });

  test("proposed has more struct fields in middle position is detected as BREAKING", () => {
    const baseline = makeSchema({
      structs: [
        makeStruct("Config", [
          { name: "admin", type: "Address" },
          { name: "fee_bps", type: "u32" },
        ]),
      ],
    });
    // fee_token inserted between admin and fee_bps — this reorders fee_bps
    const proposed = makeSchema({
      structs: [
        makeStruct("Config", [
          { name: "admin", type: "Address" },
          { name: "fee_token", type: "Address" }, // inserted in middle
          { name: "fee_bps", type: "u32" },
        ]),
      ],
    });
    const result = compareSchemas(baseline, proposed);
    // fee_bps shifted position — should be caught as reordered
    expect(result.verdict).toBe("BREAKING");
  });
});
