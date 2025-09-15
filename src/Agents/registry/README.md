# Tool Registry System

This directory contains the dynamic tool registry system that automatically discovers and integrates new tools without manual configuration.

## Architecture Overview

The tool registry system consists of several key components:

### Core Components

1. **ToolMetadata.ts** - Type definitions for tool metadata and interfaces
2. **ToolRegistry.ts** - Central registry for managing and executing tools
3. **PromptGenerator.ts** - Dynamic prompt generation based on registered tools
4. **ToolAutoDiscovery.ts** - Automatic tool discovery and registration
5. **BaseTool.ts** - Base class for all tools with common functionality

### Key Features

- **Zero Configuration**: New tools are automatically discovered and integrated
- **Type Safety**: Full TypeScript type safety throughout the system
- **Dynamic Prompts**: LLM prompts are generated automatically based on registered tools
- **Parameter Validation**: Built-in parameter validation for all tools
- **Error Handling**: Comprehensive error handling and reporting
- **Tool Categories**: Organize tools by category (wallet, trading, lending, etc.)

## How to Add a New Tool

### Step 1: Create the Tool Class

Create a new file in the `tools/` directory:

```typescript
// tools/myNewTool.ts
import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";

interface MyToolPayload {
  param1: string;
  param2: number;
  param3?: boolean;
}

export class MyNewTool extends BaseTool<MyToolPayload> {
  metadata: ToolMetadata = {
    name: "my_new_tool",
    description: "Description of what this tool does",
    parameters: {
      param1: {
        type: "string",
        description: "Description of param1",
        required: true,
        enum: ["option1", "option2", "option3"],
      },
      param2: {
        type: "number",
        description: "Description of param2",
        required: true,
        min: 0,
        max: 100,
      },
      param3: {
        type: "boolean",
        description: "Description of param3",
        required: false,
      },
    },
    examples: ["Example usage 1", "Example usage 2", "Example usage 3"],
    category: "my_category",
    version: "1.0.0",
  };

  async execute(payload: MyToolPayload, userId: string): Promise<ToolResult> {
    try {
      // Your tool implementation here
      console.log(`Executing my tool with payload:`, payload);

      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return this.createSuccessResult("my_tool_action", {
        result: "success",
        data: payload,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "my_tool_action",
        `Tool execution failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

export const myNewTool = new MyNewTool();
```

### Step 2: Register the Tool

Add the tool to the auto-discovery system in `ToolAutoDiscovery.ts`:

```typescript
// Import and register the new tool
const { myNewTool } = await import("../tools/myNewTool");
toolRegistry.register(myNewTool);
```

### Step 3: That's It!

The tool is now automatically:

- Discovered by the registry
- Available for LLM execution
- Included in dynamic prompts
- Validated for parameters
- Handled by the execution engine

## Tool Metadata Schema

Each tool must provide comprehensive metadata:

```typescript
interface ToolMetadata {
  name: string; // Unique tool identifier
  description: string; // Human-readable description
  parameters: Record<string, ParameterDefinition>; // Parameter schema
  examples: string[]; // Usage examples for LLM
  category: string; // Tool category
  version: string; // Tool version
}

interface ParameterDefinition {
  type: ParameterType; // Parameter type
  description: string; // Parameter description
  required: boolean; // Whether parameter is required
  enum?: string[]; // Allowed values (for strings)
  min?: number; // Minimum value (for numbers)
  max?: number; // Maximum value (for numbers)
  pattern?: string; // Regex pattern (for strings)
}
```

## Supported Parameter Types

- `string` - Text values
- `number` - Numeric values
- `boolean` - True/false values
- `object` - Complex objects
- `array` - Arrays of values

## Tool Categories

Current categories:

- `wallet` - Wallet operations (balance, transfer, address)
- `trading` - Trading operations (swap, exchange)
- `lending` - Lending operations (lend, borrow)

## Error Handling

The system provides comprehensive error handling:

- **Parameter Validation**: Automatic validation of tool parameters
- **Execution Errors**: Graceful handling of tool execution failures
- **Type Safety**: TypeScript ensures type safety throughout
- **Error Reporting**: Detailed error messages and context

## Dynamic Prompt Generation

The system automatically generates LLM prompts based on registered tools:

- **Intent Prompts**: Generated based on available tools and their parameters
- **Validation Prompts**: Generated based on tool categories
- **Examples**: Automatically included from tool metadata

## Registry API

The tool registry provides several useful methods:

```typescript
// Get all tools
const tools = toolRegistry.getAllTools();

// Get tools by category
const walletTools = toolRegistry.getToolsByCategory("wallet");

// Execute a tool
const result = await toolRegistry.executeTool("my_tool", payload, userId);

// Search tools
const searchResults = toolRegistry.searchTools("wallet");

// Get registry statistics
const stats = toolRegistry.getStats();
```

## Benefits

1. **Zero Configuration**: Add tools without touching prompts or execution logic
2. **Type Safety**: Full TypeScript support with no `any` types
3. **Self-Documenting**: Tools describe themselves through metadata
4. **Extensible**: Easy to add new categories and features
5. **Maintainable**: Centralized tool management
6. **Testable**: Each tool can be tested independently
7. **Scalable**: Supports unlimited number of tools

## Migration from Old System

The new system is backward compatible. Existing tools can be gradually migrated:

1. Convert tool classes to extend `BaseTool`
2. Add comprehensive metadata
3. Update execution methods to use new result format
4. Register tools with the registry

The old hardcoded system will continue to work during migration.
