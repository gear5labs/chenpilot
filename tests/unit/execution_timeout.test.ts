import { executionAgent } from "../../src/Agents/agents/exectutionagent";
import { toolRegistry } from "../../src/Agents/registry/ToolRegistry";
import { WorkflowPlan } from "../../src/Agents/types";

jest.mock("../../src/Agents/registry/ToolRegistry");
jest.mock("../../src/Agents/agents/responseagent");
jest.mock("../../src/config/logger");

describe("Execution Agent Timeout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Agent execution with timeout", () => {
    it("should complete execution within timeout", async () => {
      const mockExecuteTool = jest.fn().mockResolvedValue({
        action: "test_action",
        status: "success",
        data: { result: "success" },
      });

      (toolRegistry.executeTool as jest.Mock) = mockExecuteTool;

      const plan: WorkflowPlan = {
        workflow: [
          {
            action: "test_action",
            payload: { test: "data" },
          },
        ],
      };

      const result = await executionAgent.run(
        plan,
        "user123",
        "test input",
        10000
      );

      expect(result.success).toBe(true);
      expect(mockExecuteTool).toHaveBeenCalled();
    });

    it("should timeout when execution exceeds timeout", async () => {
      const mockExecuteTool = jest
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        );

      (toolRegistry.executeTool as jest.Mock) = mockExecuteTool;

      const plan: WorkflowPlan = {
        workflow: [
          {
            action: "slow_action",
            payload: { test: "data" },
          },
        ],
      };

      const result = await executionAgent.run(
        plan,
        "user123",
        "test input",
        100
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });

    it("should pass remaining time to tool execution", async () => {
      const mockExecuteTool = jest.fn().mockResolvedValue({
        action: "test_action",
        status: "success",
        data: {},
      });

      (toolRegistry.executeTool as jest.Mock) = mockExecuteTool;

      const plan: WorkflowPlan = {
        workflow: [
          {
            action: "action1",
            payload: {},
          },
          {
            action: "action2",
            payload: {},
          },
        ],
      };

      await executionAgent.run(plan, "user123", "test input", 10000);

      expect(mockExecuteTool).toHaveBeenCalledTimes(2);
      expect(mockExecuteTool).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        "user123",
        expect.any(Number)
      );
    });

    it("should handle tool execution errors gracefully", async () => {
      const mockExecuteTool = jest
        .fn()
        .mockRejectedValueOnce(new Error("Tool failed"))
        .mockResolvedValueOnce({
          action: "action2",
          status: "success",
          data: {},
        });

      (toolRegistry.executeTool as jest.Mock) = mockExecuteTool;

      const plan: WorkflowPlan = {
        workflow: [
          {
            action: "failing_action",
            payload: {},
          },
          {
            action: "success_action",
            payload: {},
          },
        ],
      };

      const result = await executionAgent.run(
        plan,
        "user123",
        "test input",
        10000
      );

      expect(result.success).toBe(true);
      expect(mockExecuteTool).toHaveBeenCalledTimes(2);
    });

    it("should stop execution when remaining time is exhausted", async () => {
      const mockExecuteTool = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  action: "test",
                  status: "success",
                  data: {},
                }),
              200
            )
          )
      );

      (toolRegistry.executeTool as jest.Mock) = mockExecuteTool;

      const plan: WorkflowPlan = {
        workflow: [
          { action: "action1", payload: {} },
          { action: "action2", payload: {} },
          { action: "action3", payload: {} },
        ],
      };

      const result = await executionAgent.run(
        plan,
        "user123",
        "test input",
        300
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });
  });
});
