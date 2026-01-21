import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FallbackError,
  ProviderFallback,
  createFallback,
  resetGlobalHealthState,
  getGlobalHealthState,
  type ProviderFailureDetail,
  type FallbackChainSummary,
} from '../fallback'

describe('FallbackError', () => {
  const createTestFailure = (provider: string, error: string): ProviderFailureDetail => ({
    provider,
    error,
    timestamp: Date.now(),
  })

  const createTestSummary = (
    attempted: string[],
    skipped: string[] = []
  ): FallbackChainSummary => ({
    providersAttempted: attempted,
    providersSkipped: skipped,
    totalDuration: 1000,
    failures: attempted.map(p => createTestFailure(p, `${p} failed`)),
  })

  describe('creation', () => {
    it('should create error with formatted message', () => {
      const failures = [
        createTestFailure('anthropic', 'API key invalid'),
        createTestFailure('openai', 'Rate limit exceeded'),
      ]
      const summary = createTestSummary(['anthropic', 'openai'])

      const error = FallbackError.create(failures, summary)

      expect(error).toBeInstanceOf(FallbackError)
      expect(error.message).toContain('All providers failed')
      expect(error.message).toContain('tried: anthropic, openai')
      expect(error.message).toContain('Rate limit exceeded')
    })

    it('should include skipped providers in message', () => {
      const failures = [createTestFailure('openai', 'Failed')]
      const summary: FallbackChainSummary = {
        providersAttempted: ['openai'],
        providersSkipped: ['anthropic', 'google'],
        totalDuration: 500,
        failures,
      }

      const error = FallbackError.create(failures, summary)

      expect(error.message).toContain('skipped: anthropic, google')
    })

    it('should store failures and summary', () => {
      const failures = [
        createTestFailure('anthropic', 'Error 1'),
        createTestFailure('openai', 'Error 2'),
      ]
      const summary = createTestSummary(['anthropic', 'openai'])

      const error = FallbackError.create(failures, summary)

      expect(error.failures).toHaveLength(2)
      expect(error.summary.providersAttempted).toEqual(['anthropic', 'openai'])
    })

    it('should store operation name if provided', () => {
      const failures = [createTestFailure('anthropic', 'Failed')]
      const summary = createTestSummary(['anthropic'])

      const error = FallbackError.create(failures, summary, 'generateText')

      expect(error.operation).toBe('generateText')
    })
  })

  describe('getDetailedReport', () => {
    it('should generate detailed report', () => {
      const failures: ProviderFailureDetail[] = [
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          error: 'Authentication failed',
          status: 401,
          timestamp: Date.now(),
          retries: 2,
        },
        {
          provider: 'openai',
          error: 'Rate limit exceeded',
          code: 'rate_limit_exceeded',
          status: 429,
          timestamp: Date.now(),
          retries: 1,
        },
      ]
      const summary: FallbackChainSummary = {
        providersAttempted: ['anthropic', 'openai'],
        providersSkipped: ['google'],
        totalDuration: 2500,
        failures,
      }

      const error = FallbackError.create(failures, summary, 'generateText')
      const report = error.getDetailedReport()

      expect(report).toContain('Fallback Chain Failed')
      expect(report).toContain('Duration: 2500ms')
      expect(report).toContain('Providers Attempted: anthropic, openai')
      expect(report).toContain('Providers Skipped: google')
      expect(report).toContain('Operation: generateText')
      expect(report).toContain('anthropic')
      expect(report).toContain('claude-sonnet-4')
      expect(report).toContain('Authentication failed')
      expect(report).toContain('HTTP 401')
      expect(report).toContain('2 retries')
    })
  })

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const failures = [createTestFailure('anthropic', 'Failed')]
      const summary = createTestSummary(['anthropic'])

      const error = FallbackError.create(failures, summary, 'test')
      const json = error.toJSON() as Record<string, unknown>

      expect(json).toHaveProperty('name', 'FallbackError')
      expect(json).toHaveProperty('message')
      expect(json).toHaveProperty('operation', 'test')
      expect(json).toHaveProperty('summary')
      expect(json).toHaveProperty('failures')
    })
  })
})

