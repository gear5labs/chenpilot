import { ChainId } from "../types";
import {
  SignatureProviderError,
  ConnectionError,
  ConnectionTimeoutError,
  ProviderNotFoundError,
  AuthenticationError,
  UserRejectedError,
  NetworkError,
  HardwareWalletError,
  DeviceNotFoundError,
  DeviceBusyError,
  DeviceLockedError,
  SignatureProviderErrorUtils,
} from "./errors";

/**
 * Recovery strategy for handling SignatureProvider errors
 */
export interface ErrorRecoveryStrategy {
  canRecover(error: SignatureProviderError): boolean;
  recover(
    error: SignatureProviderError,
    context?: ErrorRecoveryContext
  ): Promise<ErrorRecoveryResult>;
  getRecoveryInstructions(error: SignatureProviderError): string[];
}

/**
 * Context information for error recovery
 */
export interface ErrorRecoveryContext {
  providerId?: string;
  chainId?: ChainId;
  retryCount?: number;
  maxRetries?: number;
  lastAttemptTime?: Date;
  userInteractionAllowed?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Result of an error recovery attempt
 */
export interface ErrorRecoveryResult {
  success: boolean;
  shouldRetry: boolean;
  retryAfterMs?: number;
  newError?: SignatureProviderError;
  instructions?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Recovery strategy for connection-related errors
 */
export class ConnectionErrorRecoveryStrategy implements ErrorRecoveryStrategy {
  canRecover(error: SignatureProviderError): boolean {
    return error instanceof ConnectionError && error.recoverable;
  }

  async recover(
    error: SignatureProviderError,
    context: ErrorRecoveryContext = {}
  ): Promise<ErrorRecoveryResult> {
    const retryCount = context.retryCount ?? 0;
    const maxRetries = context.maxRetries ?? 3;

    if (retryCount >= maxRetries) {
      return {
        success: false,
        shouldRetry: false,
        instructions: [
          "Maximum retry attempts reached. Please check your connection and try again later.",
        ],
      };
    }

    if (error instanceof ConnectionTimeoutError) {
      // Exponential backoff for timeout errors
      const retryAfterMs = Math.min(1000 * Math.pow(2, retryCount), 10000);

      return {
        success: false,
        shouldRetry: true,
        retryAfterMs,
        instructions: [
          "Connection timed out.",
          `Retrying in ${retryAfterMs / 1000} seconds...`,
          "Ensure your internet connection is stable.",
        ],
      };
    }

    if (error instanceof ProviderNotFoundError) {
      return {
        success: false,
        shouldRetry: false,
        instructions: [
          "Wallet provider not found.",
          "Please ensure the wallet extension is installed and enabled.",
          "Refresh the page and try again.",
        ],
      };
    }

    // Generic connection error
    return {
      success: false,
      shouldRetry: retryCount < maxRetries,
      retryAfterMs: 2000,
      instructions: [
        "Connection failed.",
        "Please check your internet connection.",
        "Ensure the wallet is accessible.",
      ],
    };
  }

  getRecoveryInstructions(error: SignatureProviderError): string[] {
    if (error instanceof ConnectionTimeoutError) {
      return [
        "Connection timed out",
        "Check your internet connection",
        "Try again in a few moments",
      ];
    }

    if (error instanceof ProviderNotFoundError) {
      return [
        "Wallet not found",
        "Install the wallet extension",
        "Enable the wallet in your browser",
        "Refresh the page",
      ];
    }

    return [
      "Connection failed",
      "Check your internet connection",
      "Ensure wallet is accessible",
    ];
  }
}

/**
 * Recovery strategy for authentication-related errors
 */
export class AuthenticationErrorRecoveryStrategy implements ErrorRecoveryStrategy {
  canRecover(error: SignatureProviderError): boolean {
    return error instanceof AuthenticationError;
  }

