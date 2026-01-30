import { WorkflowPlan, WorkflowStep } from "../types";

export const SOROBAN_INVOKE_ACTION = "soroban_invoke";

const SOROBAN_KEYWORDS = [
  "soroban",
  "contract",
  "invoke",
  "call",
  "stake",
  "unstake",
  "lend",
  "borrow",
  "staking",
  "defi",
  "lending",
];

const METHOD_KEYWORDS = ["stake", "unstake", "lend", "borrow"];

export function parseSorobanIntent(input: string): WorkflowPlan | null {
  const text = input.toLowerCase();
  const hasKeyword = SOROBAN_KEYWORDS.some((k) => text.includes(k));
  const contractIdMatch = input.match(/\bC[A-Z0-9]{10,}\b/);

  if (!hasKeyword && !contractIdMatch) {
    return null;
  }

  const network = text.includes("mainnet")
    ? "mainnet"
    : text.includes("testnet") || text.includes("test net")
    ? "testnet"
    : "testnet";

  const methodMatch =
    input.match(/\b(?:method|function|fn)\s+([a-zA-Z_][\w]*)/i) ||
    input.match(/\b(?:call|invoke)\s+(?:contract\s+)?([a-zA-Z_][\w]*)/i);

  let method = methodMatch ? methodMatch[1] : undefined;
  if (method && method.startsWith("C")) {
    method = undefined;
  }
  if (!method) {
    const keywordMethod = METHOD_KEYWORDS.find((k) => text.includes(k));
    method = keywordMethod;
  }

  const args = extractJsonArray(input);

  const payload: Record<string, unknown> = {
    network,
  };

  if (contractIdMatch) payload.contractId = contractIdMatch[0];
  if (method) payload.method = method;
  if (args) payload.args = args;

  const step: WorkflowStep = {
    action: SOROBAN_INVOKE_ACTION,
    payload,
  };

  return { workflow: [step] };
}

function extractJsonArray(input: string): unknown[] | undefined {
  const index = input.toLowerCase().indexOf("args");
  const start = index >= 0 ? input.indexOf("[", index) : input.indexOf("[");

  if (start === -1) return undefined;

  let depth = 0;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "[") depth += 1;
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        const raw = input.slice(start, i + 1);
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}
