import Anthropic from "@anthropic-ai/sdk";
import config from "../config/config";

const client = new Anthropic({
  apiKey: config.apiKey,
});

export class AgentLLM {
  async callLLM(
    prompt: string,
    userInput: string,
    asJson = true
  ): Promise<any> {
    const message = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `${prompt}\n\nUser input: ${userInput}${
            asJson ? "\n\nPlease respond with valid JSON only." : ""
          }`,
        },
      ],
    });

    const content =
      message.content[0].type === "text" ? message.content[0].text : "{}";

    if (asJson) {
      console.log(content)
      try {
        return JSON.parse(content);
      } catch (err) {
        console.error("JSON parse error:", err, "raw:", content);
        return {};
      }
    }

    return content;
  }
}

export const agentLLM = new AgentLLM();
