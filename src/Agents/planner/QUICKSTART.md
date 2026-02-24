# AgentPlanner Quick Start Guide

Get started with AgentPlanner in 5 minutes!

## Installation

No installation needed - it's already part of your project!

## Basic Usage

### 1. Import the Module

```typescript
import { agentPlanner, planExecutor } from "./Agents/planner";
```

### 2. Create Your First Plan

```typescript
const plan = await agentPlanner.createPlan({
  userId: "user123",
  userInput: "Swap 100 XLM to USDC",
});

console.log(plan.summary);
// Output: "Plan for 'Swap 100 XLM to USDC': Check XLM balance → Swap 100 XLM for USDC"
```

### 3. Execute the Plan

```typescript
const result = await planExecutor.executePlan(plan, "user123", {
  dryRun: true, // Test without executing
});

console.log(`Status: ${result.status}`);
console.log(`Completed: ${result.completedSteps}/${result.totalSteps}`);
```

## Common Use Cases

### Portfolio Liquidation

```typescript
const plan = await agentPlanner.createPlan({
  userId: "user123",
  userInput: "Liquidate half my portfolio into USDC",
  availableBalance: {
    XLM: 1000,
    USDT: 500,
  },
});

// Review before executing
if (plan.requiresApproval) {
  console.log(`⚠️  Risk Level: ${plan.riskLevel}`);
  plan.steps.forEach((step) => {
    console.log(`  ${step.stepNumber}. ${step.description}`);
  });
}

// Execute
const result = await planExecutor.executePlan(plan, "user123");
```

### Token Swap

```typescript
const plan = await agentPlanner.createPlan({
  userId: "user123",
  userInput: "Swap 100 XLM to USDC",
});

const result = await planExecutor.executePlan(plan, "user123");

if (result.status === "success") {
  console.log("✅ Swap completed!");
}
```

### Soroban Contract Interaction

```typescript
const plan = await agentPlanner.createPlan({
  userId: "user123",
  userInput: "Stake 100 tokens in contract CABC123 method stake on testnet",
});

const result = await planExecutor.executePlan(plan, "user123");
```

### Batch Operations

```typescript
const plan = await agentPlanner.createPlan({
  userId: "user123",
  userInput: "Send 50 XLM to Alice and 30 USDC to Bob",
});

const result = await planExecutor.executePlan(plan, "user123");
```

## Progress Tracking

```typescript
const result = await planExecutor.executePlan(plan, "user123", {
  onStepStart: (step) => {
    console.log(`⏳ Starting: ${step.description}`);
  },
  onStepComplete: (stepResult) => {
    console.log(`✅ Completed: ${stepResult.action}`);
  },
});
```

## Error Handling

```typescript
const result = await planExecutor.executePlan(plan, "user123", {
  stopOnError: true,
});

if (result.status === "failed") {
  console.error(`❌ Error: ${result.error}`);

  // Attempt rollback
  await planExecutor.rollback(plan, result, "user123");
}
```

## Testing Plans

Always test with dry-run first:

```typescript
// Test without executing
const dryRunResult = await planExecutor.executePlan(plan, "user123", {
  dryRun: true,
});

if (dryRunResult.status === "success") {
  // Now execute for real
  const result = await planExecutor.executePlan(plan, "user123");
}
```

## Plan Optimization

```typescript
const plan = await agentPlanner.createPlan({
  userId: "user123",
  userInput: "Check XLM balance twice and swap",
});

// Remove redundant steps
const optimized = agentPlanner.optimizePlan(plan);

console.log(`Optimized: ${plan.totalSteps} → ${optimized.totalSteps} steps`);
```

## Constraints

Limit what the planner can do:

```typescript
const plan = await agentPlanner.createPlan({
  userId: "user123",
  userInput: "Do complex operations",
  constraints: {
    maxSteps: 5,
    allowedTools: ["wallet_tool", "swap_tool"],
  },
});
```

## API Integration

Add to your Express routes:

```typescript
import { agentPlanner, planExecutor } from "../Agents/planner";

router.post("/agent/plan", async (req, res) => {
  const { userId, userInput } = req.body;

  const plan = await agentPlanner.createPlan({
    userId,
    userInput,
  });

  res.json({ plan });
});

router.post("/agent/execute", async (req, res) => {
  const { userId, planId } = req.body;

  // Retrieve plan from storage
  const plan = getPlanById(planId);

  const result = await planExecutor.executePlan(plan, userId);

  res.json({ result });
});
```

## Tips

1. **Always use dry-run first** for testing
2. **Review high-risk plans** before execution
3. **Optimize plans** to improve efficiency
4. **Handle errors gracefully** with rollback
5. **Track progress** with callbacks
6. **Set constraints** to limit complexity

## What Can It Do?

The planner understands:

- ✅ Balance checks
- ✅ Token transfers
- ✅ Token swaps
- ✅ Portfolio liquidation
- ✅ Soroban contract calls
- ✅ Batch operations
- ✅ Complex DeFi workflows

## Examples

```typescript
// Simple
"Check my XLM balance";
"Transfer 50 XLM to Alice";
"Swap 100 XLM to USDC";

// Complex
"Liquidate half my portfolio into USDC";
"Check all balances and swap everything to USDC";
"Stake 100 tokens in contract CABC...";

// DeFi
"Check my balance, swap half to USDC, and stake the USDC";
"Borrow 50 USDC and swap to XLM";
```

## Need Help?

- 📖 Read the [full documentation](./README.md)
- 💡 Check [examples](./examples.ts)
- 🔧 See [API integration guide](./API_INTEGRATION.md)
- 📝 Review [implementation details](./IMPLEMENTATION.md)

## Next Steps

1. Try the examples above
2. Create your own plans
3. Integrate into your API
4. Add authentication
5. Build a UI for plan approval

Happy planning! 🚀
