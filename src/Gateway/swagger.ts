import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Chen Pilot API",
      version: "1.0.0",
      description:
        "AI Agent for Cross-Chain DeFi Operations — Interact with blockchain networks and DeFi protocols through natural language commands.",
      license: {
        name: "ISC",
      },
    },
    servers: [
      {
        url: process.env.NODE_URL || "http://localhost:3000",
        description: "Development server",
      },
    ],
    tags: [
      { name: "Auth", description: "User registration and authentication" },
      { name: "AI Agent", description: "Natural language query processing" },
      { name: "Webhooks", description: "Stellar webhook handlers" },
      {
        name: "Transactions",
        description: "Stellar transaction history endpoints",
      },
    ],
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            address: { type: "string", description: "Stellar public address" },
            isDeployed: { type: "boolean" },
            isFunded: { type: "boolean" },
            tokenType: { type: "string", example: "XLM" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string" },
          },
        },
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            data: { type: "object" },
            message: { type: "string" },
          },
        },
        TransactionHistoryItem: {
          type: "object",
          properties: {
            id: { type: "string" },
            hash: { type: "string" },
            type: {
              type: "string",
              enum: ["funding", "deployment", "swap", "transfer", "all"],
            },
            ledger: { type: "integer" },
            createdAt: { type: "string", format: "date-time" },
            sourceAccount: { type: "string" },
            feePaid: { type: "integer" },
            successful: { type: "boolean" },
            memo: { type: "string" },
            operations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  from: { type: "string" },
                  to: { type: "string" },
                  amount: { type: "string" },
                  asset: { type: "string" },
                },
              },
            },
            effects: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  amount: { type: "string" },
                  asset: { type: "string" },
                },
              },
            },
          },
        },
        WebhookPayload: {
          type: "object",
          required: ["id", "type", "source", "created_at", "data"],
          properties: {
            id: { type: "string" },
            type: { type: "string" },
            source: { type: "string" },
            created_at: { type: "string", format: "date-time" },
            data: {
              type: "object",
              properties: {
                id: { type: "string" },
                account: { type: "string" },
                funder: { type: "string" },
                amount: { type: "string" },
                asset_type: { type: "string" },
                asset_code: { type: "string" },
                asset_issuer: { type: "string" },
                transaction_hash: { type: "string" },
                operation_index: { type: "integer" },
                transaction_successful: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
  apis: ["./src/Gateway/api.ts", "./src/Gateway/routes.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
