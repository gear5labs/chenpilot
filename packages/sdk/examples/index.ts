/**
 * @fileoverview Examples Index
 *
 * This file exports all example modules and provides a convenient way
 * to run all examples or specific example categories.
 *
 * #1051 — Safety notes:
 * - Examples that only use mock providers (`ProviderType.MOCK`) are safe by
 *   default and run in CI with network access disabled/mocked.
 * - Examples that would connect to real wallets or submit real transactions are
 *   explicitly marked as **PLACEHOLDER / UNSAFE-BY-DEFAULT** below. They MUST
 *   NOT submit real transactions unless BOTH environment variables are set:
 *   `CHEN_PILOT_ALLOW_REAL_TX=true` and
 *   `CHEN_PILOT_I_UNDERSTAND_REAL_TX=true`.
 */

// Basic usage examples
export * from "./basic-usage";

// Advanced examples (PLACEHOLDER/INSTRUCTIONAL ONLY — see safety notes above)
// These examples demonstrate patterns and may use mock providers by default.
// If they are extended to submit real transactions, they must gate execution
// behind the real-tx opt-in flags.
export * from "./multi-signature-treasury";
export * from "./cross-chain-bridge";
export * from "./hardware-wallet-integration";

// Re-export main example runner
export { runAllExamples } from "./basic-usage";

/**
 * Run all advanced examples
 */
export async function runAdvancedExamples(): Promise<void> {
  console.log("🚀 Running Advanced Examples...\n");

  try {
    // Import and run advanced examples
    const { treasuryExample } = await import("./multi-signature-treasury");
    const { crossChainBridgeExample } = await import("./cross-chain-bridge");
    const { hardwareWalletExample } =
      await import("./hardware-wallet-integration");

    await treasuryExample();
    console.log("\n" + "=".repeat(60) + "\n");

    await crossChainBridgeExample();
    console.log("\n" + "=".repeat(60) + "\n");

    await hardwareWalletExample();

    console.log("\n🎉 All advanced examples completed successfully!");
  } catch (error) {
    console.error("❌ Advanced examples failed:", error);
    throw error;
  }
}

/**
 * Run specific example by name
 */
export async function runExample(exampleName: string): Promise<void> {
  console.log(`🎯 Running example: ${exampleName}\n`);

  switch (exampleName.toLowerCase()) {
    case "basic":
    case "basic-usage": {
      const { runAllExamples } = await import("./basic-usage");
      await runAllExamples();
      break;
    }

    case "treasury":
    case "multi-signature-treasury": {
      const { treasuryExample } = await import("./multi-signature-treasury");
      await treasuryExample();
      break;
    }

    case "bridge":
    case "cross-chain-bridge": {
      const { crossChainBridgeExample } = await import("./cross-chain-bridge");
      await crossChainBridgeExample();
      break;
    }

    case "hardware":
    case "hardware-wallet":
    case "hardware-wallet-integration": {
      const { hardwareWalletExample } =
        await import("./hardware-wallet-integration");
      await hardwareWalletExample();
      break;
    }

    case "all":
      await runAllExamples();
      console.log("\n" + "=".repeat(60) + "\n");
      await runAdvancedExamples();
      break;

    default:
      throw new Error(`Unknown example: ${exampleName}`);
  }
}

/**
 * List all available examples
 */
export function listExamples(): void {
  console.log("📚 Available Examples:\n");

  console.log("Basic Examples:");
  console.log(
    "  • basic-usage           - SDK initialization and basic operations"
  );
  console.log("  • multi-signature       - Multi-signature workflow example");
  console.log("  • provider-discovery    - Provider discovery and selection");
  console.log("  • signature-verification - Cross-chain signature validation");
  console.log("  • error-handling        - Error recovery and handling");
  console.log("  • sdk-builder           - SDK builder pattern usage");
  console.log("  • registry-management   - Provider registry operations");

  console.log("\nAdvanced Examples:");
  console.log(
    "  • treasury              - Multi-signature treasury management"
  );
  console.log("  • bridge                - Cross-chain bridge implementation");
  console.log("  • hardware-wallet       - Hardware wallet integration");

  console.log("\nUsage:");
  console.log("  npm run examples                    # Run all basic examples");
  console.log(
    "  npm run examples:advanced           # Run all advanced examples"
  );
  console.log("  npm run examples -- <example-name>  # Run specific example");
  console.log("  npm run examples -- all             # Run all examples");
}

// CLI interface when run directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("🎯 No example specified. Running all basic examples...\n");
    runAllExamples().catch(console.error);
  } else if (args[0] === "list" || args[0] === "--list") {
    listExamples();
  } else if (args[0] === "advanced") {
    runAdvancedExamples().catch(console.error);
  } else {
    runExample(args[0]).catch(console.error);
  }
}
