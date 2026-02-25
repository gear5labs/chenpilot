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
  mainnet: StellarSdk.Networks?.PUBLIC || "Public Global Stellar Network ; September 2015",
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

function normalizeArgs(args?: unknown[]): any[] {
  if (!args || !Array.isArray(args)) return [];
  return args.map((arg) => {
    if (isScValLike(arg)) return arg;
    if (typeof StellarSdk.nativeToScVal === "function") {
      return StellarSdk.nativeToScVal(arg as any);
      try {
        return StellarSdk.nativeToScVal(arg as never);
      } catch {
        return arg;
      }
    }
    return arg;
  });
}

// --- SorobanService Class ---
export async function invokeContract(
  params: InvokeContractParams
): Promise<InvokeContractResult> {
  // Check if we should use local chain simulation
  try {
    const { getInterceptor } = await import('../simulation/ServiceInterceptor');
    const interceptor = getInterceptor();
    if (interceptor && interceptor.isSimulationEnabled('soroban')) {
      return interceptor.intercept(
        'soroban',
        'invoke_contract',
        [params],
        (...args: unknown[]) => invokeContractLive(args[0] as InvokeContractParams)
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

export class SorobanService {
  /**
   * Issue #52: Implement simulateContractCall
   * Provides gas and resource estimates before submission.
   */
  async simulateContractCall(params: InvokeContractParams): Promise<SimulationEstimates> {
    validateParams(params);

    const rpcUrl = resolveRpcUrl(params.network, params.rpcUrl);
    const passphrase = NETWORK_PASSPHRASES[params.network];
    const server = new StellarSdk.SorobanRpc.Server(rpcUrl);
  // Try different server initialization approaches for different SDK versions
  let server: unknown;
  try {
    // Try newer SDK structure - use Soroban instead of SorobanRpc
    const SorobanServer = (StellarSdk as unknown as { Soroban: { Server: new (url: string, options?: { allowHttp?: boolean }) => unknown } }).Soroban.Server;
    server = new SorobanServer(rpcUrl, {
      allowHttp: rpcUrl.startsWith("http://"),
    });
  } catch (error) {
    try {
      // Try alternative structure
      const HorizonServer = (StellarSdk as unknown as { Horizon: { Server: new (url: string) => unknown } }).Horizon.Server;
      server = new HorizonServer(rpcUrl);
    } catch (fallbackError) {
      throw new Error(`Failed to initialize Stellar server: ${error}`);
    }
  }

    // Use G...A dummy if no public key provided to allow simulation
    const sourcePublicKey = params.source?.publicKey || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const account = new StellarSdk.Account(sourcePublicKey, "0");

    const contract = new StellarSdk.Contract(params.contractId);
    const op = contract.call(params.method, ...normalizeArgs(params.args));
  const contract = new StellarSdk.Contract(params.contractId);
  const normalizedArgs = normalizeArgs(params.args);
  // Use spread operator with proper typing
  const contractCall = (contract as { call: (method: string, ...args: unknown[]) => unknown }).call;
  const op = contractCall.call(contract, params.method, ...normalizedArgs);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(op)
      .setTimeout(params.timeoutMs ? Math.ceil(params.timeoutMs / 1000) : 30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    if (StellarSdk.SorobanRpc.Api.isSimulationSuccess(simulation)) {
      const resources = simulation.transactionData.build().resources();
      
      return {
        minResourceFee: simulation.minResourceFee,
        cpuInstructions: resources.instructions().toString(),
        memoryBytes: resources.readBytes().toString(),
        footprint: simulation.transactionData.toXDR(),
      };
    }

    throw new Error("Unknown simulation result");
  }

  /**
   * Existing logic wrapped for service usage
   */
  async invokeContract(params: InvokeContractParams): Promise<InvokeContractResult> {
    validateParams(params);
    const rpcUrl = resolveRpcUrl(params.network, params.rpcUrl);
    const server = new StellarSdk.SorobanRpc.Server(rpcUrl);

    const sourcePublicKey = params.source?.publicKey || StellarSdk.Keypair.random().publicKey();
    const account = new StellarSdk.Account(sourcePublicKey, "0");
    const contract = new StellarSdk.Contract(params.contractId);
    const op = contract.call(params.method, ...normalizeArgs(params.args));

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: params.fee ? params.fee.toString() : StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASES[params.network],
    })
      .addOperation(op)
      .setTimeout(params.timeoutMs ? Math.ceil(params.timeoutMs / 1000) : 30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
      throw new Error(`Soroban simulation failed: ${simulation.error}`);
    }

    const retval = (simulation as any).result?.retval;
    const decoded = retval ? StellarSdk.scValToNative(retval) : null;

    return {
      network: params.network,
      contractId: params.contractId,
      method: params.method,
      result: decoded,
      raw: simulation,
    };
  }
}

// Export a singleton instance for ease of use
export const sorobanService = new SorobanService();
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee,
    networkPassphrase: passphrase,
  })
    .addOperation(op as never)
    .setTimeout(timeoutSeconds)
    .build();

  let simulation: unknown;
  try {
    simulation = await (server as { simulateTransaction: (tx: StellarSdk.Transaction) => Promise<unknown> }).simulateTransaction(tx);
  } catch (error) {
    throw new Error(`Failed to simulate transaction: ${error}`);
  }

  const simResult = simulation as { error?: string; result?: { auth?: unknown[]; retval?: unknown; result?: { retval?: unknown } } };
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
    simResult?.result?.retval ||
    simResult?.result?.result?.retval ||
    null;

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
