/**
 * Tool Registry System - Main exports
 *
 * This module provides a comprehensive tool registry system with support for
 * dynamic tool registration, validation, and execution.
 */

// Core registry
export { ToolRegistry, toolRegistry } from "./ToolRegistry";

// Tool builder for custom tools
export { CustomToolBuilder } from "./CustomToolBuilder";

// Auto-discovery system
export { ToolAutoDiscovery, toolAutoDiscovery } from "./ToolAutoDiscovery";

// Type definitions
export type {
  ToolDefinition,
  ToolMetadata,
  ToolResult,
  ToolPayload,
  ToolRegistryEntry,
  ToolExecutionError,
  ParameterDefinition,
  ParameterType,
} from "./ToolMetadata";

// Prompt generator
export { PromptGenerator } from "./PromptGenerator";

// Agent registry
export { AgentRegistry, agentRegistry } from "./AgentRegistry";
export type {
  AgentDefinition,
  AgentMetadata,
  ParsedIntent,
} from "./AgentRegistry";
