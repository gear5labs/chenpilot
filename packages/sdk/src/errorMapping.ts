/**
 * Public backend → SDK error mapping contract (#1047).
 *
 * The backend returns machine-readable `ApiErrorCode`s in its canonical error
 * envelope (see `docs/PLATFORM_VALIDATION_CONTRACTS.md` and
 * `src/contracts/errorContract.ts`). The SDK translates those, plus raw HTTP
 * statuses, into its own registered {@link SdkErrorCode}s so consumers can
 * branch on a single stable taxonomy no matter which layer failed.
 *
 * Why a dedicated module:
 *  - The mapping can otherwise drift silently as new backend codes are added.
 *  - Every backend code is required to have either an explicit mapping or an
 *    explicit passthrough policy (`"passthrough"`), so an unmapped code is a
 *    test failure rather than a surprise at runtime.
 *  - SDK-native codes with no backend counterpart are declared here too, so the
 *    contract test can prove they are intentionally reachable without a mapping.
 *
 * Keep {@link BACKEND_ERROR_MAPPINGS} in sync with `ApiErrorCode`; run
 * `errorMappingContract.test.ts` after any backend error-contract change.
 */

import { ErrorCategory, SdkError } from "./errors";
import { ErrorRegistry, SdkErrorCode } from "./errorRegistry";

// ─── Backend error codes (mirror of backend ApiErrorCode) ─────────────────────

/**
 * Machine-readable error codes the backend can return. Mirrors the backend's
 * `ApiErrorCode` enum (`src/contracts/errorContract.ts`); the SDK is published
 * independently, so this is a deliberate local mirror rather than an import.
 */
export enum BackendErrorCode {
  // 4xx
  BAD_REQUEST = "BAD_REQUEST",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  GONE = "GONE",
  RATE_LIMITED = "RATE_LIMITED",
  // 5xx
  INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
  BAD_GATEWAY = "BAD_GATEWAY",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  // Domain-specific
  MISSING_FIELD = "MISSING_FIELD",
  DUPLICATE_ENTRY = "DUPLICATE_ENTRY",
  INVALID_REFERENCE = "INVALID_REFERENCE",
  VALUE_TOO_LONG = "VALUE_TOO_LONG",
  INVALID_DATE_FORMAT = "INVALID_DATE_FORMAT",
  INVALID_INPUT_FORMAT = "INVALID_INPUT_FORMAT",
  CONSTRAINT_VIOLATION = "CONSTRAINT_VIOLATION",
  UNSUPPORTED_OPERATION = "UNSUPPORTED_OPERATION",
  DEPENDENCY_FAILURE = "DEPENDENCY_FAILURE",
}

/**
 * A mapping entry: either translate to a registered SDK code, or explicitly
 * pass the backend code through unchanged (preserved in `details.backendCode`).
 *
 * `"passthrough"` is not a silent default — it is an explicit decision that the
 * backend code has no better SDK equivalent and should stay observable as-is.
 */
export type ErrorMappingTarget = SdkErrorCode | "passthrough";

export interface ErrorMapping {
  /** SDK code raised for this backend code (or explicit passthrough). */
  readonly mapsTo: ErrorMappingTarget;
  /** Human-readable justification, surfaced in the contract test output. */
  readonly rationale: string;
}

/**
 * The contract: every backend `ApiErrorCode` has an entry here. Missing or
 * extra entries fail `errorMappingContract.test.ts`.
 */
