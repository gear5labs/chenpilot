import {
  ExecutionLog,
  ExecutionLogEntry,
  GetExecutionLogsParams,
  SorobanNetwork,
} from "./types";

// ─── Internal types for raw RPC payloads ─────────────────────────────────────

interface RpcEvent {
  type?: string;
  contractId?: string;
  /** Stellar SDK may surface topics as `topic` (array) */
  topic?: unknown[];
  value?: unknown;
}

interface RpcGetTransactionResult {
  status: string;
  ledger?: number;
  createdAt?: number;
  /** Decoded return value when the RPC surfaces it directly. */
  returnValue?: unknown;
  events?: RpcEvent[];
  /** Raw XDR strings – present on older RPC implementations. */
  resultXdr?: string;
  resultMetaXdr?: string;
}

interface JsonRpcResponse<T> {
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RPC_URLS: Record<SorobanNetwork, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveRpcUrl(network: SorobanNetwork, rpcUrl?: string): string {
  if (rpcUrl) return rpcUrl;
  return DEFAULT_RPC_URLS[network];
}

async function fetchRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown,
  fetcher: typeof fetch
): Promise<T> {
  const resp = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!resp.ok) {
    throw new Error(`RPC HTTP ${resp.status}: ${resp.statusText}`);
  }

  const json = (await resp.json()) as JsonRpcResponse<T>;

  if (json.error) {
    throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
  }

  if (json.result === undefined) {
    throw new Error("RPC returned no result");
  }

  return json.result;
}

function formatEvents(raw: RpcEvent[]): ExecutionLogEntry[] {
  return raw.map(
    (ev, index): ExecutionLogEntry => ({
      index,
      contractId: ev.contractId ?? null,
      type: ev.type ?? "contract",
      topics: Array.isArray(ev.topic) ? ev.topic : [],
      data: ev.value ?? null,
    })
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve and format execution logs for a Soroban contract call.
 *
 * Calls the `getTransaction` JSON-RPC method and maps the result into a
 * structured {@link ExecutionLog} containing status, ledger info, return value
 * and all emitted contract events.
 *
 * @param params - Network, transaction hash and optional RPC URL override.
 * @param fetcher - Optional `fetch` implementation (defaults to globalThis.fetch).
 *                  Inject a custom fetcher in tests to avoid real network calls.
 */
export async function getExecutionLogs(
  params: GetExecutionLogsParams,
  fetcher: typeof fetch = globalThis.fetch
): Promise<ExecutionLog> {
  if (!params.txHash || typeof params.txHash !== "string") {
    throw new Error("Missing or invalid txHash");
  }

  const rpcUrl = resolveRpcUrl(params.network, params.rpcUrl);

  const raw = await fetchRpc<RpcGetTransactionResult>(
    rpcUrl,
    "getTransaction",
    { hash: params.txHash },
    fetcher
  );

  if (raw.status === "NOT_FOUND") {
    return {
      txHash: params.txHash,
      status: "NOT_FOUND",
      ledger: null,
      createdAt: null,
      returnValue: null,
      events: [],
      errorMessage: `Transaction not found: ${params.txHash}`,
    };
  }

  const status = raw.status === "SUCCESS" ? "SUCCESS" : "FAILED";

  return {
    txHash: params.txHash,
    status,
    ledger: raw.ledger ?? null,
    createdAt: raw.createdAt ?? null,
    returnValue: raw.returnValue ?? null,
    events: formatEvents(raw.events ?? []),
    errorMessage:
      status === "FAILED" ? `Transaction failed: ${params.txHash}` : null,
  };
}