  async recover(
    error: SignatureProviderError,
    context: ErrorRecoveryContext = {}
  ): Promise<ErrorRecoveryResult> {
    if (error instanceof UserRejectedError) {
      return {
        success: false,
        shouldRetry: false,
        instructions: [
          "Transaction was cancelled by user.",
          "Please approve the transaction in your wallet to continue.",
        ],
      };
    }

    const retryCount = context.retryCount ?? 0;
    const maxRetries = context.maxRetries ?? 2;

    if (retryCount >= maxRetries) {
      return {
        success: false,
        shouldRetry: false,
        instructions: [
          "Authentication failed multiple times.",
          "Please check your wallet settings and try again.",
        ],
      };
    }

    return {
      success: false,
      shouldRetry: true,
      retryAfterMs: 1000,
      instructions: [
        "Authentication failed.",
        "Please check your wallet connection.",
        "Ensure you are logged into your wallet.",
      ],
    };
  }

  getRecoveryInstructions(error: SignatureProviderError): string[] {
    if (error instanceof UserRejectedError) {
      return [
        "Transaction cancelled",
        "Approve the transaction in your wallet",
        "Check transaction details carefully",
      ];
    }

    return [
      "Authentication failed",
      "Check wallet connection",
      "Ensure wallet is unlocked",
    ];
  }
}

/**
 * Recovery strategy for hardware wallet errors
 */
export class HardwareWalletErrorRecoveryStrategy implements ErrorRecoveryStrategy {
  canRecover(error: SignatureProviderError): boolean {
    return error instanceof HardwareWalletError;
  }

  async recover(
    error: SignatureProviderError,
    _context: ErrorRecoveryContext = {}
  ): Promise<ErrorRecoveryResult> {
    void _context;
    if (error instanceof DeviceNotFoundError) {
      return {
        success: false,
        shouldRetry: true,
        retryAfterMs: 3000,
        instructions: [
          "Hardware wallet not detected.",
          "Connect your hardware wallet via USB.",
          "Ensure the device is powered on.",
          "Try a different USB port or cable.",
        ],
      };
    }

    if (error instanceof DeviceLockedError) {
      return {
        success: false,
        shouldRetry: true,
        retryAfterMs: 1000,
        instructions: [
          "Hardware wallet is locked.",
          "Enter your PIN on the device.",
          "Ensure the correct app is open on the device.",
        ],
      };
    }

    if (error instanceof DeviceBusyError) {
      return {
        success: false,
        shouldRetry: true,
        retryAfterMs: 2000,
        instructions: [
          "Hardware wallet is busy.",
          "Complete any pending operations on the device.",
          "Close other applications using the device.",
        ],
      };
    }

    // Generic hardware wallet error
    return {
      success: false,
      shouldRetry: true,
      retryAfterMs: 2000,
      instructions: [
        "Hardware wallet error occurred.",
        "Check device connection.",
        "Ensure correct app is open on device.",
      ],
    };
  }

  getRecoveryInstructions(error: SignatureProviderError): string[] {
    if (error instanceof DeviceNotFoundError) {
      return [
        "Connect hardware wallet",
        "Check USB connection",
        "Power on the device",
      ];
    }

    if (error instanceof DeviceLockedError) {
      return [
        "Unlock hardware wallet",
        "Enter PIN on device",
        "Open correct app",
      ];
    }

    if (error instanceof DeviceBusyError) {
      return [
        "Device is busy",
        "Complete pending operations",
        "Close other apps using device",
      ];
    }

    return [
      "Hardware wallet error",
      "Check device connection",
      "Ensure device is ready",
    ];
  }
}

/**
 * Recovery strategy for network-related errors
 */
export class NetworkErrorRecoveryStrategy implements ErrorRecoveryStrategy {
  canRecover(error: SignatureProviderError): boolean {
    return error instanceof NetworkError;
  }

