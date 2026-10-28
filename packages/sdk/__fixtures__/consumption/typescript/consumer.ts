/**
 * TypeScript consumer fixture for the minimum-compiler check (#1000).
 *
 * Imports the published package entry points only — no source-path aliases —
 * so the check fails if the public declarations require a newer TypeScript
 * than the documented minimum.
 */
import {
  canonicalize,
  ErrorRegistry,
  isAbortError,
  mapBackendError,
  AgentClient,
  buildHashMemo,
  type CanonicalValue,
  type WalletBalance,
  type AgentResponse,
} from "@chen-pilot/sdk-core";

export function roundTrip(value: CanonicalValue): string {
  return canonicalize(value);
}

export function hashMemoExample() {
  return buildHashMemo("00".repeat(32));
}

export function describeBalance(balance: WalletBalance): string {
  return JSON.stringify(balance);
}

export function mapError(error: unknown) {
  if (isAbortError(error)) {
    return { aborted: true as const };
  }
  return mapBackendError(error as never);
}

export function registryCodes(): readonly string[] {
  return ErrorRegistry.codes();
}

export type ResponseLike = AgentResponse;
export const AgentClientCtor = AgentClient;
