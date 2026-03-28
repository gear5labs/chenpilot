import {
  ToolDefinition,
  ToolResult,
  ToolPayload,
  ToolMetadata,
} from "../registry/ToolMetadata";
import { MockToolBehaviour, ToolCall, SandboxConfig } from "./types"; /**
 * Isolated tool registry for sandbox testing.
 * Replaces real tool implementations with configurable mock behaviours
 * without touching the global ToolRegistry singleton.
 */
export class MockToolRegistry {
  private mocks = new Map<
    string,
    { behaviour: MockToolBehaviour; callCount: number }
  >();
  private calls: ToolCall[] = [];
  private config: Required<SandboxConfig>;

  constructor(config: SandboxConfig = {}) {
    this.config = {
      userId: config.userId ?? "sandbox-user",
      allowUnmocked: config.allowUnmocked ?? false,
      globalDelayMs: config.globalDelayMs ?? 0,
      maxToolCalls: config.maxToolCalls ?? Infinity,
      recordCalls: config.recordCalls ?? true,
    };
  }

  /**
   * Register a mock behaviour for a tool name.
   * Replaces any previously registered mock for the same name.
   */
  mock(toolName: string, behaviour: MockToolBehaviour): this {
    this.mocks.set(toolName, { behaviour, callCount: 0 });
    return this;
  }

  /**
   * Convenience: mock a tool to always succeed with optional data.
   */
  mockSuccess(
    toolName: string,
    data: Record<string, unknown> = {},
    message?: string
  ): this {
    return this.mock(toolName, { type: "success", data, message });
  }

  /**
   * Convenience: mock a tool to always fail with an error message.
   */
  mockError(toolName: string, error: string): this {
    return this.mock(toolName, { type: "error", error });
  }

  /**
   * Convenience: mock a tool to return different responses on successive calls.
   */
  mockSequence(toolName: string, responses: MockToolBehaviour[]): this {
    return this.mock(toolName, { type: "sequence", responses });
  }

  /**
   * Build a ToolDefinition that wraps the mock behaviour.
   * This can be passed to AgentPlanner / PlanExecutor in tests.
   */
  buildMockTool(
    toolName: string,
    partialMetadata: Partial<ToolMetadata> = {}
  ): ToolDefinition {
    const metadata: ToolMetadata = {
      name: toolName,
      description: partialMetadata.description ?? `Mock tool: ${toolName}`,
      parameters: partialMetadata.parameters ?? {},
      examples: partialMetadata.examples ?? [],
      category: partialMetadata.category ?? "mock",
      version: partialMetadata.version ?? "1.0.0",
    };

    return {
      metadata,
      execute: async (
        payload: ToolPayload,
        userId: string
      ): Promise<ToolResult> => {
        return this.execute(toolName, payload, userId);
      },
    };
  }

  /**
   * Execute a mock tool by name, recording the call and resolving the behaviour.
   */
  async execute(
    toolName: string,
    payload: ToolPayload,
    userId: string
  ): Promise<ToolResult> {
    if (
      this.config.recordCalls &&
      this.calls.length >= this.config.maxToolCalls
    ) {
      throw new Error(
        `Sandbox: max tool calls (${this.config.maxToolCalls}) exceeded`
      );
    }

    const entry = this.mocks.get(toolName);

    if (!entry) {
      if (this.config.allowUnmocked) {
        const result: ToolResult = {
          action: toolName,
          status: "success",
          data: {},
          message: "Unmocked tool – passthrough",
        };
        this.record(toolName, payload, userId, result, 0);
        return result;
      }
      throw new Error(
        `Sandbox: tool "${toolName}" has no mock registered. ` +
          `Call mockRegistry.mock("${toolName}", behaviour) before running the plan.`
      );
    }

    if (this.config.globalDelayMs > 0) {
      await delay(this.config.globalDelayMs);
    }

    const start = Date.now();
    const result = await this.resolveBehaviour(
      entry.behaviour,
      payload,
      userId,
      entry
    );
    const durationMs = Date.now() - start;

    entry.callCount++;

    if (this.config.recordCalls) {
      this.record(toolName, payload, userId, result, durationMs);
    }

    return result;
  }

  /** All recorded calls in chronological order */
  getCalls(): ToolCall[] {
    return [...this.calls];
  }

  /** Reset call history and mock call counters */
  resetCalls(): void {
    this.calls = [];
    this.mocks.forEach((entry) => (entry.callCount = 0));
  }

  /** Remove all mocks and call history */
  clear(): void {
    this.mocks.clear();
    this.calls = [];
  }

  // ─── private helpers ──────────────────────────────────────────────────────

  private async resolveBehaviour(
    behaviour: MockToolBehaviour,
    payload: ToolPayload,
    userId: string,
    entry: { behaviour: MockToolBehaviour; callCount: number }
  ): Promise<ToolResult> {
    switch (behaviour.type) {
      case "success":
        return {
          action: "mock_action",
          status: "success",
          data: behaviour.data ?? {},
          message: behaviour.message,
        };

      case "error":
        return {
          action: "mock_action",
          status: "error",
          error: behaviour.error,
          data: behaviour.data ?? {},
        };

      case "delay":
        await delay(behaviour.ms);
        return this.resolveBehaviour(behaviour.then, payload, userId, entry);

      case "sequence": {
        const idx = Math.min(entry.callCount, behaviour.responses.length - 1);
        return this.resolveBehaviour(
          behaviour.responses[idx],
          payload,
          userId,
          entry
        );
      }

      case "fn": {
        const resolved = behaviour.handler(payload, userId);
        return this.resolveBehaviour(resolved, payload, userId, entry);
      }
    }
  }

  private record(
    toolName: string,
    payload: ToolPayload,
    userId: string,
    result: ToolResult,
    durationMs: number
  ): void {
    this.calls.push({
      toolName,
      payload: { ...payload },
      userId,
      result,
      timestamp: new Date().toISOString(),
      durationMs,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
