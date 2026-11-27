/**
 * ParallelScheduler
 *
 * Executes a dependency-graph schedule with the following guarantees:
 *
 * 1. **Parallelism** – independent steps within the same wave run concurrently.
 *
 * 2. **Resource serialization** – steps that share a conflict resource key
 *    (wallet, quote, lock, approval) are automatically serialized via the
 *    existing RedisLockService so that no two concurrent steps hold the same
 *    resource simultaneously.
 *
 * 3. **Deterministic replay** – the wave schedule is persisted to the
 *    DurableExecution's `context.schedule` field before any step runs.
 *    On replay, the persisted schedule is used verbatim so that the same
 *    ordering decisions are reproduced regardless of timing.
 *
 * 4. **Partial-branch failure & compensation** – when a step fails, all
 *    downstream dependents are cancelled.  Previously completed steps are
 *    compensated in reverse topological order via their `rollbackAction`,
 *    if provided.
 *
 * 5. **External dependency ownership** – steps may reference steps of *other*
 *    durable workflows (see `EXTERNAL_WORKFLOW_DEPENDENCIES_KEY`).  Every such
 *    reference is resolved against `SchedulerOptions.resolveExternalOwner` and
 *    rejected before any step runs unless the referenced workflow is owned by
 *    the same principal as the execution being scheduled.  When a plan declares
 *    an external dependency and no resolver is configured the run fails closed.
 */

import { AppDataSource } from "../../config/Datasource";
import { DurableExecution, ExecutionStatus } from "./DurableExecution.entity";
import { DurableStep, StepStatus } from "./DurableStep.entity";
import { ExecutionPlan, PlanStep } from "./AgentPlanner";
import {
  DependencyGraph,
  ExecutionWave,
  GraphBuildOptions,
  GraphBuildResult,
  ResourceKey,
} from "./DependencyGraph";
import { toolRegistry } from "../registry/ToolRegistry";
import { RedisLockService } from "../../services/lock/redisLock.service";
import {
  getSocketManager,
  RealtimeEventType,
} from "../../Gateway/socketManager";
import logger from "../../config/logger";
import {
  StepInputResolutionContext,
  StepInputResolutionError,
  collectCompletedStepResults,
  isStepInputResolutionError,
  resolveAndFreezeStepInputs,
} from "./stepInputResolution";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Persisted schedule entry – one record per wave. */
export interface WaveRecord {
  /** 0-indexed wave number. */
  waveIndex: number;
  /** Step numbers in this wave, deterministically sorted ascending. */
  stepNumbers: number[];
}

/** The schedule stored in DurableExecution.context.schedule. */
export type PersistedSchedule = WaveRecord[];

