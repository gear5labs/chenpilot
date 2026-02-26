# Agent Memory Seeding Guide

This guide explains how to use the agent memory seeding script for testing memory retrieval logic.

## Overview

The agent memory seeding script (`src/scripts/seedAgentMemory.ts`) populates the in-memory agent conversation store with realistic mock data for testing purposes. This is essential for:

- Testing memory retrieval logic
- Performance testing with realistic datasets
- Integration testing with conversation context
- Development and debugging

## Quick Start

### Run the Seeding Script

```bash
# Using npm script
npm run seed:memory

# Or directly with ts-node
ts-node src/scripts/seedAgentMemory.ts
```

### Use in Tests

```typescript
import {
  seedMemoryData,
  getSeededAgentIds,
} from "../../src/scripts/seedAgentMemory";
import { memoryStore } from "../../src/Agents/memory/memory";

describe("My Test", () => {
  beforeEach(() => {
    // Seed memory before each test
    seedMemoryData();
  });

  it("should retrieve conversation history", () => {
    const agentIds = getSeededAgentIds();
    const memory = memoryStore.get(agentIds.user1);

    expect(memory.length).toBeGreaterThan(0);
  });
});
```

## Seeded Data Structure

### Agent IDs

The script seeds data for the following agent IDs:

- `agent-user-001`: Stellar-focused conversations (6 entries)
- `agent-user-002`: DeFi-focused conversations (6 entries)
- `agent-user-003`: Mixed general and trading conversations (8 entries)
- `test-agent-001`: Comprehensive data with all conversation types (26 entries)
- `perf-agent-001`: Large dataset for performance testing (100 entries)

### Conversation Templates

The script includes realistic conversation templates for:

1. **Stellar Operations**
   - Balance checks
   - Transfers
   - Transaction history

2. **DeFi Operations**
   - APY queries
   - Token swaps
   - Liquidity positions

3. **General Interactions**
   - Greetings
   - Feature inquiries
   - Help requests

4. **Trading Operations**
   - Price checks
   - Price alerts
   - Trading history

5. **Staking Operations**
   - Staking instructions
   - Staking transactions
   - Rewards tracking

## API Reference

### `seedMemoryData(clearExisting?: boolean): void`

Seeds the memory store with default mock data for all predefined agents.

**Parameters:**

- `clearExisting` (optional, default: `true`): Whether to clear existing memory data before seeding

**Example:**

```typescript
// Clear and seed
seedMemoryData();

// Seed without clearing existing data
seedMemoryData(false);
```

### `seedAgentMemory(agentId: string, entries: string[], clearExisting?: boolean): void`

Seeds memory for a specific agent with custom conversation entries.

**Parameters:**

- `agentId`: The agent identifier
- `entries`: Array of conversation entries to add
- `clearExisting` (optional, default: `false`): Whether to clear existing data for this agent

**Example:**

```typescript
const customEntries = [
  "User: What's the weather?",
  "Agent: I can't check weather, but I can help with blockchain operations",
];

seedAgentMemory("my-agent-id", customEntries);
```

### `getSeededAgentIds(): object`

Returns an object containing all predefined agent IDs.

**Returns:**

```typescript
{
  user1: "agent-user-001",
  user2: "agent-user-002",
  user3: "agent-user-003",
  testAgent: "test-agent-001",
  performanceAgent: "perf-agent-001"
}
```

**Example:**

```typescript
const agentIds = getSeededAgentIds();
const memory = memoryStore.get(agentIds.user1);
```

### `getConversationTemplates(): object`

Returns all conversation templates used for seeding.

**Returns:**

```typescript
{
  stellar: string[],
  defi: string[],
  general: string[],
  trading: string[],
  staking: string[]
}
```

**Example:**

```typescript
const templates = getConversationTemplates();
// Use templates for custom seeding
seedAgentMemory("custom-agent", templates.stellar);
```

### `verifySeededData(): boolean`

Verifies that the seeded data is properly loaded in memory.

**Returns:** `true` if all expected data is present, `false` otherwise

**Example:**

```typescript
seedMemoryData();
const isValid = verifySeededData();

if (!isValid) {
  console.error("Seeding verification failed");
}
```

