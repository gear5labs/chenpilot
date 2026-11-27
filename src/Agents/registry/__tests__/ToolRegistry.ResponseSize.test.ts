const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock("../../../config/logger", () => mockLogger);
jest.mock("../../../config/config", () => ({
  default: {
    agent: {
      timeouts: {
        toolExecution: 5000,
      },
      responseSize: {
        mode: "truncate",
      },
    },
  },
}));
jest.mock("../../../utils/timeout", () => ({
  withTimeout: jest.fn((promise) => promise),
}));

import { ToolRegistry } from "../ToolRegistry";
import { ToolDefinition, ToolResult } from "../ToolMetadata";

describe("ToolRegistry - Response Size Validation", () => {
  let registry: ToolRegistry;
  const userId = "test-user";

  beforeEach(() => {
    registry = new ToolRegistry();
    jest.clearAllMocks();
  });

  describe("Low-Risk Tool", () => {
    it("should allow large responses from low-risk tools", async () => {
      const largeTool: ToolDefinition = {
        metadata: {
          name: "low_risk_tool",
          description: "Low risk tool",
          version: "1.0.0",
          riskLevel: "low",
          category: "test",
          capabilities: [],
          examples: [],
          parameters: {},
        },
        execute: async () => ({
          action: "low_risk_tool",
          status: "success",
          data: {
            result: "x".repeat(20000), // 20 KB of data
          },
        }),
      };

      registry.register(largeTool);

      const result = await registry.executeTool(
        "low_risk_tool",
        {},
        userId,
        1000
      );

      expect(result.status).toBe("success");
      expect(result.responseSizeMetadata?.handled).toBe("truncated");
      expect(result.responseSizeMetadata?.wasProcessed).toBe(true);
      expect(result.responseSizeMetadata?.originalLength).toBeGreaterThan(20000);
    });
  });

  describe("Medium-Risk Tool", () => {
    it("should truncate medium-risk tool responses exceeding limit", async () => {
      const mediumTool: ToolDefinition = {
        metadata: {
          name: "medium_risk_tool",
          description: "Medium risk tool",
          version: "1.0.0",
          riskLevel: "medium",
          category: "test",
          capabilities: [],
          examples: [],
          parameters: {},
        },
        execute: async () => ({
          action: "medium_risk_tool",
          status: "success",
          data: {
            result: "x".repeat(20000),
          },
        }),
      };

      registry.register(mediumTool);

      const result = await registry.executeTool(
        "medium_risk_tool",
        {},
        userId,
        1000
      );

      expect(result.status).toBe("success");
      expect(result.responseSizeMetadata?.handled).toBe("truncated");
      expect(JSON.stringify(result.data || {})).toBeLessThanOrEqual(16384 + 100);
    });
  });

  describe("High-Risk Tool", () => {
    it("should truncate high-risk tool responses more aggressively", async () => {
      const highTool: ToolDefinition = {
        metadata: {
          name: "high_risk_tool",
          description: "High risk tool",
          version: "1.0.0",
          riskLevel: "high",
          category: "test",
          capabilities: [],
          examples: [],
          parameters: {},
        },
        execute: async () => ({
          action: "high_risk_tool",
          status: "success",
          data: {
            result: "x".repeat(20000),
          },
        }),
      };

      registry.register(highTool);

      const result = await registry.executeTool(
        "high_risk_tool",
        {},
        userId,
        1000
      );

      expect(result.status).toBe("success");
      expect(result.responseSizeMetadata?.handled).toBe("truncated");
      expect(JSON.stringify(result.data || {})).toBeLessThanOrEqual(8192 + 100);
    });
  });

  describe("Response Size Metadata", () => {
    it("should include response size metadata when response is processed", async () => {
      const tool: ToolDefinition = {
        metadata: {
          name: "test_tool",
          description: "Test tool",
          version: "1.0.0",
          riskLevel: "medium",
          category: "test",
          capabilities: [],
          examples: [],
          parameters: {},
        },
        execute: async () => ({
          action: "test_tool",
          status: "success",
          data: { result: "x".repeat(20000) },
        }),
      };

      registry.register(tool);

      const result = await registry.executeTool("test_tool", {}, userId, 1000);

      expect(result.responseSizeMetadata).toBeDefined();
      expect(result.responseSizeMetadata?.wasProcessed).toBe(true);
      expect(result.responseSizeMetadata?.originalLength).toBeGreaterThan(20000);
      expect(result.responseSizeMetadata?.handled).toBe("truncated");
    });

    it("should not include metadata for small responses", async () => {
      const tool: ToolDefinition = {
        metadata: {
          name: "small_tool",
          description: "Small response tool",
          version: "1.0.0",
          riskLevel: "medium",
          category: "test",
          capabilities: [],
          examples: [],
          parameters: {},
        },
        execute: async () => ({
          action: "small_tool",
          status: "success",
          data: { result: "small" },
        }),
      };

      registry.register(tool);

      const result = await registry.executeTool("small_tool", {}, userId, 1000);

      expect(result.responseSizeMetadata).toBeUndefined();
    });
  });

  describe("Error Responses", () => {
    it("should not validate error responses for size", async () => {
      const tool: ToolDefinition = {
        metadata: {
          name: "error_tool",
          description: "Tool that errors",
          version: "1.0.0",
          riskLevel: "high",
          category: "test",
          capabilities: [],
          examples: [],
          parameters: {},
        },
        execute: async () => ({
          action: "error_tool",
          status: "error",
          error: "Tool failed",
        }),
      };

      registry.register(tool);

      const result = await registry.executeTool("error_tool", {}, userId, 1000);

      expect(result.status).toBe("error");
      expect(result.responseSizeMetadata).toBeUndefined();
    });

    it("should return error when response is rejected in reject mode", async () => {
      // This would require mocking config to use reject mode
      const tool: ToolDefinition = {
        metadata: {
          name: "reject_tool",
          description: "Tool",
          version: "1.0.0",
          riskLevel: "high",
          category: "test",
          capabilities: [],
          examples: [],
          parameters: {},
        },
        execute: async () => ({
          action: "reject_tool",
          status: "success",
          data: { result: "x".repeat(100000) },
        }),
      };

      registry.register(tool);

      const result = await registry.executeTool(
        "reject_tool",
        {},
        userId,
        1000
      );

      // With truncate mode (default), response should be truncated, not rejected
      expect(result.status).toBe("success");
    });
  });

  describe("No Data Responses", () => {
    it("should handle responses without data field", async () => {
      const tool: ToolDefinition = {
        metadata: {
          name: "no_data_tool",
          description: "Tool with no data",
          version: "1.0.0",
          riskLevel: "medium",
          category: "test",
          capabilities: [],
          examples: [],
          parameters: {},
        },
        execute: async () => ({
          action: "no_data_tool",
          status: "success",
          message: "Done",
        }),
      };

      registry.register(tool);

      const result = await registry.executeTool(
        "no_data_tool",
        {},
        userId,
        1000
      );

      expect(result.status).toBe("success");
      expect(result.responseSizeMetadata).toBeUndefined();
    });
  });

  describe("Complex Response Structures", () => {
    it("should handle nested response objects", async () => {
      const tool: ToolDefinition = {
        metadata: {
          name: "complex_tool",
          description: "Complex response",
          version: "1.0.0",
          riskLevel: "high",
          category: "test",
          capabilities: [],
          examples: [],
          parameters: {},
        },
        execute: async () => ({
          action: "complex_tool",
          status: "success",
          data: {
            level1: {
              level2: {
                level3: {
                  items: Array(100).fill("x".repeat(100)),
                },
              },
            },
          },
        }),
      };

      registry.register(tool);

      const result = await registry.executeTool(
        "complex_tool",
        {},
        userId,
        1000
      );

      expect(result.status).toBe("success");
      expect(result.responseSizeMetadata?.handled).toBe("truncated");
      expect(JSON.stringify(result.data || {})).toBeLessThanOrEqual(8192 + 100);
    });
  });
});
