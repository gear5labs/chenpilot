# Stellar Sequence Manager - Implementation Guide

## Overview

The Sequence Manager provides robust sequence number tracking and prediction for highly concurrent Stellar transaction submission scenarios. It prevents sequence number collisions, transaction failures, and ensures optimal throughput in high-concurrency environments.

## Problem Statement

When submitting multiple Stellar transactions concurrently from the same account, sequence number management becomes critical:

1. **Race Conditions**: Multiple transactions fetching the same sequence number
2. **Sequence Gaps**: Failed transactions leaving gaps in the sequence
3. **Network Latency**: Delays in fetching current sequence from Horizon
4. **Throughput Bottlenecks**: Sequential transaction submission limiting performance

## Solution

The Sequence Manager implements:

- **Predictive Sequencing**: Predicts next available sequence numbers without network calls
- **Concurrent Safety**: Thread-safe operations with internal locking
- **Automatic Caching**: Reduces network calls with intelligent caching
- **Transaction Tracking**: Monitors pending, submitted, confirmed, and failed transactions
- **Auto-Refresh**: Optional automatic sequence refresh from network

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Application Layer                       │
│  (Transaction Building & Submission)                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│           StellarSequenceHelper                          │
│  (Integration with Stellar SDK)                          │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              SequenceManager                             │
│  • Sequence Prediction                                   │
│  • Concurrent Request Handling                           │
│  • Transaction State Tracking                            │
│  • Cache Management                                      │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│            Stellar Network                               │
│  (Horizon API)                                           │
└─────────────────────────────────────────────────────────┘
```

## Installation

The Sequence Manager is part of the SDK:

```typescript
import {
  SequenceManager,
  StellarSequenceHelper,
  createStellarSequenceHelper,
} from "@chen-pilot/sdk-core";
```

## Basic Usage

### 1. Create a Sequence Manager

```typescript
import { SequenceManager } from "@chen-pilot/sdk-core";

const sequenceManager = new SequenceManager({
  cacheTTL: 30000, // Cache for 30 seconds
  maxPendingTransactions: 100, // Max 100 pending per account
  autoRefresh: true, // Auto-refresh from network
  refreshInterval: 10000, // Refresh every 10 seconds
});
```

### 2. Get Next Sequence Number

```typescript
const accountId = "GABC123...";

const sequenceInfo = await sequenceManager.getNextSequence(
  accountId,
  async () => {
    // Fetch current sequence from Horizon
    const account = await server.loadAccount(accountId);
    return account.sequenceNumber();
  }
);

console.log(sequenceInfo);
// {
//   current: "100",
//   next: "101",
//   pendingCount: 1,
//   lastFetched: 1234567890,
//   cached: false
// }
```

### 3. Reserve Sequence for Transaction

```typescript
const transaction = await sequenceManager.reserveSequence(
  accountId,
  sequenceInfo.next,
  { type: "payment", amount: "100" }
);

console.log(transaction);
// {
//   sequence: "101",
//   createdAt: 1234567890,
//   status: "pending",
//   metadata: { type: "payment", amount: "100" }
// }
```

### 4. Track Transaction Lifecycle

```typescript
// Mark as submitted
await sequenceManager.markSubmitted(accountId, "101", "txhash123");

// Mark as confirmed (removes from pending)
await sequenceManager.markConfirmed(accountId, "101");

// Or mark as failed (removes from pending)
await sequenceManager.markFailed(accountId, "101");
```

## Advanced Usage with Stellar SDK

### Using StellarSequenceHelper

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";
import { createStellarSequenceHelper } from "@chen-pilot/sdk-core";

const server = new StellarSdk.Horizon.Server("https://horizon-testnet.stellar.org");
const helper = createStellarSequenceHelper(server);

// Build and submit a managed transaction
const result = await helper.submitManagedTransaction(
  sourceKeypair.publicKey(),
  StellarSdk.Account,
  (account) => {
    // Build transaction with managed account
    return new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: destinationKey.publicKey(),
          asset: StellarSdk.Asset.native(),
          amount: "100",
        })
      )
      .setTimeout(30)
      .build();
  },
  async (transaction) => {
    // Sign and submit
    transaction.sign(sourceKeypair);
    return await server.submitTransaction(transaction);
  }
);

console.log("Transaction submitted:", result.hash);
```

