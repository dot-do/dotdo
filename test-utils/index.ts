/**
 * Shared Test Utilities
 *
 * Common utilities and helpers for all test workspaces.
 * Import these in your test files to reduce boilerplate.
 *
 * @example
 * import { createMockRequest, assertResponse, waitFor } from '../../../test-utils'
 */

import { vi, expect } from 'vitest'

// ============================================
// Request/Response Helpers
// ============================================

/**
 * Creates a mock Request object for testing
 */
export function createMockRequest(
  url: string,
  options: RequestInit = {}
): Request {
  const fullUrl = url.startsWith('http') ? url : `https://test.local${url}`
  return new Request(fullUrl, {
    method: 'GET',
    ...options,
  })
}

/**
 * Creates a mock JSON Request
 */
export function createJsonRequest<T>(
  url: string,
  body: T,
  options: Omit<RequestInit, 'body'> = {}
): Request {
  return createMockRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify(body),
    ...options,
  })
}

/**
 * Asserts common response properties
 */
export async function assertResponse(
  response: Response,
  expected: {
    status?: number
    ok?: boolean
    contentType?: string
    bodyContains?: string
    json?: unknown
  }
) {
  if (expected.status !== undefined) {
    expect(response.status).toBe(expected.status)
  }
  if (expected.ok !== undefined) {
    expect(response.ok).toBe(expected.ok)
  }
  if (expected.contentType) {
    expect(response.headers.get('content-type')).toContain(expected.contentType)
  }
  if (expected.bodyContains) {
    const text = await response.clone().text()
    expect(text).toContain(expected.bodyContains)
  }
  if (expected.json !== undefined) {
    const json = await response.clone().json()
    expect(json).toEqual(expected.json)
  }
}

// ============================================
// Async Helpers
// ============================================

/**
 * Waits for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options
  const start = Date.now()

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  throw new Error(`waitFor timed out after ${timeout}ms`)
}

/**
 * Delays execution for a specified duration
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retries an async function until it succeeds or max retries reached
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; delay?: number } = {}
): Promise<T> {
  const { maxRetries = 3, delay: delayMs = 100 } = options
  let lastError: unknown

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (i < maxRetries - 1) {
        await delay(delayMs)
      }
    }
  }

  throw lastError
}

// ============================================
// Mock Helpers
// ============================================

/**
 * Creates a mock function that resolves with the given value
 */
export function mockResolve<T>(value: T) {
  return vi.fn().mockResolvedValue(value)
}

/**
 * Creates a mock function that rejects with the given error
 */
export function mockReject(error: Error | string) {
  return vi.fn().mockRejectedValue(typeof error === 'string' ? new Error(error) : error)
}

/**
 * Creates a spy on console methods that suppresses output
 */
export function silenceConsole() {
  const spies = {
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  }

  return {
    ...spies,
    restore: () => {
      spies.log.mockRestore()
      spies.warn.mockRestore()
      spies.error.mockRestore()
    },
  }
}

// ============================================
// Assertion Helpers
// ============================================

/**
 * Asserts that a promise rejects with a specific error message
 */
export async function assertRejects(
  promise: Promise<unknown>,
  messageOrPattern: string | RegExp
): Promise<void> {
  try {
    await promise
    throw new Error('Expected promise to reject, but it resolved')
  } catch (error) {
    if (error instanceof Error && error.message === 'Expected promise to reject, but it resolved') {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    if (typeof messageOrPattern === 'string') {
      expect(message).toContain(messageOrPattern)
    } else {
      expect(message).toMatch(messageOrPattern)
    }
  }
}

/**
 * Asserts that a value is defined and returns it typed
 */
export function assertDefined<T>(value: T | undefined | null, message?: string): T {
  if (value === undefined || value === null) {
    throw new Error(message ?? 'Expected value to be defined')
  }
  return value
}

// ============================================
// Test Data Helpers
// ============================================

/**
 * Generates a unique test ID
 */
export function testId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Creates a test fixture with cleanup
 */
export function createFixture<T>(
  setup: () => T | Promise<T>,
  teardown?: (value: T) => void | Promise<void>
) {
  let value: T | undefined

  return {
    async setup() {
      value = await setup()
      return value
    },
    async teardown() {
      if (value !== undefined && teardown) {
        await teardown(value)
      }
      value = undefined
    },
    get value(): T {
      if (value === undefined) {
        throw new Error('Fixture not set up. Call setup() first.')
      }
      return value
    },
  }
}

// ============================================
// Type Guards
// ============================================

/**
 * Type guard for checking if a value is an Error
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error
}

/**
 * Type guard for checking if a value is a non-null object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
