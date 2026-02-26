import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { memoryStore } from "../../src/Agents/memory/memory";
import {
  seedMemoryData,
  seedAgentMemory,
  getSeededAgentIds,
  getConversationTemplates,
  verifySeededData,
} from "../../src/scripts/seedAgentMemory";

describe("Agent Memory Seeding", () => {
  beforeEach(() => {
    // Clear memory before each test
    memoryStore.clearAll();
  });

  afterEach(() => {
    // Clean up after each test
    memoryStore.clearAll();
  });

  describe("seedMemoryData", () => {
    it("should seed memory with default data", () => {
      seedMemoryData();

      const agentIds = getSeededAgentIds();
      const user1Memory = memoryStore.get(agentIds.user1);
      const user2Memory = memoryStore.get(agentIds.user2);

      expect(user1Memory.length).toBeGreaterThan(0);
      expect(user2Memory.length).toBeGreaterThan(0);
    });

    it("should clear existing data when clearExisting is true", () => {
      // Add some initial data
      memoryStore.add("test-agent", "Initial entry");

      // Seed with clearExisting=true (default)
      seedMemoryData(true);

      // Initial data should be cleared
      const testMemory = memoryStore.get("test-agent");
      expect(testMemory.length).toBe(0);
    });

    it("should preserve existing data when clearExisting is false", () => {
      // Add some initial data
      memoryStore.add("test-agent", "Initial entry");

      // Seed with clearExisting=false
      seedMemoryData(false);

      // Initial data should still exist
      const testMemory = memoryStore.get("test-agent");
      expect(testMemory.length).toBeGreaterThan(0);
      expect(testMemory[0]).toBe("Initial entry");
    });

    it("should seed performance agent with 100 entries (limited to 10 by max context)", () => {
      seedMemoryData();

      const agentIds = getSeededAgentIds();
      const perfMemory = memoryStore.get(agentIds.performanceAgent);

      // Memory store has a max context of 10, so only last 10 are kept
      expect(perfMemory.length).toBe(10);
    });
  });

  describe("seedAgentMemory", () => {
    it("should seed specific agent with custom entries", () => {
      const customEntries = [
        "User: Custom question 1",
        "Agent: Custom answer 1",
        "User: Custom question 2",
        "Agent: Custom answer 2",
      ];

      seedAgentMemory("custom-agent", customEntries);

      const memory = memoryStore.get("custom-agent");
      expect(memory.length).toBe(4);
      expect(memory[0]).toBe("User: Custom question 1");
    });

    it("should clear existing agent data when clearExisting is true", () => {
      // Add initial data
      memoryStore.add("custom-agent", "Old entry");

      // Seed with clearExisting=true
      seedAgentMemory("custom-agent", ["New entry"], true);

      const memory = memoryStore.get("custom-agent");
      expect(memory.length).toBe(1);
      expect(memory[0]).toBe("New entry");
    });

    it("should append to existing data when clearExisting is false", () => {
      // Add initial data
      memoryStore.add("custom-agent", "Old entry");

      // Seed with clearExisting=false
      seedAgentMemory("custom-agent", ["New entry"], false);

      const memory = memoryStore.get("custom-agent");
      expect(memory.length).toBe(2);
      expect(memory[0]).toBe("Old entry");
      expect(memory[1]).toBe("New entry");
    });
  });

  describe("getSeededAgentIds", () => {
    it("should return all seeded agent IDs", () => {
      const agentIds = getSeededAgentIds();

      expect(agentIds).toHaveProperty("user1");
      expect(agentIds).toHaveProperty("user2");
      expect(agentIds).toHaveProperty("user3");
      expect(agentIds).toHaveProperty("testAgent");
      expect(agentIds).toHaveProperty("performanceAgent");
    });
  });

  describe("getConversationTemplates", () => {
    it("should return all conversation templates", () => {
      const templates = getConversationTemplates();

      expect(templates).toHaveProperty("stellar");
      expect(templates).toHaveProperty("defi");
      expect(templates).toHaveProperty("general");
      expect(templates).toHaveProperty("trading");
      expect(templates).toHaveProperty("staking");
    });

    it("should have valid conversation entries", () => {
      const templates = getConversationTemplates();

      expect(Array.isArray(templates.stellar)).toBe(true);
      expect(templates.stellar.length).toBeGreaterThan(0);
      expect(typeof templates.stellar[0]).toBe("string");
    });
  });

  describe("verifySeededData", () => {
    it("should return true when data is properly seeded", () => {
      seedMemoryData();
      const isValid = verifySeededData();

      expect(isValid).toBe(true);
    });

    it("should return false when data is not seeded", () => {
      // Don't seed any data
      const isValid = verifySeededData();

      expect(isValid).toBe(false);
    });
  });

  describe("Memory Retrieval Logic", () => {
    beforeEach(() => {
      seedMemoryData();
    });

    it("should retrieve Stellar-focused conversations for user1", () => {
      const agentIds = getSeededAgentIds();
      const memory = memoryStore.get(agentIds.user1);

      const stellarEntries = memory.filter((entry) =>
        entry.toLowerCase().includes("stellar")
      );
      expect(stellarEntries.length).toBeGreaterThan(0);
    });

    it("should retrieve DeFi-focused conversations for user2", () => {
      const agentIds = getSeededAgentIds();
      const memory = memoryStore.get(agentIds.user2);

      const defiEntries = memory.filter(
        (entry) =>
          entry.toLowerCase().includes("apy") ||
          entry.toLowerCase().includes("swap") ||
          entry.toLowerCase().includes("liquidity")
      );
      expect(defiEntries.length).toBeGreaterThan(0);
    });

    it("should handle empty memory for non-existent agent", () => {
      const memory = memoryStore.get("non-existent-agent");

      expect(memory).toEqual([]);
    });

    it("should respect max context limit", () => {
      const agentId = "limit-test-agent";

      // Add more entries than the default limit (10)
      for (let i = 0; i < 15; i++) {
        memoryStore.add(agentId, `Entry ${i}`);
      }

      const memory = memoryStore.get(agentId);

      // Should only keep the last 10 entries
      expect(memory.length).toBe(10);
      expect(memory[0]).toBe("Entry 5");
      expect(memory[9]).toBe("Entry 14");
    });

    it("should retrieve conversation context for multi-turn interactions", () => {
      const agentIds = getSeededAgentIds();
      const memory = memoryStore.get(agentIds.user1);

      // Check for user-agent conversation pairs
      const userEntries = memory.filter((entry) =>
        entry.startsWith("User:")
      );
      const agentEntries = memory.filter((entry) =>
        entry.startsWith("Agent:")
      );

      expect(userEntries.length).toBeGreaterThan(0);
      expect(agentEntries.length).toBeGreaterThan(0);
    });
  });

  describe("Performance Testing with Seeded Data", () => {
    it("should handle large dataset efficiently", () => {
      seedMemoryData();

      const agentIds = getSeededAgentIds();
      const startTime = Date.now();

      // Retrieve memory 100 times
      for (let i = 0; i < 100; i++) {
        memoryStore.get(agentIds.performanceAgent);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (< 100ms)
      expect(duration).toBeLessThan(100);
    });

    it("should handle concurrent memory operations", () => {
      const agentId = "concurrent-test-agent";
      const operations = [];

      // Perform concurrent add operations
      for (let i = 0; i < 50; i++) {
        operations.push(
          Promise.resolve(memoryStore.add(agentId, `Concurrent entry ${i}`))
        );
      }

      return Promise.all(operations).then(() => {
        const memory = memoryStore.get(agentId);
        // Should only keep last 10 due to max context limit
        expect(memory.length).toBe(10);
      });
    });
  });
});
