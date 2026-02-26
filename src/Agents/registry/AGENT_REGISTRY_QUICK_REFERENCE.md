# AgentRegistry Quick Reference

## Installation

```typescript
import { agentRegistry, AgentDefinition, ParsedIntent } from "./registry";
```

## Quick Start

### 1. Define an Agent

```typescript
const myAgent: AgentDefinition = {
  metadata: {
    name: "my_agent",
    description: "My specialized agent",
    category: "my_category",
    version: "1.0.0",
    capabilities: ["capability1", "capability2"],
    keywords: ["keyword1", "keyword2"],
    priority: 10,
  },
  handle: async (input: string, userId: string) => {
    // Your logic here
    return { success: true, data: "result" };
  },
};
```

### 2. Register Agent

```typescript
agentRegistry.register(myAgent);
agentRegistry.setDefaultAgent("my_agent");
```

### 3. Route by Intent

```typescript
const intent: ParsedIntent = {
  category: "my_category",
  keywords: ["keyword1"],
  confidence: 0.9,
  rawInput: "user input text",
};

const agent = agentRegistry.getAgentByIntent(intent);
const result = await agent.handle(intent.rawInput, "user123");
```

## Common Operations

### Get Agent by Name

```typescript
const agent = agentRegistry.getAgent("agent_name");
```

### Get All Agents

```typescript
const agents = agentRegistry.getAllAgents();
```

### Get by Category

```typescript
const defiAgents = agentRegistry.getAgentsByCategory("defi");
```

### Search Agents

```typescript
const results = agentRegistry.searchAgents("swap");
```

### Enable/Disable

```typescript
agentRegistry.setAgentEnabled("agent_name", false);
agentRegistry.setAgentEnabled("agent_name", true);
```

### Get Statistics

```typescript
const stats = agentRegistry.getStats();
// { totalAgents: 3, enabledAgents: 3, categories: 2, ... }
```

## Intent Structure

```typescript
interface ParsedIntent {
  category?: string; // Optional category hint
  keywords: string[]; // Extracted keywords
  confidence?: number; // Confidence score (0-1)
  rawInput: string; // Original user input
}
```

## Scoring Weights

- Category match: 100 points
- Keyword match: 10 points each
- Partial keyword: 5 points each
- Capability match: 8 points each
- Priority multiplier: (1 + priority \* 0.1)
- Confidence multiplier: score \* confidence

## Example Agents

### DeFi Agent

```typescript
const defiAgent: AgentDefinition = {
  metadata: {
    name: "defi_agent",
    description: "DeFi operations",
    category: "defi",
    version: "1.0.0",
    capabilities: ["swap", "lend", "borrow"],
    keywords: ["swap", "trade", "lend", "defi"],
    priority: 10,
  },
  handle: async (input, userId) => {
    return { success: true, data: "DeFi operation" };
  },
};
```

### General Agent

```typescript
const generalAgent: AgentDefinition = {
  metadata: {
    name: "general_agent",
    description: "General queries",
    category: "general",
    version: "1.0.0",
    capabilities: ["info", "balance", "history"],
    keywords: ["balance", "info", "check"],
    priority: 5,
  },
  handle: async (input, userId) => {
    return { success: true, data: "Query result" };
  },
};
```

## Best Practices

1. **Set Default Agent**: Always configure a fallback

   ```typescript
   agentRegistry.setDefaultAgent("general_agent");
   ```

2. **Use Descriptive Keywords**: Match user language

   ```typescript
   keywords: ["swap", "trade", "exchange", "convert"];
   ```

3. **Set Appropriate Priority**: Higher for specialized agents

   ```typescript
   priority: 10; // Specialized
   priority: 5; // General
   ```

4. **Validate Metadata**: Ensure all required fields

   ```typescript
   // All fields are required and validated on registration
   ```

5. **Handle Errors Gracefully**
   ```typescript
   const agent = agentRegistry.getAgentByIntent(intent);
   if (!agent) {
     return { error: "No suitable agent found" };
   }
   ```

## Testing

```bash
# Run tests
npx jest --config src/Agents/registry/__tests__/jest.config.js

# Run example
npx ts-node src/Agents/registry/examples/agentRegistryExample.ts
```

## API Cheat Sheet

| Method                        | Purpose                    |
| ----------------------------- | -------------------------- |
| `register(agent)`             | Register new agent         |
| `getAgentByIntent(intent)`    | Get best matching agent ⭐ |
| `getAgent(name)`              | Get specific agent         |
| `getAllAgents()`              | Get all enabled agents     |
| `getAgentsByCategory(cat)`    | Get agents by category     |
| `searchAgents(query)`         | Search agents              |
| `setDefaultAgent(name)`       | Set default fallback       |
| `setAgentEnabled(name, bool)` | Enable/disable agent       |
| `unregister(name)`            | Remove agent               |
| `getCategories()`             | Get all categories         |
| `getStats()`                  | Get statistics             |

## Full Documentation

See `AGENT_REGISTRY.md` for complete documentation.
