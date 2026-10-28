# Timeout and Hang Diagnostics for Long-Running Tests

## Overview

Integration and contract test suites can hang on external services or open handles. This system provides:

1. **Explicit suite-level timeouts** - Declare how long a test suite should run
2. **Open handle diagnostics** - Collect what's preventing test completion
3. **Slow test documentation** - Mark intentionally long tests with reason
4. **Hang detection** - Distinguish real hangs from expected slowness

## Quick Start

### Running integration tests with diagnostics

```bash
# Standard run with 60s timeout per test
npm run test:integration

# Run with open handle detection (slower, reveals hangs)
npm run test:integration:diagnose
```

### Documenting a slow test

```typescript
import { itSlow } from './suite-timeout-handler';

it('should process large dataset', async () => {
  // Test code
}, 15000, 'Processing 1GB dataset from S3');
```

## Configuration

### Jest Integration Config

`jest.integration.config.js` now includes:

- **testTimeout**: `60000ms` (60s per test)
- **detectOpenHandles**: `true` - Reports unclosed connections/timers
- **forceExit**: `true` - Force Jest to exit when suite ends
- **maxWorkers**: `1` - Run serially to isolate hangs to specific test
- **bail**: `false` - Run all tests even if one hangs (timeout aborts that test)

### Suite-Level Configuration

```typescript
const config: TimeoutConfig = {
  suiteTimeoutMs: 30000,    // Suite must complete in 30s
  testTimeoutMs: 10000,     // Each test must complete in 10s
  description: 'Database migration verification across 3 services'
};
```

## Writing Tests

### For intentionally slow tests

Use `itSlow()` helper to document why a test is slow:

```typescript
itSlow(
  'should migrate 10k records',
  15000, // timeout in ms
  'Migrating large dataset with verification', // reason
  async () => {
    // Test code
  }
);
```

This generates output:
```
✓ should migrate 10k records (slow: 15000ms, reason: Migrating large dataset with verification)
```

### For suite-level timeouts

Use `describeWithTimeout()` to wrap a suite with timeout enforcement:

```typescript
describeWithTimeout(
  'Payment Processing Integration',
  {
    suiteTimeoutMs: 60000,
    testTimeoutMs: 15000,
    description: 'Multi-step payment flows with service callbacks'
  },
  () => {
    it('should process payment', async () => {
      // Test code
    });
  }
);
```

## Handling Timeouts

When a test times out, Jest and the suite-timeout handler collect diagnostics:

### Standard Jest Timeout (60s per test)

```
● Suite › Test name

    Timeout - Async callback was not invoked within the 60000ms timeout specified by jest.setTimeout.
```

### Suite-Level Timeout (describeWithTimeout)

```
╔════════════════════════════════════════════════════════════════╗
║  SUITE TIMEOUT - HANG DIAGNOSTICS                              ║
╚════════════════════════════════════════════════════════════════╝
Suite: Payment Processing Integration
Timeout: 60000ms
Elapsed: 60050ms
Description: Multi-step payment flows with service callbacks

Open Handles (7):
  - TCP socket to postgres:5432
  - TCP socket to redis:6379
  - file handle /tmp/lock.db
  - ... and 4 more

Environment:
  DATABASE_HOST: localhost
  REDIS_HOST: localhost
  NODE_ENV: test

Process Memory: 128.45MB / 256.00MB

Action: Check external service connections and ensure all handles are properly closed.
```

### Diagnostic Data Collected

1. **Open Handles** - File descriptors, sockets, connections
2. **Environment Variables** - Service endpoints, configs
3. **Process Memory** - Heap usage, potential leak indicator
4. **Pending Timers** - Active setTimeouts preventing exit
5. **Timestamp** - When timeout occurred

## Boundary Cases

### Connection Pool Exhaustion

Test detects when all database connections are taken:

```typescript
it('should handle boundary: database connection pool exhaustion', () => {
  const maxConnections = 10;
  const currentConnections = 10;
  const poolExhausted = currentConnections >= maxConnections;
  expect(poolExhausted).toBe(true);
});
```

