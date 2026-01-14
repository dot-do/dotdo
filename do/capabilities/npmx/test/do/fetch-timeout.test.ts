/**
 * Fetch Timeout Tests
 *
 * TDD tests for registry fetch timeout functionality.
 * Tests verify that slow/unresponsive registry calls timeout properly.
 *
 * @module npmx/test/do/fetch-timeout.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchWithTimeout,
  FetchTimeoutError,
  DEFAULT_FETCH_TIMEOUT,
  type FetchTimeoutOptions,
} from '../../do/fetch-timeout.js'

/**
 * Creates a mock fetch that properly responds to abort signals
 * This simulates how real fetch behaves with AbortController
 */
function createAbortableFetch(
  resolveWith?: Response,
  rejectWith?: Error,
  resolveDelay?: number
): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal

      // If already aborted, reject immediately
      if (signal?.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
        return
      }

      // Listen for abort
      const abortHandler = () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }

      signal?.addEventListener('abort', abortHandler, { once: true })

      // Handle resolve/reject if provided
      if (rejectWith) {
        reject(rejectWith)
        return
      }

      if (resolveWith) {
        if (resolveDelay) {
          setTimeout(() => {
            signal?.removeEventListener('abort', abortHandler)
            resolve(resolveWith)
          }, resolveDelay)
        } else {
          signal?.removeEventListener('abort', abortHandler)
          resolve(resolveWith)
        }
      }
      // Otherwise the promise just hangs (for timeout testing)
    })
  }) as typeof fetch
}

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('successful requests', () => {
    it('should return response for fast requests', async () => {
      const mockResponse = new Response(JSON.stringify({ name: 'lodash' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

      vi.spyOn(globalThis, 'fetch').mockImplementation(createAbortableFetch(mockResponse))

      const responsePromise = fetchWithTimeout('https://registry.npmjs.org/lodash')

      // Let the promise resolve
      await vi.runAllTimersAsync()

      const response = await responsePromise
      expect(response.ok).toBe(true)

      const data = await response.json()
      expect(data.name).toBe('lodash')
    })

    it('should pass through request options', async () => {
      const mockResponse = new Response('{}', { status: 200 })
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(createAbortableFetch(mockResponse))

      const options: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      }

      const responsePromise = fetchWithTimeout('https://example.com', options)
      await vi.runAllTimersAsync()
      await responsePromise

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test: true }),
        })
      )
    })
  })

  describe('timeout behavior', () => {
    it('should timeout after default 30s for slow requests', async () => {
      // Create a fetch that never resolves (simulates slow registry)
      vi.spyOn(globalThis, 'fetch').mockImplementation(createAbortableFetch())

      const responsePromise = fetchWithTimeout('https://registry.npmjs.org/slow-package')

      // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection
      const errorPromise = responsePromise.catch((e) => e as Error)

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(30001)

      const caughtError = await errorPromise

      expect(caughtError).toBeInstanceOf(FetchTimeoutError)
      expect(caughtError?.message).toMatch(/timed out after 30000ms/)
    })

    it('should use custom timeout when specified', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(createAbortableFetch())

      const responsePromise = fetchWithTimeout(
        'https://registry.npmjs.org/package',
        {},
        { timeout: 5000 }
      )

      // Attach rejection handler BEFORE advancing timers
      const errorPromise = responsePromise.catch((e) => e as Error)

      // Should timeout at 5s
      await vi.advanceTimersByTimeAsync(5001)

      const caughtError = await errorPromise

      expect(caughtError).toBeInstanceOf(FetchTimeoutError)
      expect(caughtError?.message).toMatch(/timed out after 5000ms/)
    })

    it('should include URL in timeout error message', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(createAbortableFetch())

      const url = 'https://registry.npmjs.org/test-package'
      const responsePromise = fetchWithTimeout(url, {}, { timeout: 1000 })

      // Attach rejection handler BEFORE advancing timers
      const errorPromise = responsePromise.catch((e) => e as Error)

      await vi.advanceTimersByTimeAsync(1001)

      const caughtError = await errorPromise

      expect(caughtError?.message).toContain(url)
    })

    it('should clear timeout on successful response', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

      vi.spyOn(globalThis, 'fetch').mockImplementation(
        createAbortableFetch(new Response('{}', { status: 200 }))
      )

      const responsePromise = fetchWithTimeout('https://example.com')
      await vi.runAllTimersAsync()
      await responsePromise

      expect(clearTimeoutSpy).toHaveBeenCalled()
    })

    it('should clear timeout on fetch error', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

      vi.spyOn(globalThis, 'fetch').mockImplementation(
        createAbortableFetch(undefined, new Error('Network error'))
      )

      const responsePromise = fetchWithTimeout('https://example.com')

      // Attach rejection handler BEFORE running timers
      const errorPromise = responsePromise.catch((e) => e as Error)

      await vi.runAllTimersAsync()

      const caughtError = await errorPromise

      expect(caughtError?.message).toBe('Network error')
      expect(clearTimeoutSpy).toHaveBeenCalled()
    })
  })

  describe('AbortController behavior', () => {
    it('should abort fetch when timeout occurs', async () => {
      let abortSignal: AbortSignal | undefined

      vi.spyOn(globalThis, 'fetch').mockImplementation((_, init) => {
        abortSignal = (init as RequestInit)?.signal
        return createAbortableFetch()(_, init as RequestInit)
      })

      const responsePromise = fetchWithTimeout(
        'https://example.com',
        {},
        { timeout: 1000 }
      )

      // Attach rejection handler BEFORE advancing timers
      const errorPromise = responsePromise.catch((e) => e as Error)

      await vi.advanceTimersByTimeAsync(1001)

      expect(abortSignal?.aborted).toBe(true)

      const caughtError = await errorPromise

      expect(caughtError).toBeInstanceOf(FetchTimeoutError)
    })

    it('should merge with existing signal', async () => {
      const userController = new AbortController()
      let receivedSignal: AbortSignal | undefined

      vi.spyOn(globalThis, 'fetch').mockImplementation((_, init) => {
        receivedSignal = (init as RequestInit)?.signal
        return createAbortableFetch(new Response('{}', { status: 200 }))(_, init as RequestInit)
      })

      const responsePromise = fetchWithTimeout(
        'https://example.com',
        { signal: userController.signal },
        { timeout: 30000 }
      )

      await vi.runAllTimersAsync()
      await responsePromise

      // The signal passed should be defined (either combined or from timeout)
      expect(receivedSignal).toBeDefined()
    })
  })

  describe('FetchTimeoutError', () => {
    it('should have correct name', () => {
      const error = new FetchTimeoutError('https://example.com', 1000)
      expect(error.name).toBe('FetchTimeoutError')
    })

    it('should have correct message format', () => {
      const error = new FetchTimeoutError('https://example.com/test', 5000)
      expect(error.message).toBe('Fetch to https://example.com/test timed out after 5000ms')
    })

    it('should expose url and timeout properties', () => {
      const error = new FetchTimeoutError('https://example.com', 3000)
      expect(error.url).toBe('https://example.com')
      expect(error.timeout).toBe(3000)
    })

    it('should be instanceof Error', () => {
      const error = new FetchTimeoutError('https://example.com', 1000)
      expect(error).toBeInstanceOf(Error)
    })

    it('should have code property for identification', () => {
      const error = new FetchTimeoutError('https://example.com', 1000)
      expect(error.code).toBe('ETIMEDOUT')
    })
  })

  describe('DEFAULT_FETCH_TIMEOUT', () => {
    it('should be 30 seconds (30000ms)', () => {
      expect(DEFAULT_FETCH_TIMEOUT).toBe(30000)
    })
  })

  describe('retry functionality', () => {
    it('should retry on timeout when retries > 0', async () => {
      let callCount = 0

      vi.spyOn(globalThis, 'fetch').mockImplementation((_, init) => {
        callCount++
        if (callCount === 1) {
          // First call - simulate slow request that will timeout
          return createAbortableFetch()(_, init as RequestInit)
        }
        // Second call succeeds immediately
        return Promise.resolve(new Response('{"success": true}', { status: 200 }))
      })

      const responsePromise = fetchWithTimeout(
        'https://example.com',
        {},
        { timeout: 1000, retries: 1 }
      )

      // First timeout triggers retry
      await vi.advanceTimersByTimeAsync(1001)

      // Let the retry complete
      await vi.runAllTimersAsync()

      const response = await responsePromise
      expect(response.ok).toBe(true)
      expect(callCount).toBe(2)
    })

    it('should throw after exhausting all retries', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(createAbortableFetch())

      const responsePromise = fetchWithTimeout(
        'https://example.com',
        {},
        { timeout: 1000, retries: 2 }
      )

      // Attach rejection handler BEFORE advancing timers
      const errorPromise = responsePromise.catch((e) => e as Error)

      // First timeout
      await vi.advanceTimersByTimeAsync(1001)
      // Second timeout (retry 1)
      await vi.advanceTimersByTimeAsync(1001)
      // Third timeout (retry 2)
      await vi.advanceTimersByTimeAsync(1001)

      const caughtError = await errorPromise

      expect(caughtError).toBeInstanceOf(FetchTimeoutError)
    })

    it('should use exponential backoff between retries when configured', async () => {
      let callCount = 0

      vi.spyOn(globalThis, 'fetch').mockImplementation((_, init) => {
        callCount++
        // All calls timeout
        return createAbortableFetch()(_, init as RequestInit)
      })

      const responsePromise = fetchWithTimeout(
        'https://example.com',
        {},
        { timeout: 100, retries: 2, retryBackoff: 50 }
      )

      // Initial call starts immediately
      expect(callCount).toBe(1)

      // First timeout (100ms) triggers retry after backoff (50ms)
      await vi.advanceTimersByTimeAsync(100)
      // Fetch call happens, then backoff starts
      await vi.advanceTimersByTimeAsync(50)
      expect(callCount).toBe(2)

      // Second timeout (100ms) triggers retry after doubled backoff (100ms)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)
      expect(callCount).toBe(3)

      // Final timeout - no more retries
      await vi.advanceTimersByTimeAsync(101)

      // Capture error once to avoid unhandled rejection warnings
      let caughtError: Error | undefined
      try {
        await responsePromise
      } catch (e) {
        caughtError = e as Error
      }

      expect(caughtError).toBeInstanceOf(FetchTimeoutError)
    })

    it('should not retry on non-timeout errors', async () => {
      let callCount = 0

      vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        callCount++
        return Promise.reject(new Error('Network error'))
      })

      const responsePromise = fetchWithTimeout(
        'https://example.com',
        {},
        { timeout: 1000, retries: 2 }
      )

      await vi.runAllTimersAsync()

      // Capture error once to avoid unhandled rejection warnings
      let caughtError: Error | undefined
      try {
        await responsePromise
      } catch (e) {
        caughtError = e as Error
      }

      expect(caughtError?.message).toBe('Network error')
      expect(callCount).toBe(1)
    })
  })

  describe('options type', () => {
    it('should accept FetchTimeoutOptions with all properties', () => {
      const options: FetchTimeoutOptions = {
        timeout: 5000,
        retries: 3,
        retryBackoff: 100,
      }

      // Type check - this should compile
      expect(options.timeout).toBe(5000)
      expect(options.retries).toBe(3)
      expect(options.retryBackoff).toBe(100)
    })

    it('should allow partial options', () => {
      const options: FetchTimeoutOptions = {
        timeout: 5000,
      }

      expect(options.timeout).toBe(5000)
      expect(options.retries).toBeUndefined()
    })
  })
})
