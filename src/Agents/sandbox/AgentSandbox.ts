import { ToolRegistry } from "../registry/ToolRegistry";
import { ToolDefinition, ToolPayload } from "../registry/ToolMetadata";
import {
  AgentPlanner,
  PlannerContext,
  ExecutionPlan,
} from "../planner/AgentPlanner";
import { PlanExecutor, ExecutionOptions } from "../planner/PlanExecutor";
import { toolRegistry as globalToolRegistry } from "../registry/ToolRegistry";
import { MockToolRegistry } from "./MockToolRegistry";
import {
  MockToolBehaviour,
  SandboxConfig,
  SandboxRunResult,
  SandboxAssertions,
  ToolCall,
} from "./types";

/**
 * AgentSandbox – a self-contained testing harness for agent planning logic.
 *
 * It wires together an isolated ToolRegistry, a MockToolRegistry, an
 * AgentPlanner, and a PlanExecutor so that tests can:
 *   1. Register mock tools with configurable behaviours
 *   2. Run the planner against natural-language input
 *   3. Execute the resulting plan without touching real services
 *   4. Assert on which tools were called, in what order, and with what payloads
 *
 * @example
 * ```typescript
 * const sandbox = new AgentSandbox();
 *
 * sandbox
 *   .mockTool("wallet_tool", { type: "success", data: { balance: "100" } })
 *   .mockTool("swap_tool",   { type: "success", data: { txHash: "0xabc" } });
 *
 * const result = await sandbox.run("Swap 50 XLM to USDC");
 *
 * expect(result.assertions.toolWasCalled("swap_tool")).toBe(true);
 * expect(result.assertions.calledBefore("wallet_tool", "swap_tool")).toBe(true);
 * ```
 */
export class AgentSandbox {
  private mockRegistry: MockToolRegistry;
  private isolatedToolRegistry: ToolRegistry;
  private planner: AgentPlanner;
  private executor: PlanExecutor;
  private config: Required<SandboxConfig>;

  constructor(config: SandboxConfig = {}) {
    this.config = {
      userId: config.userId ?? "sandbox-user",
      allowUnmocked: config.allowUnmocked ?? false,
      globalDelayMs: config.globalDelayMs ?? 0,
      maxToolCalls: config.maxToolCalls ?? Infinity,
      recordCalls: config.recordCalls ?? true,
    };

    this.mockRegistry = new MockToolRegistry(this.config);
    this.isolatedToolRegistry = new ToolRegistry();
    this.planner = new AgentPlanner();
    this.executor = new PlanExecutor();

    // Patch the executor to use our isolated registry instead of the global one
    this.patchExecutorRegistry();
    // Patch the planner to use our isolated registry for tool metadata
    this.patchPlannerRegistry();
  }

  // ─── Mock registration ────────────────────────────────────────────────────

  /**
   * Register a mock behaviour for a named tool.
   * The tool is also added to the isolated ToolRegistry so the planner
   * can see it when building prompts.
   */
  mockTool(
    toolName: string,
    behaviour: MockToolBehaviour,
    partialMetadata: Parameters<MockToolRegistry["buildMockTool"]>[1] = {}
  ): this {
    this.mockRegistry.mock(toolName, behaviour);

    // Register in isolated registry so planner knows about the tool
    const toolDef = this.mockRegistry.buildMockTool(toolName, partialMetadata);
    if (!this.isolatedToolRegistry.hasCustomTool(toolName)) {
      this.isolatedToolRegistry.registerCustomTool(toolDef);
    } else {
      this.isolatedToolRegistry.registerCustomTool(toolDef, {
        overwrite: true,
      });
    }

    return this;
  }

  /** Convenience: mock a tool to always succeed */
  mockSuccess(
    toolName: string,
    data: Record<string, unknown> = {},
    message?: string
  ): this {
    return this.mockTool(toolName, { type: "success", data, message });
  }

  /** Convenience: mock a tool to always fail */
  mockError(toolName: string, error: string): this {
    return this.mockTool(toolName, { type: "error", error });
  }

  /** Convenience: mock a tool with a sequence of responses */
  mockSequence(toolName: string, responses: MockToolBehaviour[]): this {
    return this.mockTool(toolName, { type: "sequence", responses });
  }

  /** Register a fully custom ToolDefinition (useful for complex mocks) */
  registerTool(tool: ToolDefinition): this {
    if (this.isolatedToolRegistry.hasCustomTool(tool.metadata.name)) {
      this.isolatedToolRegistry.registerCustomTool(tool, { overwrite: true });
    } else {
      this.isolatedToolRegistry.registerCustomTool(tool);
    }
    return this;
  }

  // ─── Execution ────────────────────────────────────────────────────────────

  /**
   * Run the full plan-and-execute cycle for a natural-language input.
   * Returns the execution result plus assertion helpers.
   */
  async run(
    userInput: string,
    plannerContext: Partial<PlannerContext> = {},
    executionOptions: ExecutionOptions = {}
  ): Promise<SandboxRunResult & { assertions: SandboxAssertions }> {
    this.mockRegistry.resetCalls();

    const context: PlannerContext = {
      userId: this.config.userId,
      userInput,
      ...plannerContext,
    };

    const plan = await this.planner.createPlan(context);
    const planSnapshot = JSON.parse(JSON.stringify(plan)) as ExecutionPlan;

    const executionResult = await this.executor.executePlan(
      plan,
      this.config.userId,
      {
        dryRun: false, // sandbox intercepts at tool level, not executor level
        stopOnError: false,
        verifyHash: false, // sandbox bypasses hash verification
        ...executionOptions,
      }
    );

    const toolCalls = this.mockRegistry.getCalls();

    const runResult: SandboxRunResult = {
      executionResult,
      toolCalls,
      planSnapshot,
      sandboxUserId: this.config.userId,
    };

    return {
      ...runResult,
      assertions: buildAssertions(toolCalls),
    };
  }

