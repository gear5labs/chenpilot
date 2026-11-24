import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "./helpers.mjs";

function validatePackageGuide(content, requiredCommands, requiredSections) {
  const errors = [];
  if (!content || content.trim().length === 0) {
    errors.push("Guide content is empty");
    return errors;
  }
  for (const cmd of requiredCommands) {
    if (!content.includes(cmd)) {
      errors.push(`Missing command reference: "${cmd}"`);
    }
  }
  for (const sec of requiredSections) {
    if (!content.toLowerCase().includes(sec.toLowerCase())) {
      errors.push(`Missing required section: "${sec}"`);
    }
  }
  return errors;
}

describe("Package-level contribution guides (#1124)", () => {
  it("packages/bot/CONTRIBUTING.md contains bot-specific commands and architecture boundaries", () => {
    const botPath = path.join(REPO_ROOT, "packages", "bot", "CONTRIBUTING.md");
    assert.ok(fs.existsSync(botPath), "packages/bot/CONTRIBUTING.md must exist");

    const content = fs.readFileSync(botPath, "utf8");
    const requiredCommands = ["pnpm --filter @chen-pilot/bot build", "pnpm --filter @chen-pilot/bot dev"];
    const requiredSections = ["Architecture & Boundaries", "Development Commands", "Clean-Checkout Validation"];

    const errors = validatePackageGuide(content, requiredCommands, requiredSections);
    assert.deepEqual(errors, []);
  });

  it("packages/sdk/CONTRIBUTING.md contains SDK-specific commands and architecture boundaries", () => {
    const sdkPath = path.join(REPO_ROOT, "packages", "sdk", "CONTRIBUTING.md");
    assert.ok(fs.existsSync(sdkPath), "packages/sdk/CONTRIBUTING.md must exist");

    const content = fs.readFileSync(sdkPath, "utf8");
    const requiredCommands = ["pnpm --filter @chen-pilot/sdk-core build", "test:conformance"];
    const requiredSections = ["Architecture & Boundaries", "Development Commands", "Clean-Checkout Validation"];

    const errors = validatePackageGuide(content, requiredCommands, requiredSections);
    assert.deepEqual(errors, []);
  });

  it("root CONTRIBUTING.md references both package guides", () => {
    const rootPath = path.join(REPO_ROOT, "CONTRIBUTING.md");
    assert.ok(fs.existsSync(rootPath), "Root CONTRIBUTING.md must exist");

    const content = fs.readFileSync(rootPath, "utf8");
    assert.ok(content.includes("packages/bot/CONTRIBUTING.md"));
    assert.ok(content.includes("packages/sdk/CONTRIBUTING.md"));
  });

  it("validatePackageGuide detects missing commands or sections (boundary failure case)", () => {
    const incompleteContent = "# Contributing\nJust run npm start\n";
    const errors = validatePackageGuide(
      incompleteContent,
      ["pnpm --filter @chen-pilot/bot build"],
      ["Architecture & Boundaries"]
    );
    assert.equal(errors.length, 2);
    assert.ok(errors[0].includes("Missing command reference"));
    assert.ok(errors[1].includes("Missing required section"));

    const emptyErrors = validatePackageGuide("", ["build"], ["Section"]);
    assert.equal(emptyErrors[0], "Guide content is empty");
  });
});
