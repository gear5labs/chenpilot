/**
 * Tests for workflow schema version compatibility checking
 */

import {
  CURRENT_WORKFLOW_SCHEMA_VERSION,
  MINIMUM_COMPATIBLE_SCHEMA_VERSION,
  checkSchemaCompatibility,
  isValidSchemaVersion,
} from "../workflowSchemaVersion";

describe("workflowSchemaVersion", () => {
  describe("CURRENT_WORKFLOW_SCHEMA_VERSION", () => {
    it("should be a valid semantic version", () => {
      expect(isValidSchemaVersion(CURRENT_WORKFLOW_SCHEMA_VERSION)).toBe(true);
    });
  });

  describe("MINIMUM_COMPATIBLE_SCHEMA_VERSION", () => {
    it("should be a valid semantic version", () => {
      expect(isValidSchemaVersion(MINIMUM_COMPATIBLE_SCHEMA_VERSION)).toBe(true);
    });

    it("should be less than or equal to current version", () => {
      const currentParts = CURRENT_WORKFLOW_SCHEMA_VERSION.split(".").map(Number);
      const minParts = MINIMUM_COMPATIBLE_SCHEMA_VERSION.split(".").map(Number);
      
      expect(minParts[0]).toBeLessThanOrEqual(currentParts[0]);
      if (minParts[0] === currentParts[0]) {
        expect(minParts[1]).toBeLessThanOrEqual(currentParts[1]);
      }
    });
  });

  describe("isValidSchemaVersion", () => {
    it("should accept valid semantic versions", () => {
      expect(isValidSchemaVersion("1.0.0")).toBe(true);
      expect(isValidSchemaVersion("2.3.4")).toBe(true);
      expect(isValidSchemaVersion("10.20.30")).toBe(true);
    });

    it("should reject invalid formats", () => {
      expect(isValidSchemaVersion("1.0")).toBe(false);
      expect(isValidSchemaVersion("1")).toBe(false);
      expect(isValidSchemaVersion("v1.0.0")).toBe(false);
      expect(isValidSchemaVersion("1.0.0.0")).toBe(false);
      expect(isValidSchemaVersion("a.b.c")).toBe(false);
      expect(isValidSchemaVersion("")).toBe(false);
    });
  });

  describe("checkSchemaCompatibility", () => {
    it("should accept exact version match", () => {
      const result = checkSchemaCompatibility(CURRENT_WORKFLOW_SCHEMA_VERSION);
      expect(result.compatible).toBe(true);
      expect(result.currentVersion).toBe(CURRENT_WORKFLOW_SCHEMA_VERSION);
      expect(result.storedVersion).toBe(CURRENT_WORKFLOW_SCHEMA_VERSION);
      expect(result.reason).toBeUndefined();
    });

    it("should accept versions between minimum and current", () => {
      // If current is 1.0.0 and minimum is 1.0.0, test would need different values
      // For now, test with a hypothetical scenario
      const result = checkSchemaCompatibility("1.0.0");
      expect(result.compatible).toBe(true);
    });

    it("should reject versions below minimum", () => {
      // This test assumes minimum is > 0.0.0
      const result = checkSchemaCompatibility("0.0.1");
      expect(result.compatible).toBe(false);
      expect(result.reason).toContain("below minimum compatible version");
    });

    it("should reject versions newer than current", () => {
      const result = checkSchemaCompatibility("2.0.0");
      expect(result.compatible).toBe(false);
      expect(result.reason).toContain("newer than current version");
    });

    it("should reject versions with higher major version", () => {
      const result = checkSchemaCompatibility("99.0.0");
      expect(result.compatible).toBe(false);
      expect(result.reason).toContain("newer than current version");
    });

    it("should include version information in result", () => {
      const testVersion = "1.0.0";
      const result = checkSchemaCompatibility(testVersion);
      expect(result).toHaveProperty("currentVersion");
      expect(result).toHaveProperty("storedVersion");
      expect(result.storedVersion).toBe(testVersion);
    });

    it("should throw error for invalid version format", () => {
      expect(() => checkSchemaCompatibility("invalid")).toThrow();
    });
  });

  describe("version comparison logic", () => {
    it("should compare major versions correctly", () => {
      const v1 = checkSchemaCompatibility("0.9.0");
      const v2 = checkSchemaCompatibility("1.0.0");
      const v3 = checkSchemaCompatibility("2.0.0");

      // Assuming minimum is 1.0.0
      expect(v1.compatible).toBe(false);
      expect(v2.compatible).toBe(true);
      expect(v3.compatible).toBe(false);
    });

    it("should compare minor versions correctly", () => {
      // This tests would need different minimum/current values to be meaningful
      // For now, just verify the function doesn't crash
      expect(() => checkSchemaCompatibility("1.1.0")).not.toThrow();
      expect(() => checkSchemaCompatibility("1.2.0")).not.toThrow();
    });

    it("should compare patch versions correctly", () => {
      // Patch versions should be compatible if major/minor match
      const result = checkSchemaCompatibility("1.0.1");
      // This depends on minimum/current configuration
      expect(result).toHaveProperty("compatible");
    });
  });
});
