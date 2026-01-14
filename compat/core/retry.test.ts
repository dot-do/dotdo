/**
 * @dotdo/compat/core - Retry/Backoff Infrastructure Tests
 *
 * Tests for unified retry/backoff infrastructure across compat SDKs.
 * These tests define expected behavior for:
 * - Exponential backoff with jitter
 * - Retry decisions based on HTTP status codes
 * - Retry-After header handling
 * - Circuit breaker pattern
 * - Retry context and observability
 *
 * @note These tests are written against interfaces that DO NOT YET EXIST.
 *       They should fail until the retry infrastructure is implemented.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Expected Interfaces (not yet implemented)
// These interfaces define the contract for the retry infrastructure
// =============================================================================

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay: number
  /** Maximum delay cap in milliseconds (default: 32000) */
  maxDelay: number
  /** Backoff multiplier (default: 2) */
  multiplier: number
  /** Jitter factor 0-1 (default: 0.25 for +/-25%) */
  jitter: number
  /** Total timeout budget in milliseconds (default: 60000) */
  timeoutBudget: number
  /** Optional circuit breaker config */
  circuitBreaker?: CircuitBreakerConfig
}

/**
 * Context passed to retry decision functions
 */
export interface RetryContext {
  /** Current attempt number (1-based) */
  attempt: number
  /** Total elapsed time in milliseconds */
  elapsedTime: number
  /** The error that caused the retry */
  error: Error | Response
  /** Configuration being used */
  config: RetryConfig
}

/**
 * Event emitted during retry operations
 */
export interface RetryEvent {
  type: 'retry' | 'success' | 'exhausted' | 'circuit-open'
  attempt: number
  delay?: number
  error?: Error
  elapsedTime: number
}

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures to open circuit (default: 5) */
  failureThreshold: number
  /** Cooldown period in milliseconds before half-open (default: 30000) */
  cooldownPeriod: number
  /** Number of successes in half-open to close circuit (default: 1) */
  successThreshold: number
}

/**
 * Circuit breaker interface
 */
export interface ICircuitBreaker {
  getState(): CircuitState
  isRequestAllowed(): boolean
  recordSuccess(): void
  recordFailure(): void
}

/**
 * Main retry handler interface
 */
export interface RetryHandler {
  /** Execute a function with retry logic */
  execute<T>(fn: () => Promise<T>): Promise<T>
  /** Execute a fetch request with retry logic */
  fetch(url: string, options?: RequestInit): Promise<Response>
  /** Check if a response should be retried */
  shouldRetry(response: Response): boolean
  /** Calculate delay for next retry */
  calculateDelay(attempt: number, retryAfter?: number): number
  /** Subscribe to retry events */
  onRetry(handler: (event: RetryEvent) => void): () => void
  /** Get current circuit breaker state */
  getCircuitState(): CircuitState
}

// =============================================================================
// Placeholder implementations that will be replaced by real implementation
// These all throw "not implemented" to make tests fail appropriately
// =============================================================================

function createRetryHandler(_config?: Partial<RetryConfig>): RetryHandler {
  throw new Error('createRetryHandler is not implemented - retry infrastructure needs to be built')
}

function isRetryableStatus(_status: number): boolean {
  throw new Error('isRetryableStatus is not implemented - retry infrastructure needs to be built')
}

function parseRetryAfter(_headers: Headers, _maxDelay?: number): number | undefined {
  throw new Error('parseRetryAfter is not implemented - retry infrastructure needs to be built')
}

function calculateExponentialBackoff(_attempt: number, _config: RetryConfig): number {
  throw new Error('calculateExponentialBackoff is not implemented - retry infrastructure needs to be built')
}

class CircuitBreaker implements ICircuitBreaker {
  constructor(_config: CircuitBreakerConfig) {
    throw new Error('CircuitBreaker is not implemented - retry infrastructure needs to be built')
  }
  getState(): CircuitState {
    throw new Error('CircuitBreaker.getState is not implemented')
  }
  isRequestAllowed(): boolean {
    throw new Error('CircuitBreaker.isRequestAllowed is not implemented')
  }
  recordSuccess(): void {
    throw new Error('CircuitBreaker.recordSuccess is not implemented')
  }
  recordFailure(): void {
    throw new Error('CircuitBreaker.recordFailure is not implemented')
  }
}

