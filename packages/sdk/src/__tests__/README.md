# SDK Test Suite

Comprehensive unit tests for the Chen Pilot SDK, focusing on the internal Soroban RPC client and core functionality.

## Test Coverage

### 1. Soroban RPC Client (`sorobanRpc.test.ts`)

Tests for the internal Soroban RPC client that handles ledger lookups and event subscriptions.

**Coverage:**

- RPC configuration (testnet/mainnet URLs, custom RPC endpoints)
- Event subscription lifecycle (subscribe, unsubscribe, polling)
- Ledger tracking and sequence management
- Event handler registration and removal
- Contract ID validation
- Topic filtering
- Polling interval configuration
- Start ledger configuration

**Key Test Scenarios:**

- Network configuration validation
- Subscription activation/deactivation
- Multiple contract ID support
- Event handler chaining
- Error handling

### 2. Recovery Engine (`recovery.test.ts`)

Tests for the cross-chain recovery and cleanup mechanisms.

**Coverage:**

- Retry logic with configurable attempts
- Refund handling after retry exhaustion
- Manual intervention fallback
- Error handling in retry/refund handlers
- Context preservation across recovery attempts

**Key Test Scenarios:**

- Successful retry on various attempts (1st, 2nd, last)
- Retry failure leading to refund
- Refund success and failure
- Handler error handling
- Manual intervention requirements

### 3. Plan Verification (`planVerification.test.ts`)

Tests for execution plan integrity verification and tampering detection.

**Coverage:**

- Hash computation and validation
- Signature verification (RSA-SHA256)
- Strict mode validations
- Plan comparison and diff detection
- Hash determinism

**Key Test Scenarios:**

- Valid/invalid hash detection
- Signature verification with RSA keys
- Duplicate step detection
- Missing step detection
- Suspicious pattern detection
- Plan modification detection

### 4. Event Parsing (`sorobanRpc.test.ts`)

Tests for parsing raw RPC events into structured format.

**Coverage:**

- String and non-string topic parsing
- Various data types (objects, strings, numbers, arrays)
- Metadata preservation (transaction hash, ledger, timestamp)
- Edge cases (null values, complex nested data)

## Mock Data

### RPC Response Mocks (`mocks/rpcResponses.ts`)

Provides realistic mock data for testing RPC interactions:

- **Ledger responses**: Success, empty, sequential
- **Transaction responses**: Transfer, mint, burn, multi-event
- **Event data**: Simple and complex structures
- **Error responses**: RPC errors, network errors, timeouts
- **Mock RPC client**: In-memory client for testing

**Mock Generators:**

- `generateMockLedger(sequence)`: Create ledger at specific sequence
- `generateMockTransaction(ledger, contractId, topic)`: Create transaction with event
- `MockRpcClient`: Full mock RPC client with ledger/transaction storage

## Running Tests

```bash
# Run all SDK tests
cd packages/sdk
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run specific test file
npm test -- sorobanRpc.test.ts
```

## Test Structure

Each test file follows this structure:

```typescript
describe("Component", () => {
  beforeEach(() => {
    // Setup mocks and test data
  });

  afterEach(() => {
    // Cleanup
  });

  describe("Feature", () => {
    it("should behave correctly", () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

## Coverage Goals

- **Line Coverage**: > 80%
- **Branch Coverage**: > 75%
- **Function Coverage**: > 85%

## Adding New Tests

When adding new functionality to the SDK:

1. Create test file in `__tests__/` directory
2. Add mock data to `mocks/` if needed
3. Follow existing test patterns
4. Ensure all edge cases are covered
5. Update this README with new test coverage

## Mock Best Practices

- Use realistic data that matches production formats
- Create reusable mock generators for common patterns
- Mock external dependencies (fetch, crypto for non-deterministic operations)
- Use fake timers for time-dependent tests
- Clean up mocks in `afterEach` hooks

## Continuous Integration

Tests run automatically on:

- Pull requests
- Commits to main branch
- Pre-commit hooks (via Husky)

## Troubleshooting

**Tests timing out:**

- Check for unresolved promises
- Ensure subscriptions are properly unsubscribed
- Verify fake timers are advanced correctly

**Mock data issues:**

- Verify mock data structure matches actual RPC responses
- Check that mock functions are properly reset in `beforeEach`

**Coverage gaps:**

- Run `npm run test:coverage` to identify untested code
- Focus on edge cases and error paths
