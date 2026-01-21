/**
 * Miniflare Test Utilities for @dotdo
 *
 * Provides shared utilities for setting up and working with Miniflare
 * in tests. Following the NO MOCKS philosophy from CLAUDE.md:
 *
 * "Durable Objects require NO MOCKING. Miniflare runs real DOs with real SQLite locally."
 *
 * @module test-utils/miniflare
 */

import { Miniflare, type MiniflareOptions } from 'miniflare'
import {
  DEFAULT_TEST_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_RETRY_MAX_DELAY_MS,
  DEFAULT_MAX_RETRY_ATTEMPTS,
} from '@dotdo/utils'

// ============================================================================
// Types
// ============================================================================

export interface TestMiniflareOptions {
  /**
   * Additional Miniflare options to merge with defaults.
   */
  options?: Partial<MiniflareOptions>

  /**
   * Whether to enable SQLite for Durable Objects.
   * Default: true
   */
  useSQLite?: boolean

  /**
   * Whether to persist DO storage between tests.
   * Default: false (in-memory for fast tests)
   */
  persist?: boolean

  /**
   * Custom DO script to use instead of the default.
   */
  script?: string

  /**
   * Durable Object bindings configuration.
   * Maps binding name to class name.
   */
  durableObjects?: Record<string, string | { className: string; useSQLite?: boolean }>
}

export interface TestMiniflareResult {
  /**
   * The Miniflare instance.
   */
  mf: Miniflare

  /**
   * Cleanup function to dispose of the Miniflare instance.
   */
  cleanup: () => Promise<void>

  /**
   * Get a DO stub by namespace and name.
   */
  getStub: (namespace: string, name: string) => Promise<DurableObjectStub>

  /**
   * Get a DO namespace by binding name.
   */
  getNamespace: (name: string) => Promise<DurableObjectNamespace>
}

interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

interface DurableObjectId {
  toString(): string
}

// ============================================================================
// Default DO Script
// ============================================================================

/**
 * A minimal test DO script with basic functionality.
 * Used when no custom script is provided.
 */
const DEFAULT_TEST_DO_SCRIPT = `
export class TestDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.sql = state.storage.sql
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      // Health check
      if (path === '/' || path === '/health') {
        return Response.json({
          status: 'ok',
          id: this.state.id.toString(),
          timestamp: Date.now()
        })
      }

      // Storage operations
      if (path === '/storage/get' && method === 'GET') {
        const key = url.searchParams.get('key')
        const value = await this.storage.get(key)
        return Response.json({ key, value })
      }

      if (path === '/storage/put' && method === 'POST') {
        const { key, value } = await request.json()
        await this.storage.put(key, value)
        return Response.json({ success: true, key, value })
      }

      if (path === '/storage/delete' && method === 'DELETE') {
        const key = url.searchParams.get('key')
        const deleted = await this.storage.delete(key)
        return Response.json({ deleted })
      }

      if (path === '/storage/list' && method === 'GET') {
        const prefix = url.searchParams.get('prefix') || ''
        const entries = await this.storage.list({ prefix })
        return Response.json({ entries: Object.fromEntries(entries) })
      }

      // Counter operations (for concurrency testing)
      if (path === '/counter/increment' && method === 'POST') {
        const current = await this.storage.get('counter') || 0
        const newValue = current + 1
        await this.storage.put('counter', newValue)
        return Response.json({ counter: newValue })
      }

      if (path === '/counter/get' && method === 'GET') {
        const counter = await this.storage.get('counter') || 0
        return Response.json({ counter })
      }

      // RPC endpoint
      if (path === '/rpc' && method === 'POST') {
        const { method: rpcMethod, args = [] } = await request.json()

        // Find method by path (supports dot notation like 'math.add')
        const parts = rpcMethod.split('.')
        let target = this
        for (const part of parts) {
          target = target[part]
          if (target === undefined) {
            return Response.json({ error: 'Method not found' }, { status: 404 })
          }
        }

        if (typeof target !== 'function') {
          return Response.json({ error: 'Not a function' }, { status: 400 })
        }

        const result = await target.apply(this, args)
        return Response.json(result)
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doName = url.searchParams.get('name') || 'default'
    const id = env.TEST_DO.idFromName(doName)
    const stub = env.TEST_DO.get(id)
    return stub.fetch(request)
  }
}
`

// ============================================================================
// Public API
// ============================================================================

/**
 * Creates a Miniflare instance configured for testing Durable Objects.
 *
 * This provides a real Cloudflare Workers environment with actual SQLite
 * storage, without any mocking.
 *
 * @example
 * ```typescript
 * import { createTestMiniflare, generateTestId } from '../test-utils'
 *
 * describe('My DO Tests', () => {
 *   let mf: Miniflare
 *   let cleanup: () => Promise<void>
 *   let getStub: (ns: string, name: string) => Promise<DurableObjectStub>
 *
 *   beforeAll(async () => {
 *     const result = await createTestMiniflare()
 *     mf = result.mf
 *     cleanup = result.cleanup
 *     getStub = result.getStub
 *   })
 *
 *   afterAll(async () => {
 *     await cleanup()
 *   })
 *
 *   it('should work with real DO', async () => {
 *     const name = generateTestId()
 *     const stub = await getStub('TEST_DO', name)
 *     const response = await stub.fetch('http://test/health')
 *     expect(response.status).toBe(200)
 *   })
 * })
 * ```
 */
