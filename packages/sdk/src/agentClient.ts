import { createHash, randomUUID } from "crypto";
import { AgentResponse, ChainId, CrossChainSwapRequest } from "./types";

/** Input required to generate a stable idempotency key */
export interface IdempotencyKeyInput {
  namespace: string;
  payload: unknown;
  clientRequestId?: string;
}

/** Configuration options for initializing the AgentClient */
export interface AgentClientOptions {
  baseUrl: string;
  defaultTimeoutMs?: number;
  defaultMaxRetries?: number;
  defaultRetryDelayMs?: number;
  fetchFn?: FetchLike;
}

interface AbortSignalLike {
  aborted: boolean;
  addEventListener?: (
    type: "abort",
    listener: () => void,
    options?: { once?: boolean }
  ) => void;
}

interface AbortControllerLike {
  signal: AbortSignalLike;
  abort: () => void;
}

/** Request payload for making a query to the AI Agent */
export interface AgentQueryRequest {
  userId: string;
  query: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  signal?: AbortSignalLike;
}

/** The result envelope from an Agent query */
export interface AgentQueryResult<T = AgentResponse> {
  idempotencyKey: string;
  attempts: number;
  result: T;
}

/** Options for executing a specific BTC to Stellar swap query */
export interface ExecuteBtcToStellarSwapOptions {
  userId: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  signal?: AbortSignalLike;
}

/** Error thrown when an agent request fails after all retries */
export class AgentRequestError extends Error {
  readonly idempotencyKey: string;
  readonly attempts: number;
  readonly statusCode?: number;

  constructor(
    message: string,
    idempotencyKey: string,
    attempts: number,
    statusCode?: number
  ) {
    super(message);
    this.name = "AgentRequestError";
    this.idempotencyKey = idempotencyKey;
    this.attempts = attempts;
    this.statusCode = statusCode;
  }
}

interface QueryEnvelope<T = unknown> {
  result: T;
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignalLike;
  }
) => Promise<FetchResponseLike>;

const RETRIABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const obj = value as Record<string, unknown>;
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = canonicalize(obj[key]);
      return acc;
    }, {});
}

/**
 * Generates universally unique string determining an idempotent request based on its data payload.
 *
 * @param input - The payload and namespace for the key.
 * @returns The generated idempotency key.
 */
export function generateIdempotencyKey({
  namespace,
  payload,
  clientRequestId,
}: IdempotencyKeyInput): string {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex")
    .slice(0, 24);

  const requestId = clientRequestId ?? randomUUID();
  return `${namespace}:${fingerprint}:${requestId}`;
}

/**
 * Specific idempotency key generator for BTC-Stellar swaps.
 *
 * @param request - The swap request payload.
 * @param clientRequestId - Optional client-provided request ID.
 * @returns The generated idempotency key.
 */
export function createBtcToStellarSwapIdempotencyKey(
  request: CrossChainSwapRequest,
  clientRequestId?: string
): string {
  return generateIdempotencyKey({
    namespace: "swap-btc-stellar",
    payload: request,
    clientRequestId,
  });
}

function toSwapQuery(request: CrossChainSwapRequest): string {
  return [
    `Swap ${request.amount} ${request.fromToken}`,
    `from ${request.fromChain}`,
    `to ${request.toToken} on ${request.toChain}`,
    `for destination ${request.destinationAddress}`,
  ].join(" ");
}

