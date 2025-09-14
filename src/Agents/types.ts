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
export type WorkflowStep =
  | { action: "swap"; payload: SwapPayload }
  | { action: "wallet_balance"; payload: BalancePayload }
  | { action: "transfer"; payload: TransferPayload };

export type WorkflowPlan = {
  workflow: WorkflowStep[];
};



export interface ToolResult {
  action: string;
  status: "success" | "error";
  //flexible fields
  [key: string]: unknown;
}


export interface Tool {
  name: string;
  description: string;
  execute: (payload: unknown, userId: string) => Promise<ToolResult>;
}