export async function createTestMiniflare(
  config: TestMiniflareOptions = {}
): Promise<TestMiniflareResult> {
  const {
    options = {},
    useSQLite = true,
    persist = false,
    script = DEFAULT_TEST_DO_SCRIPT,
    durableObjects = { TEST_DO: 'TestDO' }
  } = config

  // Build DO configuration with SQLite support
  const doConfig: Record<string, string | { className: string; useSQLite?: boolean }> = {}
  for (const [binding, value] of Object.entries(durableObjects)) {
    if (typeof value === 'string') {
      doConfig[binding] = useSQLite ? { className: value, useSQLite: true } : value
    } else {
      doConfig[binding] = {
        ...value,
        useSQLite: value.useSQLite ?? useSQLite
      }
    }
  }

  const mf = new Miniflare({
    ...options,
    modules: true,
    script,
    durableObjects: doConfig,
    durableObjectsPersist: persist,
  } as MiniflareOptions)

  const getNamespace = async (name: string): Promise<DurableObjectNamespace> => {
    return await mf.getDurableObjectNamespace(name) as unknown as DurableObjectNamespace
  }

  const getStub = async (namespace: string, name: string): Promise<DurableObjectStub> => {
    const ns = await getNamespace(namespace)
    const id = ns.idFromName(name)
    return ns.get(id) as unknown as DurableObjectStub
  }

  const cleanup = async () => {
    await mf.dispose()
  }

  return { mf, cleanup, getStub, getNamespace }
}

/**
 * Get a DO stub from a Miniflare instance.
 *
 * Convenience function when you already have a Miniflare instance.
 *
 * @example
 * ```typescript
 * const stub = await getDoStub(mf, 'TEST_DO', 'my-instance')
 * const response = await stub.fetch('http://test/')
 * ```
 */
export async function getDoStub(
  mf: Miniflare,
  namespace: string,
  name: string
): Promise<DurableObjectStub> {
  const ns = await mf.getDurableObjectNamespace(namespace) as unknown as DurableObjectNamespace
  const id = ns.idFromName(name)
  return ns.get(id) as unknown as DurableObjectStub
}

/**
 * Generates a unique test ID for DO instances.
 *
 * Format: `test-{timestamp}-{random}`
 *
 * Using unique IDs ensures test isolation - each test gets its own
 * DO instance with clean state.
 *
 * @example
 * ```typescript
 * const name = generateTestId()
 * // name = 'test-1705689600000-abc123'
 * const stub = await getStub('TEST_DO', name)
 * ```
 */
export function generateTestId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// Async Utilities
// ============================================================================

export interface WaitForOptions {
  /**
   * Maximum time to wait in milliseconds.
   * Default: DEFAULT_TEST_TIMEOUT_MS (5000)
   */
  timeout?: number

  /**
   * Polling interval in milliseconds.
   * Default: DEFAULT_POLL_INTERVAL_MS (50)
   */
  interval?: number

  /**
   * Error message if condition is not met.
   */
  message?: string
}

/**
 * Wait for a condition to become true, polling at regular intervals.
 *
 * Useful for testing async operations like alarm handlers, WebSocket
 * messages, or eventual consistency scenarios.
 *
 * @example
 * ```typescript
 * // Wait for counter to reach 10
 * await waitFor(async () => {
 *   const response = await stub.fetch('http://test/counter/get')
 *   const { counter } = await response.json()
 *   return counter >= 10
 * }, { timeout: 10000, message: 'Counter did not reach 10' })
 * ```
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: WaitForOptions = {}
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
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  throw new Error(message)
}

/**
 * Wait for a specific duration (use sparingly - prefer waitFor).
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
 * Retry an async operation with exponential backoff.
 *
 * @example
 * ```typescript
 * const result = await retry(async () => {
 *   const response = await stub.fetch('http://test/flaky-endpoint')
 *   if (!response.ok) throw new Error('Request failed')
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
// Request Helpers
// ============================================================================

/**
 * Creates a JSON POST request for testing.
 *
 * @example
 * ```typescript
 * const request = createJsonRequest('http://test/api/users', { name: 'Alice' })
 * const response = await doInstance.fetch(request)
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
 * Creates an RPC request for testing DO RPC endpoints.
 *
 * @example
 * ```typescript
 * const request = createRpcRequest('http://test/rpc', 'greet', ['World'])
 * const response = await doInstance.fetch(request)
 * ```
 */
export function createRpcRequest(
  baseUrl: string,
  method: string,
  args: unknown[] = [],
  headers: Record<string, string> = {}
): Request {
  return createJsonRequest(
    baseUrl.endsWith('/rpc') ? baseUrl : `${baseUrl}/rpc`,
    { method, args },
    { headers }
  )
}
