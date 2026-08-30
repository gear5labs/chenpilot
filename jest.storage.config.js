/**
 * jest.storage.config.js
 *
 * Isolated Jest configuration for storage schema compatibility tests.
 * These tests only exercise the TypeScript scripts in scripts/ and do not
 * depend on the application runtime (database, Redis, config.ts, etc.).
 * Running with the global setup files would require setting 12+ environment
 * variables that are irrelevant to pure schema comparison logic.
 */
module.exports = {
  displayName: "storage-compat",
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: [
    "**/tests/unit/storageSchema*.test.ts",
    "**/tests/unit/storageSchema*.test.js",
  ],
  moduleFileExtensions: ["ts", "js", "json"],
  testTimeout: 30000,
  // No setupFilesAfterEnv — intentionally isolated from app bootstrap
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  globals: {
    "ts-jest": {
      isolatedModules: true,
      diagnostics: false,
    },
  },
};
