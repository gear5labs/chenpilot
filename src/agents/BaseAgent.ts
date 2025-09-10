import { Intent } from "../types/intents.js";

export interface AgentOutcome {
  success: boolean;
  message: string;
  data?: any;
}

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract canHandle(intent: Intent): boolean;
  abstract scoreIntent(intent: Intent): number;
  abstract handle(intent: Intent): Promise<AgentOutcome>;
}
