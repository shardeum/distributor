import { clearAllMocks } from './test-helpers'

// Global test setup
beforeEach(() => {
  clearAllMocks()
})

// Mock timers globally if needed
export const setupMockTimers = () => {
  jest.useFakeTimers()
}

export const cleanupMockTimers = () => {
  jest.useRealTimers()
}

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}

// Set test environment variables
process.env.NODE_ENV = 'test'