const DEFAULT_RETRY_CONFIG: RetryConfig = undefined as unknown as RetryConfig

// =============================================================================
// Test Helpers
// =============================================================================

function createMockResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: getStatusText(status),
    headers: new Headers(headers),
    json: async () => ({}),
    text: async () => '',
    clone: () => createMockResponse(status, headers),
  } as Response
}

function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  }
  return statusTexts[status] ?? 'Unknown'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// =============================================================================
// Exponential Backoff Tests
// =============================================================================

describe('Exponential Backoff', () => {
  describe('calculateExponentialBackoff', () => {
    it('doubles delay on each retry', () => {
      // Base delay: 1000ms, multiplier: 2
      // Attempt 1: 1000ms
      // Attempt 2: 2000ms
      // Attempt 3: 4000ms
      // Attempt 4: 8000ms
      const config: RetryConfig = {
        maxRetries: 5,
        initialDelay: 1000,
        maxDelay: 32000,
        multiplier: 2,
        jitter: 0, // No jitter for predictable testing
        timeoutBudget: 60000,
      }

      const delay1 = calculateExponentialBackoff(1, config)
      const delay2 = calculateExponentialBackoff(2, config)
      const delay3 = calculateExponentialBackoff(3, config)
      const delay4 = calculateExponentialBackoff(4, config)

      expect(delay1).toBe(1000)
      expect(delay2).toBe(2000)
      expect(delay3).toBe(4000)
      expect(delay4).toBe(8000)
    })

    it('respects maxDelay cap', () => {
      const config: RetryConfig = {
        maxRetries: 10,
        initialDelay: 1000,
        maxDelay: 5000, // Cap at 5 seconds
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 60000,
      }

      // Attempt 4 would be 8000ms without cap
      const delay4 = calculateExponentialBackoff(4, config)
      const delay5 = calculateExponentialBackoff(5, config)
      const delay10 = calculateExponentialBackoff(10, config)

      expect(delay4).toBe(5000) // Capped
      expect(delay5).toBe(5000) // Capped
      expect(delay10).toBe(5000) // Capped
    })

    it('adds jitter to prevent thundering herd', () => {
      const config: RetryConfig = {
        maxRetries: 5,
        initialDelay: 1000,
        maxDelay: 32000,
        multiplier: 2,
        jitter: 0.25, // +/- 25%
        timeoutBudget: 60000,
      }

      // Collect multiple samples to verify jitter distribution
      const samples: number[] = []
      for (let i = 0; i < 100; i++) {
        samples.push(calculateExponentialBackoff(1, config))
      }

      // All samples should be within 750ms - 1250ms (1000 +/- 25%)
      const minExpected = 750
      const maxExpected = 1250

      for (const sample of samples) {
        expect(sample).toBeGreaterThanOrEqual(minExpected)
        expect(sample).toBeLessThanOrEqual(maxExpected)
      }

      // Verify there's actual variance (not all the same value)
      const uniqueValues = new Set(samples)
      expect(uniqueValues.size).toBeGreaterThan(1)
    })

    it('starts at initialDelay', () => {
      const config: RetryConfig = {
        maxRetries: 5,
        initialDelay: 500, // Start at 500ms
        maxDelay: 32000,
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 60000,
      }

      const delay1 = calculateExponentialBackoff(1, config)
      expect(delay1).toBe(500)
    })
  })
})

// =============================================================================
// Retry Decision Tests
// =============================================================================