describe('ProviderFallback', () => {
  beforeEach(() => {
    resetGlobalHealthState()
  })

  afterEach(() => {
    resetGlobalHealthState()
  })

  describe('execute', () => {
    it('should execute operation with first provider on success', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic', 'openai', 'google'],
      })

      const operation = vi.fn().mockResolvedValue('success')

      const result = await fallback.execute(operation)

      expect(result.result).toBe('success')
      expect(result.provider).toBe('anthropic')
      expect(result.attemptCount).toBe(1)
      expect(operation).toHaveBeenCalledTimes(1)
      expect(operation).toHaveBeenCalledWith('anthropic')
    })

    it('should try fallback providers on failure', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic', 'openai', 'google'],
        maxRetriesPerProvider: 1,
      })

      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Anthropic failed'))
        .mockRejectedValueOnce(new Error('OpenAI failed'))
        .mockResolvedValueOnce('success from google')

      const result = await fallback.execute(operation)

      expect(result.result).toBe('success from google')
      expect(result.provider).toBe('google')
      expect(result.attemptCount).toBe(3)
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it('should throw FallbackError when all providers fail', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic', 'openai'],
        maxRetriesPerProvider: 1,
      })

      const operation = vi.fn().mockRejectedValue(new Error('All failed'))

      await expect(fallback.execute(operation, 'test-operation'))
        .rejects.toThrow(FallbackError)

      try {
        await fallback.execute(operation, 'test-operation')
      } catch (error) {
        const fallbackError = error as FallbackError
        expect(fallbackError.summary.providersAttempted).toEqual(['anthropic', 'openai'])
        expect(fallbackError.failures).toHaveLength(2)
        expect(fallbackError.operation).toBe('test-operation')
      }
    })

    it('should retry on rate limit errors', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic'],
        maxRetriesPerProvider: 3,
        backoff: { initialDelay: 10, multiplier: 2, maxDelay: 100, jitter: false },
      })

      const rateLimitError = new Error('Rate limit exceeded') as Error & { status: number }
      rateLimitError.status = 429

      const operation = vi.fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce('success')

      const result = await fallback.execute(operation)

      expect(result.result).toBe('success')
      expect(result.totalRetries).toBe(2)
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it('should move to next provider after max retries on rate limit', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic', 'openai'],
        maxRetriesPerProvider: 2,
        backoff: { initialDelay: 10, multiplier: 2, maxDelay: 100, jitter: false },
      })

      const rateLimitError = new Error('Rate limit exceeded') as Error & { status: number }
      rateLimitError.status = 429

      const operation = vi.fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError) // Max retries for anthropic
        .mockResolvedValueOnce('success from openai')

      const result = await fallback.execute(operation)

      expect(result.result).toBe('success from openai')
      expect(result.provider).toBe('openai')
    })

    it('should track duration', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic'],
      })

      const operation = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return 'success'
      })

      const result = await fallback.execute(operation)

      expect(result.duration).toBeGreaterThanOrEqual(50)
    })
  })

  describe('circuit breaker', () => {
    it('should open circuit after failure threshold', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic', 'openai'],
        maxRetriesPerProvider: 1,
        circuitBreaker: {
          failureThreshold: 2,
          recoveryTimeout: 60000,
        },
      })

      let callCount = 0
      const operation = vi.fn().mockImplementation(async (provider: string) => {
        callCount++
        if (provider === 'anthropic') {
          throw new Error(`Fail ${callCount}`)
        }
        return 'success'
      })

      // First call: tries anthropic (fails 1), falls back to openai (succeeds)
      await fallback.execute(operation)
      expect(callCount).toBe(2) // anthropic, then openai

      // Second call: tries anthropic again (fails 2, opens circuit), falls back to openai
      await fallback.execute(operation)

      // Verify circuit is now open
      const health = fallback.getHealthStatus()
      expect(health['anthropic']?.circuitState).toBe('open')
      expect(health['anthropic']?.consecutiveFailures).toBe(2)

      // Reset mock
      operation.mockClear()
      callCount = 0
      operation.mockResolvedValue('success')

      // Third call: should skip anthropic (circuit open), go straight to openai
      await fallback.execute(operation)

      // anthropic should not have been called since circuit is open
      expect(operation).toHaveBeenCalledWith('openai')
      expect(operation).not.toHaveBeenCalledWith('anthropic')
    })

    it('should skip unhealthy providers', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic', 'openai', 'google'],
        maxRetriesPerProvider: 1,
        circuitBreaker: {
          failureThreshold: 1,
          recoveryTimeout: 60000,
        },
      })

      // Manually mark anthropic as unhealthy
      fallback.markUnhealthy('anthropic')

      const operation = vi.fn().mockResolvedValue('success')

      const result = await fallback.execute(operation)

      expect(result.provider).toBe('openai')
      expect(operation).toHaveBeenCalledWith('openai')
      expect(operation).not.toHaveBeenCalledWith('anthropic')
    })

    it('should transition to half-open after recovery timeout', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic', 'openai'],
        maxRetriesPerProvider: 1,
        circuitBreaker: {
          failureThreshold: 1,
          recoveryTimeout: 50, // Short timeout for testing
        },
      })

      // Mark unhealthy
      fallback.markUnhealthy('anthropic')

      // Verify it's unavailable
      expect(fallback.isProviderAvailable('anthropic')).toBe(false)

      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should be available now (half-open)
      expect(fallback.isProviderAvailable('anthropic')).toBe(true)
    })

    it('should close circuit after successful request in half-open', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic'],
        maxRetriesPerProvider: 1,
        circuitBreaker: {
          failureThreshold: 1,
          recoveryTimeout: 50,
          successThreshold: 1,
        },
      })

      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Initial failure'))
        .mockResolvedValue('success')

      // First call opens circuit
      try {
        await fallback.execute(operation)
      } catch {
        // Expected to fail
      }

      // Wait for recovery
      await new Promise(resolve => setTimeout(resolve, 100))

      // This should succeed and close the circuit
      await fallback.execute(operation)

      const health = fallback.getHealthStatus()
      expect(health['anthropic']?.circuitState).toBe('closed')
      expect(health['anthropic']?.healthy).toBe(true)
    })
  })

  describe('health tracking', () => {
    it('should track health status', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic', 'openai'],
        trackHealth: true,
      })

      const health = fallback.getHealthStatus()

      expect(health).toHaveProperty('anthropic')
      expect(health).toHaveProperty('openai')
      expect(health['anthropic']?.healthy).toBe(true)
      expect(health['anthropic']?.circuitState).toBe('closed')
    })

    it('should reset health status', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic'],
        circuitBreaker: {
          failureThreshold: 1, // Open circuit after 1 failure
        },
      })

      fallback.markUnhealthy('anthropic')
      expect(fallback.getHealthStatus()['anthropic']?.healthy).toBe(false)

      fallback.resetHealthStatus()
      expect(fallback.getHealthStatus()['anthropic']?.healthy).toBe(true)
    })

    it('should not track health when disabled', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic'],
        trackHealth: false,
      })

      fallback.markUnhealthy('anthropic')

      // Should still be available
      expect(fallback.isProviderAvailable('anthropic')).toBe(true)
    })
  })

  describe('backoff configuration', () => {
    it('should use custom backoff settings', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic'],
        maxRetriesPerProvider: 3,
        backoff: {
          initialDelay: 10,
          multiplier: 3,
          maxDelay: 100,
          jitter: false,
        },
      })

      const rateLimitError = new Error('Rate limit') as Error & { status: number }
      rateLimitError.status = 429

      const timestamps: number[] = []
      const operation = vi.fn().mockImplementation(async () => {
        timestamps.push(Date.now())
        if (timestamps.length < 3) {
          throw rateLimitError
        }
        return 'success'
      })

      await fallback.execute(operation)

      // Verify exponential backoff timing
      expect(timestamps.length).toBe(3)
      if (timestamps.length === 3) {
        const delay1 = timestamps[1]! - timestamps[0]!
        const delay2 = timestamps[2]! - timestamps[1]!
        // Second delay should be ~3x the first (with some tolerance)
        expect(delay2).toBeGreaterThan(delay1 * 2)
      }
    })

    it('should cap delay at maxDelay', async () => {
      const fallback = new ProviderFallback({
        providers: ['anthropic'],
        maxRetriesPerProvider: 5,
        backoff: {
          initialDelay: 10,
          multiplier: 10,
          maxDelay: 50,
          jitter: false,
        },
      })

      const rateLimitError = new Error('Rate limit') as Error & { status: number }
      rateLimitError.status = 429

      const timestamps: number[] = []
      const operation = vi.fn().mockImplementation(async () => {
        timestamps.push(Date.now())
        if (timestamps.length < 4) {
          throw rateLimitError
        }
        return 'success'
      })

      await fallback.execute(operation)

      // Later delays should be capped at maxDelay
      if (timestamps.length >= 4) {
        const lastDelay = timestamps[3]! - timestamps[2]!
        expect(lastDelay).toBeLessThanOrEqual(100) // maxDelay + some tolerance
      }
    })
  })
})

