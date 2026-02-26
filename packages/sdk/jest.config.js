module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",

  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/__tests__/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  moduleFileExtensions: ["ts", "js", "json"],
  testTimeout: 10000,

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
        tsconfig: "<rootDir>/packages/sdk/tsconfig.json",
      },
    ],
  },
  testTimeout: 10000,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/packages/sdk/src/$1",
  },

};
