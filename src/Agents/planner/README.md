# AgentPlanner - Multi-Step DeFi Operations

The AgentPlanner module provides intelligent planning and execution for complex DeFi operations. It breaks down user requests into sequential, executable steps.

## Features

- **Intelligent Planning**: Uses LLM to analyze complex requests and generate execution plans
- **Multi-Step Orchestration**: Handles operations requiring multiple tool invocations
- **Dependency Management**: Ensures steps execute in the correct order
- **Risk Assessment**: Evaluates plan risk level (low/medium/high)
- **Rollback Support**: Provides rollback actions for critical operations
- **Dry-Run Mode**: Test plans without executing actual transactions
- **Progress Tracking**: Real-time callbacks for step execution
- **Plan Optimization**: Removes redundant steps automatically

## Architecture

```mermaid
flowchart TD
  U[User Input] --> AP[AgentPlanner]

  AP -->|Analyze with LLM\n+ specialized parsers| LLM[AgentLLM / External LLM]
  LLM -->|WorkflowPlan (JSON)| AP

  AP -->|Generate| EP[ExecutionPlan\n(steps, deps, risk)]
  EP --> PE[PlanExecutor]

  PE -->|Execute steps via ToolRegistry| TR[ToolRegistry\n+ Registered Tools]
  TR -->|ToolResult(s)| PE

  PE --> ER[ExecutionResult\n(status, metrics, stepResults)]
  ER --> U
```

## Usage Examples

### Basic Usage

```typescript
import { agentPlanner, planExecutor } from "./Agents/planner";

// Create a plan
const context = {
  userId: "user123",
  userInput: "Swap 100 XLM to USDC",
};

const plan = await agentPlanner.createPlan(context);

// Execute the plan
const result = await planExecutor.executePlan(plan, "user123");

console.log(`Status: ${result.status}`);
console.log(`Completed: ${result.completedSteps}/${result.totalSteps}`);
```

### Complex Portfolio Liquidation

```typescript
const context = {
  userId: "user123",
  userInput: "Liquidate half my portfolio into USDC",
  availableBalance: {
    XLM: 1000,
    USDT: 500,
    USDC: 200,
  },
};

const plan = await agentPlanner.createPlan(context);

console.log(`Plan: ${plan.summary}`);
console.log(`Risk Level: ${plan.riskLevel}`);
console.log(`Requires Approval: ${plan.requiresApproval}`);

// Review plan before execution
if (plan.requiresApproval) {
  // Show plan to user for approval
  plan.steps.forEach((step) => {
    console.log(`Step ${step.stepNumber}: ${step.description}`);
  });
}

// Execute with progress tracking
const result = await planExecutor.executePlan(plan, "user123", {
  onStepComplete: (stepResult) => {
    console.log(`Completed: ${stepResult.action} - ${stepResult.status}`);
  },
});
```

### Dry-Run Testing

```typescript
const plan = await agentPlanner.createPlan({
  userId: "user123",
  userInput: "Transfer 50 XLM to Alice and 30 USDC to Bob",
});

// Test without executing
const result = await planExecutor.executePlan(plan, "user123", {
  dryRun: true,
});

console.log(`Dry run completed: ${result.status}`);
```

### With Constraints

```typescript
const context = {
  userId: "user123",
  userInput: "Optimize my portfolio",
  constraints: {
    maxSteps: 5,
    allowedTools: ["wallet_tool", "swap_tool"],
    maxSlippage: 0.02, // 2%
  },
};

const plan = await agentPlanner.createPlan(context);
```

### Soroban Contract Interaction

```typescript
const context = {
  userId: "user123",
  userInput: "Stake 100 tokens in contract CABC123 method stake on testnet",
};

const plan = await agentPlanner.createPlan(context);

// Plan will include:
// 1. Balance check
// 2. Soroban contract invocation
```

### Plan Optimization

