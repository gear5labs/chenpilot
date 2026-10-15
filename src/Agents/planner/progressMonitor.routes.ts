import { Router } from "express";
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireAdminAuth } from "../../Gateway/middleware/adminAuth";
import { progressMonitorService } from "./ProgressMonitor.service";
import logger from "../../config/logger";

const router = Router();

router.use(authenticateToken);

/**
 * GET /planner/progress/health
 * Get execution health statistics including stuck executions
 */
router.get("/health", requireAdminAuth(), async (_req, res) => {
  try {
    const healthStats = await progressMonitorService.getExecutionHealthStats();

    return res.status(200).json({
      success: true,
      data: healthStats,
    });
  } catch (error) {
    logger.error("Error fetching execution health stats", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch execution health stats",
    });
  }
});

/**
 * GET /planner/progress/stuck
 * Get list of stuck executions only
 */
router.get("/stuck", requireAdminAuth(), async (_req, res) => {
  try {
    const stuckExecutions = await progressMonitorService.detectStuckExecutions();

    return res.status(200).json({
      success: true,
      data: stuckExecutions,
      total: stuckExecutions.length,
    });
  } catch (error) {
    logger.error("Error detecting stuck executions", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to detect stuck executions",
    });
  }
});

/**
 * POST /planner/progress/config
 * Update progress monitor configuration
 */
router.post("/config", requireAdminAuth(), async (req, res) => {
  try {
    const config = req.body;

    // Validate config
    if (config.maxRunningDuration !== undefined && config.maxRunningDuration < 0) {
      return res.status(400).json({
        success: false,
        message: "maxRunningDuration must be positive",
      });
    }

    if (config.maxStepRunningDuration !== undefined && config.maxStepRunningDuration < 0) {
      return res.status(400).json({
        success: false,
        message: "maxStepRunningDuration must be positive",
      });
    }

    if (config.maxStaleDuration !== undefined && config.maxStaleDuration < 0) {
      return res.status(400).json({
        success: false,
        message: "maxStaleDuration must be positive",
      });
    }

    if (config.maxRetryCount !== undefined && config.maxRetryCount < 0) {
      return res.status(400).json({
        success: false,
        message: "maxRetryCount must be positive",
      });
    }

    progressMonitorService.updateConfig(config);

    logger.info("Progress monitor configuration updated", {
      updatedBy: req.user?.userId,
      config,
    });

    return res.status(200).json({
      success: true,
      message: "Progress monitor configuration updated",
    });
  } catch (error) {
    logger.error("Error updating progress monitor config", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to update progress monitor configuration",
    });
  }
});

export default router;