export const BACKEND_ERROR_MAPPINGS: Record<BackendErrorCode, ErrorMapping> = {
  [BackendErrorCode.BAD_REQUEST]: {
    mapsTo: "VALIDATION_ERROR",
    rationale: "Malformed request rejected before domain logic runs.",
  },
  [BackendErrorCode.VALIDATION_ERROR]: {
    mapsTo: "VALIDATION_ERROR",
    rationale: "Field/body validation failure.",
  },
  [BackendErrorCode.UNAUTHORIZED]: {
    mapsTo: "UNAUTHORIZED",
    rationale: "Missing or invalid credentials.",
  },
  [BackendErrorCode.FORBIDDEN]: {
    mapsTo: "POLICY_VIOLATION",
    rationale: "Authenticated but not permitted: a policy decision.",
  },
  [BackendErrorCode.NOT_FOUND]: {
    mapsTo: "METADATA_NOT_FOUND",
    rationale: "Requested resource is absent.",
  },
  [BackendErrorCode.CONFLICT]: {
    mapsTo: "EXECUTION_ERROR",
    rationale: "State conflict (e.g. concurrent write) blocks execution.",
  },
  [BackendErrorCode.GONE]: {
    mapsTo: "METADATA_NOT_FOUND",
    rationale: "Resource existed but is permanently removed.",
  },
  [BackendErrorCode.RATE_LIMITED]: {
    mapsTo: "RATE_LIMITED",
    rationale: "Throttled by the backend; retry after a delay.",
  },
  [BackendErrorCode.INTERNAL_SERVER_ERROR]: {
    mapsTo: "EXECUTION_ERROR",
    rationale: "Unhandled backend fault.",
  },
  [BackendErrorCode.NOT_IMPLEMENTED]: {
    mapsTo: "UNSUPPORTED_OPERATION",
    rationale: "Endpoint/operation not provided by this backend version.",
  },
  [BackendErrorCode.BAD_GATEWAY]: {
    mapsTo: "TRANSPORT_ERROR",
    rationale: "Upstream dependency returned an invalid response.",
  },
  [BackendErrorCode.SERVICE_UNAVAILABLE]: {
    mapsTo: "TRANSPORT_ERROR",
    rationale: "Backend temporarily unavailable; retryable transport failure.",
  },
  [BackendErrorCode.MISSING_FIELD]: {
    mapsTo: "MISSING_FIELD",
    rationale: "A required field was omitted.",
  },
  [BackendErrorCode.DUPLICATE_ENTRY]: {
    mapsTo: "EXECUTION_ERROR",
    rationale: "Uniqueness constraint violated on write.",
  },
  [BackendErrorCode.INVALID_REFERENCE]: {
    mapsTo: "VALIDATION_ERROR",
    rationale: "Referenced entity does not exist.",
  },
  [BackendErrorCode.VALUE_TOO_LONG]: {
    mapsTo: "VALIDATION_ERROR",
    rationale: "A value exceeded its length constraint.",
  },
  [BackendErrorCode.INVALID_DATE_FORMAT]: {
    mapsTo: "VALIDATION_ERROR",
    rationale: "Date string could not be parsed.",
  },
  [BackendErrorCode.INVALID_INPUT_FORMAT]: {
    mapsTo: "VALIDATION_ERROR",
    rationale: "Input did not match the expected format.",
  },
  [BackendErrorCode.CONSTRAINT_VIOLATION]: {
    mapsTo: "VALIDATION_ERROR",
    rationale: "Cross-field/domain constraint rejected the input.",
  },
  [BackendErrorCode.UNSUPPORTED_OPERATION]: {
    mapsTo: "UNSUPPORTED_OPERATION",
    rationale: "Operation is known but not supported in this context.",
  },
  [BackendErrorCode.DEPENDENCY_FAILURE]: {
    mapsTo: "TRANSPORT_ERROR",
    rationale: "A downstream dependency failed transiently.",
  },
};

// ─── HTTP status → SDK code (transport fallback) ──────────────────────────────

/**
 * Fallback mapping when the backend returns a bare HTTP status without a
 * structured `ApiErrorCode`. Kept separate from `categorizeHttpStatus` (which
 * yields a coarse {@link ErrorCategory} for retry decisions).
 */
export const HTTP_STATUS_TO_SDK_CODE: Record<number, SdkErrorCode> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "POLICY_VIOLATION",
  404: "METADATA_NOT_FOUND",
  409: "EXECUTION_ERROR",
  410: "METADATA_NOT_FOUND",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  500: "EXECUTION_ERROR",
  501: "UNSUPPORTED_OPERATION",
  502: "TRANSPORT_ERROR",
  503: "TRANSPORT_ERROR",
  504: "TRANSPORT_ERROR",
};

/**
 * SDK-native codes that have **no** backend counterpart and are therefore not
 * part of {@link BACKEND_ERROR_MAPPINGS}. Declaring them here lets the contract
 * test assert every registry code is either mapped from a backend code or
 * explicitly acknowledged as SDK-native (rather than forgotten).
 */
export const SDK_NATIVE_ERROR_CODES: readonly SdkErrorCode[] = [
  "CONNECTION_TIMEOUT",
  "NETWORK_ERROR",
  "INVALID_INPUT",
  "SIMULATION_ERROR",
  "COMPATIBILITY_ERROR",
  "UNSUPPORTED_CHAIN",
  "SIGNING_ERROR",
  "INSUFFICIENT_FUNDS",
  "AGENT_SESSION_EXPIRED",
  "AGENT_REQUEST_ABORTED",
  "AGENT_BAD_RESPONSE",
  "METADATA_FETCH_FAILED",
  "WALLET_PROVIDER_UNAVAILABLE",
  "WALLET_USER_REJECTED",
  "WALLET_SIGNATURE_INVALID",
  "TRUSTLINE_NOT_FOUND",
  "TRUSTLINE_NONZERO_BALANCE",
  "SOROBAN_RPC_ERROR",
  "SOROBAN_TX_NOT_FOUND",
  "SOROBAN_DECODE_ERROR",
  "CONTRACT_ERROR",
  "TX_BUILD_FAILED",
  "TX_SIMULATION_FAILED",
  "TX_SUBMISSION_FAILED",
  "TX_FEE_TOO_LOW",
  "CONTRACT_NOT_REGISTERED",
  "CONTRACT_VERSION_UNSUPPORTED",
  "CAPABILITY_UNSUPPORTED",
  "EVENT_DECODER_NOT_FOUND",
  "EVENT_DECODE_FAILED",
];

