module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/tests/integration/**/*.integration.test.ts"],
  moduleDirectories: ["node_modules", "packages/bot/node_modules"],
  moduleFileExtensions: ["ts", "js", "json"],
  testTimeout: 60000, // Per-test timeout; suites may override with jest.setTimeout()
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
  // Detect hanging tests and report open handles
  bail: false,
  forceExit: true,
  detectOpenHandles: true, // Report open handles preventing Jest exit
  maxWorkers: 1, // Run tests serially to isolate hangs to specific test
};
