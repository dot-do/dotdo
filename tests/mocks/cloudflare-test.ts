/**
 * Mock for cloudflare:test module
 *
 * Used when running tests in Node.js environment (e.g., coverage)
 * instead of the Cloudflare Workers runtime.
 */

// Mock env object
export const env = {
  DO: {
    idFromName: (name: string) => ({ toString: () => name, name }),
    get: (_id: unknown) => ({
      fetch: async (_request: Request) => new Response('Mock DO response'),
    }),
  },
}

// SELF stub for worker self-reference
export const SELF = {
  fetch: async (_request: Request) => new Response('Mock SELF response'),
}

// createExecutionContext stub
export function createExecutionContext() {
  return {
    waitUntil: (_promise: Promise<unknown>) => {},
    passThroughOnException: () => {},
  }
}
