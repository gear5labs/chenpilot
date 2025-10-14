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

    const response = await agentLLM.callLLM(userId, prompt, userInput, false);

    // Handle malformed JSON responses from LLM
    if (typeof response === 'string') {
      // Check if it's malformed JSON like {response: "message"}
      if (response.includes('{response:') && !response.includes('"response"')) {
        // Extract the message from malformed JSON
        const match = response.match(/\{response:\s*([^}]+)\}/);
        if (match) {
          return { response: match[1].trim() };
        }
      }
      // Check if it's already a proper JSON string
      if (response.startsWith('{') && response.endsWith('}')) {
        try {
          const parsed = JSON.parse(response);
          return parsed;
        } catch (e) {
          // If JSON parsing fails, return as plain text
          return { response: response };
        }
      }
      // Return as proper JSON object
      return { response: response };
    } else if (response && typeof response === 'object') {
      // If it's already an object, return it
      return response;
    } else {
      // Fallback for any other case
      return { response: 'I processed your request but encountered an issue. Please try again.' };
    }
  }
}

export const responseAgent = new ResponseAgent();
