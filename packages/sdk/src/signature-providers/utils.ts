import { ChainId } from "../types";
import { SignatureProvider } from "./interfaces";
import { SignatureProviderCapabilities } from "./types";
import { UnsupportedChainError, UnsupportedOperationError } from "./errors";

/**
 * Utility functions for working with SignatureProviders
 */
export class SignatureProviderUtils {
  /**
   * Check if a provider supports a specific chain
   */
  static supportsChain(provider: SignatureProvider, chainId: ChainId): boolean {
    return provider.getCapabilities().supportedChains.includes(chainId);
  }

  /**
   * Check if a provider supports multiple chains
   */
  static supportsMultipleChains(
    provider: SignatureProvider,
    chainIds: ChainId[]
  ): boolean {
    const supportedChains = provider.getCapabilities().supportedChains;
    return chainIds.every((chainId) => supportedChains.includes(chainId));
  }

  /**
   * Check if a provider supports message signing
   */
  static supportsMessageSigning(provider: SignatureProvider): boolean {
    return provider.getCapabilities().supportsMessageSigning;
  }

  /**
   * Check if a provider requires user interaction
   */
  static requiresUserInteraction(provider: SignatureProvider): boolean {
    return provider.getCapabilities().requiresUserInteraction;
  }

  /**
   * Get the maximum concurrent signatures a provider can handle
   */
  static getMaxConcurrentSignatures(provider: SignatureProvider): number {
    return provider.getCapabilities().maxConcurrentSignatures;
  }

  /**
   * Validate that a provider can handle a specific operation
   */
  static validateProviderCapability(
    provider: SignatureProvider,
    chainId: ChainId,
    requiresMessageSigning: boolean = false
  ): void {
    const capabilities = provider.getCapabilities();

    if (!capabilities.supportedChains.includes(chainId)) {
      throw new UnsupportedChainError(chainId, provider.providerId);
    }

    if (requiresMessageSigning && !capabilities.supportsMessageSigning) {
      throw new UnsupportedOperationError(
        "message signing",
        provider.providerId
      );
    }
  }

  /**
   * Compare providers by their capabilities (for sorting/ranking)
   */
  static compareProviders(a: SignatureProvider, b: SignatureProvider): number {
    const aCaps = a.getCapabilities();
    const bCaps = b.getCapabilities();

    // Prioritize by number of supported chains
    const chainDiff =
      bCaps.supportedChains.length - aCaps.supportedChains.length;
    if (chainDiff !== 0) return chainDiff;

    // Then by concurrent signature capacity
    const concurrentDiff =
      bCaps.maxConcurrentSignatures - aCaps.maxConcurrentSignatures;
    if (concurrentDiff !== 0) return concurrentDiff;

    // Finally by provider name (alphabetical)
    return a.metadata.name.localeCompare(b.metadata.name);
  }

  /**
   * Get a human-readable description of provider capabilities
   */
  static getCapabilityDescription(
    capabilities: SignatureProviderCapabilities
  ): string {
    const parts: string[] = [];

    parts.push(
      `Supports ${capabilities.supportedChains.length} chain(s): ${capabilities.supportedChains.join(", ")}`
    );

    if (capabilities.supportsMultipleAccounts) {
      parts.push("Multiple accounts supported");
    }

    if (capabilities.supportsMessageSigning) {
      parts.push("Message signing supported");
    }

    if (capabilities.requiresUserInteraction) {
      parts.push("Requires user interaction");
    }

    parts.push(
      `Max concurrent signatures: ${capabilities.maxConcurrentSignatures}`
    );

    return parts.join("; ");
  }

