#!/usr/bin/env node

/**
 * Simple test script to verify Local Chain simulation works
 * Run with: npx ts-node src/simulation/test-local-chain.ts
 */

import { LocalChainManager } from "./LocalChainManager";
import { invokeContract } from "../services/sorobanService";

async function testLocalChain() {
  console.log("🚀 Testing Local Chain Simulation...\n");

  try {
    // Initialize Local Chain
    const manager = new LocalChainManager();
    await manager.initialize();

    if (!manager.isEnabled) {
      console.log(
        "❌ Local Chain is not enabled. Set LOCAL_CHAIN_ENABLED=true in your .env file"
      );
      return;
    }

    console.log("✅ Local Chain Manager initialized");
    console.log("📊 Metrics:", JSON.stringify(manager.getMetrics(), null, 2));

    // Test Soroban contract invocation
    console.log("\n🔗 Testing Soroban contract invocation...");

    const contractResult = await invokeContract({
      network: "testnet",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      method: "balance",
      args: ["GCKFBEIYTKP5RDBKPVNVNHQTQTHXVXNQZQJGXJFX7KSAH3QKYBZXMUQY"],
    });

    console.log(
      "✅ Contract invocation result:",
      JSON.stringify(contractResult, null, 2)
    );

    // Test simulation engine directly
    console.log("\n⚙️ Testing simulation engine directly...");

    const simulationEngine = manager.getSimulationEngine();
    const simulationResult = await simulationEngine.processRequest({
      service: "wallet",
      operation: "get_balance",
      parameters: { token: "STRK" },
      userId: "test-user",
      timestamp: Date.now(),
    });

    console.log(
      "✅ Simulation result:",
      JSON.stringify(simulationResult, null, 2)
    );

    // Test gas metrics
    console.log("\n⛽ Testing gas simulation...");

    const gasSimulator = simulationEngine.getGasSimulator();
    if (gasSimulator) {
      const gasMetrics = await gasSimulator.getUserGasMetrics("test-user");
      console.log("✅ Gas metrics:", JSON.stringify(gasMetrics, null, 2));
    }

    console.log(
      "\n🎉 All tests passed! Local Chain simulation is working correctly."
    );
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  // Set environment variables for testing
  process.env.LOCAL_CHAIN_ENABLED = "true";
  process.env.LOCAL_CHAIN_MODE = "local";
  process.env.LOCAL_CHAIN_SERVICES = "soroban,wallet,swap";

  testLocalChain().catch(console.error);
}

export { testLocalChain };
