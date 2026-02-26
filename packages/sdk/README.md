# Chen Pilot SDK

Core SDK for Chen Pilot cross-chain operations and Stellar utilities.

## Features

- Cross-chain swap operations
- Recovery engine for failed transactions
- Plan verification utilities
- Agent client for AI-powered operations
- **Stellar Claimable Balance utilities** (search and claim)
- Event subscription for Soroban contracts

## Installation

```bash
npm install @chenpilot-experimental/sdk
```

## Quick Start

### Claimable Balances

Search for and claim pending claimable balances on Stellar:

```typescript
import {
  searchClaimableBalances,
  claimBalance,
} from "@chenpilot-experimental/sdk";

// Search for claimable balances
const balances = await searchClaimableBalances({
  accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  network: "testnet",
});

console.log(`Found ${balances.length} claimable balances`);

// Claim a balance
const result = await claimBalance({
  balanceId: balances[0].id,
  claimantSecret: "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  network: "testnet",
});

if (result.success) {
  console.log(`Claimed! TX: ${result.transactionHash}`);
}
```

See [Claimable Balance Documentation](./src/CLAIMABLE_BALANCE_README.md) for detailed usage.

### Recovery Engine

Handle failed cross-chain transactions:

```typescript
import { RecoveryEngine } from "@chenpilot-experimental/sdk";

const engine = new RecoveryEngine({
  maxRetries: 3,
  retryDelayMs: 5000,
});

const result = await engine.recover(context);
```

### Agent Client

Interact with the AI agent:

```typescript
import { AgentClient } from "@chenpilot-experimental/sdk";

const client = new AgentClient({
  baseUrl: "https://api.chenpilot.com",
  apiKey: "your-api-key",
});

const response = await client.chat("Swap 100 USDC to XLM");
```

## Documentation

- [Claimable Balance Guide](./src/CLAIMABLE_BALANCE_README.md) - Search and claim Stellar claimable balances
- [Recovery Engine](./src/recovery.ts) - Handle failed transactions
- [Plan Verification](./src/planVerification.ts) - Verify execution plans
- [Event Subscription](./src/events.ts) - Subscribe to Soroban events

## Examples

Check the [examples](./examples) directory for complete usage examples:

- [Claimable Balance Example](./examples/claimableBalanceExample.ts)

## API Reference

### Claimable Balance Functions

- `searchClaimableBalances(options)` - Search for claimable balances
- `claimBalance(options)` - Claim a specific balance
- `getTotalClaimableAmount(options)` - Get total claimable amounts by asset

### Types

All TypeScript types are exported from the main entry point:

```typescript
import type {
  ClaimableBalance,
  ClaimBalanceResult,
  RecoveryContext,
  AgentResponse,
} from "@chenpilot-experimental/sdk";
```

## Development

Build the SDK:

```bash
npm run build
```

## License

ISC
