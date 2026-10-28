/**
 * Error redaction utilities for preventing secret values from entering logs or API responses.
 *
 * This module provides field-aware redaction for tokens, keys, and authorization headers
 * to ensure sensitive data never appears in captured logs or error responses.
 */

/**
 * Patterns that indicate a field might contain sensitive data.
 * These are case-insensitive and will match against object keys.
 */
const SENSITIVE_FIELD_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
  /auth/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /private[_-]?key/i,
  /access[_-]?key/i,
  /session[_-]?id/i,
  /refresh[_-]?token/i,
  /jwt/i,
  /signature/i,
  /hook/i, // webhook secrets
];

/**
 * Patterns that match common secret value formats.
 * Used for additional defense-in-depth redaction.
 */
const SENSITIVE_VALUE_PATTERNS = [
  /^Bearer\s+/i,
  /^Basic\s+/i,
  /^sk-[a-zA-Z0-9]{32,}/, // OpenAI-style keys
  /^[a-f0-9]{32,}$/, // Hex strings that might be keys
  /^[A-Za-z0-9+/]{40,}={0,2}$/, // Base64-like strings
];

/**
 * Redaction placeholder - used instead of actual secret values.
 */
export const REDACTED = "[REDACTED]";

/**
 * Recursively redact sensitive values from an object.
 *
 * This function:
 * - Traverses objects and arrays recursively
 * - Redacts values for fields matching sensitive patterns
 * - Applies defense-in-depth value pattern matching
 * - Preserves structure but replaces sensitive values
 *
 * @param obj - The object to redact
 * @param depth - Current recursion depth (prevents infinite loops)
 * @returns A new object with sensitive values redacted
 */
export function redactSecrets<T>(obj: T, depth = 0): T {
  const MAX_DEPTH = 20;

  if (depth > MAX_DEPTH) {
    return obj;
  }

  // Handle primitives and null/undefined
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle strings - check if they look like secrets
  if (typeof obj === "string") {
    if (isSensitiveValue(obj)) {
      return REDACTED as T;
    }
    return obj;
  }

  // Handle numbers, booleans, dates, etc.
  if (typeof obj !== "object") {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => redactSecrets(item, depth + 1)) as T;
  }

  // Handle Error objects specially
  if (obj instanceof Error) {
    const redactedError = {
      name: obj.name,
      message: redactSecrets(obj.message, depth + 1),
      stack: obj.stack ? redactSecrets(obj.stack, depth + 1) : undefined,
    } as T;

    // Copy any enumerable properties
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        (redactedError as Record<string, unknown>)[key] = redactSecrets(
          (obj as Record<string, unknown>)[key],
          depth + 1
        );
      }
    }

    return redactedError;
  }

  // Handle plain objects
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = (obj as Record<string, unknown>)[key];
      result[key] = isSensitiveField(key)
        ? REDACTED
        : redactSecrets(value, depth + 1);
    }
  }

  return result as T;
}

/**
 * Check if a field name indicates it might contain sensitive data.
 */
function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

/**
 * Check if a value looks like it might be a secret.
 * Defense-in-depth check for values that slipped through field-based redaction.
 */
function isSensitiveValue(value: string): boolean {
  // Skip short strings - unlikely to be secrets
  if (value.length < 10) {
    return false;
  }

  // Check against known secret patterns
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Safely serialize an error to JSON with secret redaction.
 *
 * This is a drop-in replacement for JSON.stringify that includes
 * automatic secret redaction for error objects.
 *
 * @param error - The error to serialize
 * @returns JSON string with secrets redacted
 */
export function serializeErrorWithRedaction(error: unknown): string {
  const redacted = redactSecrets(error);
  return JSON.stringify(redacted, null, 2);
}

/**
 * Redact secrets from an object's specific field.
 * Useful for targeted redaction in logging or response building.
 *
 * @param obj - The object containing the field
 * @param fieldName - The field name to redact
 * @returns The object with the field value redacted if sensitive
 */
export function redactField<T extends Record<string, unknown>>(
  obj: T,
  fieldName: string
): T {
  if (obj[fieldName] !== undefined && isSensitiveField(fieldName)) {
    return {
      ...obj,
      [fieldName]: REDACTED,
    };
  }
  return obj;
}
