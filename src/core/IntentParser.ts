import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { ParsedIntent, Intent } from "../types/intents.js";

export class IntentParser {
  private client: Anthropic;
  private readonly model: string;

  constructor(
    apiKey: string | undefined,
    model: string = "claude-3-7-sonnet-latest"
  ) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async parse(userInput: string): Promise<ParsedIntent> {
    const promptPath = path.resolve(process.cwd(), "prompts/intent_parser.txt");
    const system = fs.readFileSync(promptPath, "utf-8");
    const schema = {
      action: "swap | send | balance | create_account",
      entities: {
        amount: "number | null",
        fromAsset: "string | null",
        toAsset: "string | null",
        recipient: "string | null",
        chain: "'starknet' | 'bitcoin' | 'solana' | null",
      },
    };
    const prompt = `Input: ${userInput}\nSchema: ${JSON.stringify(
      schema
    )}\nOutput JSON:`;

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (res as any)?.content?.[0]?.text ?? "{}";
    try {
      const json = JSON.parse(text);
      const intent: Intent = {
        action: json.action,
        entities: json.entities || {},
      };
      return { raw: text, intent };
    } catch (e) {
      return { raw: text, intent: { action: "balance", entities: {} } };
    }
  }
}