describe('Retry Decisions', () => {
  describe('isRetryableStatus', () => {
    it('retries on 429 Too Many Requests', () => {
      expect(isRetryableStatus(429)).toBe(true)
    })

    it('retries on 500 Internal Server Error', () => {
      expect(isRetryableStatus(500)).toBe(true)
    })

    it('retries on 502 Bad Gateway', () => {
      expect(isRetryableStatus(502)).toBe(true)
    })

    it('retries on 503 Service Unavailable', () => {
      expect(isRetryableStatus(503)).toBe(true)
    })

    it('retries on 504 Gateway Timeout', () => {
      expect(isRetryableStatus(504)).toBe(true)
    })

    it('does NOT retry on 400 Bad Request', () => {
      expect(isRetryableStatus(400)).toBe(false)
    })

    it('does NOT retry on 401 Unauthorized', () => {
      expect(isRetryableStatus(401)).toBe(false)
    })

    it('does NOT retry on 403 Forbidden', () => {
      expect(isRetryableStatus(403)).toBe(false)
    })

    it('does NOT retry on 404 Not Found', () => {
      expect(isRetryableStatus(404)).toBe(false)
    })

    it('does NOT retry on 422 Unprocessable Entity', () => {
      expect(isRetryableStatus(422)).toBe(false)
    })
  })

  describe('RetryHandler.shouldRetry', () => {
    it('returns true for retryable responses', () => {
      const handler = createRetryHandler()
      const response429 = createMockResponse(429)
      const response500 = createMockResponse(500)
      const response502 = createMockResponse(502)

      expect(handler.shouldRetry(response429)).toBe(true)
      expect(handler.shouldRetry(response500)).toBe(true)
      expect(handler.shouldRetry(response502)).toBe(true)
    })

    it('returns false for non-retryable responses', () => {
      const handler = createRetryHandler()
      const response400 = createMockResponse(400)
      const response401 = createMockResponse(401)
      const response404 = createMockResponse(404)

      expect(handler.shouldRetry(response400)).toBe(false)
      expect(handler.shouldRetry(response401)).toBe(false)
      expect(handler.shouldRetry(response404)).toBe(false)
    })
  })
})

// =============================================================================
// Retry-After Header Tests
// =============================================================================

describe('Retry-After Header', () => {
  describe('parseRetryAfter', () => {
    it('honors Retry-After seconds', () => {
      const headers = new Headers({ 'Retry-After': '5' })
      const delay = parseRetryAfter(headers)

      expect(delay).toBe(5000) // 5 seconds in milliseconds
    })

    it('honors Retry-After date', () => {
      // Set a date 10 seconds in the future
      const futureDate = new Date(Date.now() + 10000)
      const httpDate = futureDate.toUTCString()
      const headers = new Headers({ 'Retry-After': httpDate })

      const delay = parseRetryAfter(headers)

      // Allow some tolerance for test execution time
      expect(delay).toBeGreaterThanOrEqual(9000)
      expect(delay).toBeLessThanOrEqual(11000)
    })

    it('caps Retry-After at maxDelay', () => {
      const headers = new Headers({ 'Retry-After': '300' }) // 5 minutes
      const maxDelay = 30000 // 30 seconds cap

      const delay = parseRetryAfter(headers, maxDelay)

      expect(delay).toBe(30000) // Capped at maxDelay
    })

    it('returns undefined for missing header', () => {
      const headers = new Headers()
      const delay = parseRetryAfter(headers)

      expect(delay).toBeUndefined()
    })

    it('returns undefined for invalid header value', () => {
      const headers = new Headers({ 'Retry-After': 'invalid' })
      const delay = parseRetryAfter(headers)

      expect(delay).toBeUndefined()
    })
  })

  describe('RetryHandler with Retry-After', () => {
    it('uses Retry-After header when present', () => {
      const handler = createRetryHandler({
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 32000,
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 60000,
      })

      // calculateDelay should prefer Retry-After over exponential backoff
      const delay = handler.calculateDelay(1, 3000) // retryAfter = 3000ms

      expect(delay).toBe(3000) // Should use Retry-After value
    })

    it('falls back to exponential backoff without Retry-After', () => {
      const handler = createRetryHandler({
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 32000,
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 60000,
      })

      const delay = handler.calculateDelay(2, undefined)

      expect(delay).toBe(2000) // Second attempt exponential backoff
    })
  })
})

