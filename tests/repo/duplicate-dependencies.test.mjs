import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkDuplicateDependencies,
  findDuplicates,
  inventory,
  majorOf,
} from "../../scripts/repo/check-duplicate-dependencies.mjs";
import { readRepoConfig } from "../../scripts/repo/config.mjs";
import { REPO_ROOT, makeFixture, removeFixture } from "../docs/helpers.mjs";

const repoConfig = readRepoConfig(REPO_ROOT).duplicateDependencies ?? {};

function manifest(dependencies, devDependencies = {}) {
  return JSON.stringify({
    name: "x",
    version: "1.0.0",
    dependencies,
    devDependencies,
  });
}

function check(files, config = { workspaces: [".", "packages/sdk", "packages/bot"], allow: [] }) {
  const dir = makeFixture(files);
  try {
    return checkDuplicateDependencies(dir, config);
  } finally {
    removeFixture(dir);
  }
}

describe("duplicate dependency major extraction", () => {
  it("extracts the major from common range forms", () => {
    assert.equal(majorOf("^1.2.3"), 1);
    assert.equal(majorOf("~2.0.0"), 2);
    assert.equal(majorOf("1.x"), 1);
    assert.equal(majorOf(">=3 <4"), 3);
    assert.equal(majorOf("4.5.6"), 4);
  });

  it("returns null for loose or workspace ranges", () => {
    assert.equal(majorOf("workspace:*"), null);
    assert.equal(majorOf(""), null);
    assert.equal(majorOf("*"), null);
  });
});

describe("duplicate dependency detection", () => {
  it("passes on the repository", () => {
    const failures = checkDuplicateDependencies(REPO_ROOT, repoConfig).filter(
      (f) => f.kind === "major-split"
    );
    assert.deepEqual(failures, []);
  });

  it("reports a duplicate when two workspaces declare different ranges for the same major", () => {
    const findings = check({
      "package.json": manifest({ axios: "^1.6.0" }),
      "packages/sdk/package.json": manifest({ axios: "^1.7.0" }),
      "packages/bot/package.json": manifest({}),
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].name, "axios");
    assert.equal(findings[0].kind, "duplicate");
    assert.equal(findings[0].entries.length, 2);
  });

  it("flags a major-version split as a failure", () => {
    const findings = check({
      "package.json": manifest({ axios: "^1.6.0" }),
      "packages/sdk/package.json": manifest({ axios: "^2.0.0" }),
      "packages/bot/package.json": manifest({}),
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].kind, "major-split");
  });

  it("skips allow-listed packages entirely", () => {
    const findings = check(
      {
        "package.json": manifest({ axios: "^1.6.0" }),
        "packages/sdk/package.json": manifest({ axios: "^1.7.0" }),
        "packages/bot/package.json": manifest({}),
      },
      {
        workspaces: [".", "packages/sdk", "packages/bot"],
        allow: [{ name: "axios" }],
      }
    );
    assert.deepEqual(findings, []);
  });

  it("does not flag major-split when allow-listed", () => {
    const findings = check(
      {
        "package.json": manifest({ axios: "^1.6.0" }),
        "packages/sdk/package.json": manifest({ axios: "^2.0.0" }),
        "packages/bot/package.json": manifest({}),
      },
      {
        workspaces: [".", "packages/sdk", "packages/bot"],
        allow: [{ name: "axios" }],
      }
    );
    assert.deepEqual(findings, []);
  });

  it("ignores packages declared in only one workspace", () => {
    const findings = check({
      "package.json": manifest({ lodash: "^4.17.0" }),
      "packages/sdk/package.json": manifest({}),
      "packages/bot/package.json": manifest({}),
    });
    assert.deepEqual(findings, []);
  });

  it("ignores identical ranges across workspaces", () => {
    const findings = check({
      "package.json": manifest({ axios: "^1.6.0" }),
      "packages/sdk/package.json": manifest({ axios: "^1.6.0" }),
      "packages/bot/package.json": manifest({}),
    });
    assert.deepEqual(findings, []);
  });

  it("includes both dependencies and devDependencies in the inventory", () => {
    const findings = check({
      "package.json": manifest({ axios: "^1.6.0" }),
      "packages/sdk/package.json": manifest({}, { axios: "^1.7.0" }),
      "packages/bot/package.json": manifest({}),
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].kind, "duplicate");
  });

  it("returns findings sorted by package name", () => {
    const findings = check({
      "package.json": manifest({ zebra: "^1.0.0", alpha: "^1.0.0" }),
      "packages/sdk/package.json": manifest({ zebra: "^1.1.0", alpha: "^1.1.0" }),
      "packages/bot/package.json": manifest({}),
    });
    assert.deepEqual(
      findings.map((f) => f.name),
      ["alpha", "zebra"]
    );
  });
});
