import { ToolDefinition } from "./ToolMetadata";
import { toolRegistry } from "./ToolRegistry";

/**
 * Auto-discovery system for tools
 * Automatically registers tools from the tools directory
 */
export class ToolAutoDiscovery {
  private static instance: ToolAutoDiscovery;
  private initialized = false;

  private constructor() {}

  static getInstance(): ToolAutoDiscovery {
    if (!ToolAutoDiscovery.instance) {
      ToolAutoDiscovery.instance = new ToolAutoDiscovery();
    }
    return ToolAutoDiscovery.instance;
  }

  /**
   * Initialize and register all available tools
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Import and register wallet tool
      const { walletTool } = await import("../tools/wallet");
      toolRegistry.register(walletTool);

      // Import and register swap tool
      const { swapTool } = await import("../tools/swap");
      toolRegistry.register(swapTool);

      // Import and register lending tool
      const { lendingTool } = await import("../tools/lending");
      toolRegistry.register(lendingTool);

      // Future tools can be added here or discovered dynamically
      // await this.discoverToolsFromDirectory();

      this.initialized = true;
      console.log(
        `Tool registry initialized with ${
          toolRegistry.getAllTools().length
        } tools`
      );
    } catch (error) {
      console.error("Failed to initialize tool registry:", error);
      throw error;
    }
  }

  /**
   * Get all registered tools
   */
  getRegisteredTools(): ToolDefinition[] {
    return toolRegistry.getAllTools();
  }

  /**
   * Get tool by name
   */
  getTool(name: string): ToolDefinition | undefined {
    return toolRegistry.getTool(name);
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Future: Dynamic tool discovery from directory
   * This could scan the tools directory and auto-import tools
   */
  private async discoverToolsFromDirectory(): Promise<void> {
    // This would be implemented for dynamic discovery
    // For now, we manually import tools
    // In the future, this could use dynamic imports based on file scanning
  }
}

export const toolAutoDiscovery = ToolAutoDiscovery.getInstance();
