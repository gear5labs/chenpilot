import { AppDataSource } from "../../config/Datasource";
import {
  DurableExecution,
  ExecutionStatus,
  CANCELLABLE_EXECUTION_STATUSES,
} from "./DurableExecution.entity";
import { DurableStep, StepStatus } from "./DurableStep.entity";
import { toolRegistry } from "../registry/ToolRegistry";
import { ExecutionPlan } from "./AgentPlanner";
import { parallelScheduler, SchedulerOptions } from "./ParallelScheduler";
import logger from "../../config/logger";
import {
  getSocketManager,
  RealtimeEventType,
} from "../../Gateway/socketManager";

export interface DurableExecutionResult {
  executionId: string;
  status: ExecutionStatus;
  completedSteps: number;
  totalSteps: number;
  error?: string;
}

/**
 * Thrown internally when the executor detects that the execution has been
 * cancelled while a step is in progress. The `run()` method catches this
 * to finalise the CANCELLED state without treating the abort as an error.
 */
class ExecutionCancelledError extends Error {
  constructor(executionId: string) {
    super(`Execution ${executionId} was cancelled`);
    this.name = "ExecutionCancelledError";
  }
}

export class DurableExecutor {
  private executionRepo = AppDataSource.getRepository(DurableExecution);
  private stepRepo = AppDataSource.getRepository(DurableStep);

  private async checkCancelled(executionId: string): Promise<void> {
    const freshExecution = await this.executionRepo.findOne({
      where: { id: executionId },
    });

    if (freshExecution?.status === ExecutionStatus.CANCELLED) {
      throw new ExecutionCancelledError(executionId);
    }
  }

  /**
   * Starts a new durable execution from a plan.
   *
   * @param plan - The execution plan.
   * @param userId - The user who owns this execution.
   * @param context - Optional extra context persisted alongside the execution.
   * @param parallel - When true (default: auto-detected from step dependencies),
   *   the execution is handed to the ParallelScheduler which runs independent
   *   steps concurrently, serializes conflicting resources, persists the wave
   *   schedule for deterministic replay, and applies compensation on partial
   *   branch failure.  When false, the original sequential `run()` loop is used.
   * @param schedulerOptions - Optional tuning for the ParallelScheduler.
   */
  async startExecution(
    plan: ExecutionPlan,
    userId: string,
    context: Record<string, unknown> = {},
    parallel?: boolean,
    schedulerOptions?: SchedulerOptions
  ): Promise<DurableExecution> {
    // Auto-detect parallelism: if any step declares explicit dependencies,
    // use the parallel scheduler; otherwise fall back to the sequential loop.
    const hasExplicitDeps = plan.steps.some(
      (s) => s.dependencies && s.dependencies.length > 0
    );
    const useParallel = parallel ?? hasExplicitDeps;

    const execution = new DurableExecution();
    execution.planId = plan.planId;
    execution.userId = userId;
    execution.status = ExecutionStatus.PENDING;
    execution.context = { ...context, parallel: useParallel };
    execution.currentStepNumber = 1;
    execution.riskLevel = plan.riskLevel;
    execution.requiresApproval = plan.requiresApproval;

    execution.steps = plan.steps.map((step) => {
      const durableStep = new DurableStep();
      durableStep.stepNumber = step.stepNumber;
      durableStep.action = step.action;
      durableStep.payload = step.payload;
      durableStep.status = StepStatus.PENDING;
      durableStep.maxRetries = 3;
      durableStep.requiresApproval = !!step.requiresApproval;
      return durableStep;
    });

    const savedExecution = await this.executionRepo.save(execution);

    if (execution.requiresApproval) {
      execution.status = ExecutionStatus.AWAITING_APPROVAL;
      await this.executionRepo.save(execution);
      this.emitUpdate(RealtimeEventType.AGENT_APPROVAL_REQUIRED, execution);
      logger.info("Durable execution awaiting plan-level approval", {
        executionId: execution.id,
        parallel: useParallel,
      });
      return savedExecution;
    }

    if (useParallel) {
      parallelScheduler
        .run(savedExecution, plan, schedulerOptions)
        .catch((err) => {
          logger.error("Error in parallel background execution", {
            executionId: savedExecution.id,
            error: err,
          });
        });
    } else {
      this.run(savedExecution.id).catch((err) => {
        logger.error("Error in background execution", {
          executionId: savedExecution.id,
          error: err,
        });
      });
    }

    return savedExecution;
  }

