/**
 * AgentPlanner Usage Examples
 *
 * This file demonstrates how to use the AgentPlanner in various scenarios
 */

import { agentPlanner, planExecutor } from "./index";
import type { PlannerContext, ExecutionPlan } from "./AgentPlanner";
import logger from "../../config/logger";

/**
 * Example 1: Simple token swap
 */
export async function simpleSwapExample(userId: string) {
  const context: PlannerContext = {
    userId,
    userInput: "Swap 100 XLM to USDC",
  };

  const plan = await agentPlanner.createPlan(context);

  logger.info("Simple swap plan created", {
    planId: plan.planId,
    steps: plan.totalSteps,
    riskLevel: plan.riskLevel,
  });

  // Execute in dry-run mode first
  const dryRunResult = await planExecutor.executePlan(plan, userId, {
    dryRun: true,
  });

  if (dryRunResult.status === "success") {
    // Execute for real
    const result = await planExecutor.executePlan(plan, userId);
    return result;
  }

  throw new Error("Dry run failed");
}

/**
 * Example 2: Portfolio liquidation with approval
 */
export async function portfolioLiquidationExample(
  userId: string,
  approvalCallback: (plan: ExecutionPlan) => Promise<boolean>
) {
  const context: PlannerContext = {
    userId,
    userInput: "Liquidate half my portfolio into USDC",
    availableBalance: {
      XLM: 1000,
      USDT: 500,
    },
  };

  const plan = await agentPlanner.createPlan(context);

  logger.info("Portfolio liquidation plan", {
    summary: plan.summary,
    riskLevel: plan.riskLevel,
    requiresApproval: plan.requiresApproval,
  });

  // Request approval for high-risk operations
  if (plan.requiresApproval) {
    const approved = await approvalCallback(plan);
    if (!approved) {
      throw new Error("Plan rejected by user");
    }
  }

  // Optimize before execution
  const optimized = agentPlanner.optimizePlan(plan);

  // Execute with progress tracking
  const result = await planExecutor.executePlan(optimized, userId, {
    onStepStart: (step) => {
      logger.info(`Starting step ${step.stepNumber}: ${step.description}`);
    },
    onStepComplete: (stepResult) => {
      logger.info(
        `Completed step ${stepResult.stepNumber}: ${stepResult.status}`
      );
    },
  });

  return result;
}

/**
 * Example 3: Soroban staking operation
 */
export async function sorobanStakingExample(userId: string) {
  const context: PlannerContext = {
    userId,
    userInput: "Stake 100 tokens in contract CABC123 method stake on testnet",
  };

  const plan = await agentPlanner.createPlan(context);

  logger.info("Soroban staking plan", {
    steps: plan.steps.map((s) => ({
      step: s.stepNumber,
      action: s.action,
      description: s.description,
    })),
  });

  const result = await planExecutor.executePlan(plan, userId);
  return result;
}

/**
 * Example 4: Batch transfers with constraints
 */
export async function batchTransferExample(userId: string) {
  const context: PlannerContext = {
    userId,
    userInput: "Send 50 XLM to Alice and 30 USDC to Bob",
    constraints: {
      maxSteps: 5,
      allowedTools: ["wallet_tool", "contact_tool"],
    },
  };

  const plan = await agentPlanner.createPlan(context);

  // Validate plan meets constraints
  if (plan.totalSteps > 5) {
    throw new Error("Plan exceeds maximum steps");
  }

  const result = await planExecutor.executePlan(plan, userId);
  return result;
}

/**
 * Example 5: Error handling with rollback
 */
export async function errorHandlingExample(userId: string) {
  const context: PlannerContext = {
    userId,
    userInput: "Swap 100 XLM to USDC and then to USDT",
  };

  const plan = await agentPlanner.createPlan(context);

  const result = await planExecutor.executePlan(plan, userId, {
    stopOnError: true,
  });

  if (result.status === "failed" || result.status === "partial") {
    logger.error("Execution failed, attempting rollback", {
      completedSteps: result.completedSteps,
      error: result.error,
    });

    // Attempt rollback
    await planExecutor.rollback(plan, result, userId);

    throw new Error(`Execution failed: ${result.error}`);
  }

  return result;
}

/**
 * Example 6: Complex DeFi workflow
 */
