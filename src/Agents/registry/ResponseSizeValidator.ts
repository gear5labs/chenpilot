import logger from "../../config/logger";

/**
 * Response size handling modes
 */
export type ResponseSizeMode = "truncate" | "reject";

/**
 * Configuration for response size validation
 */
export interface ResponseSizeConfig {
  /** Maximum response size in characters. */
  maxCharacters: number;
  /** Mode: "truncate" to truncate oversized responses, "reject" to fail them */
  mode: ResponseSizeMode;
  /** Enable truncation suffix indicator. Only applies in truncate mode. */
  includeTruncationIndicator?: boolean;
}

/**
 * Result of response size validation
 */
export interface ResponseSizeValidation {
  /** Whether response passed validation */
  valid: boolean;
  /** Whether response was truncated or rejected */
  handled: boolean;
  /** Original response length */
  originalLength: number;
  /** Processed response (truncated if applicable) */
  processedData?: Record<string, unknown>;
  /** Error message if rejected */
  rejectionReason?: string;
  /** Whether response exceeded limit */
  exceededLimit: boolean;
}

/**
 * Default response size limits (in characters) by risk level
 */
export const DEFAULT_RESPONSE_LIMITS: Record<string, number> = {
  low: 32768, // 32 KB
  medium: 16384, // 16 KB
  high: 8192, // 8 KB
};

/**
 * Global default limit for tools without explicit risk level
 */
export const GLOBAL_DEFAULT_LIMIT = 16384; // 16 KB

/**
 * Validates and optionally truncates/rejects tool responses based on size.
 *
 * # Supported Behavior
 *
 * ## Truncate Mode (default)
 * - Oversized responses are truncated to fit within the configured limit.
 * - Preserves response structure while reducing string values and array sizes.
 * - Adds optional truncation metadata to indicate processing.
 * - Allows agent execution to continue with partial results.
 *
 * ## Reject Mode
 * - Oversized responses cause the tool result to be marked as error.
 * - Returns error code "RESPONSE_SIZE_EXCEEDED" with rejection reason.
 * - Prevents overwhelming context with massive data.
 *
 * # Failure Cases
 * - Responses within limit: Pass validation, no processing.
 * - Responses exceeding limit in truncate mode: Truncated and processed flag set.
 * - Responses exceeding limit in reject mode: Marked as error, rejection reason provided.
 *
 * # Compatibility Requirements
 * - Risk levels (low/medium/high) map to different limits (32KB/16KB/8KB).
 * - Truncation preserves JSON structure and primitive values.
 * - Works with nested objects, arrays, and mixed data types.
 */
export class ResponseSizeValidator {
  private config: ResponseSizeConfig;

  constructor(config?: Partial<ResponseSizeConfig>) {
    this.config = {
      maxCharacters: config?.maxCharacters ?? GLOBAL_DEFAULT_LIMIT,
      mode: config?.mode ?? "truncate",
      includeTruncationIndicator:
        config?.includeTruncationIndicator !== false,
    };
  }

  /**
   * Validate response size and apply configured handling (truncate/reject).
   *
   * @param data - Tool response data object to validate
   * @param toolName - Name of the tool for logging and error messages
   * @param userId - User ID for audit logging
   * @returns Validation result with status, metadata, and processed data if applicable
   */
  validate(
    data: Record<string, unknown>,
    toolName: string,
    userId: string
  ): ResponseSizeValidation {
    const serialized = JSON.stringify(data);
    const originalLength = serialized.length;
    const exceededLimit = originalLength > this.config.maxCharacters;

    if (!exceededLimit) {
      return {
        valid: true,
        handled: false,
        originalLength,
        processedData: data,
        exceededLimit: false,
      };
    }

    // Response exceeds limit — apply configured handling mode
    if (this.config.mode === "reject") {
      const reason = `Response from tool '${toolName}' exceeded maximum size of ${this.config.maxCharacters} characters (actual: ${originalLength} characters)`;
      logger.warn("Tool response rejected due to size", {
        toolName,
        userId,
        originalSize: originalLength,
        limit: this.config.maxCharacters,
      });

      return {
        valid: false,
        handled: true,
        originalLength,
        exceededLimit: true,
        rejectionReason: reason,
      };
    }

    // Truncate mode — safely truncate the JSON response
    const truncated = this.truncateResponse(data, originalLength, toolName);

    logger.warn("Tool response truncated due to size", {
      toolName,
      userId,
      originalSize: originalLength,
      truncatedSize: JSON.stringify(truncated).length,
      limit: this.config.maxCharacters,
    });

    return {
      valid: true,
      handled: true,
      originalLength,
      processedData: truncated,
      exceededLimit: true,
    };
  }

  /**
   * Truncate a tool response while preserving structure
   */
  private truncateResponse(
    data: Record<string, unknown>,
    originalLength: number,
    toolName: string
  ): Record<string, unknown> {
    const truncated: Record<string, unknown> = {};

    // For each key, truncate string values and preserve other types
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string") {
        truncated[key] = this.truncateString(
          value,
          this.config.maxCharacters / 2 // Split budget among keys
        );
      } else if (Array.isArray(value)) {
        // Truncate arrays by limiting items
        truncated[key] = this.truncateArray(
          value,
          Math.ceil(this.config.maxCharacters / 4 / (value.length || 1))
        );
      } else if (typeof value === "object" && value !== null) {
        truncated[key] = this.truncateObject(
          value as Record<string, unknown>,
          this.config.maxCharacters / 4
        );
      } else {
        // Preserve primitives (numbers, booleans, null)
        truncated[key] = value;
      }
    }

    // Add truncation indicator
    if (this.config.includeTruncationIndicator) {
      truncated._truncation_notice = `Response was automatically truncated from ${originalLength} characters to comply with ${this.config.maxCharacters} character limit`;
    }

    return truncated;
  }

  /**
   * Truncate a string to fit within budget
   */
  private truncateString(str: string, budget: number): string {
    if (str.length <= budget) {
      return str;
    }

    const suffix = this.config.includeTruncationIndicator
      ? " ...[TRUNCATED]"
      : "";
    const availableLength = Math.max(0, budget - suffix.length);
    return str.slice(0, availableLength) + suffix;
  }

  /**
   * Truncate an array by limiting item count and stringifying
   */
  private truncateArray(arr: unknown[], itemBudget: number): unknown[] {
    // Limit array to reasonable number of items
    const maxItems = Math.max(1, Math.floor(this.config.maxCharacters / 500)); // Rough estimate
    return arr.slice(0, maxItems).map((item) => {
      if (typeof item === "string") {
        return this.truncateString(item, itemBudget);
      }
      return item;
    });
  }

  /**
   * Recursively truncate nested objects
   */
  private truncateObject(
    obj: Record<string, unknown>,
    budget: number
  ): Record<string, unknown> {
    const truncated: Record<string, unknown> = {};
    const perFieldBudget = budget / Math.max(1, Object.keys(obj).length);

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        truncated[key] = this.truncateString(value, perFieldBudget);
      } else if (typeof value === "object" && value !== null) {
        if (Array.isArray(value)) {
          truncated[key] = this.truncateArray(value, perFieldBudget);
        } else {
          truncated[key] = this.truncateObject(
            value as Record<string, unknown>,
            perFieldBudget / 2
          );
        }
      } else {
        truncated[key] = value;
      }
    }

    return truncated;
  }
}
