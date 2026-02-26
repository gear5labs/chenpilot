module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "../../",
  roots: ["<rootDir>/packages/sdk/src"],
  testMatch: ["**/packages/sdk/src/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: [
    "packages/sdk/src/**/*.ts",
    "!packages/sdk/src/**/*.d.ts",
    "!packages/sdk/src/__tests__/**",
    "!packages/sdk/src/types/**",
  ],
  coverageDirectory: "packages/sdk/coverage",
  coverageReporters: ["text", "lcov", "html"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "packages/sdk/tsconfig.json",
      },
    ],
  },
  testTimeout: 10000,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/packages/sdk/src/$1",
  },
};
