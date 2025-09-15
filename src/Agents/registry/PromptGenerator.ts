import { ToolMetadata } from "./ToolMetadata";
import { toolRegistry } from "./ToolRegistry";

export class PromptGenerator {
  /**
   * Generate dynamic intent prompt based on registered tools
   */
  generateIntentPrompt(): string {
    const tools = toolRegistry.getToolMetadata();

    if (tools.length === 0) {
      return this.getEmptyPrompt();
    }

    const actionTypes = tools.map((tool) => `"${tool.name}"`).join(" | ");
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
   * Generate dynamic validation prompt based on registered tools
   */
  generateValidationPrompt(): string {
    const tools = toolRegistry.getToolMetadata();
    const categories = [...new Set(tools.map((tool) => tool.category))];

    const categoryDescriptions = categories
      .map((category) => {
        const categoryTools = tools.filter(
          (tool) => tool.category === category
        );
        const toolNames = categoryTools.map((tool) => tool.name).join(", ");
        return `- ${category} operations (${toolNames})`;
      })
      .join("\n");

    return `
You are a validation agent. 
Check if the user query is about supported crypto operations:

${categoryDescriptions}

Respond ONLY with:
"1" if valid
"0" if invalid
`;
  }

  /**
   * Generate tool-specific examples for the LLM
   */
  generateToolExamples(toolName: string): string[] {
    const tool = toolRegistry.getTool(toolName);
    return tool?.metadata.examples || [];
  }

  /**
   * Generate parameter schemas for all tools
   */
  private generateParameterSchemas(tools: ToolMetadata[]): string {
    return tools
      .map((tool) => {
        const params = Object.entries(tool.parameters)
          .map(([paramName, paramDef]) => {
            const required = paramDef.required ? "required" : "optional";
            const type = paramDef.type;
            const description = paramDef.description;
            return `        //   "${paramName}": ${type} (${required}) - ${description}`;
          })
          .join("\n");

        return `        // For ${tool.name}:\n${params}`;
      })
      .join("\n\n");
  }

  /**
   * Generate action descriptions for the LLM
   */
  private generateActionDescriptions(tools: ToolMetadata[]): string {
    return tools
      .map((tool) => {
        const params = Object.entries(tool.parameters)
          .map(([paramName, paramDef]) => {
            const required = paramDef.required ? "*" : "";
          
            const type = paramDef.enum
              ? paramDef.enum.map((v: string) => `"${v}"`).join(" | ")
              : paramDef.type;
            return `${paramName}${required} (${type}): ${paramDef.description}`;
          })
          .join(", ");

        return `- ${tool.name}: ${tool.description}\n  Parameters: ${params}`;
      })
      .join("\n");
  }

  /**
   * Generate examples for the LLM
   */
  private generateExamples(tools: ToolMetadata[]): string {
    const allExamples: string[] = [];

    tools.forEach((tool) => {
      tool.examples.forEach((example) => {
        allExamples.push(`"${example}"`);
      });
    });

    return allExamples.length > 0
      ? allExamples.map((example) => `- ${example}`).join("\n")
      : "No examples available";
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
          const required = paramDef.required ? " (required)" : " (optional)";
          return `  - ${paramName}: ${paramDef.type}${required} - ${paramDef.description}`;
        })
        .join("\n");

      return `
Tool: ${metadata.name}
Description: ${metadata.description}
Category: ${metadata.category}
Version: ${metadata.version}

Parameters:
${params}

Examples:
${metadata.examples.map((example) => `  - ${example}`).join("\n")}
`;
    }

    // Generate help for all tools
    const tools = toolRegistry.getAllTools();
    const categories = toolRegistry.getCategories();

    let help = `Available Tools (${tools.length} total):\n\n`;

    categories.forEach((category) => {
      const categoryTools = tools.filter(
        (tool) => tool.metadata.category === category
      );
      help += `${category.toUpperCase()}:\n`;
      categoryTools.forEach((tool) => {
        help += `  - ${tool.metadata.name}: ${tool.metadata.description}\n`;
      });
      help += "\n";
    });

    return help;
  }
}

export const promptGenerator = new PromptGenerator();