// =============================================================================
// Circuit Breaker Tests
// =============================================================================

describe('Circuit Breaker', () => {
  describe('state transitions', () => {
    it('opens circuit after consecutive failures', () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        cooldownPeriod: 1000,
        successThreshold: 1,
      })

      // Initial state should be closed
      expect(circuitBreaker.getState()).toBe('closed')

      // Record 3 consecutive failures
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()

      // Circuit should now be open
      expect(circuitBreaker.getState()).toBe('open')
    })

    it('half-opens circuit after cooldown', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        cooldownPeriod: 100, // 100ms for fast tests
        successThreshold: 1,
      })

      // Open the circuit
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()
      expect(circuitBreaker.getState()).toBe('open')

      // Wait for cooldown
      await sleep(150)

      // Circuit should be half-open
      expect(circuitBreaker.getState()).toBe('half-open')
    })

    it('closes circuit on success', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        cooldownPeriod: 100,
        successThreshold: 1,
      })

      // Open the circuit
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()
      expect(circuitBreaker.getState()).toBe('open')

      // Wait for cooldown to half-open
      await sleep(150)
      expect(circuitBreaker.getState()).toBe('half-open')

      // Record success
      circuitBreaker.recordSuccess()

      // Circuit should be closed
      expect(circuitBreaker.getState()).toBe('closed')
    })

    it('reopens circuit on failure in half-open state', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        cooldownPeriod: 100,
        successThreshold: 1,
      })

      // Open the circuit
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()

      // Wait for cooldown to half-open
      await sleep(150)
      expect(circuitBreaker.getState()).toBe('half-open')

      // Record failure in half-open
      circuitBreaker.recordFailure()

      // Circuit should be open again
      expect(circuitBreaker.getState()).toBe('open')
    })
  })

  describe('reports circuit state', () => {
    it('provides current state', () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        cooldownPeriod: 1000,
        successThreshold: 1,
      })

      expect(circuitBreaker.getState()).toBe('closed')

      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()

      expect(circuitBreaker.getState()).toBe('open')
    })

    it('reports whether requests are allowed', () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        cooldownPeriod: 1000,
        successThreshold: 1,
      })

      expect(circuitBreaker.isRequestAllowed()).toBe(true)

      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()

      expect(circuitBreaker.isRequestAllowed()).toBe(false)
    })

    it('allows one test request in half-open state', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        cooldownPeriod: 100,
        successThreshold: 1,
      })

      // Open the circuit
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()

      // Wait for cooldown
      await sleep(150)

      // Half-open should allow one request
      expect(circuitBreaker.isRequestAllowed()).toBe(true)
    })
  })

  describe('resets failure count on success', () => {
    it('resets consecutive failure count after success', () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        cooldownPeriod: 1000,
        successThreshold: 1,
      })

      // Record some failures (but not enough to open)
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()
      expect(circuitBreaker.getState()).toBe('closed')

      // Record success
      circuitBreaker.recordSuccess()

      // Record failures again - should need full threshold
      circuitBreaker.recordFailure()
      circuitBreaker.recordFailure()
      expect(circuitBreaker.getState()).toBe('closed') // Still closed

      circuitBreaker.recordFailure()
      expect(circuitBreaker.getState()).toBe('open') // Now open
    })
  })
})

// =============================================================================
// Retry Context Tests
// =============================================================================