### Manual Transaction Building

```typescript
// Get managed account with predicted sequence
const { account, sequenceInfo } = await helper.createManagedAccount(
  sourceKeypair.publicKey(),
  StellarSdk.Account
);

// Build transaction
const transaction = new StellarSdk.TransactionBuilder(account, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: StellarSdk.Networks.TESTNET,
})
  .addOperation(
    StellarSdk.Operation.payment({
      destination: destinationKey.publicKey(),
      asset: StellarSdk.Asset.native(),
      amount: "100",
    })
  )
  .setTimeout(30)
  .build();

transaction.sign(sourceKeypair);

try {
  const result = await server.submitTransaction(transaction);
  await helper.sequenceManager.markSubmitted(
    sourceKeypair.publicKey(),
    sequenceInfo.next,
    result.hash
  );
  await helper.sequenceManager.markConfirmed(
    sourceKeypair.publicKey(),
    sequenceInfo.next
  );
} catch (error) {
  await helper.sequenceManager.markFailed(
    sourceKeypair.publicKey(),
    sequenceInfo.next
  );
  throw error;
}
```

## Concurrent Transaction Submission

### Example: Submit 100 Transactions Concurrently

```typescript
const accountId = sourceKeypair.publicKey();
const promises = [];

for (let i = 0; i < 100; i++) {
  const promise = helper.submitManagedTransaction(
    accountId,
    StellarSdk.Account,
    (account) => {
      return new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationKey.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "1",
          })
        )
        .setTimeout(30)
        .build();
    },
    async (transaction) => {
      transaction.sign(sourceKeypair);
      return await server.submitTransaction(transaction);
    }
  );

  promises.push(promise);
}

// All transactions will use unique sequence numbers
const results = await Promise.allSettled(promises);

console.log(`Submitted: ${results.filter((r) => r.status === "fulfilled").length}`);
console.log(`Failed: ${results.filter((r) => r.status === "rejected").length}`);
```

## Monitoring and Statistics

### Get Current Statistics

```typescript
const stats = sequenceManager.getStats();

console.log(stats);
// {
//   accountsTracked: 5,
//   totalPending: 23,
//   accountStats: [
//     {
//       accountId: "GABC123...",
//       pendingCount: 10,
//       lastFetched: 1234567890,
//       cacheAge: 5000
//     },
//     ...
//   ]
// }
```

### Get Pending Transactions

```typescript
const pending = sequenceManager.getPendingTransactions(accountId);

console.log(pending);
// [
//   {
//     sequence: "101",
//     hash: "txhash123",
//     createdAt: 1234567890,
//     status: "submitted",
//     metadata: { type: "payment" }
//   },
//   ...
// ]
```

### Get Sequence Info

```typescript
const info = sequenceManager.getSequenceInfo(accountId);

console.log(info);
// {
//   current: "100",
//   next: "105",
//   pendingCount: 4,
//   lastFetched: 1234567890,
//   cached: true
// }
```

## Configuration Options

### SequenceManagerConfig

```typescript
interface SequenceManagerConfig {
  /**
   * Time-to-live for cached sequence numbers (milliseconds)
   * Default: 30000 (30 seconds)
   */
  cacheTTL?: number;

  /**
   * Maximum number of pending transactions to track per account
   * Default: 100
   */
  maxPendingTransactions?: number;

  /**
   * Whether to automatically refresh sequence numbers from network
   * Default: true
   */
  autoRefresh?: boolean;

  /**
   * Interval for automatic refresh (milliseconds)
   * Default: 10000 (10 seconds)
   */
  refreshInterval?: number;
}
```

### Recommended Settings

