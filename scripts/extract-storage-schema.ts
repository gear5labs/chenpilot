#!/usr/bin/env ts-node
/**
 * extract-storage-schema.ts
 *
 * Parses Soroban contract Rust source files and emits a per-contract JSON
 * schema describing every storage key, value type, storage class, and TTL.
 *
 * Usage:
 *   ts-node scripts/extract-storage-schema.ts [--contracts-dir <path>] [--out-dir <path>]
 *
 * Output:
 *   contracts/schemas/<contract_name>.schema.json  for each member of the
 *   workspace Cargo.toml.
 *
 * The extractor is intentionally conservative: it performs line-oriented
 * regex parsing (no full Rust AST parser required in CI).  Unknown patterns
 * produce a warning rather than a silent omission.
 */

import * as fs from "fs";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StorageClass = "Instance" | "Persistent" | "Temporary" | "Symbol";

export interface FieldSchema {
  name: string;
  type: string;
}

export interface StructSchema {
  name: string;
  fields: FieldSchema[];
}

export interface EnumVariantSchema {
  name: string;
  /** Inner types if variant wraps a value, e.g. Address, BytesN<32> */
  inner?: string[];
}

export interface EnumSchema {
  name: string;
  variants: EnumVariantSchema[];
}

export interface StorageKeySchema {
  /** Discriminant name from DataKey enum, or symbol string for symbol_short! keys */
  key: string;
  /** "DataKey" for enum-based keys, "symbol_short" for raw symbol keys */
  key_kind: "DataKey" | "symbol_short";
  /** Inner types for composite keys, e.g. ["Address"] for DataKey::Deposit(Address) */
  key_params: string[];
  /** Resolved value type stored under this key */
  value_type: string;
  storage_class: StorageClass;
  /** Ledger TTL constant name and resolved value if determinable */
  ttl_ledgers?: number;
  ttl_constant?: string;
}