export interface SchedulerOptions {
  /** Lock TTL in ms for resource serialization (default 60 000). */
  resourceLockTtl?: number;
  /** How long to wait for a resource lock before giving up (default 5 000). */
  resourceLockTimeout?: number;
  /**
   * When true, the scheduler compensates completed steps after a branch
   * failure by executing each step's rollbackAction in reverse order.
   * Defaults to true.
   */
  compensateOnFailure?: boolean;
  /**
   * Authoritative ownership lookup for external workflow references declared by
   * plan steps (`externalWorkflowDependencies` in the step payload).
   *
   * It usually reads persisted `DurableExecution` rows, so it may be async; it
   * is called once per referenced execution id before the graph is built.  The
   * returned owner is compared with `execution.userId` (the principal that owns
   * the workflow being scheduled).
   *
   * When a plan declares external dependencies and this resolver is not
   * configured, the graph build fails closed instead of trusting the plan.
   */
  resolveExternalOwner?: (
    executionId: string
  ) => string | undefined | Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Internal error type for clean cancellation propagation
// ---------------------------------------------------------------------------

class ExecutionCancelledError extends Error {
  constructor(id: string) {
    super(`Execution ${id} was cancelled`);
    this.name = "ExecutionCancelledError";
  }
}

// ---------------------------------------------------------------------------
// ParallelScheduler
// ---------------------------------------------------------------------------

export class ParallelScheduler {
  private executionRepo = AppDataSource.getRepository(DurableExecution);
  private stepRepo = AppDataSource.getRepository(DurableStep);
  private lockService = new RedisLockService();

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Execute `plan` for `userId` using parallel scheduling.
   *
   * If the execution record already contains a persisted schedule it is
   * replayed verbatim; otherwise a new schedule is derived, persisted, then
   * executed.
   */
  async run(
    execution: DurableExecution,
    plan: ExecutionPlan,
    opts: SchedulerOptions = {}
  ): Promise<void> {
    const {
      resourceLockTtl = 60_000,
      compensateOnFailure = true,
    } = opts;

    const executionId = execution.id;

    // -----------------------------------------------------------------------
    // 1. Build or reload the dependency graph
    // -----------------------------------------------------------------------
    // References to other workflows are ownership-checked before any wave is
    // computed; plans that declare none are unaffected.
    const graph = DependencyGraph.build(
      plan.steps,
      await this.buildOwnershipOptions(execution, plan, opts)
    );

    // -----------------------------------------------------------------------
    // 2. Persist (or reload) the wave schedule for deterministic replay
    // -----------------------------------------------------------------------
    const schedule = await this.getOrPersistSchedule(
      execution,
      graph.waves
    );

    logger.info("ParallelScheduler starting", {
      executionId,
      waves: schedule.length,
      totalSteps: plan.steps.length,
    });

    // -----------------------------------------------------------------------
    // 3. Build a quick lookup: stepNumber → PlanStep (for rollback actions)
    // -----------------------------------------------------------------------
    const planStepMap = new Map<number, PlanStep>(
      plan.steps.map((s) => [s.stepNumber, s])
    );

    // Track which steps completed successfully so we can compensate on failure
    const completedStepNumbers: number[] = [];

    // -----------------------------------------------------------------------
    // 4. Execute waves in order
    // -----------------------------------------------------------------------
    try {
      for (const waveRecord of schedule) {
        await this.checkCancelled(executionId);

        const waveStepNumbers = waveRecord.stepNumbers;

        logger.debug("Executing wave", {
          executionId,
          waveIndex: waveRecord.waveIndex,
          steps: waveStepNumbers,
        });

        // Run all steps in this wave concurrently
        const waveResults = await Promise.allSettled(
          waveStepNumbers.map((stepNum) =>
            this.executeStepWithResourceLock(
              executionId,
              stepNum,
              execution.userId,
              graph,
              resourceLockTtl
            )
          )
        );

        // Collect failures
        const failures: { stepNum: number; error: string }[] = [];
        for (let i = 0; i < waveResults.length; i++) {
          const result = waveResults[i];
          const stepNum = waveStepNumbers[i];
          if (result.status === "rejected") {
            if (result.reason instanceof ExecutionCancelledError) {
              throw result.reason;
            }
            failures.push({
              stepNum,
              error: result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
            });
          } else {
            completedStepNumbers.push(stepNum);
          }
        }

        if (failures.length > 0) {
          const firstFailure = failures[0];
          logger.error("Wave step(s) failed", { executionId, failures });

          // Cancel downstream steps
          await this.cancelDownstreamSteps(
            executionId,
            failures.map((f) => f.stepNum),
            graph
          );

          // Compensate completed steps if requested
          if (compensateOnFailure) {
            await this.compensateCompletedSteps(
              executionId,
              completedStepNumbers,
              graph,
              planStepMap,
              execution.userId
            );
          }

          // Mark execution as failed
          await this.markExecutionFailed(
            execution,
            `Step ${firstFailure.stepNum} failed: ${firstFailure.error}`
          );
          return;
        }
      }

      // All waves completed successfully
      await this.markExecutionCompleted(execution);
    } catch (err) {
      if (err instanceof ExecutionCancelledError) {
        logger.info("ParallelScheduler terminated due to cancellation", {
          executionId,
        });
        return;
      }

      const msg = err instanceof Error ? err.message : String(err);
      await this.markExecutionFailed(execution, msg);
      logger.error("ParallelScheduler unexpected error", { executionId, error: msg });
    }
  }

  // -------------------------------------------------------------------------
  // External workflow dependency ownership
  // -------------------------------------------------------------------------

  /**
   * Assembles the ownership context handed to `DependencyGraph.build`.
   *
   * Always carries the identity of the workflow being scheduled.  When the plan
   * declares external workflow dependencies it also carries an authoritative
   * `executionId → ownerId` map resolved through
   * {@link SchedulerOptions.resolveExternalOwner}.
   *
   * The map is deliberately omitted when no resolver is configured: the graph
   * build then fails closed with `ownership_context_required` instead of
   * trusting ownership claims taken from the plan itself.
   */
  private async buildOwnershipOptions(
    execution: DurableExecution,
    plan: ExecutionPlan,
    opts: SchedulerOptions
  ): Promise<GraphBuildOptions> {
    const options: GraphBuildOptions = {
      ownerId: execution.userId,
      executionId: execution.id,
    };

    const referencedExecutionIds =
      DependencyGraph.collectExternalDependencyExecutionIds(plan.steps);
    if (referencedExecutionIds.length === 0) {
      return options;
    }

    const { resolveExternalOwner } = opts;
    if (typeof resolveExternalOwner !== "function") {
      logger.warn(
        "Plan declares external workflow dependencies without an owner resolver",
        { executionId: execution.id, referencedExecutionIds }
      );
      return options;
    }

    const externalOwners = new Map<string, string>();
    for (const referencedExecutionId of referencedExecutionIds) {
      const owner = await resolveExternalOwner(referencedExecutionId);
      if (typeof owner === "string" && owner.length > 0) {
        externalOwners.set(referencedExecutionId, owner);
      }
    }

    return { ...options, externalOwners };
  }