describe('createFallback', () => {
  beforeEach(() => {
    resetGlobalHealthState()
  })

  it('should create fallback with default options', () => {
    const fallback = createFallback(['anthropic', 'openai'])

    expect(fallback).toBeInstanceOf(ProviderFallback)
  })

  it('should accept custom options', () => {
    const fallback = createFallback(['anthropic', 'openai'], {
      maxRetriesPerProvider: 5,
      trackHealth: false,
    })

    expect(fallback).toBeInstanceOf(ProviderFallback)
  })
})

describe('global health state', () => {
  beforeEach(() => {
    resetGlobalHealthState()
  })

  it('should share health state across instances', async () => {
    const fallback1 = new ProviderFallback({
      providers: ['anthropic', 'openai'],
      circuitBreaker: { failureThreshold: 1, recoveryTimeout: 60000 },
    })

    const fallback2 = new ProviderFallback({
      providers: ['anthropic', 'openai'],
      circuitBreaker: { failureThreshold: 1, recoveryTimeout: 60000 },
    })

    // Mark unhealthy via fallback1
    fallback1.markUnhealthy('anthropic')

    // Should be reflected in fallback2
    expect(fallback2.isProviderAvailable('anthropic')).toBe(false)
  })

  it('should allow reading global health state', () => {
    const fallback = new ProviderFallback({
      providers: ['anthropic'],
      circuitBreaker: {
        failureThreshold: 1, // Open circuit after 1 failure
      },
    })

    fallback.markUnhealthy('anthropic')

    const globalState = getGlobalHealthState()
    expect(globalState.get('anthropic')?.healthy).toBe(false)
  })

  it('should allow resetting global health state', () => {
    const fallback = new ProviderFallback({
      providers: ['anthropic'],
      circuitBreaker: {
        failureThreshold: 1, // Open circuit after 1 failure
      },
    })

    fallback.markUnhealthy('anthropic')
    expect(fallback.isProviderAvailable('anthropic')).toBe(false)

    resetGlobalHealthState()

    // New fallback should see healthy state
    const fallback2 = new ProviderFallback({
      providers: ['anthropic'],
      circuitBreaker: {
        failureThreshold: 1,
      },
    })
    expect(fallback2.isProviderAvailable('anthropic')).toBe(true)
  })
})

