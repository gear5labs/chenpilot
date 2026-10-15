/**
 * ProgressMonitor.service.ts
 *
 * Service for detecting durable executions that are making no progress.
 * Monitors executions and steps to identify stuck or hung workflows.
 *
 * Detection criteria:
 * - Executions stuck in RUNNING status for extended periods
 * - Steps stuck in RUNNING status beyond timeout thresholds
 * - Executions stuck in AWAITING_APPROVAL past their expiry
 * - No progress updates (updatedAt) for extended periods
 * - Excessive retry counts without success
 */

import AppDataSource from "../../config/Datasource";
import {
  DurableExecution,
  ExecutionStatus,
} from "./DurableExecution.entity";
import { DurableStep, StepStatus } from "./DurableStep.entity";
import logger from "../../config/logger";

export interface StuckExecution {
  executionId: string;
  userId: string;
  status: ExecutionStatus;
  currentStepNumber: number;
  totalSteps: number;
  stuckReason: string;
  stuckDuration: number; // milliseconds
  lastActivity: Date;
  metadata?: {
    stepStuckDuration?: number;
    stuckStepNumber?: number;
    retryCount?: number;
    expiresAt?: Date;
  };
}

export interface ProgressMonitorConfig {
  /** Maximum time (ms) an execution can be in RUNNING status before being flagged */
  maxRunningDuration: number;
  /** Maximum time (ms) a step can be in RUNNING status before being flagged */
  maxStepRunningDuration: number;
  /** Maximum time (ms) an execution can have no updatedAt changes */
  maxStaleDuration: number;
  /** Maximum retry count before flagging as potentially stuck */
  maxRetryCount: number;
}

const DEFAULT_CONFIG: ProgressMonitorConfig = {
  maxRunningDuration: 30 * 60 * 1000, // 30 minutes
  maxStepRunningDuration: 10 * 60 * 1000, // 10 minutes
  maxStaleDuration: 60 * 60 * 1000, // 1 hour
  maxRetryCount: 5,
};

export class ProgressMonitorService {
  private config: ProgressMonitorConfig;
  private executionRepo = AppDataSource.getRepository(DurableExecution);
  private stepRepo = AppDataSource.getRepository(DurableStep);

