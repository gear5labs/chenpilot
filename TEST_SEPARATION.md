# Test Separation: Unit and Integration Tests

## Overview

This project separates unit tests from service-backed integration tests with explicit CI job definitions, prerequisite declarations, and visible skip reporting.

## Test Categories

### Unit Tests
- **Location**: `tests/unit/**/*.test.ts`
- **Prerequisites**: None (no external services)
- **Config**: `jest.unit.config.js`
- **Run**: `npm run test:unit`
- **CI**: `test-separation.yml` job: `unit-tests`

### Integration Tests
- **Location**: `tests/integration/**/*.integration.test.ts`
- **Prerequisites**: 
  - PostgreSQL 15 (required)
  - Redis 7 (required)
- **Config**: `jest.integration.config.js`
- **Run**: `npm run test:integration`
- **CI**: `test-separation.yml` job: `integration-tests`

## CI Workflows

### Primary: test-separation.yml
Defines explicit jobs for unit and integration tests:

1. **unit-tests job**
   - Runs on every push and PR
   - No service prerequisites
   - Fast execution (unit tests only)

2. **integration-tests job**
   - Runs on every push and PR
   - Requires PostgreSQL 15 and Redis 7 services
   - Longer timeout (60s vs 30s for units)

3. **test-summary job**
   - Runs after both unit and integration tests
   - Reports skipped tests visibly (not as passing)
   - Declares prerequisites met

### Updated: release-gates.yml
Backend health check updated to use separated test commands:
- `npm run test:unit` for unit tests
- `npm run test:integration` for integration tests
- Explicit environment variable declarations
- Status reporting for each category

## Skipped Test Visibility

Skipped integration tests are reported in CI output instead of being silently hidden:

```
⏭️ Skipping integration tests - PostgreSQL and Redis services required
```

This prevents the misleading "all tests passed" when integration tests are actually not running.

### Example: test_separation.integration.test.ts

The test file demonstrates:
- Unit tests that don't require services
- Service-backed tests that skip if prerequisites unavailable
- Boundary case testing (timeout, rate limits, error conditions)
- Explicit failure and recovery scenarios

## Running Tests Locally

### Unit tests only (fast)
```bash
npm run test:unit
```

### Integration tests (requires services)
```bash
# Start services (Docker)
docker-compose up -d postgres redis

# Run tests
npm run test:integration

# Stop services
docker-compose down
```

### All tests
```bash
npm test
```

## Adding New Tests

### Unit Test
Create `tests/unit/myfeature.test.ts`:
```typescript
describe('MyFeature', () => {
  it('should do something', () => {
    expect(result).toBe(expected);
  });
});
```

Runs automatically with `npm run test:unit`.

### Integration Test
Create `tests/integration/myfeature.integration.test.ts`:
```typescript
describe('MyFeature Integration', () => {
  beforeAll(function() {
    if (!process.env.DATABASE_HOST) {
      this.skip();
    }
  });

  it('should connect to database', async () => {
    // Test code
  });
});
```

Runs automatically with `npm run test:integration`.

## API Contract Updates

When externally observable behavior changes:

1. Update this document if test categories or prerequisites change
2. Update workflow definitions if service requirements change
3. Add skipped test coverage for boundary cases
4. Document failure modes in comments

## Monitoring

### CI Status
- `test-separation.yml` shows explicit pass/skip/fail for each test category
- `release-gates.yml` reports test separation status at end of backend health check
- Artifacts uploaded for both test types (available in Actions tab)

### Local Verification
```bash
# Check test counts
npm run test:unit -- --verbose
npm run test:integration -- --verbose

# Check skipped test visibility
npm run test:integration -- --verbose 2>&1 | grep -i "skip"
```

## Troubleshooting

### Integration tests report "skipped"
- Verify `DATABASE_HOST` is set
- Verify `REDIS_HOST` is set
- Check service health: `docker-compose logs`

### Wrong tests running
- Verify filename: `*.test.ts` for unit, `*.integration.test.ts` for integration
- Verify config being used: `jest.unit.config.js` vs `jest.integration.config.js`

### Artifacts missing
- Check GitHub Actions "Artifacts" tab in workflow run
- Artifacts retained for 30 days
