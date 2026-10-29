import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  globToRegExp,
  validatePackedFiles,
} from "../../scripts/repo/check-package-contents.mjs";
import { readRepoConfig } from "../../scripts/repo/config.mjs";
import { REPO_ROOT } from "../docs/helpers.mjs";

const config = readRepoConfig(REPO_ROOT).packageContents;

describe("package contents allowlist", () => {
  it("accepts a tarball that matches the allowlist", () => {
    const policy = config.packages["packages/sdk"];
    assert.deepEqual(
      validatePackedFiles(
        [
          "package.json",
          "README.md",
          "dist/index.js",
          "dist/index.d.ts",
          "examples/basic-usage.ts",
        ],
        policy
      ),
      []
    );
  });

  it("rejects private files, fixtures, logs, and unexpected artifacts", () => {
    const policy = config.packages["packages/sdk"];
    const problems = validatePackedFiles(
      [
        "package.json",
        "dist/index.js",
        ".env",
        "src/index.ts",
        "src/__tests__/index.test.ts",
        "__fixtures__/consumption/package.json",
        "coverage/lcov.info",
        "npm-debug.log",
        "secrets-notes.md",
      ],
      policy
    );
    const joined = problems.join("\n");
    assert.match(joined, /"\.env" matches a denied pattern/);
    assert.match(joined, /"src\/index\.ts" matches a denied pattern/);
    assert.match(joined, /"src\/__tests__\/index\.test\.ts" matches a denied pattern/);
    assert.match(joined, /"__fixtures__\/consumption\/package\.json" matches a denied pattern/);
    assert.match(joined, /"coverage\/lcov\.info" matches a denied pattern/);
    assert.match(joined, /"npm-debug\.log" matches a denied pattern/);
    assert.match(joined, /"secrets-notes\.md" is not covered by the package allowlist/);
  });

  it("the root allowlist excludes repository snapshots and development files", () => {
    const policy = config.packages["."];
    const problems = validatePackedFiles(
      [
        "package.json",
        "README.md",
        ".github/workflows/release-gates.yml",
        ".kiro/specs/prompt-agent-version-control/requirements.md",
        "tests/fixtures/redteam/corpus.json",
        "docs/REDTEAM_EVALUATION.md",
      ],
      policy
    );
    const joined = problems.join("\n");
    assert.match(joined, /"\.github\/workflows\/release-gates\.yml" matches a denied pattern/);
    assert.match(joined, /"\.kiro\/specs\/prompt-agent-version-control\/requirements\.md" matches a denied pattern/);
    assert.match(joined, /"tests\/fixtures\/redteam\/corpus\.json" matches a denied pattern/);
    assert.match(joined, /"docs\/REDTEAM_EVALUATION\.md" is not covered by the package allowlist/);
  });

  it("maps glob stars to path-segment-aware patterns", () => {
    assert.ok(globToRegExp("dist/**").test("dist/index.js"));
    assert.ok(globToRegExp("dist/**").test("dist/nested/a.d.ts"));
    assert.ok(!globToRegExp("dist/**").test("distx/index.js"));
    assert.ok(globToRegExp("**/*.log").test("a/b/c.log"));
    assert.ok(!globToRegExp("**/*.log").test("a/b/c.log.txt"));
  });
});
