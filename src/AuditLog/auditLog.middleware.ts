import { Request, Response, NextFunction } from "express";
import { auditLogService } from "./auditLog.service";
import { AuditAction, AuditSeverity } from "./auditLog.entity";

/**
 * Middleware to automatically log API requests
 */
export function auditLogMiddleware(
  action: AuditAction,
  severity?: AuditSeverity
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Store original send function
    const originalSend = res.send;

    // Override send to capture response
    res.send = function (data: unknown): Response {
      // Restore original send
      res.send = originalSend;

      // Log after response is sent
      setImmediate(async () => {
        try {
          const success = res.statusCode >= 200 && res.statusCode < 400;

          await auditLogService.logFromRequest(req, action, {
            severity:
              severity || (success ? AuditSeverity.INFO : AuditSeverity.ERROR),
            success,
            resource: `${req.method} ${req.path}`,
            metadata: {
              statusCode: res.statusCode,
              method: req.method,
              path: req.path,
              query: req.query,
            },
          });
        } catch (error) {
          console.error("Failed to create audit log:", error);
        }
      });

      // Call original send
      return originalSend.call(this, data);
    };

    next();
  };
}

/**
 * Middleware to log failed authentication attempts
 */
export async function logFailedAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const originalJson = res.json;

  res.json = function (data: unknown): Response {
    res.json = originalJson;

    setImmediate(async () => {
      try {
        if (res.statusCode === 401 || res.statusCode === 403) {
          await auditLogService.logFromRequest(req, AuditAction.LOGIN_FAILED, {
            severity: AuditSeverity.WARNING,
            success: false,
            resource: req.path,
            metadata: {
              statusCode: res.statusCode,
              body: typeof data === "object" ? data : {},
            },
          });
        }
      } catch (error) {
        console.error("Failed to log auth failure:", error);
      }
    });

    return originalJson.call(this, data);
  };

  next();
}
