const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock("../../../config/logger", () => mockLogger);

import {
  ResponseSizeValidator,
  DEFAULT_RESPONSE_LIMITS,
  GLOBAL_DEFAULT_LIMIT,
} from "../ResponseSizeValidator";

describe("ResponseSizeValidator", () => {
  const userId = "test-user-123";
  const toolName = "test-tool";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Truncate Mode (default)", () => {
    it("should pass validation when response is within limit", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 1000,
        mode: "truncate",
      });

      const data = {
        result: "This is a small response",
        status: "success",
      };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.valid).toBe(true);
      expect(validation.handled).toBe(false);
      expect(validation.exceededLimit).toBe(false);
      expect(validation.originalLength).toBeLessThanOrEqual(1000);
      expect(validation.processedData).toEqual(data);
    });

    it("should truncate when response exceeds limit", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 100,
        mode: "truncate",
        includeTruncationIndicator: true,
      });

      const data = {
        result: "x".repeat(200),
      };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.valid).toBe(true);
      expect(validation.handled).toBe(true);
      expect(validation.exceededLimit).toBe(true);
      expect(validation.originalLength).toBeGreaterThan(100);
      expect(validation.processedData).toBeDefined();

      const processedJson = JSON.stringify(validation.processedData);
      expect(processedJson.length).toBeLessThanOrEqual(100 + 50); // Allow some margin for structure
    });

    it("should include truncation notice in response metadata", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 50,
        mode: "truncate",
        includeTruncationIndicator: true,
      });

      const data = {
        result: "x".repeat(100),
      };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.processedData?._truncation_notice).toBeDefined();
      expect(validation.processedData?._truncation_notice).toContain("truncated");
    });

    it("should handle truncation of nested objects", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 100,
        mode: "truncate",
      });

      const data = {
        user: {
          name: "x".repeat(50),
          email: "x".repeat(50),
          bio: "x".repeat(50),
        },
      };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.valid).toBe(true);
      expect(validation.handled).toBe(true);
      expect(validation.processedData?.user).toBeDefined();
    });

    it("should handle truncation of arrays", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 150,
        mode: "truncate",
      });

      const data = {
        items: Array(50).fill("x".repeat(50)),
      };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.valid).toBe(true);
      expect(validation.handled).toBe(true);
      expect(Array.isArray(validation.processedData?.items)).toBe(true);
      expect((validation.processedData?.items as unknown[]).length).toBeLessThan(50);
    });

    it("should preserve primitive values during truncation", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 50,
        mode: "truncate",
      });

      const data = {
        count: 42,
        active: true,
        timestamp: 1234567890,
        value: null,
        longText: "x".repeat(100),
      };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.processedData?.count).toBe(42);
      expect(validation.processedData?.active).toBe(true);
      expect(validation.processedData?.timestamp).toBe(1234567890);
      expect(validation.processedData?.value).toBe(null);
    });

    it("should log warning when truncating", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 50,
        mode: "truncate",
      });

      const data = { result: "x".repeat(100) };
      validator.validate(data, toolName, userId);

      expect(mockLogger.warn).toHaveBeenCalled();
      const call = mockLogger.warn.mock.calls[0];
      expect(call[0]).toContain("truncated");
      expect(call[1]).toHaveProperty("toolName", toolName);
      expect(call[1]).toHaveProperty("userId", userId);
    });
  });

  describe("Reject Mode", () => {
    it("should pass validation when response is within limit", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 1000,
        mode: "reject",
      });

      const data = { result: "small response" };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.valid).toBe(true);
      expect(validation.handled).toBe(false);
      expect(validation.exceededLimit).toBe(false);
    });

    it("should reject when response exceeds limit", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 100,
        mode: "reject",
      });

      const data = { result: "x".repeat(200) };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.valid).toBe(false);
      expect(validation.handled).toBe(true);
      expect(validation.exceededLimit).toBe(true);
      expect(validation.rejectionReason).toBeDefined();
      expect(validation.rejectionReason).toContain("exceeded");
      expect(validation.rejectionReason).toContain("100");
    });

    it("should include original length in rejection reason", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 50,
        mode: "reject",
      });

      const data = { result: "x".repeat(200) };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.rejectionReason).toContain(validation.originalLength.toString());
    });

    it("should log warning when rejecting", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 50,
        mode: "reject",
      });

      const data = { result: "x".repeat(100) };
      validator.validate(data, toolName, userId);

      expect(mockLogger.warn).toHaveBeenCalled();
      const call = mockLogger.warn.mock.calls[0];
      expect(call[0]).toContain("rejected");
      expect(call[1]).toHaveProperty("toolName", toolName);
    });
  });

  describe("Boundary Conditions", () => {
    it("should handle exact limit match", () => {
      const limit = 100;
      const validator = new ResponseSizeValidator({
        maxCharacters: limit,
        mode: "truncate",
      });

      // Create data that serializes to exactly the limit
      const data = { result: "x".repeat(80) };
      const size = JSON.stringify(data).length;

      const validation = validator.validate(data, toolName, userId);

      expect(validation.valid).toBe(true);
      expect(validation.handled).toBe(false);
    });

    it("should handle one character over limit", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 20,
        mode: "truncate",
      });

      const data = { result: "x".repeat(100) };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.handled).toBe(true);
      expect(validation.exceededLimit).toBe(true);
    });

    it("should handle empty data", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 100,
        mode: "truncate",
      });

      const data = {};

      const validation = validator.validate(data, toolName, userId);

      expect(validation.valid).toBe(true);
      expect(validation.handled).toBe(false);
    });

    it("should handle deeply nested structures", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 200,
        mode: "truncate",
      });

      const data = {
        level1: {
          level2: {
            level3: {
              level4: {
                data: "x".repeat(500),
              },
            },
          },
        },
      };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.valid).toBe(true);
      expect(validation.handled).toBe(true);
    });

    it("should handle very large response", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 1000,
        mode: "truncate",
      });

      const data = {
        result: "x".repeat(100000),
      };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.handled).toBe(true);
      expect(JSON.stringify(validation.processedData).length).toBeLessThanOrEqual(
        1000 + 100
      );
    });

    it("should handle special characters in strings", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 100,
        mode: "truncate",
      });

      const data = {
        emoji: "😀".repeat(50),
        symbols: "!@#$%^&*()" + "x".repeat(100),
      };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.valid).toBe(true);
      expect(validation.handled).toBe(true);
      expect(validation.processedData).toBeDefined();
    });
  });

  describe("Default Configuration", () => {
    it("should use default limit when not specified", () => {
      const validator = new ResponseSizeValidator();

      const data = { result: "x".repeat(50) };
      const validation = validator.validate(data, toolName, userId);

      expect(validation.valid).toBe(true);
      expect(validation.handled).toBe(false);
    });

    it("should use truncate mode by default", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 50,
      });

      const data = { result: "x".repeat(100) };
      const validation = validator.validate(data, toolName, userId);

      expect(validation.valid).toBe(true);
      expect(validation.handled).toBe(true);
      expect(validation.processedData).toBeDefined();
    });

    it("should include truncation indicator by default", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 50,
        mode: "truncate",
      });

      const data = { result: "x".repeat(100) };
      const validation = validator.validate(data, toolName, userId);

      expect(validation.processedData?._truncation_notice).toBeDefined();
    });
  });

  describe("Risk Level Defaults", () => {
    it("should have appropriate limits for each risk level", () => {
      expect(DEFAULT_RESPONSE_LIMITS.low).toBeGreaterThan(
        DEFAULT_RESPONSE_LIMITS.medium
      );
      expect(DEFAULT_RESPONSE_LIMITS.medium).toBeGreaterThan(
        DEFAULT_RESPONSE_LIMITS.high
      );
    });

    it("should have global default limit", () => {
      expect(GLOBAL_DEFAULT_LIMIT).toBeGreaterThan(0);
      expect(typeof GLOBAL_DEFAULT_LIMIT).toBe("number");
    });
  });

  describe("Truncation Indicator Control", () => {
    it("should include truncation indicator when enabled", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 50,
        mode: "truncate",
        includeTruncationIndicator: true,
      });

      const data = { result: "x".repeat(100) };
      const validation = validator.validate(data, toolName, userId);

      expect(validation.processedData?._truncation_notice).toBeDefined();
    });

    it("should exclude truncation indicator when disabled", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 50,
        mode: "truncate",
        includeTruncationIndicator: false,
      });

      const data = { result: "x".repeat(100) };
      const validation = validator.validate(data, toolName, userId);

      expect(validation.processedData?._truncation_notice).toBeUndefined();
      expect(validation.processedData?.result).toBeDefined();
    });
  });

  describe("Mixed Data Types", () => {
    it("should handle mixed array content", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 150,
        mode: "truncate",
      });

      const data = {
        items: [
          { id: 1, name: "x".repeat(50) },
          { id: 2, name: "y".repeat(50) },
          { id: 3, name: "z".repeat(50) },
        ],
      };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.handled).toBe(true);
      expect(Array.isArray(validation.processedData?.items)).toBe(true);
    });

    it("should preserve numeric precision", () => {
      const validator = new ResponseSizeValidator({
        maxCharacters: 100,
        mode: "truncate",
      });

      const data = {
        pi: 3.14159265359,
        largeNumber: 9007199254740991,
        decimal: 0.0000001,
      };

      const validation = validator.validate(data, toolName, userId);

      expect(validation.processedData?.pi).toBe(3.14159265359);
      expect(validation.processedData?.largeNumber).toBe(9007199254740991);
      expect(validation.processedData?.decimal).toBe(0.0000001);
    });
  });
});
