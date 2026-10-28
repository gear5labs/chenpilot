/**
 * Abort-contract tests (#1048).
 *
 * Every public network method must surface caller cancellation through one
 * consistent shape: an error recognised by `isAbortError()` with
 * `name === "AbortError"`. These tests pin the contract for the shared helpers
 * and for `AgentClient`, covering abort before dispatch, during a request, and
 * during retry backoff.
 */

import {
  abortableSleep,
  abortableWait,
  combineSignals,
  createAbortError,
  isAbortError,
  throwIfAborted,
  toNativeSignal,
} from "../abort";
import { AgentClient, AgentRequestError } from "../agentClient";

const USER_ID = "user-abort-test";

function okResponse(result: unknown = { success: true }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ result }),
    text: async () => "",
  };
}

function serverErrorResponse() {
  return {
    ok: false,
    status: 503,
    json: async () => ({}),
    text: async () => "service unavailable",
  };
}

describe("abort error contract (#1048)", () => {
  describe("isAbortError recognises every cancellation shape", () => {
    it("detects DOM/Node AbortError, axios cancellations and SDK aborts", () => {
      expect(isAbortError(createAbortError())).toBe(true);

      const dom = new Error("aborted");
      dom.name = "AbortError";
      expect(isAbortError(dom)).toBe(true);

      const axios = Object.assign(new Error("canceled"), {
        code: "ERR_CANCELED",
      });
      expect(isAbortError(axios)).toBe(true);

      const cancel = Object.assign(new Error("canceled"), {
        __CANCEL__: true,
      });
      expect(isAbortError(cancel)).toBe(true);
    });

    it("does not misclassify ordinary errors as aborts", () => {
      expect(isAbortError(new Error("boom"))).toBe(false);
      expect(isAbortError(new TypeError("network"))).toBe(false);
      expect(isAbortError(undefined)).toBe(false);
      expect(isAbortError(null)).toBe(false);
      expect(isAbortError("aborted")).toBe(false);
      expect(isAbortError({ name: "NotAbort" })).toBe(false);
    });

    it("createAbortError keeps the cause and name", () => {
      const cause = new Error("underlying");
      const err = createAbortError("cancelled", cause);
      expect(err.name).toBe("AbortError");
      expect((err as { cause?: unknown }).cause).toBe(cause);
    });
  });

  describe("primitives honour the contract", () => {
    it("throwIfAborted throws an AbortError only when already aborted", () => {
      const controller = new AbortController();
      expect(() => throwIfAborted(controller.signal)).not.toThrow();
      expect(() => throwIfAborted(undefined)).not.toThrow();

      controller.abort();
      let caught: unknown;
      try {
        throwIfAborted(controller.signal);
      } catch (error) {
        caught = error;
      }
      expect(isAbortError(caught)).toBe(true);
      expect((caught as Error).name).toBe("AbortError");
    });

    it("abortableSleep rejects immediately when already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(abortableSleep(10_000, controller.signal)).rejects.toMatchObject(
        { name: "AbortError" }
      );
    });

    it("abortableSleep rejects (not resolves) when aborted mid-delay", async () => {
      const controller = new AbortController();
      const promise = abortableSleep(10_000, controller.signal);
      controller.abort();
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    });

    it("abortableWait rejects and fires onAbort exactly once on abort", async () => {
      const controller = new AbortController();
      const onAbort = jest.fn();
      let resolveWork: (value: string) => void = () => undefined;
      const work = new Promise<string>((resolve) => {
        resolveWork = resolve;
      });

      const promise = abortableWait(work, controller.signal, { onAbort });
      controller.abort();

      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      expect(onAbort).toHaveBeenCalledTimes(1);

      // Late resolution must not re-settle the already-rejected promise.
      resolveWork("late");
    });

    it("combineSignals aborts when the external signal aborts", () => {
      const controller = new AbortController();
      const combined = combineSignals(undefined, controller.signal);
      expect(combined.signal?.aborted).toBe(false);
      controller.abort();
      expect(combined.signal?.aborted).toBe(true);
      combined.cleanup();
    });

    it("toNativeSignal returns undefined for no signal and passes through otherwise", () => {
      expect(toNativeSignal(undefined)).toBeUndefined();
      const controller = new AbortController();
      expect(toNativeSignal(controller.signal)).toBe(controller.signal);
    });
  });

  describe("AgentClient.query abort behaviour", () => {
    it("aborts before dispatch without calling fetch", async () => {
      const fetchFn = jest.fn(async () => okResponse());
      const controller = new AbortController();
      controller.abort();

      const client = new AgentClient({
        baseUrl: "http://localhost:3000",
        defaultRetryDelayMs: 0,
        fetchFn,
      });

      let caught: unknown;
      try {
        await client.query({
          userId: USER_ID,
          query: "hello",
          signal: controller.signal,
        });
      } catch (error) {
        caught = error;
      }

      expect(isAbortError(caught)).toBe(true);
      expect((caught as Error).name).toBe("AbortError");
      // The request must never reach the network.
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("propagates an abort mid-request without wrapping or retrying", async () => {
      const controller = new AbortController();
      let calls = 0;
      const client = new AgentClient({
        baseUrl: "http://localhost:3000",
        defaultRetryDelayMs: 0,
        fetchFn: async () => {
          calls += 1;
          // Simulate fetch observing the caller's signal and rejecting.
          if (controller.signal.aborted) {
            const err = new Error("aborted");
            err.name = "AbortError";
            throw err;
          }
          // Abort while the request is "in flight" (after fetch was invoked).
          controller.abort();
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        },
      });

      let caught: unknown;
      try {
        await client.query({
          userId: USER_ID,
          query: "hello",
          maxRetries: 3,
          signal: controller.signal,
        });
      } catch (error) {
        caught = error;
      }

      expect(isAbortError(caught)).toBe(true);
      expect(caught).not.toBeInstanceOf(AgentRequestError);
      // Abort must short-circuit retries.
      expect(calls).toBe(1);
    });

    it("propagates an abort during retry backoff and stops retrying", async () => {
      const controller = new AbortController();
      let calls = 0;
      const client = new AgentClient({
        baseUrl: "http://localhost:3000",
        defaultRetryDelayMs: 1000,
        fetchFn: async () => {
          calls += 1;
          // A retriable server error forces a backoff sleep between attempts.
          return serverErrorResponse();
        },
      });

      const promise = client.query({
        userId: USER_ID,
        query: "hello",
        maxRetries: 4,
        retryDelayMs: 1000,
        signal: controller.signal,
      });

      // Abort while the first backoff is pending.
      setTimeout(() => controller.abort(), 20);

      let caught: unknown;
      try {
        await promise;
      } catch (error) {
        caught = error;
      }

      expect(isAbortError(caught)).toBe(true);
      expect(caught).not.toBeInstanceOf(AgentRequestError);
      expect(calls).toBe(1);
    });

    it("treats a retriable failure as an AgentRequestError, not an abort", async () => {
      const client = new AgentClient({
        baseUrl: "http://localhost:3000",
        defaultRetryDelayMs: 0,
        fetchFn: async () => serverErrorResponse(),
      });

      let caught: unknown;
      try {
        await client.query({
          userId: USER_ID,
          query: "hello",
          maxRetries: 1,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AgentRequestError);
      expect(isAbortError(caught)).toBe(false);
    });
  });
});
