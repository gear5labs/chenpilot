import { toolRegistry } from "../registry/ToolRegistry";
import { ToolResult } from "../registry/ToolMetadata";
import { ExecutionPlan, PlanStep } from "./AgentPlanner";
import logger from "../../config/logger";

export interface ExecutionResult {
  planId: string;
  status: "success" | "partial" | "failed";
  completedSteps: number;
  totalSteps: number;
  stepResults: StepResult[];
  error?: string;
  duration: number;
}

export interface StepResult {
  stepNumber: number;
  action: string;
  status: "success" | "failed" | "skipped";
  result?: ToolResult;
  error?: string;
  duration: number;
  timestamp: string;
}

export interface ExecutionOptions {
  stopOnError?: boolean;
  dryRun?: boolean;
  timeout?: number;
  onStepComplete?: (result: StepResult) => void;
  onStepStart?: (step: PlanStep) => void;
}

export class PlanExecutor {
  private readonly DEFAULT_TIMEOUT = 60000;

  async executePlan(
    plan: ExecutionPlan,
    userId: string,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    let completedSteps = 0;

    logger.info("Starting plan execution", {
      planId: plan.planId,
      userId,
      totalSteps: plan.totalSteps,
      dryRun: options.dryRun || false,
    });

    try {
      for (const step of plan.steps) {
        const elapsed = Date.now() - startTime;
        const timeout = options.timeout || this.DEFAULT_TIMEOUT;
        if (elapsed > timeout) {
          throw new Error(`Execution timeout after ${elapsed}ms`);
        }

        const stepResult = await this.executeStep(step, userId, options);
        stepResults.push(stepResult);

        if (stepResult.status === "success") {
          completedSteps++;
        } else if (
          stepResult.status === "failed" &&
          options.stopOnError !== false
        ) {
          break;
        }

        if (options.onStepComplete) {
          options.onStepComplete(stepResult);
        }
      }

      const duration = Date.now() - startTime;
      const status = this.determineExecutionStatus(
        completedSteps,
        plan.totalSteps
      );

      return {
        planId: plan.planId,
        status,
        completedSteps,
        totalSteps: plan.totalSteps,
        stepResults,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      return {
        planId: plan.planId,
        status: "failed",
        completedSteps,
        totalSteps: plan.totalSteps,
        stepResults,
        error: errorMessage,
        duration,
      };
    }
  }

  private async executeStep(
    step: PlanStep,
    userId: string,
    options: ExecutionOptions
  ): Promise<StepResult> {
    const startTime = Date.now();

    if (options.onStepStart) {
      options.onStepStart(step);
    }

    try {
      if (options.dryRun) {
        return {
          stepNumber: step.stepNumber,
          action: step.action,
          status: "success",
          result: {
            action: step.action,
            status: "success",
            message: "Dry run - not executed",
            data: { dryRun: true },
          },
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const result = await toolRegistry.executeTool(
        step.action,
        step.payload,
        userId
      );

      return {
        stepNumber: step.stepNumber,
        action: step.action,
        status: "success",
        result,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      return {
        stepNumber: step.stepNumber,
        action: step.action,
        status: "failed",
        error: errorMessage,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  private determineExecutionStatus(
    completedSteps: number,
    totalSteps: number
  ): "success" | "partial" | "failed" {
    if (completedSteps === totalSteps) return "success";
    if (completedSteps > 0) return "partial";
    return "failed";
  }

  async rollback(
    plan: ExecutionPlan,
    executionResult: ExecutionResult
  ): Promise<void> {
    logger.info("Starting rollback", {
      planId: plan.planId,
      completedSteps: executionResult.completedSteps,
    });
  }
}

export const planExecutor = new PlanExecutor();
