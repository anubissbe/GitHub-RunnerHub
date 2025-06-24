module.exports = {
  testEnvironment: 'node',
  // Only use ts-jest for TypeScript files
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  // Only run simple tests to verify ts-jest works
  testMatch: [
    '**/simple.test.ts'
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Skip all external dependencies and complex tests
  testPathIgnorePatterns: [
    '/node_modules/',
    'container-pool',
    'orchestrator',
    'status-reporter',
    'database',
    'redis',
    'external',
    'integration',
    'e2e'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000,
  verbose: true,
  forceExit: true,
  passWithNoTests: true
};