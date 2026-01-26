module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/stellar.mock.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
};