export interface ContractStorageSchema {
  contract: string;
  schema_version: string;
  extracted_at: string;
  /** Git-style content hash of source file for change detection */
  source_hash: string;
  data_keys: StorageKeySchema[];
  structs: StructSchema[];
  enums: EnumSchema[];
  warnings: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readFile(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

function simpleHash(content: string): string {
  // djb2 – deterministic, dependency-free
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h + content.charCodeAt(i)) & 0xffffffff;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Strip Rust line comments and collapse whitespace for easier pattern matching */
function normaliseRust(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, " ") // strip // comments
    .replace(/\/\*[\s\S]*?\*\//g, " ") // strip /* */ comments
    .replace(/\s+/g, " ");
}

// ─── TTL resolution ───────────────────────────────────────────────────────────

function extractTtlConstants(src: string): Map<string, number> {
  const map = new Map<string, number>();
  // const FOO_TTL_LEDGERS: u32 = 123_456;
  const re = /const\s+(\w+TTL\w*LEDGERS\w*)\s*:\s*\w+\s*=\s*([\d_]+)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const value = parseInt(m[2].replace(/_/g, ""), 10);
    map.set(name, value);
  }
  return map;
}

// ─── DataKey enum parsing ─────────────────────────────────────────────────────

function extractDataKeyEnum(normalised: string): EnumSchema | null {
  // Find `pub enum DataKey { ... }` block
  const enumStart = normalised.search(/pub\s+enum\s+DataKey\s*\{/);
  if (enumStart === -1) return null;

  const braceOpen = normalised.indexOf("{", enumStart);
  let depth = 1;
  let idx = braceOpen + 1;
  while (idx < normalised.length && depth > 0) {
    if (normalised[idx] === "{") depth++;
    else if (normalised[idx] === "}") depth--;
    idx++;
  }
  const body = normalised.slice(braceOpen + 1, idx - 1);

  const variants: EnumVariantSchema[] = [];
  // Split on commas that are not inside nested parens/braces
  const variantStrings = splitTopLevel(body, ",");
  for (const raw of variantStrings) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Remove trailing attributes like #[allow(...)]
    const cleaned = trimmed.replace(/#\[[^\]]*\]/g, "").trim();
    if (!cleaned) continue;

    // Variant with inner types: Foo(Type1, Type2)
    const parenMatch = cleaned.match(/^(\w+)\s*\(([^)]*)\)/);
    if (parenMatch) {
      const inner = parenMatch[2]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      variants.push({ name: parenMatch[1], inner });
    } else {
      // Simple variant
      const simpleMatch = cleaned.match(/^(\w+)/);
      if (simpleMatch) {
        variants.push({ name: simpleMatch[1] });
      }
    }
  }

  return { name: "DataKey", variants };
}

/** Split string by a separator, ignoring occurrences inside matched parens/braces */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "<" || c === "{") depth++;
    else if (c === ")" || c === ">" || c === "}") depth--;
    else if (c === sep && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

// ─── symbol_short key parsing ─────────────────────────────────────────────────

function extractSymbolKeys(src: string): string[] {
  const keys: string[] = [];
  // env.storage().instance().set(&symbol_short!("foo"), ...)
  // env.storage().persistent().get(&symbol_short!("foo"))
  const re = /\.(?:instance|persistent|temporary)\(\)\s*\.\s*(?:set|get|has|remove)\s*\(\s*&?\s*symbol_short!\s*\(\s*"([^"]+)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

// ─── Storage class inference ─────────────────────────────────────────────────

/**
 * For DataKey enum variants, infer storage class from call sites:
 *   env.storage().instance().set(&DataKey::Foo, ...)  -> Instance
 *   env.storage().persistent().set(&DataKey::Bar, ...) -> Persistent
 */
function inferStorageClass(
  src: string,
  variantName: string
): StorageClass {
  // Look for env.storage().<class>() calls that reference this variant
  const escaped = variantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns: Array<[RegExp, StorageClass]> = [
    [new RegExp(`\\.instance\\(\\)[^;]*${escaped}`), "Instance"],
    [new RegExp(`\\.persistent\\(\\)[^;]*${escaped}`), "Persistent"],
    [new RegExp(`\\.temporary\\(\\)[^;]*${escaped}`), "Temporary"],
  ];
  for (const [re, cls] of patterns) {
    if (re.test(src)) return cls;
  }
  // Reverse direction: DataKey::Variant mentioned before .instance() / .persistent()
  const revPatterns: Array<[RegExp, StorageClass]> = [
    [new RegExp(`${escaped}[^;]*\\.instance\\(\\)`), "Instance"],
    [new RegExp(`${escaped}[^;]*\\.persistent\\(\\)`), "Persistent"],
    [new RegExp(`${escaped}[^;]*\\.temporary\\(\\)`), "Temporary"],
  ];
  for (const [re, cls] of revPatterns) {
    if (re.test(src)) return cls;
  }
  return "Instance"; // safe default: instance is the most restrictive
}

function inferSymbolStorageClass(src: string, key: string): StorageClass {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns: Array<[RegExp, StorageClass]> = [
    [new RegExp(`\\.instance\\(\\)[^;]*${escaped}`), "Instance"],
    [new RegExp(`\\.persistent\\(\\)[^;]*${escaped}`), "Persistent"],
    [new RegExp(`\\.temporary\\(\\)[^;]*${escaped}`), "Temporary"],
  ];
  for (const [re, cls] of patterns) {
    if (re.test(src)) return cls;
  }
  return "Instance";
}

// ─── Value type inference ─────────────────────────────────────────────────────

/**
 * Heuristically infer the value type for a key by looking for
 * `.set(&DataKey::Variant, &value: TypeFoo)` or
 * `.get::<TypeFoo>(&DataKey::Variant)` patterns.
 */
function inferValueType(src: string, variantName: string): string {
  const escaped = variantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // .get::<Type>(&DataKey::Variant)
  const getTyped = new RegExp(`\\.get::<([\\w<>, :]+)>\\s*\\(\\s*&?\\s*DataKey::${escaped}`);
  let m = getTyped.exec(src);
  if (m) return m[1].trim();

  // .set(&DataKey::Variant, &literal_value)  — bool/numeric literal
  const setBoolLiteral = new RegExp(
    `\\.set\\s*\\(\\s*&\\s*DataKey::${escaped}\\s*,\\s*&\\s*(true|false)\\b`
  );
  if (setBoolLiteral.test(src)) return "bool";

  const setNumLiteral = new RegExp(
    `\\.set\\s*\\(\\s*&\\s*DataKey::${escaped}\\s*,\\s*&\\s*(\\d+[_\\d]*(u32|u64|i128|u128)?\\s*[,)])`
  );
  if (setNumLiteral.test(src)) {
    const nm = setNumLiteral.exec(src);
    if (nm) {
      const suffix = nm[2];
      if (suffix) return suffix;
      return "u32"; // default numeric
    }
  }

  // .set(&DataKey::Variant, &some_var)  — look at the second arg
  const setPattern = new RegExp(
    `\\.set\\s*\\(\\s*&?\\s*DataKey::${escaped}[^,]*,\\s*&?(\\w+)\\s*[,)]`
  );
  m = setPattern.exec(src);
  if (m) {
    const varName = m[1];
    // Skip boolean literals already handled above
    if (varName === "true" || varName === "false") return "bool";
    // Try to find the type of that variable from a let binding
    const letBind = new RegExp(
      `let\\s+(?:mut\\s+)?${varName}\\s*:\\s*([\\w<>, :]+)\\s*=`
    );
    const lb = letBind.exec(src);
    if (lb) return lb[1].trim();
    // If it looks like a struct name itself (CamelCase) return it directly
    if (/^[A-Z]/.test(varName)) return varName;
    // Function parameter — look for it in fn signature
    const paramBind = new RegExp(`\\b${varName}\\s*:\\s*([\\w<>]+)`);
    const pb = paramBind.exec(src);
    if (pb) return pb[1].trim();
  }

  // Fallback: look for struct definitions whose name matches key name
  // e.g. DataKey::Config -> Config struct
  const structRe = new RegExp(`pub\\s+struct\\s+${variantName}\\b`);
  if (structRe.test(src)) return variantName;

  return "unknown";
}

// ─── Struct extraction ────────────────────────────────────────────────────────

function extractStructBody(normalised: string, startIdx: number): string {
  const braceOpen = normalised.indexOf("{", startIdx);
  if (braceOpen === -1) return "";
  let depth = 1;
  let idx = braceOpen + 1;
  while (idx < normalised.length && depth > 0) {
    if (normalised[idx] === "{") depth++;
    else if (normalised[idx] === "}") depth--;
    idx++;
  }
  return normalised.slice(braceOpen + 1, idx - 1);
}

/**
 * Parse struct fields from a normalised body string.
 * Each field is `pub name: Type,` — we split by commas that are NOT inside
 * angle-bracket generics and then parse each token.
 */
function parseStructFields(body: string): FieldSchema[] {
  const fields: FieldSchema[] = [];
  // Split by comma not inside <> (for Vec<T>, BytesN<N> etc.)
  const parts = splitTopLevel(body, ",");
  for (const part of parts) {
    const trimmed = part.trim();
    // `pub field_name : TypeExpr`
    const m = trimmed.match(/pub\s+(\w+)\s*:\s*(.+)$/);
    if (m) {
      const fieldName = m[1];
      // Clean up the type: stop at `pub` (next field bled through), semicolons
      let fieldType = m[2].trim();
      // Remove trailing braces/attributes that might bleed through
      const pubIdx = fieldType.search(/\bpub\b/);
      if (pubIdx !== -1) fieldType = fieldType.slice(0, pubIdx).trim();
      fieldType = fieldType.replace(/[;{}].*$/, "").trim();
      if (fieldName && fieldType) {
        fields.push({ name: fieldName, type: fieldType });
      }
    }
  }
  return fields;
}

function extractStructs(normalised: string): StructSchema[] {
  const structs: StructSchema[] = [];
  const re = /pub\s+struct\s+(\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalised)) !== null) {
    const name = m[1];
    const body = extractStructBody(normalised, m.index);
    const fields = parseStructFields(body);
    structs.push({ name, fields });
  }
  return structs;
}

