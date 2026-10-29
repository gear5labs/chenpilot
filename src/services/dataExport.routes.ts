import crypto from "crypto";
import { Router, Request, Response } from "express";
import { authenticateToken } from "../Auth/auth.middleware";
import { DataExportService, ExportOwnershipError } from "./DataExportService";
import { deletionCoordinator } from "../lifecycle/deletionCoordinator";
import { erasureReporter } from "../lifecycle/erasureReporter";
import { HoldBlocksErasureError } from "../lifecycle/legalHold";
import logger from "../config/logger";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";

const router = Router();
const dataExportService = new DataExportService();

/**
 * Extracts any requested userId or target scope from request query, body, or params.
 */
function getRequestedUserId(req: Request): string | undefined {
  const queryUserId = (req.query.userId || req.query.user_id) as string | undefined;
  const body = req.body as Record<string, unknown> | undefined;
  const bodyUserId =
    typeof body === "object" && body !== null
      ? (body.userId || body.user_id || (body.scope as Record<string, unknown> | undefined)?.userId)
      : undefined;
  const paramUserId = req.params?.userId;
  return queryUserId || (typeof bodyUserId === "string" ? bodyUserId : undefined) || paramUserId;
}

/**
 * Verifies that any requested scope does not exceed the authenticated principal.
 * Audits and rejects with 403 Forbidden on scope mismatch.
 */
async function verifyExportScope(req: Request, res: Response): Promise<boolean> {
  const requestedUserId = getRequestedUserId(req);
  if (requestedUserId && req.user && requestedUserId !== req.user.userId) {
    logger.warn("Cross-user export scope access attempt denied", {
      authenticatedUserId: req.user.userId,
      requestedUserId,
      path: req.originalUrl || req.path,
    });

    await auditLogService.log({
      userId: req.user.userId,
      action: AuditAction.PERMISSION_DENIED,
      severity: AuditSeverity.WARNING,
      resource: req.originalUrl || req.path,
      metadata: {
        requestedUserId,
        authenticatedUserId: req.user.userId,
        reason: "cross_user_export_scope_denied",
      },
    });

    res.status(403).json({
      success: false,
      message: "Forbidden: Export scope cannot exceed the authenticated principal",
    });
    return false;
  }
  return true;
}

/**
 * GET /export/profile - Export user profile data as JSON
 * Requires authentication
 * Constrains scope to authenticated principal
 */
router.get(
  "/profile",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      if (!(await verifyExportScope(req, res))) return;

      const userId = req.user.userId;

      logger.info("User profile export requested", { userId });

      const exportData = await dataExportService.exportUserData(userId);

      logger.info("User profile export completed", {
        userId,
        dataSize: JSON.stringify(exportData).length,
      });

      return res.status(200).json({
        success: true,
        data: exportData,
      });
    } catch (error) {
      if (error instanceof ExportOwnershipError) {
        return res.status(403).json({
          success: false,
          message: error.message,
        });
      }
      logger.error("Profile export error", {
        error,
        userId: req.user?.userId,
      });
      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to export profile data",
      });
    }
  }
);

/**
 * GET /export/download - Download user profile data as JSON file
 * Requires authentication
 * Constrains scope to authenticated principal
 */
router.get(
  "/download",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      if (!(await verifyExportScope(req, res))) return;

      const userId = req.user.userId;
      const userName = req.user.username || "user";

      logger.info("User profile download requested", { userId });

      const exportBuffer =
        await dataExportService.exportUserDataAsBuffer(userId);

      const filename = `${userName}_profile_export_${new Date().toISOString().split("T")[0]}.json`;

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.setHeader("Content-Length", exportBuffer.length.toString());

      logger.info("User profile download completed", {
        userId,
        filename,
        fileSize: exportBuffer.length,
      });

      return res.send(exportBuffer);
    } catch (error) {
      if (error instanceof ExportOwnershipError) {
        return res.status(403).json({
          success: false,
          message: error.message,
        });
      }
      logger.error("Profile download error", {
        error,
        userId: req.user?.userId,
      });
      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to download profile data",
      });
    }
  }
);

