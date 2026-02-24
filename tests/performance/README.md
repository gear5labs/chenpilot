# Performance Regression Testing Suite

This directory contains automated performance regression tests for the agent planning and execution flows to ensure performance stability across code changes.

## Overview

The performance test suite measures response times and resource usage for critical agent operations:

- **Agent Planning Flow**: Plan creation, validation, and optimization
- **Agent Execution Flow**: Single-step and multi-step plan execution
- **Tool Execution**: Individual tool performance
- **End-to-End Workflows**: Complete user request flows

## Directory Structure

```
tests/performance/
├── README.md                           # This file
├── utils/
│   └── PerformanceTestRunner.ts       # Core performance testing infrastructure
├── config/
│   └── performanceBaselines.ts        # Performance thresholds and baselines
├── agentPlanning.perf.test.ts         # Agent planning performance tests
└── agentExecution.perf.test.ts        # Agent execution performance tests
```

## Running Performance Tests

### Run All Performance Tests

```bash
npm run test:performance
```

### Run Specific Performance Test Suite

```bash
# Agent planning tests
npm test -- tests/performance/agentPlanning.perf.test.ts

# Agent execution tests
npm test -- tests/performance/agentExecution.perf.test.ts
```

### Run with Garbage Collection (Recommended)

For more accurate memory measurements:

```bash
node --expose-gc node_modules/.bin/jest tests/performance
```

## Performance Baselines

Performance thresholds are defined in `config/performanceBaselines.ts`:

### Agent Planning

| Operation | Mean | P95 | P99 | Max |
|-----------|------|-----|-----|-----|
| Simple Plan | 500ms | 800ms | 1000ms | 1500ms |
| Complex Plan | 1500ms | 2500ms | 3000ms | 4000ms |
| With LLM | 3000ms | 5000ms | 6000ms | 8000ms |

### Agent Execution

| Operation | Mean | P95 | P99 | Max |
|-----------|------|-----|-----|-----|
| Single Step | 300ms | 500ms | 700ms | 1000ms |
| Multi-Step | 1000ms | 1500ms | 2000ms | 3000ms |
| With Tools | 2000ms | 3500ms | 4500ms | 6000ms |

### Tool Execution

| Operation | Mean | P95 | P99 | Max |
|-----------|------|-----|-----|-----|
| Lightweight | 100ms | 200ms | 300ms | 500ms |
| Standard | 500ms | 800ms | 1000ms | 1500ms |
| Heavy | 2000ms | 3000ms | 4000ms | 5000ms |

## Test Configuration

Default test configuration in `config/performanceBaselines.ts`:

```typescript
{
  defaultIterations: 10,        // Number of test iterations
  warmupIterations: 2,          // Warmup runs before measurement
  delayBetweenTests: 500,       // Delay between tests (ms)
  collectMemoryMetrics: true,   // Collect memory usage data
  enableGarbageCollection: true // Force GC between tests
}
```

## Understanding Test Results

### Statistical Metrics

Each test reports the following metrics:

- **Mean**: Average execution time
- **Median (P50)**: 50th percentile
- **P95**: 95th percentile (95% of requests faster than this)
- **P99**: 99th percentile (99% of requests faster than this)
- **Min**: Fastest execution time
- **Max**: Slowest execution time
- **StdDev**: Standard deviation (consistency measure)

### Test Output Example

```
================================================================================
PERFORMANCE TEST REPORT
================================================================================

Test: Simple Plan Creation
Iterations: 10
Status: ✓ PASSED

Statistics:
  Mean:   425.32ms
  Median: 418.50ms
  P95:    512.75ms
  P99:    545.20ms
  Min:    385.10ms
  Max:    558.90ms
  StdDev: 45.23ms

--------------------------------------------------------------------------------

Summary:
  Total Tests:  15
  Passed:       14
  Failed:       1
  Pass Rate:    93.3%

================================================================================
```

## Writing New Performance Tests

### Basic Structure

