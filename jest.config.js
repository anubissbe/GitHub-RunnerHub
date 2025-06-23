/** @type {import('jest').Config} */
module.exports = {
  // Use ts-jest for TypeScript files
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // Module resolution
  moduleFileExtensions: ['ts', 'js', 'json'],
  
  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.[jt]s',
    '**/src/**/*.test.[jt]s',
    '**/src/**/__tests__/**/*.[jt]s'
  ],
  
  // Transform configuration
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        target: 'es2020',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        skipLibCheck: true,
        allowJs: true,
        resolveJsonModule: true
      }
    }],
    '^.+\\.js$': ['babel-jest', {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }]
      ]
    }]
  },
  
  // Ignore patterns
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$))'
  ],
  
  // Module path mapping
  moduleNameMapper: {
    // Handle path aliases
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    
    // Fix for JS files importing TS files
    '^(\\.\\.?/.+)\\.js$': '$1'
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Coverage configuration
  collectCoverage: false,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.{ts,js}',
    '!src/**/*.d.ts',
    '!src/**/*.test.{ts,js}',
    '!src/index*.ts'
  ],
  
  // Test options
  testTimeout: 30000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: false,
  
  // Global setup/teardown
  globalSetup: '<rootDir>/tests/global-setup.js',
  globalTeardown: '<rootDir>/tests/global-teardown.js',
  
  // Pass with no tests to avoid CI failures
  passWithNoTests: true
};