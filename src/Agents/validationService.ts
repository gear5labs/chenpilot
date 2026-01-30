import { agentLLM } from "./agent";
import { memoryStore } from "./memory/memory";
import { promptGenerator } from "./registry/PromptGenerator";
import { toolAutoDiscovery } from "./registry/ToolAutoDiscovery";
import logger from "../config/logger";

let initialized = false;

export async function validateQuery(
  query: string,
  userId: string
): Promise<boolean> {
  if (!initialized) {
    await toolAutoDiscovery.initialize();
    initialized = true;
  }

  let validationPrompt = promptGenerator.generateValidationPrompt();
  const context = memoryStore.get(userId);

  validationPrompt = validationPrompt.replace(
    "{{CONTEXT}}",
    JSON.stringify(context)
  );
  logger.debug("Validating query", { userId, query });
  const result = await agentLLM.callLLM(userId, validationPrompt, query, false);
  const isValid = result.trim() === "1";
  logger.info("Query validation result", { userId, isValid });
  return isValid;
}
