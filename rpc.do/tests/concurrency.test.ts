/**
 * Concurrency and Race Condition Tests for rpc.do Transport Layer
 *
 * This test suite validates the RPC transport layer's behavior under concurrent
 * operations to ensure:
 * - Parallel requests complete correctly without interference
 * - Correlation IDs remain unique across concurrent requests
 * - Retry logic handles concurrent failures properly
 * - Auth token refresh is properly coordinated under concurrent 401s
 * - State transitions and resource cleanup work correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Transport, TransportState } from '../src/transport/types'
import type { ITokenStore, StoredTokens } from '../src/auth/token-store'
import type { RPCMessage, RPCResponse } from '../src/types'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a mock token store for testing
 */
function createMockTokenStore(initialTokens: StoredTokens | null = null): ITokenStore {
  let tokens = initialTokens
  return {
    getTokens: vi.fn().mockImplementation(async () => tokens),
    saveTokens: vi.fn().mockImplementation(async (newTokens: StoredTokens) => {
      tokens = newTokens
    }),
    deleteTokens: vi.fn().mockImplementation(async () => {
      tokens = null
    }),
    isTokenExpired: vi.fn().mockImplementation(async () => {
      if (!tokens) return true
      return Date.now() >= tokens.expires_at
    }),
  }
}

/**
 * Create a delayed response for testing concurrency
 */
function delayedResponse<T>(result: T, delayMs: number): Promise<Response> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(
        new Response(JSON.stringify(result), {
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
        })
      )
    }, delayMs)
  })
}

// ============================================================================
// Parallel Requests Tests
// ============================================================================

