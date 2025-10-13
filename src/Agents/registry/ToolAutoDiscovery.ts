import { qaTool } from '../tools/qatool';
import { ToolDefinition } from './ToolMetadata';
import { toolRegistry } from './ToolRegistry';

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

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const { WalletTool } = await import('../tools/wallet');
      const { metaTool } = await import('../tools/meta');
      const { contactTool } = await import('../tools/contact');

      toolRegistry.register(new WalletTool());
      toolRegistry.register(metaTool);
      toolRegistry.register(contactTool);
      toolRegistry.register(qaTool);

      // Register new consolidated DeFi tools
      const { xverseTool } = await import('../tools/xverse');
      const { vesuTool } = await import('../tools/vesu');
      const { trovesTool } = await import('../tools/troves');
      const { atomiqTool } = await import('../tools/atomiq');

      toolRegistry.register(xverseTool);
      toolRegistry.register(vesuTool);
      toolRegistry.register(trovesTool);
      toolRegistry.register(atomiqTool);

      this.initialized = true;
      console.log(
        `Tool registry initialized with ${
          toolRegistry.getAllTools().length
        } tools`
      );
    } catch (error) {
      console.error('Failed to initialize tool registry:', error);
      throw error;
    }
  }

  getRegisteredTools(): ToolDefinition[] {
    return toolRegistry.getAllTools();
  }

  getTool(name: string): ToolDefinition | undefined {
    return toolRegistry.getTool(name);
  }

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