describe('Retry Context', () => {
  describe('tracks attempt number', () => {
    it('provides correct attempt count to handlers', async () => {
      const attempts: number[] = []
      const handler = createRetryHandler({
        maxRetries: 3,
        initialDelay: 10, // Fast for tests
        maxDelay: 100,
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 5000,
      })

      let callCount = 0
      const mockFn = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount < 3) {
          throw new Error('Transient error')
        }
        return 'success'
      })

      handler.onRetry((event) => {
        attempts.push(event.attempt)
      })

      await handler.execute(mockFn)

      expect(attempts).toEqual([1, 2])
    })
  })

  describe('tracks total elapsed time', () => {
    it('reports elapsed time in retry events', async () => {
      const elapsedTimes: number[] = []
      const handler = createRetryHandler({
        maxRetries: 3,
        initialDelay: 50,
        maxDelay: 200,
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 5000,
      })

      let callCount = 0
      const mockFn = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount < 3) {
          throw new Error('Transient error')
        }
        return 'success'
      })

      handler.onRetry((event) => {
        elapsedTimes.push(event.elapsedTime)
      })

      await handler.execute(mockFn)

      // First retry should have some elapsed time
      expect(elapsedTimes[0]).toBeGreaterThan(0)
      // Second retry should have more elapsed time
      expect(elapsedTimes[1]).toBeGreaterThan(elapsedTimes[0])
    })

    it('respects timeout budget', async () => {
      const handler = createRetryHandler({
        maxRetries: 10, // Many retries
        initialDelay: 100,
        maxDelay: 500,
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 300, // Only 300ms budget
      })

      const mockFn = vi.fn().mockRejectedValue(new Error('Always fails'))

      await expect(handler.execute(mockFn)).rejects.toThrow()

      // Should have stopped before maxRetries due to timeout budget
      expect(mockFn).toHaveBeenCalledTimes(expect.any(Number))
      expect(mockFn.mock.calls.length).toBeLessThan(10)
    })
  })

  describe('emits retry events', () => {
    it('emits retry event before each retry', async () => {
      const events: RetryEvent[] = []
      const handler = createRetryHandler({
        maxRetries: 3,
        initialDelay: 10,
        maxDelay: 100,
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 5000,
      })

      let callCount = 0
      const mockFn = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount < 3) {
          throw new Error('Transient error')
        }
        return 'success'
      })

      handler.onRetry((event) => {
        events.push(event)
      })

      await handler.execute(mockFn)

      expect(events).toHaveLength(2)
      expect(events[0].type).toBe('retry')
      expect(events[1].type).toBe('retry')
    })

    it('emits success event on successful retry', async () => {
      const events: RetryEvent[] = []
      const handler = createRetryHandler({
        maxRetries: 3,
        initialDelay: 10,
        maxDelay: 100,
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 5000,
      })

      let callCount = 0
      const mockFn = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount < 2) {
          throw new Error('Transient error')
        }
        return 'success'
      })

      handler.onRetry((event) => {
        events.push(event)
      })

      await handler.execute(mockFn)

      const successEvent = events.find(e => e.type === 'success')
      expect(successEvent).toBeDefined()
      expect(successEvent?.attempt).toBe(2)
    })

    it('emits exhausted event when retries exhausted', async () => {
      const events: RetryEvent[] = []
      const handler = createRetryHandler({
        maxRetries: 2,
        initialDelay: 10,
        maxDelay: 100,
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 5000,
      })

      const mockFn = vi.fn().mockRejectedValue(new Error('Always fails'))

      handler.onRetry((event) => {
        events.push(event)
      })

      await expect(handler.execute(mockFn)).rejects.toThrow('Always fails')

      const exhaustedEvent = events.find(e => e.type === 'exhausted')
      expect(exhaustedEvent).toBeDefined()
    })

    it('emits circuit-open event when circuit opens', async () => {
      const events: RetryEvent[] = []
      const handler = createRetryHandler({
        maxRetries: 10,
        initialDelay: 10,
        maxDelay: 100,
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 5000,
        circuitBreaker: {
          failureThreshold: 3,
          cooldownPeriod: 30000,
          successThreshold: 1,
        },
      })

      const mockFn = vi.fn().mockRejectedValue(new Error('Always fails'))

      handler.onRetry((event) => {
        events.push(event)
      })

      // Run enough times to trigger circuit breaker
      for (let i = 0; i < 3; i++) {
        await expect(handler.execute(mockFn)).rejects.toThrow()
      }

      const circuitOpenEvent = events.find(e => e.type === 'circuit-open')
      expect(circuitOpenEvent).toBeDefined()
    })

    it('allows unsubscribing from events', async () => {
      const events: RetryEvent[] = []
      const handler = createRetryHandler({
        maxRetries: 3,
        initialDelay: 10,
        maxDelay: 100,
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 5000,
      })

      let callCount = 0
      const mockFn = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount < 3) {
          throw new Error('Transient error')
        }
        return 'success'
      })

      const unsubscribe = handler.onRetry((event) => {
        events.push(event)
      })

      // Unsubscribe before executing
      unsubscribe()

      await handler.execute(mockFn)

      // Should have no events since we unsubscribed
      expect(events).toHaveLength(0)
    })
  })
})

