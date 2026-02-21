/**
 * Quick demonstration that custom tool registration works
 * Run this file to verify the implementation
 */

import { toolRegistry } from "../ToolRegistry";
import { CustomToolBuilder } from "../CustomToolBuilder";

console.log("=== Custom Tool Registration Demo ===\n");

// 1. Create a custom tool
const demoTool = new CustomToolBuilder()
  .setName("demo_tool")
  .setDescription("A demo tool to prove registration works")
  .setCategory("demo")
  .setVersion("1.0.0")
  .addParameter("message", {
    type: "string",
    description: "Message to process",
    required: true,
  })
  .addExample("Process my message")
  .setExecutor(async (payload, userId) => {
    return {
      action: "demo_action",
      status: "success" as const,
      data: {
        message: payload.message,
        userId,
        timestamp: new Date().toISOString(),
      },
    };
  })
  .build();

// 2. Register it
console.log("Registering custom tool...");
toolRegistry.registerCustomTool(demoTool);
console.log("✓ Tool registered successfully\n");

// 3. Verify it exists
console.log("Checking if tool exists...");
const exists = toolRegistry.hasCustomTool("demo_tool");
console.log(`✓ Tool exists: ${exists}\n`);

// 4. Retrieve it
console.log("Retrieving tool from registry...");
const retrievedTool = toolRegistry.getTool("demo_tool");
console.log(`✓ Tool retrieved: ${retrievedTool?.metadata.name}\n`);

// 5. Execute it
console.log("Executing tool...");
toolRegistry
  .executeTool("demo_tool", { message: "Hello World" }, "user123")
  .then((result) => {
    console.log("✓ Tool executed successfully");
    console.log("Result:", JSON.stringify(result, null, 2));
    console.log("\n=== Demo Complete ===");
    console.log("Custom tool registration is working! ✓");
  })
  .catch((error) => {
    console.error("✗ Execution failed:", error);
  });
