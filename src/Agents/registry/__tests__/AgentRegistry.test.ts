// Mock logger before importing AgentRegistry
const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock("../../../config/logger", () => mockLogger);

import { AgentRegistry, AgentDefinition, ParsedIntent } from "../AgentRegistry";

describe("AgentRegistry", () => {
  let registry: AgentRegistry;

  // Mock agents for testing
  const mockDefiAgent: AgentDefinition = {
    metadata: {
      name: "defi_agent",
      description: "DeFi operations agent",
      category: "defi",
      version: "1.0.0",
      capabilities: ["swap", "lend", "borrow"],
      keywords: ["swap", "trade", "lend", "borrow", "defi"],
      priority: 10,
    },
    handle: jest.fn().mockResolvedValue({ success: true }),
  };

  const mockGeneralAgent: AgentDefinition = {
    metadata: {
      name: "general_agent",
      description: "General purpose agent",
      category: "general",
      version: "1.0.0",
      capabilities: ["info", "balance", "history"],
      keywords: ["balance", "info", "check", "status"],
      priority: 5,
    },
    handle: jest.fn().mockResolvedValue({ success: true }),
  };

  const mockNftAgent: AgentDefinition = {
    metadata: {
      name: "nft_agent",
      description: "NFT operations agent",
      category: "nft",
      version: "1.0.0",
      capabilities: ["mint", "transfer", "marketplace"],
      keywords: ["nft", "mint", "collection"],
      priority: 8,
    },
    handle: jest.fn().mockResolvedValue({ success: true }),
  };

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  describe("register", () => {
    it("should register a new agent", () => {
      registry.register(mockDefiAgent);
      const agent = registry.getAgent("defi_agent");
      expect(agent).toBeDefined();
      expect(agent?.metadata.name).toBe("defi_agent");
    });

    it("should throw error when registering duplicate agent", () => {
      registry.register(mockDefiAgent);
      expect(() => registry.register(mockDefiAgent)).toThrow(
        "Agent 'defi_agent' is already registered"
      );
    });

    it("should throw error for invalid metadata", () => {
      const invalidAgent = {
        metadata: {
          name: "",
          description: "Invalid",
          category: "test",
          version: "1.0.0",
          capabilities: [],
          keywords: [],
          priority: 0,
        },
        handle: jest.fn(),
      };

      expect(() => registry.register(invalidAgent)).toThrow(
        "Agent metadata must have a valid name"
      );
    });

    it("should validate all required metadata fields", () => {
      const testCases = [
        { field: "description", value: "" },
        { field: "category", value: "" },
        { field: "version", value: "" },
        { field: "capabilities", value: "not-array" },
        { field: "keywords", value: "not-array" },
        { field: "priority", value: -1 },
      ];

      testCases.forEach(({ field, value }) => {
        const invalidAgent = {
          metadata: {
            ...mockDefiAgent.metadata,
            [field]: value,
          },
          handle: jest.fn(),
        };

        expect(() => registry.register(invalidAgent)).toThrow();
      });
    });
  });

  describe("getAgentByIntent", () => {
    beforeEach(() => {
      registry.register(mockDefiAgent);
      registry.register(mockGeneralAgent);
      registry.register(mockNftAgent);
    });

    it("should select agent by exact category match", () => {
      const intent: ParsedIntent = {
        category: "defi",
        keywords: [],
        rawInput: "test",
      };

      const agent = registry.getAgentByIntent(intent);
      expect(agent?.metadata.name).toBe("defi_agent");
    });

    it("should select agent by keyword match", () => {
      const intent: ParsedIntent = {
        keywords: ["swap", "trade"],
        rawInput: "swap tokens",
      };

      const agent = registry.getAgentByIntent(intent);
      expect(agent?.metadata.name).toBe("defi_agent");
    });

    it("should select agent by capability match", () => {
      const intent: ParsedIntent = {
        keywords: ["mint"],
        rawInput: "mint nft",
      };

      const agent = registry.getAgentByIntent(intent);
      expect(agent?.metadata.name).toBe("nft_agent");
    });

    it("should prioritize category match over keyword match", () => {
      const intent: ParsedIntent = {
        category: "general",
        keywords: ["swap"], // DeFi keyword but general category
        rawInput: "check swap status",
      };

      const agent = registry.getAgentByIntent(intent);
      expect(agent?.metadata.name).toBe("general_agent");
    });

    it("should consider agent priority in scoring", () => {
      const intent: ParsedIntent = {
        keywords: ["defi"], // Matches defi_agent keyword
        rawInput: "defi info",
      };

      const agent = registry.getAgentByIntent(intent);
      // DeFi agent has higher priority (10 vs 5)
      expect(agent?.metadata.name).toBe("defi_agent");
    });

    it("should apply confidence multiplier", () => {
      const highConfidenceIntent: ParsedIntent = {
        keywords: ["balance"],
        confidence: 0.9,
        rawInput: "check balance",
      };

      const agent = registry.getAgentByIntent(highConfidenceIntent);
      expect(agent?.metadata.name).toBe("general_agent");
    });

    it("should handle partial keyword matches", () => {
      const intent: ParsedIntent = {
        keywords: ["lending"], // Partial match with "lend"
        rawInput: "lending platform",
      };

      const agent = registry.getAgentByIntent(intent);
      expect(agent?.metadata.name).toBe("defi_agent");
    });

    it("should fall back to default agent when no match", () => {
      registry.setDefaultAgent("general_agent");

      const intent: ParsedIntent = {
        keywords: ["unknown", "random"],
        rawInput: "something random",
      };

      const agent = registry.getAgentByIntent(intent);
      expect(agent?.metadata.name).toBe("general_agent");
    });

    it("should return first available agent when no default set", () => {
      const intent: ParsedIntent = {
        keywords: ["unknown"],
        rawInput: "unknown query",
      };

      const agent = registry.getAgentByIntent(intent);
      expect(agent).toBeDefined();
    });

    it("should return undefined when no agents registered", () => {
      const emptyRegistry = new AgentRegistry();
      const intent: ParsedIntent = {
        keywords: ["test"],
        rawInput: "test",
      };

      const agent = emptyRegistry.getAgentByIntent(intent);
      expect(agent).toBeUndefined();
    });

    it("should skip disabled agents", () => {
      registry.setAgentEnabled("defi_agent", false);

      const intent: ParsedIntent = {
        category: "defi",
        keywords: ["swap"],
        rawInput: "swap tokens",
      };

      const agent = registry.getAgentByIntent(intent);
      expect(agent?.metadata.name).not.toBe("defi_agent");
    });

    it("should update lastUsed timestamp", () => {
      const intent: ParsedIntent = {
        category: "defi",
        keywords: [],
        rawInput: "test",
      };

      registry.getAgentByIntent(intent);
      const stats = registry.getStats();
      expect(stats.totalAgents).toBeGreaterThan(0);
    });
  });

  describe("setDefaultAgent", () => {
    it("should set default agent", () => {
      registry.register(mockGeneralAgent);
      registry.setDefaultAgent("general_agent");

      const intent: ParsedIntent = {
        keywords: ["unknown"],
        rawInput: "unknown",
      };

      const agent = registry.getAgentByIntent(intent);
      expect(agent?.metadata.name).toBe("general_agent");
    });

    it("should throw error for non-existent agent", () => {
      expect(() => registry.setDefaultAgent("non_existent")).toThrow(
        "Agent 'non_existent' not found in registry"
      );
    });
  });

  describe("getAgent", () => {
    it("should return agent by name", () => {
      registry.register(mockDefiAgent);
      const agent = registry.getAgent("defi_agent");
      expect(agent?.metadata.name).toBe("defi_agent");
    });

    it("should return undefined for non-existent agent", () => {
      const agent = registry.getAgent("non_existent");
      expect(agent).toBeUndefined();
    });

    it("should return undefined for disabled agent", () => {
      registry.register(mockDefiAgent);
      registry.setAgentEnabled("defi_agent", false);
      const agent = registry.getAgent("defi_agent");
      expect(agent).toBeUndefined();
    });
  });

  describe("getAllAgents", () => {
    it("should return all enabled agents", () => {
      registry.register(mockDefiAgent);
      registry.register(mockGeneralAgent);
      const agents = registry.getAllAgents();
      expect(agents).toHaveLength(2);
    });

    it("should exclude disabled agents", () => {
      registry.register(mockDefiAgent);
      registry.register(mockGeneralAgent);
      registry.setAgentEnabled("defi_agent", false);
      const agents = registry.getAllAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].metadata.name).toBe("general_agent");
    });
  });

  describe("getAgentsByCategory", () => {
    it("should return agents in specific category", () => {
      registry.register(mockDefiAgent);
      registry.register(mockGeneralAgent);
      registry.register(mockNftAgent);

      const defiAgents = registry.getAgentsByCategory("defi");
      expect(defiAgents).toHaveLength(1);
      expect(defiAgents[0].metadata.name).toBe("defi_agent");
    });

    it("should return empty array for non-existent category", () => {
      const agents = registry.getAgentsByCategory("non_existent");
      expect(agents).toHaveLength(0);
    });
  });

  describe("searchAgents", () => {
    beforeEach(() => {
      registry.register(mockDefiAgent);
      registry.register(mockGeneralAgent);
      registry.register(mockNftAgent);
    });

    it("should search by name", () => {
      const results = registry.searchAgents("defi");
      expect(results).toHaveLength(1);
      expect(results[0].metadata.name).toBe("defi_agent");
    });

    it("should search by description", () => {
      const results = registry.searchAgents("general purpose");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should search by capabilities", () => {
      const results = registry.searchAgents("swap");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should search by keywords", () => {
      const results = registry.searchAgents("mint");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should be case insensitive", () => {
      const results = registry.searchAgents("DEFI");
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("setAgentEnabled", () => {
    it("should enable/disable agent", () => {
      registry.register(mockDefiAgent);
      expect(registry.setAgentEnabled("defi_agent", false)).toBe(true);
      expect(registry.getAgent("defi_agent")).toBeUndefined();

      expect(registry.setAgentEnabled("defi_agent", true)).toBe(true);
      expect(registry.getAgent("defi_agent")).toBeDefined();
    });

    it("should return false for non-existent agent", () => {
      expect(registry.setAgentEnabled("non_existent", false)).toBe(false);
    });
  });

  describe("unregister", () => {
    it("should unregister agent", () => {
      registry.register(mockDefiAgent);
      expect(registry.unregister("defi_agent")).toBe(true);
      expect(registry.getAgent("defi_agent")).toBeUndefined();
    });

    it("should return false for non-existent agent", () => {
      expect(registry.unregister("non_existent")).toBe(false);
    });
  });

  describe("getCategories", () => {
    it("should return all categories", () => {
      registry.register(mockDefiAgent);
      registry.register(mockGeneralAgent);
      registry.register(mockNftAgent);

      const categories = registry.getCategories();
      expect(categories).toContain("defi");
      expect(categories).toContain("general");
      expect(categories).toContain("nft");
    });
  });

  describe("getStats", () => {
    it("should return registry statistics", () => {
      registry.register(mockDefiAgent);
      registry.register(mockGeneralAgent);
      registry.register(mockNftAgent);

      const stats = registry.getStats();
      expect(stats.totalAgents).toBe(3);
      expect(stats.enabledAgents).toBe(3);
      expect(stats.categories).toBe(3);
      expect(stats.agentsByCategory).toEqual({
        defi: 1,
        general: 1,
        nft: 1,
      });
    });

    it("should reflect disabled agents", () => {
      registry.register(mockDefiAgent);
      registry.register(mockGeneralAgent);
      registry.setAgentEnabled("defi_agent", false);

      const stats = registry.getStats();
      expect(stats.totalAgents).toBe(2);
      expect(stats.enabledAgents).toBe(1);
    });
  });
});
