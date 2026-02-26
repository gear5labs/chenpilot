# Stellar Claimable Balance Utilities

This module provides utilities to search for and claim pending claimable balances on the Stellar network.

## Features

- Search for claimable balances by account ID
- Claim specific claimable balances
- Calculate total claimable amounts grouped by asset
- Support for both testnet and mainnet
- TypeScript support with full type definitions

## Installation

The claimable balance utilities are included in the SDK:

```typescript
import {
  searchClaimableBalances,
  claimBalance,
  getTotalClaimableAmount,
} from "@chenpilot-experimental/sdk";
```

## Usage Examples

### Search for Claimable Balances

```typescript
import { searchClaimableBalances } from "@chenpilot-experimental/sdk";

const balances = await searchClaimableBalances({
  accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  network: "testnet", // or "mainnet"
  limit: 100, // optional, defaults to 200
});

console.log(`Found ${balances.length} claimable balances`);
balances.forEach((balance) => {
  console.log(`ID: ${balance.id}`);
  console.log(`Asset: ${balance.asset}`);
  console.log(`Amount: ${balance.amount}`);
  console.log(`Sponsor: ${balance.sponsor}`);
});
```

### Claim a Balance

```typescript
import { claimBalance } from "@chenpilot-experimental/sdk";

const result = await claimBalance({
  balanceId: "00000000...", // The claimable balance ID
  claimantSecret: "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  network: "testnet",
});

if (result.success) {
  console.log(`Successfully claimed! TX: ${result.transactionHash}`);
  console.log(`Claimed ${result.balance?.amount} ${result.balance?.asset}`);
} else {
  console.error(`Failed to claim: ${result.error}`);
}
```

### Get Total Claimable Amounts

```typescript
import { getTotalClaimableAmount } from "@chenpilot-experimental/sdk";

const totals = await getTotalClaimableAmount({
  accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  network: "testnet",
});

console.log("Total claimable amounts:");
Object.entries(totals).forEach(([asset, amount]) => {
  console.log(`${asset}: ${amount}`);
});
// Output example:
// XLM: 100.0000000
// USDC: 50.0000000
```

### Complete Example: Find and Claim All Balances

```typescript
import {
  searchClaimableBalances,
  claimBalance,
} from "@chenpilot-experimental/sdk";

async function claimAllBalances(
  accountId: string,
  secret: string,
  network: "testnet" | "mainnet" = "testnet"
) {
  // Search for all claimable balances
  const balances = await searchClaimableBalances({
    accountId,
    network,
  });

  console.log(`Found ${balances.length} claimable balances`);

  // Claim each balance
  for (const balance of balances) {
    console.log(`Claiming ${balance.amount} ${balance.asset}...`);

    const result = await claimBalance({
      balanceId: balance.id,
      claimantSecret: secret,
      network,
    });

    if (result.success) {
      console.log(`✓ Claimed! TX: ${result.transactionHash}`);
    } else {
      console.error(`✗ Failed: ${result.error}`);
    }

    // Add a small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Usage
claimAllBalances(
  "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "testnet"
);
```

## API Reference

### `searchClaimableBalances(options)`

Search for claimable balances for a given account.

**Parameters:**

- `options.accountId` (string, required): Stellar account public key
- `options.network` (string, optional): "testnet" or "mainnet" (default: "testnet")
- `options.horizonUrl` (string, optional): Custom Horizon server URL
- `options.limit` (number, optional): Maximum number of results (default: 200)

**Returns:** `Promise<ClaimableBalance[]>`

### `claimBalance(options)`

Claim a specific claimable balance.

**Parameters:**

- `options.balanceId` (string, required): Claimable balance ID
- `options.claimantSecret` (string, required): Secret key of the claimant account
- `options.network` (string, optional): "testnet" or "mainnet" (default: "testnet")
- `options.horizonUrl` (string, optional): Custom Horizon server URL

**Returns:** `Promise<ClaimBalanceResult>`

### `getTotalClaimableAmount(options)`

Calculate total claimable amounts grouped by asset.

**Parameters:**

- Same as `searchClaimableBalances`

**Returns:** `Promise<Record<string, string>>` - Object mapping asset codes to total amounts

## Types

### `ClaimableBalance`

```typescript
interface ClaimableBalance {
  id: string;
  asset: string;
  amount: string;
  sponsor: string;
  createdAt?: string;
  claimants: Array<{
    destination: string;
    predicate: unknown;
  }>;
}
```

### `ClaimBalanceResult`

```typescript
interface ClaimBalanceResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
  balance?: ClaimableBalance;
}
```

## Error Handling

All functions throw errors for network issues or invalid parameters. Wrap calls in try-catch blocks:

```typescript
try {
  const balances = await searchClaimableBalances({
    accountId: "GXXXXX...",
    network: "testnet",
  });
} catch (error) {
  console.error("Failed to search balances:", error.message);
}
```

The `claimBalance` function returns a result object with `success` and `error` fields instead of throwing:

```typescript
const result = await claimBalance({
  balanceId: "...",
  claimantSecret: "...",
});

if (!result.success) {
  console.error(result.error);
}
```

## Notes

- Claimable balances can have time-based or other predicates that must be satisfied before claiming
- The claimant account must exist and have sufficient XLM for transaction fees
- Network fees apply when claiming balances (typically 100 stroops = 0.00001 XLM)
- Some balances may have multiple claimants; only valid claimants can claim
