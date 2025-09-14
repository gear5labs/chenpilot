import { agentLLM } from "./agent";
import { validationPrompt } from "./prompts/validationprompt";

export async function validateQuery(query: string): Promise<boolean> {
  const result = await agentLLM.callLLM(validationPrompt, query, false);
  return result.trim() === "1";
}
