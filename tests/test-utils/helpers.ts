/**
 * Common Test Helpers for @dotdo
 *
 * This module provides shared utilities to reduce duplication across test files.
 * Following the NO MOCKS philosophy - these helpers work with real Miniflare/DO instances.
 *
 * @module test-utils/helpers
 */

import {
  DEFAULT_TEST_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_RETRY_MAX_DELAY_MS,
  DEFAULT_MAX_RETRY_ATTEMPTS,
} from '@dotdo/utils'

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data.
 *
 * Format: `{prefix}-{timestamp}-{random}`
 *
 * Using unique IDs ensures test isolation - each test gets its own
 * DO instance with clean state.
 *
 * @param prefix - Optional prefix for the ID (default: 'test')
 * @returns A unique test identifier string
 *
 * @example
 * ```typescript
 * const name = generateTestId()
 * // name = 'test-1705689600000-abc123'
 *
 * const customerName = generateTestId('customer')
 * // customerName = 'customer-1705689600000-xyz789'
 * ```
 */
export function generateTestId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Generate a deterministic test ID for reproducible tests.
 *
 * Useful when you need the same ID across multiple test runs
 * or when testing specific scenarios with known IDs.
 *
 * @param seed - A seed string to generate the ID from
 * @param prefix - Optional prefix for the ID (default: 'test')
 * @returns A deterministic test identifier string
 *
 * @example
 * ```typescript
 * const id = generateDeterministicId('my-test-case')
 * // Always returns the same value for 'my-test-case'
 * ```
 */
export function generateDeterministicId(seed: string, prefix = 'test'): string {
  // Simple hash function for deterministic IDs
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `${prefix}-${Math.abs(hash).toString(36)}`
}

// ============================================================================
// DO Stub Helpers
// ============================================================================

/**
 * Get a fresh DO stub for testing from the test environment.
 *
 * This helper retrieves a real DO instance from the vitest-pool-workers
 * environment. Each unique name gets its own isolated DO instance.
 *
 * @param env - The test environment object containing DO bindings
 * @param name - Optional name for the DO instance (auto-generated if not provided)
 * @param binding - The DO binding name (default: 'DO')
 * @returns A DurableObjectStub for making requests
 *
 * @example
 * ```typescript
 * import { env } from 'cloudflare:test'
 * import { getTestDO, generateTestId } from '@dotdo/test-utils'
 *
 * it('should handle requests', async () => {
 *   const stub = getTestDO(env)
 *   const response = await stub.fetch('https://do/')
 *   expect(response.status).toBe(200)
 * })
 *
 * it('should use specific name', async () => {
 *   const stub = getTestDO(env, 'my-specific-instance')
 *   // ...
 * })
 * ```
 */
export function getTestDO<T extends DurableObjectNamespace>(
  env: { DO: T } & Record<string, T>,
  name?: string,
  binding: string = 'DO'
): DurableObjectStub {
  const testName = name ?? generateTestId()
  const ns = (env as Record<string, T>)[binding] ?? env.DO
  const id = ns.idFromName(testName)
  return ns.get(id)
}

/**
 * Create a DO ID from name using the test environment.
 *
 * @param env - The test environment object containing DO bindings
 * @param name - The name to create an ID from
 * @param binding - The DO binding name (default: 'DO')
 * @returns A DurableObjectId
 *
 * @example
 * ```typescript
 * const id = createTestId(env, 'my-instance')
 * const stub = env.DO.get(id)
 * ```
 */
export function createTestId<T extends DurableObjectNamespace>(
  env: { DO: T } & Record<string, T>,
  name: string,
  binding: string = 'DO'
): DurableObjectId {
  const ns = (env as Record<string, T>)[binding] ?? env.DO
  return ns.idFromName(name)
}

// ============================================================================
// RPC Helpers
// ============================================================================

/**
 * Make an RPC call to a DO stub.
 *
 * This helper provides a convenient way to call RPC methods on a DO
 * via the standard RPC endpoint.
 *
 * @param stub - The DurableObjectStub to call
 * @param method - The RPC method name (supports dot notation like 'things.create')
 * @param args - Optional array of arguments to pass to the method
 * @returns Promise resolving to the RPC response
 *
 * @example
 * ```typescript
 * const stub = getTestDO(env)
 *
 * // Call things.create
 * const thing = await rpc<Thing>(stub, 'things.create', [
 *   { $type: 'Customer', name: 'Alice' }
 * ])
 *
 * // Call a method with no arguments
 * const health = await rpc<HealthResponse>(stub, 'health')
 * ```
 */
export async function rpc<T>(
  stub: DurableObjectStub,
  method: string,
  args: unknown[] = []
): Promise<T> {
  const response = await stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`RPC error (${response.status}): ${text}`)
  }

  return response.json() as Promise<T>
}

