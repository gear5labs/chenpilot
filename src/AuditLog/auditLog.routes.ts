import { Router, Request, Response } from "express";
import { authenticateToken } from "../Auth/auth.middleware";
import {
  requireAdmin,
  requireOwnerOrElevated,
} from "../Gateway/middleware/rbac.middleware";
import { auditLogService } from "./auditLog.service";
import { AuditAction, AuditSeverity } from "./auditLog.entity";

const router = Router();

/**
 * @swagger
 * /api/audit/logs:
 *   get:
 *     summary: Get audit logs (admin only)
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action type
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [info, warning, error, critical]
 *         description: Filter by severity
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date filter
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date filter
 *       - in: query
 *         name: success
 *         schema:
 *           type: boolean
 *         description: Filter by success status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of logs to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Offset for pagination
 *     responses:
 *       200:
 *         description: Audit logs retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 */
router.get(
  "/logs",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const {
        userId,
        action,
        severity,
        startDate,
        endDate,
        success,
        limit,
        offset,
      } = req.query;

      const result = await auditLogService.query({
        userId: userId as string,
        action: action as AuditAction,
        severity: severity as AuditSeverity,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        success:
          success === "true" ? true : success === "false" ? false : undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch audit logs",
      });
    }
  }
);

/**
 * @swagger
 * /api/audit/user/{userId}:
 *   get:
 *     summary: Get audit logs for a specific user
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of logs to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Offset for pagination
 *     responses:
 *       200:
 *         description: User audit logs retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Can only access own logs unless admin
 */
router.get(
  "/user/:userId",
  authenticateToken,
  requireOwnerOrElevated("userId"),
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { limit, offset } = req.query;

      const result = await auditLogService.getUserAuditLogs(
        userId,
        limit ? parseInt(limit as string, 10) : 50,
        offset ? parseInt(offset as string, 10) : 0
      );

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error("Error fetching user audit logs:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch user audit logs",
      });
    }
  }
);

/**
 * @swagger
 * /api/audit/security-events:
 *   get:
 *     summary: Get recent security events (admin only)
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: hours
 *         schema:
 *           type: integer
 *           default: 24
 *         description: Number of hours to look back
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of events to return
 *     responses:
 *       200:
 *         description: Security events retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 */
router.get(
  "/security-events",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { hours, limit } = req.query;

      const events = await auditLogService.getSecurityEvents(
        hours ? parseInt(hours as string, 10) : 24,
        limit ? parseInt(limit as string, 10) : 100
      );

      return res.status(200).json({
        success: true,
        events,
        total: events.length,
      });
    } catch (error) {
      console.error("Error fetching security events:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch security events",
      });
    }
  }
);

/**
 * @swagger
 * /api/audit/failed-auth:
 *   get:
 *     summary: Get failed authentication attempts (admin only)
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - in: query
 *         name: hours
 *         schema:
 *           type: integer
 *           default: 24
 *         description: Number of hours to look back
 *     responses:
 *       200:
 *         description: Failed auth attempts retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 */
router.get(
  "/failed-auth",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { userId, hours } = req.query;

      const attempts = await auditLogService.getFailedAuthAttempts(
        userId as string,
        hours ? parseInt(hours as string, 10) : 24
      );

      return res.status(200).json({
        success: true,
        attempts,
        total: attempts.length,
      });
    } catch (error) {
      console.error("Error fetching failed auth attempts:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch failed auth attempts",
      });
    }
  }
);

export default router;
