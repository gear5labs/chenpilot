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

  if (!params.contractId || typeof params.contractId !== "string") {
    throw new Error("Missing or invalid contractId");
  }

  if (!params.contractId.startsWith("C")) {
    throw new Error("Invalid contractId format");
  }

  if (!params.method || typeof params.method !== "string") {
    throw new Error("Missing or invalid method");
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
      return StellarSdk.nativeToScVal(arg as never);
    }
    return arg;
  });
}

export async function invokeContract(
  params: InvokeContractParams
): Promise<InvokeContractResult> {
  validateParams(params);

  const rpcUrl = resolveRpcUrl(params.network, params.rpcUrl);
  const passphrase = NETWORK_PASSPHRASES[params.network];

  const server = new StellarSdk.SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });

  const sourcePublicKey =
    params.source?.publicKey || StellarSdk.Keypair.random().publicKey();
  const account = new StellarSdk.Account(sourcePublicKey, "0");

  const contract = new StellarSdk.Contract(params.contractId);
  const op = contract.call(params.method, ...normalizeArgs(params.args));

  const fee = params.fee ? params.fee.toString() : String(StellarSdk.BASE_FEE);
  const timeoutSeconds = params.timeoutMs
    ? Math.ceil(params.timeoutMs / 1000)
    : 30;

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee,
    networkPassphrase: passphrase,
  })
    .addOperation(op)
    .setTimeout(timeoutSeconds)
    .build();

  const simulation = await server.simulateTransaction(tx);

  if ((simulation as any)?.error) {
    throw new Error(
      `Soroban simulation failed: ${(simulation as any).error}`
    );
  }

  const auth = (simulation as any)?.result?.auth;
  if (Array.isArray(auth) && auth.length > 0 && !params.source?.secretKey) {
    throw new Error(
      "Soroban invocation requires authorization; signing is not supported"
    );
  }

  const retval =
    (simulation as any)?.result?.retval ||
    (simulation as any)?.result?.result?.retval ||
    null;

  const decoded =
    retval && typeof StellarSdk.scValToNative === "function"
      ? StellarSdk.scValToNative(retval)
      : retval;

  return {
    network: params.network,
    contractId: params.contractId,
    method: params.method,
    result: decoded,
    raw: simulation,
  };
}