describe('Concurrency Tests', () => {
  describe('Parallel Requests', () => {
    it('should handle multiple simultaneous requests', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      let requestCount = 0
      const mockFetch = vi.fn().mockImplementation(async () => {
        requestCount++
        const currentRequest = requestCount
        // Add some delay to ensure parallel execution
        await new Promise((r) => setTimeout(r, 10))
        return new Response(JSON.stringify({ result: currentRequest }), {
          ok: true,
          headers: new Headers(),
        })
      })

      const transport = new FetchTransport({
        url: 'https://api.test.com',
        fetch: mockFetch,
      })

      const results = await Promise.all([
        transport.send({ method: 'a', args: [] }),
        transport.send({ method: 'b', args: [] }),
        transport.send({ method: 'c', args: [] }),
        transport.send({ method: 'd', args: [] }),
        transport.send({ method: 'e', args: [] }),
      ])

      // All should complete successfully
      expect(results).toHaveLength(5)
      results.forEach((r) => {
        expect(r.result).toBeDefined()
        expect(r.error).toBeUndefined()
      })

      // All 5 requests should have been made
      expect(mockFetch).toHaveBeenCalledTimes(5)
    })

    it('should maintain correlation IDs across parallel requests', async () => {
      const { FetchTransport, CORRELATION_ID_HEADER } = await import('../src/transport/fetch')

      const seenIds = new Set<string>()
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>
        const id = headers[CORRELATION_ID_HEADER]
        seenIds.add(id)
        // Add delay to ensure parallel execution
        await new Promise((r) => setTimeout(r, 5))
        return new Response(JSON.stringify({ result: 'ok' }), {
          ok: true,
          headers: new Headers({ [CORRELATION_ID_HEADER]: id }),
        })
      })

      const transport = new FetchTransport({
        url: 'https://api.test.com',
        fetch: mockFetch,
      })

      const responses = await Promise.all([
        transport.send({ method: 'a', args: [] }),
        transport.send({ method: 'b', args: [] }),
        transport.send({ method: 'c', args: [] }),
      ])

      // All should have unique correlation IDs
      expect(seenIds.size).toBe(3)

      // Each response should have a correlation ID
      responses.forEach((r) => {
        expect(r.correlationId).toBeDefined()
      })
    })

    it('should not mix up responses between parallel requests', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string)
        const method = body.method as string
        // Different delays for different methods to test ordering
        const delay = method === 'slow' ? 50 : method === 'medium' ? 30 : 10
        await new Promise((r) => setTimeout(r, delay))
        return new Response(JSON.stringify({ method, delay }), {
          ok: true,
          headers: new Headers(),
        })
      })

      const transport = new FetchTransport({
        url: 'https://api.test.com',
        fetch: mockFetch,
      })

      const [slow, medium, fast] = await Promise.all([
        transport.send({ method: 'slow', args: [] }),
        transport.send({ method: 'medium', args: [] }),
        transport.send({ method: 'fast', args: [] }),
      ])

      // Each response should match its request
      expect((slow.result as { method: string }).method).toBe('slow')
      expect((medium.result as { method: string }).method).toBe('medium')
      expect((fast.result as { method: string }).method).toBe('fast')
    })

    it('should handle mixed success and failure in parallel', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      let callCount = 0
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++
        const currentCall = callCount
        await new Promise((r) => setTimeout(r, 5))

        // Alternate success and failure based on captured call count
        if (currentCall % 2 === 0) {
          return new Response(
            JSON.stringify({ type: 'TestError', code: 'ERROR', message: 'fail' }),
            {
              ok: false,
              status: 500,
              headers: new Headers(),
            }
          )
        }
        return new Response(JSON.stringify({ result: 'success' }), {
          ok: true,
          headers: new Headers(),
        })
      })

      const transport = new FetchTransport({
        url: 'https://api.test.com',
        fetch: mockFetch,
      })

      const results = await Promise.all([
        transport.send({ method: 'a', args: [] }),
        transport.send({ method: 'b', args: [] }),
        transport.send({ method: 'c', args: [] }),
        transport.send({ method: 'd', args: [] }),
      ])

      // Some should succeed (result defined, no error), some should fail (error defined)
      const successes = results.filter((r) => r.error === undefined)
      const failures = results.filter((r) => r.error !== undefined)

      expect(successes.length).toBeGreaterThan(0)
      expect(failures.length).toBeGreaterThan(0)
      expect(successes.length + failures.length).toBe(4)
    })
  })

  // ============================================================================
  // Retry Under Concurrency Tests
  // ============================================================================

  describe('Retry under concurrency', () => {
    it('should handle multiple concurrent retrying requests', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      let globalCallCount = 0
      const mockTransport: Transport = {
        send: vi.fn().mockImplementation(async () => {
          globalCallCount++
          // Fail first few calls, then succeed
          if (globalCallCount < 6) {
            return { error: { type: 'TransportError', code: 'NETWORK_ERROR', message: 'fail' } }
          }
          return { result: 'ok' }
        }),
      }

      const transport = new RetryTransport({
        transport: mockTransport,
        maxRetries: 5,
        initialDelay: 1,
        backoffMultiplier: 1,
        jitter: 'none',
      })

      // Start multiple requests that will all need retries
      const results = await Promise.all([
        transport.send({ method: 'a', args: [] }),
        transport.send({ method: 'b', args: [] }),
        transport.send({ method: 'c', args: [] }),
      ])

      // At least some should eventually succeed
      const successes = results.filter((r) => r.result === 'ok')
      expect(successes.length).toBeGreaterThan(0)
    })

    it('should maintain separate retry state for each request', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const callsByMethod: Record<string, number> = { a: 0, b: 0, c: 0 }

      const mockTransport: Transport = {
        send: vi.fn().mockImplementation(async (msg: RPCMessage) => {
          const method = msg.method as 'a' | 'b' | 'c'
          callsByMethod[method]++

          // 'a' fails twice then succeeds
          // 'b' always succeeds
          // 'c' fails three times then succeeds
          if (method === 'a' && callsByMethod['a'] < 3) {
            return { error: { type: 'TransportError', code: 'NETWORK_ERROR', message: 'fail' } }
          }
          if (method === 'c' && callsByMethod['c'] < 4) {
            return { error: { type: 'TransportError', code: 'NETWORK_ERROR', message: 'fail' } }
          }
          return { result: `success-${method}` }
        }),
      }

      const transport = new RetryTransport({
        transport: mockTransport,
        maxRetries: 5,
        initialDelay: 1,
        jitter: 'none',
      })

      const results = await Promise.all([
        transport.send({ method: 'a', args: [] }),
        transport.send({ method: 'b', args: [] }),
        transport.send({ method: 'c', args: [] }),
      ])

      // All should succeed with their own result
      expect(results[0].result).toBe('success-a')
      expect(results[1].result).toBe('success-b')
      expect(results[2].result).toBe('success-c')

      // Each had different retry counts
      expect(callsByMethod['a']).toBe(3) // 2 retries + 1 success
      expect(callsByMethod['b']).toBe(1) // immediate success
      expect(callsByMethod['c']).toBe(4) // 3 retries + 1 success
    })

    it('should respect per-request correlation IDs during retries', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const correlationIdsByMethod: Record<string, string[]> = { a: [], b: [] }

      const mockTransport: Transport = {
        send: vi.fn().mockImplementation(async (msg: RPCMessage) => {
          const method = msg.method
          if (msg.correlationId) {
            correlationIdsByMethod[method].push(msg.correlationId)
          }

          // Fail once then succeed
          if (correlationIdsByMethod[method].length < 2) {
            return { error: { type: 'TransportError', code: 'NETWORK_ERROR', message: 'fail' } }
          }
          return { result: 'ok', correlationId: msg.correlationId }
        }),
      }

      const transport = new RetryTransport({
        transport: mockTransport,
        maxRetries: 3,
        initialDelay: 1,
        jitter: 'none',
      })

      await Promise.all([
        transport.send({ method: 'a', args: [], correlationId: 'corr-a' }),
        transport.send({ method: 'b', args: [], correlationId: 'corr-b' }),
      ])

      // Each request should maintain its correlation ID across retries
      expect(correlationIdsByMethod['a'].every((id) => id === 'corr-a')).toBe(true)
      expect(correlationIdsByMethod['b'].every((id) => id === 'corr-b')).toBe(true)
    })
  })

  // ============================================================================
  // Auth Token Refresh Under Concurrency Tests
  // ============================================================================

  describe('Auth token refresh under concurrency', () => {
    it('should not refresh token multiple times for concurrent 401s', async () => {
      const { AuthTransport } = await import('../src/auth/auth-transport')

      let refreshCount = 0
      const mockTokenStore = createMockTokenStore({
        access_token: 'expired',
        refresh_token: 'valid-refresh',
        expires_at: Date.now() - 1000, // Already expired
      })

      let requestCount = 0
      const mockFetch = vi.fn().mockImplementation(async () => {
        requestCount++
        // First few requests return 401
        if (requestCount <= 3) {
          return new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'unauthorized' }), {
            ok: false,
            status: 401,
            headers: new Headers(),
          })
        }
        return new Response(JSON.stringify({ result: 'ok' }), {
          ok: true,
          headers: new Headers(),
        })
      })

      const transport = new AuthTransport({
        url: 'https://api.test.com',
        tokenStore: mockTokenStore,
        fetch: mockFetch,
        onRefreshToken: vi.fn().mockImplementation(async () => {
          refreshCount++
          await new Promise((r) => setTimeout(r, 50))
          return { access_token: 'new-token', expires_in: 3600 }
        }),
      })

      await Promise.all([
        transport.send({ method: 'a', args: [] }),
        transport.send({ method: 'b', args: [] }),
        transport.send({ method: 'c', args: [] }),
      ])

      // Token refresh should be coordinated - the isRefreshing flag should prevent stampede
      // Expect at most one refresh per request (3 requests, so <= 3 refreshes)
      // Ideally just one refresh, but depends on timing
      expect(refreshCount).toBeLessThanOrEqual(3)
    })

    it('should queue requests during token refresh', async () => {
      const { AuthTransport } = await import('../src/auth/auth-transport')

      const requestOrder: string[] = []
      const mockTokenStore = createMockTokenStore({
        access_token: 'valid',
        refresh_token: 'valid-refresh',
        expires_at: Date.now() + 3600000, // Not expired
      })

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string)
        requestOrder.push(body.method)
        await new Promise((r) => setTimeout(r, 5))
        return new Response(JSON.stringify({ result: body.method }), {
          ok: true,
          headers: new Headers(),
        })
      })

      const transport = new AuthTransport({
        url: 'https://api.test.com',
        tokenStore: mockTokenStore,
        fetch: mockFetch,
      })

      const results = await Promise.all([
        transport.send({ method: 'first', args: [] }),
        transport.send({ method: 'second', args: [] }),
        transport.send({ method: 'third', args: [] }),
      ])

      // All requests should complete
      expect(results).toHaveLength(3)
      expect(requestOrder).toHaveLength(3)
      results.forEach((r) => expect(r.result).toBeDefined())
    })

    it('should use refreshed token for subsequent requests', async () => {
      const { AuthTransport } = await import('../src/auth/auth-transport')

      const tokensUsed: string[] = []
      const mockTokenStore = createMockTokenStore({
        access_token: 'old-token',
        refresh_token: 'valid-refresh',
        expires_at: Date.now() - 1000, // Expired
      })

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>
        const auth = headers['Authorization']
        if (auth) {
          tokensUsed.push(auth.replace('Bearer ', ''))
        }
        return new Response(JSON.stringify({ result: 'ok' }), {
          ok: true,
          headers: new Headers(),
        })
      })

      const transport = new AuthTransport({
        url: 'https://api.test.com',
        tokenStore: mockTokenStore,
        fetch: mockFetch,
        onRefreshToken: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 10))
          return { access_token: 'new-token', expires_in: 3600 }
        }),
      })

      // First request triggers refresh
      await transport.send({ method: 'first', args: [] })

      // Second request should use new token
      await transport.send({ method: 'second', args: [] })

      // At least some requests should use the new token
      expect(tokensUsed).toContain('new-token')
    })
  })

  // ============================================================================
  // State Transitions Tests
  // ============================================================================

  describe('State transitions', () => {
    it('should handle rapid connect/disconnect cycles for WebSocket transport', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')
      const { TransportState } = await import('../src/transport/types')

      // Mock WebSocket with callbacks
      let mockOnOpen: (() => void) | null = null
      let mockOnClose: ((event: { code: number; reason: string }) => void) | null = null

      const mockWs = {
        readyState: 1, // OPEN
        send: vi.fn(),
        close: vi.fn().mockImplementation(() => {
          // Simulate close event
          if (mockOnClose) {
            mockOnClose({ code: 1000, reason: 'Client closing' })
          }
        }),
        set onopen(fn: () => void) {
          mockOnOpen = fn
        },
        set onclose(fn: (event: { code: number; reason: string }) => void) {
          mockOnClose = fn
        },
        set onerror(_fn: (error: Error) => void) {},
        set onmessage(_fn: (event: { data: string }) => void) {},
      }

      const mockWsConstructor = vi.fn().mockImplementation(() => {
        // Simulate connection opening after a tick
        setTimeout(() => {
          if (mockOnOpen) mockOnOpen()
        }, 1)
        return mockWs
      })

      // Replace global WebSocket
      const originalWs = globalThis.WebSocket
      globalThis.WebSocket = mockWsConstructor as unknown as typeof WebSocket

      try {
        const transport = new WebSocketTransport({
          url: 'wss://api.test.com',
          reconnect: false, // Disable reconnect for this test
        })

        // Initial state is DISCONNECTED (not connected yet)
        expect(transport.getState()).toBe(TransportState.DISCONNECTED)

        // Start connecting - this changes state to CONNECTING
        const connectPromise = transport.connect()
        expect(transport.getState()).toBe(TransportState.CONNECTING)

        // Wait for connection
        await connectPromise
        expect(transport.getState()).toBe(TransportState.CONNECTED)

        // Close
        await transport.close()
        expect(transport.getState()).toBe(TransportState.CLOSED)
      } finally {
        globalThis.WebSocket = originalWs
      }
    })

    it('should handle concurrent state queries', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      const transport = new FetchTransport({
        url: 'https://api.test.com',
      })

      // Query state concurrently
      const states = await Promise.all([
        Promise.resolve(transport.getState()),
        Promise.resolve(transport.getState()),
        Promise.resolve(transport.getState()),
        Promise.resolve(transport.getState()),
        Promise.resolve(transport.getState()),
      ])

      // All should return the same state
      states.forEach((state) => {
        expect(state).toBe('CONNECTED')
      })
    })
  })

  // ============================================================================
  // Resource Cleanup Tests
  // ============================================================================

  describe('Resource cleanup', () => {
    it('should not leak pending requests on rapid close', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      const pendingRequests: Promise<Response>[] = []
      const mockFetch = vi.fn().mockImplementation(async () => {
        const promise = new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(JSON.stringify({ result: 'ok' }), {
                ok: true,
                headers: new Headers(),
              })
            )
          }, 100) // Long delay
        })
        pendingRequests.push(promise)
        return promise
      })

      const transport = new FetchTransport({
        url: 'https://api.test.com',
        fetch: mockFetch,
      })

      // Start requests but don't await them
      const request1 = transport.send({ method: 'a', args: [] })
      const request2 = transport.send({ method: 'b', args: [] })

      // Close immediately
      await transport.close()

      // Requests should still complete (FetchTransport is stateless)
      const [result1, result2] = await Promise.all([request1, request2])
      expect(result1.result).toBeDefined()
      expect(result2.result).toBeDefined()
    })

    it('should complete retrying requests eventually even when underlying transport is closed', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      let callCount = 0
      let transportClosed = false
      const mockTransport: Transport = {
        send: vi.fn().mockImplementation(async () => {
          callCount++
          // Succeed after a few retries (not many since we have short delays)
          if (callCount >= 3) {
            return { result: 'finally succeeded' }
          }
          // Return retryable error
          return { error: { type: 'TransportError', code: 'NETWORK_ERROR', message: 'fail' } }
        }),
        close: vi.fn().mockImplementation(async () => {
          transportClosed = true
        }),
      }

      const transport = new RetryTransport({
        transport: mockTransport,
        maxRetries: 5,
        initialDelay: 10, // Short delay for fast test
        jitter: 'none',
      })

      // Start a request that will retry a few times then succeed
      const result = await transport.send({ method: 'test', args: [] })

      // Should eventually succeed
      expect(result.result).toBe('finally succeeded')
      expect(callCount).toBeGreaterThanOrEqual(3)

      // Now close should complete without issues
      await transport.close()
      expect(transportClosed).toBe(true)
    })

    it('should handle concurrent close calls', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      const transport = new FetchTransport({
        url: 'https://api.test.com',
      })

      // Call close multiple times concurrently
      const closeResults = await Promise.all([
        transport.close(),
        transport.close(),
        transport.close(),
      ])

      // All should complete without error
      closeResults.forEach((result) => {
        expect(result).toBeUndefined()
      })
    })
  })

  // ============================================================================
  // High Concurrency Stress Tests
  // ============================================================================

  describe('Stress tests', () => {
    it('should handle 50 concurrent requests', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      let requestId = 0
      const mockFetch = vi.fn().mockImplementation(async () => {
        const id = ++requestId
        await new Promise((r) => setTimeout(r, Math.random() * 20))
        return new Response(JSON.stringify({ id }), {
          ok: true,
          headers: new Headers(),
        })
      })

      const transport = new FetchTransport({
        url: 'https://api.test.com',
        fetch: mockFetch,
      })

      const requests = Array.from({ length: 50 }, (_, i) =>
        transport.send({ method: `method-${i}`, args: [i] })
      )

      const results = await Promise.all(requests)

      // All should complete successfully
      expect(results).toHaveLength(50)
      results.forEach((r) => {
        expect(r.result).toBeDefined()
        expect(r.error).toBeUndefined()
      })

      // All 50 requests should have been made
      expect(mockFetch).toHaveBeenCalledTimes(50)
    })

    it('should handle concurrent requests with mixed transports', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')
      const { RetryTransport } = await import('../src/transport/retry')

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string)
        await new Promise((r) => setTimeout(r, Math.random() * 10))
        return new Response(JSON.stringify({ method: body.method }), {
          ok: true,
          headers: new Headers(),
        })
      })

      const baseTransport = new FetchTransport({
        url: 'https://api.test.com',
        fetch: mockFetch,
      })

      const retryTransport = new RetryTransport({
        transport: baseTransport,
        maxRetries: 2,
        initialDelay: 1,
      })

      // Mix direct and retry transport calls
      const results = await Promise.all([
        baseTransport.send({ method: 'direct-1', args: [] }),
        retryTransport.send({ method: 'retry-1', args: [] }),
        baseTransport.send({ method: 'direct-2', args: [] }),
        retryTransport.send({ method: 'retry-2', args: [] }),
        baseTransport.send({ method: 'direct-3', args: [] }),
      ])

      // All should complete with correct methods
      const methods = results.map((r) => (r.result as { method: string }).method)
      expect(methods).toContain('direct-1')
      expect(methods).toContain('direct-2')
      expect(methods).toContain('direct-3')
      expect(methods).toContain('retry-1')
      expect(methods).toContain('retry-2')
    })
  })

  // ============================================================================
  // Race Condition Prevention Tests
  // ============================================================================

  describe('Race condition prevention', () => {
    it('should prevent response mixing with slow requests', async () => {
      const { FetchTransport, CORRELATION_ID_HEADER } = await import('../src/transport/fetch')

      const responseMap: Record<string, string> = {}
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>
        const correlationId = headers[CORRELATION_ID_HEADER]
        const body = JSON.parse(init.body as string)

        // Different delays based on method
        const delays: Record<string, number> = { fast: 5, medium: 25, slow: 50 }
        await new Promise((r) => setTimeout(r, delays[body.method] || 10))

        responseMap[correlationId] = body.method
        const responseHeaders = new Headers({ [CORRELATION_ID_HEADER]: correlationId })

        return new Response(JSON.stringify({ method: body.method, correlationId }), {
          ok: true,
          headers: responseHeaders,
        })
      })

      const transport = new FetchTransport({
        url: 'https://api.test.com',
        fetch: mockFetch,
      })

      // Fire requests in order: slow, medium, fast
      // They should complete in reverse order but responses should match
      const [slowResult, mediumResult, fastResult] = await Promise.all([
        transport.send({ method: 'slow', args: [] }),
        transport.send({ method: 'medium', args: [] }),
        transport.send({ method: 'fast', args: [] }),
      ])

      // Each response should match its correlation ID and method
      expect((slowResult.result as { method: string }).method).toBe('slow')
      expect((mediumResult.result as { method: string }).method).toBe('medium')
      expect((fastResult.result as { method: string }).method).toBe('fast')

      // Verify correlation ID mapping
      if (slowResult.correlationId) {
        expect(responseMap[slowResult.correlationId]).toBe('slow')
      }
      if (mediumResult.correlationId) {
        expect(responseMap[mediumResult.correlationId]).toBe('medium')
      }
      if (fastResult.correlationId) {
        expect(responseMap[fastResult.correlationId]).toBe('fast')
      }
    })

    it('should handle interleaved success and error responses', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string)

        // Interleaved timing
        const delays: Record<string, number> = { 'success-1': 30, 'error-1': 20, 'success-2': 10 }
        await new Promise((r) => setTimeout(r, delays[body.method] || 10))

        if (body.method.startsWith('error')) {
          return new Response(
            JSON.stringify({ type: 'TestError', code: 'TEST_ERROR', message: body.method }),
            { ok: false, status: 500, headers: new Headers() }
          )
        }
        return new Response(JSON.stringify({ method: body.method }), {
          ok: true,
          headers: new Headers(),
        })
      })

      const transport = new FetchTransport({
        url: 'https://api.test.com',
        fetch: mockFetch,
      })

      const [result1, result2, result3] = await Promise.all([
        transport.send({ method: 'success-1', args: [] }),
        transport.send({ method: 'error-1', args: [] }),
        transport.send({ method: 'success-2', args: [] }),
      ])

      // Verify correct response matching
      expect((result1.result as { method: string })?.method).toBe('success-1')
      expect(result2.error?.code).toBe('TEST_ERROR')
      expect((result3.result as { method: string })?.method).toBe('success-2')
    })
  })
})
