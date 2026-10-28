/**
 * Public error-mapping contract tests (#1047).
 *
 * The SDK exposes a stable taxonomy of {@link SdkErrorCode}s and maps backend
 * failures onto it. These tests fail when a code is added without a mapping or
 * an explicit policy, so the mapping cannot drift silently.
 */

import { ErrorRegistry, SdkErrorCode } from "../errorRegistry";
import {
  BACKEND_ERROR_MAPPINGS,
  BackendErrorCode,
  HTTP_STATUS_TO_SDK_CODE,
  SDK_NATIVE_ERROR_CODES,
  categoryForBackendCode,
  mapBackendError,
} from "../errorMapping";
import { SdkError } from "../errors";

describe("public error-mapping contract (#1047)", () => {
  describe("enumeration", () => {
    it("maps every backend ApiErrorCode", () => {
      const backendCodes = Object.values(BackendErrorCode);
      const mapped = Object.keys(BACKEND_ERROR_MAPPINGS);

      // No backend code left unmapped…
      const missing = backendCodes.filter((c) => !(c in BACKEND_ERROR_MAPPINGS));
      expect(missing).toEqual([]);

      // …and no mapping entry for a code the backend does not define.
      const extra = mapped.filter(
        (c) => !backendCodes.includes(c as BackendErrorCode)
      );
      expect(extra).toEqual([]);
    });

    it("every mapping target is a registered SDK code or explicit passthrough", () => {
      for (const [backendCode, mapping] of Object.entries(
        BACKEND_ERROR_MAPPINGS
      )) {
        if (mapping.mapsTo === "passthrough") continue;
        expect(ErrorRegistry.has(mapping.mapsTo)).toBe(true);
        expect(mapping.rationale.length).toBeGreaterThan(0);
        expect(`${backendCode}: ${mapping.rationale}`).toBeTruthy();
      }
    });

    it("every HTTP fallback target is a registered SDK code", () => {
      for (const code of Object.values(HTTP_STATUS_TO_SDK_CODE)) {
        expect(ErrorRegistry.has(code)).toBe(true);
      }
    });
  });

  describe("coverage: no registry code is forgotten", () => {
    it("every public SDK error code is reachable via a mapping, fallback, or declared native", () => {
      const mappedTargets = new Set<string>(
        Object.values(BACKEND_ERROR_MAPPINGS)
          .map((m) => m.mapsTo)
          .filter((t): t is SdkErrorCode => t !== "passthrough")
      );
      const fallbackTargets = new Set<string>(
        Object.values(HTTP_STATUS_TO_SDK_CODE)
      );
      const native = new Set<string>(SDK_NATIVE_ERROR_CODES);

      const unhandled = (ErrorRegistry.codes() as SdkErrorCode[]).filter(
        (code) =>
          !mappedTargets.has(code) &&
          !fallbackTargets.has(code) &&
          !native.has(code)
      );

      // If this fails, a new SdkErrorCode was added without either mapping it
      // from a backend code or declaring it in SDK_NATIVE_ERROR_CODES.
      expect(unhandled).toEqual([]);
    });

    it("SDK_NATIVE_ERROR_CODES contains only registered codes and no duplicates", () => {
      const seen = new Set<string>();
      for (const code of SDK_NATIVE_ERROR_CODES) {
        expect(ErrorRegistry.has(code)).toBe(true);
        expect(seen.has(code)).toBe(false);
        seen.add(code);
      }
    });
  });

  describe("the contract fails fast when a code is unhandled", () => {
    // Simulate the guard logic against an intentionally incomplete mapping to
    // prove the coverage check actually catches drift (boundary case).
    function findUnhandled(
      codes: string[],
      mappings: Record<string, { mapsTo: string }>,
      fallbacks: Record<number, string>,
      native: readonly string[]
    ): string[] {
      const mapped = new Set(
        Object.values(mappings)
          .map((m) => m.mapsTo)
          .filter((t) => t !== "passthrough")
      );
      const fallback = new Set(Object.values(fallbacks));
      const nativeSet = new Set<string>(native);
      return codes.filter(
        (c) => !mapped.has(c) && !fallback.has(c) && !nativeSet.has(c)
      );
    }

    it("detects a brand-new code with no mapping", () => {
      const unhandled = findUnhandled(
        ["SOME_NEW_CODE"],
        BACKEND_ERROR_MAPPINGS,
        HTTP_STATUS_TO_SDK_CODE,
        SDK_NATIVE_ERROR_CODES
      );
      expect(unhandled).toEqual(["SOME_NEW_CODE"]);
    });

    it("accepts a new code once it is declared native or mapped", () => {
      expect(
        findUnhandled(
          ["SOME_NEW_CODE"],
          BACKEND_ERROR_MAPPINGS,
          HTTP_STATUS_TO_SDK_CODE,
          [...SDK_NATIVE_ERROR_CODES, "SOME_NEW_CODE"]
        )
      ).toEqual([]);
    });
  });

  describe("mapBackendError translates and preserves context", () => {
    it("maps a known backend code to its registered SDK code", () => {
      const { error, code, passedThrough } = mapBackendError({
        backendCode: BackendErrorCode.RATE_LIMITED,
        status: 429,
        message: "slow down",
      });
      expect(error).toBeInstanceOf(SdkError);
      expect(code).toBe("RATE_LIMITED");
      expect(passedThrough).toBe(false);
      expect(error.code).toBe("RATE_LIMITED");
      expect(error.message).toBe("slow down");
      expect(error.recoverable).toBe(true);
      expect(error.details).toMatchObject({
        backendCode: "RATE_LIMITED",
        httpStatus: 429,
      });
    });

    it("falls back to HTTP status when the backend code is unknown", () => {
      const { error, code } = mapBackendError({
        backendCode: "TOTALLY_UNKNOWN_CODE",
        status: 401,
      });
      expect(code).toBe("UNAUTHORIZED");
      expect(error.code).toBe("UNAUTHORIZED");
      // The original code is preserved for observability.
      expect(error.details).toMatchObject({
        backendCode: "TOTALLY_UNKNOWN_CODE",
        httpStatus: 401,
      });
    });

    it("passes through (as TRANSPORT_ERROR) when neither code nor status is known", () => {
      const { error, code, passedThrough } = mapBackendError({
        backendCode: "MYSTERY",
      });
      expect(code).toBe("TRANSPORT_ERROR");
      expect(passedThrough).toBe(true);
      expect(error.details).toMatchObject({ backendCode: "MYSTERY" });
    });

    it("never produces an unregistered code for any backend code + status pair", () => {
      const statuses = [undefined, 400, 401, 403, 404, 409, 418, 429, 500, 503];
      for (const backendCode of Object.values(BackendErrorCode)) {
        for (const status of statuses) {
          const { code } = mapBackendError({ backendCode, status });
          expect(ErrorRegistry.has(code)).toBe(true);
        }
      }
    });

    it("exposes the category for a mapped backend code", () => {
      expect(categoryForBackendCode(BackendErrorCode.UNAUTHORIZED)).toBe(
        ErrorRegistry.get("UNAUTHORIZED")?.category
      );
      expect(categoryForBackendCode("NOPE")).toBeUndefined();
    });
  });
});