// ─── Mapping application ──────────────────────────────────────────────────────

export interface MapBackendErrorInput {
  /** Structured backend code, when the backend supplied one. */
  backendCode?: string;
  /** HTTP status, used as a fallback when `backendCode` is missing/unknown. */
  status?: number;
  /** Human-readable message to preserve on the resulting error. */
  message?: string;
  /** Extra structured details to attach. */
  details?: Record<string, unknown>;
  /** Underlying cause. */
  cause?: unknown;
}

export interface MappedBackendError {
  error: SdkError;
  /** The SDK code actually used (useful for assertions/telemetry). */
  code: SdkErrorCode;
  /** True when the backend code was preserved verbatim in `details`. */
  passedThrough: boolean;
}

/**
 * Translate a backend failure into a registered {@link SdkError}.
 *
 * Resolution order:
 *  1. Known {@link BackendErrorCode} → its mapped SDK code (or passthrough).
 *  2. Unknown backend code → HTTP status fallback (if provided).
 *  3. Unknown backend code, no status → explicit passthrough as
 *     `TRANSPORT_ERROR`, preserving the original code in `details.backendCode`.
 */
export function mapBackendError(
  input: MapBackendErrorInput
): MappedBackendError {
  const { backendCode, status, message, details = {}, cause } = input;

  const known = backendCode
    ? BACKEND_ERROR_MAPPINGS[backendCode as BackendErrorCode]
    : undefined;

  const baseDetails: Record<string, unknown> = {
    ...details,
    ...(backendCode ? { backendCode } : {}),
    ...(status !== undefined ? { httpStatus: status } : {}),
  };

  if (known && known.mapsTo !== "passthrough") {
    const def = ErrorRegistry.require(known.mapsTo);
    return {
      error: new SdkError({
        category: def.category,
        code: def.code,
        message: message ?? def.message,
        recoverable: def.recoverable,
        details: baseDetails,
        cause,
      }),
      code: known.mapsTo,
      passedThrough: false,
    };
  }

  if (known && known.mapsTo === "passthrough") {
    // No SDK equivalent; surface as a transport error while keeping the
    // backend code observable. (Currently no code selects this branch, but the
    // policy is part of the contract and future codes may use it.)
    const def = ErrorRegistry.require("TRANSPORT_ERROR");
    return {
      error: new SdkError({
        category: def.category,
        code: def.code,
        message: message ?? def.message,
        recoverable: def.recoverable,
        details: baseDetails,
        cause,
      }),
      code: "TRANSPORT_ERROR",
      passedThrough: true,
    };
  }

  if (status !== undefined && HTTP_STATUS_TO_SDK_CODE[status]) {
    const code = HTTP_STATUS_TO_SDK_CODE[status];
    const def = ErrorRegistry.require(code);
    return {
      error: new SdkError({
        category: def.category,
        code: def.code,
        message: message ?? def.message,
        recoverable: def.recoverable,
        details: baseDetails,
        cause,
      }),
      code,
      passedThrough: false,
    };
  }

  // Unknown code with no usable status: passthrough as a transport error.
  const def = ErrorRegistry.require("TRANSPORT_ERROR");
  return {
    error: new SdkError({
      category: def.category,
      code: def.code,
      message: message ?? def.message,
      recoverable: def.recoverable,
      details: baseDetails,
      cause,
    }),
    code: "TRANSPORT_ERROR",
    passedThrough: true,
  };
}

/**
 * Category advertised by the backend mapping for a given backend code. Used by
 * consumers that only need the coarse taxonomy.
 */
export function categoryForBackendCode(code: string): ErrorCategory | undefined {
  const mapping = BACKEND_ERROR_MAPPINGS[code as BackendErrorCode];
  if (!mapping || mapping.mapsTo === "passthrough") return undefined;
  return ErrorRegistry.get(mapping.mapsTo)?.category;
}