```typescript
const plan = await agentPlanner.createPlan(context);

// Remove redundant steps
const optimized = agentPlanner.optimizePlan(plan);

console.log(`Original steps: ${plan.totalSteps}`);
console.log(`Optimized steps: ${optimized.totalSteps}`);
```

### Error Handling and Rollback

```typescript
const plan = await agentPlanner.createPlan(context);

const result = await planExecutor.executePlan(plan, "user123", {
  stopOnError: true,
});

if (result.status === "failed" || result.status === "partial") {
  console.log("Execution failed, attempting rollback...");
  await planExecutor.rollback(plan, result, "user123");
}
```

## Supported Operations

### Wallet Operations

- Balance checks: "Check my XLM balance"
- Transfers: "Send 50 XLM to Alice"
- Address retrieval: "What's my wallet address?"

### Trading Operations

- Token swaps: "Swap 100 XLM to USDC"
- Multi-hop swaps: "Convert XLM to USDT via USDC"
- Portfolio liquidation: "Liquidate half my portfolio into USDC"

### Soroban Contract Operations

- Contract invocation: "Call stake method on contract CABC..."
- DeFi protocols: "Stake 100 tokens", "Borrow 50 USDC"
- Custom contracts: "Invoke method claim with args [100]"

### Complex Multi-Step Operations

- "Check all balances and swap everything to USDC"
- "Transfer 10% of each token to Bob"
- "Stake half my XLM and lend the rest"

## API Reference

### AgentPlanner

#### `createPlan(context: PlannerContext): Promise<ExecutionPlan>`

Creates an execution plan from user input.

**Parameters:**

- `context.userId`: User identifier
- `context.userInput`: Natural language request
- `context.availableBalance`: Optional balance information
- `context.constraints`: Optional execution constraints

**Returns:** ExecutionPlan with ordered steps

#### `optimizePlan(plan: ExecutionPlan): ExecutionPlan`

Optimizes a plan by removing redundant steps.

### PlanExecutor

#### `executePlan(plan: ExecutionPlan, userId: string, options?: ExecutionOptions): Promise<ExecutionResult>`

Executes a plan.

**Options:**

- `dryRun`: Test without executing (default: false)
- `stopOnError`: Stop on first error (default: true)
- `timeout`: Maximum execution time in ms (default: 60000)
- `onStepComplete`: Callback for step completion
- `onStepStart`: Callback for step start

**Returns:** ExecutionResult with status and step results

#### `rollback(plan: ExecutionPlan, result: ExecutionResult, userId: string): Promise<void>`

Attempts to rollback executed steps (best effort).

## Types

### ExecutionPlan

```typescript
{
  planId: string;
  steps: PlanStep[];
  totalSteps: number;
  estimatedDuration: number;
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  summary: string;
}
```

### PlanStep

```typescript
{
  stepNumber: number;
  action: string;
  payload: Record<string, unknown>;
  description: string;
  dependencies?: number[];
  estimatedDuration?: number;
  rollbackAction?: WorkflowStep;
}
```

### ExecutionResult

```typescript
{
  planId: string;
  status: "success" | "partial" | "failed";
  completedSteps: number;
  totalSteps: number;
  stepResults: StepResult[];
  error?: string;
  duration: number;
}
```

## External Workflow Dependencies

A step can depend on the result of a step that belongs to a **different** durable
workflow — for example a settlement workflow that consumes the escrow created by
an earlier trade workflow. Such a dependency is declared inside the step payload:

```jsonc
{
  "stepNumber": 4,
  "action": "release_escrow",
  "description": "Release escrow created by the trade workflow",
  "payload": {
    "escrowId": "$ref:steps.2.result.data.escrowId",
    "externalWorkflowDependencies": [
      { "executionId": "0f2c5f38-…", "stepNumber": 3 },
    ],
  },
}
```

Each entry is `{ executionId, stepNumber, ownerId? }`:

