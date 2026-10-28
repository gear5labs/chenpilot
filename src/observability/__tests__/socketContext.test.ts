import {
  createSocketContext,
  propagateSocketContext,
  runWithSocketRequest,
} from "../socketContext";
import { getExecutionContext } from "../context";

const mockSocket = {
  id: "socket-123",
  handshake: {
    headers: {
      "x-forwarded-for": "192.168.1.1",
      "user-agent": "test-agent",
    },
    address: "127.0.0.1",
    url: "/socket.io/",
  },
} as any;

describe("SocketContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createSocketContext", () => {
    it("creates context from socket", () => {
      const ctx = createSocketContext(mockSocket, "user-123");

      expect(ctx.transport).toBe("websocket");
      expect(ctx.ip).toBe("192.168.1.1");
      expect(ctx.userAgent).toBe("test-agent");
      expect(ctx.path).toBe("/socket.io/");
    });

    it("omits userId and roles when not provided", () => {
      const ctx = createSocketContext(mockSocket);

      expect(ctx.userId).toBeUndefined();
      expect(ctx.roles).toBeUndefined();
    });

    it("assigns userId and roles when provided", () => {
      const ctx = createSocketContext(mockSocket, "user-123");

      expect(ctx.userId).toBe("user-123");
      expect(ctx.roles).toEqual([]);
    });
  });

  describe("propagateSocketContext", () => {
    it("wraps callback with socket context", () => {
      let capturedUserId: string | undefined;

      propagateSocketContext(mockSocket, "user-123", () => {
        const ctx = createSocketContext(mockSocket, "user-123");
        capturedUserId = ctx.userId;
        return "result";
      });

      expect(capturedUserId).toBe("user-123");
    });

    it("cleans up context after callback completes", () => {
      propagateSocketContext(mockSocket, "user-123", () => {
        expect(createSocketContext(mockSocket, "user-123").userId).toBe("user-123");
      });

      const ctx = createSocketContext(mockSocket);
      expect(ctx.userId).toBeUndefined();
    });
  });

  describe("request identifiers", () => {
    it("always produces a requestId on the socket context", () => {
      const ctx = createSocketContext(mockSocket);
      expect(typeof ctx.requestId).toBe("string");
      expect(ctx.requestId.length).toBeGreaterThan(0);
    });

    it("mints a fresh requestId per inbound socket request", () => {
      let first: string | undefined;
      let second: string | undefined;

      runWithSocketRequest(mockSocket, "user-123", () => {
        first = getExecutionContext()?.requestId;
      });
      runWithSocketRequest(mockSocket, "user-123", () => {
        second = getExecutionContext()?.requestId;
      });

      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(first).not.toBe(second);
    });

    it("exposes the requestId to the handler body for error payloads", () => {
      runWithSocketRequest(mockSocket, "user-123", () => {
        const ctx = getExecutionContext();
        expect(ctx?.transport).toBe("websocket");
        expect(ctx?.requestId).toBeTruthy();
        expect(ctx?.userId).toBe("user-123");
      });
    });
  });
});
