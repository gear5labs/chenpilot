export type IntentAction = "swap" | "send" | "balance" | "create_account";

export interface IntentEntities {
  amount?: number;
  fromAsset?: string;
  toAsset?: string;
  recipient?: string;
  chain?: "starknet" | "bitcoin" | "solana";
}

export interface Intent {
  action: IntentAction;
  entities: IntentEntities;
}

export interface ParsedIntent {
  raw: string;
  intent: Intent;
}
