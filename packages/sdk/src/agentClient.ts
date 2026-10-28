import { createHash, randomUUID } from "crypto";
import {
  AgentResponse,
  ChainId,
  CrossChainSwapRequest,
  RequestOptions,
  SimulationRequest,
  SimulationResult,
  ExecutionRequest,
  ExecutionResult,
  VaultOperationRequest,
  VaultOperationResult,
  AbortSignalLike,
} from "./types";
import {
  abortableSleep,
  combineSignals,
  isAbortError,
  throwIfAborted,
} from "./abort";
import { ErrorCategory, SdkError } from "./errors";
import { ErrorRegistry, SdkErrorCode } from "./errorRegistry";
import { HTTP_STATUS_TO_SDK_CODE } from "./errorMapping";

export interface IdempotencyKeyInput {
  namespace: string;
  payload: unknown;
  clientRequestId?: string;
}

export interface AgentClientOptions {
  baseUrl: string;
  defaultTimeoutMs?: number;
  defaultMaxRetries?: number;
  defaultRetryDelayMs?: number;
  fetchFn?: FetchLike;
}

export interface AgentQueryRequest {
  userId: string;
  query: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  signal?: AbortSignalLike;
}

export interface AgentQueryResult<T = AgentResponse> {
  idempotencyKey: string;
  attempts: number;
  result: T;
}

export class AgentRequestError extends SdkError {
  readonly idempotencyKey: string;
  readonly attempts: number;
  readonly statusCode?: number;

  constructor(
    message: string,
    idempotencyKey: string,
    attempts: number,
    statusCode?: number
  ) {
    // Resolve a *registered* SDK code rather than inventing `HTTP_<status>` /
    // `AGENT_REQUEST_FAILED` strings that no consumer can switch on. The code
    // comes from the public backend→SDK mapping contract (#1047).
    const code = agentErrorCodeForStatus(statusCode);
    const def = ErrorRegistry.require(code);

    super({
      category: def.category,
      code: def.code,
      message,
      recoverable: def.recoverable,
      details: {
        attempts,
        ...(statusCode !== undefined ? { httpStatus: statusCode } : {}),
      },
    });
    this.name = "AgentRequestError";
    this.idempotencyKey = idempotencyKey;
    this.attempts = attempts;
    this.statusCode = statusCode;
  }
}

/**
 * Raised when the agent returns a 2xx response whose body is not valid JSON.
 *
 * Carries the registered `AGENT_BAD_RESPONSE` code and is never retried: a
 * malformed body will not become well-formed on a subsequent attempt.
 */
export class AgentBadResponseError extends SdkError {
  readonly idempotencyKey: string;
  readonly attempts: number;