  // -------------------------------------------------------------------------
  // Schedule persistence & replay
  // -------------------------------------------------------------------------

  /**
   * If a schedule is already in execution.context.schedule, return it.
   * Otherwise derive it from the computed waves, persist it, and return it.
   */
  private async getOrPersistSchedule(
    execution: DurableExecution,
    waves: readonly ExecutionWave[]
  ): Promise<PersistedSchedule> {
    // Reload from DB to get latest context in case of resume
    const fresh = await this.executionRepo.findOne({
      where: { id: execution.id },
    });

    const existing = fresh?.context?.schedule as PersistedSchedule | undefined;
    if (existing && Array.isArray(existing) && existing.length > 0) {
      logger.info("Replaying persisted schedule", {
        executionId: execution.id,
        waves: existing.length,
      });
      return existing;
    }

    // Build a new schedule
    const schedule: PersistedSchedule = waves.map((wave, idx) => ({
      waveIndex: idx,
      stepNumbers: [...wave].sort((a, b) => a - b), // deterministic
    }));

    // Persist before any step runs
    if (fresh) {
      fresh.context = { ...(fresh.context ?? {}), schedule };
      await this.executionRepo.save(fresh);
    }

    logger.info("Schedule persisted", {
      executionId: execution.id,
      waves: schedule.length,
    });

    return schedule;
  }

  // -------------------------------------------------------------------------
  // Step execution with resource locking
  // -------------------------------------------------------------------------

  private async executeStepWithResourceLock(
    executionId: string,
    stepNumber: number,
    userId: string,
    graph: GraphBuildResult,
    lockTtl: number
  ): Promise<void> {
    await this.checkCancelled(executionId);

    // Load the step entity
    const step = await this.stepRepo.findOne({
      where: { execution: { id: executionId }, stepNumber },
      relations: ["execution"],
    });

    if (!step) {
      throw new Error(`Step ${stepNumber} not found for execution ${executionId}`);
    }

    if (step.status === StepStatus.COMPLETED) {
      logger.debug("Step already completed, skipping", { executionId, stepNumber });
      return;
    }

    if (step.status === StepStatus.CANCELLED) {
      throw new Error(`Step ${stepNumber} is cancelled`);
    }

    if (step.requiresApproval && !step.approvedAt) {
      // Suspend the execution for step-level approval
      step.status = StepStatus.AWAITING_APPROVAL;
      const ttlMinutes = 60; // Default 60 minutes for step approval
      const now = new Date();
      step.expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
      await this.stepRepo.save(step);

      const execution = await this.executionRepo.findOne({ where: { id: executionId } });
      if (execution) {
        execution.status = ExecutionStatus.AWAITING_APPROVAL;
        execution.currentStepNumber = stepNumber;
        if (!execution.expiresAt) {
          execution.expiresAt = step.expiresAt;
        }
        await this.executionRepo.save(execution);
        this.emitUpdate(RealtimeEventType.AGENT_APPROVAL_REQUIRED, execution);
      }

      logger.info("Execution suspended for step approval", { executionId, stepNumber, expiresAt: step.expiresAt });
      throw new Error(`Step ${stepNumber} requires approval`);
    }

    // Determine conflict resource keys for this step
    const node = graph.nodes.get(stepNumber);
    const resourceKeys: ResourceKey[] = node ? [...node.conflictResources] : [];

    // Sort keys for a consistent lock acquisition order — prevents deadlocks
    resourceKeys.sort();

    const lockIdentifier = `${executionId}:step:${stepNumber}`;
    const acquiredLocks: string[] = [];

    try {
      // Acquire all required resource locks in order
      for (const resourceKey of resourceKeys) {
        const result = await this.lockService.acquireLock(
          `scheduler:${resourceKey}`,
          lockIdentifier,
          { ttl: lockTtl, maxRetries: 20, retryDelay: 250 }
        );

        if (!result.acquired) {
          throw new Error(
            `Could not acquire resource lock for "${resourceKey}" — step ${stepNumber} serialized out`
          );
        }
        acquiredLocks.push(resourceKey);
      }

      // Execute the actual step
      await this.executeStepWithRetries(step, userId, executionId);
    } finally {
      // Always release locks (even on failure)
      for (const resourceKey of acquiredLocks) {
        await this.lockService.releaseLock(
          `scheduler:${resourceKey}`,
          lockIdentifier
        ).catch((e) =>
          logger.warn("Failed to release resource lock", { resourceKey, error: e })
        );
      }
    }
  }