describe('rate limit detection', () => {
  beforeEach(() => {
    resetGlobalHealthState()
  })

  it.each([
    ['status 429', { status: 429 }],
    ['code rate_limit_exceeded', { code: 'rate_limit_exceeded' }],
    ['code rate_limit_error', { code: 'rate_limit_error' }],
    ['code too_many_requests', { code: 'too_many_requests' }],
    ['message "rate limit"', { message: 'Rate limit exceeded' }],
    ['message "429"', { message: 'Error 429: Too many requests' }],
    ['message "too many requests"', { message: 'Too many requests, please retry' }],
    ['message "throttle"', { message: 'Request throttled' }],
  ])('should detect rate limit error by %s', async (_, errorProps) => {
    const fallback = new ProviderFallback({
      providers: ['anthropic'],
      maxRetriesPerProvider: 2,
      backoff: { initialDelay: 10, multiplier: 2, maxDelay: 50, jitter: false },
    })

    const error = new Error(errorProps.message || 'Error') as Error & { status?: number; code?: string }
    if (errorProps.status) error.status = errorProps.status
    if (errorProps.code) error.code = errorProps.code

    const operation = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('success')

    const result = await fallback.execute(operation)

    expect(result.result).toBe('success')
    expect(result.totalRetries).toBe(1)
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('should not retry on non-rate-limit errors', async () => {
    const fallback = new ProviderFallback({
      providers: ['anthropic', 'openai'],
      maxRetriesPerProvider: 3,
    })

    const error = new Error('Authentication failed') as Error & { status: number }
    error.status = 401

    const operation = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('success from openai')

    const result = await fallback.execute(operation)

    expect(result.provider).toBe('openai')
    // Should have moved to next provider immediately, not retried
    expect(operation).toHaveBeenCalledTimes(2)
  })
})
