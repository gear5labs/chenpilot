import { agentLLM } from "../../src/Agents/agent";
import { TimeoutError } from "../../src/utils/timeout";
import config from "../../src/config/config";

jest.mock("@anthropic-ai/sdk");
jest.mock("../../src/config/logger");

describe("Agent Timeout Integration", () => {
  describe("AgentLLM.callLLM with timeout", () => {
    it("should complete LLM call within timeout", async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        content: [{ type: "text", text: '{"result": "success"}' }],
      });

      (agentLLM as any).client = {
        messages: { create: mockCreate },
      };

      const result = await agentLLM.callLLM(
        "test-agent",
        "test prompt",
        "test input",
        true,
        5000
      );

      expect(result).toEqual({ result: "success" });
    });

    it("should timeout when LLM call exceeds timeout", async () => {
      const mockCreate = jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000))
      );

      (agentLLM as any).client = {
        messages: { create: mockCreate },
      };

      await expect(
        agentLLM.callLLM("test-agent", "test prompt", "test input", true, 100)
      ).rejects.toThrow("LLM call timed out after 100ms");
    });

    it("should use default timeout from config when not specified", async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        content: [{ type: "text", text: '{"result": "success"}' }],
      });

      (agentLLM as any).client = {
        messages: { create: mockCreate },
      };

      await agentLLM.callLLM("test-agent", "test prompt", "test input", true);

      expect(mockCreate).toHaveBeenCalled();
    });

    it("should handle non-JSON response with timeout", async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        content: [{ type: "text", text: "plain text response" }],
      });

      (agentLLM as any).client = {
        messages: { create: mockCreate },
      };

      const result = await agentLLM.callLLM(
        "test-agent",
        "test prompt",
        "test input",
        false,
        5000
      );

      expect(result).toBe("plain text response");
    });

    it("should handle JSON parse error gracefully", async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        content: [{ type: "text", text: "invalid json" }],
      });

      (agentLLM as any).client = {
        messages: { create: mockCreate },
      };

      const result = await agentLLM.callLLM(
        "test-agent",
        "test prompt",
        "test input",
        true,
        5000
      );

      expect(result).toEqual({});
    });
  });
});