  private async executeStepWithRetries(
    step: DurableStep,
    userId: string,
    executionId: string
  ): Promise<void> {
    // Values this step's placeholders may reference. Loaded once per step: a
    // frozen snapshot is reused on every retry, so no re-read is needed
    // (issue #809).
    const inputContext = await this.buildInputResolutionContext(executionId);

    while (step.retryCount < step.maxRetries) {
      await this.checkCancelled(executionId);

      // Freeze the resolved inputs durably *before* the side effect, so a
      // retry or a resume replays the same inputs instead of re-deriving them.
      let inputs: Record<string, unknown>;
      try {
        inputs = await resolveAndFreezeStepInputs(
          step,
          inputContext,
          this.stepRepo
        );
      } catch (error) {
        if (!isStepInputResolutionError(error)) throw error;
        await this.failUnresolvedStepInputs(step, error);
        // No retry: the failure is deterministic. Propagating lets the wave
        // handler cancel downstream steps and compensate completed branches.
        throw error;
      }

      step.status = StepStatus.RUNNING;
      step.startedAt = new Date();
      await this.stepRepo.save(step);

      try {
        const result = await toolRegistry.executeTool(
          step.action,
          inputs,
          userId
        );

        if (result.status === "success") {
          step.status = StepStatus.COMPLETED;
          step.result = result;
          step.completedAt = new Date();
          await this.stepRepo.save(step);

          // Update execution's current step pointer
          const execution = await this.executionRepo.findOne({
            where: { id: executionId },
          });
          if (execution) {
            execution.currentStepNumber = step.stepNumber;
            await this.executionRepo.save(execution);
            this.emitUpdate(RealtimeEventType.AGENT_STEP_COMPLETED, execution, result);
          }

          logger.debug("Step completed", { executionId, stepNumber: step.stepNumber });
          return;
        }

        throw new Error(result.error ?? "Tool execution returned failed status");
      } catch (err) {
        if (err instanceof ExecutionCancelledError) throw err;

        step.retryCount++;
        step.error = err instanceof Error ? err.message : "Unknown error";
        step.status = StepStatus.FAILED;
        await this.stepRepo.save(step);

        logger.warn(
          `Step ${step.stepNumber} failed, attempt ${step.retryCount}/${step.maxRetries}`,
          { executionId, action: step.action, error: step.error }
        );

        if (step.retryCount < step.maxRetries) {
          await this.delay(Math.pow(2, step.retryCount) * 1_000);
        }
      }
    }

    throw new Error(
      `Step ${step.stepNumber} (${step.action}) failed after ${step.maxRetries} retries: ${step.error}`
    );
  }

  // -------------------------------------------------------------------------
  // Resolved-input helpers
  // -------------------------------------------------------------------------

  /**
   * Snapshot the values a step's placeholders may reference: the results of
   * steps that already completed, plus the execution's `context` column.
   */
  private async buildInputResolutionContext(
    executionId: string
  ): Promise<StepInputResolutionContext> {
    const [steps, execution] = await Promise.all([
      this.stepRepo.find({ where: { execution: { id: executionId } } }),
      this.executionRepo.findOne({ where: { id: executionId } }),
    ]);

    return {
      stepResults: collectCompletedStepResults(steps),
      context: execution?.context ?? {},
    };
  }

  /**
   * Persist the FAILED state of a step whose inputs could not be resolved.
   *
   * The refusal happens before any side effect; recording it on the step keeps
   * the operator-visible audit trail complete before the error propagates to
   * the wave handler.
   */
  private async failUnresolvedStepInputs(
    step: DurableStep,
    error: StepInputResolutionError
  ): Promise<void> {
    step.status = StepStatus.FAILED;
    step.error = `Unresolved step inputs (${error.code}): ${error.message}`;
    await this.stepRepo.save(step);

    logger.error(
      "Refusing to execute step: resolved inputs could not be frozen",
      {
        stepNumber: step.stepNumber,
        action: step.action,
        code: error.code,
        location: error.location,
        error: error.message,
      }
    );
  }

  // -------------------------------------------------------------------------
  // Downstream cancellation
  // -------------------------------------------------------------------------

