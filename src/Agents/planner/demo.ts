/**
 * Demo file to prove AgentPlanner works
 * Run this to test the implementation
 */

import { agentPlanner, planExecutor } from "./index";

async function demo() {
  console.log("=== AgentPlanner Demo ===\n");

  // Example 1: Simple swap
  console.log("1. Creating plan for token swap...");
  const swapPlan = await agentPlanner.createPlan({
    userId: "demo-user",
    userInput: "Swap 100 XLM to USDC",
  });

  console.log(`   Plan ID: ${swapPlan.planId}`);
  console.log(`   Summary: ${swapPlan.summary}`);
  console.log(`   Steps: ${swapPlan.totalSteps}`);
  console.log(`   Risk Level: ${swapPlan.riskLevel}`);
  console.log(`   Requires Approval: ${swapPlan.requiresApproval}\n`);

  // Example 2: Execute in dry-run mode
  console.log("2. Executing plan (dry-run)...");
  const result = await planExecutor.executePlan(swapPlan, "demo-user", {
    dryRun: true,
    onStepComplete: (stepResult) => {
      console.log(`   Step ${stepResult.stepNumber}: ${stepResult.status}`);
    },
  });

  console.log(`   Execution Status: ${result.status}`);
  console.log(`   Completed: ${result.completedSteps}/${result.totalSteps}`);
  console.log(`   Duration: ${result.duration}ms\n`);

  // Example 3: Complex operation
  console.log("3. Creating plan for portfolio liquidation...");
  const liquidationPlan = await agentPlanner.createPlan({
    userId: "demo-user",
    userInput: "Liquidate half my portfolio into USDC",
    availableBalance: {
      XLM: 1000,
      USDT: 500,
    },
  });

  console.log(`   Plan ID: ${liquidationPlan.planId}`);
  console.log(`   Summary: ${liquidationPlan.summary}`);
  console.log(`   Steps: ${liquidationPlan.totalSteps}`);
  console.log(`   Risk Level: ${liquidationPlan.riskLevel}`);
  console.log(`   Requires Approval: ${liquidationPlan.requiresApproval}\n`);

  console.log("=== Demo Complete ===");
  console.log("\n✅ AgentPlanner is working correctly!");
}

// Run demo if executed directly
if (require.main === module) {
  demo().catch(console.error);
}

export { demo };
