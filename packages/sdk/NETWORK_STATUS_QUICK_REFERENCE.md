# Network Status API - Quick Reference

## Installation

```bash
npm install @chen-pilot/sdk-core
```

## Import

```typescript
import {
  checkNetworkHealth,
  checkLedgerLatency,
  getProtocolVersion,
  getNetworkStatus,
} from "@chen-pilot/sdk-core";
```

## Functions

### Check Health

```typescript
const health = await checkNetworkHealth({ network: "testnet" });
// Returns: { isHealthy, responseTimeMs, latestLedger, error? }
```

### Check Latency

```typescript
const latency = await checkLedgerLatency({ network: "testnet" });
// Returns: { currentLedger, timeSinceLastLedgerSec, averageLedgerTimeSec, isNormal }
```

### Get Protocol

```typescript
const protocol = await getProtocolVersion({ network: "mainnet" });
// Returns: { version, coreVersion, networkPassphrase }
```

### Get Complete Status

```typescript
const status = await getNetworkStatus({ network: "testnet" });
// Returns: { health, latency, protocol, checkedAt }
```

## Configuration

```typescript
{
  network: "testnet" | "mainnet",  // Required
  rpcUrl?: string,                 // Optional
  horizonUrl?: string              // Optional
}
```

## Common Patterns

### Pre-Transaction Check

```typescript
const health = await checkNetworkHealth({ network: "mainnet" });
if (!health.isHealthy) {
  throw new Error(`Network unavailable: ${health.error}`);
}
// Proceed with transaction
```

### Latency Alert

```typescript
const latency = await checkLedgerLatency({ network: "testnet" });
if (!latency.isNormal) {
  console.warn(`High latency: ${latency.timeSinceLastLedgerSec}s`);
}
```

### Version Check

```typescript
const protocol = await getProtocolVersion({ network: "mainnet" });
if (protocol.version < 20) {
  console.warn("Protocol version outdated");
}
```

### Monitoring Loop

```typescript
setInterval(async () => {
  const status = await getNetworkStatus({ network: "mainnet" });
  if (!status.health.isHealthy || !status.latency.isNormal) {
    alert("Network issue detected!");
  }
}, 30000);
```

## Error Handling

### Graceful (Health Check)

```typescript
const health = await checkNetworkHealth({ network: "testnet" });
if (!health.isHealthy) {
  console.error(health.error);
}
```

### Try-Catch (Latency/Protocol)

```typescript
try {
  const latency = await checkLedgerLatency({ network: "testnet" });
} catch (error) {
  console.error("Failed:", error);
}
```

## Thresholds

- **Expected ledger time**: 5 seconds
- **Normal latency**: ≤ 15 seconds
- **Abnormal latency**: > 15 seconds

## Default Endpoints

### Testnet

- RPC: `https://soroban-testnet.stellar.org`
- Horizon: `https://horizon-testnet.stellar.org`

### Mainnet

- RPC: `https://soroban-mainnet.stellar.org`
- Horizon: `https://horizon.stellar.org`

## Custom Endpoints

```typescript
const status = await getNetworkStatus({
  network: "testnet",
  rpcUrl: "https://custom-rpc.example.com",
  horizonUrl: "https://custom-horizon.example.com",
});
```

## TypeScript Types

```typescript
import type {
  NetworkStatusConfig,
  NetworkHealth,
  LedgerLatency,
  ProtocolVersion,
  NetworkStatus,
} from "@chen-pilot/sdk-core";
```

## Full Documentation

See [NETWORK_STATUS.md](./NETWORK_STATUS.md) for complete documentation.

## Examples

See [examples/networkStatus.example.ts](./examples/networkStatus.example.ts) for working examples.
