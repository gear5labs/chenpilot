module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/tests/unit/**/*.test.ts", "!**/tests/unit/**/*.integration.test.ts"],
  moduleDirectories: ["node_modules", "packages/bot/node_modules"],
  moduleFileExtensions: ["ts", "js", "json"],
  testTimeout: 30000,
  setupFiles: ["<rootDir>/tests/env.setup.ts"],
  setupFilesAfterEnv: [
    "<rootDir>/tests/stellar.mock.ts",
    "<rootDir>/tests/setup.ts",
  ],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  globals: {
    "ts-jest": {
      isolatedModules: true,
      diagnostics: false,
    },
  },
  verbose: true,
};