/**
 * GET /export/metadata - Get export metadata without full data
 * Requires authentication
 * Constrains scope to authenticated principal
 */
router.get(
  "/metadata",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      if (!(await verifyExportScope(req, res))) return;

      const userId = req.user.userId;

      logger.info("Export metadata requested", { userId });

      const exportData = await dataExportService.exportUserData(userId);

      const metadata = {
        exportVersion: exportData.exportMetadata.exportVersion,
        userId: exportData.exportMetadata.userId,
        statistics: exportData.statistics,
        dataCategories: {
          profile: true,
          contacts: exportData.contacts.length > 0,
          conversationHistory: exportData.conversationHistory.totalEntries > 0,
          sessions: exportData.sessions.length > 0,
        },
      };

      return res.status(200).json({
        success: true,
        data: metadata,
      });
    } catch (error) {
      if (error instanceof ExportOwnershipError) {
        return res.status(403).json({
          success: false,
          message: error.message,
        });
      }
      logger.error("Export metadata error", {
        error,
        userId: req.user?.userId,
      });
      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to retrieve export metadata",
      });
    }
  }
);

/**
 * Handler for asynchronous export request initiation
 * POST /export or POST /export/request
 * Initiates an export job bound to the authenticated principal
 */
const handleAsyncExportRequest = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!(await verifyExportScope(req, res))) return;

    const userId = req.user.userId;
    logger.info("Asynchronous export requested", { userId });

    const job = await dataExportService.requestAsyncExport(userId);

    return res.status(202).json({
      success: true,
      message: "Export request initiated successfully",
      data: {
        exportId: job.id,
        status: job.status,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        downloadUrl: `/export/download/${job.id}`,
      },
    });
  } catch (error) {
    if (error instanceof ExportOwnershipError) {
      return res.status(403).json({
        success: false,
        message: error.message,
      });
    }
    logger.error("Async export request failed", {
      error,
      userId: req.user?.userId,
    });
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to initiate export",
    });
  }
};

router.post("/", authenticateToken, handleAsyncExportRequest);
router.post("/request", authenticateToken, handleAsyncExportRequest);

/**
 * Handler for asynchronous export status retrieval
 * GET /export/status/:exportId or GET /export/:exportId
 * Verifies ownership of exportId before returning status
 */
const handleGetExportStatus = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { exportId } = req.params;
    const job = await dataExportService.getExportJob(exportId, req.user.userId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Export not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        exportId: job.id,
        status: job.status,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        downloadUrl: `/export/download/${job.id}`,
      },
    });
  } catch (error) {
    if (error instanceof ExportOwnershipError) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You do not have access to this export",
      });
    }
    logger.error("Export status retrieval error", {
      error,
      userId: req.user?.userId,
    });
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to retrieve export status",
    });
  }
};

router.get("/status/:exportId", authenticateToken, handleGetExportStatus);
router.get("/:exportId", authenticateToken, handleGetExportStatus);

/**
 * GET /export/download/:exportId - Download asynchronous export by exportId
 * Verifies ownership of exportId before streaming data
 */
router.get(
  "/download/:exportId",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const { exportId } = req.params;
      const userName = req.user.username || "user";

      const exportBuffer = await dataExportService.getExportBuffer(
        exportId,
        req.user.userId
      );

      const filename = `${userName}_profile_export_${exportId}.json`;

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.setHeader("Content-Length", exportBuffer.length.toString());

      return res.send(exportBuffer);
    } catch (error) {
      if (error instanceof ExportOwnershipError) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You do not have access to this export",
        });
      }
      if (error instanceof Error && error.message.includes("not found")) {
        return res.status(404).json({
          success: false,
          message: "Export not found",
        });
      }
      logger.error("Export download error", {
        error,
        userId: req.user?.userId,
      });
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to download export",
      });
    }
  }
);

