import {
  ToolDefinition,
  ToolMetadata,
  ToolRegistryEntry,
  ToolPayload,
  ToolResult,
} from "./ToolMetadata";
import { withTimeout, TimeoutError } from "../../utils/timeout";
import config from "../../config/config";
import logger from "../../config/logger";

export class ToolRegistry {
  private tools: Map<string, ToolRegistryEntry> = new Map();
  private categories: Set<string> = new Set();

  /**
   * Register a new tool with the registry
   */
  register<T extends ToolPayload>(tool: ToolDefinition<T>): void {
    const { metadata } = tool;
    const name = metadata.name;

    if (this.tools.has(name)) {
      throw new Error(`Tool '${name}' is already registered`);
    }

    this.validateToolMetadata(metadata);

    this.tools.set(name, {
      name,
      definition: tool as ToolDefinition,
      enabled: true,
    });

    this.categories.add(metadata.category);
  }

  /**
   * Register a custom tool dynamically without modifying core registry
   * This allows external tools to be added at runtime
   *
   * @param tool - The tool definition to register
   * @param options - Optional configuration
   * @param options.overwrite - If true, replaces existing tool with same name
   * @param options.namespace - Optional namespace prefix for the tool name
   *
   * @example
   * // Register a simple custom tool
   * toolRegistry.registerCustomTool(myCustomTool);
   *
   * @example
   * // Register with namespace
   * toolRegistry.registerCustomTool(myTool, { namespace: 'custom' });
   * // Tool will be registered as 'custom:myTool'
   *
   * @example
   * // Overwrite existing tool
   * toolRegistry.registerCustomTool(updatedTool, { overwrite: true });
   */
  registerCustomTool<T extends ToolPayload>(
    tool: ToolDefinition<T>,
    options?: {
      overwrite?: boolean;
      namespace?: string;
    }
  ): void {
    const { metadata } = tool;
    let toolName = metadata.name;

    // Apply namespace if provided
    if (options?.namespace) {
      toolName = `${options.namespace}:${toolName}`;
      // Create a new metadata object with namespaced name
      tool = {
        ...tool,
        metadata: {
          ...metadata,
          name: toolName,
        },
      };
    }

    // Check if tool already exists
    if (this.tools.has(toolName)) {
      if (!options?.overwrite) {
        throw new Error(
          `Tool '${toolName}' is already registered. Use overwrite option to replace it.`
        );
      }
      // Unregister existing tool first
      this.unregister(toolName);
    }

    this.validateToolMetadata(tool.metadata);

    this.tools.set(toolName, {
      name: toolName,
      definition: tool as ToolDefinition,
      enabled: true,
    });

    this.categories.add(tool.metadata.category);
  }

  /**
   * Register multiple custom tools at once
   *
   * @param tools - Array of tool definitions to register
   * @param options - Optional configuration applied to all tools
   * @returns Array of successfully registered tool names
   *
   * @example
   * const tools = [tool1, tool2, tool3];
   * const registered = toolRegistry.registerCustomTools(tools, { namespace: 'plugin' });
   */
  registerCustomTools<T extends ToolPayload>(
    tools: ToolDefinition<T>[],
    options?: {
      overwrite?: boolean;
      namespace?: string;
      continueOnError?: boolean;
    }
  ): string[] {
    const registered: string[] = [];
    const errors: Array<{ toolName: string; error: string }> = [];

    for (const tool of tools) {
      try {
        this.registerCustomTool(tool, options);
        registered.push(
          options?.namespace
            ? `${options.namespace}:${tool.metadata.name}`
            : tool.metadata.name
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        errors.push({
          toolName: tool.metadata.name,
          error: errorMessage,
        });

        if (!options?.continueOnError) {
          throw new Error(
            `Failed to register tool '${tool.metadata.name}': ${errorMessage}`
          );
        }
      }
    }

    if (errors.length > 0 && options?.continueOnError) {
      console.warn(
        `Some tools failed to register: ${JSON.stringify(errors, null, 2)}`
      );
    }

    return registered;
  }

  /**
   * Check if a tool is registered
   *
   * @param toolName - Name of the tool to check
   * @returns True if the tool exists in the registry
   */
  hasCustomTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Unregister a tool from the registry
   */
  unregister(toolName: string): boolean {
    return this.tools.delete(toolName);
  }

  /**
   * Get a tool by name
   */
  getTool(toolName: string): ToolDefinition | undefined {
    const entry = this.tools.get(toolName);
    return entry?.enabled ? entry.definition : undefined;
  }

  /**
   * Get all registered tools
   */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((entry) => entry.enabled)
      .map((entry) => entry.definition);
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): ToolDefinition[] {
    return this.getAllTools().filter(
      (tool) => tool.metadata.category === category
    );
  }

