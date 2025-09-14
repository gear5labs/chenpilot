import { validateQuery } from "../validationService";
import { executionAgent } from "./exectutionagent";
import { agentLLM } from "../agent";
import { intentPrompt } from "../prompts/intentprompt";
import { WorkflowPlan, WorkflowStep } from "../types";

export class IntentAgent {
  async handle(input: string, userId: string) {
    const isValid = await validateQuery(input);
    if (!isValid) {
      return { success: false, error: "Invalid request format" };
    }

    const workflow = await this.planWorkflow(input, userId);
    console.log(workflow);
    if (!workflow.workflow.length) {
      return { success: false, error: "Could not determine workflow" };
    }
    return executionAgent.run(workflow, userId);
  }

  private async planWorkflow(
    input: string,
    userId: string
  ): Promise<WorkflowPlan> {
    try {
      let prompt = intentPrompt
        .replace("{{USER_INPUT}}", input)
        .replace("{{USER_ID}}", userId);

      const parsed = await agentLLM.callLLM(prompt, "", true);
      const steps: WorkflowStep[] = Array.isArray(parsed?.workflow)
        ? parsed.workflow
        : [];

      return { workflow: steps };
    } catch (err) {
      console.error("LLM workflow parsing failed:", err);
      return { workflow: [] };
    }
  }
}

export const intentAgent = new IntentAgent();
