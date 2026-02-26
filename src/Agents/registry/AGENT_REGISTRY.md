# AgentRegistry - Dynamic Agent Selection

The `AgentRegistry` enables dynamic agent selection based on parsed user intent, allowing the system to intelligently route requests to specialized agents (e.g., DeFi vs. General Query vs. NFT operations).

## Overview

The AgentRegistry provides a centralized system for:

- Registering specialized agents with metadata about their capabilities
- Dynamically selecting the best agent based on user intent
- Managing agent lifecycle (enable/disable, priority, categories)
- Searching and discovering available agents

## Key Features

- **Intent-Based Routing**: Automatically selects the best agent based on parsed user intent
- **Priority System**: Higher priority agents are preferred when multiple agents match
- **Category Organization**: Agents are organized by category (defi, nft, general, etc.)
- **Keyword Matching**: Matches agents based on keywords and capabilities
- **Confidence Scoring**: Applies confidence multipliers to intent matching
- **Default Fallback**: Configurable default agent when no specific match is found
- **Enable/Disable**: Runtime control over agent availability

## Architecture

### Core Components

1. **AgentRegistry** - Central registry managing all agents
2. **AgentDefinition** - Interface defining agent structure
3. **AgentMetadata** - Metadata describing agent capabilities
4. **ParsedIntent** - Structure representing parsed user intent

### Agent Metadata Schema

```typescript
interface AgentMetadata {
  name: string; // Unique agent identifier
  description: string; // Human-readable description
  category: string; // Agent category (defi, nft, general, etc.)
  version: string; // Agent version
  capabilities: string[]; // List of capabilities
  keywords: string[]; // Keywords for intent matching
  priority: number; // Priority (higher = preferred)
}
```

### Parsed Intent Schema

```typescript
interface ParsedIntent {
  category?: string; // Optional category hint
  keywords: string[]; // Extracted keywords from user input
  confidence?: number; // Confidence score (0-1)
  rawInput: string; // Original user input
}
```

## Usage

### 1. Define Specialized Agents

```typescript
import { AgentDefinition } from "./registry/AgentRegistry";

// DeFi Agent
const defiAgent: AgentDefinition = {
  metadata: {
    name: "defi_agent",
    description: "Specialized agent for DeFi operations",
    category: "defi",
    version: "1.0.0",
    capabilities: ["swap", "lend", "borrow", "liquidity"],
    keywords: ["swap", "trade", "lend", "borrow", "defi", "yield"],
    priority: 10,
  },
  handle: async (input: string, userId: string) => {
    // DeFi-specific logic
    return { success: true, data: "DeFi operation completed" };
  },
};

// General Agent
const generalAgent: AgentDefinition = {
  metadata: {
    name: "general_agent",
    description: "General purpose agent",
    category: "general",
    version: "1.0.0",
    capabilities: ["info", "balance", "history"],
    keywords: ["balance", "info", "check", "status"],
    priority: 5,
  },
  handle: async (input: string, userId: string) => {
    // General query logic
    return { success: true, data: "Query processed" };
  },
};
```

### 2. Register Agents

```typescript
import { agentRegistry } from "./registry/AgentRegistry";

// Register agents
agentRegistry.register(defiAgent);
agentRegistry.register(generalAgent);

// Set default fallback agent
agentRegistry.setDefaultAgent("general_agent");
```

### 3. Route Requests by Intent

```typescript
// Parse user intent (use LLM or NLP service in production)
const intent: ParsedIntent = {
  category: "defi",
  keywords: ["swap", "trade"],
  confidence: 0.9,
  rawInput: "I want to swap 100 USDC for ETH",
};

// Get best matching agent
const agent = agentRegistry.getAgentByIntent(intent);

if (agent) {
  const result = await agent.handle(intent.rawInput, userId);
  console.log(result);
}
```

## Intent Matching Algorithm

The `getAgentByIntent` method uses a scoring algorithm to select the best agent:

### Scoring Factors

1. **Category Match** (100 points)
   - Exact match between intent category and agent category

2. **Keyword Match** (10 points each)
   - Exact keyword match between intent and agent keywords

3. **Partial Keyword Match** (5 points each)
   - Partial match (substring) between keywords

4. **Capability Match** (8 points each)
   - Keywords matching agent capabilities

5. **Priority Multiplier**
   - Score multiplied by `(1 + priority * 0.1)`

6. **Confidence Multiplier**
   - Score multiplied by intent confidence (if provided)

### Selection Process

1. Score all enabled agents
2. Sort by score (descending)
3. Return highest scoring agent if score > 0
4. Fall back to default agent if set
5. Return first available agent as last resort

## API Reference

### Registration

#### `register(agent: AgentDefinition): void`

Register a new agent with the registry.

```typescript
agentRegistry.register(myAgent);
```

**Throws**: Error if agent name already exists or metadata is invalid

#### `setDefaultAgent(agentName: string): void`

Set the default fallback agent.

```typescript
agentRegistry.setDefaultAgent("general_agent");
```

### Agent Selection

#### `getAgentByIntent(intent: ParsedIntent): AgentDefinition | undefined`

Get the best matching agent for a parsed intent.

```typescript
const agent = agentRegistry.getAgentByIntent({
  category: "defi",
  keywords: ["swap", "trade"],
  confidence: 0.9,
  rawInput: "swap tokens",
});
```

**Returns**: Best matching agent or undefined if no agents available

#### `getAgent(agentName: string): AgentDefinition | undefined`

Get a specific agent by name.

