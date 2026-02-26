#!/usr/bin/env ts-node

/**
 * Agent Memory Seeding Script
 *
 * This script populates the agent memory store with mock conversation data
 * for testing memory retrieval logic.
 *
 * Usage:
 * - Run directly: ts-node src/scripts/seedAgentMemory.ts
 * - Add to package.json: "seed:memory": "ts-node src/scripts/seedAgentMemory.ts"
 * - Use in tests: import { seedMemoryData } from './scripts/seedAgentMemory'
 */

import "reflect-metadata";
import { memoryStore } from "../Agents/memory/memory";

/**
 * Simple logger for seeding script
 */
const log = {
  info: (message: string, data?: unknown) => {
    console.log(`[INFO] ${message}`, data ? JSON.stringify(data, null, 2) : "");
  },
  error: (message: string, data?: unknown) => {
    console.error(`[ERROR] ${message}`, data ? JSON.stringify(data, null, 2) : "");
  },
  warn: (message: string, data?: unknown) => {
    console.warn(`[WARN] ${message}`, data ? JSON.stringify(data, null, 2) : "");
  },
};

/**
 * Mock conversation data templates
 */
const conversationTemplates = {
  stellar: [
    "User: What's my Stellar balance?",
    "Agent: Your current XLM balance is 1,234.56 XLM",
    "User: Send 100 XLM to GXXXXXXX",
    "Agent: Transaction submitted successfully. Hash: abc123...",
    "User: Show my recent transactions",
    "Agent: Here are your last 5 transactions...",
  ],
  defi: [
    "User: What's the current APY on YieldBlox?",
    "Agent: The current APY for USDC lending is 8.5%",
    "User: Swap 50 USDC for XLM",
    "Agent: Swap executed. You received 245.3 XLM",
    "User: Check my liquidity positions",
    "Agent: You have 2 active liquidity positions...",
  ],
  general: [
    "User: Hello, how can you help me?",
    "Agent: I can help with Stellar transactions, DeFi operations, and account management",
    "User: What features do you support?",
    "Agent: I support balance checks, transfers, swaps, staking, and more",
    "User: Thanks for the help!",
    "Agent: You're welcome! Let me know if you need anything else",
  ],
  trading: [
    "User: What's the current XLM price?",
    "Agent: XLM is currently trading at $0.12",
    "User: Set a price alert for $0.15",
    "Agent: Price alert set for XLM at $0.15",
    "User: Show my trading history",
    "Agent: Here are your recent trades...",
  ],
  staking: [
    "User: How do I stake my XLM?",
    "Agent: You can stake XLM through various validators. Current APY is ~5%",
    "User: Stake 500 XLM with validator ABC",
    "Agent: Staking transaction submitted successfully",
    "User: Check my staking rewards",
    "Agent: You've earned 2.5 XLM in rewards this month",
  ],
};

/**
 * Agent IDs for different test scenarios
 */
const agentIds = {
  user1: "agent-user-001",
  user2: "agent-user-002",
  user3: "agent-user-003",
  testAgent: "test-agent-001",
  performanceAgent: "perf-agent-001",
};

/**
 * Seed memory with mock conversation data
 */
export function seedMemoryData(clearExisting = true): void {
  try {
    log.info("Starting agent memory seeding...");

    // Clear existing data if requested
    if (clearExisting) {
      memoryStore.clearAll();
      log.info("Cleared existing memory data");
    }

    // Seed User 1: Stellar-focused conversations
    conversationTemplates.stellar.forEach((entry) => {
      memoryStore.add(agentIds.user1, entry);
    });
    log.info(`Seeded ${conversationTemplates.stellar.length} entries for ${agentIds.user1}`);

    // Seed User 2: DeFi-focused conversations
    conversationTemplates.defi.forEach((entry) => {
      memoryStore.add(agentIds.user2, entry);
    });
    log.info(`Seeded ${conversationTemplates.defi.length} entries for ${agentIds.user2}`);

    // Seed User 3: Mixed conversations
    const mixedConversations = [
      ...conversationTemplates.general,
      ...conversationTemplates.trading.slice(0, 3),
    ];
    mixedConversations.forEach((entry) => {
      memoryStore.add(agentIds.user3, entry);
    });
    log.info(`Seeded ${mixedConversations.length} entries for ${agentIds.user3}`);

    // Seed Test Agent: All conversation types
    const allTemplates = [
      ...conversationTemplates.stellar,
      ...conversationTemplates.defi,
      ...conversationTemplates.general,
      ...conversationTemplates.trading,
      ...conversationTemplates.staking,
    ];
    allTemplates.forEach((entry) => {
      memoryStore.add(agentIds.testAgent, entry);
    });
    log.info(`Seeded comprehensive data for ${agentIds.testAgent}`);

    // Seed Performance Agent: Large dataset for performance testing
    const templateArray = [
      conversationTemplates.stellar,
      conversationTemplates.defi,
      conversationTemplates.general,
      conversationTemplates.trading,
      conversationTemplates.staking,
    ];
    for (let i = 0; i < 100; i++) {
      const template = templateArray[i % 5];
      const entry = template[i % template.length];
      memoryStore.add(agentIds.performanceAgent, `[${i}] ${entry}`);
    }
    log.info(`Seeded 100 entries for ${agentIds.performanceAgent}`);

    log.info("Agent memory seeding completed successfully");
  } catch (error) {
    log.error("Agent memory seeding failed", { error });
    throw error;
  }
}

/**
 * Seed specific agent with custom data
 */
export function seedAgentMemory(
  agentId: string,
  entries: string[],
  clearExisting = false
): void {
  try {
    if (clearExisting) {
      memoryStore.clear(agentId);
    }

    entries.forEach((entry) => {
      memoryStore.add(agentId, entry);
    });

    log.info(`Seeded ${entries.length} entries for agent ${agentId}`);
  } catch (error) {
    log.error(`Failed to seed memory for agent ${agentId}`, { error });
    throw error;
  }
}

/**
 * Get seeded agent IDs for testing
 */
export function getSeededAgentIds() {
  return agentIds;
}

/**
 * Get conversation templates for custom seeding
 */
export function getConversationTemplates() {
  return conversationTemplates;
}

/**
 * Verify seeded data
 */
export function verifySeededData(): boolean {
  try {
    const user1Memory = memoryStore.get(agentIds.user1);
    const user2Memory = memoryStore.get(agentIds.user2);
    const user3Memory = memoryStore.get(agentIds.user3);
    const testAgentMemory = memoryStore.get(agentIds.testAgent);
    const perfAgentMemory = memoryStore.get(agentIds.performanceAgent);

    // Note: MemoryStore has a default max context of 10 entries per agent
    // So we verify that data exists, not the exact count
    const isValid =
      user1Memory.length > 0 &&
      user2Memory.length > 0 &&
      user3Memory.length > 0 &&
      testAgentMemory.length > 0 &&
      perfAgentMemory.length > 0;

    if (isValid) {
      log.info("Memory data verification passed");
      log.info("Memory stats:", {
        user1Entries: user1Memory.length,
        user2Entries: user2Memory.length,
        user3Entries: user3Memory.length,
        testAgentEntries: testAgentMemory.length,
        perfAgentEntries: perfAgentMemory.length,
      });
    } else {
      log.warn("Memory data verification failed");
    }

    return isValid;
  } catch (error) {
    log.error("Memory data verification error", { error });
    return false;
  }
}
