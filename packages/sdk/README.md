# Chen Pilot SDK Core

Core SDK for Chen Pilot cross-chain operations with support for Soroban contract interactions, event subscriptions, recovery mechanisms, and automatic fee bumping.

## Features

- **Fee Bumping**: Automatic resource limit adjustment for Soroban transactions
- **Event Subscriptions**: Subscribe to Soroban contract events
- **Recovery Engine**: Handle failed cross-chain transactions
- **Plan Verification**: Verify and validate transaction plans
- **TypeScript**: Full TypeScript support with comprehensive type definitions

## Installation

```bash
npm install @chen-pilot/sdk-core
```

## Quick Start

### Fee Bumping

Automatically adjust resource limits for Soroban transactions:

```typescript
import { FeeBumpingEngine } from "@chen-pilot/sdk-core";

const engine = new FeeBumpingEngine({
  strategy: "moderate",
  maxAttempts: 3,
});

const result = await engine.bumpAndRetry(async (limits) => {
  return await sorobanClient.invokeContract({
    contractId: "CXXX...",
    method: "transfer",
    args: [...],
    resourceLimits: limits,
  });
});

if (result.success) {
  console.log("Transaction hash:", result.result.hash);
  console.log("Final fee:", result.estimatedFee, "stroops");
}
```

### Event Subscriptions

Subscribe to Soroban contract events:

```typescript
import { subscribeToEvents } from "@chen-pilot/sdk-core";

const subscription = await subscribeToEvents(
  {
    network: "testnet",
    contractIds: ["CXXX..."],
    topicFilter: ["transfer"],
    pollingIntervalMs: 5000,
  },
  async (event) => {
    console.log("Event received:", event);
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);

// Later: stop subscription
await subscription.unsubscribe();
```

### Recovery Engine

Handle failed cross-chain transactions:

```typescript
import { RecoveryEngine } from "@chen-pilot/sdk-core";

const engine = new RecoveryEngine({
  maxRetries: 3,
  retryDelayMs: 5000,
});

const result = await engine.recover({
  lockTxId: "btc_tx_123",
  amount: "1000000",
  fromChain: ChainId.BITCOIN,
  toChain: ChainId.STELLAR,
  destinationAddress: "GXXX...",
});

console.log("Recovery action:", result.actionTaken);
```

## Documentation

- [Fee Bumping Guide](./docs/FEE_BUMPING.md) - Comprehensive guide to automatic fee bumping
- [API Reference](./docs/API.md) - Complete API documentation
- [Examples](./examples/) - Usage examples

## API Overview

### Fee Bumping

```typescript
// Create engine
const engine = new FeeBumpingEngine({
  strategy: "conservative" | "moderate" | "aggressive",
  maxAttempts: number,
  initialLimits: ResourceLimits,
  onBump: (info) => void,
});

// Execute with automatic retries
const result = await engine.bumpAndRetry(txExecutor, initialLimits?);

// Manual adjustment calculation
const adjusted = engine.calculateAdjustment(error, currentLimits);

// Fee estimation
const fee = engine.estimateFee(limits);

// Get defaults
const defaults = FeeBumpingEngine.getDefaultLimits();
```

### Event Subscriptions

```typescript
const subscription = await subscribeToEvents(
  config: EventSubscriptionConfig,
  onEvent: EventHandler,
  onError?: ErrorHandler
);

await subscription.unsubscribe();
const isActive = subscription.isActive();
const lastLedger = subscription.getLastLedger();
```

### Recovery Engine

```typescript
const engine = new RecoveryEngine(options);
const result = await engine.recover(context);
```

## Types

```typescript
// Resource Limits
interface ResourceLimits {
  cpuInstructions: number;
  readBytes: number;
  writeBytes: number;
  readLedgerEntries: number;
  writeLedgerEntries: number;
  txSizeByte: number;
}

// Fee Bump Result
interface FeeBumpResult<T> {
  success: boolean;
  result?: T;
  error?: string;
  finalLimits: ResourceLimits;
  attempts: Array<{
    attempt: number;
    limits: ResourceLimits;
    error?: string;
  }>;
  estimatedFee: number;
}

// Event Subscription
interface SorobanEvent {
  transactionHash: string;
  contractId: string;
  topics: string[];
  data: unknown;
  ledger: number;
  createdAt: number;
}
```

## Examples

### Basic Fee Bumping

```typescript
import { FeeBumpingEngine } from "@chen-pilot/sdk-core";

const engine = new FeeBumpingEngine();

const result = await engine.bumpAndRetry(async (limits) => {
  return await invokeContract({ ...params, resourceLimits: limits });
});
```

### Custom Strategy

```typescript
const engine = new FeeBumpingEngine({
  strategy: "aggressive",
  maxAttempts: 5,
  onBump: (info) => {
    console.log(`Bumping ${info.error.resource}`);
  },
});
```

### Fee Estimation

```typescript
const engine = new FeeBumpingEngine();
const limits = FeeBumpingEngine.getDefaultLimits();
const fee = engine.estimateFee(limits);

console.log(`Estimated fee: ${fee / 10_000_000} XLM`);
```

## Testing

```bash
# Run tests
npm test

# Run tests with coverage
npx jest --coverage

# Run specific test file
npm test -- feeBumping.test.ts
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npx tsc --noEmit
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](../../CONTRIBUTING.md) for details.

## License

ISC

## Support

- GitHub Issues: [github.com/gear5labs/chenpilot/issues](https://github.com/gear5labs/chenpilot/issues)
- Documentation: [Full Documentation](./docs/)

## Changelog

### v0.1.0

- Initial release
- Fee bumping engine with automatic resource limit adjustment
- Event subscription support
- Recovery engine for failed transactions
- Plan verification utilities
- Comprehensive TypeScript types
