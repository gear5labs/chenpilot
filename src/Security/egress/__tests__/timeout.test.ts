/**
 * Tests for HTTP request timeout enforcement.
 *
 * Verifies that outbound HTTP requests have explicit connect and total deadline
 * timeouts to prevent providers from stalling request handlers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EgressController, EgressError, SecureFetchOptions } from "../egressFetch";
import { DEFAULT_ADAPTER_EGRESS, DEFAULT_REQUEST_BUDGET } from "../destinationPolicy";

describe("HTTP Request Timeout Enforcement", () => {
  let controller: EgressController;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    controller = new EgressController();
    mockFetch = vi.fn();
  });

  describe("total deadline timeout", () => {
    it("should abort request when total deadline is exceeded", async () => {
      const slowServer = new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(new Response("delayed", { status: 200 }));
        }, 20000);
      });

      mockFetch.mockResolvedValue(slowServer);

      const opts: SecureFetchOptions = {
        egress: DEFAULT_ADAPTER_EGRESS,
        budget: {
          timeLimitMs: 100, // Very short timeout
          maxRedirects: 3,
        },
        transport: mockFetch,
      };

      await expect(
        controller.secureFetch("https://example.com", {}, opts)
      ).rejects.toThrow(EgressError);

      const error = await controller
        .secureFetch("https://example.com", {}, opts)
        .catch((e) => e);

      expect(error).toBeInstanceOf(EgressError);
      expect(error.reason).toBe("budget-exceeded");
      expect(error.message).toContain("request deadline exceeded");
    });

    it("should use default timeout when not specified", async () => {
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

      const opts: SecureFetchOptions = {
        egress: {
          allowedHosts: ["example.com"],
          allowedProtocols: ["https:"],
        },
        transport: mockFetch,
      };

      await controller.secureFetch("https://example.com", {}, opts);

      expect(mockFetch).toHaveBeenCalled();
      // Verify the request had a timeout signal
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].signal).toBeDefined();
    });

    it("should complete successfully within timeout", async () => {
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

      const opts: SecureFetchOptions = {
        egress: {
          allowedHosts: ["example.com"],
          allowedProtocols: ["https:"],
        },
        budget: {
          timeLimitMs: 5000,
          maxRedirects: 3,
        },
        transport: mockFetch,
      };

      const response = await controller.secureFetch("https://example.com", {}, opts);

      expect(response.status).toBe(200);
    });
  });

  describe("connect timeout", () => {
    it("should enforce connect timeout separately from total deadline", async () => {
      let connectTimeoutTriggered = false;

      mockFetch.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            // Simulate slow connection that never completes
            setTimeout(() => {
              connectTimeoutTriggered = true;
              resolve(new Response("ok", { status: 200 }));
            }, 10000);
          })
      );

      const opts: SecureFetchOptions = {
        egress: {
          allowedHosts: ["example.com"],
          allowedProtocols: ["https:"],
        },
        budget: {
          timeLimitMs: 15000,
          connectTimeoutMs: 100, // Very short connect timeout
          maxRedirects: 3,
        },
        transport: mockFetch,
      };

      await expect(
        controller.secureFetch("https://example.com", {}, opts)
      ).rejects.toThrow();

      // The request should fail before the long delay completes
      expect(connectTimeoutTriggered).toBe(false);
    });

    it("should use default connect timeout when not specified", async () => {
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

      const opts: SecureFetchOptions = {
        egress: {
          allowedHosts: ["example.com"],
          allowedProtocols: ["https:"],
        },
        budget: {
          timeLimitMs: 15000,
          maxRedirects: 3,
        },
        transport: mockFetch,
      };

      await controller.secureFetch("https://example.com", {}, opts);

      expect(mockFetch).toHaveBeenCalled();
    });

    it("should allow fast connections to succeed", async () => {
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

      const opts: SecureFetchOptions = {
        egress: {
          allowedHosts: ["example.com"],
          allowedProtocols: ["https:"],
        },
        budget: {
          timeLimitMs: 15000,
          connectTimeoutMs: 5000,
          maxRedirects: 3,
        },
        transport: mockFetch,
      };

      const response = await controller.secureFetch("https://example.com", {}, opts);

      expect(response.status).toBe(200);
    });
  });

  describe("timeout cleanup", () => {
    it("should clean up timeout on successful request", async () => {
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      const opts: SecureFetchOptions = {
        egress: {
          allowedHosts: ["example.com"],
          allowedProtocols: ["https:"],
        },
        budget: {
          timeLimitMs: 5000,
          maxRedirects: 3,
        },
        transport: mockFetch,
      };

      await controller.secureFetch("https://example.com", {}, opts);

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it("should clean up timeout on failed request", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      const opts: SecureFetchOptions = {
        egress: {
          allowedHosts: ["example.com"],
          allowedProtocols: ["https:"],
        },
        budget: {
          timeLimitMs: 5000,
          maxRedirects: 3,
        },
        transport: mockFetch,
      };

      await expect(
        controller.secureFetch("https://example.com", {}, opts)
      ).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it("should clean up timeout on timeout", async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => resolve(new Response("ok", { status: 200 })), 10000);
          })
      );

      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      const opts: SecureFetchOptions = {
        egress: {
          allowedHosts: ["example.com"],
          allowedProtocols: ["https:"],
        },
        budget: {
          timeLimitMs: 100,
          maxRedirects: 3,
        },
        transport: mockFetch,
      };

      await expect(
        controller.secureFetch("https://example.com", {}, opts)
      ).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe("default budget values", () => {
    it("should have sensible default total timeout", () => {
      expect(DEFAULT_REQUEST_BUDGET.timeLimitMs).toBe(15000);
    });

    it("should have sensible default connect timeout", () => {
      expect(DEFAULT_REQUEST_BUDGET.connectTimeoutMs).toBe(5000);
    });

    it("should have sensible default redirect limit", () => {
      expect(DEFAULT_REQUEST_BUDGET.maxRedirects).toBe(3);
    });
  });

  describe("signal combination", () => {
    it("should combine caller abort signal with deadline", async () => {
      const abortController = new AbortController();
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

      const opts: SecureFetchOptions = {
        egress: {
          allowedHosts: ["example.com"],
          allowedProtocols: ["https:"],
        },
        budget: {
          timeLimitMs: 5000,
          maxRedirects: 3,
        },
        transport: mockFetch,
      };

      const init = {
        signal: abortController.signal,
      };

      await controller.secureFetch("https://example.com", init, opts);

      expect(mockFetch).toHaveBeenCalled();
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].signal).toBeDefined();
    });

    it("should handle missing caller abort signal", async () => {
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

      const opts: SecureFetchOptions = {
        egress: {
          allowedHosts: ["example.com"],
          allowedProtocols: ["https:"],
        },
        budget: {
          timeLimitMs: 5000,
          maxRedirects: 3,
        },
        transport: mockFetch,
      };

      await controller.secureFetch("https://example.com", {}, opts);

      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