// =============================================================================
// Integration Tests - RetryHandler.fetch
// =============================================================================

describe('RetryHandler.fetch', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries on 429 with exponential backoff', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createMockResponse(429, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(createMockResponse(429))
      .mockResolvedValueOnce(createMockResponse(200))

    vi.stubGlobal('fetch', fetchMock)

    const handler = createRetryHandler({
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 32000,
      multiplier: 2,
      jitter: 0,
      timeoutBudget: 60000,
    })

    const responsePromise = handler.fetch('https://api.example.com/resource')

    // Advance through retries
    await vi.advanceTimersByTimeAsync(5000)

    const response = await responsePromise

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry on 400 Bad Request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(createMockResponse(400))

    vi.stubGlobal('fetch', fetchMock)

    const handler = createRetryHandler()

    const response = await handler.fetch('https://api.example.com/resource')

    expect(response.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws after max retries exhausted', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(createMockResponse(500))

    vi.stubGlobal('fetch', fetchMock)

    const handler = createRetryHandler({
      maxRetries: 2,
      initialDelay: 100,
      maxDelay: 1000,
      multiplier: 2,
      jitter: 0,
      timeoutBudget: 60000,
    })

    const fetchPromise = handler.fetch('https://api.example.com/resource')

    // Advance through all retries
    await vi.advanceTimersByTimeAsync(5000)

    await expect(fetchPromise).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(3) // Initial + 2 retries
  })
})

// =============================================================================
// Default Configuration Tests
// =============================================================================

describe('DEFAULT_RETRY_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_RETRY_CONFIG).toBeDefined()
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3)
    expect(DEFAULT_RETRY_CONFIG.initialDelay).toBe(1000)
    expect(DEFAULT_RETRY_CONFIG.maxDelay).toBe(32000)
    expect(DEFAULT_RETRY_CONFIG.multiplier).toBe(2)
    expect(DEFAULT_RETRY_CONFIG.jitter).toBe(0.25)
    expect(DEFAULT_RETRY_CONFIG.timeoutBudget).toBe(60000)
  })
})

// =============================================================================
// Additional Edge Case Tests
// =============================================================================

describe('Edge Cases', () => {
  describe('Network Errors', () => {
    it('retries on network timeout', async () => {
      const handler = createRetryHandler()
      const mockFn = vi.fn()
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce('success')

      const result = await handler.execute(mockFn)

      expect(result).toBe('success')
      expect(mockFn).toHaveBeenCalledTimes(3)
    })

    it('retries on DNS resolution failure', async () => {
      const handler = createRetryHandler()
      const mockFn = vi.fn()
        .mockRejectedValueOnce(new Error('ENOTFOUND'))
        .mockResolvedValueOnce('success')

      const result = await handler.execute(mockFn)

      expect(result).toBe('success')
      expect(mockFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('Idempotency', () => {
    it('preserves request options across retries', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(createMockResponse(500))
        .mockResolvedValueOnce(createMockResponse(200))

      vi.stubGlobal('fetch', fetchMock)

      const handler = createRetryHandler({
        maxRetries: 2,
        initialDelay: 10,
        maxDelay: 100,
        multiplier: 2,
        jitter: 0,
        timeoutBudget: 5000,
      })

      const options: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'test-123' },
        body: JSON.stringify({ data: 'test' }),
      }

      await handler.fetch('https://api.example.com/resource', options)

      // Both calls should have the same options
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.example.com/resource', options)
      expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.example.com/resource', options)
    })
  })
})
