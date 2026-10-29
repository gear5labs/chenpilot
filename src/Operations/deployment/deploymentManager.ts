// chenpilot/src/Operations/deployment/deploymentManager.ts
import logger from "../../config/logger";

/**
 * Deployment status
 */
export enum DeploymentStatus {
  IDLE = "idle",
  DRAINING = "draining",
  FENCED = "fenced",
  UPGRADING = "upgrading",
  PAUSED = "paused",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * Instance state for deployment coordination
 */
export interface CriticalHealth {
  agent: boolean;
  dataFlows: boolean;
}

export interface InstanceState {
  instanceId: string;
  version: string;
  status: DeploymentStatus;
  drainStartTime?: number;
  activeConnections: number;
  lastHealthCheck: number;
  /** Present only after an operator records agent and data-flow health. */
  criticalHealth?: CriticalHealth;
}

/**
 * Deployment configuration
 */
export interface DeploymentConfig {
  instanceId: string;
  targetVersion: string;
  drainTimeoutMs: number;
  minHealthyInstances: number;
  enableVersionFencing: boolean;
  /** How long to wait for agent and data-flow health before rolling back. */
  healthTimeoutMs?: number;
}

/**
 * Deployment result
 */
export interface DeploymentResult {
  success: boolean;
  message: string;
  completedAt: number;
  durationMs: number;
}

/**
 * Manages zero-downtime deployment with connection draining and version fencing
 */
export class DeploymentManager {
  private instances: Map<string, InstanceState> = new Map();
  private currentVersion: string = "1.0.0";
  private deploymentStatus: DeploymentStatus = DeploymentStatus.IDLE;
  private paused = false;
  private versionFenceEnabled = false;

  constructor(initialVersion: string = "1.0.0") {
    this.currentVersion = initialVersion;
  }

  /**
   * Register an instance for deployment coordination
   */
  registerInstance(instanceId: string, version: string): void {
    this.instances.set(instanceId, {
      instanceId,
      version,
      status: DeploymentStatus.IDLE,
      activeConnections: 0,
      lastHealthCheck: Date.now(),
    });

    logger.info(`Registered instance ${instanceId} with version ${version}`);
  }

  /**
   * Unregister an instance
   */
  unregisterInstance(instanceId: string): void {
    this.instances.delete(instanceId);
    logger.info(`Unregistered instance ${instanceId}`);
  }

