import { ToolResult } from '../types';
import { agentLLM } from '../agent';
import { promptGenerator } from '../registry/PromptGenerator';

class ResponseAgent {
  async format(workflow: ToolResult[], userId: string, userInput: string) {
    const responsePrompt = promptGenerator.generateResponsePrompt();

    const prompt = responsePrompt
      .replace('{{WORKFLOW_RESULTS}}', JSON.stringify(workflow, null, 2))
      .replace('{{USER_INPUT}}', userInput)
      .replace('{{USER_ID}}', userId);

    const response = await agentLLM.callLLM(userId, prompt, userInput);

    return response;
  }
}

export const responseAgent = new ResponseAgent();
