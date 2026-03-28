import { Request, Response, NextFunction } from "express";
import { ipBlacklistService } from "./ipBlacklist.service";
import logger from "../config/logger";

/**
 * Middleware to block requests from blacklisted IP addresses
 * Should be applied early in the middleware chain
 */
export const ipBlacklistMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract client IP
    const clientIP =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ||
      req.socket.remoteAddress ||
      req.ip ||
      "unknown";

    // Normalize IP
    const normalizedIP = normalizeIP(clientIP);

    // Check if IP is blacklisted
    const isBlacklisted = await ipBlacklistService.isBlacklisted(normalizedIP);

    if (isBlacklisted) {
      logger.warn("Blocked request from blacklisted IP", {
        ip: normalizedIP,
        path: req.path,
        method: req.method,
        userAgent: req.get("user-agent"),
      });

      res.status(403).json({
        success: false,
        error: "Access denied",
        message: "Your IP address has been blocked due to suspicious activity",
        code: "IP_BLACKLISTED",
      });
      return;
    }

    // Add IP to request for logging
    (req as any).clientIP = normalizedIP;

    next();
  } catch (error) {
    // Log error but don't block request on middleware failure
    logger.error("Error in IP blacklist middleware", {
      error,
      ip: req.ip,
    });

    // Continue to next middleware on error (fail open)
    next();
  }
};

/**
 * Normalize IP address
 */
function normalizeIP(ip: string): string {
  // Remove port if present
  let normalized = ip.split(":")[0];

  // Handle IPv6 localhost
  if (normalized === "::1") {
    normalized = "127.0.0.1";
  }

  // Handle IPv6 mapped IPv4
  if (normalized.includes("::ffff:")) {
    normalized = normalized.replace("::ffff:", "");
  }

  return normalized.trim();
}

export default ipBlacklistMiddleware;