export async function complexDefiWorkflow(userId: string) {
  const context: PlannerContext = {
    userId,
    userInput:
      "Check my XLM balance, swap half to USDC, and stake the USDC in contract CDEF456",
    availableBalance: {
      XLM: 1000,
    },
  };

  const plan = await agentPlanner.createPlan(context);

  logger.info("Complex DeFi workflow", {
    totalSteps: plan.totalSteps,
    estimatedDuration: `${plan.estimatedDuration / 1000}s`,
    riskLevel: plan.riskLevel,
  });

  // Show plan details
  plan.steps.forEach((step) => {
    logger.info(`Step ${step.stepNumber}`, {
      action: step.action,
      description: step.description,
      dependencies: step.dependencies,
      estimatedDuration: `${step.estimatedDuration}ms`,
    });
  });

  const result = await planExecutor.executePlan(plan, userId, {
    timeout: 60000, // 60 second timeout
  });

  return result;
}

/**
 * Example 7: Plan comparison and optimization
 */
export async function planOptimizationExample(userId: string) {
  const context: PlannerContext = {
    userId,
    userInput: "Check XLM balance, check USDC balance, swap XLM to USDC",
  };

  const originalPlan = await agentPlanner.createPlan(context);
  const optimizedPlan = agentPlanner.optimizePlan(originalPlan);

  logger.info("Plan optimization", {
    originalSteps: originalPlan.totalSteps,
    optimizedSteps: optimizedPlan.totalSteps,
    savedSteps: originalPlan.totalSteps - optimizedPlan.totalSteps,
  });

  // Execute optimized plan
  const result = await planExecutor.executePlan(optimizedPlan, userId);
  return result;
}

/**
 * Example 8: Real-time progress monitoring
 */
export async function progressMonitoringExample(
  userId: string,
  progressCallback: (progress: number, message: string) => void
) {
  const context: PlannerContext = {
    userId,
    userInput: "Liquidate my portfolio into USDC",
  };

  const plan = await agentPlanner.createPlan(context);
  let completedSteps = 0;

  const result = await planExecutor.executePlan(plan, userId, {
    onStepStart: (step) => {
      const progress = (completedSteps / plan.totalSteps) * 100;
      progressCallback(progress, `Starting: ${step.description}`);
    },
    onStepComplete: (stepResult) => {
      completedSteps++;
      const progress = (completedSteps / plan.totalSteps) * 100;
      progressCallback(
        progress,
        `Completed: ${stepResult.action} (${stepResult.status})`
      );
    },
  });

  progressCallback(100, "Execution complete");
  return result;
}

/**
 * Example 9: Conditional execution based on balance
 */
export async function conditionalExecutionExample(userId: string) {
  // First, check balance
  const balanceContext: PlannerContext = {
    userId,
    userInput: "Check my XLM balance",
  };

  const balancePlan = await agentPlanner.createPlan(balanceContext);
  const balanceResult = await planExecutor.executePlan(balancePlan, userId);

  // Extract balance from result
  const balance = balanceResult.stepResults[0]?.result?.data?.balance;

  if (!balance) {
    throw new Error("Could not retrieve balance");
  }

  // Create conditional plan based on balance
  const amount = parseFloat(balance.toString().split(" ")[0]);
  const swapContext: PlannerContext = {
    userId,
    userInput: amount > 100 ? "Swap 50 XLM to USDC" : "Swap 10 XLM to USDC",
    availableBalance: {
      XLM: amount,
    },
  };

  const swapPlan = await agentPlanner.createPlan(swapContext);
  const swapResult = await planExecutor.executePlan(swapPlan, userId);

  return swapResult;
}

/**
 * Example 10: Multi-user coordination (advanced)
 */
export async function multiUserCoordinationExample(
  userIds: string[],
  operation: string
) {
  const results = await Promise.all(
    userIds.map(async (userId) => {
      const context: PlannerContext = {
        userId,
        userInput: operation,
      };

      const plan = await agentPlanner.createPlan(context);
      const result = await planExecutor.executePlan(plan, userId, {
        dryRun: true, // Dry run for coordination
      });

      return { userId, result };
    })
  );

  logger.info("Multi-user coordination results", {
    totalUsers: userIds.length,
    successful: results.filter((r) => r.result.status === "success").length,
  });

  return results;
}