  /**
   * Resumes a paused or failed execution
   */
  async resumeExecution(
    executionId: string,
    approvedBy?: string
  ): Promise<void> {
    const execution = await this.executionRepo.findOne({
      where: { id: executionId },
      relations: ["steps"],
    });

    if (!execution) throw new Error("Execution not found");
    if (execution.status === ExecutionStatus.COMPLETED) return;
    if (execution.status === ExecutionStatus.CANCELLED) {
      throw new Error("Cannot resume a cancelled execution");
    }

    if (execution.status === ExecutionStatus.AWAITING_APPROVAL) {
      execution.approvedAt = new Date();
      execution.approvedBy = approvedBy;
      execution.status = ExecutionStatus.RUNNING;
      await this.executionRepo.save(execution);
    }

    const currentStep = execution.steps.find(
      (s) => s.stepNumber === execution.currentStepNumber
    );
    if (currentStep && currentStep.status === StepStatus.AWAITING_APPROVAL) {
      currentStep.approvedAt = new Date();
      currentStep.approvedBy = approvedBy;
      currentStep.status = StepStatus.PENDING;
      await this.stepRepo.save(currentStep);
    }

    execution.status = ExecutionStatus.RUNNING;
    await this.executionRepo.save(execution);

    await this.run(executionId);
  }

  /**
   * Request cancellation of a durable execution.
   *
   * Idempotency contract:
   *   - If the execution is already CANCELLED, the method returns the
   *     existing record without writing.
   *   - If the execution is in a terminal state other than CANCELLED
   *     (COMPLETED or FAILED), the call throws — cancellation of an
   *     irreversible outcome must never be silently accepted.
   *
   * Authorization:
   *   - `requestedBy` must equal the execution's `userId`, unless the
   *     caller passes `bypassOwnerCheck: true` (intended for admin /
   *     operator paths that have already validated their own privilege).
   *
   * Safe-point guard:
   *   - Cancellation is durably written only while the execution is in a
   *     cancellable state. If a concurrent `run()` loop is currently
   *     executing a step, it will detect the CANCELLED flag at the next
   *     safe-point check and stop before invoking the following step's
   *     side effect.
   */
  async cancelExecution(
    executionId: string,
    requestedBy: string,
    reason?: string,
    bypassOwnerCheck = false
  ): Promise<DurableExecution> {
    const execution = await this.executionRepo.findOne({
      where: { id: executionId },
      relations: ["steps"],
    });

    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (!bypassOwnerCheck && execution.userId !== requestedBy) {
      throw new Error(
        `Forbidden: user ${requestedBy} cannot cancel execution owned by ${execution.userId}`
      );
    }

    if (execution.status === ExecutionStatus.CANCELLED) {
      return execution;
    }

    if (
      execution.status === ExecutionStatus.COMPLETED ||
      execution.status === ExecutionStatus.FAILED
    ) {
      throw new Error(
        `Cannot cancel execution in terminal state '${execution.status}'. ` +
          `Cancellation must be requested before irreversible steps are confirmed.`
      );
    }

    if (!CANCELLABLE_EXECUTION_STATUSES.has(execution.status)) {
      throw new Error(
        `Execution ${executionId} is in non-cancellable state '${execution.status}'`
      );
    }

    const pendingSteps = execution.steps.filter(
      (s) =>
        s.status === StepStatus.PENDING ||
        s.status === StepStatus.AWAITING_APPROVAL
    );
    if (pendingSteps.length > 0) {
      for (const step of pendingSteps) {
        step.status = StepStatus.CANCELLED;
      }
      await this.stepRepo.save(pendingSteps);
    }

    execution.status = ExecutionStatus.CANCELLED;
    execution.cancelledAt = new Date();
    execution.cancelledBy = requestedBy;
    execution.cancellationReason = reason ?? null;
    const saved = await this.executionRepo.save(execution);

    this.emitUpdate(RealtimeEventType.AGENT_EXECUTION_FAILED, saved);

    logger.info("Durable execution cancelled", {
      executionId: saved.id,
      requestedBy,
      reason,
    });

    return saved;
  }

