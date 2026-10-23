/**
 * Suite-Level Timeout and Hang Diagnostics
 * 
 * Collects open handles, pending timers, and connection details on timeout.
 * Ensures slow tests don't silently timeout without explanation.
 */

import { execSync } from 'child_process';

export interface TimeoutConfig {
  suiteTimeoutMs: number;
  testTimeoutMs: number;
  description: string; // Why this test is intentionally slow
}

export interface DiagnosticsReport {
  timestamp: string;
  suiteTimeoutMs: number;
  elapsed: number;
  openHandles: string[];
  pendingTimers: NodeJS.Timeout[];
  environment: Record<string, string | undefined>;
  processInfo: {
    pid: number;
    uptime: number;
    memory: NodeJS.MemoryUsage;
  };
}

/**
 * Collects system diagnostics when a suite timeout occurs
 */
export function collectDiagnostics(suiteTimeoutMs: number, startTime: number): DiagnosticsReport {
  const elapsed = Date.now() - startTime;

  // Collect open file descriptors (Linux/macOS)
  let openHandles: string[] = [];
  try {
    if (process.platform !== 'win32') {
      const output = execSync(`lsof -p ${process.pid}`, { encoding: 'utf-8' });
      openHandles = output.split('\n').slice(1).map((line) => line.trim());
    }
  } catch (e) {
    // lsof may not be available
  }

  // Get pending timers from active handles
  const pendingTimers = (process as any)._getActiveHandles?.() ?? [];

  return {
    timestamp: new Date().toISOString(),
    suiteTimeoutMs,
    elapsed,
    openHandles,
    pendingTimers: pendingTimers.filter((h: any) => h._timeout),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_HOST: process.env.DATABASE_HOST,
      REDIS_HOST: process.env.REDIS_HOST,
      DEBUG: process.env.DEBUG,
    },
    processInfo: {
      pid: process.pid,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    },
  };
}

/**
 * Wraps a test suite with explicit timeout and diagnostics
 */
export function describeWithTimeout(
  name: string,
  config: TimeoutConfig,
  fn: () => void,
): void {
  describe(`${name} (timeout: ${config.suiteTimeoutMs}ms, intentional: ${config.description})`, () => {
    const startTime = Date.now();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let diagnostics: DiagnosticsReport | null = null;

    beforeAll(() => {
      // Set suite-level timeout with diagnostics collection
      timeoutHandle = setTimeout(() => {
        diagnostics = collectDiagnostics(config.suiteTimeoutMs, startTime);

        const report = `
╔════════════════════════════════════════════════════════════════╗
║  SUITE TIMEOUT - HANG DIAGNOSTICS                              ║
╚════════════════════════════════════════════════════════════════╝
Suite: ${name}
Timeout: ${config.suiteTimeoutMs}ms
Elapsed: ${diagnostics.elapsed}ms
Description: ${config.description}

Open Handles (${diagnostics.openHandles.length}):
${diagnostics.openHandles.slice(0, 10).map((h) => `  - ${h}`).join('\n')}
${diagnostics.openHandles.length > 10 ? `  ... and ${diagnostics.openHandles.length - 10} more` : ''}

Environment:
  DATABASE_HOST: ${diagnostics.environment.DATABASE_HOST || 'not set'}
  REDIS_HOST: ${diagnostics.environment.REDIS_HOST || 'not set'}
  NODE_ENV: ${diagnostics.environment.NODE_ENV || 'not set'}

Process Memory: ${(diagnostics.processInfo.memory.heapUsed / 1024 / 1024).toFixed(2)}MB / ${(diagnostics.processInfo.memory.heapTotal / 1024 / 1024).toFixed(2)}MB

Action: Check external service connections and ensure all handles are properly closed.
`;

        console.error(report);
        process.exit(1);
      }, config.suiteTimeoutMs);

      // Set individual test timeout
      jest.setTimeout(config.testTimeoutMs);
    });

    afterAll(() => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    });

    fn();
  });
}

/**
 * Documents intentionally long-running tests
 */
export function itSlow(
  name: string,
  testTimeoutMs: number,
  reason: string,
  fn: () => Promise<void> | void,
): void {
  it(`${name} (slow: ${testTimeoutMs}ms, reason: ${reason})`, fn);
  jest.setTimeout(testTimeoutMs);
}

/**
 * Validates that slow tests complete and log timing
 */
export function validateSlowTestCompletion(
  testName: string,
  startTime: number,
  expectedMaxMs: number,
): void {
  const elapsed = Date.now() - startTime;
  const overhead = 500; // Allow 500ms overhead for test framework

  console.log(`✓ ${testName} completed in ${elapsed}ms (limit: ${expectedMaxMs}ms)`);

  if (elapsed > expectedMaxMs + overhead) {
    console.warn(
      `⚠️ ${testName} took ${elapsed - expectedMaxMs}ms longer than expected`,
    );
  }
}
