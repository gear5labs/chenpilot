#!/usr/bin/env node

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = import.meta.dirname;
const projectRoot = join(__dirname, "../../");
const docsPath = join(projectRoot, "docs/TOOLS.md");

try {
  // Read current state before regeneration
  const originalContent = readFileSync(docsPath, "utf-8");

  // Regenerate documentation
  execSync("pnpm run gen:docs", { cwd: projectRoot, stdio: "pipe" });

  // Read regenerated state
  const regeneratedContent = readFileSync(docsPath, "utf-8");

  // Compare
  if (originalContent !== regeneratedContent) {
    console.error("✗ Generated documentation is out of date");
    console.error("");
    console.error("Changed paths:");
    console.error("  docs/TOOLS.md");
    console.error("");
    console.error("To update documentation, run:");
    console.error("  pnpm run gen:docs");
    console.error("  git add docs/TOOLS.md");
    console.error("  git commit -m 'docs: update generated tool documentation'");
    process.exit(1);
  }

  console.log("✓ Tool documentation is up-to-date");
} catch (error) {
  console.error("✗ Error checking generated documentation:", error.message);
  process.exit(1);
}
