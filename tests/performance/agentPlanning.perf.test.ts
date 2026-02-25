import { AgentPlanner } from "../../src/Agents/planner/AgentPlanner";
import { PlanExecutor } from "../../src/Agents/planner/PlanExecutor";
import { toolRegistry } from "../../src/Agents/registry/ToolRegistry";
import { performanceTestRunner } from "./utils/PerformanceTestRunner";
import { PERFORMANCE_BASELINES, PERFORMANCE_TEST_CONFIG } from "./config/performanceBaselines";

jest.mock("../../src/Agents/agent");
jest.mock("../../src/config/logger");

describe("Agent Planning Performance Tests", () => {
  let agentPlanner: AgentPlanner;

  beforeAll(() => {
    agentPlanner = new AgentPlanner();
    performanceTestRunner.clear();
  });

  afterAll(() => {
    const report = performanceTestRunner.generateReport();
    console.log("\n" + report);
  });

  describe("Simple Planning Operations", () => {
    it("should create simple plan within performance threshold", async () => {
      const mockLLMResponse = {
        workflow: [
          {
            action: "get_balance",
            payload: { asset: "XLM" },
          },
        ],
      };

      const { agentLLM } = require("../../src/Agents/agent");
      agentLLM.callLLM = jest.fn().mockResolvedValue(mockLLMResponse);

      const result = await performanceTestRunner.runTest(
        "Simple Plan Creation",
        async () => {
          await agentPlanner.createPlan({
            userId: "test-user",
            userInput: "Check my XLM balance",
          });
        },
        {
          iterations: PERFORMANCE_TEST_CONFIG.defaultIterations,
          warmupIterations: PERFORMANCE_TEST_CONFIG.warmupIterations,
          threshold: PERFORMANCE_BASELINES.agentPlanning.simple,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.mean).toBeLessThan(
        PERFORMANCE_BASELINES.agentPlanning.simple.mean!
      );
    });

    it("should handle Soroban intent parsing efficiently", async () => {
      const result = await performanceTestRunner.runTest(
        "Soroban Intent Parsing",
        async () => {
          await agentPlanner.createPlan({
            userId: "test-user",
            userInput: "swap 100 XLM to USDC",
          });
        },
        {
          iterations: PERFORMANCE_TEST_CONFIG.defaultIterations,
          warmupIterations: PERFORMANCE_TEST_CONFIG.warmupIterations,
          threshold: PERFORMANCE_BASELINES.agentPlanning.simple,
        }
      );

      expect(result.passed).toBe(true);
    });
  });

  describe("Complex Planning Operations", () => {
    it("should create multi-step plan within performance threshold", async () => {
      const mockLLMResponse = {
        workflow: [
          { action: "get_balance", payload: { asset: "XLM" } },
          { action: "swap_tool", payload: { from: "XLM", to: "USDC", amount: 100 } },
          { action: "transfer", payload: { to: "recipient", amount: 50, asset: "USDC" } },
        ],
      };

      const { agentLLM } = require("../../src/Agents/agent");
      agentLLM.callLLM = jest.fn().mockResolvedValue(mockLLMResponse);

      const result = await performanceTestRunner.runTest(
        "Complex Multi-Step Plan Creation",
        async () => {
          await agentPlanner.createPlan({
            userId: "test-user",
            userInput: "Swap 100 XLM to USDC and send 50 USDC to recipient",
          });
        },
        {
          iterations: PERFORMANCE_TEST_CONFIG.defaultIterations,
          warmupIterations: PERFORMANCE_TEST_CONFIG.warmupIterations,
          threshold: PERFORMANCE_BASELINES.agentPlanning.complex,
        }
      );

      expect(result.passed).toBe(true);
    });

    it("should optimize plan efficiently", async () => {
      const mockPlan = {
        planId: "test-plan",
        steps: [
          {
            stepNumber: 1,
            action: "swap_tool",
            payload: { from: "XLM", to: "USDC", amount: 100 },
            description: "Swap XLM to USDC",
          },
        ],
        totalSteps: 1,
        estimatedDuration: 3000,
        riskLevel: "low" as const,
        requiresApproval: false,
        summary: "Test plan",
      };

      const result = await performanceTestRunner.runTest(
        "Plan Optimization",
        async () => {
          agentPlanner.optimizePlan(mockPlan);
        },
        {
          iterations: 50,
          warmupIterations: 5,
          threshold: {
            mean: 50,
            p95: 100,
            max: 200,
          },
        }
      );

      expect(result.passed).toBe(true);
    });
  });

  describe("Planning with LLM Integration", () => {
    it("should handle LLM-based planning within threshold", async () => {
      const mockLLMResponse = {
        workflow: [
          { action: "get_balance", payload: { asset: "XLM" } },
          { action: "swap_tool", payload: { from: "XLM", to: "USDC", amount: 100 } },
        ],
      };

      const { agentLLM } = require("../../src/Agents/agent");
      agentLLM.callLLM = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(mockLLMResponse), 100)
          )
      );

      const result = await performanceTestRunner.runTest(
        "LLM-Based Planning",
        async () => {
          await agentPlanner.createPlan({
            userId: "test-user",
            userInput: "I want to swap some XLM for USDC",
          });
        },
        {
          iterations: 5,
          warmupIterations: 1,
          threshold: PERFORMANCE_BASELINES.agentPlanning.withLLM,
        }
      );

      expect(result.passed).toBe(true);
    });
  });

  describe("Plan Validation Performance", () => {
    it("should validate plans quickly", async () => {
      const mockPlan = {
        planId: "test-plan",
        steps: Array.from({ length: 5 }, (_, i) => ({
          stepNumber: i + 1,
          action: "test_action",
          payload: { data: "test" },
          description: `Step ${i + 1}`,
        })),
        totalSteps: 5,
        estimatedDuration: 15000,
        riskLevel: "medium" as const,
        requiresApproval: true,
        summary: "Test plan with 5 steps",
      };

      const result = await performanceTestRunner.runTest(
        "Plan Validation",
        async () => {
          // Access private method through any type assertion for testing
          (agentPlanner as any).validatePlan(mockPlan);
        },
        {
          iterations: 100,
          warmupIterations: 10,
          threshold: {
            mean: 10,
            p95: 20,
            max: 50,
          },
        }
      );

      expect(result.passed).toBe(true);
    });
  });

  describe("Concurrent Planning Operations", () => {
    it("should handle concurrent plan creation efficiently", async () => {
      const mockLLMResponse = {
        workflow: [
          { action: "get_balance", payload: { asset: "XLM" } },
        ],
      };

      const { agentLLM } = require("../../src/Agents/agent");
      agentLLM.callLLM = jest.fn().mockResolvedValue(mockLLMResponse);

      const result = await performanceTestRunner.runTest(
        "Concurrent Plan Creation",
        async () => {
          await Promise.all([
            agentPlanner.createPlan({
              userId: "user-1",
              userInput: "Check balance",
            }),
            agentPlanner.createPlan({
              userId: "user-2",
              userInput: "Check balance",
            }),
            agentPlanner.createPlan({
              userId: "user-3",
              userInput: "Check balance",
            }),
          ]);
        },
        {
          iterations: 5,
          warmupIterations: 1,
          threshold: {
            mean: 1500,
            p95: 2500,
            max: 3500,
          },
        }
      );

      expect(result.passed).toBe(true);
    });
  });

  describe("Memory Usage", () => {
    it("should not leak memory during repeated planning", async () => {
      const mockLLMResponse = {
        workflow: [
          { action: "get_balance", payload: { asset: "XLM" } },
        ],
      };

      const { agentLLM } = require("../../src/Agents/agent");
      agentLLM.callLLM = jest.fn().mockResolvedValue(mockLLMResponse);

      const initialMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < 50; i++) {
        await agentPlanner.createPlan({
          userId: `test-user-${i}`,
          userInput: "Check my balance",
        });
      }

      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

      // Memory increase should be reasonable (less than 50MB for 50 operations)
      expect(memoryIncreaseMB).toBeLessThan(50);
    });
  });
});
