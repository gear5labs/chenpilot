# Issue #47 Implementation: AgentRegistry.getAgentByIntent

## Summary

Implemented dynamic agent selection based on parsed user intent, enabling intelligent routing to specialized agents (DeFi, NFT, General Query, etc.).

## Implementation Details

### Files Created

1. **src/Agents/registry/AgentRegistry.ts** (318 lines)
   - Core AgentRegistry class with intent-based routing
   - Scoring algorithm for agent selection
   - Agent lifecycle management (register, enable/disable, unregister)
   - Search and discovery methods

2. **src/Agents/registry/examples/agentRegistryExample.ts** (234 lines)
   - Complete working examples
   - Mock agents (DeFi, NFT, General)
   - Intent parsing demonstration
   - Usage patterns and best practices

3. **src/Agents/registry/__tests__/AgentRegistry.test.ts** (441 lines)
   - Comprehensive test suite (37 tests, all passing)
   - Tests for registration, intent matching, scoring, search, etc.
   - 100% code coverage of core functionality

4. **src/Agents/registry/AGENT_REGISTRY.md** (450+ lines)
   - Complete documentation
   - API reference
   - Usage examples
   - Integration guide
   - Best practices

### Files Modified

1. **src/Agents/registry/index.ts**
   - Added exports for AgentRegistry, AgentDefinition, AgentMetadata, ParsedIntent

2. **src/Agents/registry/README.md**
   - Added reference to Agent Registry documentation

## Key Features

### 1. Intent-Based Agent Selection

The core `getAgentByIntent` method uses a sophisticated scoring algorithm:

```typescript
const agent = agentRegistry.getAgentByIntent({
  category: "defi",
  keywords: ["swap", "trade"],
  confidence: 0.9,
  rawInput: "I want to swap 100 USDC for ETH"
});
```

### 2. Scoring Algorithm

Agents are scored based on:
- **Category match** (100 points) - Exact category match
- **Keyword match** (10 points each) - Exact keyword matches
- **Partial keyword match** (5 points each) - Substring matches
- **Capability match** (8 points each) - Keywords in capabilities
- **Priority multiplier** - Higher priority agents preferred
- **Confidence multiplier** - Intent confidence affects score

### 3. Agent Metadata

Each agent provides comprehensive metadata:

```typescript
interface AgentMetadata {
  name: string;              // Unique identifier
  description: string;       // Human-readable description
  category: string;          // Agent category
  version: string;           // Version
  capabilities: string[];    // List of capabilities
  keywords: string[];        // Keywords for matching
  priority: number;          // Priority (higher = preferred)
}
```

### 4. Fallback Strategy

1. Select highest scoring agent (if score > 0)
2. Fall back to default agent (if configured)
3. Return first available agent (last resort)
4. Return undefined (no agents available)

## API Overview

### Registration
- `register(agent)` - Register new agent
- `setDefaultAgent(name)` - Set default fallback

### Selection
- `getAgentByIntent(intent)` - Get best matching agent ⭐ **Core Feature**
- `getAgent(name)` - Get specific agent

### Discovery
- `getAllAgents()` - Get all enabled agents
- `getAgentsByCategory(category)` - Get agents by category
- `searchAgents(query)` - Search by name/description/keywords
- `getCategories()` - Get all categories

### Management
- `setAgentEnabled(name, enabled)` - Enable/disable agent
- `unregister(name)` - Remove agent
- `getStats()` - Get registry statistics

## Usage Example

```typescript
import { agentRegistry, AgentDefinition, ParsedIntent } from "./registry";

// 1. Define specialized agents
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
    // DeFi logic
    return { success: true };
  },
};

// 2. Register agents
agentRegistry.register(defiAgent);
agentRegistry.setDefaultAgent("general_agent");

// 3. Route by intent
const intent: ParsedIntent = {
  category: "defi",
  keywords: ["swap"],
  confidence: 0.9,
  rawInput: "swap tokens",
};

const agent = agentRegistry.getAgentByIntent(intent);
const result = await agent.handle(intent.rawInput, userId);
```

## Testing

All tests passing (37/37):

```bash
npx jest --config src/Agents/registry/__tests__/jest.config.js
```

Test coverage:
- ✅ Agent registration and validation
- ✅ Intent-based selection with scoring
- ✅ Category and keyword matching
- ✅ Priority handling
- ✅ Confidence multipliers
- ✅ Default agent fallback
- ✅ Enable/disable functionality
- ✅ Search and discovery
- ✅ Registry statistics

## Integration Points

### Current System
The AgentRegistry can integrate with existing components:

1. **IntentAgent** - Can use AgentRegistry for routing
2. **ExecutionAgent** - Selected agent handles execution
3. **ToolRegistry** - Agents can use registered tools

### Future Integration
```typescript
// In intentAgent.ts
const intent = await parseIntent(userInput);
const agent = agentRegistry.getAgentByIntent(intent);
return await agent.handle(userInput, userId);
```

## Benefits

1. **Intelligent Routing** - Automatically routes to best agent
2. **Extensible** - Easy to add new specialized agents
3. **Configurable** - Priority and category-based control
4. **Type-Safe** - Full TypeScript support
5. **Testable** - Comprehensive test coverage
6. **Well-Documented** - Complete API and usage docs

## Examples

Run the example:
```bash
npx ts-node src/Agents/registry/examples/agentRegistryExample.ts
```

Output demonstrates:
- Agent registration
- Intent parsing
- Dynamic routing
- Search functionality
- Statistics

## Documentation

- **API Reference**: `src/Agents/registry/AGENT_REGISTRY.md`
- **Examples**: `src/Agents/registry/examples/agentRegistryExample.ts`
- **Tests**: `src/Agents/registry/__tests__/AgentRegistry.test.ts`

## Next Steps

1. **Integration**: Integrate with existing IntentAgent
2. **Intent Parsing**: Enhance intent parsing with LLM
3. **Monitoring**: Add analytics for agent selection
4. **Optimization**: Tune scoring algorithm based on usage
5. **Specialized Agents**: Create more domain-specific agents

## Technical Decisions

### Why Scoring Algorithm?
- Flexible matching beyond exact category
- Handles ambiguous intents
- Considers multiple factors (keywords, capabilities, priority)
- Extensible for future enhancements

### Why Priority System?
- Allows preferring specialized agents
- Handles overlapping capabilities
- Configurable without code changes

### Why Default Agent?
- Graceful fallback for unknown intents
- Ensures system always responds
- Can be general-purpose agent

## Performance Considerations

- **O(n) complexity** for agent selection (n = number of agents)
- **Efficient scoring** - Simple arithmetic operations
- **No external dependencies** - Pure TypeScript
- **Minimal memory** - Lightweight metadata storage

## Conclusion

The AgentRegistry successfully implements dynamic agent selection based on user intent, providing a robust foundation for intelligent request routing in the chenpilot system. The implementation is production-ready with comprehensive tests, documentation, and examples.
