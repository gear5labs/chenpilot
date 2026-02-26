# SDK Testing Guide

Quick reference for running and writing tests for the Chen Pilot SDK.

## Quick Start

```bash
# Run all SDK tests
npx jest --config packages/sdk/jest.config.js

# Run with coverage
npx jest --config packages/sdk/jest.config.js --coverage

# Watch mode (auto-rerun on changes)
npx jest --config packages/sdk/jest.config.js --watch

# Run specific test file
npx jest --config packages/sdk/jest.config.js sorobanRpc.test.ts
```

## Test Structure

```
packages/sdk/src/__tests__/
├── sorobanRpc.test.ts          # Soroban RPC client tests
├── recovery.test.ts             # Recovery engine tests
├── planVerification.test.ts     # Plan verification tests
├── mocks/
│   └── rpcResponses.ts         # Mock RPC data
└── README.md                    # Detailed test documentation
```

## Writing New Tests

### 1. Create Test File

```typescript
// packages/sdk/src/__tests__/myFeature.test.ts
import { MyFeature } from "../myFeature";

describe("MyFeature", () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  it("should do something", () => {
    // Arrange
    const feature = new MyFeature();

    // Act
    const result = feature.doSomething();

    // Assert
    expect(result).toBe(expected);
  });
});
```

### 2. Use Mocks

```typescript
// Mock external dependencies
jest.mock("../externalService");

// Use mock data
import { mockLedgerResponse } from "./mocks/rpcResponses";

it("should handle ledger data", () => {
  const result = processLedger(mockLedgerResponse);
  expect(result).toBeDefined();
});
```

### 3. Test Async Code

```typescript
it("should handle async operations", async () => {
  const result = await asyncFunction();
  expect(result).toBe(expected);
});
```

### 4. Use Fake Timers

```typescript
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it("should handle timeouts", () => {
  const callback = jest.fn();
  setTimeout(callback, 1000);

  jest.advanceTimersByTime(1000);
  expect(callback).toHaveBeenCalled();
});
```

## Common Test Patterns

### Testing Event Subscriptions

```typescript
it("should subscribe to events", async () => {
  const subscription = new SorobanEventSubscription(config);
  const handler = jest.fn();

  subscription.on("event", handler);
  await subscription.subscribe();

  expect(subscription.isActive()).toBe(true);

  await subscription.unsubscribe();
});
```

### Testing Error Handling

```typescript
it("should handle errors gracefully", async () => {
  mockHandler.mockRejectedValue(new Error("Test error"));

  const result = await engine.cleanup(context);

  expect(result.success).toBe(false);
  expect(result.message).toContain("error");
});
```

### Testing with Mock Data

```typescript
import { generateMockLedger } from "./mocks/rpcResponses";

it("should process ledger data", () => {
  const ledger = generateMockLedger(1000000);
  const result = processLedger(ledger);

  expect(result.sequence).toBe(1000000);
});
```

## Coverage Goals

- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 85%
- **Lines**: > 80%

## Viewing Coverage

```bash
# Generate coverage report
npx jest --config packages/sdk/jest.config.js --coverage

# Open HTML report
# packages/sdk/coverage/lcov-report/index.html
```

## Debugging Tests

### Run Single Test

```bash
npx jest --config packages/sdk/jest.config.js -t "test name"
```

### Verbose Output

```bash
npx jest --config packages/sdk/jest.config.js --verbose
```

### Debug in VS Code

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest SDK Tests",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--config", "packages/sdk/jest.config.js", "--runInBand"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

## Best Practices

### ✅ Do

- Write descriptive test names
- Test one thing per test
- Use arrange-act-assert pattern
- Clean up resources in `afterEach`
- Mock external dependencies
- Test edge cases and errors
- Keep tests fast and isolated

### ❌ Don't

- Test implementation details
- Share state between tests
- Use real network calls
- Ignore failing tests
- Write tests that depend on execution order
- Leave console.log statements

## Common Issues

### Tests Timing Out

```typescript
// Increase timeout for specific test
it("slow test", async () => {
  // test code
}, 30000); // 30 second timeout
```

### Mock Not Working

```typescript
// Clear mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});
```

### Async Issues

```typescript
// Always await async operations
await subscription.subscribe();
await subscription.unsubscribe();

// Or return promises
return expect(asyncFunction()).resolves.toBe(value);
```

## CI/CD Integration

Tests run automatically on:

- Pull requests
- Commits to main
- Pre-commit hooks (via Husky)

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Best Practices](https://testingjavascript.com/)
- [SDK Test README](./src/__tests__/README.md)
- [Mock RPC Responses](./src/__tests__/mocks/rpcResponses.ts)

## Getting Help

- Check test output for error messages
- Review existing tests for patterns
- Read the detailed [Test README](./src/__tests__/README.md)
- Ask in team chat or code review

## Quick Reference

```bash
# Run tests
npm test

# Coverage
npm run test:coverage

# Watch mode
npm run test:watch

# Specific file
npm test -- sorobanRpc.test.ts

# Specific test
npm test -- -t "test name"

# Update snapshots
npm test -- -u

# Clear cache
npm test -- --clearCache
```
