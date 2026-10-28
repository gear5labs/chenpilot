/**
 * Tests for error redaction utilities.
 *
 * Verifies that secret values are properly redacted from error objects
 * before they reach logs or API responses.
 */

import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  serializeErrorWithRedaction,
  redactField,
  REDACTED,
} from "../errorRedaction";

describe("errorRedaction", () => {
  describe("redactSecrets", () => {
    it("should redact fields matching sensitive patterns", () => {
      const obj = {
        username: "john",
        password: "secret123",
        apiKey: "sk-1234567890abcdef",
        normalField: "normal-value",
      };

      const result = redactSecrets(obj);

      expect(result.username).toBe("john");
      expect(result.password).toBe(REDACTED);
      expect(result.apiKey).toBe(REDACTED);
      expect(result.normalField).toBe("normal-value");
    });

    it("should redact nested objects", () => {
      const obj = {
        user: {
          name: "john",
          credentials: {
            token: "secret-token",
            id: "user-123",
          },
        },
      };

      const result = redactSecrets(obj);

      expect(result.user.name).toBe("john");
      expect(result.user.credentials.token).toBe(REDACTED);
      expect(result.user.credentials.id).toBe("user-123");
    });

    it("should redact arrays of objects", () => {
      const obj = {
        items: [
          { id: 1, secret: "value1" },
          { id: 2, secret: "value2" },
        ],
      };

      const result = redactSecrets(obj);

      expect(result.items[0].id).toBe(1);
      expect(result.items[0].secret).toBe(REDACTED);
      expect(result.items[1].id).toBe(2);
      expect(result.items[1].secret).toBe(REDACTED);
    });

    it("should redact authorization header values", () => {
      const obj = {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret-token-123",
        },
      };

      const result = redactSecrets(obj);

      expect(result.headers["Content-Type"]).toBe("application/json");
      expect(result.headers.Authorization).toBe(REDACTED);
    });

    it("should redact value patterns that look like secrets", () => {
      const obj = {
        someField: "Bearer sk-1234567890abcdef1234567890abcdef",
        shortField: "abc",
      };

      const result = redactSecrets(obj);

      expect(result.someField).toBe(REDACTED);
      expect(result.shortField).toBe("abc");
    });

    it("should handle Error objects", () => {
      const error = new Error("Test error");
      (error as Record<string, unknown>).apiKey = "secret-key";
      (error as Record<string, unknown>).userId = "user-123";

      const result = redactSecrets(error);

      expect(result.message).toBe("Test error");
      expect((result as Record<string, unknown>).apiKey).toBe(REDACTED);
      expect((result as Record<string, unknown>).userId).toBe("user-123");
    });

    it("should handle null and undefined", () => {
      expect(redactSecrets(null)).toBe(null);
      expect(redactSecrets(undefined)).toBe(undefined);
    });

    it("should handle primitives", () => {
      expect(redactSecrets("string")).toBe("string");
      expect(redactSecrets(123)).toBe(123);
      expect(redactSecrets(true)).toBe(true);
    });

    it("should prevent infinite recursion with circular references", () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;

      const result = redactSecrets(obj);

      expect(result.a).toBe(1);
      expect(result.self).toBeDefined();
    });

    it("should respect max depth limit", () => {
      const obj = { level1: { level2: { level3: { level4: "deep" } } } };
      const result = redactSecrets(obj);

      expect(result.level1.level2.level3.level4).toBe("deep");
    });
  });

  describe("serializeErrorWithRedaction", () => {
    it("should serialize error with secrets redacted", () => {
      const error = new Error("API failure");
      (error as Record<string, unknown>).apiKey = "sk-secret";
      (error as Record<string, unknown>).userId = "user-123";

      const serialized = serializeErrorWithRedaction(error);
      const parsed = JSON.parse(serialized);

      expect(parsed.message).toBe("API failure");
      expect(parsed.apiKey).toBe(REDACTED);
      expect(parsed.userId).toBe("user-123");
    });

    it("should produce valid JSON", () => {
      const error = { apiKey: "secret", data: { token: "value" } };
      const serialized = serializeErrorWithRedaction(error);

      expect(() => JSON.parse(serialized)).not.toThrow();
    });
  });

  describe("redactField", () => {
    it("should redact a specific sensitive field", () => {
      const obj = { apiKey: "secret-key", username: "john" };
      const result = redactField(obj, "apiKey");

      expect(result.apiKey).toBe(REDACTED);
      expect(result.username).toBe("john");
    });

    it("should not redact non-sensitive fields", () => {
      const obj = { username: "john", email: "john@example.com" };
      const result = redactField(obj, "username");

      expect(result.username).toBe("john");
      expect(result.email).toBe("john@example.com");
    });

    it("should handle missing fields", () => {
      const obj = { username: "john" };
      const result = redactField(obj, "apiKey");

      expect(result.username).toBe("john");
    });
  });

  describe("provider message redaction", () => {
    it("should redact nested provider error messages with secrets", () => {
      const providerError = {
        provider: "openai",
        error: {
          message: "Invalid API key",
          details: {
            apiKey: "sk-1234567890abcdef",
            endpoint: "https://api.openai.com",
          },
        },
      };

      const result = redactSecrets(providerError);

      expect(result.provider).toBe("openai");
      expect(result.error.message).toBe("Invalid API key");
      expect(result.error.details.apiKey).toBe(REDACTED);
      expect(result.error.details.endpoint).toBe("https://api.openai.com");
    });

    it("should redact secrets in deeply nested structures", () => {
      const error = {
        route: {
          adapter: {
            config: {
              credentials: {
                secret: "top-secret",
                token: "auth-token",
              },
            },
          },
        },
      };

      const result = redactSecrets(error);

      expect(result.route.adapter.config.credentials.secret).toBe(REDACTED);
      expect(result.route.adapter.config.credentials.token).toBe(REDACTED);
    });
  });

  describe("boundary cases", () => {
    it("should handle empty objects", () => {
      const result = redactSecrets({});
      expect(result).toEqual({});
    });

    it("should handle empty arrays", () => {
      const result = redactSecrets([]);
      expect(result).toEqual([]);
    });

    it("should handle strings that look like secrets but are short", () => {
      const result = redactSecrets("abc");
      expect(result).toBe("abc");
    });

    it("should not redact normal hex strings that are too short", () => {
      const result = redactSecrets("abc123");
      expect(result).toBe("abc123");
    });

    it("should redact long hex strings", () => {
      const result = redactSecrets("a".repeat(32));
      expect(result).toBe(REDACTED);
    });
  });
});