## Testing Patterns

### Basic Memory Retrieval Test

```typescript
import {
  seedMemoryData,
  getSeededAgentIds,
} from "../../src/scripts/seedAgentMemory";
import { memoryStore } from "../../src/Agents/memory/memory";

describe("Memory Retrieval", () => {
  beforeEach(() => {
    seedMemoryData();
  });

  it("should retrieve conversation history", () => {
    const agentIds = getSeededAgentIds();
    const memory = memoryStore.get(agentIds.user1);

    expect(memory.length).toBeGreaterThan(0);
    expect(memory[0]).toContain("User:");
  });
});
```

### Performance Testing

```typescript
describe("Memory Performance", () => {
  beforeEach(() => {
    seedMemoryData();
  });

  it("should handle large datasets efficiently", () => {
    const agentIds = getSeededAgentIds();
    const startTime = Date.now();

    for (let i = 0; i < 1000; i++) {
      memoryStore.get(agentIds.performanceAgent);
    }

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(100);
  });
});
```

### Custom Seeding for Specific Tests

```typescript
describe("Custom Scenario", () => {
  it("should handle specific conversation flow", () => {
    const customFlow = [
      "User: Start transaction",
      "Agent: Transaction initiated",
      "User: Confirm",
      "Agent: Transaction confirmed",
    ];

    seedAgentMemory("test-scenario", customFlow, true);

    const memory = memoryStore.get("test-scenario");
    expect(memory).toEqual(customFlow);
  });
});
```

### Context Window Testing

```typescript
describe("Context Window", () => {
  it("should respect max context limit", () => {
    const agentId = "limit-test";

    // Add more than the limit (default: 10)
    for (let i = 0; i < 15; i++) {
      memoryStore.add(agentId, `Entry ${i}`);
    }

    const memory = memoryStore.get(agentId);

    // Should only keep last 10
    expect(memory.length).toBe(10);
    expect(memory[0]).toBe("Entry 5");
  });
});
```

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Test Agent Memory

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm install

      - name: Seed memory data
        run: npm run seed:memory

      - name: Run memory tests
        run: npm test -- tests/unit/agentMemory.test.ts
```

## Best Practices

1. **Clear Before Seeding**: Always clear existing data in tests to ensure consistent state

   ```typescript
   beforeEach(() => {
     memoryStore.clearAll();
     seedMemoryData();
   });
   ```

2. **Use Predefined Agent IDs**: Use `getSeededAgentIds()` instead of hardcoding IDs

   ```typescript
   const agentIds = getSeededAgentIds();
   const memory = memoryStore.get(agentIds.user1);
   ```

3. **Verify After Seeding**: Use `verifySeededData()` to ensure data is properly loaded

   ```typescript
   seedMemoryData();
   expect(verifySeededData()).toBe(true);
   ```

4. **Clean Up After Tests**: Clear memory in `afterEach` to prevent test pollution

   ```typescript
   afterEach(() => {
     memoryStore.clearAll();
   });
   ```

5. **Use Custom Seeding for Edge Cases**: Create specific scenarios for edge case testing
   ```typescript
   seedAgentMemory("edge-case-agent", ["Unusual input"], true);
   ```

## Troubleshooting

### Memory Not Persisting

The current implementation uses in-memory storage. Data is lost when the process exits. For persistent storage, consider implementing a database-backed memory store.

### Seeding Fails Silently

Check the logs for error messages:

```typescript
import logger from "../config/logger";
logger.info("Check seeding status");
```

### Tests Interfering with Each Other

Ensure proper cleanup:

```typescript
afterEach(() => {
  memoryStore.clearAll();
});
```

## Future Enhancements

- Database-backed persistence for memory data
- Import/export functionality for custom datasets
- Conversation flow generators for complex scenarios
- Multi-agent conversation seeding
- Time-based conversation patterns

## Related Documentation

- [Agent Memory Implementation](../src/Agents/memory/memory.ts)
- [Memory Store Tests](../tests/unit/agentMemory.test.ts)
- [Agent Registry](../src/Agents/registry/AGENT_REGISTRY.md)
