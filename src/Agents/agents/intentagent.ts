import { validateQuery } from "../validationService";
import { executionAgent } from "./exectutionagent";
import { agentLLM } from "../agent";
import { promptGenerator } from "../registry/PromptGenerator";
import { toolAutoDiscovery } from "../registry/ToolAutoDiscovery";
import { WorkflowPlan, WorkflowStep } from "../types";
import { memoryStore } from "../memory/memory";

export interface DeFiResult {
  success: boolean;
  data?: any;
  transactionHash?: string;
}

export class IntentAgent {
  private initialized = false;

  async handle(input: string, userId: string) {
    if (!this.initialized) {
      await toolAutoDiscovery.initialize();
      this.initialized = true;
    }

    // Validate query first - ensures all queries are crypto/DeFi related
    const isValid = await validateQuery(input, userId);
    if (!isValid) {
      return { success: false, error: "Invalid request format" };
    }

    // All queries go through the tool registry via workflow planning
    const workflow = await this.planWorkflow(input, userId);
    if (!workflow.workflow.length) {
      return { success: false, error: "Could not determine workflow" };
    }
    
    return await executionAgent.run(workflow, userId, input);
  }

  private async planWorkflow(
    input: string,
    userId: string
  ): Promise<WorkflowPlan> {
    try {
      const promptTemplate = promptGenerator.generateIntentPrompt();
      const prompt = promptTemplate
        .replace("{{USER_INPUT}}", input)
        .replace("{{USER_ID}}", userId);
      const parsed = await agentLLM.callLLM(userId, prompt, input, true);
      const steps: WorkflowStep[] = Array.isArray(parsed?.workflow)
        ? parsed.workflow
        : [];
      memoryStore.add(userId, `User: ${input}`);
      return { workflow: steps };
    } catch (err) {
      return { workflow: [] };
    }
  }
}

export const intentAgent = new IntentAgent();