  constructor(config?: Partial<ProgressMonitorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect executions that are making no progress.
   * Returns a list of stuck executions with details about why they're stuck.
   */
  async detectStuckExecutions(): Promise<StuckExecution[]> {
    const stuckExecutions: StuckExecution[] = [];
    const now = new Date();

    // 1. Check executions stuck in RUNNING status
    const runningExecutions = await this.executionRepo.find({
      where: { status: ExecutionStatus.RUNNING },
      relations: ["steps"],
    });

    for (const execution of runningExecutions) {
      const runningDuration = now.getTime() - execution.updatedAt.getTime();

      if (runningDuration > this.config.maxRunningDuration) {
        // Check if any step is stuck in RUNNING
        const stuckStep = execution.steps.find(
          (step) =>
            step.status === StepStatus.RUNNING &&
            step.startedAt &&
            now.getTime() - step.startedAt.getTime() > this.config.maxStepRunningDuration
        );

        stuckExecutions.push({
          executionId: execution.id,
          userId: execution.userId,
          status: execution.status,
          currentStepNumber: execution.currentStepNumber,
          totalSteps: execution.steps.length,
          stuckReason: stuckStep
            ? `Step ${stuckStep.stepNumber} stuck in RUNNING for ${Math.floor(
                (now.getTime() - (stuckStep.startedAt?.getTime() || 0)) / 60000
              )} minutes`
            : `Execution stuck in RUNNING for ${Math.floor(runningDuration / 60000)} minutes`,
          stuckDuration: runningDuration,
          lastActivity: execution.updatedAt,
          metadata: stuckStep
            ? {
                stepStuckDuration: now.getTime() - (stuckStep.startedAt?.getTime() || 0),
                stuckStepNumber: stuckStep.stepNumber,
                retryCount: stuckStep.retryCount,
              }
            : undefined,
        });
      }
    }

    // 2. Check executions stuck in AWAITING_APPROVAL past expiry
    const awaitingApprovalExecutions = await this.executionRepo.find({
      where: { status: ExecutionStatus.AWAITING_APPROVAL },
      relations: ["steps"],
    });

    for (const execution of awaitingApprovalExecutions) {
      if (execution.expiresAt && execution.expiresAt < now) {
        const expiredDuration = now.getTime() - execution.expiresAt.getTime();
        stuckExecutions.push({
          executionId: execution.id,
          userId: execution.userId,
          status: execution.status,
          currentStepNumber: execution.currentStepNumber,
          totalSteps: execution.steps.length,
          stuckReason: `Approval expired ${Math.floor(expiredDuration / 60000)} minutes ago`,
          stuckDuration: expiredDuration,
          lastActivity: execution.updatedAt,
          metadata: { expiresAt: execution.expiresAt },
        });
      }
    }

    // 3. Check executions with no progress updates (stale)
    const staleThreshold = new Date(now.getTime() - this.config.maxStaleDuration);
    const staleExecutions = await this.executionRepo
      .createQueryBuilder("execution")
      .where("execution.updatedAt < :staleThreshold", { staleThreshold })
      .andWhere(
        "execution.status IN (:...statuses)",
        { statuses: [ExecutionStatus.RUNNING, ExecutionStatus.PAUSED] }
      )
      .leftJoinAndSelect("execution.steps", "step")
      .getMany();

    for (const execution of staleExecutions) {
      // Skip if already flagged
      if (stuckExecutions.some((se) => se.executionId === execution.id)) {
        continue;
      }

      const staleDuration = now.getTime() - execution.updatedAt.getTime();
      stuckExecutions.push({
        executionId: execution.id,
        userId: execution.userId,
        status: execution.status,
        currentStepNumber: execution.currentStepNumber,
        totalSteps: execution.steps.length,
        stuckReason: `No progress updates for ${Math.floor(staleDuration / 60000)} minutes`,
        stuckDuration: staleDuration,
        lastActivity: execution.updatedAt,
      });
    }

    // 4. Check steps with excessive retry counts
    const highRetrySteps = await this.stepRepo
      .createQueryBuilder("step")
      .where("step.retryCount >= :maxRetry", {
        maxRetry: this.config.maxRetryCount,
      })
      .andWhere("step.status IN (:...statuses)", {
        statuses: [StepStatus.RUNNING, StepStatus.FAILED],
      })
      .leftJoin("step.execution", "execution")
      .andWhere(
        "execution.status IN (:...execStatuses)",
        { execStatuses: [ExecutionStatus.RUNNING, ExecutionStatus.PAUSED] }
      )
      .getMany();

    for (const step of highRetrySteps) {
      // Skip if execution already flagged
      if (stuckExecutions.some((se) => se.executionId === step.execution.id)) {
        continue;
      }

      const execution = await this.executionRepo.findOne({
        where: { id: step.execution.id },
        relations: ["steps"],
      });

      if (execution) {
        stuckExecutions.push({
          executionId: execution.id,
          userId: execution.userId,
          status: execution.status,
          currentStepNumber: execution.currentStepNumber,
          totalSteps: execution.steps.length,
          stuckReason: `Step ${step.stepNumber} has ${step.retryCount} retries without success`,
          stuckDuration: now.getTime() - execution.updatedAt.getTime(),
          lastActivity: execution.updatedAt,
          metadata: {
            stepStuckDuration: step.startedAt
              ? now.getTime() - step.startedAt.getTime()
              : undefined,
            stuckStepNumber: step.stepNumber,
            retryCount: step.retryCount,
          },
        });
      }
    }

    return stuckExecutions;
  }

  /**
   * Get a summary of execution health statistics.
   */
  async getExecutionHealthStats(): Promise<{
    total: number;
    running: number;
    awaitingApproval: number;
    paused: number;
    stuck: number;
    stuckDetails: StuckExecution[];
  }> {
    const total = await this.executionRepo.count();
    const running = await this.executionRepo.count({
      where: { status: ExecutionStatus.RUNNING },
    });
    const awaitingApproval = await this.executionRepo.count({
      where: { status: ExecutionStatus.AWAITING_APPROVAL },
    });
    const paused = await this.executionRepo.count({
      where: { status: ExecutionStatus.PAUSED },
    });

    const stuckDetails = await this.detectStuckExecutions();

    return {
      total,
      running,
      awaitingApproval,
      paused,
      stuck: stuckDetails.length,
      stuckDetails,
    };
  }

  /**
   * Log stuck executions for monitoring/alerting.
   */
  async logStuckExecutions(): Promise<void> {
    const stuckExecutions = await this.detectStuckExecutions();

    if (stuckExecutions.length > 0) {
      logger.warn("Detected stuck durable executions", {
        count: stuckExecutions.length,
        executions: stuckExecutions.map((se) => ({
          executionId: se.executionId,
          userId: se.userId,
          status: se.status,
          reason: se.stuckReason,
          duration: Math.floor(se.stuckDuration / 60000) + " minutes",
        })),
      });
    } else {
      logger.info("No stuck executions detected");
    }
  }

  /**
   * Update the monitoring configuration.
   */
  updateConfig(newConfig: Partial<ProgressMonitorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info("Progress monitor configuration updated", { config: this.config });
  }
}

export const progressMonitorService = new ProgressMonitorService();