  /**
   * Update active connection count for an instance
   */
  updateActiveConnections(instanceId: string, count: number): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.activeConnections = count;
      instance.lastHealthCheck = Date.now();
    }
  }

  /**
   * Get instance state
   */
  getInstanceState(instanceId: string): InstanceState | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * Get all instances
   */
  getAllInstances(): InstanceState[] {
    return Array.from(this.instances.values());
  }

  /**
   * Get instances by version
   */
  getInstancesByVersion(version: string): InstanceState[] {
    return this.getAllInstances().filter(
      (instance) => instance.version === version
    );
  }

  /**
   * Get instances by status
   */
  getInstancesByStatus(status: DeploymentStatus): InstanceState[] {
    return this.getAllInstances().filter((instance) => instance.status === status);
  }

  /**
   * Start draining connections from an instance
   */
  async startDrain(instanceId: string, config: DeploymentConfig): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    if (instance.status !== DeploymentStatus.IDLE) {
      throw new Error(
        `Instance ${instanceId} is not in IDLE state (current: ${instance.status})`
      );
    }

    instance.status = DeploymentStatus.DRAINING;
    instance.drainStartTime = Date.now();

    logger.info(`Started draining instance ${instanceId}`, {
      activeConnections: instance.activeConnections,
    });

    // Wait for connections to drain or timeout
    const drainDeadline = Date.now() + config.drainTimeoutMs;

    while (Date.now() < drainDeadline) {
      if (instance.activeConnections === 0) {
        logger.info(`Instance ${instanceId} drained successfully`);
        return;
      }

      // Wait before checking again
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Timeout - force drain
    logger.warn(
      `Instance ${instanceId} drain timeout after ${config.drainTimeoutMs}ms, forcing drain`
    );
  }

  /**
   * Enable version fencing for an instance
   */
  enableVersionFencing(instanceId: string, targetVersion: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    instance.status = DeploymentStatus.FENCED;
    logger.info(`Enabled version fencing for instance ${instanceId}`, {
      targetVersion,
    });
  }

  /**
   * Stop new cutovers and new work until an operator resumes or reverts.
   */
  pause(): void {
    this.paused = true;
    this.deploymentStatus = DeploymentStatus.PAUSED;
    logger.info("Deployment paused");
  }

  resume(): void {
    this.paused = false;
    if (this.deploymentStatus === DeploymentStatus.PAUSED) {
      this.deploymentStatus = DeploymentStatus.IDLE;
    }
    logger.info("Deployment resumed");
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Instances whose version does not match the version currently in service.
   */
  detectVersionDrift(): string[] {
    return this.getAllInstances()
      .filter((instance) => instance.version !== this.currentVersion)
      .map((instance) => instance.instanceId);
  }

  /**
   * Record agent and data-flow health. A failed check blocks the cutover.
   */
  recordCriticalHealth(instanceId: string, health: CriticalHealth): void {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }
    if (typeof health.agent !== "boolean" || typeof health.dataFlows !== "boolean") {
      throw new Error("agent and dataFlows health flags are required");
    }
    instance.criticalHealth = { agent: health.agent, dataFlows: health.dataFlows };
    instance.lastHealthCheck = Date.now();
  }

  /**
   * Move every instance back to a known version and clear a pause.
   */
  revertToVersion(version: string): void {
    if (!version.trim()) {
      throw new Error("version is required");
    }
    for (const instance of this.getAllInstances()) {
      instance.version = version;
      instance.status = DeploymentStatus.IDLE;
      instance.criticalHealth = undefined;
    }
    this.currentVersion = version;
    this.paused = false;
    this.deploymentStatus = DeploymentStatus.IDLE;
    logger.warn("Reverted deployment", { version });
  }

  /**
   * Check if an instance should accept requests based on version fencing
   */
  shouldAcceptRequest(instanceId: string, minVersion?: string): boolean {
    if (this.paused) {
      return false;
    }

    const instance = this.instances.get(instanceId);
    if (!instance) {
      return false;
    }

    if (
      this.versionFenceEnabled &&
      instance.version !== this.currentVersion
    ) {
      return false;
    }

    // If fenced, only accept requests if version matches
    if (instance.status === DeploymentStatus.FENCED) {
      if (minVersion && instance.version !== minVersion) {
        return false;
      }
    }

    // If draining, only accept if no newer version available
    if (instance.status === DeploymentStatus.DRAINING) {
      const newerInstances = this.getInstancesByVersion(this.currentVersion).filter(
        (i) => i.status === DeploymentStatus.IDLE && i.instanceId !== instanceId
      );

      if (newerInstances.length > 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Execute a zero-downtime deployment
   */
  async executeDeployment(config: DeploymentConfig): Promise<DeploymentResult> {
    const startTime = Date.now();

    if (this.paused) {
      return {
        success: false,
        message: "Deployment paused",
        completedAt: Date.now(),
        durationMs: Date.now() - startTime,
      };
    }

    this.deploymentStatus = DeploymentStatus.UPGRADING;
    this.versionFenceEnabled = config.enableVersionFencing;

    logger.info("Starting zero-downtime deployment", config);

    try {
      // Step 1: Verify minimum healthy instances
      const healthyInstances = this.getInstancesByStatus(DeploymentStatus.IDLE);
      if (healthyInstances.length < config.minHealthyInstances) {
        throw new Error(
          `Insufficient healthy instances: ${healthyInstances.length} (required: ${config.minHealthyInstances})`
        );
      }

      // Step 2: Roll out new version to subset of instances
      const instancesToUpgrade = healthyInstances.slice(
        0,
        Math.ceil(healthyInstances.length / 2)
      );

      for (const instance of instancesToUpgrade) {
        // Drain connections
        await this.startDrain(instance.instanceId, config);

        // Enable version fencing if configured
        if (config.enableVersionFencing) {
          this.enableVersionFencing(instance.instanceId, config.targetVersion);
        }

        // Upgrade instance (simulated - in production, this would trigger actual deployment)
        instance.version = config.targetVersion;
        instance.status = DeploymentStatus.IDLE;

        logger.info(`Upgraded instance ${instance.instanceId} to ${config.targetVersion}`);
      }

      // Step 3: Wait for health checks
      await this.waitForHealthChecks(
        instancesToUpgrade,
        config.healthTimeoutMs ?? 30000
      );

      // Step 4: Upgrade remaining instances
      const remainingInstances = this.getInstancesByVersion(this.currentVersion).filter(
        (i) => i.status === DeploymentStatus.IDLE
      );

      for (const instance of remainingInstances) {
        await this.startDrain(instance.instanceId, config);

        if (config.enableVersionFencing) {
          this.enableVersionFencing(instance.instanceId, config.targetVersion);
        }

        instance.version = config.targetVersion;
        instance.status = DeploymentStatus.IDLE;

        logger.info(`Upgraded instance ${instance.instanceId} to ${config.targetVersion}`);
      }

      // Update current version
      this.currentVersion = config.targetVersion;
      this.deploymentStatus = DeploymentStatus.COMPLETED;

      const duration = Date.now() - startTime;

      logger.info("Deployment completed successfully", {
        durationMs: duration,
        newVersion: config.targetVersion,
      });

      return {
        success: true,
        message: "Deployment completed successfully",
        completedAt: Date.now(),
        durationMs: duration,
      };
    } catch (error) {
      this.deploymentStatus = DeploymentStatus.FAILED;
      const duration = Date.now() - startTime;

      logger.error("Deployment failed", { error, durationMs: duration });

      // Rollback to previous state
      await this.rollbackDeployment(config);

      return {
        success: false,
        message: `Deployment failed: ${error instanceof Error ? error.message : String(error)}`,
        completedAt: Date.now(),
        durationMs: duration,
      };
    }
  }

  /**
   * Rollback a failed deployment
   */
  private async rollbackDeployment(config: DeploymentConfig): Promise<void> {
    logger.warn("Starting deployment rollback", config);

    const upgradedInstances = this.getInstancesByVersion(config.targetVersion);

    for (const instance of upgradedInstances) {
      instance.version = this.currentVersion;
      instance.status = DeploymentStatus.IDLE;

      logger.info(`Rolled back instance ${instance.instanceId} to ${this.currentVersion}`);
    }

    this.deploymentStatus = DeploymentStatus.IDLE;
  }

  /**
   * Wait for health checks on instances
   */
  private async waitForHealthChecks(
    instances: InstanceState[],
    timeoutMs: number
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const allHealthy = instances.every((instance) =>
        this.isInstanceHealthy(instance)
      );

      if (allHealthy) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error("Health check timeout");
  }

  private isInstanceHealthy(instance: InstanceState): boolean {
    const fresh = Date.now() - instance.lastHealthCheck < 5000;
    if (!fresh) {
      return false;
    }
    if (!instance.criticalHealth) {
      return true;
    }
    return instance.criticalHealth.agent && instance.criticalHealth.dataFlows;
  }

  /**
   * Get current deployment status
   */
  getDeploymentStatus(): DeploymentStatus {
    return this.deploymentStatus;
  }

  /**
   * Get current version
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }
}

export const deploymentManager = new DeploymentManager();