**High Throughput (Many Concurrent Transactions)**
```typescript
new SequenceManager({
  cacheTTL: 60000, // 1 minute
  maxPendingTransactions: 500,
  autoRefresh: true,
  refreshInterval: 5000, // 5 seconds
});
```

**Low Latency (Quick Response)**
```typescript
new SequenceManager({
  cacheTTL: 10000, // 10 seconds
  maxPendingTransactions: 50,
  autoRefresh: true,
  refreshInterval: 3000, // 3 seconds
});
```

**Conservative (Maximum Safety)**
```typescript
new SequenceManager({
  cacheTTL: 5000, // 5 seconds
  maxPendingTransactions: 20,
  autoRefresh: false, // Manual refresh only
});
```

## Best Practices

### 1. Use a Single Instance

Create one SequenceManager instance per application:

```typescript
// sequenceManager.ts
export const globalSequenceManager = new SequenceManager({
  cacheTTL: 30000,
  maxPendingTransactions: 100,
  autoRefresh: true,
});
```

### 2. Handle Errors Gracefully

```typescript
try {
  const result = await helper.submitManagedTransaction(...);
} catch (error) {
  if (error.message.includes("tx_bad_seq")) {
    // Sequence number issue - refresh and retry
    await helper.refreshSequence(accountId);
    // Retry logic here
  }
  throw error;
}
```

### 3. Monitor Pending Transactions

```typescript
setInterval(() => {
  const stats = sequenceManager.getStats();
  
  if (stats.totalPending > 50) {
    console.warn("High number of pending transactions:", stats.totalPending);
  }
  
  for (const account of stats.accountStats) {
    if (account.cacheAge > 60000) {
      console.warn(`Stale cache for ${account.accountId}`);
    }
  }
}, 10000);
```

### 4. Clean Up Resources

```typescript
// On application shutdown
sequenceManager.destroy();
```

### 5. Refresh After Failures

```typescript
const maxRetries = 3;
let attempt = 0;

while (attempt < maxRetries) {
  try {
    const result = await helper.submitManagedTransaction(...);
    break;
  } catch (error) {
    attempt++;
    if (attempt < maxRetries) {
      // Refresh sequence before retry
      await helper.refreshSequence(accountId);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    } else {
      throw error;
    }
  }
}
```

## Performance Considerations

### Network Calls Reduction

Without Sequence Manager:
- 100 concurrent transactions = 100 network calls to fetch sequence
- Total time: ~10-20 seconds (with network latency)

With Sequence Manager:
- 100 concurrent transactions = 1 network call
- Total time: ~2-5 seconds (mostly submission time)

### Memory Usage

- Per account: ~500 bytes (sequence info)
- Per pending transaction: ~200 bytes
- 100 accounts with 10 pending each: ~70 KB

### Throughput

- Without manager: ~5-10 tx/second (sequential)
- With manager: ~50-100 tx/second (concurrent)

## Troubleshooting

### Issue: "tx_bad_seq" Errors

**Cause**: Sequence number mismatch with network

**Solution**:
```typescript
await helper.refreshSequence(accountId);
```

### Issue: "Maximum pending transactions reached"

**Cause**: Too many unconfirmed transactions

**Solution**:
```typescript
// Increase limit
new SequenceManager({ maxPendingTransactions: 500 });

// Or clean up old pending
sequenceManager.clearAccount(accountId);
```

### Issue: Stale Cache

**Cause**: Cache TTL too long

**Solution**:
```typescript
// Reduce TTL
new SequenceManager({ cacheTTL: 10000 });

// Or force refresh
await helper.refreshSequence(accountId);
```

## Testing

Run the test suite:

```bash
npm test packages/sdk/src/__tests__/sequenceManager.test.ts
```

## API Reference

See inline documentation in:
- `packages/sdk/src/sequenceManager.ts`
- `packages/sdk/src/stellarSequenceHelper.ts`

## Support

For issues or questions:
- Check the test files for usage examples
- Review the inline documentation
- Open an issue on GitHub

## License

ISC
