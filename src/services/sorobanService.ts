import * as StellarSdk from "@stellar/stellar-sdk";

export type SorobanNetwork = "testnet" | "mainnet";

export interface InvokeContractParams {
  network: SorobanNetwork;
  rpcUrl?: string;
  contractId: string;
  method: string;
  args?: unknown[];
  source?: {
    publicKey?: string;
    secretKey?: string;
  };
  fee?: number;
  timeoutMs?: number;
}

export interface InvokeContractResult {
  network: SorobanNetwork;
  contractId: string;
  method: string;
  result: unknown;
  raw?: unknown;
}

export interface GetContractLogsParams {
  /** The transaction hash returned from a contract call. */
  txHash: string;
  network: SorobanNetwork;
  rpcUrl?: string;
}

export interface ContractLogEntry {
  /** Index of the event in the transaction result. */
  index: number;
  /** Contract address that emitted the event. */
  contractId: string | null;
  /** Event type: "contract" | "system" | "diagnostic". */
  type: string;
  /** Decoded topic values. */
  topics: unknown[];
  /** Decoded data value. */
  data: unknown;
}

/**
 * Metadata for Gas and Resource Estimates
 * Requirement: Issue #52
 */
export interface SimulationEstimates {
  minResourceFee: string;
  cpuInstructions: string;
  memoryBytes: string;
  footprint: string; // XDR encoded ledger footprint
}

const DEFAULT_RPC_URLS: Record<SorobanNetwork, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

const NETWORK_PASSPHRASES: Record<SorobanNetwork, string> = {
  testnet: StellarSdk.Networks?.TESTNET || "Test SDF Network ; September 2015",
  mainnet:
    StellarSdk.Networks?.PUBLIC ||
    "Public Global Stellar Network ; September 2015",
};

// --- Helper Functions ---

function resolveRpcUrl(network: SorobanNetwork, rpcUrl?: string): string {
  if (rpcUrl) return rpcUrl;
  if (network === "testnet") {
    return process.env.SOROBAN_RPC_URL_TESTNET || DEFAULT_RPC_URLS.testnet;
  }
  return process.env.SOROBAN_RPC_URL_MAINNET || DEFAULT_RPC_URLS.mainnet;
}

function validateParams(params: InvokeContractParams): void {
  if (params.network !== "testnet" && params.network !== "mainnet") {
    throw new Error("Invalid Soroban network. Use 'testnet' or 'mainnet'.");
  }
  if (!params.contractId?.startsWith("C")) {
    throw new Error("Invalid or missing contractId format");
  }
  if (!params.method) {
    throw new Error("Missing method name");
  }
}

function isScValLike(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return "switch" in (value as Record<string, unknown>);
}

function normalizeArgs(args?: unknown[]): unknown[] {
  if (!args || !Array.isArray(args)) return [];
  return args.map((arg) => {
    if (isScValLike(arg)) return arg;
    if (typeof StellarSdk.nativeToScVal === "function") {
      try {
        return StellarSdk.nativeToScVal(arg as never);
      } catch {
        return arg;
      }
    }
    return arg;
  });
}

// --- Soroban Service Implementation ---

export async function invokeContract(
  params: InvokeContractParams
): Promise<InvokeContractResult> {
  // Check if we should use local chain simulation
  try {
    const { getInterceptor } = await import("../simulation/ServiceInterceptor");
    const interceptor = getInterceptor();
    if (interceptor && interceptor.isSimulationEnabled("soroban")) {
      return interceptor.intercept(
        "soroban",
        "invoke_contract",
        [params],
        (...args: unknown[]) =>
          invokeContractLive(args[0] as InvokeContractParams)
      ) as Promise<InvokeContractResult>;
    }
  } catch {
    // Simulation not available, continue with live network
  }

  // Use live network
  return invokeContractLive(params);
}