  /**
   * Main execution loop
   */
  private async run(executionId: string): Promise<void> {
    const execution = await this.executionRepo.findOne({
      where: { id: executionId },
      relations: ["steps"],
      order: { steps: { stepNumber: "ASC" } },
    });

    if (!execution) return;
    if (execution.status === ExecutionStatus.CANCELLED) {
      return;
    }

    if (execution.requiresApproval && !execution.approvedAt) {
      execution.status = ExecutionStatus.AWAITING_APPROVAL;
      await this.executionRepo.save(execution);
      this.emitUpdate(RealtimeEventType.AGENT_APPROVAL_REQUIRED, execution);
      return;
    }

    execution.status = ExecutionStatus.RUNNING;
    await this.executionRepo.save(execution);

    this.emitUpdate(RealtimeEventType.AGENT_EXECUTION_STARTED, execution);

    try {
      for (const step of execution.steps) {
        if (step.status === StepStatus.COMPLETED) continue;

        await this.checkCancelled(executionId);

        execution.currentStepNumber = step.stepNumber;
        await this.executionRepo.save(execution);

        if (step.requiresApproval && !step.approvedAt) {
          step.status = StepStatus.AWAITING_APPROVAL;
          await this.stepRepo.save(step);

          execution.status = ExecutionStatus.AWAITING_APPROVAL;
          await this.executionRepo.save(execution);

          this.emitUpdate(RealtimeEventType.AGENT_APPROVAL_REQUIRED, execution);
          logger.info("Execution suspended for step approval", {
            executionId,
            stepNumber: step.stepNumber,
          });
          return;
        }

        const success = await this.executeStepWithRetries(
          step,
          execution.userId,
          executionId
        );

        if (success) {
          this.emitUpdate(
            RealtimeEventType.AGENT_STEP_COMPLETED,
            execution,
            step.result
          );
        } else {
          execution.status = ExecutionStatus.FAILED;
          execution.errorMessage = `Step ${step.stepNumber} (${step.action}) failed after ${step.retryCount} retries: ${step.error}`;
          await this.executionRepo.save(execution);

          this.emitUpdate(RealtimeEventType.AGENT_EXECUTION_FAILED, execution);
          return;
        }
      }

      execution.status = ExecutionStatus.COMPLETED;
      await this.executionRepo.save(execution);

      this.emitUpdate(RealtimeEventType.AGENT_EXECUTION_COMPLETED, execution);
      logger.info("Durable execution completed", { executionId: execution.id });
    } catch (error) {
      if (error instanceof ExecutionCancelledError) {
        logger.info("Durable execution run() terminated due to cancellation", {
          executionId,
        });
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      execution.status = ExecutionStatus.FAILED;
      execution.errorMessage = errorMessage;
      await this.executionRepo.save(execution);

      this.emitUpdate(RealtimeEventType.AGENT_EXECUTION_FAILED, execution);
      logger.error("Durable execution failed", {
        executionId: execution.id,
        error: errorMessage,
      });
    }
  }

  private emitUpdate(
    type: RealtimeEventType,
    execution: DurableExecution,
    result?: unknown
  ) {
    try {
      const socketManager = getSocketManager();
      socketManager.getEventEmitter().emitAgentExecutionUpdate(type, {
        executionId: execution.id,
        planId: execution.planId,
        userId: execution.userId,
        status: execution.status,
        currentStep: execution.currentStepNumber,
        totalSteps: execution.steps.length,
        result,
        error: execution.errorMessage,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.warn("Failed to emit socket update", { error });
    }
  }

  private async executeStepWithRetries(
    step: DurableStep,
    userId: string,
    executionId: string
  ): Promise<boolean> {
    while (step.retryCount < step.maxRetries) {
      await this.checkCancelled(executionId);

      step.status = StepStatus.RUNNING;
      step.startedAt = new Date();
      await this.stepRepo.save(step);

      try {
        const result = await toolRegistry.executeTool(
          step.action,
          step.payload,
          userId
        );

        if (result.status === "success") {
          step.status = StepStatus.COMPLETED;
          step.result = result;
          step.completedAt = new Date();
          await this.stepRepo.save(step);
          return true;
        }

        throw new Error(
          result.error || "Tool execution returned failed status"
        );
      } catch (error) {
        step.retryCount++;
        step.error = error instanceof Error ? error.message : "Unknown error";
        step.status = StepStatus.FAILED;
        await this.stepRepo.save(step);

        logger.warn(
          `Step ${step.stepNumber} failed, attempt ${step.retryCount}/${step.maxRetries}`,
          {
            executionId: step.execution?.id,
            action: step.action,
            error: step.error,
          }
        );

        if (step.retryCount < step.maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, step.retryCount) * 1000)
          );
        }
      }
    }
    return false;
  }

