import { ChainId } from "../types";
import { SignatureProvider } from "./interfaces";
import { ProviderSelectionPreferences, TransactionWorkflowRequest, TransactionWorkflowResult } from "./types";
import { SignatureProviderRegistry } from "./registry";
import { SignatureProviderFactory } from "./provider-factory";
import { SignatureRequest } from "./types";
import { SignatureProviderErrorUtils } from "./errors";
import {
  enforceDestinationMemoRequirements,
  type StellarTransactionMemoShape,
} from "../advancedOps/memoOperations";
import { throwIfAborted } from "../abort";
import type { AbortSignalLike } from "../types";

export interface TransactionWorkflowSubmitter {
  submit(chainId: ChainId, signedTransaction: unknown, signal?: AbortSignalLike): Promise<{ success: boolean; transactionId?: string; rawResult?: unknown }>;
}

export class TransactionWorkflowEngine {
  constructor(
    private readonly registry: SignatureProviderRegistry,
    private readonly factory: SignatureProviderFactory,
    private readonly submitter?: TransactionWorkflowSubmitter
  ) {}

  async execute(request: TransactionWorkflowRequest, signal?: AbortSignalLike): Promise<TransactionWorkflowResult> {
    throwIfAborted(signal);
    const provider = await this.selectProvider(request.chainId, request.providerPreferences);
    if (!provider.isConnected()) {
      await provider.connect();
    }

    const signatureRequest: SignatureRequest = {
      transactionData: { chainId: request.chainId, transaction: request.transaction as never },
      accountAddress: request.accountAddress,
      metadata: request.metadata,
    };

    // Last gate before a signer sees the transaction: a destination that
    // requires a memo must be satisfied while the transaction can still be
    // rebuilt. Runs outside the provider try/catch so the failure names the
    // destination requirement rather than blaming the selected provider.
    if (request.chainId === ChainId.STELLAR) {
      enforceDestinationMemoRequirements(
        request.transaction as StellarTransactionMemoShape
      );
    }

    try {
      const signature = await provider.signTransaction(signatureRequest, signal);
      const submitted = request.submit && this.submitter && signature.signedTransaction
        ? await this.submitter.submit(request.chainId, signature.signedTransaction, signal)
        : undefined;

      return { providerId: provider.providerId, chainId: request.chainId, signature, submitted, metadata: request.metadata };
    } catch (error) {
      throw SignatureProviderErrorUtils.fromError(error, provider.providerId, request.chainId);
    }
  }

  private async selectProvider(chainId: ChainId, preferences?: ProviderSelectionPreferences): Promise<SignatureProvider> {
    const ranked = this.registry.resolveProviders(chainId, preferences);
    if (ranked.length > 0) {
      const existing = this.registry.listProviders().find((p) => p.providerId === ranked[0].providerId);
      if (existing) return existing;
    }
    return this.factory.getBestProviderForChain(chainId, preferences);
  }
}
