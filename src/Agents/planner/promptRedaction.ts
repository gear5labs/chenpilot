/**
 * Redaction policy for planner prompt diagnostics (#1096)
 *
 * Strips secrets, private keys, bearer authorization tokens, and credentials
 * from diagnostic traces before serialization to disk or logs.
 */

export interface PromptDiagnosticEntry {
  promptText: string;
  metadata?: Record<string, unknown>;
  systemPolicyVersion?: string;
}

export function redactPlannerPromptDiagnostics(
  entry: PromptDiagnosticEntry,
  isProduction: boolean = true
): PromptDiagnosticEntry {
  if (!isProduction) {
    return entry;
  }

  let text = entry.promptText;

  // Redact Stellar private keys (S...)
  text = text.replace(/S[A-Z0-9]{55}/g, "[REDACTED_STELLAR_SECRET_KEY]");

  // Redact EVM private keys (0x + 64 hex chars)
  text = text.replace(/0x[a-fA-F0-9]{64}/g, "[REDACTED_EVM_PRIVATE_KEY]");

  // Redact Authorization Bearer tokens / GitHub tokens
  text = text.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED_TOKEN]");
  text = text.replace(/ghp_[a-zA-Z0-9]{36}/g, "[REDACTED_GITHUB_TOKEN]");

  // Redact passwords and api secrets in key-value format
  text = text.replace(/(?:password|secret|apiKey|api_key|token)\s*[:=]\s*["']?[^"'\s,]+["']?/gi, (match) => {
    const key = match.split(/[:=]/)[0];
    return `${key}: "[REDACTED]"`;
  });

  return {
    ...entry,
    promptText: text,
  };
}