async function invokeContractLive(
  params: InvokeContractParams
): Promise<InvokeContractResult> {
  validateParams(params);

  const rpcUrl = resolveRpcUrl(params.network, params.rpcUrl);
  const passphrase = NETWORK_PASSPHRASES[params.network];

  // Try different server initialization approaches for different SDK versions
  let server: unknown;
  try {
    // Try newer SDK structure - use SorobanRpc
    const SorobanServer = (
      StellarSdk as unknown as {
        SorobanRpc: {
          Server: new (url: string, opts?: { allowHttp?: boolean }) => unknown;
        };
      }
    ).SorobanRpc.Server;
    server = new SorobanServer(rpcUrl, {
      allowHttp: rpcUrl.startsWith("http://"),
    });
  } catch (error) {
    try {
      // Try alternative structure
      const HorizonServer = (
        StellarSdk as unknown as {
          Horizon: { Server: new (url: string) => unknown };
        }
      ).Horizon.Server;
      server = new HorizonServer(rpcUrl);
    } catch {
      throw new Error(`Failed to initialize Stellar server: ${error}`);
    }
  }

  // Use G...A dummy if no public key provided to allow simulation
  const sourcePublicKey =
    params.source?.publicKey ||
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const account = new StellarSdk.Account(sourcePublicKey, "0");

  const contract = new StellarSdk.Contract(params.contractId);
  const normalizedArgs = normalizeArgs(params.args);

  const op = (
    contract as unknown as {
      call: (method: string, ...args: unknown[]) => unknown;
    }
  ).call(params.method, ...normalizedArgs);

  const fee = params.fee ? String(params.fee) : StellarSdk.BASE_FEE;
  const timeoutSeconds = params.timeoutMs
    ? Math.ceil(params.timeoutMs / 1000)
    : 30;

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee,
    networkPassphrase: passphrase,
  })
    .addOperation(op as never)
    .setTimeout(timeoutSeconds)
    .build();

  let simulation: unknown;
  try {
    simulation = await (
      server as {
        simulateTransaction: (tx: StellarSdk.Transaction) => Promise<unknown>;
      }
    ).simulateTransaction(tx);
  } catch (error) {
    throw new Error(`Failed to simulate transaction: ${error}`);
  }

  const simResult = simulation as {
    error?: string;
    result?: {
      auth?: unknown[];
      retval?: unknown;
      result?: { retval?: unknown };
    };
  };

  if (simResult?.error) {
    throw new Error(`Soroban simulation failed: ${simResult.error}`);
  }

  const auth = simResult?.result?.auth;
  if (Array.isArray(auth) && auth.length > 0 && !params.source?.secretKey) {
    throw new Error(
      "Soroban invocation requires authorization; signing is not supported"
    );
  }

  const retval =
    simResult?.result?.retval || simResult?.result?.result?.retval || null;

  const decoded =
    retval && typeof StellarSdk.scValToNative === "function"
      ? StellarSdk.scValToNative(retval as never)
      : retval;

  return {
    network: params.network,
    contractId: params.contractId,
    method: params.method,
    result: decoded,
    raw: simResult,
  };
}