  async recover(
    error: SignatureProviderError,
    context: ErrorRecoveryContext = {}
  ): Promise<ErrorRecoveryResult> {
    const retryCount = context.retryCount ?? 0;
    const maxRetries = context.maxRetries ?? 5;

    if (retryCount >= maxRetries) {
      return {
        success: false,
        shouldRetry: false,
        instructions: [
          "Network error persists after multiple attempts.",
          "Please check your internet connection.",
          "Try again later when network conditions improve.",
        ],
      };
    }

    // Exponential backoff with jitter
    const baseDelay = 1000;
    const jitter = Math.random() * 500;
    const retryAfterMs = Math.min(
      baseDelay * Math.pow(2, retryCount) + jitter,
      30000
    );

    return {
      success: false,
      shouldRetry: true,
      retryAfterMs,
      instructions: [
        "Network error occurred.",
        `Retrying in ${Math.round(retryAfterMs / 1000)} seconds...`,
        "Check your internet connection.",
      ],
    };
  }

  getRecoveryInstructions(_error: SignatureProviderError): string[] {
    void _error;
    return [
      "Network error",
      "Check internet connection",
      "Try again in a moment",
    ];
  }
}

/**
 * Comprehensive error recovery manager
 */
export class SignatureProviderErrorRecovery {
  private strategies: ErrorRecoveryStrategy[] = [
    new ConnectionErrorRecoveryStrategy(),
    new AuthenticationErrorRecoveryStrategy(),
    new HardwareWalletErrorRecoveryStrategy(),
    new NetworkErrorRecoveryStrategy(),
  ];

  /**
   * Add a custom recovery strategy
   */
  addStrategy(strategy: ErrorRecoveryStrategy): void {
    this.strategies.push(strategy);
  }

  /**
   * Remove a recovery strategy
   */
  removeStrategy(strategy: ErrorRecoveryStrategy): void {
    const index = this.strategies.indexOf(strategy);
    if (index > -1) {
      this.strategies.splice(index, 1);
    }
  }

  /**
   * Attempt to recover from an error
   */
  async recover(
    error: unknown,
    context: ErrorRecoveryContext = {}
  ): Promise<ErrorRecoveryResult> {
    // Convert to SignatureProviderError if needed
    const providerError =
      error instanceof SignatureProviderError
        ? error
        : SignatureProviderErrorUtils.fromError(
            error,
            context.providerId,
            context.chainId
          );

    // Find appropriate recovery strategy
    const strategy = this.strategies.find((s) => s.canRecover(providerError));

    if (!strategy) {
      return {
        success: false,
        shouldRetry: SignatureProviderErrorUtils.isRecoverable(providerError),
        instructions: [
          SignatureProviderErrorUtils.getErrorMessage(providerError),
          "No specific recovery strategy available.",
        ],
      };
    }

    try {
      return await strategy.recover(providerError, context);
    } catch (recoveryError) {
      return {
        success: false,
        shouldRetry: false,
        newError: SignatureProviderErrorUtils.fromError(recoveryError),
        instructions: [
          "Error recovery failed.",
          "Please try again or contact support.",
        ],
      };
    }
  }

  /**
   * Get recovery instructions for an error without attempting recovery
   */
  getRecoveryInstructions(error: unknown): string[] {
    const providerError =
      error instanceof SignatureProviderError
        ? error
        : SignatureProviderErrorUtils.fromError(error);

    const strategy = this.strategies.find((s) => s.canRecover(providerError));

    if (strategy) {
      return strategy.getRecoveryInstructions(providerError);
    }

    return [
      SignatureProviderErrorUtils.getErrorMessage(providerError),
      "Please try again or contact support.",
    ];
  }

  /**
   * Check if an error is recoverable
   */
  canRecover(error: unknown): boolean {
    const providerError =
      error instanceof SignatureProviderError
        ? error
        : SignatureProviderErrorUtils.fromError(error);

    return this.strategies.some((s) => s.canRecover(providerError));
  }
}

// Global error recovery instance
export const signatureProviderErrorRecovery =
  new SignatureProviderErrorRecovery();
