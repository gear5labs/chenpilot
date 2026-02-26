import { ToolResult } from "../types";
import { agentLLM } from "../agent";
import { promptGenerator } from "../registry/PromptGenerator";

class ResponseAgent {
  async format(
    workflow: ToolResult[],
    userId: string,
    userInput: string,
    traceId: string
  ) {
    const responsePrompt = promptGenerator.generateResponsePrompt();

    try {
      const promptVersion = await promptGenerator.generateResponsePrompt();
      promptVersionId = (promptVersion as Record<string, unknown>).id as string;

      const response = await agentLLM.callLLM(
        userId,
        prompt,
        userInput,
        true,
        traceId
      );

      const prompt = responsePrompt
        .replace("{{WORKFLOW_RESULTS}}", JSON.stringify(workflow, null, 2))
        .replace("{{USER_INPUT}}", userInput)
        .replace("{{USER_ID}}", userId);

      const response = await agentLLM.callLLM(userId, prompt, userInput);

      if (promptVersionId) {
        const { promptVersionService } =
          await import("../registry/PromptVersionService");
        await promptVersionService.trackMetric(
          promptVersionId,
          !!response,
          userId,
          Date.now() - startTime
        );
      }

      return response;
    } catch (err) {
      if (promptVersionId) {
        const { promptVersionService } =
          await import("../registry/PromptVersionService");
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
}

export const responseAgent = new ResponseAgent();