// ─── Enum extraction ─────────────────────────────────────────────────────────

function extractEnums(normalised: string): EnumSchema[] {
  const enums: EnumSchema[] = [];
  // Match `pub enum Name { ... }` for all #[contracttype] enums
  const re = /pub\s+enum\s+(\w+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalised)) !== null) {
    const name = m[1];
    if (name === "DataKey") continue; // handled separately
    const body = m[2];
    const variants: EnumVariantSchema[] = [];
    const variantStrings = splitTopLevel(body, ",");
    for (const raw of variantStrings) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const parenMatch = trimmed.match(/^(\w+)\s*\(([^)]*)\)/);
      if (parenMatch) {
        const inner = parenMatch[2]
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        variants.push({ name: parenMatch[1], inner });
      } else {
        const simpleMatch = trimmed.match(/^(\w+)/);
        if (simpleMatch) variants.push({ name: simpleMatch[1] });
      }
    }
    enums.push({ name, variants });
  }
  return enums;
}

// ─── TTL resolution for a key variant ────────────────────────────────────────

function resolveTtl(
  src: string,
  variantName: string,
  ttlConstants: Map<string, number>
): { ttl_ledgers?: number; ttl_constant?: string } {
  // Look for bump_expiration / extend_ttl calls associated with this variant
  const escaped = variantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ttlCallRe = new RegExp(
    `(?:bump_expiration|extend_ttl)[^;]*${escaped}[^;]*?(\\w+TTL\\w*LEDGERS\\w*)`,
    "i"
  );
  const m = ttlCallRe.exec(src);
  if (m) {
    const constName = m[1];
    return {
      ttl_constant: constName,
      ttl_ledgers: ttlConstants.get(constName),
    };
  }
  // Try the other direction: constant name before variant
  const ttlCallRe2 = new RegExp(
    `(\\w+TTL\\w*LEDGERS\\w*)[^;]*(?:bump_expiration|extend_ttl)[^;]*${escaped}`,
    "i"
  );
  const m2 = ttlCallRe2.exec(src);
  if (m2) {
    const constName = m2[1];
    return {
      ttl_constant: constName,
      ttl_ledgers: ttlConstants.get(constName),
    };
  }
  return {};
}