  /**
   * Run only the planning phase without executing the plan.
   * Useful for testing planner logic in isolation.
   */
  async plan(
    userInput: string,
    plannerContext: Partial<PlannerContext> = {}
  ): Promise<ExecutionPlan> {
    const context: PlannerContext = {
      userId: this.config.userId,
      userInput,
      ...plannerContext,
    };
    return this.planner.createPlan(context);
  }

  /**
   * Execute a pre-built plan inside the sandbox.
   * Useful when you want to test execution logic separately from planning.
   */
  async executePlan(
    plan: ExecutionPlan,
    options: ExecutionOptions = {}
  ): Promise<SandboxRunResult & { assertions: SandboxAssertions }> {
    this.mockRegistry.resetCalls();

    const planSnapshot = JSON.parse(JSON.stringify(plan)) as ExecutionPlan;

    const executionResult = await this.executor.executePlan(
      plan,
      this.config.userId,
      { stopOnError: false, verifyHash: false, ...options }
    );

    const toolCalls = this.mockRegistry.getCalls();

    const runResult: SandboxRunResult = {
      executionResult,
      toolCalls,
      planSnapshot,
      sandboxUserId: this.config.userId,
    };

    return {
      ...runResult,
      assertions: buildAssertions(toolCalls),
    };
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  /** Reset call history without removing mocks */
  resetCalls(): this {
    this.mockRegistry.resetCalls();
    return this;
  }

  /** Remove all mocks and call history, and restore the global registry */
  clear(): this {
    this.mockRegistry.clear();
    this.restoreRegistry();
    return this;
  }

  /** Access the underlying MockToolRegistry for advanced use */
  getMockRegistry(): MockToolRegistry {
    return this.mockRegistry;
  }

  /** Access the isolated ToolRegistry */
  getToolRegistry(): ToolRegistry {
    return this.isolatedToolRegistry;
  }

  // ─── Private patching ─────────────────────────────────────────────────────

  /**
   * Monkey-patch the PlanExecutor's internal tool lookup to use our
   * isolated registry + mock execution instead of the global singleton.
   *
   * PlanExecutor.executeStep calls the module-level `toolRegistry` singleton
   * directly. We replace the `executeTool` method on that singleton for the
   * lifetime of this sandbox so all calls are routed through MockToolRegistry.
   *
   * The original method is restored when `clear()` is called or can be
   * restored manually via `restoreRegistry()`.
   */
  private patchExecutorRegistry(): void {
    const mockReg = this.mockRegistry;

    // Import the global singleton that PlanExecutor uses
    const globalRegistry = globalToolRegistry;

    const originalExecute = globalRegistry.executeTool.bind(globalRegistry);

    // Stash the original so we can restore it
    (this as unknown as Record<string, unknown>)["_originalExecuteTool"] =
      originalExecute;
    (this as unknown as Record<string, unknown>)["_patchedRegistry"] =
      globalRegistry;

    globalRegistry.executeTool = async (
      toolName: string,
      payload: ToolPayload,
      userId: string,
      timeoutMs?: number
    ) => {
      // Route through mock if registered; otherwise fall back to real execution
      if (
        (mockReg as unknown as Record<string, unknown>)["mocks"] instanceof
          Map &&
        (
          (mockReg as unknown as Record<string, unknown>)["mocks"] as Map<
            string,
            unknown
          >
        ).has(toolName)
      ) {
        return mockReg.execute(toolName, payload, userId);
      }
      if (this.config.allowUnmocked) {
        return mockReg.execute(toolName, payload, userId);
      }
      return originalExecute(toolName, payload, userId, timeoutMs);
    };
  }

  /**
   * Restore the global toolRegistry.executeTool to its original implementation.
   * Called automatically by clear().
   */
  restoreRegistry(): void {
    const original = (this as unknown as Record<string, unknown>)[
      "_originalExecuteTool"
    ];
    const registry = (this as unknown as Record<string, unknown>)[
      "_patchedRegistry"
    ] as ToolRegistry | undefined;
    if (original && registry) {
      registry.executeTool = original as typeof registry.executeTool;
    }
  }
  /**
   * Patch the AgentPlanner to use our isolated registry for tool metadata
   * so the LLM prompt only lists the tools we've registered in the sandbox.
   */
  private patchPlannerRegistry(): void {
    const isolatedReg = this.isolatedToolRegistry;
    (this.planner as unknown as Record<string, unknown>)["toolRegistry"] =
      isolatedReg;
  }
}

// ─── Assertion builder ────────────────────────────────────────────────────────

function buildAssertions(calls: ToolCall[]): SandboxAssertions {
  return {
    toolWasCalled(toolName: string): boolean {
      return calls.some((c) => c.toolName === toolName);
    },

    toolCallCount(toolName: string): number {
      return calls.filter((c) => c.toolName === toolName).length;
    },

    getCallsFor(toolName: string): ToolCall[] {
      return calls.filter((c) => c.toolName === toolName);
    },

    getNthCall(toolName: string, n: number): ToolCall | undefined {
      return calls.filter((c) => c.toolName === toolName)[n];
    },

    calledBefore(toolA: string, toolB: string): boolean {
      const idxA = calls.findIndex((c) => c.toolName === toolA);
      const idxB = calls.findIndex((c) => c.toolName === toolB);
      return idxA !== -1 && idxB !== -1 && idxA < idxB;
    },

    allCalls(): ToolCall[] {
      return [...calls];
    },
  };
}
