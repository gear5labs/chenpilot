/**
 * Example usage of the Network Status API
 *
 * This demonstrates how to check Stellar network health, latency, and protocol version.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  checkNetworkHealth,
  checkLedgerLatency,
  getProtocolVersion,
  getNetworkStatus,
} from "@chen-pilot/sdk-core";

// ─── Example 1: Check network health ────────────────────────────────────────

async function exampleCheckHealth() {
  console.log("=== Checking Network Health ===\n");

  const health = await checkNetworkHealth({ network: "testnet" });

  if (health.isHealthy) {
    console.log("✓ Network is healthy");
    console.log(`  Latest ledger: ${health.latestLedger}`);
    console.log(`  Response time: ${health.responseTimeMs}ms`);
  } else {
    console.log("✗ Network is unhealthy");
    console.log(`  Error: ${health.error}`);
  }
}

// ─── Example 2: Check ledger latency ────────────────────────────────────────

async function exampleCheckLatency() {
  console.log("\n=== Checking Ledger Latency ===\n");

  const latency = await checkLedgerLatency({ network: "testnet" });

  console.log(`Current ledger: ${latency.currentLedger}`);
  console.log(
    `Time since last ledger: ${latency.timeSinceLastLedgerSec} seconds`
  );
  console.log(`Average ledger time: ${latency.averageLedgerTimeSec} seconds`);
  console.log(`Latency is ${latency.isNormal ? "normal" : "abnormal"}`);
}

// ─── Example 3: Get protocol version ────────────────────────────────────────

async function exampleGetProtocol() {
  console.log("\n=== Getting Protocol Version ===\n");

  const protocol = await getProtocolVersion({ network: "mainnet" });

  console.log(`Protocol version: ${protocol.version}`);
  console.log(`Core version: ${protocol.coreVersion}`);
  console.log(`Network passphrase: ${protocol.networkPassphrase}`);
}

// ─── Example 4: Get complete network status ─────────────────────────────────

async function exampleGetCompleteStatus() {
  console.log("\n=== Getting Complete Network Status ===\n");

  const status = await getNetworkStatus({ network: "testnet" });

  console.log("Health:");
  console.log(`  Healthy: ${status.health.isHealthy}`);
  console.log(`  Latest ledger: ${status.health.latestLedger}`);
  console.log(`  Response time: ${status.health.responseTimeMs}ms`);

  console.log("\nLatency:");
  console.log(`  Current ledger: ${status.latency.currentLedger}`);
  console.log(
    `  Time since last ledger: ${status.latency.timeSinceLastLedgerSec}s`
  );
  console.log(`  Normal: ${status.latency.isNormal}`);

  console.log("\nProtocol:");
  console.log(`  Version: ${status.protocol.version}`);
  console.log(`  Core: ${status.protocol.coreVersion}`);

  console.log(`\nChecked at: ${new Date(status.checkedAt).toISOString()}`);
}

// ─── Example 5: Using custom RPC/Horizon URLs ───────────────────────────────

async function exampleCustomUrls() {
  console.log("\n=== Using Custom URLs ===\n");

  const status = await getNetworkStatus({
    network: "testnet",
    rpcUrl: "https://custom-rpc.example.com",
    horizonUrl: "https://custom-horizon.example.com",
  });

  console.log(`Network status retrieved from custom endpoints`);
  console.log(`Healthy: ${status.health.isHealthy}`);
}

// ─── Example 6: Error handling ──────────────────────────────────────────────

async function exampleErrorHandling() {
  console.log("\n=== Error Handling ===\n");

  try {
    const health = await checkNetworkHealth({ network: "testnet" });

    if (!health.isHealthy) {
      console.log(`Network check failed: ${health.error}`);
      // Handle unhealthy network (retry, alert, etc.)
    }
  } catch (error) {
    console.error("Unexpected error:", error);
  }

  try {
    const latency = await checkLedgerLatency({ network: "testnet" });

    if (!latency.isNormal) {
      console.log("Warning: Network latency is abnormal");
      console.log(
        `Last ledger was ${latency.timeSinceLastLedgerSec} seconds ago`
      );
      // Handle high latency (wait, retry, etc.)
    }
  } catch (error) {
    console.error("Failed to check latency:", error);
  }
}

// ─── Example 7: Monitoring loop ─────────────────────────────────────────────

async function exampleMonitoring() {
  console.log("\n=== Network Monitoring ===\n");

  // Check network status every 30 seconds
  const intervalMs = 30000;

  const monitor = setInterval(async () => {
    try {
      const status = await getNetworkStatus({ network: "mainnet" });

      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] Network Status:`);
      console.log(`  Healthy: ${status.health.isHealthy}`);
      console.log(`  Ledger: ${status.health.latestLedger}`);
      console.log(`  Latency normal: ${status.latency.isNormal}`);

      // Alert if unhealthy
      if (!status.health.isHealthy || !status.latency.isNormal) {
        console.warn("⚠️  Network issue detected!");
      }
    } catch (error) {
      console.error("Monitoring error:", error);
    }
  }, intervalMs);

  // Stop monitoring after 5 minutes
  setTimeout(() => {
    clearInterval(monitor);
    console.log("\nMonitoring stopped");
  }, 300000);
}

// ─── Run examples ───────────────────────────────────────────────────────────

async function main() {
  try {
    await exampleCheckHealth();
    await exampleCheckLatency();
    await exampleGetProtocol();
    await exampleGetCompleteStatus();
    await exampleCustomUrls(); // Uncomment if you have custom endpoints
    await exampleErrorHandling();
    await exampleMonitoring(); // Uncomment to run monitoring loop
  } catch (error) {
    console.error("Example failed:", error);
  }
}

// Uncomment to run examples
// main();
