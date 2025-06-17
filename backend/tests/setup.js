// Suppress console logs during tests unless explicitly needed
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.GITHUB_TOKEN = 'test-token';
process.env.GITHUB_ORG = 'test-org';
process.env.GITHUB_REPO = 'test-repo';

// Mock timers for consistent testing
jest.useFakeTimers();

// Clean up after each test
afterEach(() => {
  jest.clearAllTimers();
  jest.clearAllMocks();
});