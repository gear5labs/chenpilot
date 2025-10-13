import { ToolMetadata } from './ToolMetadata';
import { toolRegistry } from './ToolRegistry';

export class PromptGenerator {
  /**
   * intent prompt
   */
  generateIntentPrompt(): string {
    const tools = toolRegistry.getToolMetadata();

    if (tools.length === 0) {
      return this.getEmptyPrompt();
    }

    const actionTypes = tools.map(tool => `"${tool.name}"`).join(' | ');
    const parameterSchemas = this.generateParameterSchemas(tools);
    const examples = this.generateExamples(tools);

    return `
You are a workflow planner. You receive a user request and must generate a JSON workflow
that can be executed by the system. Always follow this schema exactly:

{
  "workflow": [
    {
      "action": ${actionTypes},
      "payload": {
        // Parameter schemas for each action:
        ${parameterSchemas}
      }
    }
  ]
}

Available Actions:
${this.generateActionDescriptions(tools)}

Rules:
- "action" must be exactly one of: ${actionTypes}.
- "amount" must always be a number (never a string).
- Always wrap multiple steps in the "workflow" array.
- Do not add extra keys, explanations, or comments.
- Generate at least one workflow step for any valid user request.
- Use the correct parameter names and types as specified above.

Examples:
${examples}

User input: "{{USER_INPUT}}"
User id: {{USER_ID}}

Respond with valid JSON only.
`;
  }

  /**
   * validation prompt
   */
  generateValidationPrompt(): string {
    const tools = toolRegistry.getToolMetadata();
    const categories = [...new Set(tools.map(tool => tool.category))];

    const categoryDescriptions = categories
      .map(category => {
        const categoryTools = tools.filter(tool => tool.category === category);
        const toolNames = categoryTools.map(tool => tool.name).join(', ');
        const toolDescriptions = categoryTools
          .map(tool => tool.description)
          .join(', ');
        return `- ${category} operations (${toolNames})  description:${toolDescriptions}`;
      })
      .join('\n');

    return `
You are a validation agent. 
Check if the user query is about supported crypto operations **or related questions:

${categoryDescriptions}


Guidelines:
- Return "1" if the query is a direct operation (swap, transfer, check balance, etc.) 
  OR if it is a related natural question (e.g. "is it safe to swap?", 
  "who did I send money to?", "what's my balance?", "how does this transaction work?").
- Return "0" only if the query is completely unrelated to crypto or system operations.


Respond ONLY with:
"1" if valid
"0" if invalid
DO NOT GENERATE COMMENTS, INSTRUCTIONS, ADDITIONAL EXPLANATIONS, JUST 0 OR 1
here is the  to help make a decision

REMEMBER: Yes or No can be valid depending on the context, use the context to decide
system "{{CONTEXT}}"
`;
  }
  /**
   * response prompt
   */
  generateResponsePrompt(): string {
    return `
You are a response agent.
Your task is to generate a clear, natural language response to the user
based on the executed workflow results.

Guidelines:
- Be concise and user-friendly.
- Do not expose system internals or JSON structures.
- If multiple workflow steps were executed, summarize them in a logical order.
- If an error occurred, politely explain it without technical jargon.
- Never invent data beyond what is provided in the workflow results.

Input:
{{WORKFLOW_RESULTS}}

User input: "{{USER_INPUT}}"
User id: {{USER_ID}}

Respond with plain text for the user in an object with only response as key.
DO NOT RESPOND WITH JSON OR ANYTHING, RESPOND with ONLY a SINGLE STRING
e.g {response: your wallet balance is 1strk}
{response: there was a problem swapping but your balance was retieved and its 10eth}
`;
  }

  generateToolExamples(toolName: string): string[] {
    const tool = toolRegistry.getTool(toolName);
    return tool?.metadata.examples || [];
  }

  /**
   * Generate parameter schemas for all tools
   */
  private generateParameterSchemas(tools: ToolMetadata[]): string {
    return tools
      .map(tool => {
        const params = Object.entries(tool.parameters)
          .map(([paramName, paramDef]) => {
            const required = paramDef.required ? 'required' : 'optional';
            const type = paramDef.type;
            const description = paramDef.description;
            return `        //   "${paramName}": ${type} (${required}) - ${description}`;
          })
          .join('\n');

        return `        // For ${tool.name}:\n${params}`;
      })
      .join('\n\n');
  }
  /**
   * Generate action descriptions for the LLM
   */
  private generateActionDescriptions(tools: ToolMetadata[]): string {
    return tools
      .map(tool => {
        const params = Object.entries(tool.parameters)
          .map(([paramName, paramDef]) => {
            const required = paramDef.required ? '*' : '';

            const type = paramDef.enum
              ? paramDef.enum.map((v: string) => `"${v}"`).join(' | ')
              : paramDef.type;
            return `${paramName}${required} (${type}): ${paramDef.description}`;
          })
          .join(', ');

        return `- ${tool.name}: ${tool.description}\n  Parameters: ${params}`;
      })
      .join('\n');
  }

  /**
   * Generate examples for the LLM
   */
  private generateExamples(tools: ToolMetadata[]): string {
    const allExamples: string[] = [];

    tools.forEach(tool => {
      tool.examples.forEach(example => {
        allExamples.push(`"${example}"`);
      });
    });

    return allExamples.length > 0
      ? allExamples.map(example => `- ${example}`).join('\n')
      : 'No examples available';
  }

  /**
   * Get empty prompt when no tools are registered
   */
  private getEmptyPrompt(): string {
    return `
You are a workflow planner, but no tools are currently registered.
Please inform the user that no actions are available.

User input: "{{USER_INPUT}}"
User id: {{USER_ID}}

Respond with: {"workflow": []}
`;
  }

  /**
   * Generate tool-specific help text
   */
  generateToolHelp(toolName?: string): string {
    if (toolName) {
      const tool = toolRegistry.getTool(toolName);
      if (!tool) {
        return `Tool '${toolName}' not found.`;
      }

      const { metadata } = tool;
      const params = Object.entries(metadata.parameters)
        .map(([paramName, paramDef]) => {
          const required = paramDef.required ? ' (required)' : ' (optional)';
          return `  - ${paramName}: ${paramDef.type}${required} - ${paramDef.description}`;
        })
        .join('\n');

      return `
Tool: ${metadata.name}
Description: ${metadata.description}
Category: ${metadata.category}
Version: ${metadata.version}

Parameters:
${params}

Examples:
${metadata.examples.map(example => `  - ${example}`).join('\n')}
`;
    }

    // Generate help for all tools
    const tools = toolRegistry.getAllTools();
    const categories = toolRegistry.getCategories();

    let help = `Available Tools (${tools.length} total):\n\n`;

    categories.forEach(category => {
      const categoryTools = tools.filter(
        tool => tool.metadata.category === category
      );
      help += `${category.toUpperCase()}:\n`;
      categoryTools.forEach(tool => {
        help += `  - ${tool.metadata.name}: ${tool.metadata.description}\n`;
      });
      help += '\n';
    });

    return help;
  }
}

export const promptGenerator = new PromptGenerator();
