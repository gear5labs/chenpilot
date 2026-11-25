import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "./helpers.mjs";

function validateTrustGuide(content) {
  const errors = [];
  if (!content || content.trim().length === 0) {
    errors.push("Guide content is empty");
    return errors;
  }

  const requiredTopics = [
    "Score Range",
    "Confidence",
    "Freshness",
    "Unknown Signals",
    "Non-Guarantee Notice",
  ];

  for (const topic of requiredTopics) {
    if (!content.toLowerCase().includes(topic.toLowerCase())) {
      errors.push(`Missing topic: "${topic}"`);
    }
  }

  // Ensure examples do not claim guaranteed safety
  const unsafeClaims = ["100% safe", "guaranteed safe", "zero risk", "proof of asset safety"];
  for (const claim of unsafeClaims) {
    // If mentioned, it should be in anti-patterns or disclaimers, not positive claims
    const lower = content.toLowerCase();
    const idx = lower.indexOf(claim);
    if (idx !== -1) {
      const surrounding = lower.slice(Math.max(0, idx - 120), idx + 120);
      if (!surrounding.includes("not") && !surrounding.includes("never") && !surrounding.includes("anti-pattern")) {
        errors.push(`Unsafe claim detected in guide: "${claim}"`);
      }
    }
  }

  return errors;
}

describe("Asset Trust Score Interpretation Guide (#1122)", () => {
  it("guide exists and includes all required interpretation criteria", () => {
    const guidePath = path.join(REPO_ROOT, "docs", "ASSET_TRUST_SCORE_INTERPRETATION_GUIDE.md");
    assert.ok(fs.existsSync(guidePath), "ASSET_TRUST_SCORE_INTERPRETATION_GUIDE.md must exist");

    const content = fs.readFileSync(guidePath, "utf8");
    const errors = validateTrustGuide(content);
    assert.deepEqual(errors, []);
  });

  it("architecture doc references the interpretation guide", () => {
    const archPath = path.join(REPO_ROOT, "packages", "sdk", "ASSET_INTELLIGENCE_ARCHITECTURE.md");
    assert.ok(fs.existsSync(archPath));

    const content = fs.readFileSync(archPath, "utf8");
    assert.ok(content.includes("ASSET_TRUST_SCORE_INTERPRETATION_GUIDE.md"));
  });

  it("validateTrustGuide detects missing topics (boundary failure case)", () => {
    const incomplete = "# Guide\nHere is how to calculate scores.\n";
    const errors = validateTrustGuide(incomplete);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes("Missing topic")));

    const emptyErrors = validateTrustGuide("");
    assert.equal(emptyErrors[0], "Guide content is empty");
  });
});
