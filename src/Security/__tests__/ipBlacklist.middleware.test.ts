import { Request, Response, NextFunction } from "express";
import { ipBlacklistMiddleware } from "../ipBlacklist.middleware";
import { ipBlacklistService } from "../ipBlacklist.service";
import logger from "../../config/logger";
import { BlacklistReason } from "../ipBlacklist.entity";

jest.mock("../ipBlacklist.service");
jest.mock("../../config/logger");

describe("IPBlacklist Middleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      headers: {},
      socket: {
        remoteAddress: "192.168.1.100",
      } as any,
      ip: undefined,
      path: "/api/test",
      method: "POST",
      get: jest.fn(),
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    next = jest.fn();
  });

  describe("Normal Request Flow", () => {
    it("should allow request from non-blacklisted IP", async () => {
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(false);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should store client IP in request object", async () => {
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(false);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect((req as any).clientIP).toBe("192.168.1.100");
    });

    it("should extract IP from x-forwarded-for header", async () => {
      (req as any).headers["x-forwarded-for"] =
        "203.0.113.1, 192.168.1.1, 10.0.0.1";
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(false);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect((req as any).clientIP).toBe("203.0.113.1");
      expect(next).toHaveBeenCalled();
    });
  });

  describe("Blacklisted IP Blocking", () => {
    it("should block request from blacklisted IP", async () => {
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(true);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "Access denied",
          code: "IP_BLACKLISTED",
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should log blocked request", async () => {
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(true);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect(logger.warn).toHaveBeenCalledWith(
        "Blocked request from blacklisted IP",
        expect.objectContaining({
          ip: "192.168.1.100",
          path: "/api/test",
          method: "POST",
        })
      );
    });

    it("should return proper error response", async () => {
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(true);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "Access denied",
          message: expect.stringContaining("blocked"),
        })
      );
    });
  });

  describe("IP Extraction Edge Cases", () => {
    it("should handle missing remote address", async () => {
      req.socket = undefined as any;
      req.ip = undefined;
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(false);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect(next).toHaveBeenCalled();
    });

    it("should fallback to req.ip if socket unavailable", async () => {
      req.socket = undefined as any;
      (req as any).ip = "10.0.0.1";
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(false);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect((req as any).clientIP).toBe("10.0.0.1");
      expect(next).toHaveBeenCalled();
    });

    it("should set IP to unknown if all sources fail", async () => {
      req.socket = undefined as any;
      req.ip = undefined;
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(false);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      // Should handle gracefully and continue
      expect(next).toHaveBeenCalled();
    });

    it("should handle IPv6 localhost normalization", async () => {
      req.socket = { remoteAddress: "::1" } as any;
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(false);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect((req as any).clientIP).toBe("127.0.0.1");
      expect(next).toHaveBeenCalled();
    });

    it("should handle IPv6 mapped IPv4 addresses", async () => {
      req.socket = { remoteAddress: "::ffff:192.168.1.1" } as any;
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(false);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect((req as any).clientIP).toBe("192.168.1.1");
      expect(next).toHaveBeenCalled();
    });

    it("should strip port from IP address", async () => {
      req.socket = { remoteAddress: "192.168.1.1:8080" } as any;
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(false);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect((req as any).clientIP).toBe("192.168.1.1");
    });

    it("should handle whitespace in IP address", async () => {
      req.socket = { remoteAddress: "  192.168.1.1  " } as any;
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(false);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect((req as any).clientIP).toBe("192.168.1.1");
    });
  });

  describe("Error Handling", () => {
    it("should continue on service error", async () => {
      (ipBlacklistService.isBlacklisted as jest.Mock).mockRejectedValue(
        new Error("Database error")
      );

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "Error in IP blacklist middleware",
        expect.any(Object)
      );
    });

    it("should log service errors", async () => {
      const error = new Error("Service unavailable");
      (ipBlacklistService.isBlacklisted as jest.Mock).mockRejectedValue(error);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect(logger.error).toHaveBeenCalled();
    });

    it("should fail open on error to prevent service disruption", async () => {
      (ipBlacklistService.isBlacklisted as jest.Mock).mockRejectedValue(
        new Error("Connection timeout")
      );

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      // Should not block request
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });

  describe("User Agent and Path Logging", () => {
    it("should log user agent for blocked requests", async () => {
      (req as any).get = jest.fn().mockReturnValue("Mozilla/5.0...");
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(true);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect(logger.warn).toHaveBeenCalledWith(
        "Blocked request from blacklisted IP",
        expect.objectContaining({
          userAgent: "Mozilla/5.0...",
        })
      );
    });

    it("should include request path in logs", async () => {
      req.path = "/api/users/sensitive";
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(true);

      await ipBlacklistMiddleware(
        req as Request,
        res as Response,
        next as NextFunction
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          path: "/api/users/sensitive",
        })
      );
    });
  });

  describe("Concurrency", () => {
    it("should handle multiple concurrent requests", async () => {
      (ipBlacklistService.isBlacklisted as jest.Mock).mockResolvedValue(false);

      const promises = Array.from({ length: 5 }).map(() =>
        ipBlacklistMiddleware(
          req as Request,
          res as Response,
          next as NextFunction
        )
      );

      await Promise.all(promises);

      expect(next).toHaveBeenCalledTimes(5);
    });

    it("should isolate requests from different IPs", async () => {
      const req1 = { ...req, socket: { remoteAddress: "192.168.1.1" } };
      const req2 = { ...req, socket: { remoteAddress: "192.168.1.2" } };

      (ipBlacklistService.isBlacklisted as jest.Mock)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const next1 = jest.fn();
      const next2 = jest.fn();

      await Promise.all([
        ipBlacklistMiddleware(req1 as Request, res as Response, next1),
        ipBlacklistMiddleware(req2 as Request, res as Response, next2),
      ]);

      expect(next1).not.toHaveBeenCalled();
      expect(next2).toHaveBeenCalled();
    });
  });
});