  /**
   * Filter providers by specific criteria
   */
  static filterProviders(
    providers: SignatureProvider[],
    criteria: {
      supportedChains?: ChainId[];
      requiresAllChains?: boolean;
      supportsMessageSigning?: boolean;
      requiresUserInteraction?: boolean;
      minConcurrentSignatures?: number;
      connected?: boolean;
    }
  ): SignatureProvider[] {
    return providers.filter((provider) => {
      const capabilities = provider.getCapabilities();

      // Filter by supported chains
      if (criteria.supportedChains) {
        if (criteria.requiresAllChains) {
          // Provider must support ALL specified chains
          if (
            !criteria.supportedChains.every((chain) =>
              capabilities.supportedChains.includes(chain)
            )
          ) {
            return false;
          }
        } else {
          // Provider must support AT LEAST ONE specified chain
          if (
            !criteria.supportedChains.some((chain) =>
              capabilities.supportedChains.includes(chain)
            )
          ) {
            return false;
          }
        }
      }

      // Filter by message signing support
      if (criteria.supportsMessageSigning !== undefined) {
        if (
          capabilities.supportsMessageSigning !==
          criteria.supportsMessageSigning
        ) {
          return false;
        }
      }

      // Filter by user interaction requirement
      if (criteria.requiresUserInteraction !== undefined) {
        if (
          capabilities.requiresUserInteraction !==
          criteria.requiresUserInteraction
        ) {
          return false;
        }
      }

      // Filter by minimum concurrent signatures
      if (criteria.minConcurrentSignatures !== undefined) {
        if (
          capabilities.maxConcurrentSignatures <
          criteria.minConcurrentSignatures
        ) {
          return false;
        }
      }

      // Filter by connection status
      if (criteria.connected !== undefined) {
        if (provider.isConnected() !== criteria.connected) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Find the best provider for a specific use case
   */
  static findBestProvider(
    providers: SignatureProvider[],
    chainId: ChainId,
    preferences: {
      preferConnected?: boolean;
      preferNoUserInteraction?: boolean;
      preferMessageSigning?: boolean;
      preferMultipleAccounts?: boolean;
    } = {}
  ): SignatureProvider | null {
    // First filter to providers that support the chain
    const compatibleProviders = providers.filter((provider) =>
      this.supportsChain(provider, chainId)
    );

    if (compatibleProviders.length === 0) {
      return null;
    }

    // Score providers based on preferences
    const scoredProviders = compatibleProviders.map((provider) => {
      let score = 0;
      const capabilities = provider.getCapabilities();

      // Base score for supporting the chain
      score += 10;

      // Preference bonuses
      if (preferences.preferConnected && provider.isConnected()) {
        score += 5;
      }

      if (
        preferences.preferNoUserInteraction &&
        !capabilities.requiresUserInteraction
      ) {
        score += 3;
      }

      if (
        preferences.preferMessageSigning &&
        capabilities.supportsMessageSigning
      ) {
        score += 2;
      }

      if (
        preferences.preferMultipleAccounts &&
        capabilities.supportsMultipleAccounts
      ) {
        score += 2;
      }

      // Bonus for higher concurrent signature capacity
      score += Math.min(capabilities.maxConcurrentSignatures, 5);

      return { provider, score };
    });

    // Sort by score (highest first) and return the best
    scoredProviders.sort((a, b) => b.score - a.score);
    return scoredProviders[0].provider;
  }

  /**
   * Create a summary of all providers and their capabilities
   */
  static createProviderSummary(providers: SignatureProvider[]): {
    totalProviders: number;
    connectedProviders: number;
    chainSupport: Record<ChainId, number>;
    capabilities: {
      messageSigningSupport: number;
      multipleAccountsSupport: number;
      requireUserInteraction: number;
    };
  } {
    const summary = {
      totalProviders: providers.length,
      connectedProviders: 0,
      chainSupport: {
        [ChainId.BITCOIN]: 0,
        [ChainId.STELLAR]: 0,
        [ChainId.STARKNET]: 0,
      },
      capabilities: {
        messageSigningSupport: 0,
        multipleAccountsSupport: 0,
        requireUserInteraction: 0,
      },
    };

    providers.forEach((provider) => {
      if (provider.isConnected()) {
        summary.connectedProviders++;
      }

      const capabilities = provider.getCapabilities();

      // Count chain support
      capabilities.supportedChains.forEach((chain) => {
        if (chain in summary.chainSupport) {
          summary.chainSupport[chain]++;
        }
      });

      // Count capabilities
      if (capabilities.supportsMessageSigning) {
        summary.capabilities.messageSigningSupport++;
      }

      if (capabilities.supportsMultipleAccounts) {
        summary.capabilities.multipleAccountsSupport++;
      }

      if (capabilities.requiresUserInteraction) {
        summary.capabilities.requireUserInteraction++;
      }
    });

    return summary;
  }
}
