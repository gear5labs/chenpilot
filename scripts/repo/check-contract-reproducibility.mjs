#!/usr/bin/env node
// Verifies that contract artifacts are byte-reproducible after stripping
// known non-deterministic metadata (issue #998).
//
// Usage:
//   node scripts/repo/check-contract-reproducibility.mjs
//   node scripts/repo/check-contract-reproducibility.mjs --dir-a <dir> --dir-b <dir>
//
// Default mode builds the Soroban workspace twice from the same source into
// two separate target directories and compares the normalized wasm outputs.
// Comparison mode takes two already-built artifact directories.
//
// Non-deterministic metadata excluded from the comparison (see
// docs/CONTRACT_REPRODUCIBILITY.md):
//   - custom section "producers" (rustc / wasm-bindgen version + path banners)
//   - custom section "name" (symbol names, includes local build paths)
//   - custom section "comment" (toolchain banners)
//   - custom sections whose name starts with ".debug_" (DWARF; also stripped
//     by the workspace release profile)

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

/** Custom-section names that must be excluded from the comparison. */
export const NON_DETERMINISTIC_SECTIONS = [
  "producers",
  "name",
  "comment",
  ".debug_info",
  ".debug_line",
  ".debug_str",
  ".debug_ranges",
  ".debug_abbrev",
  ".debug_aranges",
  ".debug_pubnames",
  ".debug_pubtypes",
  ".debug_macinfo",
  ".debug_macro",
];

export function isNonDeterministicSection(name) {
  return (
    NON_DETERMINISTIC_SECTIONS.includes(name) || name.startsWith(".debug_")
  );
}

function readLeb128(buf, offset) {
  let result = 0;
  let shift = 0;
  let size = 0;
  for (;;) {
    if (offset + size >= buf.length) throw new Error("truncated LEB128");
    const byte = buf[offset + size];
    size++;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new Error("LEB128 too long");
  }
  return { value: result, size };
}

function readSectionName(payload) {
  const { value: len, size } = readLeb128(payload, 0);
  const nameBytes = payload.subarray(size, size + len);
  return { name: nameBytes.toString("utf8"), headerSize: size + len };
}

/**
 * Return the wasm module bytes with non-deterministic custom sections removed.
 * Section order and every non-custom (code, data, type, ...) section are kept
 * verbatim so a content change is always detected.
 */
export function normalizeWasm(buf) {
  if (buf.length < 8) throw new Error("not a wasm module (too short)");
  if (!buf.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) {
    throw new Error("not a wasm module (bad magic)");
  }
  const out = [Buffer.from(buf.subarray(0, 8))];
  let offset = 8;
  while (offset < buf.length) {
    const sectionId = buf[offset];
    offset++;
    const { value: size, size: lebSize } = readLeb128(buf, offset);
    offset += lebSize;
    const payload = buf.subarray(offset, offset + size);
    offset += size;
    if (sectionId === 0) {
      const { name } = readSectionName(payload);
      if (isNonDeterministicSection(name)) continue;
    }
    // Re-encode section id + size + payload.
    out.push(Buffer.from([sectionId]));
    out.push(encodeLeb128(size));
    out.push(Buffer.from(payload));
  }
  return Buffer.concat(out);
}

function encodeLeb128(value) {
  const bytes = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

export function hashNormalized(buf) {
  return crypto.createHash("sha256").update(normalizeWasm(buf)).digest("hex");
}

/** Compare two artifact directories of .wasm files after normalization. */
export function compareArtifactDirs(dirA, dirB) {
  const problems = [];
  const listWasm = (dir) => {
    const found = new Map();
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.name.endsWith(".wasm")) {
          found.set(path.relative(dir, abs), abs);
        }
      }
    };
    walk(dir);
    return found;
  };
  const a = listWasm(dirA);
  const b = listWasm(dirB);
  for (const rel of [...a.keys(), ...b.keys()]) {
    if (!a.has(rel)) {
      problems.push(`"${rel}" is present only in ${dirB}`);
      continue;
    }
    if (!b.has(rel)) {
      problems.push(`"${rel}" is present only in ${dirA}`);
      continue;
    }
    const hashA = hashNormalized(fs.readFileSync(a.get(rel)));
    const hashB = hashNormalized(fs.readFileSync(b.get(rel)));
    if (hashA !== hashB) {
      problems.push(
        `"${rel}" differs after normalization (build A ${hashA.slice(0, 12)} vs build B ${hashB.slice(0, 12)})`
      );
    }
  }
  return problems;
}

function buildWorkspace(targetDir) {
  execFileSync(
    "cargo",
    [
      "build",
      "--manifest-path",
      "contracts/Cargo.toml",
      "--workspace",
      "--release",
      "--target",
      "wasm32-unknown-unknown",
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: targetDir,
        CARGO_INCREMENTAL: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
}

function collectWasm(targetDir, destDir) {
  const src = path.join(targetDir, "wasm32-unknown-unknown/release");
  fs.mkdirSync(destDir, { recursive: true });
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(src)) {
    if (name.endsWith(".wasm")) {
      fs.copyFileSync(path.join(src, name), path.join(destDir, name));
      n++;
    }
  }
  return n;
}

function main() {
  const args = process.argv.slice(2);
  const getFlag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dirA = getFlag("--dir-a");
  const dirB = getFlag("--dir-b");

  let problems;
  if (dirA && dirB) {
    problems = compareArtifactDirs(dirA, dirB);
  } else {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "contract-repro-"));
    try {
      const targetA = path.join(work, "target-a");
      const targetB = path.join(work, "target-b");
      const outA = path.join(work, "artifacts-a");
      const outB = path.join(work, "artifacts-b");
      console.error("Building contract workspace (build A)...");
      buildWorkspace(targetA);
      console.error("Building contract workspace (build B)...");
      buildWorkspace(targetB);
      const nA = collectWasm(targetA, outA);
      const nB = collectWasm(targetB, outB);
      if (nA === 0 && nB === 0) {
        problems = ["no .wasm artifacts were produced by either build"];
      } else {
        problems = compareArtifactDirs(outA, outB);
      }
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(
      `\n${problems.length} contract reproducibility problem(s). Non-deterministic metadata excluded from comparison is documented in docs/CONTRACT_REPRODUCIBILITY.md.`
    );
    process.exit(1);
  }
  console.log("Contract artifacts: reproducible after normalization.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
