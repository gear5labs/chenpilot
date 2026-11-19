import { Router, Request, Response } from "express";
import { authenticateToken } from "../../Auth/auth.middleware";
import { auditLogService } from "../../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../../AuditLog/auditLog.entity";
import logger from "../../config/logger";
import { memoryStore, MemoryStore } from "./memory";

/**
 * A user may inspect and delete only their own agent memory (#801).
 *
 * Memory is stored per user id. The id is always taken from the authenticated
 * principal and never from the request: any user id a caller puts in the query,
 * body or path that differs from their own is refused with 403 and audited, so
 * these routes cannot be pointed at someone else's memory.
 */
function requestedUserId(req: Request): string | undefined {
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody =
    typeof body === "object" && body !== null
      ? (body.userId ?? body.user_id)
      : undefined;
  const fromQuery = req.query.userId ?? req.query.user_id;
  const candidate = fromQuery ?? fromBody ?? req.params?.userId;
  return typeof candidate === "string" ? candidate : undefined;
}

async function refuseForeignScope(
  req: Request,
  res: Response
): Promise<boolean> {
  const requested = requestedUserId(req);
  if (!requested || !req.user || requested === req.user.userId) {
    return false;
  }

  logger.warn("Cross-user memory access attempt denied", {
    authenticatedUserId: req.user.userId,
    requestedUserId: requested,
    path: req.originalUrl || req.path,
  });
  await auditLogService.log({
    userId: req.user.userId,
    action: AuditAction.PERMISSION_DENIED,
    severity: AuditSeverity.WARNING,
    resource: req.originalUrl || req.path,
    metadata: {
      requestedUserId: requested,
      authenticatedUserId: req.user.userId,
      reason: "cross_user_memory_scope_denied",
    },
  });
  res.status(403).json({
    success: false,
    message: "Forbidden: memory scope cannot exceed the authenticated user",
  });
  return true;
}

export function createMemoryRoutes(store: MemoryStore = memoryStore): Router {
  const router = Router();

  /**
   * GET /memory - the authenticated user's remembered context, oldest first.
   * Expired workflow entries are not returned, matching what the agent sees.
   */
  router.get("/", authenticateToken, async (req: Request, res: Response) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required" });
    }
    if (await refuseForeignScope(req, res)) return;

    const entries = store.get(req.user.userId);
    return res.status(200).json({
      success: true,
      data: { userId: req.user.userId, count: entries.length, entries },
    });
  });

  /**
   * DELETE /memory - forget everything stored for the authenticated user.
   * Other users' memory is untouched.
   */
  router.delete("/", authenticateToken, async (req: Request, res: Response) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required" });
    }
    if (await refuseForeignScope(req, res)) return;

    const removed = store.get(req.user.userId).length;
    store.clear(req.user.userId);
    await auditLogService.log({
      userId: req.user.userId,
      action: AuditAction.USER_UPDATED,
      severity: AuditSeverity.INFO,
      resource: req.originalUrl || req.path,
      metadata: { reason: "agent_memory_deleted_by_owner", removed },
    });

    return res.status(200).json({ success: true, data: { removed } });
  });

  return router;
}

export default createMemoryRoutes();
