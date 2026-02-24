# API Integration Guide for AgentPlanner

This guide shows how to integrate the AgentPlanner into your Express API routes.

## Quick Integration

### 1. Add Routes to `src/Gateway/routes.ts`

```typescript
import { agentPlanner, planExecutor } from "../Agents/planner";
import type { ExecutionPlan } from "../Agents/planner";

// Store plans temporarily (in production, use Redis or database)
const planStore = new Map<string, ExecutionPlan>();

// POST /agent/plan - Create execution plan
router.post("/agent/plan", async (req: Request, res: Response) => {
  try {
    const { userInput, availableBalance, constraints } = req.body;
    const userId = req.user?.id || req.body.userId;

    if (!userId || !userInput) {
      return res.status(400).json({
        success: false,
        message: "userId and userInput are required",
      });
    }

    // Create plan
    const plan = await agentPlanner.createPlan({
      userId,
      userInput,
      availableBalance,
      constraints,
    });

    // Optimize plan
    const optimized = agentPlanner.optimizePlan(plan);

    // Store plan for execution
    planStore.set(optimized.planId, optimized);

    return res.status(200).json({
      success: true,
      plan: {
        planId: optimized.planId,
        summary: optimized.summary,
        totalSteps: optimized.totalSteps,
        estimatedDuration: optimized.estimatedDuration,
        riskLevel: optimized.riskLevel,
        requiresApproval: optimized.requiresApproval,
        steps: optimized.steps.map((step) => ({
          stepNumber: step.stepNumber,
          description: step.description,
          action: step.action,
          estimatedDuration: step.estimatedDuration,
        })),
      },
    });
  } catch (error) {
    logger.error("Plan creation failed", { error });
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Plan creation failed",
    });
  }
});

// POST /agent/execute - Execute a plan
router.post("/agent/execute", async (req: Request, res: Response) => {
  try {
    const { planId, dryRun = false } = req.body;
    const userId = req.user?.id || req.body.userId;

    if (!userId || !planId) {
      return res.status(400).json({
        success: false,
        message: "userId and planId are required",
      });
    }

    // Retrieve plan
    const plan = planStore.get(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    // Verify plan belongs to user
    if (plan.steps[0]?.payload && userId !== req.body.userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Execute plan
    const result = await planExecutor.executePlan(plan, userId, {
      dryRun,
      stopOnError: true,
    });

    // Clean up plan after execution
    if (!dryRun && result.status === "success") {
      planStore.delete(planId);
    }

    return res.status(200).json({
      success: result.status === "success",
      result: {
        planId: result.planId,
        status: result.status,
        completedSteps: result.completedSteps,
        totalSteps: result.totalSteps,
        duration: result.duration,
        error: result.error,
        stepResults: result.stepResults.map((sr) => ({
          stepNumber: sr.stepNumber,
          action: sr.action,
          status: sr.status,
          duration: sr.duration,
          timestamp: sr.timestamp,
          error: sr.error,
        })),
      },
    });
  } catch (error) {
    logger.error("Plan execution failed", { error });
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Execution failed",
    });
  }
});

// GET /agent/plan/:planId - Get plan details
router.get("/agent/plan/:planId", async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const plan = planStore.get(planId);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    return res.status(200).json({
      success: true,
      plan: {
        planId: plan.planId,
        summary: plan.summary,
        totalSteps: plan.totalSteps,
        estimatedDuration: plan.estimatedDuration,
        riskLevel: plan.riskLevel,
        requiresApproval: plan.requiresApproval,
        steps: plan.steps,
      },
    });
  } catch (error) {
    logger.error("Failed to retrieve plan", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve plan",
    });
  }
});

// DELETE /agent/plan/:planId - Cancel/delete a plan
router.delete("/agent/plan/:planId", async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const deleted = planStore.delete(planId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Plan deleted",
    });
  } catch (error) {
    logger.error("Failed to delete plan", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to delete plan",
    });
  }
});
```

## API Endpoints

### 1. Create Plan

**POST** `/agent/plan`

Creates an execution plan from natural language input.

**Request Body:**

```json
{
  "userId": "user123",
  "userInput": "Swap 100 XLM to USDC",
  "availableBalance": {
    "XLM": 1000,
    "USDC": 500
  },
  "constraints": {
    "maxSteps": 10,
    "allowedTools": ["wallet_tool", "swap_tool"]
  }
}
```

**Response:**

```json
{
  "success": true,
  "plan": {
    "planId": "plan_1234567890_abc123",
    "summary": "Plan for 'Swap 100 XLM to USDC': Check XLM balance → Swap 100 XLM for USDC",
    "totalSteps": 2,
    "estimatedDuration": 7000,
    "riskLevel": "low",
    "requiresApproval": false,
    "steps": [
      {
        "stepNumber": 1,
        "description": "Check XLM balance",
        "action": "wallet_tool",
        "estimatedDuration": 2000
      },
      {
        "stepNumber": 2,
        "description": "Swap 100 XLM for USDC",
        "action": "swap_tool",
        "estimatedDuration": 5000
      }
    ]
  }
}
```

### 2. Execute Plan

**POST** `/agent/execute`

Executes a previously created plan.

**Request Body:**

```json
{
  "userId": "user123",
  "planId": "plan_1234567890_abc123",
  "dryRun": false
}
```

**Response:**

