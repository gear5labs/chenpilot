import logger from "../../../src/config/logger";

export interface PerformanceMetrics {
  operationName: string;
  duration: number;
  timestamp: string;
  memoryUsage?: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  metadata?: Record<string, unknown>;
}

export interface PerformanceThreshold {
  p50?: number;
  p95?: number;
  p99?: number;
  max?: number;
  mean?: number;
}

export interface PerformanceTestResult {
  testName: string;
  iterations: number;
  metrics: PerformanceMetrics[];
  statistics: {
    min: number;
    max: number;
    mean: number;
    median: number;
    p95: number;
    p99: number;
    stdDev: number;
  };
  passed: boolean;
  threshold?: PerformanceThreshold;
  violations?: string[];
}

export class PerformanceTestRunner {
  private results: PerformanceTestResult[] = [];

  /**
   * Run a performance test with multiple iterations
   */
  async runTest(
    testName: string,
    operation: () => Promise<void>,
    options: {
      iterations?: number;
      warmupIterations?: number;
      threshold?: PerformanceThreshold;
      collectMemory?: boolean;
    } = {}
  ): Promise<PerformanceTestResult> {
    const {
      iterations = 10,
      warmupIterations = 2,
      threshold,
      collectMemory = true,
    } = options;

    logger.info(`Starting performance test: ${testName}`, {
      iterations,
      warmupIterations,
    });

    // Warmup iterations
    for (let i = 0; i < warmupIterations; i++) {
      await operation();
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    // Actual test iterations
    const metrics: PerformanceMetrics[] = [];
    for (let i = 0; i < iterations; i++) {
      const startMemory = collectMemory ? process.memoryUsage() : undefined;
      const startTime = performance.now();

      await operation();

      const duration = performance.now() - startTime;
      const endMemory = collectMemory ? process.memoryUsage() : undefined;

      metrics.push({
        operationName: testName,
        duration,
        timestamp: new Date().toISOString(),
        memoryUsage: endMemory
          ? {
              heapUsed: endMemory.heapUsed - (startMemory?.heapUsed || 0),
              heapTotal: endMemory.heapTotal,
              external: endMemory.external,
            }
          : undefined,
      });

      // Small delay between iterations
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const statistics = this.calculateStatistics(metrics);
    const { passed, violations } = this.checkThresholds(statistics, threshold);

    const result: PerformanceTestResult = {
      testName,
      iterations,
      metrics,
      statistics,
      passed,
      threshold,
      violations,
    };

    this.results.push(result);
    this.logResult(result);

    return result;
  }

  /**
   * Run a single timed operation
   */
  async measureOperation<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<{ result: T; metrics: PerformanceMetrics }> {
    const startTime = performance.now();
    const startMemory = process.memoryUsage();

    const result = await operation();

    const duration = performance.now() - startTime;
    const endMemory = process.memoryUsage();

    const metrics: PerformanceMetrics = {
      operationName,
      duration,
      timestamp: new Date().toISOString(),
      memoryUsage: {
        heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        heapTotal: endMemory.heapTotal,
        external: endMemory.external,
      },
    };

    return { result, metrics };
  }

  /**
   * Calculate statistical metrics from performance data
   */
  private calculateStatistics(
    metrics: PerformanceMetrics[]
  ): PerformanceTestResult["statistics"] {
    const durations = metrics.map((m) => m.duration).sort((a, b) => a - b);
    const n = durations.length;

    const min = durations[0];
    const max = durations[n - 1];
    const mean = durations.reduce((a, b) => a + b, 0) / n;
    const median = this.percentile(durations, 50);
    const p95 = this.percentile(durations, 95);
    const p99 = this.percentile(durations, 99);

    // Calculate standard deviation
    const variance =
      durations.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    return { min, max, mean, median, p95, p99, stdDev };
  }

  /**
   * Calculate percentile value
   */
  private percentile(sortedValues: number[], percentile: number): number {
    const index = (percentile / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (lower === upper) {
      return sortedValues[lower];
    }

    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  /**
   * Check if performance meets thresholds
   */
  private checkThresholds(
    statistics: PerformanceTestResult["statistics"],
    threshold?: PerformanceThreshold
  ): { passed: boolean; violations: string[] } {
    if (!threshold) {
      return { passed: true, violations: [] };
    }

    const violations: string[] = [];

    if (threshold.mean && statistics.mean > threshold.mean) {
      violations.push(
        `Mean duration ${statistics.mean.toFixed(2)}ms exceeds threshold ${threshold.mean}ms`
      );
    }

    if (threshold.p50 && statistics.median > threshold.p50) {
      violations.push(
        `P50 duration ${statistics.median.toFixed(2)}ms exceeds threshold ${threshold.p50}ms`
      );
    }

    if (threshold.p95 && statistics.p95 > threshold.p95) {
      violations.push(
        `P95 duration ${statistics.p95.toFixed(2)}ms exceeds threshold ${threshold.p95}ms`
      );
    }

    if (threshold.p99 && statistics.p99 > threshold.p99) {
      violations.push(
        `P99 duration ${statistics.p99.toFixed(2)}ms exceeds threshold ${threshold.p99}ms`
      );
    }

    if (threshold.max && statistics.max > threshold.max) {
      violations.push(
        `Max duration ${statistics.max.toFixed(2)}ms exceeds threshold ${threshold.max}ms`
      );
    }

    return { passed: violations.length === 0, violations };
  }

  /**
   * Log test result
   */
  private logResult(result: PerformanceTestResult): void {
    const { testName, statistics, passed, violations } = result;

    logger.info(`Performance test completed: ${testName}`, {
      passed,
      statistics: {
        mean: `${statistics.mean.toFixed(2)}ms`,
        median: `${statistics.median.toFixed(2)}ms`,
        p95: `${statistics.p95.toFixed(2)}ms`,
        p99: `${statistics.p99.toFixed(2)}ms`,
        min: `${statistics.min.toFixed(2)}ms`,
        max: `${statistics.max.toFixed(2)}ms`,
      },
    });

    if (!passed && violations) {
      logger.warn(`Performance threshold violations for ${testName}:`, {
        violations,
      });
    }
  }

  /**
   * Get all test results
   */
  getResults(): PerformanceTestResult[] {
    return this.results;
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const lines: string[] = [
      "=".repeat(80),
      "PERFORMANCE TEST REPORT",
      "=".repeat(80),
      "",
    ];

    for (const result of this.results) {
      lines.push(`Test: ${result.testName}`);
      lines.push(`Iterations: ${result.iterations}`);
      lines.push(`Status: ${result.passed ? "✓ PASSED" : "✗ FAILED"}`);
      lines.push("");
      lines.push("Statistics:");
      lines.push(`  Mean:   ${result.statistics.mean.toFixed(2)}ms`);
      lines.push(`  Median: ${result.statistics.median.toFixed(2)}ms`);
      lines.push(`  P95:    ${result.statistics.p95.toFixed(2)}ms`);
      lines.push(`  P99:    ${result.statistics.p99.toFixed(2)}ms`);
      lines.push(`  Min:    ${result.statistics.min.toFixed(2)}ms`);
      lines.push(`  Max:    ${result.statistics.max.toFixed(2)}ms`);
      lines.push(`  StdDev: ${result.statistics.stdDev.toFixed(2)}ms`);

      if (result.violations && result.violations.length > 0) {
        lines.push("");
        lines.push("Violations:");
        result.violations.forEach((v) => lines.push(`  - ${v}`));
      }

      lines.push("");
      lines.push("-".repeat(80));
      lines.push("");
    }

    const totalTests = this.results.length;
    const passedTests = this.results.filter((r) => r.passed).length;
    const failedTests = totalTests - passedTests;

    lines.push("Summary:");
    lines.push(`  Total Tests:  ${totalTests}`);
    lines.push(`  Passed:       ${passedTests}`);
    lines.push(`  Failed:       ${failedTests}`);
    lines.push(
      `  Pass Rate:    ${((passedTests / totalTests) * 100).toFixed(1)}%`
    );
    lines.push("");
    lines.push("=".repeat(80));

    return lines.join("\n");
  }

  /**
   * Clear all results
   */
  clear(): void {
    this.results = [];
  }
}

export const performanceTestRunner = new PerformanceTestRunner();
