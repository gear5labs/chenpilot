import { Request, Response, NextFunction } from "express";
import ipaddr from "ipaddr.js";
import config from "../../config/config";

/**
 * Extract client IP from request
 * Handles proxies and load balancers (X-Forwarded-For, X-Real-IP)
 */
function getClientIp(req: Request): string {
  // Check X-Forwarded-For header (common for proxies/load balancers)
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one
    const ips = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
      .split(",")
      .map((ip) => ip.trim());
    return ips[0];
  }

  // Check X-Real-IP header (nginx)
  const realIp = req.headers["x-real-ip"];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  // Fall back to socket remote address
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Check if an IP matches a whitelist entry
 * Supports:
 * - Single IPs (e.g., "192.168.1.1")
 * - CIDR notation (e.g., "192.168.1.0/24")
 * - IPv6 addresses
 */
function isIpAllowed(clientIp: string, allowedList: string[]): boolean {
  try {
    const client = ipaddr.parse(clientIp);

    for (const allowed of allowedList) {
      // Handle "unknown" case
      if (clientIp === "unknown") {
        return false;
      }

      // Check if it's a CIDR range
      if (allowed.includes("/")) {
        const [range, prefixLength] = allowed.split("/");
        const rangeIp = ipaddr.parse(range);
        const prefix = parseInt(prefixLength, 10);

        // Check if client IP matches the CIDR range
        if (client.kind() === rangeIp.kind()) {
          // For IPv4 /32 or IPv6 /128, compare exact IPs
          if (
            (client.kind() === "ipv4" && prefix === 32) ||
            (client.kind() === "ipv6" && prefix === 128)
          ) {
            if (client.toString() === rangeIp.toString()) {
              return true;
            }
          } else {
            // Use byte array comparison for CIDR matching
            try {
              // Convert to byte arrays for comparison
              const clientBytes = client.toByteArray();
              const rangeBytes = rangeIp.toByteArray();

              // Check bits up to prefix length
              const fullBytes = Math.floor(prefix / 8);
              const remainingBits = prefix % 8;

              let matches = true;
              for (let i = 0; i < fullBytes && i < clientBytes.length; i++) {
                if (clientBytes[i] !== rangeBytes[i]) {
                  matches = false;
                  break;
                }
              }

              if (
                matches &&
                remainingBits > 0 &&
                fullBytes < clientBytes.length
              ) {
                const mask = 0xff << (8 - remainingBits);
                if (
                  (clientBytes[fullBytes] & mask) !==
                  (rangeBytes[fullBytes] & mask)
                ) {
                  matches = false;
                }
              }

              if (matches) {
                return true;
              }
            } catch {
              // Fall back to simple string comparison
              if (client.toString() === rangeIp.toString()) {
                return true;
              }
            }
          }
        }
      } else {
        // Single IP comparison
        if (client.toString() === allowed) {
          return true;
        }
      }
    }
  } catch {
    // Invalid IP format, deny access
    return false;
  }

  return false;
}

/**
 * IP Whitelist Middleware
 * Restricts access to routes based on a configurable list of allowed IP addresses
 *
 * Configuration (in config):
 *   admin: {
 *     allowedIps: ["127.0.0.1", "192.168.1.0/24", "::1"]
 *   }
 *
 * Environment variables:
 *   ADMIN_ALLOWED_IPS=127.0.0.1,192.168.1.0/24,::1
 */
export function requireIpWhitelist() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const allowedIps = config.admin?.allowedIps || [];

    // If no IPs are configured, allow all requests (backward compatibility)
    // But log a warning in production
    if (allowedIps.length === 0) {
      if (process.env.NODE_ENV === "production") {
        console.warn(
          "WARNING: No admin IP whitelist configured. Admin routes are not restricted by IP."
        );
      }
      next();
      return;
    }

    const clientIp = getClientIp(req);

    if (!isIpAllowed(clientIp, allowedIps)) {
      console.warn(
        `IP whitelist violation: ${clientIp} tried to access admin route`
      );
      res.status(403).json({
        success: false,
        message:
          "Access denied. Your IP is not allowed to access this resource.",
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to check both IP whitelist AND admin role
 * Use this for maximum security on admin routes
 */
export function requireAdminWithIpWhitelist() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const allowedIps = config.admin?.allowedIps || [];

    // If no IPs are configured, skip IP check (backward compatibility)
    if (allowedIps.length > 0) {
      const clientIp = getClientIp(req);

      if (!isIpAllowed(clientIp, allowedIps)) {
        console.warn(
          `IP whitelist violation: ${clientIp} tried to access admin route`
        );
        res.status(403).json({
          success: false,
          message:
            "Access denied. Your IP is not allowed to access this resource.",
        });
        return;
      }
    }

    // Continue to the requireAdmin middleware
    next();
  };
}
