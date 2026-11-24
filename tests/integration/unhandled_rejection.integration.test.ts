/**
 * Integration Test: Unhandled Promise Rejection & Uncaught Exception Detection (#1120)
 *
 * Proves that unhandled asynchronous rejections outside test assertion paths
 * are reliably trapped, reported, and cleaned up between tests.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { AsyncErrorDetector } from './async-error-detector';

describe('Unhandled Promise Rejection Detection Suite (#1120)', () => {
  let detector: AsyncErrorDetector;

  beforeEach(() => {
    detector = new AsyncErrorDetector();
    detector.start();
  });

  afterEach(() => {
    detector.stop();
  });

  it('detects unhandled promise rejections emitted asynchronously', async () => {
    const errorMsg = 'Asynchronous event handler crashed outside test flow';

    // Simulate an unhandled rejection
    process.emit('unhandledRejection', new Error(errorMsg), Promise.resolve());

    const errors = detector.getErrors();
    expect(errors.length).toBe(1);
    expect(errors[0].type).toBe('unhandledRejection');
    expect((errors[0].error as Error).message).toBe(errorMsg);
  });

  it('cleans up error state between tests to prevent cascading failures', () => {
    // Proves clean isolation
    expect(detector.getErrors()).toHaveLength(0);
    expect(() => detector.assertNoAsyncErrors()).not.toThrow();
  });

  it('fails test explicitly when assertNoAsyncErrors is invoked on detected rejection', () => {
    process.emit('unhandledRejection', new Error('Delayed database connection failure'), Promise.resolve());

    expect(() => {
      detector.assertNoAsyncErrors();
    }).toThrow(/\[AsyncErrorDetector\] Detected/);
  });

  it('boundary case: handles non-Error rejection values (plain strings, objects)', () => {
    process.emit('unhandledRejection', 'Raw rejection string payload', Promise.resolve());

    const errors = detector.getErrors();
    expect(errors.length).toBe(1);
    expect(errors[0].error).toBe('Raw rejection string payload');
    expect(() => detector.assertNoAsyncErrors()).toThrow(/Raw rejection string payload/);
  });

  it('boundary case: handles uncaught exceptions alongside rejections', () => {
    const uncaught = new Error('Fatal background worker panic');
    process.emit('uncaughtException', uncaught);

    const errors = detector.getErrors();
    expect(errors.length).toBe(1);
    expect(errors[0].type).toBe('uncaughtException');
    expect((errors[0].error as Error).message).toBe('Fatal background worker panic');
  });
});
