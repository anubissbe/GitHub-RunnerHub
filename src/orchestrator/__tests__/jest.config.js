module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  collectCoverageFrom: [
    'src/orchestrator/**/*.ts',
    '!src/orchestrator/**/__tests__/**',
    '!src/orchestrator/**/*.d.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ],
  setupFilesAfterEnv: ['<rootDir>/src/orchestrator/__tests__/setup.ts'],
  testTimeout: 10000,
  clearMocks: true,
  restoreMocks: true,
  
  // Module name mapping for path aliases
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    },
    './src/orchestrator/runner-orchestrator.ts': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    },
    './src/orchestrator/container-assignment.ts': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    },
    './src/orchestrator/status-reporter.ts': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};