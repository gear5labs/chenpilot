/**
 * Test script for webhook idempotency
 * Run with: npx ts-node src/scripts/testWebhookIdempotency.ts
 */

import AppDataSource from "../config/Datasource";
import { webhookIdempotencyService } from "../Gateway/webhookIdempotency.service";

async function testIdempotency() {
  console.log("🧪 Testing Webhook Idempotency Service\n");

  try {
    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log("✅ Database connection established\n");
    }

    // Test 1: Check and mark a new webhook
    console.log("Test 1: Processing new webhook");
    const webhookId1 = `test_${Date.now()}`;
    const isNew1 = await webhookIdempotencyService.checkAndMark(
      webhookId1,
      "telegram",
      { test: true, timestamp: new Date().toISOString() }
    );
    console.log(
      `  Result: ${isNew1 ? "✅ Processed (new)" : "❌ Rejected (duplicate)"}`
    );
    console.log(`  Expected: true, Got: ${isNew1}\n`);

    // Test 2: Try to process the same webhook again (should be duplicate)
    console.log("Test 2: Processing duplicate webhook");
    const isNew2 = await webhookIdempotencyService.checkAndMark(
      webhookId1,
      "telegram",
      { test: true, timestamp: new Date().toISOString() }
    );
    console.log(
      `  Result: ${isNew2 ? "❌ Processed (should be duplicate)" : "✅ Rejected (duplicate)"}`
    );
    console.log(`  Expected: false, Got: ${isNew2}\n`);

    // Test 3: Same webhook ID but different platform (should be new)
    console.log("Test 3: Same ID, different platform");
    const isNew3 = await webhookIdempotencyService.checkAndMark(
      webhookId1,
      "discord",
      { test: true, timestamp: new Date().toISOString() }
    );
    console.log(
      `  Result: ${isNew3 ? "✅ Processed (new platform)" : "❌ Rejected (should be new)"}`
    );
    console.log(`  Expected: true, Got: ${isNew3}\n`);

    // Test 4: Check isDuplicate method
    console.log("Test 4: Check isDuplicate method");
    const isDup1 = await webhookIdempotencyService.isDuplicate(
      webhookId1,
      "telegram"
    );
    const isDup2 = await webhookIdempotencyService.isDuplicate(
      "nonexistent_webhook",
      "telegram"
    );
    console.log(`  Existing webhook: ${isDup1 ? "✅ Found" : "❌ Not found"}`);
    console.log(
      `  Nonexistent webhook: ${isDup2 ? "❌ Found (should not exist)" : "✅ Not found"}`
    );
    console.log(`  Expected: true, false | Got: ${isDup1}, ${isDup2}\n`);

    // Test 5: Mark processed method
    console.log("Test 5: Mark processed method");
    const webhookId2 = `test_mark_${Date.now()}`;
    await webhookIdempotencyService.markProcessed(webhookId2, "telegram");
    const isDup3 = await webhookIdempotencyService.isDuplicate(
      webhookId2,
      "telegram"
    );
    console.log(
      `  Marked and checked: ${isDup3 ? "✅ Found" : "❌ Not found"}`
    );
    console.log(`  Expected: true, Got: ${isDup3}\n`);

    // Summary
    console.log("📊 Test Summary");
    console.log("================");
    const allPassed =
      isNew1 === true &&
      isNew2 === false &&
      isNew3 === true &&
      isDup1 === true &&
      isDup2 === false &&
      isDup3 === true;

    if (allPassed) {
      console.log("✅ All tests passed!");
    } else {
      console.log("❌ Some tests failed. Review results above.");
    }

    // Cleanup test data
    console.log("\n🧹 Cleaning up test data...");
    const repository = AppDataSource.getRepository("WebhookIdempotency");
    await repository
      .createQueryBuilder()
      .delete()
      .where("metadata->>'test' = :test", { test: "true" })
      .execute();
    console.log("✅ Test data cleaned up");
  } catch (error) {
    console.error("❌ Test failed with error:", error);
    process.exit(1);
  } finally {
    // Close database connection
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      console.log("\n✅ Database connection closed");
    }
  }
}

// Run tests
testIdempotency()
  .then(() => {
    console.log("\n✅ Test script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test script failed:", error);
    process.exit(1);
  });