function createTimedSignal(
  timeoutMs: number,
  externalSignal?: AbortSignalLike
) {
  const controller = new AbortController() as unknown as AbortControllerLike;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener?.("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

/**
 * Client for interacting with the Chen Pilot AI Agent backend.
 * Provides resilient querying with retries and timeout controls.
 */
export class AgentClient {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxRetries: number;
  private readonly defaultRetryDelayMs: number;
  private readonly fetchFn: FetchLike;

  constructor(options: AgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15_000;
    this.defaultMaxRetries = options.defaultMaxRetries ?? 3;
    this.defaultRetryDelayMs = options.defaultRetryDelayMs ?? 500;
    const runtimeFetch = (globalThis as unknown as { fetch?: FetchLike }).fetch;
    const selectedFetch = options.fetchFn ?? runtimeFetch;

    if (!selectedFetch) {
      throw new Error("No fetch implementation available for AgentClient");
    }

    this.fetchFn = selectedFetch;
  }

  /**
   * Sends a parameterized query to the AI Agent backend.
   *
   * @param request - The query parameters.
   * @returns A promise resolving to the agent's response.
   */
  async query<T = AgentResponse>(
    request: AgentQueryRequest
  ): Promise<AgentQueryResult<T>> {
    const idempotencyKey =
      request.idempotencyKey ??
      generateIdempotencyKey({
        namespace: "agent-query",
        payload: {
          userId: request.userId,
          query: request.query,
        },
      });

    const maxRetries = request.maxRetries ?? this.defaultMaxRetries;
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const retryDelayMs = request.retryDelayMs ?? this.defaultRetryDelayMs;

    let attempts = 0;
    let lastErrorMessage = "Request failed";
    let lastStatusCode: number | undefined;

    while (attempts < maxRetries) {
      attempts += 1;
      const timedSignal = createTimedSignal(timeoutMs, request.signal);

      try {
        const response = await this.fetchFn(`${this.baseUrl}/query`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            userId: request.userId,
            query: request.query,
          }),
          signal: timedSignal.signal,
        });

        if (!response.ok) {
          lastStatusCode = response.status;
          const body = await response.text().catch(() => "");
          const message = body || `HTTP ${response.status}`;

          if (
            !RETRIABLE_STATUS_CODES.has(response.status) ||
            attempts >= maxRetries
          ) {
            throw new AgentRequestError(
              `Agent query failed: ${message}`,
              idempotencyKey,
              attempts,
              response.status
            );
          }

          lastErrorMessage = `Agent query failed: ${message}`;
          await sleep(retryDelayMs * attempts);
          continue;
        }

        const parsed = (await response.json()) as QueryEnvelope<T>;
        return {
          idempotencyKey,
          attempts,
          result: parsed.result,
        };
      } catch (error) {
        const isAbort =
          error instanceof Error &&
          (error.name === "AbortError" || error.message.includes("aborted"));
        const isNetwork =
          error instanceof TypeError ||
          (error instanceof Error &&
            error.message.toLowerCase().includes("network"));

        if (error instanceof AgentRequestError) {
          throw error;
        }

        lastErrorMessage =
          error instanceof Error ? error.message : String(error);

        if (!(isAbort || isNetwork) || attempts >= maxRetries) {
          throw new AgentRequestError(
            `Agent query failed: ${lastErrorMessage}`,
            idempotencyKey,
            attempts,
            lastStatusCode
          );
        }

        await sleep(retryDelayMs * attempts);
      } finally {
        timedSignal.clear();
      }
    }

    throw new AgentRequestError(
      `Agent query failed: ${lastErrorMessage}`,
      idempotencyKey,
      attempts,
      lastStatusCode
    );
  }

  /**
   * High-level utility to request a cross-chain swap from BTC to Stellar.
   *
   * @param swapRequest - Details about the swap token pair and amount.
   * @param options - Execution options including signals and timeouts.
   * @returns A promise resolving to the swap execution response.
   */
  async executeBtcToStellarSwap<T = AgentResponse>(
    swapRequest: CrossChainSwapRequest,
    options: ExecuteBtcToStellarSwapOptions
  ): Promise<AgentQueryResult<T>> {
    if (
      swapRequest.fromChain !== ChainId.BITCOIN ||
      swapRequest.toChain !== ChainId.STELLAR
    ) {
      throw new Error(
        "executeBtcToStellarSwap only supports fromChain=bitcoin and toChain=stellar"
      );
    }

    const idempotencyKey =
      options.idempotencyKey ??
      createBtcToStellarSwapIdempotencyKey(swapRequest);

    return this.query<T>({
      userId: options.userId,
      query: toSwapQuery(swapRequest),
      idempotencyKey,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      signal: options.signal,
    });
  }
}
