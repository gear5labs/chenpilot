import { BaseAgent, AgentOutcome } from "../agents/BaseAgent.js";
import { Intent } from "../types/intents.js";

export class AgentOrchestrator {
  private readonly agents: BaseAgent[] = [];

  registerAgent(agent: BaseAgent): void {
    this.agents.push(agent);
  }

  async routeIntent(intent: Intent): Promise<AgentOutcome> {
    const capable = this.agents.filter((a) => a.canHandle(intent));
    if (capable.length === 0) {
      return {
        success: false,
        message: `No agent can handle intent: ${intent.action}`,
      };
    }
    // Simple strategy: pick highest priority score
    capable.sort((a, b) => b.scoreIntent(intent) - a.scoreIntent(intent));
    const chosen = capable[0];
    return chosen.handle(intent);
  }
}
