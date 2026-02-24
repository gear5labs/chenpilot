import { injectable } from "tsyringe";
import { agentLLM } from "../Agents/agent";

@injectable()
export default class QaService {
  constructor() {}

  async answer(
    userId: string,
    input: string,
    context: Record<string, unknown>
  ): Promise<string> {

    const contextString = JSON.stringify(context, null, 2);

    const prompt = `
You are a QA assistant for a crypto wallet system.
Answer the user question using the provided context.
If the context does not contain enough info, say so.

Rules:
- Be concise and accurate.
- If asked "who did I send STRK to", check the last transaction in context.
- If asked about "balance", return the balance in context.
- If asked "is it safe", check if the recipient exists in the user's contacts.
- Never make up addresses or values.

Context:
${contextString}
    `;

    const result = await agentLLM.callLLM(userId, prompt, input);
    return result;
  }
}
