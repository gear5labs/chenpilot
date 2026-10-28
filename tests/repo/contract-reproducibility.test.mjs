import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  compareArtifactDirs,
  hashNormalized,
  isNonDeterministicSection,
  normalizeWasm,
  NON_DETERMINISTIC_SECTIONS,
} from "../../scripts/repo/check-contract-reproducibility.mjs";

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

function customSection(name, payload = Buffer.alloc(0)) {
  const nameBytes = Buffer.from(name, "utf8");
  const body = Buffer.concat([
    encodeLeb128(nameBytes.length),
    nameBytes,
    payload,
  ]);
  return Buffer.concat([Buffer.from([0]), encodeLeb128(body.length), body]);
}

function codeSection(bytes) {
  return Buffer.concat([Buffer.from([10]), encodeLeb128(bytes.length), bytes]);
}

function wasm(sections) {
  return Buffer.concat([
    Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    ...sections,
  ]);
}

describe("contract artifact reproducibility", () => {
  it("strips non-deterministic custom sections and keeps code", () => {
    const code = codeSection(Buffer.from([0x01, 0x02, 0x03]));
    const a = wasm([
      customSection("producers", Buffer.from("rustc-1.80")),
      code,
      customSection("name", Buffer.from("build/a/path")),
      customSection("comment", Buffer.from("wasm-opt")),
    ]);
    const b = wasm([
      customSection("producers", Buffer.from("rustc-1.81")),
      code,
      customSection("name", Buffer.from("build/b/path")),
      customSection("comment", Buffer.from("other")),
    ]);
    assert.equal(hashNormalized(a), hashNormalized(b));
    const normalized = normalizeWasm(a);
    assert.ok(!normalized.includes(Buffer.from("rustc-1.80")));
    assert.ok(!normalized.includes(Buffer.from("build/a/path")));
    assert.ok(normalized.includes(Buffer.from([0x01, 0x02, 0x03])));
  });

  it("detects a real code difference (failure case)", () => {
    const a = wasm([codeSection(Buffer.from([0x01, 0x02, 0x03]))]);
    const b = wasm([codeSection(Buffer.from([0x01, 0x02, 0x04]))]);
    assert.notEqual(hashNormalized(a), hashNormalized(b));
  });

  it("keeps deterministic custom sections in the comparison", () => {
    const a = wasm([
      codeSection(Buffer.from([0x01])),
      customSection("target_features", Buffer.from("+bulk-memory")),
    ]);
    const b = wasm([
      codeSection(Buffer.from([0x01])),
      customSection("target_features", Buffer.from("+simd128")),
    ]);
    assert.notEqual(hashNormalized(a), hashNormalized(b));
  });

  it("treats every .debug_* section as non-deterministic", () => {
    assert.ok(isNonDeterministicSection(".debug_line"));
    assert.ok(isNonDeterministicSection(".debug_custom_xyz"));
    assert.ok(!isNonDeterministicSection("target_features"));
    for (const name of NON_DETERMINISTIC_SECTIONS) {
      assert.ok(isNonDeterministicSection(name), name);
    }
  });

  it("compares artifact directories and reports missing or differing files", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "repro-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "repro-b-"));
    try {
      const same = wasm([
        customSection("producers", Buffer.from("x")),
        codeSection(Buffer.from([0x09])),
      ]);
      fs.writeFileSync(path.join(dirA, "same.wasm"), same);
      fs.writeFileSync(
        path.join(dirB, "same.wasm"),
        wasm([
          customSection("producers", Buffer.from("y")),
          codeSection(Buffer.from([0x09])),
        ])
      );
      fs.writeFileSync(
        path.join(dirA, "diff.wasm"),
        wasm([codeSection(Buffer.from([0x01]))])
      );
      fs.writeFileSync(
        path.join(dirB, "diff.wasm"),
        wasm([codeSection(Buffer.from([0x02]))])
      );
      fs.writeFileSync(
        path.join(dirB, "only-b.wasm"),
        wasm([codeSection(Buffer.from([0x03]))])
      );

      const problems = compareArtifactDirs(dirA, dirB);
      const joined = problems.join("\n");
      assert.match(joined, /"diff\.wasm" differs after normalization/);
      assert.match(joined, /"only-b\.wasm" is present only in/);
      assert.ok(!joined.includes('"same.wasm"'));
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
});
