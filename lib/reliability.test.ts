/**
 * Reliability Module Tests
 *
 * Tests for the standardized reliability patterns in lib/reliability.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  withTimeout,
  withTimeoutMetadata,
  withTimeoutAbortable,
  withRetry,
  withRetryMetadata,
  withReliability,
  calculateBackoff,
  sleep,
  retryOnErrors,
  skipRetryOnErrors,
  retryOnMessagePatterns,
  skipRetryOnMessagePatterns,
  retryWhenAll,
  retryWhenAny,
  CircuitBreaker,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_BACKOFF_BASE_MS,
  TRANSIENT_NETWORK_POLICY,
  RPC_RELIABILITY,
  EXTERNAL_API_RELIABILITY,
} from './reliability'

describe('Timeout Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('withTimeout', () => {
    it('should resolve if promise completes before timeout', async () => {
      const promise = Promise.resolve('success')
      const result = await withTimeout(promise, 1000)
      expect(result).toBe('success')
    })

    it('should reject with timeout error if promise takes too long', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 2000)
      })

      const timeoutPromise = withTimeout(slowPromise, 1000)
      await vi.advanceTimersByTimeAsync(1100)

      await expect(timeoutPromise).rejects.toThrow('Timeout')
    })

    it('should use custom error message', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 2000)
      })

      const timeoutPromise = withTimeout(slowPromise, 1000, 'Custom timeout message')
      await vi.advanceTimersByTimeAsync(1100)

      await expect(timeoutPromise).rejects.toThrow('Custom timeout message')
    })

    it('should clear timeout on successful completion', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      const promise = Promise.resolve('success')

      await withTimeout(promise, 1000)

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })
  })

  describe('withTimeoutMetadata', () => {
    it('should return result with duration when successful', async () => {
      const promise = Promise.resolve('success')

      const { result, timedOut, duration } = await withTimeoutMetadata(promise, 1000)

      expect(result).toBe('success')
      expect(timedOut).toBe(false)
      expect(duration).toBeGreaterThanOrEqual(0)
    })

    it('should return timedOut flag when timeout occurs', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 2000)
      })

      const metadataPromise = withTimeoutMetadata(slowPromise, 1000)
      await vi.advanceTimersByTimeAsync(1100)

      const { result, timedOut, duration } = await metadataPromise

      expect(result).toBeUndefined()
      expect(timedOut).toBe(true)
      expect(duration).toBeLessThan(1200)
    })

    it('should use fallback value when provided and timeout occurs', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 2000)
      })

      const metadataPromise = withTimeoutMetadata(slowPromise, 1000, 'fallback')
      await vi.advanceTimersByTimeAsync(1100)

      const { result, timedOut } = await metadataPromise

      expect(result).toBe('fallback')
      expect(timedOut).toBe(true)
    })
  })

  describe('withTimeoutAbortable', () => {
    it('should provide AbortSignal to function', async () => {
      let receivedSignal: AbortSignal | undefined

      const fn = async (signal: AbortSignal) => {
        receivedSignal = signal
        return 'success'
      }

      await withTimeoutAbortable(fn, 1000)

      expect(receivedSignal).toBeDefined()
      expect(receivedSignal?.aborted).toBe(false)
    })

    it('should abort signal on timeout', async () => {
      let receivedSignal: AbortSignal | undefined

      const fn = async (signal: AbortSignal) => {
        receivedSignal = signal
        await new Promise((resolve) => setTimeout(resolve, 2000))
        return 'too late'
      }

      const promise = withTimeoutAbortable(fn, 1000)
      await vi.advanceTimersByTimeAsync(1100)

      await expect(promise).rejects.toThrow('Timeout')
      expect(receivedSignal?.aborted).toBe(true)
    })
  })
})

describe('Backoff Utilities', () => {
  describe('calculateBackoff', () => {
    it('should return 0 for none strategy', () => {
      expect(calculateBackoff(1, 'none')).toBe(0)
      expect(calculateBackoff(5, 'none')).toBe(0)
    })

    it('should calculate linear backoff', () => {
      expect(calculateBackoff(1, 'linear', 100)).toBe(100)
      expect(calculateBackoff(2, 'linear', 100)).toBe(200)
      expect(calculateBackoff(3, 'linear', 100)).toBe(300)
    })

    it('should cap linear backoff at maxDelay', () => {
      expect(calculateBackoff(100, 'linear', 100, 500)).toBe(500)
    })

    it('should calculate exponential backoff', () => {
      expect(calculateBackoff(1, 'exponential', 100)).toBe(100)
      expect(calculateBackoff(2, 'exponential', 100)).toBe(200)
      expect(calculateBackoff(3, 'exponential', 100)).toBe(400)
    })

    it('should cap exponential backoff at maxDelay', () => {
      expect(calculateBackoff(10, 'exponential', 100, 1000)).toBe(1000)
    })

    it('should add jitter to exponential-jitter strategy', () => {
      // Run multiple times to verify jitter adds randomness
      const results = new Set<number>()
      for (let i = 0; i < 10; i++) {
        results.add(calculateBackoff(3, 'exponential-jitter', 100, 10000))
      }
      // With jitter, we should get varying results
      expect(results.size).toBeGreaterThan(1)
    })
  })
})

describe('Retry Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('withRetry', () => {
    it('should succeed on first attempt if no error', async () => {
      const fn = vi.fn().mockResolvedValue('success')

      const result = await withRetry(fn, { maxAttempts: 3, backoff: 'none' })

      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure and succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success')

      const resultPromise = withRetry(fn, { maxAttempts: 5, backoff: 'none' })

      const result = await resultPromise

      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should throw last error after exhausting retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'))

      await expect(withRetry(fn, { maxAttempts: 3, backoff: 'none' })).rejects.toThrow('always fails')

      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should respect shouldRetry condition', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('not retryable'))

      await expect(
        withRetry(fn, {
          maxAttempts: 5,
          backoff: 'none',
          shouldRetry: () => false,
        })
      ).rejects.toThrow('not retryable')

      // Only called once because shouldRetry returned false
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should call onRetry callback on each retry', async () => {
      const onRetry = vi.fn()
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success')

      await withRetry(fn, { maxAttempts: 5, backoff: 'none', onRetry })

      expect(onRetry).toHaveBeenCalledTimes(2)
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 0)
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 2, 0)
    })

    it('should apply backoff delay between retries', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success')

      const retryPromise = withRetry(fn, {
        maxAttempts: 3,
        backoff: 'linear',
        baseDelay: 1000,
      })

      // First call should happen immediately
      expect(fn).toHaveBeenCalledTimes(1)

      // Advance past backoff delay
      await vi.advanceTimersByTimeAsync(1100)

      const result = await retryPromise

      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(2)
    })
  })

  describe('withRetryMetadata', () => {
    it('should return attempt count on success', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success')

      const resultPromise = withRetryMetadata(fn, { maxAttempts: 3, backoff: 'none' })

      const { result, attempts, errors } = await resultPromise

      expect(result).toBe('success')
      expect(attempts).toBe(2)
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('fail')
    })

    it('should track all previous errors', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('error 1'))
        .mockRejectedValueOnce(new Error('error 2'))
        .mockResolvedValue('success')

      const { errors } = await withRetryMetadata(fn, { maxAttempts: 5, backoff: 'none' })

      expect(errors).toHaveLength(2)
      expect(errors.map((e) => e.message)).toEqual(['error 1', 'error 2'])
    })
  })
})

describe('Combined Reliability Wrapper', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('withReliability', () => {
    it('should succeed with no failures', async () => {
      const fn = vi.fn().mockResolvedValue('success')

      const result = await withReliability(fn, { timeout: 1000, retries: 3 })

      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('success')

      const resultPromise = withReliability(fn, {
        timeout: 1000,
        retries: 3,
        backoff: 'none',
      })

      const result = await resultPromise

      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should timeout long operations', async () => {
      const fn = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('too late'), 2000))
      )

      const promise = withReliability(fn, {
        timeout: 1000,
        retries: 1, // No retries
      })

      await vi.advanceTimersByTimeAsync(1100)

      await expect(promise).rejects.toThrow('Timeout')
    })

    it('should call onTimeout callback on timeout', async () => {
      const onTimeout = vi.fn()
      const fn = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('too late'), 2000))
      )

      const promise = withReliability(fn, {
        timeout: 1000,
        retries: 1,
        onTimeout,
      })

      await vi.advanceTimersByTimeAsync(1100)

      await expect(promise).rejects.toThrow()
      expect(onTimeout).toHaveBeenCalledWith(1000)
    })

    it('should call onFailure callback on final failure', async () => {
      const onFailure = vi.fn()
      const fn = vi.fn().mockRejectedValue(new Error('always fails'))

      await expect(
        withReliability(fn, {
          timeout: 1000,
          retries: 3,
          backoff: 'none',
          onFailure,
        })
      ).rejects.toThrow()

      expect(onFailure).toHaveBeenCalledWith(expect.any(Error), 3)
    })

    it('should fail fast when circuit breaker is open', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 10000,
      })

      // Open the circuit
      breaker.open()

      const fn = vi.fn().mockResolvedValue('success')
      const onFailure = vi.fn()

      await expect(
        withReliability(fn, {
          timeout: 1000,
          retries: 3,
          circuitBreaker: breaker,
          onFailure,
        })
      ).rejects.toThrow('Circuit is open')

      // Function should not have been called
      expect(fn).not.toHaveBeenCalled()
      expect(onFailure).toHaveBeenCalledWith(expect.any(Error), 0)
    })

    it('should work with circuit breaker integration', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 10000,
      })

      const fn = vi.fn().mockResolvedValue('success')

      const result = await withReliability(fn, {
        timeout: 1000,
        retries: 3,
        circuitBreaker: breaker,
      })

      expect(result).toBe('success')
      expect(breaker.state).toBe('closed')
    })
  })
})

describe('Retry Condition Helpers', () => {
  describe('retryOnErrors', () => {
    it('should return true for matching error types', () => {
      const condition = retryOnErrors(TypeError, RangeError)

      expect(condition(new TypeError('type error'))).toBe(true)
      expect(condition(new RangeError('range error'))).toBe(true)
      expect(condition(new Error('generic error'))).toBe(false)
    })
  })

  describe('skipRetryOnErrors', () => {
    it('should return false for matching error types', () => {
      const condition = skipRetryOnErrors(TypeError)

      expect(condition(new TypeError('type error'))).toBe(false)
      expect(condition(new Error('generic error'))).toBe(true)
    })
  })

  describe('retryOnMessagePatterns', () => {
    it('should return true for matching message patterns', () => {
      const condition = retryOnMessagePatterns('timeout', /connection.*refused/i)

      expect(condition(new Error('Request timeout'))).toBe(true)
      expect(condition(new Error('Connection refused by server'))).toBe(true)
      expect(condition(new Error('Not found'))).toBe(false)
    })
  })

  describe('skipRetryOnMessagePatterns', () => {
    it('should return false for matching message patterns', () => {
      const condition = skipRetryOnMessagePatterns('not found', '404')

      expect(condition(new Error('Resource not found'))).toBe(false)
      expect(condition(new Error('Error 404'))).toBe(false)
      expect(condition(new Error('Connection timeout'))).toBe(true)
    })
  })

  describe('retryWhenAll', () => {
    it('should combine conditions with AND logic', () => {
      const condition = retryWhenAll(
        () => true,
        (error) => error.message !== 'not retryable'
      )

      expect(condition(new Error('retryable'), 1)).toBe(true)
      expect(condition(new Error('not retryable'), 1)).toBe(false)
    })
  })

  describe('retryWhenAny', () => {
    it('should combine conditions with OR logic', () => {
      const condition = retryWhenAny(
        (error) => error.message === 'timeout',
        (error) => error.message === 'connection refused'
      )

      expect(condition(new Error('timeout'), 1)).toBe(true)
      expect(condition(new Error('connection refused'), 1)).toBe(true)
      expect(condition(new Error('not found'), 1)).toBe(false)
    })
  })
})

describe('Exported Constants and Presets', () => {
  it('should export default constants', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30000)
    expect(DEFAULT_MAX_RETRIES).toBe(3)
    expect(DEFAULT_BACKOFF_BASE_MS).toBe(1000)
  })

  it('should export retry policies', () => {
    expect(TRANSIENT_NETWORK_POLICY).toMatchObject({
      maxAttempts: 3,
      backoff: 'exponential-jitter',
    })
  })

  it('should export reliability presets', () => {
    expect(RPC_RELIABILITY).toMatchObject({
      timeout: 30000,
      retries: 2,
      backoff: 'linear',
    })

    expect(EXTERNAL_API_RELIABILITY).toMatchObject({
      timeout: 30000,
      retries: 3,
      backoff: 'exponential',
    })
  })
})

describe('Circuit Breaker Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should re-export CircuitBreaker from circuit-breaker module', () => {
    expect(CircuitBreaker).toBeDefined()

    const breaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 10000,
    })

    expect(breaker.state).toBe('closed')
  })

  it('should work with reliability wrapper', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeout: 5000,
    })

    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    // Fail twice to open circuit
    await expect(
      withReliability(fn, {
        retries: 1,
        backoff: 'none',
        circuitBreaker: breaker,
      })
    ).rejects.toThrow()

    await expect(
      withReliability(fn, {
        retries: 1,
        backoff: 'none',
        circuitBreaker: breaker,
      })
    ).rejects.toThrow()

    expect(breaker.state).toBe('open')

    // Next call should fail fast
    const fastFailFn = vi.fn().mockResolvedValue('success')
    await expect(
      withReliability(fastFailFn, {
        retries: 1,
        circuitBreaker: breaker,
      })
    ).rejects.toThrow('Circuit is open')

    // Fast fail should not call the function
    expect(fastFailFn).not.toHaveBeenCalled()
  })
})
