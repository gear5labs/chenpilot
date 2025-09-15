// Legacy types - kept for backward compatibility
export type SwapPayload = {
  from: string;
  to: string;
  amount: number;
};

export type TransferPayload = {
  to: string;
  amount: number;
};

export type supportedTokens = "STRK" | "ETH" | "DAI";

export type BalancePayload = {
  token: supportedTokens;
};

// Dynamic workflow types that work with the tool registry
export type WorkflowStep = {
  action: string; // Tool name from registry
  payload: Record<string, unknown>; // Flexible payload
};

export type WorkflowPlan = {
  workflow: WorkflowStep[];
};

// Legacy ToolResult interface - now superseded by registry types
export interface ToolResult {
  action: string;
  status: "success" | "error";
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
}

// Legacy Tool interface - now superseded by registry types
export interface Tool {
  name: string;
  description: string;
  execute: (
    payload: Record<string, unknown>,
    userId: string
  ) => Promise<ToolResult>;
}
