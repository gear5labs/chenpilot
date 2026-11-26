/**
 * Unhandled Rejection and Uncaught Exception Detection for Integration Suites (#1120)
 *
 * Ensures asynchronous errors in event listeners, background timers, or detached
 * promises fail tests explicitly instead of being silently swallowed.
 */

export interface AsyncErrorRecord {
  type: 'unhandledRejection' | 'uncaughtException';
  error: unknown;
  timestamp: number;
}

export class AsyncErrorDetector {
  private errors: AsyncErrorRecord[] = [];
  private rejectionHandler: ((reason: unknown) => void) | null = null;
  private exceptionHandler: ((error: Error) => void) | null = null;
  private isListening = false;

  public start(): void {
    if (this.isListening) return;

    this.rejectionHandler = (reason: unknown) => {
      this.errors.push({
        type: 'unhandledRejection',
        error: reason,
        timestamp: Date.now(),
      });
    };

    this.exceptionHandler = (error: Error) => {
      this.errors.push({
        type: 'uncaughtException',
        error,
        timestamp: Date.now(),
      });
    };

    process.on('unhandledRejection', this.rejectionHandler);
    process.on('uncaughtException', this.exceptionHandler);
    this.isListening = true;
  }

  public stop(): void {
    if (!this.isListening) return;

    if (this.rejectionHandler) {
      process.removeListener('unhandledRejection', this.rejectionHandler);
      this.rejectionHandler = null;
    }
    if (this.exceptionHandler) {
      process.removeListener('uncaughtException', this.exceptionHandler);
      this.exceptionHandler = null;
    }
    this.isListening = false;
  }

  public getErrors(): AsyncErrorRecord[] {
    return [...this.errors];
  }

  public clear(): void {
    this.errors = [];
  }

  public assertNoAsyncErrors(): void {
    if (this.errors.length > 0) {
      const first = this.errors[0];
      const errorDetail =
        first.error instanceof Error
          ? first.error.stack || first.error.message
          : String(first.error);
      this.clear();
      throw new Error(
        `[AsyncErrorDetector] Detected ${this.errors.length + 1} unhandled asynchronous failure(s). First error (${first.type}): ${errorDetail}`
      );
    }
  }
}

export const globalAsyncDetector = new AsyncErrorDetector();
