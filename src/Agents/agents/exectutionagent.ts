import { WorkflowPlan } from '../types';
import { toolRegistry } from '../registry/ToolRegistry';
import { ToolResult } from '../registry/ToolMetadata';
import { memoryStore } from '../memory/memory';
import { responseAgent } from './responseagent';
export class ExecutionAgent {
  async run(plan: WorkflowPlan, userId: string, input: string) {
    const results: ToolResult[] = [];

    for (const step of plan.workflow) {
      try {
        const result = await toolRegistry.executeTool(
          step.action,
          step.payload,
          userId
        );
        results.push(result);
      } catch (error) {
        const errorResult: ToolResult = {
          action: step.action,
          status: 'error',
          error:
            error instanceof Error ? error.message : 'Unknown error occurred',
          data: { payload: step.payload },
        };
        results.push(errorResult);
      }
    }
    const summarizedResults = results.map(r => ({
      action: r.action,
      status: r.status,
      error: r.error ?? null,

      payload: r.data?.payload
        ? JSON.stringify(r.data.payload).slice(0, 80) + '...'
        : undefined,
    }));

    memoryStore.add(userId, `LLM: ${JSON.stringify(summarizedResults)}`);
    const res: { response: string } = await responseAgent.format(
      results,
      userId,
      input
    );
    console.log(res, 'resss');
    
    // Ensure we always return a valid response
    if (!res || !res.response) {
      return { 
        success: true, 
        data: 'I processed your request but didn\'t receive a clear response. Please try rephrasing your query.' 
      };
    }
    
    return { success: true, data: res.response };
  }
}

export const executionAgent = new ExecutionAgent();
