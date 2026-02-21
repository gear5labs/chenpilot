import {
  ToolDefinition,
  ToolMetadata,
  ToolResult,
  ToolPayload,
  ParameterDefinition,
} from "./ToolMetadata";

/**
 * Builder class for creating custom tools with a fluent API
 *
 * @example
 * const customTool = new CustomToolBuilder()
 *   .setName('my_custom_tool')
 *   .setDescription('Does something custom')
 *   .setCategory('custom')
 *   .setVersion('1.0.0')
 *   .addParameter('input', {
 *     type: 'string',
 *     description: 'Input value',
 *     required: true
 *   })
 *   .addExample('Use my custom tool with input')
 *   .setExecutor(async (payload, userId) => {
 *     // Custom logic here
 *     return {
 *       action: 'custom_action',
 *       status: 'success',
 *       data: { result: 'done' }
 *     };
 *   })
 *   .build();
 */
export class CustomToolBuilder<T extends ToolPayload = ToolPayload> {
  private name: string = "";
  private description: string = "";
  private category: string = "custom";
  private version: string = "1.0.0";
  private parameters: Record<string, ParameterDefinition> = {};
  private examples: string[] = [];
  private executor?: (payload: T, userId: string) => Promise<ToolResult>;
  private validator?: (payload: T) => { valid: boolean; errors: string[] };

  /**
   * Set the tool name
   */
  setName(name: string): this {
    this.name = name;
    return this;
  }

  /**
   * Set the tool description
   */
  setDescription(description: string): this {
    this.description = description;
    return this;
  }

  /**
   * Set the tool category
   */
  setCategory(category: string): this {
    this.category = category;
    return this;
  }

  /**
   * Set the tool version
   */
  setVersion(version: string): this {
    this.version = version;
    return this;
  }

  /**
   * Add a parameter to the tool
   */
  addParameter(name: string, definition: ParameterDefinition): this {
    this.parameters[name] = definition;
    return this;
  }

  /**
   * Add multiple parameters at once
   */
  addParameters(parameters: Record<string, ParameterDefinition>): this {
    this.parameters = { ...this.parameters, ...parameters };
    return this;
  }

  /**
   * Add an example usage string
   */
  addExample(example: string): this {
    this.examples.push(example);
    return this;
  }

  /**
   * Add multiple examples at once
   */
  addExamples(examples: string[]): this {
    this.examples.push(...examples);
    return this;
  }

  /**
   * Set the executor function
   */
  setExecutor(
    executor: (payload: T, userId: string) => Promise<ToolResult>
  ): this {
    this.executor = executor;
    return this;
  }

  /**
   * Set a custom validator function
   */
  setValidator(
    validator: (payload: T) => { valid: boolean; errors: string[] }
  ): this {
    this.validator = validator;
    return this;
  }

  /**
   * Build the tool definition
   */
  build(): ToolDefinition<T> {
    if (!this.name) {
      throw new Error("Tool name is required");
    }
    if (!this.description) {
      throw new Error("Tool description is required");
    }
    if (!this.executor) {
      throw new Error("Tool executor function is required");
    }

    const metadata: ToolMetadata = {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      examples: this.examples,
      category: this.category,
      version: this.version,
    };

    const toolDefinition: ToolDefinition<T> = {
      metadata,
      execute: this.executor,
    };

    if (this.validator) {
      toolDefinition.validate = this.validator;
    }

    return toolDefinition;
  }

  /**
   * Create a simple tool with minimal configuration
   */
  static createSimple<T extends ToolPayload = ToolPayload>(
    name: string,
    description: string,
    executor: (payload: T, userId: string) => Promise<ToolResult>,
    parameters: Record<string, ParameterDefinition> = {}
  ): ToolDefinition<T> {
    return new CustomToolBuilder<T>()
      .setName(name)
      .setDescription(description)
      .addParameters(parameters)
      .setExecutor(executor)
      .build();
  }
}
