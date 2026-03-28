import { ToolResult, ToolPayload } from "../registry/ToolMetadata";
import { ExecutionPlan } from "../planner/AgentPlanner";
import { ExecutionResult } from "../planner/PlanExecutor";

/** Behaviour when a mock tool is called */
export type MockToolBehaviour =
  | { type: "success"; data?: Record<string, unknown>; message?: string }
  | { type: "error"; error: string; data?: Record<string, unknown> }
  | { type: "delay"; ms: number; then: MockToolBehaviour }
  | { type: "sequence"; responses: MockToolBehaviour[] }
  | {
      type: "fn";
      handler: (payload: ToolPayload, userId: string) => MockToolBehaviour;
    };

/** A recorded tool invocation */
export interface ToolCall {
  toolName: string;
  payload: ToolPayload;
  userId: string;
  result: ToolResult;
  timestamp: string;
  durationMs: number;
}

/** Sandbox configuration */
export interface SandboxConfig {
  /** User ID to use for all tool calls (default: "sandbox-user") */
  userId?: string;
  /** Whether to allow tools not explicitly mocked to fall through (default: false) */
  allowUnmocked?: boolean;
  /** Global delay in ms added to every tool call (default: 0) */
  globalDelayMs?: number;
  /** Max number of tool calls before throwing (default: unlimited) */
  maxToolCalls?: number;
  /** Whether to record all tool calls (default: true) */
  recordCalls?: boolean;
}

/** Result of running a plan inside the sandbox */
export interface SandboxRunResult {
  executionResult: ExecutionResult;
  toolCalls: ToolCall[];
  planSnapshot: ExecutionPlan;
  sandboxUserId: string;
}

/** Assertion helpers returned by the sandbox */
export interface SandboxAssertions {
  /** Assert a specific tool was called at least once */
  toolWasCalled(toolName: string): boolean;
  /** Assert a specific tool was called exactly N times */
  toolCallCount(toolName: string): number;
  /** Get all calls for a specific tool */
  getCallsFor(toolName: string): ToolCall[];
  /** Get the Nth call for a tool (0-indexed) */
  getNthCall(toolName: string, n: number): ToolCall | undefined;
  /** Assert call order: toolA was called before toolB */
  calledBefore(toolA: string, toolB: string): boolean;
  /** All recorded calls in order */
  allCalls(): ToolCall[];
}
