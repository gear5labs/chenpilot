/**
 * Example demonstrating plan hash verification to prevent tampering
 * This shows how the system prevents hidden step injection attacks
 */

import { agentPlanner } from "./AgentPlanner";
import { planExecutor } from "./PlanExecutor";
import { planHashService } from "./planHash";

/**
 * Example 1: Normal flow with hash verification
 */
export async function exampleNormalFlow() {
  console.log("=== Example 1: Normal Flow with Hash Verification ===\n");

  // 1. Create a plan (automatically includes hash)
  const plan = await agentPlanner.createPlan({
    userId: "user123",
    userInput: "Swap 100 USDC to XLM",
  });

  console.log("Plan created:");
  console.log("- Plan ID:", plan.planId);
  console.log("- Total Steps:", plan.totalSteps);
  console.log("- Plan Hash:", plan.planHash);
  console.log("- Signature:", plan.signature ? "Present" : "Not signed");
  console.log();

  // 2. Verify hash before execution
  const isValid = planHashService.verifyPlanHash(plan);
  console.log("Hash verification:", isValid ? "✓ VALID" : "✗ INVALID");
  console.log();

  // 3. Execute with verification enabled
  try {
    const result = await planExecutor.executePlan(plan, "user123", {
      verifyHash: true,
      strictMode: true,
      dryRun: true, // Safe for example
    });

    console.log("Execution result:", result.status);
    console.log("Completed steps:", result.completedSteps);
  } catch (error) {
    console.error("Execution failed:", error);
  }
}

/**
 * Example 2: Detecting tampering - Hidden step injection
 */
export async function exampleTamperingDetection() {
  console.log("\n=== Example 2: Tampering Detection ===\n");

  // 1. Create legitimate plan
  const plan = await agentPlanner.createPlan({
    userId: "user123",
    userInput: "Swap 100 USDC to XLM",
  });

  const originalHash = plan.planHash;
  console.log("Original plan hash:", originalHash);
  console.log("Original steps:", plan.totalSteps);
  console.log();

  // 2. ATTACK: Inject hidden step (e.g., send 5% to dev wallet)
  console.log("⚠️  SIMULATING ATTACK: Injecting hidden step...");
  plan.steps.push({
    stepNumber: 999,
    action: "transfer",
    payload: {
      to: "dev_wallet_address",
      amount: "5%",
      token: "USDC",
    },
    description: "Hidden fee extraction",
  });
  plan.totalSteps = plan.steps.length;
  console.log("Malicious step injected!");
  console.log();

  // 3. Detect tampering
  const tampering = planHashService.detectTampering(originalHash, plan);
  console.log("Tampering detected:", tampering.tampered ? "✓ YES" : "✗ NO");
  console.log("Current hash:", tampering.currentHash);
  console.log("Message:", tampering.message);
  console.log();

  // 4. Attempt execution (should fail)
  console.log("Attempting to execute tampered plan...");
  try {
    await planExecutor.executePlan(plan, "user123", {
      verifyHash: true,
      strictMode: true,
    });
    console.log("❌ SECURITY FAILURE: Tampered plan was executed!");
  } catch (error) {
    console.log("✓ SECURITY SUCCESS: Execution aborted!");
    console.log("Error:", (error as Error).message);
  }
}

/**
 * Example 3: Payload modification detection
 */
export async function examplePayloadModification() {
  console.log("\n=== Example 3: Payload Modification Detection ===\n");

  // 1. Create plan
  const plan = await agentPlanner.createPlan({
    userId: "user123",
    userInput: "Transfer 100 USDC to Alice",
  });

  const originalHash = plan.planHash;
  console.log("Original plan:");
  console.log("- Hash:", originalHash);
  console.log("- Step 1 payload:", JSON.stringify(plan.steps[0]?.payload));
  console.log();

  // 2. ATTACK: Modify amount
  console.log("⚠️  SIMULATING ATTACK: Changing amount 100 -> 1000...");
  if (plan.steps[0]) {
    plan.steps[0].payload.amount = "1000";
  }
  console.log("- Modified payload:", JSON.stringify(plan.steps[0]?.payload));
  console.log();

  // 3. Verify hash
  const isValid = planHashService.verifyPlanHash(plan);
  console.log(
    "Hash verification:",
    isValid ? "✗ VALID (BAD)" : "✓ INVALID (GOOD)"
  );

  const newHash = planHashService.generatePlanHash(plan);
  console.log("Original hash:", originalHash);
  console.log("Current hash: ", newHash);
  console.log("Hashes match:", originalHash === newHash ? "YES" : "NO");
}

/**
 * Example 4: Signature verification
 */
export async function exampleSignatureVerification() {
  console.log("\n=== Example 4: Signature Verification ===\n");

  // Note: This requires PLAN_SIGNING_KEY environment variable
  const hasSigningKey = !!process.env.PLAN_SIGNING_KEY;
  console.log("Signing key configured:", hasSigningKey ? "YES" : "NO");

  if (!hasSigningKey) {
    console.log("⚠️  Skipping signature example (no signing key configured)");
    console.log("Set PLAN_SIGNING_KEY environment variable to enable signing");
    return;
  }

  // 1. Create signed plan
  const plan = await agentPlanner.createPlan({
    userId: "user123",
    userInput: "Swap 100 USDC to XLM",
  });

  console.log("\nSigned plan details:");
  console.log("- Plan Hash:", plan.planHash);
  console.log("- Signature:", plan.signature?.substring(0, 50) + "...");
  console.log("- Signed By:", plan.signedBy);
  console.log("- Signed At:", plan.signedAt);
  console.log();

  // 2. Verify signature (requires public key)
  if (process.env.PLAN_PUBLIC_KEY && plan.signature) {
    const signatureValid = planHashService.verifySignature(
      plan.planHash,
      plan.signature,
      process.env.PLAN_PUBLIC_KEY
    );
    console.log(
      "Signature verification:",
      signatureValid ? "✓ VALID" : "✗ INVALID"
    );
  }
}

/**
 * Example 5: Strict mode validations
 */
export async function exampleStrictMode() {
  console.log("\n=== Example 5: Strict Mode Validations ===\n");

  const plan = await agentPlanner.createPlan({
    userId: "user123",
    userInput: "Swap 100 USDC to XLM",
  });

  // Test with strict mode
  console.log("Executing with strict mode enabled...");
  try {
    await planExecutor.executePlan(plan, "user123", {
      verifyHash: true,
      strictMode: true,
      dryRun: true,
    });
    console.log("✓ Strict mode validation passed");
  } catch (error) {
    console.log("✗ Strict mode validation failed:", (error as Error).message);
  }
}

/**
 * Run all examples
 */
export async function runAllExamples() {
  try {
    await exampleNormalFlow();
    await exampleTamperingDetection();
    await examplePayloadModification();
    await exampleSignatureVerification();
    await exampleStrictMode();

    console.log("\n=== All Examples Completed ===\n");
  } catch (error) {
    console.error("Example failed:", error);
  }
}

// Uncomment to run examples
// runAllExamples();
