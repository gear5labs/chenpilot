import { PerformanceThreshold } from "../utils/PerformanceTestRunner";

/**
 * Performance baseline thresholds for agent operations
 * All values are in milliseconds
 */
export const PERFORMANCE_BASELINES = {
  // Agent Planning Flow
  agentPlanning: {
    simple: {
      mean: 500,
      p95: 800,
      p99: 1000,
      max: 1500,
    } as PerformanceThreshold,
    complex: {
      mean: 1500,
      p95: 2500,
      p99: 3000,
      max: 4000,
    } as PerformanceThreshold,
    withLLM: {
      mean: 3000,
      p95: 5000,
      p99: 6000,
      max: 8000,
    } as PerformanceThreshold,
  },

  // Agent Execution Flow
  agentExecution: {
    singleStep: {
      mean: 300,
      p95: 500,
      p99: 700,
      max: 1000,
    } as PerformanceThreshold,
    multiStep: {
      mean: 1000,
      p95: 1500,
      p99: 2000,
      max: 3000,
    } as PerformanceThreshold,
    withToolExecution: {
      mean: 2000,
      p95: 3500,
      p99: 4500,
      max: 6000,
    } as PerformanceThreshold,
  },

  // Tool Execution
  toolExecution: {
    lightweight: {
      mean: 100,
      p95: 200,
      p99: 300,
      max: 500,
    } as PerformanceThreshold,
    standard: {
      mean: 500,
      p95: 800,
      p99: 1000,
      max: 1500,
    } as PerformanceThreshold,
    heavy: {
      mean: 2000,
      p95: 3000,
      p99: 4000,
      max: 5000,
    } as PerformanceThreshold,
  },

  // LLM Operations
  llmOperations: {
    simple: {
      mean: 2000,
      p95: 3500,
      p99: 4500,
      max: 6000,
    } as PerformanceThreshold,
    complex: {
      mean: 4000,
      p95: 6000,
      p99: 7500,
      max: 10000,
    } as PerformanceThreshold,
  },

  // End-to-End Workflows
  endToEnd: {
    simpleWorkflow: {
      mean: 3000,
      p95: 5000,
      p99: 6500,
      max: 8000,
    } as PerformanceThreshold,
    complexWorkflow: {
      mean: 8000,
      p95: 12000,
      p99: 15000,
      max: 20000,
    } as PerformanceThreshold,
  },
};

/**
 * Performance test configuration
 */
export const PERFORMANCE_TEST_CONFIG = {
  defaultIterations: 10,
  warmupIterations: 2,
  delayBetweenTests: 500, // ms
  collectMemoryMetrics: true,
  enableGarbageCollection: true,
};

/**
 * Regression tolerance (percentage)
 * If performance degrades by more than this percentage, test fails
 */
export const REGRESSION_TOLERANCE = {
  mean: 10, // 10% slower than baseline
  p95: 15, // 15% slower than baseline
  p99: 20, // 20% slower than baseline
};
