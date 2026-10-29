/**
 * Runs the safe, mock-based quick-start examples in CI.
 *
 * #1051: every example marked here must be safe-by-default (no real network
 * access, no real private keys, no transaction submission). Examples that could
 * submit real transactions must be clearly marked and guarded so they cannot
 * execute unless explicitly opted in via `CHEN_PILOT_ALLOW_REAL_TX=true`.
 *
 * To run a potentially unsafe example locally you must set both
 * `CHEN_PILOT_ALLOW_REAL_TX=true` and `CHEN_PILOT_I_UNDERSTAND_REAL_TX=true`.
 */

const {
  basicUsageExample,
  multiSignatureExample,
} = require("../examples/basic-usage.ts");

async function main() {
  // Force network access off by default for example runs.
  if (process.env.CI && process.env.NODE_ENV === undefined) {
    process.env.NODE_ENV = "test";
  }
  process.env.CAPACITY_CONTRACT_MODE =
    process.env.CAPACITY_CONTRACT_MODE || "mock";

  await basicUsageExample();
  await multiSignatureExample();
}

main().catch((error) => {
  console.error("Selected SDK quick-start examples failed:", error);
  process.exitCode = 1;
});