export class SorobanService {
  /**
   * Issue #52: Implement simulateContractCall
   * Provides gas and resource estimates before submission.
   */
  async simulateContractCall(
    params: InvokeContractParams
  ): Promise<SimulationEstimates> {
    validateParams(params);

    const rpcUrl = resolveRpcUrl(params.network, params.rpcUrl);
    const passphrase = NETWORK_PASSPHRASES[params.network];

    // Try different server initialization approaches for different SDK versions
    let server: unknown;
    try {
      // Try SorobanRpc structure
      const SorobanServer = (
        StellarSdk as unknown as {
          SorobanRpc: {
            Server: new (
              url: string,
              opts?: { allowHttp?: boolean }
            ) => unknown;
          };
        }
      ).SorobanRpc.Server;
      server = new SorobanServer(rpcUrl, {
        allowHttp: rpcUrl.startsWith("http://"),
      });
    } catch (error) {
      try {
        // Try alternative structure
        const HorizonServer = (
          StellarSdk as unknown as {
            Horizon: { Server: new (url: string) => unknown };
          }
        ).Horizon.Server;
        server = new HorizonServer(rpcUrl);
      } catch {
        throw new Error(`Failed to initialize Stellar server: ${error}`);
      }
    }

    // Use G...A dummy if no public key provided to allow simulation
    const sourcePublicKey =
      params.source?.publicKey ||
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const account = new StellarSdk.Account(sourcePublicKey, "0");

    const contract = new StellarSdk.Contract(params.contractId);
    const normalizedArgs = normalizeArgs(params.args);

    const op = (
      contract as unknown as {
        call: (method: string, ...args: unknown[]) => unknown;
      }
    ).call(params.method, ...normalizedArgs);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(op as never)
      .setTimeout(params.timeoutMs ? Math.ceil(params.timeoutMs / 1000) : 30)
      .build();

    const simulation = await (
      server as {
        simulateTransaction: (tx: StellarSdk.Transaction) => Promise<unknown>;
      }
    ).simulateTransaction(tx);

    const simResult = simulation as {
      error?: string;
      minResourceFee?: string;
      transactionData?: {
        build: () => {
          resources: () => {
            instructions: () => unknown;
            readBytes: () => unknown;
          };
        };
        toXDR: () => string;
      };
    };

    if (simResult?.error) {
      throw new Error(`Simulation failed: ${simResult.error}`);
    }

    if (!simResult.minResourceFee || !simResult.transactionData) {
      throw new Error("Invalid simulation response");
    }

    const resources = simResult.transactionData.build().resources();

    return {
      minResourceFee: simResult.minResourceFee,
      cpuInstructions: String(resources.instructions()),
      memoryBytes: String(resources.readBytes()),
      footprint: simResult.transactionData.toXDR(),
    };
  }
}

// Export a singleton instance for ease of use
export const sorobanService = new SorobanService();

/**
 * Retrieves and formats execution logs (contract events) for a Soroban
 * transaction from the Stellar RPC.
 */
export async function getContractLogs(
  params: GetContractLogsParams
): Promise<ContractLogEntry[]> {
  if (!params.txHash || typeof params.txHash !== "string") {
    throw new Error("Missing or invalid txHash");
  }

  const rpcUrl = resolveRpcUrl(params.network, params.rpcUrl);

  let server: unknown;
  try {
    const RpcServer = (
      StellarSdk as unknown as {
        SorobanRpc: {
          Server: new (url: string, opts?: { allowHttp?: boolean }) => unknown;
        };
      }
    ).SorobanRpc.Server;
    server = new RpcServer(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  } catch {
    throw new Error("Failed to initialize Soroban RPC server");
  }

  const rpcServer = server as {
    getTransaction: (hash: string) => Promise<{
      status: string;
      resultXdr?: unknown;
      resultMetaXdr?: unknown;
      events?: Array<{
        type?: string;
        contractId?: string;
        topic?: unknown[];
        value?: unknown;
      }>;
    }>;
  };

  const txResult = await rpcServer.getTransaction(params.txHash);

  if (txResult.status === "NOT_FOUND") {
    throw new Error(`Transaction not found: ${params.txHash}`);
  }

  if (txResult.status === "FAILED") {
    throw new Error(`Transaction failed: ${params.txHash}`);
  }

  // Events may be returned directly on the result or within resultMetaXdr.
  const raw = txResult.events ?? [];

  return raw.map((ev, index): ContractLogEntry => {
    const topics: unknown[] = (ev.topic ?? []).map((t) =>
      typeof StellarSdk.scValToNative === "function" ? safeScValToNative(t) : t
    );
    const data: unknown =
      ev.value !== undefined && typeof StellarSdk.scValToNative === "function"
        ? safeScValToNative(ev.value)
        : (ev.value ?? null);

    return {
      index,
      contractId: ev.contractId ?? null,
      type: ev.type ?? "contract",
      topics,
      data,
    };
  });
}

function safeScValToNative(val: unknown): unknown {
  try {
    return StellarSdk.scValToNative(val as never);
  } catch {
    return val;
  }
}
