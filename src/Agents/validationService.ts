import { agentLLM } from "./agent";
import { promptGenerator } from "./registry/PromptGenerator";
import { toolAutoDiscovery } from "./registry/ToolAutoDiscovery";

let initialized = false;

export async function validateQuery(query: string): Promise<boolean> {
  // Ensure tool registry is initialized
  if (!initialized) {
    await toolAutoDiscovery.initialize();
    initialized = true;
  }

  // Generate dynamic validation prompt based on registered tools
  const validationPrompt = promptGenerator.generateValidationPrompt();
  const result = await agentLLM.callLLM(validationPrompt, query, false);
  return result.trim() === "1";
}
