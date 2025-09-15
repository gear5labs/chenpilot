/**
 * Demo script showing how the tool registry system works
 * This demonstrates the dynamic tool discovery and execution
 */

import { toolAutoDiscovery } from "./ToolAutoDiscovery";
import { toolRegistry } from "./ToolRegistry";
import { promptGenerator } from "./PromptGenerator";

async function demonstrateToolRegistry() {
  console.log("🚀 Tool Registry System Demo\n");

  // Initialize the tool registry
  console.log("1. Initializing tool registry...");
  await toolAutoDiscovery.initialize();
  console.log("✅ Tool registry initialized\n");

  // Show registered tools
  console.log("2. Registered tools:");
  const tools = toolRegistry.getAllTools();
  tools.forEach((tool) => {
    console.log(`   - ${tool.metadata.name}: ${tool.metadata.description}`);
    console.log(`     Category: ${tool.metadata.category}`);
    console.log(`     Version: ${tool.metadata.version}`);
    console.log(
      `     Parameters: ${Object.keys(tool.metadata.parameters).join(", ")}`
    );
    console.log("");
  });

  // Show registry statistics
  console.log("3. Registry statistics:");
  const stats = toolRegistry.getStats();
  console.log(`   Total tools: ${stats.totalTools}`);
  console.log(`   Enabled tools: ${stats.enabledTools}`);
  console.log(`   Categories: ${stats.categories}`);
  console.log(`   Tools by category:`, stats.toolsByCategory);
  console.log("");

  // Show dynamic prompt generation
  console.log("4. Dynamic intent prompt:");
  const intentPrompt = promptGenerator.generateIntentPrompt();
  console.log(intentPrompt.substring(0, 500) + "...\n");

  // Show validation prompt
  console.log("5. Dynamic validation prompt:");
  const validationPrompt = promptGenerator.generateValidationPrompt();
  console.log(validationPrompt + "\n");

  // Demonstrate tool execution
  console.log("6. Tool execution examples:");

  // Example 1: Wallet balance check
  try {
    console.log("   Executing wallet_tool (get_balance):");
    const balanceResult = await toolRegistry.executeTool(
      "wallet_tool",
      {
        operation: "get_balance",
        token: "STRK",
      },
      "user123"
    );
    console.log("   Result:", balanceResult);
  } catch (error) {
    console.log(
      "   Error:",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
  console.log("");

  // Example 2: Swap operation
  try {
    console.log("   Executing swap_tool:");
    const swapResult = await toolRegistry.executeTool(
      "swap_tool",
      {
        from: "STRK",
        to: "ETH",
        amount: 100,
      },
      "user123"
    );
    console.log("   Result:", swapResult);
  } catch (error) {
    console.log(
      "   Error:",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
  console.log("");

  // Example 3: Lending operation
  try {
    console.log("   Executing lending_tool:");
    const lendingResult = await toolRegistry.executeTool(
      "lending_tool",
      {
        token: "USDC",
        amount: 1000,
        duration: 30,
        interestRate: 5,
      },
      "user123"
    );
    console.log("   Result:", lendingResult);
  } catch (error) {
    console.log(
      "   Error:",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
  console.log("");

  // Show tool search
  console.log("7. Tool search examples:");
  const walletSearch = toolRegistry.searchTools("wallet");
  console.log(
    '   Search for "wallet":',
    walletSearch.map((t) => t.metadata.name)
  );

  const tradingSearch = toolRegistry.searchTools("trading");
  console.log(
    '   Search for "trading":',
    tradingSearch.map((t) => t.metadata.name)
  );
  console.log("");

  // Show tool help
  console.log("8. Tool help:");
  const help = promptGenerator.generateToolHelp();
  console.log(help);

  console.log(
    "🎉 Demo completed! The tool registry system is working perfectly."
  );
  console.log("\nTo add a new tool:");
  console.log("1. Create a new tool class extending BaseTool");
  console.log("2. Add it to ToolAutoDiscovery.ts");
  console.log("3. That's it! The LLM will automatically recognize it.");
}

// Run the demo if this file is executed directly
if (require.main === module) {
  demonstrateToolRegistry().catch(console.error);
}

export { demonstrateToolRegistry };