```typescript
const agent = agentRegistry.getAgent("defi_agent");
```

### Discovery

#### `getAllAgents(): AgentDefinition[]`

Get all enabled agents.

```typescript
const agents = agentRegistry.getAllAgents();
```

#### `getAgentsByCategory(category: string): AgentDefinition[]`

Get all agents in a specific category.

```typescript
const defiAgents = agentRegistry.getAgentsByCategory("defi");
```

#### `searchAgents(query: string): AgentDefinition[]`

Search agents by name, description, capabilities, or keywords.

```typescript
const results = agentRegistry.searchAgents("swap");
```

#### `getCategories(): string[]`

Get all available categories.

```typescript
const categories = agentRegistry.getCategories();
```

### Management

#### `setAgentEnabled(agentName: string, enabled: boolean): boolean`

Enable or disable an agent.

```typescript
agentRegistry.setAgentEnabled("defi_agent", false);
```

**Returns**: true if successful, false if agent not found

#### `unregister(agentName: string): boolean`

Remove an agent from the registry.

```typescript
agentRegistry.unregister("defi_agent");
```

**Returns**: true if successful, false if agent not found

#### `getStats(): object`

Get registry statistics.

```typescript
const stats = agentRegistry.getStats();
// {
//   totalAgents: 3,
//   enabledAgents: 3,
//   categories: 3,
//   agentsByCategory: { defi: 1, general: 1, nft: 1 }
// }
```

## Integration Example

### Complete Workflow

```typescript
import { agentRegistry, ParsedIntent } from "./registry/AgentRegistry";
import { intentAgent } from "./agents/intentagent";

// 1. Register specialized agents at startup
function initializeAgents() {
  agentRegistry.register(defiAgent);
  agentRegistry.register(nftAgent);
  agentRegistry.register(generalAgent);
  agentRegistry.setDefaultAgent("general_agent");
}

// 2. Parse user intent (integrate with existing intent parsing)
async function parseIntent(userInput: string): Promise<ParsedIntent> {
  // Use LLM or NLP to parse intent
  // This could integrate with existing intentAgent logic
  const parsed = await someLLMService.parse(userInput);

  return {
    category: parsed.category,
    keywords: parsed.keywords,
    confidence: parsed.confidence,
    rawInput: userInput,
  };
}

// 3. Route to appropriate agent
async function handleUserRequest(userInput: string, userId: string) {
  const intent = await parseIntent(userInput);
  const agent = agentRegistry.getAgentByIntent(intent);

  if (!agent) {
    return { success: false, error: "No suitable agent found" };
  }

  console.log(`Routing to agent: ${agent.metadata.name}`);
  return await agent.handle(userInput, userId);
}

// Initialize and use
initializeAgents();
const result = await handleUserRequest("Swap 100 USDC for ETH", "user123");
```

## Best Practices

### 1. Agent Design

- **Single Responsibility**: Each agent should handle a specific domain
- **Clear Keywords**: Use descriptive keywords that users are likely to use
- **Appropriate Priority**: Set priority based on specialization level
- **Comprehensive Capabilities**: List all capabilities for better matching

### 2. Intent Parsing

- **Use LLM/NLP**: Leverage language models for accurate intent parsing
- **Extract Keywords**: Identify key terms from user input
- **Determine Category**: Classify intent into broad categories
- **Calculate Confidence**: Provide confidence scores for better routing

### 3. Registry Management

- **Set Default Agent**: Always configure a default fallback agent
- **Monitor Usage**: Track which agents are being selected
- **Update Metadata**: Keep agent metadata current as capabilities evolve
- **Test Routing**: Verify intent routing with various user inputs

### 4. Error Handling

- **Graceful Fallback**: Use default agent when no match found
- **Logging**: Log agent selection decisions for debugging
- **Validation**: Validate agent metadata during registration

## Testing

Comprehensive tests are available in `__tests__/AgentRegistry.test.ts`:

```bash
npm test -- src/Agents/registry/__tests__/AgentRegistry.test.ts
```

Test coverage includes:

- Agent registration and validation
- Intent-based agent selection
- Scoring algorithm
- Category and keyword matching
- Priority handling
- Default agent fallback
- Enable/disable functionality
- Search and discovery

## Examples

See `examples/agentRegistryExample.ts` for complete working examples:

```bash
npx ts-node src/Agents/registry/examples/agentRegistryExample.ts
```

## Migration Guide

### Integrating with Existing System

1. **Register Existing Agents**: Wrap existing agent logic in AgentDefinition
2. **Update Intent Parsing**: Modify intentAgent to return ParsedIntent
3. **Route Through Registry**: Use getAgentByIntent instead of direct agent calls
4. **Gradual Migration**: Can coexist with existing routing logic

### Example Migration

```typescript
// Before
const result = await intentAgent.handle(userInput, userId);

// After
const intent = await parseIntent(userInput);
const agent = agentRegistry.getAgentByIntent(intent);
const result = await agent.handle(userInput, userId);
```

## Future Enhancements

- **Machine Learning**: Train models on agent selection patterns
- **A/B Testing**: Test different routing strategies
- **Analytics**: Track agent performance and user satisfaction
- **Dynamic Priority**: Adjust priorities based on success rates
- **Multi-Agent**: Support routing to multiple agents for complex queries

## Related Documentation

- [Tool Registry](./README.md) - Dynamic tool registration system
- [Intent Agent](../agents/intentagent.ts) - Intent parsing and workflow planning
- [Agent Planner](../planner/README.md) - Multi-step workflow planning
