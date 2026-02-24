import { qaTool } from "../tools/qatool";
import { ToolDefinition } from "./ToolMetadata";
import { toolRegistry } from "./ToolRegistry";
import logger from "../../config/logger";

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
      const { walletTool } = await import("../tools/wallet");
      toolRegistry.register(walletTool);

      const { swapTool } = await import("../tools/swap");
      toolRegistry.register(swapTool);
      const { metaTool } = await import("../tools/meta");
      toolRegistry.register(metaTool);
      const { contactTool } = await import("../tools/contact");
      toolRegistry.register(qaTool)
      toolRegistry.register(contactTool);
      const { sorobanTool } = await import("../tools/soroban");
      toolRegistry.register(sorobanTool);
      const { riskAnalysisTool } = await import("../tools/riskAnalysis");
      toolRegistry.register(riskAnalysisTool);
      // todo
      // await this.discoverToolsFromDirectory();

      this.initialized = true;
      logger.info("Tool registry initialized", {
        toolCount: toolRegistry.getAllTools().length
      });
    } catch (error) {
      logger.error("Failed to initialize tool registry", { error });
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
