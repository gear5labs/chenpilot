# Network Status API

Simple API for checking Stellar network health, ledger latency, and protocol version.

## Features

- Check network health and reachability
- Monitor ledger latency and detect abnormal delays
- Get current protocol version and core information
- Support for both testnet and mainnet
- Custom RPC and Horizon URL configuration
- Comprehensive error handling

## Installation

```bash
npm install @chen-pilot/sdk-core
```

## Quick Start

```typescript
import { getNetworkStatus } from "@chen-pilot/sdk-core";

// Get complete network status
const status = await getNetworkStatus({ network: "testnet" });

console.log("Network healthy:", status.health.isHealthy);
console.log("Latest ledger:", status.health.latestLedger);
console.log("Latency normal:", status.latency.isNormal);
console.log("Protocol version:", status.protocol.version);
```

## API Reference

### `checkNetworkHealth(config)`

Check if the network is reachable and responding.

**Parameters:**

- `config.network`: `"testnet"` | `"mainnet"` - Network to check
- `config.rpcUrl`: `string` (optional) - Custom RPC URL

**Returns:** `Promise<NetworkHealth>`

```typescript
{
  isHealthy: boolean;        // Whether network is reachable
  responseTimeMs: number;    // Response time in milliseconds
  latestLedger: number;      // Latest ledger sequence
  error?: string;            // Error message if unhealthy
}
```

**Example:**

```typescript
const health = await checkNetworkHealth({ network: "testnet" });

if (health.isHealthy) {
  console.log(`Network is healthy. Latest ledger: ${health.latestLedger}`);
  console.log(`Response time: ${health.responseTimeMs}ms`);
} else {
  console.error(`Network is unhealthy: ${health.error}`);
}
```

### `checkLedgerLatency(config)`

Check the time since the last ledger closed and detect abnormal delays.

**Parameters:**

- `config.network`: `"testnet"` | `"mainnet"` - Network to check
- `config.rpcUrl`: `string` (optional) - Custom RPC URL

**Returns:** `Promise<LedgerLatency>`

```typescript
{
  currentLedger: number; // Current ledger sequence
  timeSinceLastLedgerSec: number; // Seconds since last ledger
  averageLedgerTimeSec: number; // Expected ledger time (5s)
  isNormal: boolean; // Whether latency is normal (<15s)
}
```

**Example:**

```typescript
const latency = await checkLedgerLatency({ network: "testnet" });

console.log(`Current ledger: ${latency.currentLedger}`);
console.log(`Time since last ledger: ${latency.timeSinceLastLedgerSec}s`);

if (!latency.isNormal) {
  console.warn("Network latency is abnormal!");
}
```

### `getProtocolVersion(config)`

Get the current protocol version and core information.

**Parameters:**

- `config.network`: `"testnet"` | `"mainnet"` - Network to check
- `config.horizonUrl`: `string` (optional) - Custom Horizon URL

**Returns:** `Promise<ProtocolVersion>`

```typescript
{
  version: number; // Protocol version number
  coreVersion: string; // Stellar Core version
  networkPassphrase: string; // Network passphrase
}
```

**Example:**

```typescript
const protocol = await getProtocolVersion({ network: "mainnet" });

console.log(`Protocol version: ${protocol.version}`);
console.log(`Core version: ${protocol.coreVersion}`);
console.log(`Network: ${protocol.networkPassphrase}`);
```

### `getNetworkStatus(config)`

Get comprehensive network status including health, latency, and protocol version.

**Parameters:**

- `config.network`: `"testnet"` | `"mainnet"` - Network to check
- `config.rpcUrl`: `string` (optional) - Custom RPC URL
- `config.horizonUrl`: `string` (optional) - Custom Horizon URL

**Returns:** `Promise<NetworkStatus>`

```typescript
{
  health: NetworkHealth; // Network health information
  latency: LedgerLatency; // Ledger latency information
  protocol: ProtocolVersion; // Protocol version information
  checkedAt: number; // Timestamp of the check
}
```