  private async cancelDownstreamSteps(
    executionId: string,
    failedStepNumbers: number[],
    graph: GraphBuildResult
  ): Promise<void> {
    const toCancel = new Set<number>();
    for (const failedNum of failedStepNumbers) {
      for (const downstream of DependencyGraph.getDownstreamSteps(failedNum, graph.nodes)) {
        toCancel.add(downstream);
      }
    }

    if (toCancel.size === 0) return;

    logger.info("Cancelling downstream steps", {
      executionId,
      failedSteps: failedStepNumbers,
      cancelledSteps: [...toCancel],
    });

    const steps = await this.stepRepo.find({
      where: { execution: { id: executionId } },
    });

    const now = new Date();
    const toCancelEntities = steps.filter(
      (s) =>
        toCancel.has(s.stepNumber) &&
        s.status !== StepStatus.COMPLETED &&
        s.status !== StepStatus.CANCELLED
    );

    for (const s of toCancelEntities) {
      s.status = StepStatus.CANCELLED;
      s.cancelledAt = now;
    }

    if (toCancelEntities.length > 0) {
      await this.stepRepo.save(toCancelEntities);
    }
  }

  // -------------------------------------------------------------------------
  // Compensation (rollback of completed steps in reverse order)
  // -------------------------------------------------------------------------

  private async compensateCompletedSteps(
    executionId: string,
    completedStepNumbers: readonly number[],
    graph: GraphBuildResult,
    planStepMap: ReadonlyMap<number, PlanStep>,
    userId: string
  ): Promise<void> {
    if (completedStepNumbers.length === 0) return;

    const compensationOrder = DependencyGraph.getCompensationOrder(
      completedStepNumbers,
      graph.nodes
    );

    logger.info("Starting compensation", {
      executionId,
      compensationOrder,
    });

    for (const stepNum of compensationOrder) {
      const planStep = planStepMap.get(stepNum);
      if (!planStep?.rollbackAction) {
        logger.debug("No rollback action for step, skipping compensation", {
          executionId,
          stepNumber: stepNum,
        });
        continue;
      }

      try {
        logger.info("Compensating step", {
          executionId,
          stepNumber: stepNum,
          rollbackAction: planStep.rollbackAction.action,
        });

        await toolRegistry.executeTool(
          planStep.rollbackAction.action,
          planStep.rollbackAction.payload,
          userId
        );

        logger.info("Compensation succeeded", { executionId, stepNumber: stepNum });
      } catch (err) {
        // Compensation failures are logged but do not stop the compensation loop —
        // we want to attempt all rollbacks even if one fails.
        logger.error("Compensation failed for step", {
          executionId,
          stepNumber: stepNum,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async checkCancelled(executionId: string): Promise<void> {
    const fresh = await this.executionRepo.findOne({ where: { id: executionId } });
    if (fresh?.status === ExecutionStatus.CANCELLED) {
      throw new ExecutionCancelledError(executionId);
    }
  }

  private async markExecutionCompleted(execution: DurableExecution): Promise<void> {
    const fresh = await this.executionRepo.findOne({ where: { id: execution.id } });
    if (!fresh) return;
    fresh.status = ExecutionStatus.COMPLETED;
    await this.executionRepo.save(fresh);
    this.emitUpdate(RealtimeEventType.AGENT_EXECUTION_COMPLETED, fresh);
    logger.info("Parallel execution completed", { executionId: execution.id });
  }

  private async markExecutionFailed(
    execution: DurableExecution,
    errorMessage: string
  ): Promise<void> {
    const fresh = await this.executionRepo.findOne({ where: { id: execution.id } });
    if (!fresh) return;
    fresh.status = ExecutionStatus.FAILED;
    fresh.errorMessage = errorMessage;
    await this.executionRepo.save(fresh);
    this.emitUpdate(RealtimeEventType.AGENT_EXECUTION_FAILED, fresh);
    logger.error("Parallel execution failed", {
      executionId: execution.id,
      errorMessage,
    });
  }

  private emitUpdate(
    type: RealtimeEventType,
    execution: DurableExecution,
    result?: unknown
  ): void {
    try {
      const socketManager = getSocketManager();
      socketManager.getEventEmitter().emitAgentExecutionUpdate(type, {
        executionId: execution.id,
        planId: execution.planId,
        userId: execution.userId,
        status: execution.status,
        currentStep: execution.currentStepNumber,
        totalSteps: execution.steps?.length ?? 0,
        result,
        error: execution.errorMessage,
        timestamp: new Date(),
      });
    } catch {
      // Socket emission is best-effort; never fail a step because of it
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const parallelScheduler = new ParallelScheduler();