```json
{
  "success": true,
  "result": {
    "planId": "plan_1234567890_abc123",
    "status": "success",
    "completedSteps": 2,
    "totalSteps": 2,
    "duration": 6842,
    "stepResults": [
      {
        "stepNumber": 1,
        "action": "wallet_tool",
        "status": "success",
        "duration": 1823,
        "timestamp": "2024-01-15T10:30:00.000Z"
      },
      {
        "stepNumber": 2,
        "action": "swap_tool",
        "status": "success",
        "duration": 5019,
        "timestamp": "2024-01-15T10:30:01.823Z"
      }
    ]
  }
}
```

### 3. Get Plan Details

**GET** `/agent/plan/:planId`

Retrieves details of a stored plan.

**Response:**

```json
{
  "success": true,
  "plan": {
    "planId": "plan_1234567890_abc123",
    "summary": "...",
    "totalSteps": 2,
    "estimatedDuration": 7000,
    "riskLevel": "low",
    "requiresApproval": false,
    "steps": [...]
  }
}
```

### 4. Delete Plan

**DELETE** `/agent/plan/:planId`

Cancels and deletes a plan.

**Response:**

```json
{
  "success": true,
  "message": "Plan deleted"
}
```

## Client Usage Examples

### JavaScript/TypeScript Client

```typescript
// 1. Create a plan
const createPlanResponse = await fetch("/agent/plan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: "user123",
    userInput: "Liquidate half my portfolio into USDC",
    availableBalance: { XLM: 1000, USDT: 500 },
  }),
});

const { plan } = await createPlanResponse.json();

// 2. Show plan to user for approval
console.log(`Summary: ${plan.summary}`);
console.log(`Risk Level: ${plan.riskLevel}`);
console.log(`Steps: ${plan.totalSteps}`);

if (plan.requiresApproval) {
  const approved = await getUserApproval(plan);
  if (!approved) {
    // Delete plan
    await fetch(`/agent/plan/${plan.planId}`, { method: "DELETE" });
    return;
  }
}

// 3. Execute the plan
const executeResponse = await fetch("/agent/execute", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: "user123",
    planId: plan.planId,
    dryRun: false,
  }),
});

const { result } = await executeResponse.json();

// 4. Handle result
if (result.status === "success") {
  console.log("All steps completed successfully!");
} else {
  console.error(`Execution failed: ${result.error}`);
}
```

### cURL Examples

```bash
# Create plan
curl -X POST http://localhost:2333/agent/plan \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "userInput": "Swap 100 XLM to USDC"
  }'

# Execute plan
curl -X POST http://localhost:2333/agent/execute \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "planId": "plan_1234567890_abc123",
    "dryRun": false
  }'

# Get plan details
curl http://localhost:2333/agent/plan/plan_1234567890_abc123

# Delete plan
curl -X DELETE http://localhost:2333/agent/plan/plan_1234567890_abc123
```

## WebSocket Integration (Optional)

For real-time progress updates:

```typescript
import { Server as SocketIOServer } from "socket.io";

// In your server setup
const io = new SocketIOServer(server);

// Modified execute endpoint with WebSocket support
router.post("/agent/execute", async (req: Request, res: Response) => {
  const { planId, userId } = req.body;
  const plan = planStore.get(planId);

  if (!plan) {
    return res.status(404).json({ success: false, message: "Plan not found" });
  }

  // Start execution with progress updates
  const result = await planExecutor.executePlan(plan, userId, {
    onStepStart: (step) => {
      io.to(userId).emit("step:start", {
        planId,
        stepNumber: step.stepNumber,
        description: step.description,
      });
    },
    onStepComplete: (stepResult) => {
      io.to(userId).emit("step:complete", {
        planId,
        stepNumber: stepResult.stepNumber,
        status: stepResult.status,
        duration: stepResult.duration,
      });
    },
  });

  return res.status(200).json({ success: true, result });
});
```

## Production Considerations

### 1. Plan Storage

Replace in-memory Map with persistent storage:

```typescript
// Use Redis
import Redis from "ioredis";
const redis = new Redis();

// Store plan
await redis.setex(
  `plan:${plan.planId}`,
  3600, // 1 hour TTL
  JSON.stringify(plan)
);

// Retrieve plan
const planData = await redis.get(`plan:${planId}`);
const plan = JSON.parse(planData);
```

### 2. Authentication

Add authentication middleware:

```typescript
import { authenticate } from "../Auth/auth";

router.post("/agent/plan", authenticate, async (req, res) => {
  const userId = req.user.id; // From auth middleware
  // ...
});
```

### 3. Rate Limiting

```typescript
import rateLimit from "express-rate-limit";

const planLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: "Too many plan requests",
});

router.post("/agent/plan", planLimiter, async (req, res) => {
  // ...
});
```

### 4. Validation

```typescript
import { body, validationResult } from "express-validator";

router.post(
  "/agent/plan",
  [
    body("userId").isString().notEmpty(),
    body("userInput").isString().notEmpty().isLength({ max: 500 }),
    body("availableBalance").optional().isObject(),
    body("constraints").optional().isObject(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    // ...
  }
);
```

## Testing the API

```bash
# Run the server
npm run dev

# Test plan creation
curl -X POST http://localhost:2333/agent/plan \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","userInput":"Check my XLM balance"}'

# Test execution (dry-run)
curl -X POST http://localhost:2333/agent/execute \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","planId":"<planId>","dryRun":true}'
```

## Next Steps

1. Add the routes to `src/Gateway/routes.ts`
2. Test with Postman or cURL
3. Add authentication middleware
4. Implement persistent plan storage
5. Add rate limiting
6. Create frontend UI for plan approval
7. Add WebSocket support for real-time updates
