/**
 * Tests for CORS configuration validation.
 *
 * Verifies that CORS configuration is properly validated in production
 * to prevent accidental broad origin access.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import config from "../config";

describe("CORS Configuration Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset to clean state before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("production mode", () => {
    it("should reject missing ALLOWED_ORIGINS in production", () => {
      process.env.NODE_ENV = "production";
      delete process.env.ALLOWED_ORIGINS;

      expect(() => {
        // Force re-import by clearing require cache
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "ALLOWED_ORIGINS must be set in production"
      );
    });

    it("should reject wildcard origin in production", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "*";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "ALLOWED_ORIGINS cannot contain wildcard (*) in production"
      );
    });

    it("should reject wildcard in comma-separated list in production", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "https://example.com,*,https://another.com";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "ALLOWED_ORIGINS cannot contain wildcard (*) in production"
      );
    });

    it("should reject empty origin in production", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "https://example.com, ,https://another.com";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "ALLOWED_ORIGINS contains empty origin"
      );
    });

    it("should reject malformed origin in production", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "not-a-valid-url";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "ALLOWED_ORIGINS contains malformed origin 'not-a-valid-url'"
      );
    });

    it("should reject non-http/https protocols in production", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "ftp://example.com";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "ALLOWED_ORIGINS contains invalid protocol 'ftp:'"
      );
    });

    it("should reject origin without hostname in production", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "https://";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "ALLOWED_ORIGINS contains invalid origin 'https://' with no hostname"
      );
    });

    it("should accept valid single origin in production", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "https://example.com";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });

    it("should accept valid multiple origins in production", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "https://example.com,https://app.example.com,https://api.example.com";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });

    it("should accept origins with ports in production", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "https://example.com:3000,http://localhost:8080";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });
  });

  describe("development mode", () => {
    it("should allow missing ALLOWED_ORIGINS in development", () => {
      process.env.NODE_ENV = "development";
      delete process.env.ALLOWED_ORIGINS;

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });

    it("should allow wildcard in development", () => {
      process.env.NODE_ENV = "development";
      process.env.ALLOWED_ORIGINS = "*";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });

    it("should accept valid origins in development", () => {
      process.env.NODE_ENV = "development";
      process.env.ALLOWED_ORIGINS = "https://example.com";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle trailing commas gracefully", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "https://example.com,";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "ALLOWED_ORIGINS contains empty origin"
      );
    });

    it("should handle leading commas gracefully", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = ",https://example.com";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).toThrow(
        "ALLOWED_ORIGINS contains empty origin"
      );
    });

    it("should handle whitespace around origins", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = " https://example.com , https://another.com ";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });

    it("should handle localhost origins", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "http://localhost:3000";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });

    it("should handle IP address origins", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOWED_ORIGINS = "https://192.168.1.1:3000";

      expect(() => {
        delete require.cache[require.resolve("../config")];
        require("../config");
      }).not.toThrow();
    });
  });
});
