#!/usr/bin/env ts-node
import fs from "fs";
import path from "path";
import secretManager from "../src/utils/secretManager";

// Simple migration utility: reads a JSON plaintext file and writes into encrypted store.
async function main() {
  const source = path.resolve(process.cwd(), "data/plain_secrets.json");
  if (!fs.existsSync(source)) {
    console.log(
      "No plaintext secrets found at data/plain_secrets.json — nothing to migrate."
    );
    return;
  }

  const raw = fs.readFileSync(source, "utf8");
  let parsed: Record<string, string> = {};
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse plaintext secrets file", err);
    process.exit(1);
  }

  for (const [k, v] of Object.entries(parsed)) {
    secretManager.setSecret(k, v);
    console.log(`Migrated secret ${k}`);
  }

  console.log(
    "Migration complete. Remove data/plain_secrets.json after verification."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
