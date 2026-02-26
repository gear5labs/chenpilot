# Chen Pilot SDK Core

Core SDK for Chen Pilot cross-chain operations with Stellar/Soroban support.

## Features

- **Network Status Checks**: Monitor Stellar network health, latency, and protocol version
- **Event Subscriptions**: Subscribe to Soroban contract events
- **Recovery Engine**: Handle cross-chain transaction failures and retries
- **Plan Verification**: Verify and validate transaction plans
- **TypeScript Support**: Full type definitions included

## Installation

```bash
npm install @chen-pilot/sdk-core
```

## Quick Start

### Network Status

Check Stellar network health and status:

```typescript
import { getNetworkStatus } from "@chen-pilot/sdk-core";

const status = await getNetworkStatus({ network: "testnet" });

console.log("Network healthy:", status.health.isHealthy);
console.log("Latest ledger:", status.health.latestLedger);
console.log("Protocol version:", status.protocol.version);
```

See [NETWORK_STATUS.md](./NETWORK_STATUS.md) for complete documentation.

### Event Subscriptions

Subscribe to Soroban contract events:

```typescript
import { subscribeToEvents } from "@chen-pilot/sdk-core";

const subscription = await subscribeToEvents({
  network: "testnet",
  contractIds: ["CABC1234567890"],
  topicFilter: ["transfer"],
});

subscription.on("event", (event) => {
  console.log("Event received:", event);
});

subscription.on("error", (error) => {
  console.error("Subscription error:", error);
});
```

### Recovery Engine

Handle cross-chain transaction failures:

```typescript
import { RecoveryEngine } from "@chen-pilot/sdk-core";

const engine = new RecoveryEngine({
  maxRetries: 3,
  retryDelayMs: 5000,
});

const result = await engine.recover(context);
```

## API Documentation

### Network Status

- `checkNetworkHealth(config)` - Check if network is reachable
- `checkLedgerLatency(config)` - Check ledger latency
- `getProtocolVersion(config)` - Get protocol version
- `getNetworkStatus(config)` - Get complete network status

See [NETWORK_STATUS.md](./NETWORK_STATUS.md) for details.

### Event Subscriptions

- `subscribeToEvents(config)` - Subscribe to contract events
- `SorobanEventSubscription` - Event subscription class

### Recovery

- `RecoveryEngine` - Cross-chain recovery engine
- `RecoveryAction` - Recovery action types
- `RecoveryContext` - Recovery context interface

## Examples

Check the `examples/` directory for complete usage examples:

- `networkStatus.example.ts` - Network status monitoring
- More examples coming soon

## Testing

Run the test suite:

```bash
npm test
```

Run with coverage:

```bash
npm run test:coverage
```

## Development

Build the SDK:

```bash
npm run build
```

## TypeScript

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  NetworkStatus,
  NetworkHealth,
  LedgerLatency,
  ProtocolVersion,
  SorobanEvent,
  EventSubscription,
  RecoveryContext,
  RecoveryResult,
} from "@chen-pilot/sdk-core";
```

## License

ISC

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines.
