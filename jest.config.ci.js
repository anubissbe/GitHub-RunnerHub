module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.js', '**/tests/**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build/',
    '.*\\.ts$'  // Skip all TypeScript files in CI
  ],
  modulePathIgnorePatterns: ['/dist/', '/build/'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  collectCoverage: false,  // Disable coverage to speed up tests
  testTimeout: 30000,
  maxWorkers: 2,
  forceExit: true,
  detectOpenHandles: false,
  verbose: true,
  // Transform only JavaScript files, ignore everything else
  transform: {},
  transformIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/setup.js'
  ],
  // Disable haste map to prevent naming collisions
  haste: {
    enableSymlinks: false,
    forceNodeFilesystemAPI: true,
    throwOnModuleCollision: false
  }
};