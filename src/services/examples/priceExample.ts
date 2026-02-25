/**
 * Example usage of Redis-backed price caching
 *
 * This demonstrates how to use the price services for:
 * - Single price queries
 * - Batch price queries
 * - Orderbook analysis
 * - Cache management
 */

import stellarPriceService from "../stellarPrice.service";
import priceCacheService from "../priceCache.service";
import logger from "../../config/logger";

async function runPriceExamples() {
  try {
    console.log("=== Redis-Backed Price Cache Examples ===\n");

    // 1. Single Price Query
    console.log("1. Fetching single price (XLM -> USDC)...");
    const quote1 = await stellarPriceService.getPrice("XLM", "USDC", 100);
    console.log(`   Price: ${quote1.price} USDC per XLM`);
    console.log(`   Estimated output: ${quote1.estimatedOutput} USDC`);
    console.log(`   Cached: ${quote1.cached}`);
    console.log(`   Path: ${quote1.path?.join(" → ")}\n`);

    // 2. Same query again (should be cached)
    console.log("2. Fetching same price again (should be cached)...");
    const quote2 = await stellarPriceService.getPrice("XLM", "USDC", 100);
    console.log(`   Price: ${quote2.price} USDC per XLM`);
    console.log(`   Cached: ${quote2.cached}`);
    console.log(
      `   Age: ${Math.round((Date.now() - quote2.timestamp) / 1000)}s\n`
    );

    // 3. Batch Price Queries
    console.log("3. Fetching multiple prices...");
    const quotes = await stellarPriceService.getPrices([
      { from: "XLM", to: "USDC", amount: 100 },
      { from: "XLM", to: "USDT", amount: 50 },
      { from: "USDC", to: "USDT", amount: 10 },
    ]);

    quotes.forEach((q) => {
      console.log(
        `   ${q.fromAsset}/${q.toAsset}: ${q.price} (cached: ${q.cached})`
      );
    });
    console.log();

    // 4. Orderbook Depth
    console.log("4. Fetching orderbook depth (XLM/USDC)...");
    const orderbook = await stellarPriceService.getOrderbookDepth(
      "XLM",
      "USDC",
      5
    );
    console.log(`   Best bid: ${orderbook.bids[0]?.price || "N/A"}`);
    console.log(`   Best ask: ${orderbook.asks[0]?.price || "N/A"}`);
    console.log(`   Top 5 bids:`, orderbook.bids.slice(0, 5));
    console.log(`   Top 5 asks:`, orderbook.asks.slice(0, 5));
    console.log();

    // 5. Cache Statistics
    console.log("5. Cache statistics...");
    const stats = await priceCacheService.getStats();
    console.log(`   Total cached prices: ${stats.totalKeys}`);
    console.log(`   Memory usage: ${stats.memoryUsage}`);

    const healthy = await priceCacheService.healthCheck();
    console.log(
      `   Redis status: ${healthy ? "✓ Connected" : "✗ Disconnected"}\n`
    );

    // 6. Cache Invalidation
    console.log("6. Invalidating XLM/USDC cache...");
    await stellarPriceService.invalidatePrice("XLM", "USDC");
    const quote3 = await stellarPriceService.getPrice("XLM", "USDC", 100);
    console.log(`   Cached after invalidation: ${quote3.cached}\n`);

    // 7. Direct Cache Operations
    console.log("7. Direct cache operations...");
    await priceCacheService.setPrice("TEST", "USDC", 1.5, "manual", 30);
    const cached = await priceCacheService.getPrice("TEST", "USDC");
    console.log(`   Manually cached TEST/USDC: ${cached?.price}\n`);

    // 8. Batch Cache Retrieval
    console.log("8. Batch cache retrieval...");
    const cachedPrices = await priceCacheService.getPrices([
      { from: "XLM", to: "USDC" },
      { from: "XLM", to: "USDT" },
      { from: "TEST", to: "USDC" },
    ]);

    cachedPrices.forEach((price, key) => {
      console.log(`   ${key}: ${price ? price.price : "not cached"}`);
    });
    console.log();

    console.log("=== Examples completed successfully ===");
  } catch (error) {
    logger.error("Error running price examples:", error);
    console.error("Error:", error);
  } finally {
    // Cleanup
    await priceCacheService.disconnect();
  }
}

// Run examples if executed directly
if (require.main === module) {
  runPriceExamples()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

export default runPriceExamples;
