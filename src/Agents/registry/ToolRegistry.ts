import {
  ToolDefinition,
  ToolMetadata,
  ToolRegistryEntry,
  ToolPayload,
  ToolResult,
} from './ToolMetadata';

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
      console.warn(
        `Tool '${name}' is already registered, skipping duplicate registration`
      );
      return;
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
      .filter(entry => entry.enabled)
      .map(entry => entry.definition);
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): ToolDefinition[] {
    return this.getAllTools().filter(
      tool => tool.metadata.category === category
    );
  }

  /**
   * Get all available categories
   */
  getCategories(): string[] {
    return Array.from(this.categories);
  }

  /**
   * Execute a tool with payload validation
   */
  async executeTool(
    toolName: string,
    payload: ToolPayload,
    userId: string
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
            ', '
          )}`
        );
      }
    }

    try {
      const result = await tool.execute(payload, userId);

      // Update last used timestamp
      const entry = this.tools.get(toolName);
      if (entry) {
        entry.lastUsed = new Date();
      }

      return result;
    } catch (error) {
      const toolError = new ToolExecutionError(
        `Tool execution failed: ${
          error instanceof Error ? error.message : 'Unknown error'
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
    return this.getAllTools().map(tool => tool.metadata);
  }

  /**
   * Search tools by name or description
   */
  searchTools(query: string): ToolDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllTools().filter(
      tool =>
        tool.metadata.name.toLowerCase().includes(lowerQuery) ||
        tool.metadata.description.toLowerCase().includes(lowerQuery) ||
        tool.metadata.examples.some(example =>
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

    allTools.forEach(tool => {
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
    if (!metadata.name || typeof metadata.name !== 'string') {
      throw new Error('Tool metadata must have a valid name');
    }

    if (!metadata.description || typeof metadata.description !== 'string') {
      throw new Error('Tool metadata must have a valid description');
    }

    if (!metadata.parameters || typeof metadata.parameters !== 'object') {
      throw new Error('Tool metadata must have valid parameters');
    }

    if (!Array.isArray(metadata.examples)) {
      throw new Error('Tool metadata must have valid examples array');
    }

    if (!metadata.category || typeof metadata.category !== 'string') {
      throw new Error('Tool metadata must have a valid category');
    }

    if (!metadata.version || typeof metadata.version !== 'string') {
      throw new Error('Tool metadata must have a valid version');
    }

    // Validate parameter definitions
    Object.entries(metadata.parameters).forEach(([paramName, paramDef]) => {
      if (
        !paramDef.type ||
        !paramDef.description ||
        typeof paramDef.required !== 'boolean'
      ) {
        throw new Error(`Invalid parameter definition for '${paramName}'`);
      }
    });
  }
}

// Custom error class for tool execution errors
class ToolExecutionError extends Error {
  public toolName: string = '';
  public payload: Record<string, unknown> = {};
  public userId: string = '';

  constructor(message: string) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

export const toolRegistry = new ToolRegistry();