```typescript
import { performanceTestRunner } from "./utils/PerformanceTestRunner";
import { PERFORMANCE_BASELINES } from "./config/performanceBaselines";

describe("My Performance Tests", () => {
  beforeAll(() => {
    performanceTestRunner.clear();
  });

  afterAll(() => {
    const report = performanceTestRunner.generateReport();
    console.log("\n" + report);
  });

  it("should perform operation within threshold", async () => {
    const result = await performanceTestRunner.runTest(
      "My Operation",
      async () => {
        // Your operation to test
        await myOperation();
      },
      {
        iterations: 10,
        warmupIterations: 2,
        threshold: {
          mean: 500,
          p95: 800,
          max: 1000,
        },
      }
    );

    expect(result.passed).toBe(true);
  });
});
```

### Measuring Single Operations

```typescript
const { result, metrics } = await performanceTestRunner.measureOperation(
  "Single Operation",
  async () => {
    return await myOperation();
  }
);

console.log(`Operation took ${metrics.duration}ms`);
```

## Performance Regression Detection

### Regression Tolerance

Tests fail if performance degrades beyond these thresholds:

- **Mean**: 10% slower than baseline
- **P95**: 15% slower than baseline
- **P99**: 20% slower than baseline

### Updating Baselines

When legitimate performance improvements are made:

1. Run performance tests to get new metrics
2. Update thresholds in `config/performanceBaselines.ts`
3. Document the change in commit message
4. Include before/after metrics in PR description

## Best Practices

### Test Design

1. **Isolation**: Mock external dependencies (LLM, database, network)
2. **Warmup**: Always include warmup iterations to eliminate JIT compilation effects
3. **Iterations**: Use sufficient iterations (10+) for statistical significance
4. **Consistency**: Run tests in consistent environment (same machine, no background load)

### Interpreting Results

1. **Focus on P95/P99**: These represent user experience better than mean
2. **Watch StdDev**: High standard deviation indicates inconsistent performance
3. **Memory Leaks**: Monitor memory usage across iterations
4. **Concurrent Tests**: Test concurrent operations to identify contention issues

### CI/CD Integration

Performance tests should run:

- On every PR (with failure threshold)
- Nightly (with detailed reporting)
- Before releases (with strict thresholds)

## Troubleshooting

### Tests Failing Intermittently

- Increase warmup iterations
- Check for background processes
- Ensure consistent test environment
- Increase regression tolerance if appropriate

### High Memory Usage

- Check for memory leaks in test code
- Ensure proper cleanup in `afterEach`/`afterAll`
- Use `global.gc()` to force garbage collection
- Monitor heap snapshots for large objects

### Slow Test Execution

- Reduce number of iterations for development
- Use focused tests (`it.only`) during debugging
- Mock expensive operations
- Run tests in parallel when possible

## Metrics Collection

### Memory Metrics

Each test collects:

- **Heap Used**: Memory actively used
- **Heap Total**: Total heap size
- **External**: Memory used by C++ objects
- **Memory Delta**: Change during operation

### Custom Metrics

Add custom metrics to test results:

```typescript
const result = await performanceTestRunner.runTest(
  "Custom Metrics Test",
  async () => {
    // Your operation
  },
  {
    iterations: 10,
    threshold: myThreshold,
  }
);

// Access metrics
result.metrics.forEach(m => {
  console.log(`Duration: ${m.duration}ms`);
  console.log(`Memory: ${m.memoryUsage?.heapUsed}bytes`);
});
```

## Continuous Monitoring

### Performance Dashboard

Consider integrating with monitoring tools:

- **Grafana**: Visualize performance trends
- **DataDog**: Track performance metrics over time
- **New Relic**: Monitor production performance

### Alerting

Set up alerts for:

- Performance regression beyond threshold
- Memory usage spikes
- Increased error rates
- Timeout occurrences

## Contributing

When adding new performance tests:

1. Follow existing test structure
2. Add appropriate baselines to `performanceBaselines.ts`
3. Document test purpose and expectations
4. Include both happy path and edge cases
5. Test concurrent scenarios when relevant

## References

- [Jest Performance Testing](https://jestjs.io/docs/timer-mocks)
- [Node.js Performance Hooks](https://nodejs.org/api/perf_hooks.html)
- [Performance Testing Best Practices](https://martinfowler.com/articles/practical-test-pyramid.html)

## Support

For questions or issues with performance tests:

- Check existing test examples
- Review performance baseline documentation
- Consult with the team on performance expectations
- Open an issue with detailed metrics and environment info
