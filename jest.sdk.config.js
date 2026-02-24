module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: [
    "**/tests/unit/contract_logs.test.ts",
    "**/tests/unit/recovery_engine.test.ts",
    "**/tests/unit/soroban_tool.test.ts",
  ],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  setupFilesAfterEnv: ["<rootDir>/tests/stellar.mock.ts"],
  testTimeout: 10000,
};
