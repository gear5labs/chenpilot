/**
 * AgentRegistry Example
 *
 * Demonstrates how to use the AgentRegistry to dynamically route
 * requests to specialized agents based on user intent.
 */

import { agentRegistry, AgentDefinition, ParsedIntent } from "../AgentRegistry";

// Example 1: Define specialized agents

// DeFi Agent - handles DeFi-related queries
const defiAgent: AgentDefinition = {
  metadata: {
    name: "defi_agent",
    description:
      "Specialized agent for DeFi operations like swaps, lending, and liquidity",
    category: "defi",
    version: "1.0.0",
    capabilities: [
      "token_swap",
      "liquidity_provision",
      "lending",
      "borrowing",
      "yield_farming",
    ],
    keywords: [
      "swap",
      "trade",
      "exchange",
      "lend",
      "borrow",
      "liquidity",
      "pool",
      "defi",
      "yield",
    ],
    priority: 10, // High priority for DeFi queries
  },
  handle: async (input: string, userId: string) => {
    console.log(`DeFi Agent handling: ${input} for user ${userId}`);
    // DeFi-specific logic here
    return {
      success: true,
      agent: "defi_agent",
      message: "DeFi operation completed",
    };
  },
};

// General Query Agent - handles general questions
const generalAgent: AgentDefinition = {
  metadata: {
    name: "general_agent",
    description:
      "General purpose agent for information queries and basic operations",
    category: "general",
    version: "1.0.0",
    capabilities: [
      "information_retrieval",
      "balance_check",
      "transaction_history",
      "general_query",
    ],
    keywords: [
      "balance",
      "info",
      "what",
      "how",
      "when",
      "history",
      "status",
      "check",
    ],
    priority: 5, // Lower priority than specialized agents
  },
  handle: async (input: string, userId: string) => {
    console.log(`General Agent handling: ${input} for user ${userId}`);
    // General query logic here
    return {
      success: true,
      agent: "general_agent",
      message: "Query processed",
    };
  },
};

// NFT Agent - handles NFT-related operations
const nftAgent: AgentDefinition = {
  metadata: {
    name: "nft_agent",
    description: "Specialized agent for NFT minting, trading, and management",
    category: "nft",
    version: "1.0.0",
    capabilities: [
      "nft_mint",
      "nft_transfer",
      "nft_marketplace",
      "collection_management",
    ],
    keywords: ["nft", "mint", "collection", "artwork", "token", "collectible"],
    priority: 8,
  },
  handle: async (input: string, userId: string) => {
    console.log(`NFT Agent handling: ${input} for user ${userId}`);
    return {
      success: true,
      agent: "nft_agent",
      message: "NFT operation completed",
    };
  },
};

// Example 2: Register agents
function registerAgents() {
  agentRegistry.register(defiAgent);
  agentRegistry.register(generalAgent);
  agentRegistry.register(nftAgent);

  // Set general agent as default fallback
  agentRegistry.setDefaultAgent("general_agent");

  console.log("Agents registered:", agentRegistry.getStats());
}

// Example 3: Parse user intent and route to appropriate agent
async function routeUserRequest(userInput: string, userId: string) {
  // In a real system, you would use an LLM or NLP service to parse intent
  // For this example, we'll create mock parsed intents
  const intent = parseUserIntent(userInput);

  console.log("\n--- Routing Request ---");
  console.log("User Input:", userInput);
  console.log("Parsed Intent:", intent);

  // Get the best matching agent
  const agent = agentRegistry.getAgentByIntent(intent);

  if (agent) {
    console.log("Selected Agent:", agent.metadata.name);
    const result = await agent.handle(userInput, userId);
    console.log("Result:", result);
    return result;
  } else {
    console.log("No agent found for intent");
    return { success: false, error: "No suitable agent found" };
  }
}

// Mock intent parser (in production, use LLM or NLP)
function parseUserIntent(input: string): ParsedIntent {
  const lowerInput = input.toLowerCase();

  // DeFi intent detection
  if (
    lowerInput.includes("swap") ||
    lowerInput.includes("trade") ||
    lowerInput.includes("lend") ||
    lowerInput.includes("borrow")
  ) {
    return {
      category: "defi",
      keywords: extractKeywords(input, [
        "swap",
        "trade",
        "lend",
        "borrow",
        "liquidity",
      ]),
      confidence: 0.9,
      rawInput: input,
    };
  }

  // NFT intent detection
  if (
    lowerInput.includes("nft") ||
    lowerInput.includes("mint") ||
    lowerInput.includes("collection")
  ) {
    return {
      category: "nft",
      keywords: extractKeywords(input, [
        "nft",
        "mint",
        "collection",
        "artwork",
      ]),
      confidence: 0.85,
      rawInput: input,
    };
  }

  // General intent (default)
  return {
    category: "general",
    keywords: extractKeywords(input, ["balance", "info", "check", "status"]),
    confidence: 0.7,
    rawInput: input,
  };
}

function extractKeywords(input: string, possibleKeywords: string[]): string[] {
  const lowerInput = input.toLowerCase();
  return possibleKeywords.filter((kw) => lowerInput.includes(kw));
}

// Example 4: Run demonstrations
async function runExamples() {
  console.log("=== AgentRegistry Example ===\n");

  // Register all agents
  registerAgents();

  // Test various user inputs
  const testInputs = [
    "I want to swap 100 USDC for ETH",
    "What's my wallet balance?",
    "Mint an NFT from my collection",
    "Lend 500 DAI to earn yield",
    "Show me my transaction history",
  ];

  for (const input of testInputs) {
    await routeUserRequest(input, "user123");
    console.log("\n");
  }

  // Example 5: Search agents
  console.log("--- Search Agents ---");
  const defiAgents = agentRegistry.searchAgents("swap");
  console.log(
    "Agents matching 'swap':",
    defiAgents.map((a) => a.metadata.name)
  );

  // Example 6: Get agents by category
  console.log("\n--- Agents by Category ---");
  const categories = agentRegistry.getCategories();
  categories.forEach((category) => {
    const agents = agentRegistry.getAgentsByCategory(category);
    console.log(
      `${category}:`,
      agents.map((a) => a.metadata.name)
    );
  });

  // Example 7: Registry statistics
  console.log("\n--- Registry Statistics ---");
  console.log(agentRegistry.getStats());
}

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples().catch(console.error);
}

export { registerAgents, routeUserRequest, parseUserIntent };
