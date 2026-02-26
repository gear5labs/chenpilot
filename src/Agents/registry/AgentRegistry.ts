import logger from "../../config/logger";

/**
 * Agent metadata defining agent capabilities and specialization
 */
export interface AgentMetadata {
  name: string;
  description: string;
  category: string;
  version: string;
  capabilities: string[];
  keywords: string[];
  priority: number; // Higher priority agents are preferred when multiple match
}

/**
 * Agent definition interface
 */
export interface AgentDefinition {
  metadata: AgentMetadata;
  handle: (input: string, userId: string) => Promise<unknown>;
}

/**
 * Registry entry for an agent
 */
interface AgentRegistryEntry {
  name: string;
  definition: AgentDefinition;
  enabled: boolean;
  lastUsed?: Date;
}

/**
 * Parsed intent structure
 */
export interface ParsedIntent {
  category?: string;
  keywords: string[];
  confidence?: number;
  rawInput: string;
}

/**
 * AgentRegistry manages dynamic agent selection based on user intent
 * Allows routing requests to specialized agents (e.g., DeFi vs. General Query)
 */
export class AgentRegistry {
  private agents: Map<string, AgentRegistryEntry> = new Map();
  private categories: Set<string> = new Set();
  private defaultAgent: string | null = null;

  /**
   * Register a new agent with the registry
   */
  register(agent: AgentDefinition): void {
    const { metadata } = agent;
    const name = metadata.name;

    if (this.agents.has(name)) {
      throw new Error(`Agent '${name}' is already registered`);
    }

    this.validateAgentMetadata(metadata);

    this.agents.set(name, {
      name,
      definition: agent,
      enabled: true,
    });

    this.categories.add(metadata.category);
    logger.info("Agent registered", { name, category: metadata.category });
  }

  /**
   * Set the default agent to use when no specific agent matches
   */
  setDefaultAgent(agentName: string): void {
    if (!this.agents.has(agentName)) {
      throw new Error(`Agent '${agentName}' not found in registry`);
    }
    this.defaultAgent = agentName;
    logger.info("Default agent set", { agentName });
  }

  /**
   * Get an agent by name
   */
  getAgent(agentName: string): AgentDefinition | undefined {
    const entry = this.agents.get(agentName);
    return entry?.enabled ? entry.definition : undefined;
  }

  /**
   * Get agent by parsed intent - core functionality for dynamic routing
   * Matches agents based on category, keywords, and capabilities
   *
   * @param intent - Parsed user intent with category and keywords
   * @returns Best matching agent or default agent if no match found
   */
  getAgentByIntent(intent: ParsedIntent): AgentDefinition | undefined {
    logger.debug("Finding agent by intent", { intent });

    const enabledAgents = Array.from(this.agents.values()).filter(
      (entry) => entry.enabled
    );

    if (enabledAgents.length === 0) {
      logger.warn("No enabled agents in registry");
      return undefined;
    }

    // Score each agent based on intent match
    const scoredAgents = enabledAgents.map((entry) => {
      const agent = entry.definition;
      let score = 0;

      // Category match (highest weight)
      if (intent.category && agent.metadata.category === intent.category) {
        score += 100;
      }

      // Keyword matches
      const intentKeywords = intent.keywords.map((k) => k.toLowerCase());
      const agentKeywords = agent.metadata.keywords.map((k) => k.toLowerCase());

      for (const keyword of intentKeywords) {
        if (agentKeywords.includes(keyword)) {
          score += 10;
        }
        // Partial keyword match
        if (
          agentKeywords.some(
            (ak) => ak.includes(keyword) || keyword.includes(ak)
          )
        ) {
          score += 5;
        }
      }

      // Capability matches
      const agentCapabilities = agent.metadata.capabilities.map((c) =>
        c.toLowerCase()
      );
      for (const keyword of intentKeywords) {
        if (agentCapabilities.some((cap) => cap.includes(keyword))) {
          score += 8;
        }
      }

      // Apply priority multiplier
      score *= 1 + agent.metadata.priority * 0.1;

      // Apply confidence if provided
      if (intent.confidence) {
        score *= intent.confidence;
      }

      return { agent, score };
    });

    // Sort by score descending
    scoredAgents.sort((a, b) => b.score - a.score);

    const bestMatch = scoredAgents[0];

    // If best match has a reasonable score, use it
    if (bestMatch.score > 0) {
      logger.info("Agent selected by intent", {
        agentName: bestMatch.agent.metadata.name,
        score: bestMatch.score,
        category: intent.category,
      });

      // Update last used timestamp
      const entry = this.agents.get(bestMatch.agent.metadata.name);
      if (entry) {
        entry.lastUsed = new Date();
      }

      return bestMatch.agent;
    }

    // Fall back to default agent
    if (this.defaultAgent) {
      logger.info("Using default agent", { defaultAgent: this.defaultAgent });
      const defaultEntry = this.agents.get(this.defaultAgent);
      if (defaultEntry) {
        defaultEntry.lastUsed = new Date();
        return defaultEntry.definition;
      }
    }

    // Return first enabled agent as last resort
    logger.warn("No matching agent found, using first available");
    return enabledAgents[0]?.definition;
  }

