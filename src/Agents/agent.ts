import Anthropic from '@anthropic-ai/sdk';
import config from '../config/config';
import { memoryStore } from './memory/memory';

const client = new Anthropic({
  apiKey: config.apiKey,
});

export class AgentLLM {
  async callLLM(
    agentId: string,
    prompt: string,
    userInput: string,
    asJson = true
  ): Promise<any> {
    const memoryContext = memoryStore.get(agentId).join('\n');
    const fullPrompt = `${
      memoryContext ? 'Previous context:\n' + memoryContext + '\n\n' : ''
    }${prompt}\n\nUser input: ${userInput}${
      asJson ? '\n\nPlease respond with valid JSON only.' : ''
    }`;

    const message = await client.messages.create({
      model: "claude-3-7-sonnet-20250219",
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: fullPrompt,
        },
      ],
    });

    const content =
      message.content[0].type === 'text' ? message.content[0].text : '{}';

    if (asJson) {
      try {
        // Strip markdown code blocks if present
        let jsonContent = content.trim();
        if (jsonContent.startsWith('```json')) {
          jsonContent = jsonContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (jsonContent.startsWith('```')) {
          jsonContent = jsonContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        const parsed = JSON.parse(jsonContent);
        return parsed;
      } catch (err) {
        console.error('JSON parse error:', err, 'raw:', content);
        return {};
      }
    } else {
      return content;
    }
  }
}

export const agentLLM = new AgentLLM();
