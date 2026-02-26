# Add Network Status Checks to SDK

## Description

Implements Issue #175: Adds a simple API to the SDK for checking Stellar network health, ledger latency, and protocol version.

## Changes

### New Features

- **`checkNetworkHealth(config)`** - Verifies network reachability and response time
- **`checkLedgerLatency(config)`** - Monitors ledger close times and detects abnormal delays
- **`getProtocolVersion(config)`** - Retrieves current protocol version and core information
- **`getNetworkStatus(config)`** - Comprehensive status check combining all three functions

### Key Capabilities

- ✅ Support for both testnet and mainnet
- ✅ Custom RPC and Horizon URL configuration
- ✅ Comprehensive error handling (graceful degradation + exceptions)
- ✅ Zero additional dependencies (uses native fetch API)
- ✅ Full TypeScript support with exported types
- ✅ Latency detection with configurable thresholds (5s expected, 15s abnormal)

## Testing

### Test Coverage

- **17 new test cases** covering all functions
- Tests for success scenarios, error handling, and edge cases
- All tests pass: `103 passed, 103 total` (SDK-wide)
- Build successful with no TypeScript errors

### Test Categories

- Network health checks (success, HTTP errors, RPC errors, network failures)
- Latency monitoring (normal, abnormal, errors)
- Protocol version retrieval (success, custom URLs, errors)
- Complete status checks (success, partial failures, mainnet)

## Documentation

### Comprehensive Documentation Provided

1. **`NETWORK_STATUS.md`** - Complete API reference with examples
2. **`NETWORK_STATUS_QUICK_REFERENCE.md`** - Quick reference guide
3. **`examples/networkStatus.example.ts`** - 7 working examples
4. **`README.md`** - SDK overview with network status section
5. **`ISSUE_175_IMPLEMENTATION.md`** - Detailed implementation summary

## Usage Example

```typescript
import { getNetworkStatus } from "@chen-pilot/sdk-core";

// Get complete network status
const status = await getNetworkStatus({ network: "testnet" });

console.log("Network healthy:", status.health.isHealthy);
console.log("Latest ledger:", status.health.latestLedger);
console.log("Response time:", status.health.responseTimeMs, "ms");
console.log("Latency normal:", status.latency.isNormal);
console.log("Protocol version:", status.protocol.version);
```

## Use Cases

1. **Pre-transaction validation** - Check network health before submitting transactions
2. **Network monitoring** - Continuous monitoring of network status
3. **Protocol compatibility** - Verify protocol version compatibility
4. **Latency detection** - Detect and alert on abnormal network delays
5. **Custom endpoints** - Support for private/custom RPC and Horizon servers

## Files Changed

### New Files

- `packages/sdk/src/networkStatus.ts` - Core implementation
- `packages/sdk/src/__tests__/networkStatus.test.ts` - Test suite
- `packages/sdk/NETWORK_STATUS.md` - API documentation
- `packages/sdk/NETWORK_STATUS_QUICK_REFERENCE.md` - Quick reference
- `packages/sdk/examples/networkStatus.example.ts` - Usage examples
- `packages/sdk/README.md` - SDK overview
- `ISSUE_175_IMPLEMENTATION.md` - Implementation summary

### Modified Files

- `packages/sdk/src/index.ts` - Added exports
- `packages/sdk/src/types/index.ts` - Added type definitions
- `packages/sdk/jest.config.js` - Fixed tsconfig path

## Breaking Changes

None. This is a purely additive change.

## Checklist

- [x] Code follows project style guidelines
- [x] Tests added and passing (17 new tests)
- [x] Documentation complete
- [x] Build successful
- [x] No TypeScript errors
- [x] Zero additional dependencies
- [x] Backward compatible

## Related Issues

Closes #175

## Priority

Low (as specified in the issue)
