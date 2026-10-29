import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import {
  parseDeclarations,
  peerRangeSatisfies,
} from "../../scripts/repo/check-ts-compat.mjs";
import { readRepoConfig } from "../../scripts/repo/config.mjs";
import { REPO_ROOT } from "../docs/helpers.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const config = readRepoConfig(REPO_ROOT).tsCompat;

describe("minimum TypeScript compatibility", () => {
  it("the documented minimum satisfies the SDK peer range", () => {
    const sdk = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "packages/sdk/package.json"),
        "utf8"
      )
    );
    const peer = sdk.peerDependencies?.typescript ?? "";
    assert.ok(
      peerRangeSatisfies(peer, config.minimumTypeScript),
      `peerDependencies.typescript "${peer}" must include ${config.minimumTypeScript}`
    );
  });

  it("peer range boundaries reject versions below the minimum", () => {
    assert.equal(peerRangeSatisfies(">=4.5.2", "4.5.2"), true);
    assert.equal(peerRangeSatisfies(">=4.5.2", "4.5.3"), true);
    assert.equal(peerRangeSatisfies(">=4.5.2", "5.7.3"), true);
    assert.equal(peerRangeSatisfies(">=4.5.2", "4.5.1"), false);
    assert.equal(peerRangeSatisfies(">=4.5.2", "4.4.9"), false);
    assert.equal(peerRangeSatisfies(">=4.5.0", "4.5.2"), true);
    assert.equal(peerRangeSatisfies(">=4.5.0", "4.4.0"), false);
  });

  it("parses valid declaration files without diagnostics", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-compat-parse-"));
    try {
      fs.writeFileSync(
        path.join(dir, "ok.d.ts"),
        "export declare function f(x: number): string;\n"
      );
      assert.deepEqual(parseDeclarations(ts, dir), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports declarations that do not parse (failure case)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-compat-parse-"));
    try {
      fs.writeFileSync(path.join(dir, "broken.d.ts"), "export declare const x: = 1;\n");
      const problems = parseDeclarations(ts, dir);
      assert.ok(problems.length > 0, "expected a parse diagnostic");
      assert.match(problems[0], /broken\.d\.ts:\d+:\d+/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
