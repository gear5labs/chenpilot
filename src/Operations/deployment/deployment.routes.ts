// chenpilot/src/Operations/deployment/deployment.routes.ts
import { Router, Request, Response } from "express";
import {
  deploymentManager,
  DeploymentConfig,
  DeploymentStatus,
} from "./deploymentManager";

const router = Router();

/**
 * Register an instance for deployment coordination
 */
router.post("/register", (req: Request, res: Response) => {
  try {
    const { instanceId, version } = req.body;

    if (!instanceId || !version) {
      return res.status(400).json({
        error: "instanceId and version are required",
      });
    }

    deploymentManager.registerInstance(instanceId, version);

    res.json({
      success: true,
      message: `Instance ${instanceId} registered`,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Unregister an instance
 */
router.post("/unregister", (req: Request, res: Response) => {
  try {
    const { instanceId } = req.body;

    if (!instanceId) {
      return res.status(400).json({
        error: "instanceId is required",
      });
    }

    deploymentManager.unregisterInstance(instanceId);

    res.json({
      success: true,
      message: `Instance ${instanceId} unregistered`,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Update active connection count for an instance
 */
router.post("/connections", (req: Request, res: Response) => {
  try {
    const { instanceId, count } = req.body;

    if (!instanceId || count === undefined) {
      return res.status(400).json({
        error: "instanceId and count are required",
      });
    }

    deploymentManager.updateActiveConnections(instanceId, count);

    res.json({
      success: true,
      message: `Updated connections for ${instanceId}`,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get all instances
 */
router.get("/instances", (req: Request, res: Response) => {
  try {
    const instances = deploymentManager.getAllInstances();

    res.json({
      success: true,
      instances,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get instance state
 */
router.get("/instances/:instanceId", (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    const instance = deploymentManager.getInstanceState(instanceId);

    if (!instance) {
      return res.status(404).json({
        error: `Instance ${instanceId} not found`,
      });
    }

    res.json({
      success: true,
      instance,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Execute a zero-downtime deployment
 */
router.post("/deploy", async (req: Request, res: Response) => {
  try {
    const config: DeploymentConfig = req.body;

    if (!config.instanceId || !config.targetVersion) {
      return res.status(400).json({
        error: "instanceId and targetVersion are required",
      });
    }

    // Set defaults
    config.drainTimeoutMs = config.drainTimeoutMs || 30000;
    config.minHealthyInstances = config.minHealthyInstances || 1;
    config.enableVersionFencing = config.enableVersionFencing !== false;

    const result = await deploymentManager.executeDeployment(config);

    res.json({
      success: result.success,
      message: result.message,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get deployment status
 */
router.get("/status", (req: Request, res: Response) => {
  try {
    const status = deploymentManager.getDeploymentStatus();
    const currentVersion = deploymentManager.getCurrentVersion();

    res.json({
      success: true,
      status,
      currentVersion,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Check if an instance should accept requests
 */
router.get("/instances/:instanceId/should-accept", (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    const { minVersion } = req.query;

    const shouldAccept = deploymentManager.shouldAcceptRequest(
      instanceId,
      minVersion as string | undefined
    );

    res.json({
      success: true,
      shouldAccept,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Pause cutovers and new work.
 */
router.post("/pause", (_req: Request, res: Response) => {
  deploymentManager.pause();
  res.json({ success: true, status: deploymentManager.getDeploymentStatus() });
});

/**
 * Allow cutovers again after a pause.
 */
router.post("/resume", (_req: Request, res: Response) => {
  deploymentManager.resume();
  res.json({ success: true, status: deploymentManager.getDeploymentStatus() });
});

/**
 * Roll every instance back to a known version.
 */
router.post("/revert", (req: Request, res: Response) => {
  try {
    const version = req.body?.version;
    if (typeof version !== "string" || !version.trim()) {
      return res.status(400).json({ error: "version is required" });
    }
    deploymentManager.revertToVersion(version);
    res.json({
      success: true,
      currentVersion: deploymentManager.getCurrentVersion(),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * List instances that are not on the version currently in service.
 */
router.get("/drift", (_req: Request, res: Response) => {
  res.json({
    success: true,
    driftedInstanceIds: deploymentManager.detectVersionDrift(),
  });
});

export default router;
