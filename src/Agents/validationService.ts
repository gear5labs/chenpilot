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

  const startTime = Date.now();
  let promptVersionId: string | undefined;

  try {
    const promptVersion = await promptGenerator.generateValidationPrompt();
    promptVersionId = (promptVersion as any).id;

    let validationPrompt =
      typeof promptVersion === "string" ? promptVersion : promptVersion;
    const context = memoryStore.get(userId);

    validationPrompt = validationPrompt.replace(
      "{{CONTEXT}}",
      JSON.stringify(context)
    );
    logger.debug("Validating query", { userId, query });
    const result = await agentLLM.callLLM(
      userId,
      validationPrompt,
      query,
      false
    );
    const isValid = result.trim() === "1";

    if (promptVersionId) {
      const { promptVersionService } = await import(
        "./registry/PromptVersionService"
      );
      await promptVersionService.trackMetric(
        promptVersionId,
        isValid,
        userId,
        Date.now() - startTime
      );
    }

    logger.info("Query validation result", { userId, isValid });
    return isValid;
  } catch (err) {
    if (promptVersionId) {
      const { promptVersionService } = await import(
        "./registry/PromptVersionService"
      );
      await promptVersionService.trackMetric(
        promptVersionId,
        false,
        userId,
        Date.now() - startTime
      );
    }
    throw err;
  }
}