| Field         | Required | Meaning                                                           |
| ------------- | -------- | ----------------------------------------------------------------- |
| `executionId` | yes      | `DurableExecution.id` of the external workflow                    |
| `stepNumber`  | yes      | Positive integer step number inside that workflow                 |
| `ownerId`     | no       | Owner recorded by the planner; must match the authoritative owner |

The declaration lives in the payload, so it is covered by the canonical plan hash
(`PlanHashService`, re-computed by the SDK's `PlanVerifier`): a reference cannot be
added, re-pointed, or removed after approval without invalidating the plan hash.

### Ownership rules

`DependencyGraph.build(steps, options)` validates every external reference **before
computing a single wave**. Validation is fail-closed — a refusal throws
`ExternalDependencyOwnershipError` carrying a machine-readable `code`:

| Code                         | Meaning                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ownership_context_required` | The plan declares external dependencies, but the caller supplied no authoritative owner map (`GraphBuildOptions.externalOwners`) — or no plan owner (`ownerId`) while cross-owner references are not allowed |
| `malformed_reference`        | The declaration is not `{ executionId, stepNumber }` with a non-empty id, a positive integer step, and an optional non-empty `ownerId`                                                                       |
| `duplicate_reference`        | One step declares the same external step twice                                                                                                                                                               |
| `self_reference`             | The step points at `GraphBuildOptions.executionId`, i.e. the workflow being built; use `PlanStep.dependencies` instead                                                                                       |
| `unverifiable_ownership`     | `externalOwners` has no entry for the referenced execution                                                                                                                                                   |
| `owner_mismatch`             | The planner-declared `ownerId` disagrees with the authoritative owner, or the authoritative owner is another principal and `allowCrossOwner` is not set                                                      |

An `ownerId` carried in the payload is **never trusted on its own**: it is only
compared against the authoritative map, which callers must build from persisted
execution records. Plans that declare no external dependency are unaffected by the
new options parameter and keep their previous behaviour exactly.

### Scheduler integration

`ParallelScheduler.run` resolves owners through
`SchedulerOptions.resolveExternalOwner` (sync or async, called once per referenced
execution id) and passes them to the graph build together with the execution's own
`userId` / `id`. If a plan declares external dependencies and no resolver is
configured, the graph build fails closed instead of trusting the plan:

```typescript
await durableExecutor.startExecution(plan, userId, context, true, {
  resolveExternalOwner: async (executionId) => {
    const upstream = await AppDataSource.getRepository(
      DurableExecution
    ).findOne({
      where: { id: executionId },
    });
    return upstream?.userId;
  },
});
```

`DependencyGraph.collectExternalDependencyExecutionIds(steps)` returns the sorted,
de-duplicated ids a plan references — the set the resolver is called with.

**API note (additive):** `DependencyGraph.build` gained an optional second parameter
(`GraphBuildOptions`), and `SchedulerOptions` gained the optional
`resolveExternalOwner`. No existing signature, default, or wave schedule changed.

## Risk Assessment

Plans are automatically assessed for risk:

- **Low Risk**: Single operation, read-only, or simple transfers
- **Medium Risk**: 2-4 operations, token swaps, moderate complexity
- **High Risk**: 5+ operations, complex DeFi interactions, large amounts

High-risk plans automatically require approval.

## Best Practices

1. **Always review high-risk plans** before execution
2. **Use dry-run mode** to test complex operations
3. **Provide balance context** for better planning
4. **Set appropriate constraints** to limit plan complexity
5. **Handle errors gracefully** with rollback support
6. **Monitor execution progress** with callbacks
7. **Optimize plans** before execution to improve efficiency

## Testing

Run the test suite:

```bash
npm test tests/unit/agent_planner.test.ts
```

## Future Enhancements

- [ ] Parallel step execution for independent operations
- [ ] Cost estimation for each step
- [ ] Historical plan analytics
- [ ] Plan templates for common operations
- [ ] Advanced rollback strategies
- [ ] Multi-user coordination
- [ ] Gas optimization
