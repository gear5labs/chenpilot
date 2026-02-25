/**
 * Example file demonstrating how to register custom tools
 * This file shows various ways to create and register custom tools
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { toolRegistry } from "../ToolRegistry";
import { CustomToolBuilder } from "../CustomToolBuilder";
import { BaseTool } from "../../tools/base/BaseTool";
import { ToolMetadata, ToolResult } from "../ToolMetadata";

// ============================================
// Example 1: Using CustomToolBuilder (Recommended)
// ============================================

const weatherTool = new CustomToolBuilder()
  .setName("weather_tool")
  .setDescription("Get weather information for a location")
  .setCategory("utility")
  .setVersion("1.0.0")
  .addParameter("location", {
    type: "string",
    description: "City name or coordinates",
    required: true,
  })
  .addParameter("units", {
    type: "string",
    description: "Temperature units (celsius or fahrenheit)",
    required: false,
    enum: ["celsius", "fahrenheit"],
  })
  .addExample("What's the weather in New York?")
  .addExample("Get weather for London in celsius")
  .setExecutor(async (payload, userId) => {
    // Your custom logic here
    const location = payload.location as string;
    const units = (payload.units as string) || "celsius";

    // Simulate API call
    return {
      action: "get_weather",
      status: "success",
      data: {
        location,
        temperature: 22,
        units,
        condition: "sunny",
      },
    };
  })
  .build();

// Register the tool
toolRegistry.registerCustomTool(weatherTool);

// ============================================
// Example 2: Using BaseTool class
// ============================================

class CalculatorTool extends BaseTool {
  metadata: ToolMetadata = {
    name: "calculator_tool",
    description: "Perform mathematical calculations",
    parameters: {
      operation: {
        type: "string",
        description: "Math operation to perform",
        required: true,
        enum: ["add", "subtract", "multiply", "divide"],
      },
      a: {
        type: "number",
        description: "First number",
        required: true,
      },
      b: {
        type: "number",
        description: "Second number",
        required: true,
      },
    },
    examples: [
      "Calculate 5 + 3",
      "Multiply 10 by 4",
      "What is 100 divided by 5?",
    ],
    category: "utility",
    version: "1.0.0",
  };

  async execute(
    payload: Record<string, unknown>,
    userId: string
  ): Promise<ToolResult> {
    const operation = payload.operation as string;
    const a = payload.a as number;
    const b = payload.b as number;

    let result: number;

    switch (operation) {
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        if (b === 0) {
          return this.createErrorResult("calculate", "Cannot divide by zero");
        }
        result = a / b;
        break;
      default:
        return this.createErrorResult(
          "calculate",
          `Unknown operation: ${operation}`
        );
    }

    return this.createSuccessResult("calculate", {
      operation,
      a,
      b,
      result,
    });
  }
}

const calculatorTool = new CalculatorTool();
toolRegistry.registerCustomTool(calculatorTool);

// ============================================
// Example 3: Simple tool using static helper
// ============================================

const greetingTool = CustomToolBuilder.createSimple(
  "greeting_tool",
  "Generate personalized greetings",
  async (payload, userId) => {
    const name = (payload.name as string) || "User";
    const style = (payload.style as string) || "formal";

    const greetings: Record<string, string> = {
      formal: `Good day, ${name}. How may I assist you?`,
      casual: `Hey ${name}! What's up?`,
      friendly: `Hello ${name}! Nice to see you!`,
    };

    return {
      action: "greet",
      status: "success",
      data: {
        greeting: greetings[style] || greetings.formal,
        name,
        style,
      },
    };
  },
  {
    name: {
      type: "string",
      description: "Name to greet",
      required: false,
    },
    style: {
      type: "string",
      description: "Greeting style",
      required: false,
      enum: ["formal", "casual", "friendly"],
    },
  }
);

toolRegistry.registerCustomTool(greetingTool);

// ============================================
// Example 4: Batch registration with namespace
// ============================================

const pluginTools = [weatherTool, calculatorTool, greetingTool];

// Register all tools under 'plugin' namespace
const registered = toolRegistry.registerCustomTools(pluginTools, {
  namespace: "plugin",
  continueOnError: true,
});

console.log(`Registered ${registered.length} custom tools:`, registered);

// ============================================
// Example 5: Overwriting existing tools
// ============================================

const updatedWeatherTool = new CustomToolBuilder()
  .setName("weather_tool")
  .setDescription("Get enhanced weather information with forecasts")
  .setCategory("utility")
  .setVersion("2.0.0")
  .addParameter("location", {
    type: "string",
    description: "City name or coordinates",
    required: true,
  })
  .addParameter("days", {
    type: "number",
    description: "Number of forecast days",
    required: false,
    min: 1,
    max: 7,
  })
  .setExecutor(async (payload, userId) => {
    return {
      action: "get_weather_forecast",
      status: "success",
      data: {
        location: payload.location,
        forecast: ["sunny", "cloudy", "rainy"],
      },
    };
  })
  .build();

// This will replace the existing weather_tool
toolRegistry.registerCustomTool(updatedWeatherTool, { overwrite: true });

// ============================================
// Example 6: Checking if tool exists
// ============================================

if (toolRegistry.hasCustomTool("weather_tool")) {
  console.log("Weather tool is registered");
}

// ============================================
// Example 7: Using custom validator
// ============================================

const emailTool = new CustomToolBuilder()
  .setName("email_tool")
  .setDescription("Send emails")
  .setCategory("communication")
  .addParameter("to", {
    type: "string",
    description: "Recipient email",
    required: true,
  })
  .addParameter("subject", {
    type: "string",
    description: "Email subject",
    required: true,
  })
  .addParameter("body", {
    type: "string",
    description: "Email body",
    required: true,
  })
  .setValidator((payload) => {
    const errors: string[] = [];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!payload.to || !emailRegex.test(payload.to as string)) {
      errors.push("Invalid email address");
    }

    if (payload.subject && (payload.subject as string).length > 100) {
      errors.push("Subject too long (max 100 characters)");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  })
  .setExecutor(async (payload, userId) => {
    // Email sending logic
    return {
      action: "send_email",
      status: "success",
      data: {
        to: payload.to,
        subject: payload.subject,
        sent: true,
      },
    };
  })
  .build();

toolRegistry.registerCustomTool(emailTool);

export { weatherTool, calculatorTool, greetingTool, emailTool };