/**
 * Make an RPC call that may return an error response.
 *
 * Unlike `rpc()`, this does not throw on non-200 responses.
 * Useful for testing error handling.
 *
 * @param stub - The DurableObjectStub to call
 * @param method - The RPC method name
 * @param args - Optional array of arguments
 * @returns Promise resolving to { response, data } or { response, error }
 *
 * @example
 * ```typescript
 * const result = await rpcMayFail(stub, 'things.get', ['nonexistent-id'])
 * expect(result.response.status).toBe(404)
 * expect(result.error).toBeDefined()
 * ```
 */
export async function rpcMayFail<T>(
  stub: DurableObjectStub,
  method: string,
  args: unknown[] = [],
  rpcUrl: string = 'https://do/rpc'
): Promise<{ response: Response; data?: T; error?: unknown }> {
  const response = await stub.fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  })

  // Clone response so we can read body twice if needed
  const clonedResponse = response.clone()
  try {
    const json = await response.json()
    if (response.ok) {
      return { response: clonedResponse, data: json as T }
    }
    return { response: clonedResponse, error: json }
  } catch {
    return { response: clonedResponse, error: await clonedResponse.text() }
  }
}

// ============================================================================
// Request Helpers
// ============================================================================

/**
 * Create a JSON request for testing DO fetch handlers.
 *
 * @param url - The request URL
 * @param body - The JSON body
 * @param options - Additional request options
 * @returns A Request object
 *
 * @example
 * ```typescript
 * const request = createJsonRequest('https://do/api/users', { name: 'Alice' })
 * const response = await stub.fetch(request)
 * ```
 */
export function createJsonRequest(
  url: string,
  body: unknown,
  options: RequestInit = {}
): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {})
    },
    body: JSON.stringify(body),
    ...options
  })
}

/**
 * Create an RPC request for testing DO RPC endpoints.
 *
 * @param method - The RPC method name
 * @param args - Optional arguments array
 * @param baseUrl - The base URL (default: 'https://do')
 * @returns A Request object for the RPC call
 *
 * @example
 * ```typescript
 * const request = createRpcRequest('greet', ['World'])
 * const response = await stub.fetch(request)
 * ```
 */
export function createRpcRequest(
  method: string,
  args: unknown[] = [],
  baseUrl: string = 'https://do'
): Request {
  return createJsonRequest(`${baseUrl}/rpc`, { method, args })
}

// ============================================================================
// Async Test Utilities
// ============================================================================

/**
 * Wait for a specified duration.
 *
 * Use sparingly - prefer `waitFor` with a condition when possible.
 *
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after the delay
 *
 * @example
 * ```typescript
 * await sleep(100) // Wait 100ms
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wait for a condition to become true.
 *
 * Polls the condition at regular intervals until it returns true
 * or the timeout is reached.
 *
 * @param condition - Function that returns boolean or Promise<boolean>
 * @param options - Configuration options
 * @returns Promise that resolves when condition is met
 * @throws Error if condition is not met within timeout
 *
 * @example
 * ```typescript
 * // Wait for counter to reach 10
 * await waitFor(async () => {
 *   const response = await stub.fetch('https://do/counter')
 *   const { value } = await response.json()
 *   return value >= 10
 * }, { timeout: 5000, message: 'Counter did not reach 10' })
 * ```
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: {
    timeout?: number
    interval?: number
    message?: string
  } = {}
): Promise<void> {
  const {
    timeout = DEFAULT_TEST_TIMEOUT_MS,
    interval = DEFAULT_POLL_INTERVAL_MS,
    message = 'Condition not met within timeout'
  } = options

  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const result = await condition()
    if (result) {
      return
    }
    await sleep(interval)
  }

  throw new Error(message)
}

/**
 * Retry an async operation with exponential backoff.
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration
 * @returns Promise resolving to the function result
 * @throws The last error if all retries fail
 *
 * @example
 * ```typescript
 * const result = await retry(async () => {
 *   const response = await stub.fetch('https://do/flaky')
 *   if (!response.ok) throw new Error('Failed')
 *   return response.json()
 * }, { maxAttempts: 3, baseDelay: 100 })
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number
    baseDelay?: number
    maxDelay?: number
  } = {}
): Promise<T> {
  const {
    maxAttempts = DEFAULT_MAX_RETRY_ATTEMPTS,
    baseDelay = DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelay = DEFAULT_RETRY_MAX_DELAY_MS
  } = options

  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt === maxAttempts) {
        throw lastError
      }

      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
      await sleep(delay)
    }
  }

  throw lastError
}

// ============================================================================
// Type Definitions for Common Test Interfaces
// ============================================================================

/**
 * Common health check response structure.
 */
export interface HealthResponse {
  status: string
  id: string
  timestamp?: number
}

/**
 * Common info endpoint response structure.
 */
export interface InfoResponse {
  id: string
  keys: number
  [key: string]: unknown
}

/**
 * Common error response structure.
 */
export interface ErrorResponse {
  error: string
  message?: string
  code?: string
  details?: unknown
}