// ─── Core extraction ─────────────────────────────────────────────────────────

export function extractSchema(
  contractName: string,
  srcPath: string
): ContractStorageSchema {
  const raw = readFile(srcPath);
  const normalised = normaliseRust(raw);
  const warnings: string[] = [];

  const ttlConstants = extractTtlConstants(raw);
  const dataKeyEnum = extractDataKeyEnum(normalised);
  const symbolKeys = extractSymbolKeys(raw);
  const structs = extractStructs(normalised);
  const enums = extractEnums(normalised);

  const storageKeys: StorageKeySchema[] = [];

  // DataKey-based storage
  if (dataKeyEnum) {
    for (const variant of dataKeyEnum.variants) {
      const storageClass = inferStorageClass(raw, variant.name);
      const valueType = inferValueType(raw, variant.name);
      const ttl = resolveTtl(raw, variant.name, ttlConstants);

      if (valueType === "unknown") {
        warnings.push(
          `Could not infer value type for DataKey::${variant.name} in ${contractName}`
        );
      }

      storageKeys.push({
        key: variant.name,
        key_kind: "DataKey",
        key_params: variant.inner ?? [],
        value_type: valueType,
        storage_class: storageClass,
        ...ttl,
      });
    }
  } else if (symbolKeys.length === 0) {
    warnings.push(`No DataKey enum found in ${contractName}`);
  }

  // symbol_short-based storage
  for (const sym of symbolKeys) {
    const storageClass = inferSymbolStorageClass(raw, sym);
    storageKeys.push({
      key: sym,
      key_kind: "symbol_short",
      key_params: [],
      value_type: "i128", // multi_hop_swap's last_out is always i128
      storage_class: storageClass,
    });
  }

  return {
    contract: contractName,
    schema_version: "1",
    extracted_at: new Date().toISOString(),
    source_hash: simpleHash(raw),
    data_keys: storageKeys,
    structs: structs.filter(
      (s) =>
        !s.name.startsWith("Evt") &&
        !s.name.startsWith("__") &&
        s.fields.length > 0
    ),
    enums: enums.filter(
      (e) =>
        !e.name.startsWith("Evt") &&
        !e.name.startsWith("__") &&
        e.variants.length > 0
    ),
    warnings,
  };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let contractsDir = path.resolve(__dirname, "../contracts");
  let outDir = path.resolve(__dirname, "../contracts/schemas");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--contracts-dir" && args[i + 1]) {
      contractsDir = path.resolve(args[++i]);
    } else if (args[i] === "--out-dir" && args[i + 1]) {
      outDir = path.resolve(args[++i]);
    }
  }

  // Read workspace members from Cargo.toml
  const cargoToml = readFile(path.join(contractsDir, "Cargo.toml"));
  const members: string[] = [];
  const memberRe = /"([^"]+)"/g;
  let inMembers = false;
  for (const line of cargoToml.split("\n")) {
    if (line.trim() === "members = [") { inMembers = true; continue; }
    if (inMembers && line.trim() === "]") { inMembers = false; continue; }
    if (inMembers) {
      const m = memberRe.exec(line);
      if (m) members.push(m[1]);
      memberRe.lastIndex = 0;
    }
  }

  if (members.length === 0) {
    console.error("No workspace members found in", path.join(contractsDir, "Cargo.toml"));
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  let totalWarnings = 0;
  for (const member of members) {
    const srcPath = path.join(contractsDir, member, "src", "lib.rs");
    if (!fs.existsSync(srcPath)) {
      console.warn(`  [skip] ${member}: src/lib.rs not found`);
      continue;
    }

    const schema = extractSchema(member, srcPath);
    const outPath = path.join(outDir, `${member}.schema.json`);
    fs.writeFileSync(outPath, JSON.stringify(schema, null, 2) + "\n");

    const keyCount = schema.data_keys.length;
    const warnCount = schema.warnings.length;
    totalWarnings += warnCount;
    const warnSuffix = warnCount > 0 ? ` (${warnCount} warnings)` : "";
    console.log(`  [ok]   ${member}: ${keyCount} storage key(s)${warnSuffix}`);
    for (const w of schema.warnings) {
      console.warn(`         ⚠  ${w}`);
    }
  }

  console.log(`\nSchemas written to ${outDir}`);
  if (totalWarnings > 0) {
    console.warn(`${totalWarnings} total warning(s) — review before committing`);
  }
}

if (require.main === module) {
  main();
}