  /**
   * Operator repair: Manual retry of a failed step
   */
  async repairRetryStep(
    executionId: string,
    stepNumber: number
  ): Promise<void> {
    const step = await this.stepRepo.findOne({
      where: { execution: { id: executionId }, stepNumber },
      relations: ["execution"],
    });

    if (!step) throw new Error("Step not found");

    step.status = StepStatus.PENDING;
    step.retryCount = 0;
    step.error = undefined;
    await this.stepRepo.save(step);

    return this.resumeExecution(executionId);
  }

  /**
   * Operator repair: Skip a failed step
   */
  async repairSkipStep(
    executionId: string,
    stepNumber: number,
    resultOverride?: unknown
  ): Promise<void> {
    const step = await this.stepRepo.findOne({
      where: { execution: { id: executionId }, stepNumber },
      relations: ["execution"],
    });

    if (!step) throw new Error("Step not found");

    step.status = StepStatus.COMPLETED;
    step.result = resultOverride || { skipped: true, manualIntervention: true };
    step.completedAt = new Date();
    await this.stepRepo.save(step);

    return this.resumeExecution(executionId);
  }

  /**
   * Operator repair: Update step payload and retry
   */
  async repairUpdateAndRetry(
    executionId: string,
    stepNumber: number,
    newPayload: unknown
  ): Promise<void> {
    const step = await this.stepRepo.findOne({
      where: { execution: { id: executionId }, stepNumber },
      relations: ["execution"],
    });

    if (!step) throw new Error("Step not found");

    step.payload = newPayload;
    step.status = StepStatus.PENDING;
    step.retryCount = 0;
    step.error = undefined;
    await this.stepRepo.save(step);

    return this.resumeExecution(executionId);
  }

  /**
   * Get all active (running/failed/paused) executions for operator visibility
   */
  async getActiveExecutions(): Promise<DurableExecution[]> {
    return this.executionRepo.find({
      where: [
        { status: ExecutionStatus.RUNNING },
        { status: ExecutionStatus.FAILED },
        { status: ExecutionStatus.PAUSED },
      ],
      relations: ["steps"],
      order: { updatedAt: "DESC" },
    });
  }
}

export const durableExecutor = new DurableExecutor();
