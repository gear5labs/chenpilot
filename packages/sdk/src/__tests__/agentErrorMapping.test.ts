/**
 * Agent client error-mapping tests (#1047).
 *
 * `AgentRequestError` must always carry a *registered* SDK code (never an
 * ad-hoc `HTTP_<status>` string), and a malformed 2xx body must surface as the
 * registered `AGENT_BAD_RESPONSE` code without being retried.
 */

import {
  AgentBadResponseError,
  AgentClient,
  AgentRequestError,
  agentErrorCodeForStatus,
} from "../agentClient";
import { ErrorRegistry } from "../errorRegistry";
import { isAbortError } from "../abort";

const USER_ID = "user-error-map";

describe("agent error mapping (#1047)", () => {
  describe("agentErrorCodeForStatus", () => {
    it("returns a registered code for every status it can see", () => {
      const statuses = [
        undefined,
        400,
        401,
        402,
        403,
        404,
        409,
        418,
        429,
        500,
        501,
        503,
        599,
      ];
      for (const status of statuses) {
        const code = agentErrorCodeForStatus(status);
        expect(ErrorRegistry.has(code)).toBe(true);
      }
    });

    it("uses AGENT_SESSION_EXPIRED for 401 and TRANSPORT_ERROR as the fallback", () => {
      expect(agentErrorCodeForStatus(401)).toBe("AGENT_SESSION_EXPIRED");
      expect(agentErrorCodeForStatus(undefined)).toBe("TRANSPORT_ERROR");
      // Unknown/no-mapping status must not invent a code.
      expect(agentErrorCodeForStatus(418)).toBe("TRANSPORT_ERROR");
    });
  });

  describe("AgentRequestError", () => {
    it("carries a registered code instead of HTTP_<status>", () => {
      const err = new AgentRequestError("nope", "key-1", 2, 503);
      expect(ErrorRegistry.has(err.code)).toBe(true);
      expect(err.code).not.toMatch(/^HTTP_/);
      expect(err.code).toBe("TRANSPORT_ERROR");
      expect(err.details).toMatchObject({ httpStatus: 503, attempts: 2 });
    });

    it("maps a 401 to AGENT_SESSION_EXPIRED", () => {
      const err = new AgentRequestError("expired", "key-1", 1, 401);
      expect(err.code).toBe("AGENT_SESSION_EXPIRED");
    });

    it("uses TRANSPORT_ERROR (registered) when there is no status", () => {
      const err = new AgentRequestError("failed", "key-1", 3);
      expect(err.code).toBe("TRANSPORT_ERROR");
      expect(ErrorRegistry.has(err.code)).toBe(true);
    });
  });

  describe("AgentClient.query", () => {
    it("throws an AgentRequestError with a registered code on a 4xx", async () => {
      const client = new AgentClient({
        baseUrl: "http://localhost:3000",
        defaultRetryDelayMs: 0,
        fetchFn: async () => ({
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => "not found",
        }),
      });

      let caught: unknown;
      try {
        await client.query({ userId: USER_ID, query: "x", maxRetries: 1 });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AgentRequestError);
      expect(ErrorRegistry.has((caught as AgentRequestError).code)).toBe(true);
      expect((caught as AgentRequestError).code).not.toMatch(/^HTTP_/);
    });

    it("surfaces a malformed 2xx body as AGENT_BAD_RESPONSE without retrying", async () => {
      let calls = 0;
      const client = new AgentClient({
        baseUrl: "http://localhost:3000",
        defaultRetryDelayMs: 0,
        fetchFn: async () => {
          calls += 1;
          return {
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected token < in JSON");
            },
            text: async () => "<html>not json</html>",
          };
        },
      });

      let caught: unknown;
      try {
        await client.query({ userId: USER_ID, query: "x", maxRetries: 3 });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AgentBadResponseError);
      expect((caught as AgentBadResponseError).code).toBe("AGENT_BAD_RESPONSE");
      expect((caught as AgentBadResponseError).recoverable).toBe(false);
      // Malformed bodies are terminal: exactly one attempt.
      expect(calls).toBe(1);
    });

    it("keeps cancellations distinct from request failures", async () => {
      const controller = new AbortController();
      controller.abort();
      const client = new AgentClient({
        baseUrl: "http://localhost:3000",
        fetchFn: async () => {
          throw new Error("should not be called");
        },
      });

      let caught: unknown;
      try {
        await client.query({
          userId: USER_ID,
          query: "x",
          signal: controller.signal,
        });
      } catch (error) {
        caught = error;
      }

      expect(isAbortError(caught)).toBe(true);
      expect(caught).not.toBeInstanceOf(AgentRequestError);
      expect(caught).not.toBeInstanceOf(AgentBadResponseError);
    });
  });
});
