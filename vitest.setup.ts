import { expect } from 'vitest'

// Add custom matchers
expect.extend({
  toEndWith(received: string, expected: string) {
    const pass = typeof received === 'string' && received.endsWith(expected)
    return {
      pass,
      message: () =>
        pass
          ? `expected "${received}" not to end with "${expected}"`
          : `expected "${received}" to end with "${expected}"`,
    }
  },
})

// Extend vitest types
declare module 'vitest' {
  interface Assertion<T = unknown> {
    toEndWith(expected: string): void
  }
  interface AsymmetricMatchersContaining {
    toEndWith(expected: string): unknown
  }
}
