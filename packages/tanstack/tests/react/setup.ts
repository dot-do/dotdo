/**
 * Test setup for React tests
 *
 * This file is loaded before each React test file and sets up
 * the testing environment with jsdom and jest-dom matchers.
 */

import '@testing-library/jest-dom/vitest'
import { vi, beforeEach, afterEach } from 'vitest'

// Override vi.useFakeTimers to configure shouldAdvanceTime
const originalUseFakeTimers = vi.useFakeTimers.bind(vi)
vi.useFakeTimers = (options?: Parameters<typeof vi.useFakeTimers>[0]) => {
  return originalUseFakeTimers({
    shouldAdvanceTime: true,
    advanceTimeDelta: 20,
    ...options,
  })
}

// Clean up after each test
afterEach(() => {
  // Clear any test-specific state
})