/**
 * POST /export/erase - Permanently erase all user-owned data (GDPR/right-to-erasure)
 * Verifies scope to ensure caller can only erase their own data
 */
router.post(
  "/erase",
  authenticateToken,
  async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    if (!(await verifyExportScope(req, res))) return;

    const userId = req.user.userId;

    logger.info("User erasure requested", { userId });

    try {
      dataExportService.clearUserExports(userId);

      const result = await deletionCoordinator.eraseUser(userId, {
        reason: "user_request",
        requestedBy: userId,
      });

      const receipt = await erasureReporter.generateReceipt(result);

      logger.info("User erasure completed", {
        userId,
        stepsCompleted: result.stepsCompleted.length,
        stepsFailed: result.stepsFailed.length,
        cryptoErasurePerformed: result.cryptoErasurePerformed,
        receiptId: receipt.receiptId,
      });

      return res.status(200).json({
        success: true,
        message: "Your data has been erased. Keep the receipt as proof.",
        receipt,
      });
    } catch (err) {
      if (err instanceof HoldBlocksErasureError) {
        return res.status(409).json({
          success: false,
          message: err.message,
          holds: err.activeHolds.map((h) => ({
            holdId: h.holdId,
            reason: h.reason,
            dataClasses: h.dataClasses,
            placedAt: h.placedAt,
          })),
        });
      }

      logger.error("User erasure failed", { userId, error: err });
      return res.status(500).json({
        success: false,
        message: err instanceof Error ? err.message : "Erasure failed",
      });
    }
  }
);

/**
 * GET /export/erasure-report - Get current data lifecycle status for this user
 * Constrains scope to authenticated principal
 */
router.get(
  "/erasure-report",
  authenticateToken,
  async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    if (!(await verifyExportScope(req, res))) return;

    try {
      const report = await erasureReporter.generateReport(req.user.userId);
      return res.status(200).json({ success: true, data: report });
    } catch (err) {
      logger.error("Erasure report generation failed", { error: err, userId: req.user?.userId });
      return res.status(500).json({ success: false, message: "Failed to generate report" });
    }
  }
);

/**
 * GET /export/erasure-receipt/:receiptId - Retrieve and verify a stored erasure receipt
 * Verifies that the receipt belongs to the authenticated principal
 */
router.get(
  "/erasure-receipt/:receiptId",
  authenticateToken,
  async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    try {
      const { receiptId } = req.params;
      const receipt = await erasureReporter.getReceipt(receiptId);

      if (!receipt) {
        return res.status(404).json({ success: false, message: "Receipt not found" });
      }

      const expectedSubjectHash = crypto
        .createHash("sha256")
        .update(req.user.userId)
        .digest("hex");

      if (receipt.subjectIdHash !== expectedSubjectHash) {
        logger.warn("Cross-user erasure receipt retrieval attempt denied", {
          receiptId,
          authenticatedUserId: req.user.userId,
        });

        await auditLogService.log({
          userId: req.user.userId,
          action: AuditAction.PERMISSION_DENIED,
          severity: AuditSeverity.WARNING,
          resource: req.originalUrl || req.path,
          metadata: {
            receiptId,
            authenticatedUserId: req.user.userId,
            reason: "cross_user_erasure_receipt_access_denied",
          },
        });

        return res.status(403).json({
          success: false,
          message: "Forbidden: You do not own this erasure receipt",
        });
      }

      const valid = erasureReporter.verifyReceipt(receipt);

      return res.status(200).json({
        success: true,
        data: receipt,
        integrity: { valid },
      });
    } catch (err) {
      logger.error("Receipt retrieval failed", { error: err });
      return res.status(500).json({ success: false, message: "Failed to retrieve receipt" });
    }
  }
);

export default router;
