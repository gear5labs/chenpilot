import { Router, Request, Response } from "express";
import { authenticateToken } from "../Auth/auth.middleware";
import { DataExportService } from "./DataExportService";
import logger from "../config/logger";

const router = Router();
const dataExportService = new DataExportService();

/**
 * GET /export/profile - Export user profile data as JSON
 * Requires authentication
 * Returns all user data in standardized JSON format
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
 * Returns JSON file for download
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
 * Returns summary of what would be exported
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

export default router;