  /**
   * Get all available categories
   */
  getCategories(): string[] {
    return Array.from(this.categories);
  }

  /**
   * Execute a tool with payload validation and timeout
   */
  async executeTool(
    toolName: string,
    payload: ToolPayload,
    userId: string,
    timeoutMs?: number
  ): Promise<ToolResult> {
    const tool = this.getTool(toolName);

    if (!tool) {
      throw new ToolExecutionError(`Tool '${toolName}' not found or disabled`);
    }

    // Validate payload if tool has validation
    if (tool.validate) {
      const validation = tool.validate(payload);
      if (!validation.valid) {
        throw new ToolExecutionError(
          `Invalid payload for tool '${toolName}': ${validation.errors.join(
            ", "
          )}`
        );
      }
    }

    const timeout = timeoutMs || config.agent.timeouts.toolExecution;
    logger.debug("Executing tool with timeout", { toolName, userId, timeout });

    try {
      const result = await withTimeout(tool.execute(payload, userId), {
        timeoutMs: timeout,
        operation: `Tool execution: ${toolName}`,
        onTimeout: () => {
          logger.error("Tool execution timeout", { toolName, userId, timeout });
        },
      });

      // Update last used timestamp
      const entry = this.tools.get(toolName);
      if (entry) {
        entry.lastUsed = new Date();
      }

      return result;
    } catch (error) {
      if (error instanceof TimeoutError) {
        const toolError = new ToolExecutionError(
          `Tool '${toolName}' execution timed out after ${timeout}ms`
        );
        toolError.toolName = toolName;
        toolError.payload = payload;
        toolError.userId = userId;
        throw toolError;
      }

      const toolError = new ToolExecutionError(
        `Tool execution failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      toolError.toolName = toolName;
      toolError.payload = payload;
      toolError.userId = userId;
      throw toolError;
    }
  }

  /**
   * Get tool metadata for prompt generation
   */
  getToolMetadata(): ToolMetadata[] {
    return this.getAllTools().map((tool) => tool.metadata);
  }

  /**
   * Search tools by name or description
   */
  searchTools(query: string): ToolDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllTools().filter(
      (tool) =>
        tool.metadata.name.toLowerCase().includes(lowerQuery) ||
        tool.metadata.description.toLowerCase().includes(lowerQuery) ||
        tool.metadata.examples.some((example) =>
          example.toLowerCase().includes(lowerQuery)
        )
    );
  }

  /**
   * Enable/disable a tool
   */
  setToolEnabled(toolName: string, enabled: boolean): boolean {
    const entry = this.tools.get(toolName);
    if (entry) {
      entry.enabled = enabled;
      return true;
    }
    return false;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalTools: number;
    enabledTools: number;
    categories: number;
    toolsByCategory: Record<string, number>;
  } {
    const allTools = this.getAllTools();
    const toolsByCategory: Record<string, number> = {};

    allTools.forEach((tool) => {
      const category = tool.metadata.category;
      toolsByCategory[category] = (toolsByCategory[category] || 0) + 1;
    });

    return {
      totalTools: this.tools.size,
      enabledTools: allTools.length,
      categories: this.categories.size,
      toolsByCategory,
    };
  }

  /**
   * Validate tool metadata structure
   */
  private validateToolMetadata(metadata: ToolMetadata): void {
    if (!metadata.name || typeof metadata.name !== "string") {
      throw new Error("Tool metadata must have a valid name");
    }

    if (!metadata.description || typeof metadata.description !== "string") {
      throw new Error("Tool metadata must have a valid description");
    }

    if (!metadata.parameters || typeof metadata.parameters !== "object") {
      throw new Error("Tool metadata must have valid parameters");
    }

    if (!Array.isArray(metadata.examples)) {
      throw new Error("Tool metadata must have valid examples array");
    }

    if (!metadata.category || typeof metadata.category !== "string") {
      throw new Error("Tool metadata must have a valid category");
    }

    if (!metadata.version || typeof metadata.version !== "string") {
      throw new Error("Tool metadata must have a valid version");
    }

    // Validate parameter definitions
    Object.entries(metadata.parameters).forEach(([paramName, paramDef]) => {
      if (
        !paramDef.type ||
        !paramDef.description ||
        typeof paramDef.required !== "boolean"
      ) {
        throw new Error(`Invalid parameter definition for '${paramName}'`);
      }
    });
  }
}

// Custom error class for tool execution errors
class ToolExecutionError extends Error {
  public toolName: string = "";
  public payload: Record<string, unknown> = {};
  public userId: string = "";

  constructor(message: string) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

export const toolRegistry = new ToolRegistry();
