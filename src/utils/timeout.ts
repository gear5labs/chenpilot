import logger from "../config/logger";

export class TimeoutError extends Error {
  constructor(message: string, public readonly operation: string, public readonly timeoutMs: number) {
    super(message);
    this.name = "TimeoutError";
  }
}

export interface TimeoutOptions {
  timeoutMs: number;
  operation: string;
  onTimeout?: () => void;
  signal?: AbortSignal;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, operation, onTimeout, signal } = options;

  if (signal?.aborted) {
    throw new TimeoutError(
      `Operation "${operation}" was aborted before starting`,
      operation,
      timeoutMs
    );
  }

  let timeoutId: NodeJS.Timeout;
  let abortListener: (() => void) | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      logger.warn("Operation timeout", { operation, timeoutMs });
      if (onTimeout) {
        onTimeout();
      }
      reject(
        new TimeoutError(
          `Operation "${operation}" timed out after ${timeoutMs}ms`,
          operation,
          timeoutMs
        )
      );
    }, timeoutMs);

    if (signal) {
      abortListener = () => {
        clearTimeout(timeoutId);
        reject(
          new TimeoutError(
            `Operation "${operation}" was aborted`,
            operation,
            timeoutMs
          )
        );
      };
      signal.addEventListener("abort", abortListener);
    }
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    if (signal && abortListener) {
      signal.removeEventListener("abort", abortListener);
    }
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    if (signal && abortListener) {
      signal.removeEventListener("abort", abortListener);
    }
    throw error;
  }
}

export class TimeoutManager {
  private activeOperations: Map<string, AbortController> = new Map();

  async execute<T>(
    operationId: string,
    promise: Promise<T>,
    options: Omit<TimeoutOptions, "signal">
  ): Promise<T> {
    const controller = new AbortController();
    this.activeOperations.set(operationId, controller);

    try {
      const result = await withTimeout(promise, {
        ...options,
        signal: controller.signal,
      });
      this.activeOperations.delete(operationId);
      return result;
    } catch (error) {
      this.activeOperations.delete(operationId);
      throw error;
    }
  }

  abort(operationId: string): boolean {
    const controller = this.activeOperations.get(operationId);
    if (controller) {
      controller.abort();
      this.activeOperations.delete(operationId);
      return true;
    }
    return false;
  }

  abortAll(): void {
    for (const [operationId, controller] of this.activeOperations.entries()) {
      controller.abort();
      this.activeOperations.delete(operationId);
    }
  }

  getActiveOperations(): string[] {
    return Array.from(this.activeOperations.keys());
  }

  isActive(operationId: string): boolean {
    return this.activeOperations.has(operationId);
  }
}

export const globalTimeoutManager = new TimeoutManager();