  /**
   * Get all registered agents
   */
  getAllAgents(): AgentDefinition[] {
    return Array.from(this.agents.values())
      .filter((entry) => entry.enabled)
      .map((entry) => entry.definition);
  }

  /**
   * Get agents by category
   */
  getAgentsByCategory(category: string): AgentDefinition[] {
    return this.getAllAgents().filter(
      (agent) => agent.metadata.category === category
    );
  }

  /**
   * Get all available categories
   */
  getCategories(): string[] {
    return Array.from(this.categories);
  }

  /**
   * Enable/disable an agent
   */
  setAgentEnabled(agentName: string, enabled: boolean): boolean {
    const entry = this.agents.get(agentName);
    if (entry) {
      entry.enabled = enabled;
      logger.info("Agent enabled status changed", { agentName, enabled });
      return true;
    }
    return false;
  }

  /**
   * Unregister an agent
   */
  unregister(agentName: string): boolean {
    const deleted = this.agents.delete(agentName);
    if (deleted) {
      logger.info("Agent unregistered", { agentName });
    }
    return deleted;
  }

  /**
   * Search agents by name, description, or capabilities
   */
  searchAgents(query: string): AgentDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllAgents().filter(
      (agent) =>
        agent.metadata.name.toLowerCase().includes(lowerQuery) ||
        agent.metadata.description.toLowerCase().includes(lowerQuery) ||
        agent.metadata.capabilities.some((cap) =>
          cap.toLowerCase().includes(lowerQuery)
        ) ||
        agent.metadata.keywords.some((kw) =>
          kw.toLowerCase().includes(lowerQuery)
        )
    );
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalAgents: number;
    enabledAgents: number;
    categories: number;
    agentsByCategory: Record<string, number>;
  } {
    const allAgents = this.getAllAgents();
    const agentsByCategory: Record<string, number> = {};

    allAgents.forEach((agent) => {
      const category = agent.metadata.category;
      agentsByCategory[category] = (agentsByCategory[category] || 0) + 1;
    });

    return {
      totalAgents: this.agents.size,
      enabledAgents: allAgents.length,
      categories: this.categories.size,
      agentsByCategory,
    };
  }

  /**
   * Validate agent metadata structure
   */
  private validateAgentMetadata(metadata: AgentMetadata): void {
    if (!metadata.name || typeof metadata.name !== "string") {
      throw new Error("Agent metadata must have a valid name");
    }

    if (!metadata.description || typeof metadata.description !== "string") {
      throw new Error("Agent metadata must have a valid description");
    }

    if (!metadata.category || typeof metadata.category !== "string") {
      throw new Error("Agent metadata must have a valid category");
    }

    if (!metadata.version || typeof metadata.version !== "string") {
      throw new Error("Agent metadata must have a valid version");
    }

    if (!Array.isArray(metadata.capabilities)) {
      throw new Error("Agent metadata must have valid capabilities array");
    }

    if (!Array.isArray(metadata.keywords)) {
      throw new Error("Agent metadata must have valid keywords array");
    }

    if (typeof metadata.priority !== "number" || metadata.priority < 0) {
      throw new Error("Agent metadata must have a valid priority (>= 0)");
    }
  }
}

export const agentRegistry = new AgentRegistry();