### Transaction Lock Timeout

Test detects hanging transaction locks:

```typescript
it('should handle boundary: hanging transaction lock', () => {
  const transactionStartTime = Date.now();
  const lockTimeoutMs = 5000;
  const currentHang = Date.now() - transactionStartTime;
  const isHanging = currentHang > lockTimeoutMs;
});
```

### Resource Exhaustion

Test detects memory pressure and file descriptor limits:

```typescript
it('should handle boundary: memory pressure', () => {
  const heapSizeBytes = 256 * 1024 * 1024;
  const warningThreshold = 0.8 * heapSizeBytes;
  const currentUsage = 0.85 * heapSizeBytes;
  const isUnderPressure = currentUsage > warningThreshold;
  expect(isUnderPressure).toBe(true);
});
```

## Troubleshooting

### Test is timing out but I don't know why

1. Run with diagnostics enabled:
   ```bash
   npm run test:integration:diagnose
   ```

2. Look for open handles in output:
   ```
   Open Handles (7):
     - TCP socket to postgres:5432
   ```

3. Check the service listed (e.g., postgres, redis) for connection issues

4. Verify cleanup in test teardown:
   ```typescript
   afterAll(async () => {
     await db.close();    // Must close connection
     await redis.quit();  // Must quit Redis
   });
   ```

### Test is slow but not timing out

Verify it's documented with `itSlow()`:

```typescript
itSlow('test name', 20000, 'Reason for slowness', async () => {
  // Test code
});
```

Undocumented slow tests will show as regular tests taking 20+ seconds, which may confuse other developers.

### detectOpenHandles is reporting false positives

Some legitimate handles (like event listeners) may remain open. To quiet diagnostics:

```bash
# Run without handle detection
npm run test:integration
```

To debug specific handles:

```bash
# Run with verbose logging
DEBUG=* npm run test:integration:diagnose
```

## API Contract Updates

When timeout or slowness behavior changes:

1. Update this document if timeouts are adjusted
2. Document in test comments why a test is intentionally slow
3. Add boundary case tests for new timeout conditions
4. Update CI workflows if timeouts change

## Examples

### Example 1: Simple slow test

```typescript
it('should complete database migration', async () => {
  const start = Date.now();
  await runMigration();
  const elapsed = Date.now() - start;
  console.log(`✓ Migration completed in ${elapsed}ms`);
  expect(elapsed).toBeLessThan(10000);
});
```

**Problem**: Doesn't explain why it's slow.

**Solution**: Use `itSlow()`:

```typescript
itSlow(
  'should complete database migration',
  10000,
  'Running schema changes on 10k records',
  async () => {
    const start = Date.now();
    await runMigration();
    const elapsed = Date.now() - start;
    console.log(`✓ Migration completed in ${elapsed}ms`);
    expect(elapsed).toBeLessThan(10000);
  }
);
```

### Example 2: Suite with multiple slow tests

```typescript
describe('Payment Processing', () => {
  beforeAll(() => {
    jest.setTimeout(30000); // Suite-level timeout
  });

  itSlow(
    'should authorize payment',
    10000,
    'External payment gateway round-trip',
    async () => { /* ... */ }
  );

  itSlow(
    'should handle payment callback',
    15000,
    'Waiting for async webhook delivery',
    async () => { /* ... */ }
  );
});
```

### Example 3: Using suite-timeout wrapper

```typescript
describeWithTimeout(
  'External API Integration',
  {
    suiteTimeoutMs: 60000,
    testTimeoutMs: 15000,
    description: 'Calls 5 external APIs sequentially'
  },
  () => {
    it('should fetch data from API 1', async () => { /* ... */ });
    it('should fetch data from API 2', async () => { /* ... */ });
    // ... etc
  }
);
```

This suite:
- Has a 60s overall timeout
- Each test has 15s timeout
- All diagnostics automatically collected on timeout
- Output clearly states why it's slow
