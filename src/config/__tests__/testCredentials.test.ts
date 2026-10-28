/**
 * Tests for production credential validation.
 *
 * Verifies that known placeholder/test credentials are rejected in production
 * to prevent accidental deployment with test fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("Production Credential Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset to clean state before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("production mode", () => {
    it("should reject known placeholder JWT_SECRET in production", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "secret-token";
      process.env.ANTHROPIC_API_KEY = "sk-ant-valid-key";
      process.env.ENCRYPTION_KEY = "0".repeat(64);
      process.env.DB_HOST = "localhost";
      process.env.DB_USERNAME = "user";
      process.env.DB_NAME = "db";
      process.env.NODE_URL = "http://localhost:3000";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "Security violation: JWT_SECRET contains a known placeholder/test value"
      );
    });

    it("should reject test-anthropic-key in production", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "a".repeat(32);
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      process.env.ENCRYPTION_KEY = "0".repeat(64);
      process.env.DB_HOST = "localhost";
      process.env.DB_USERNAME = "user";
      process.env.DB_NAME = "db";
      process.env.NODE_URL = "http://localhost:3000";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "Security violation: ANTHROPIC_API_KEY contains a known placeholder/test value"
      );
    });

    it("should reject default-dev-signing-key in production", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "a".repeat(32);
      process.env.ANTHROPIC_API_KEY = "sk-ant-valid-key";
      process.env.ENCRYPTION_KEY = "0".repeat(64);
      process.env.CAPABILITY_SECRET_KEY = "default-dev-signing-key";
      process.env.DB_HOST = "localhost";
      process.env.DB_USERNAME = "user";
      process.env.DB_NAME = "db";
      process.env.NODE_URL = "http://localhost:3000";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "Security violation: CAPABILITY_SECRET_KEY contains a known placeholder/test value"
      );
    });

    it("should reject chenpilot-capability-secret-key-default-2026 in production", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "a".repeat(32);
      process.env.ANTHROPIC_API_KEY = "sk-ant-valid-key";
      process.env.ENCRYPTION_KEY = "0".repeat(64);
      process.env.CAPABILITY_SECRET_KEY = "chenpilot-capability-secret-key-default-2026";
      process.env.DB_HOST = "localhost";
      process.env.DB_USERNAME = "user";
      process.env.DB_NAME = "db";
      process.env.NODE_URL = "http://localhost:3000";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "Security violation: CAPABILITY_SECRET_KEY contains a known placeholder/test value"
      );
    });

    it("should reject hex placeholder in ENCRYPTION_KEY in production", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "a".repeat(32);
      process.env.ANTHROPIC_API_KEY = "sk-ant-valid-key";
      process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      process.env.DB_HOST = "localhost";
      process.env.DB_USERNAME = "user";
      process.env.DB_NAME = "db";
      process.env.NODE_URL = "http://localhost:3000";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "Security violation: ENCRYPTION_KEY contains a known placeholder/test value"
      );
    });

    it("should accept valid production credentials", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "a".repeat(32);
      process.env.ANTHROPIC_API_KEY = "sk-ant-valid-production-key";
      process.env.ENCRYPTION_KEY = "0".repeat(64);
      process.env.DB_HOST = "localhost";
      process.env.DB_USERNAME = "user";
      process.env.DB_NAME = "db";
      process.env.NODE_URL = "http://localhost:3000";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });

    it("should not leak the actual placeholder value in error message", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "secret-token";
      process.env.ANTHROPIC_API_KEY = "sk-ant-valid-key";
      process.env.ENCRYPTION_KEY = "0".repeat(64);
      process.env.DB_HOST = "localhost";
      process.env.DB_USERNAME = "user";
      process.env.DB_NAME = "db";
      process.env.NODE_URL = "http://localhost:3000";

      let errorThrown = false;
      try {
        delete require.cache[require.resolve("../config")];
        require("../config");
      } catch (error) {
        errorThrown = true;
        expect((error as Error).message).not.toContain("secret-token");
        expect((error as Error).message).toContain("placeholder/test value");
      }

      expect(errorThrown).toBe(true);
    });
  });

  describe("development mode", () => {
    it("should allow placeholder credentials in development", () => {
      process.env.NODE_ENV = "development";
      process.env.JWT_SECRET = "secret-token";
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      process.env.ENCRYPTION_KEY = "0".repeat(64);
      process.env.DB_HOST = "localhost";
      process.env.DB_USERNAME = "user";
      process.env.DB_NAME = "db";
      process.env.NODE_URL = "http://localhost:3000";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });

    it("should allow placeholder credentials when NODE_ENV is not set", () => {
      delete process.env.NODE_ENV;
      process.env.JWT_SECRET = "secret-token";
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      process.env.ENCRYPTION_KEY = "0".repeat(64);
      process.env.DB_HOST = "localhost";
      process.env.DB_USERNAME = "user";
      process.env.DB_NAME = "db";
      process.env.NODE_URL = "http://localhost:3000";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });
  });

  describe("all known placeholder values", () => {
    const knownPlaceholders = [
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "sk-test-placeholder",
      "test-anthropic-key",
      "mock-anthropic-key-for-test-suite",
      "test-only-jwt-secret-0123456789abcdef",
      "01234567890123456789012345678901",
      "default_test_jwt_secret_32_chars_long_12345",
      "secret-token",
      "default-dev-signing-key",
      "chenpilot-capability-secret-key-default-2026",
    ];

    knownPlaceholders.forEach((placeholder) => {
      it(`should reject placeholder "${placeholder}" in JWT_SECRET in production`, () => {
        process.env.NODE_ENV = "production";
        process.env.JWT_SECRET = placeholder;
        process.env.ANTHROPIC_API_KEY = "sk-ant-valid-key";
        process.env.ENCRYPTION_KEY = "0".repeat(64);
        process.env.DB_HOST = "localhost";
        process.env.DB_USERNAME = "user";
        process.env.DB_NAME = "db";
        process.env.NODE_URL = "http://localhost:3000";

        expect(() => {
          delete require.cache[require.resolve("../config")];
          require("../config");
        }).toThrow(
          "Security violation: JWT_SECRET contains a known placeholder/test value"
        );
      });
    });
  });

  describe("edge cases", () => {
    it("should not validate if sensitive env var is not set", () => {
      process.env.NODE_ENV = "production";
      delete process.env.JWT_SECRET;
      process.env.ANTHROPIC_API_KEY = "sk-ant-valid-key";
      process.env.ENCRYPTION_KEY = "0".repeat(64);
      process.env.DB_HOST = "localhost";
      process.env.DB_USERNAME = "user";
      process.env.DB_NAME = "db";
      process.env.NODE_URL = "http://localhost:3000";

      // Should fail for different reason (missing JWT_SECRET), not placeholder check
      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(); // Will throw for missing JWT_SECRET
    });

    it("should only check sensitive env vars that are set", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "a".repeat(32);
      process.env.ANTHROPIC_API_KEY = "sk-ant-valid-key";
      process.env.ENCRYPTION_KEY = "0".repeat(64);
      // Don't set CAPABILITY_SECRET_KEY, REVOCATION_SIGNING_KEY, SPONSOR_SECRET_KEY
      process.env.DB_HOST = "localhost";
      process.env.DB_USERNAME = "user";
      process.env.DB_NAME = "db";
      process.env.NODE_URL = "http://localhost:3000";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });
  });
});