**Example:**

```typescript
const status = await getNetworkStatus({ network: "testnet" });

console.log("=== Network Status ===");
console.log("Health:", status.health.isHealthy);
console.log("Latest Ledger:", status.health.latestLedger);
console.log("Response Time:", status.health.responseTimeMs, "ms");
console.log("Latency Normal:", status.latency.isNormal);
console.log("Protocol Version:", status.protocol.version);
console.log("Checked At:", new Date(status.checkedAt).toISOString());
```

## Use Cases

### 1. Pre-Transaction Health Check

```typescript
async function submitTransaction(tx: Transaction) {
  // Check network health before submitting
  const health = await checkNetworkHealth({ network: "mainnet" });

  if (!health.isHealthy) {
    throw new Error(`Network unavailable: ${health.error}`);
  }

  // Proceed with transaction submission
  return await submitToNetwork(tx);
}
```

### 2. Network Monitoring

```typescript
async function monitorNetwork() {
  setInterval(async () => {
    const status = await getNetworkStatus({ network: "mainnet" });

    if (!status.health.isHealthy) {
      alert("Network is down!");
    }

    if (!status.latency.isNormal) {
      alert(`High latency: ${status.latency.timeSinceLastLedgerSec}s`);
    }
  }, 30000); // Check every 30 seconds
}
```

### 3. Protocol Version Compatibility

```typescript
async function checkCompatibility() {
  const protocol = await getProtocolVersion({ network: "mainnet" });

  const MIN_REQUIRED_VERSION = 20;

  if (protocol.version < MIN_REQUIRED_VERSION) {
    console.warn(`Protocol version ${protocol.version} is outdated`);
    console.warn(`Minimum required: ${MIN_REQUIRED_VERSION}`);
  }
}
```

### 4. Custom Endpoints

```typescript
// Use custom RPC and Horizon endpoints
const status = await getNetworkStatus({
  network: "testnet",
  rpcUrl: "https://my-custom-rpc.example.com",
  horizonUrl: "https://my-custom-horizon.example.com",
});
```

## Error Handling

The API uses two error handling patterns:

1. **Graceful degradation** (for `checkNetworkHealth`):
   - Returns `isHealthy: false` with error message
   - Never throws exceptions

2. **Exception throwing** (for `checkLedgerLatency` and `getProtocolVersion`):
   - Throws errors for network failures
   - Use try-catch blocks

```typescript
// Pattern 1: Graceful degradation
const health = await checkNetworkHealth({ network: "testnet" });
if (!health.isHealthy) {
  console.error("Health check failed:", health.error);
}

// Pattern 2: Exception handling
try {
  const latency = await checkLedgerLatency({ network: "testnet" });
  console.log("Latency:", latency.timeSinceLastLedgerSec);
} catch (error) {
  console.error("Latency check failed:", error);
}
```

## Network Latency Thresholds

- **Expected ledger time**: 5 seconds
- **Normal threshold**: ≤ 15 seconds
- **Abnormal**: > 15 seconds

Stellar ledgers typically close every ~5 seconds. If the last ledger is more than 15 seconds old, the network may be experiencing issues.

## Default Endpoints

### Testnet

- RPC: `https://soroban-testnet.stellar.org`
- Horizon: `https://horizon-testnet.stellar.org`

### Mainnet

- RPC: `https://soroban-mainnet.stellar.org`
- Horizon: `https://horizon.stellar.org`

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  NetworkStatusConfig,
  NetworkHealth,
  LedgerLatency,
  ProtocolVersion,
  NetworkStatus,
} from "@chen-pilot/sdk-core";
```

## Testing

The API includes comprehensive unit tests. Run them with:

```bash
cd packages/sdk
npm test
```

## Examples

See `examples/networkStatus.example.ts` for complete usage examples including:

- Basic health checks
- Latency monitoring
- Protocol version checks
- Error handling patterns
- Network monitoring loops

## License

ISC