  constructor(
    message: string,
    idempotencyKey: string,
    attempts: number,
    cause?: unknown
  ) {
    const def = ErrorRegistry.require("AGENT_BAD_RESPONSE");
    super({
      category: def.category,
      code: def.code,
      message,
      recoverable: false,
      details: { attempts },
      cause,
    });
    this.name = "AgentBadResponseError";
    this.idempotencyKey = idempotencyKey;
    this.attempts = attempts;
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

/**
 * Maps an HTTP status code to a top-level error category.
 *
 * This is the public, consumer-visible mapping from a backend transport
 * failure to an {@link ErrorCategory}. Keep it in sync with the backend error
 * contract (`docs/PLATFORM_VALIDATION_CONTRACTS.md`); the error-mapping
 * contract test enumerates the statuses this must handle.
 */
export function categorizeHttpStatus(status: number): ErrorCategory {
  if (status === 429) return ErrorCategory.POLICY;
  if (status === 400 || status === 422) return ErrorCategory.VALIDATION;
  if (status === 401 || status === 403) return ErrorCategory.POLICY;
  if (status >= 500) return ErrorCategory.EXECUTION;
  return ErrorCategory.TRANSPORT;
}

/**
 * Pick the registered {@link SdkErrorCode} for an agent HTTP failure.
 *
 * Always returns a code present in {@link ErrorRegistry}. A 401 specifically
 * maps to `AGENT_SESSION_EXPIRED` (the agent session must be refreshed) rather
 * than the generic `UNAUTHORIZED`, since agent calls carry a session token.
 */
export function agentErrorCodeForStatus(status?: number): SdkErrorCode {
  if (status === undefined) return "TRANSPORT_ERROR";
  if (status === 401) return "AGENT_SESSION_EXPIRED";
  return HTTP_STATUS_TO_SDK_CODE[status] ?? "TRANSPORT_ERROR";
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

  async query<T = AgentResponse>(
    request: AgentQueryRequest
  ): Promise<AgentQueryResult<T>> {
    // Fail fast (and identically to every other public method) when the caller
    // has already cancelled: no fetch is dispatched, no retry backoff runs.
    throwIfAborted(request.signal);

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
      const timed = combineSignals(timeoutMs, request.signal);

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
          signal: timed.signal as AbortSignalLike,
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
          await abortableSleep(
            retryDelayMs * attempts,
            timed.signal as AbortSignalLike
          );
          continue;
        }

        let parsed: QueryEnvelope<T>;
        try {
          parsed = (await response.json()) as QueryEnvelope<T>;
        } catch (parseError) {
          // A 2xx with an unparseable body is a contract violation by the
          // agent, not a transient network failure: surface AGENT_BAD_RESPONSE
          // immediately instead of retrying.
          const def = ErrorRegistry.require("AGENT_BAD_RESPONSE");
          throw new AgentBadResponseError(
            def.message,
            idempotencyKey,
            attempts,
            parseError
          );
        }

        return {
          idempotencyKey,
          attempts,
          result: parsed.result,
        };
      } catch (error) {
        const isNetwork =
          error instanceof TypeError ||
          (error instanceof Error &&
            error.message.toLowerCase().includes("network"));

        if (
          error instanceof AgentRequestError ||
          error instanceof AgentBadResponseError
        ) {
          throw error;
        }

        // Caller-initiated cancellation (or a timeout) must propagate as an
        // abort error, never be wrapped in AgentRequestError or retried. This
        // keeps the abort contract identical across every public SDK method.
        if (isAbortError(error)) {
          throw error;
        }

        lastErrorMessage =
          error instanceof Error ? error.message : String(error);

        if (!isNetwork || attempts >= maxRetries) {
          throw new AgentRequestError(
            `Agent query failed: ${lastErrorMessage}`,
            idempotencyKey,
            attempts,
            lastStatusCode
          );
        }

        await abortableSleep(
          retryDelayMs * attempts,
          timed.signal as AbortSignalLike
        );
      } finally {
        timed.cleanup();
      }
    }

    throw new AgentRequestError(
      `Agent query failed: ${lastErrorMessage}`,
      idempotencyKey,
      attempts,
      lastStatusCode
    );
  }

  async simulate(
    simulationRequest: SimulationRequest,
    options: RequestOptions
  ): Promise<AgentQueryResult<SimulationResult>> {
    const idempotencyKey =
      options.idempotencyKey ??
      generateIdempotencyKey({
        namespace: "simulation",
        payload: simulationRequest,
      });

    return this.query<SimulationResult>({
      userId: options.userId,
      query: JSON.stringify({ type: "simulate", data: simulationRequest }),
      idempotencyKey,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      signal: options.signal,
    });
  }

  async execute(
    executionRequest: ExecutionRequest,
    options: RequestOptions
  ): Promise<AgentQueryResult<ExecutionResult>> {
    const idempotencyKey =
      options.idempotencyKey ??
      generateIdempotencyKey({
        namespace: "execution",
        payload: executionRequest,
      });

    return this.query<ExecutionResult>({
      userId: options.userId,
      query: JSON.stringify({ type: "execute", data: executionRequest }),
      idempotencyKey,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      signal: options.signal,
    });
  }

  async vaultOperation(
    vaultRequest: VaultOperationRequest,
    options: RequestOptions
  ): Promise<AgentQueryResult<VaultOperationResult>> {
    const idempotencyKey =
      options.idempotencyKey ??
      generateIdempotencyKey({
        namespace: "vault-operation",
        payload: vaultRequest,
      });

    return this.query<VaultOperationResult>({
      userId: options.userId,
      query: JSON.stringify({ type: "vault", data: vaultRequest }),
      idempotencyKey,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      signal: options.signal,
    });
  }

  async executeBtcToStellarSwap<T = AgentResponse>(
    swapRequest: CrossChainSwapRequest,
    options: RequestOptions
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
