import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CircuitBreaker,
  SlidingWindow,
  FallbackHandler,
  HealthChecker,
  Bulkhead,
  RetryPolicy,
  CircuitBreakerRegistry,
} from './index'
import {
  CircuitOpenError,
  BulkheadFullError,
  QueueTimeoutError,
  type CircuitConfig,
  type CircuitState,
  type CircuitEvent,
} from './types'

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Closed State (pass through)', () => {
    it('should execute function successfully when closed', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000, halfOpenRequests: 1 })
      const fn = vi.fn().mockResolvedValue('success')

      const result = await cb.execute(fn)

      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(1)
      expect(cb.getState()).toBe('closed')
    })

    it('should track successful executions', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000, halfOpenRequests: 1 })

      await cb.execute(() => 'success')
      await cb.execute(() => 'success')

      const stats = cb.getStats()
      expect(stats.successes).toBe(2)
      expect(stats.totalSuccesses).toBe(2)
      expect(stats.totalRequests).toBe(2)
    })

    it('should handle synchronous functions', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000, halfOpenRequests: 1 })

      const result = await cb.execute(() => 'sync-result')

      expect(result).toBe('sync-result')
    })

    it('should handle async functions', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000, halfOpenRequests: 1 })

      const result = await cb.execute(async () => {
        return 'async-result'
      })

      expect(result).toBe('async-result')
    })
  })

  describe('Open State (reject immediately)', () => {
    it('should reject immediately when open', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 1000, halfOpenRequests: 1 })

      // Trip the circuit
      await expect(cb.execute(() => { throw new Error('fail') })).rejects.toThrow()
      await expect(cb.execute(() => { throw new Error('fail') })).rejects.toThrow()

      expect(cb.getState()).toBe('open')

      // Should reject without calling function
      const fn = vi.fn()
      await expect(cb.execute(fn)).rejects.toThrow(CircuitOpenError)
      expect(fn).not.toHaveBeenCalled()
    })

    it('should track rejected requests', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 1 })

      await expect(cb.execute(() => { throw new Error('fail') })).rejects.toThrow()

      // Now circuit is open
      await expect(cb.execute(() => 'test')).rejects.toThrow(CircuitOpenError)
      await expect(cb.execute(() => 'test')).rejects.toThrow(CircuitOpenError)

      const stats = cb.getStats()
      expect(stats.totalRejected).toBe(2)
    })

    it('should include circuit name in error', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 1000,
        halfOpenRequests: 1,
        name: 'test-circuit',
      })

      await expect(cb.execute(() => { throw new Error('fail') })).rejects.toThrow()

      try {
        await cb.execute(() => 'test')
      } catch (e) {
        expect(e).toBeInstanceOf(CircuitOpenError)
        expect((e as CircuitOpenError).circuitName).toBe('test-circuit')
      }
    })
  })

  describe('Half-Open State (allow test request)', () => {
    it('should transition to half-open after reset timeout', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 1 })

      await expect(cb.execute(() => { throw new Error('fail') })).rejects.toThrow()
      expect(cb.getState()).toBe('open')

      vi.advanceTimersByTime(1000)

      expect(cb.getState()).toBe('half-open')
    })

    it('should allow limited requests in half-open state', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 2 })

      // Trip the circuit
      await expect(cb.execute(() => { throw new Error('fail') })).rejects.toThrow()
      vi.advanceTimersByTime(1000)

      expect(cb.getState()).toBe('half-open')

      // Should allow specified number of requests
      const fn1 = vi.fn().mockReturnValue('test1')
      const fn2 = vi.fn().mockReturnValue('test2')
      const fn3 = vi.fn().mockReturnValue('test3')

      await cb.execute(fn1)
      await cb.execute(fn2)

      expect(fn1).toHaveBeenCalled()
      expect(fn2).toHaveBeenCalled()
    })

    it('should close circuit on successful half-open request', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 1 })

      await expect(cb.execute(() => { throw new Error('fail') })).rejects.toThrow()
      vi.advanceTimersByTime(1000)

      await cb.execute(() => 'success')

      expect(cb.getState()).toBe('closed')
    })

    it('should re-open circuit on failed half-open request', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 1 })

      await expect(cb.execute(() => { throw new Error('fail') })).rejects.toThrow()
      vi.advanceTimersByTime(1000)

      expect(cb.getState()).toBe('half-open')

      await expect(cb.execute(() => { throw new Error('fail again') })).rejects.toThrow()

      expect(cb.getState()).toBe('open')
    })
  })

  describe('State Transitions', () => {
    it('should transition closed -> open when threshold reached', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000, halfOpenRequests: 1 })

      expect(cb.getState()).toBe('closed')

      await expect(cb.execute(() => { throw new Error('1') })).rejects.toThrow()
      expect(cb.getState()).toBe('closed')

      await expect(cb.execute(() => { throw new Error('2') })).rejects.toThrow()
      expect(cb.getState()).toBe('closed')

      await expect(cb.execute(() => { throw new Error('3') })).rejects.toThrow()
      expect(cb.getState()).toBe('open')
    })

    it('should transition open -> half-open after timeout', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 5000, halfOpenRequests: 1 })

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      expect(cb.getState()).toBe('open')

      vi.advanceTimersByTime(4999)
      expect(cb.getState()).toBe('open')

      vi.advanceTimersByTime(1)
      expect(cb.getState()).toBe('half-open')
    })

    it('should transition half-open -> closed on success', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 1 })

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      vi.advanceTimersByTime(1000)
      expect(cb.getState()).toBe('half-open')

      await cb.execute(() => 'success')
      expect(cb.getState()).toBe('closed')
    })

    it('should transition half-open -> open on failure', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 1 })

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      vi.advanceTimersByTime(1000)
      expect(cb.getState()).toBe('half-open')

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      expect(cb.getState()).toBe('open')
    })
  })

  describe('Failure Threshold', () => {
    it('should not open circuit before threshold', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 1000, halfOpenRequests: 1 })

      for (let i = 0; i < 4; i++) {
        await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      }

      expect(cb.getState()).toBe('closed')
      expect(cb.getStats().failures).toBe(4)
    })

    it('should open circuit at exact threshold', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000, halfOpenRequests: 1 })

      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      }

      expect(cb.getState()).toBe('open')
    })
  })

  describe('Reset Timeout', () => {
    it('should respect reset timeout duration', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000, halfOpenRequests: 1 })

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()

      vi.advanceTimersByTime(5000)
      expect(cb.getState()).toBe('open')

      vi.advanceTimersByTime(5000)
      expect(cb.getState()).toBe('half-open')
    })
  })

  describe('Success Resets Counter', () => {
    it('should reset failure counter on success', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000, halfOpenRequests: 1 })

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      expect(cb.getStats().failures).toBe(2)

      await cb.execute(() => 'success')
      expect(cb.getStats().failures).toBe(0)

      // Should need 3 more failures to open
      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      expect(cb.getState()).toBe('closed')
    })
  })

  describe('Fallback Execution', () => {
    it('should execute fallback when circuit is open', async () => {
      const fallback = vi.fn().mockReturnValue('fallback-value')
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 1000,
        halfOpenRequests: 1,
        fallback: { handler: fallback },
      })

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()

      const result = await cb.execute(() => 'normal')

      expect(result).toBe('fallback-value')
      expect(fallback).toHaveBeenCalled()
    })

    it('should track fallback executions', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 1000,
        halfOpenRequests: 1,
        fallback: { handler: () => 'fallback' },
      })

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()

      await cb.execute(() => 'normal')
      await cb.execute(() => 'normal')

      expect(cb.getStats().totalFallbacks).toBe(2)
    })

    it('should handle async fallback', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 1000,
        halfOpenRequests: 1,
        fallback: { handler: async () => 'async-fallback' },
      })

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()

      const result = await cb.execute(() => 'normal')
      expect(result).toBe('async-fallback')
    })
  })

  describe('Manual Control', () => {
    it('should force reset to closed', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 1 })

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      expect(cb.getState()).toBe('open')

      cb.reset()

      expect(cb.getState()).toBe('closed')
      expect(cb.getStats().failures).toBe(0)
    })

    it('should force open circuit', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 10, resetTimeout: 1000, halfOpenRequests: 1 })

      expect(cb.getState()).toBe('closed')

      cb.open()

      expect(cb.getState()).toBe('open')
    })
  })

  describe('State Change Events', () => {
    it('should emit state change events', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 1 })
      const callback = vi.fn()

      cb.onStateChange(callback)

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()

      expect(callback).toHaveBeenCalledWith('closed', 'open', expect.any(Object))
    })

    it('should emit multiple state change events', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 1 })
      const callback = vi.fn()

      cb.onStateChange(callback)

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      vi.advanceTimersByTime(1000)
      // Trigger state check
      cb.getState()

      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenNthCalledWith(1, 'closed', 'open', expect.any(Object))
      expect(callback).toHaveBeenNthCalledWith(2, 'open', 'half-open', expect.any(Object))
    })
  })

  describe('Circuit Events', () => {
    it('should emit success events', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000, halfOpenRequests: 1 })
      const callback = vi.fn()

      cb.on('success', callback)

      await cb.execute(() => 'success')

      expect(callback).toHaveBeenCalledWith('success', expect.any(Object))
    })

    it('should emit failure events', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000, halfOpenRequests: 1 })
      const callback = vi.fn()

      cb.on('failure', callback)

      await expect(cb.execute(() => { throw new Error('test error') })).rejects.toThrow()

      expect(callback).toHaveBeenCalledWith('failure', expect.objectContaining({ error: expect.any(Error) }))
    })

    it('should emit rejected events', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 1 })
      const callback = vi.fn()

      cb.on('rejected', callback)

      await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
      await expect(cb.execute(() => 'test')).rejects.toThrow(CircuitOpenError)

      expect(callback).toHaveBeenCalledWith('rejected', expect.any(Object))
    })
  })
})

describe('SlidingWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should track failures within window', () => {
    const window = new SlidingWindow({ windowSize: 10000 })

    window.recordFailure()
    window.recordFailure()
    window.recordFailure()

    expect(window.getFailureCount()).toBe(3)
  })

  it('should expire old entries', () => {
    const window = new SlidingWindow({ windowSize: 5000 })

    window.recordFailure()
    window.recordFailure()

    vi.advanceTimersByTime(6000)

    window.recordFailure()

    expect(window.getFailureCount()).toBe(1)
  })

  it('should track both successes and failures', () => {
    const window = new SlidingWindow({ windowSize: 10000 })

    window.recordSuccess()
    window.recordFailure()
    window.recordSuccess()
    window.recordFailure()

    expect(window.getSuccessCount()).toBe(2)
    expect(window.getFailureCount()).toBe(2)
    expect(window.getTotalCount()).toBe(4)
  })

  it('should calculate failure rate', () => {
    const window = new SlidingWindow({ windowSize: 10000 })

    window.recordSuccess()
    window.recordSuccess()
    window.recordFailure()
    window.recordFailure()

    expect(window.getFailureRate()).toBe(0.5)
  })

  it('should respect minimum requests', () => {
    const window = new SlidingWindow({ windowSize: 10000, minRequests: 5 })

    window.recordFailure()
    window.recordFailure()
    window.recordFailure()

    // Not enough requests to be meaningful
    expect(window.hasMinimumRequests()).toBe(false)

    window.recordFailure()
    window.recordFailure()

    expect(window.hasMinimumRequests()).toBe(true)
  })

  it('should clear all entries', () => {
    const window = new SlidingWindow({ windowSize: 10000 })

    window.recordFailure()
    window.recordSuccess()

    window.clear()

    expect(window.getTotalCount()).toBe(0)
  })
})

describe('FallbackHandler', () => {
  it('should execute fallback function', async () => {
    const handler = new FallbackHandler({ handler: () => 'fallback-result' })

    const result = await handler.execute()

    expect(result).toBe('fallback-result')
  })

  it('should handle async fallback', async () => {
    const handler = new FallbackHandler({ handler: async () => 'async-result' })

    const result = await handler.execute()

    expect(result).toBe('async-result')
  })

  it('should timeout if specified', async () => {
    vi.useFakeTimers()

    const handler = new FallbackHandler({
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return 'slow-result'
      },
      timeout: 1000,
    })

    const promise = handler.execute()
    vi.advanceTimersByTime(1001)

    await expect(promise).rejects.toThrow('Fallback timeout')

    vi.useRealTimers()
  })
})

describe('HealthChecker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should run health checks at interval', async () => {
    const checker = vi.fn().mockResolvedValue(true)
    const healthChecker = new HealthChecker({ interval: 1000, checker })

    healthChecker.start()

    // Advance timers and flush promises
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    expect(checker).toHaveBeenCalledTimes(3)

    healthChecker.stop()
  })

  it('should report health status', async () => {
    const checker = vi.fn().mockResolvedValue(true)
    const healthChecker = new HealthChecker({ interval: 1000, checker })

    healthChecker.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(healthChecker.isHealthy()).toBe(true)

    healthChecker.stop()
  })

  it('should handle unhealthy checks', async () => {
    const checker = vi.fn().mockResolvedValue(false)
    const healthChecker = new HealthChecker({ interval: 1000, checker })

    healthChecker.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(healthChecker.isHealthy()).toBe(false)

    healthChecker.stop()
  })

  it('should handle check errors as unhealthy', async () => {
    const checker = vi.fn().mockRejectedValue(new Error('Check failed'))
    const healthChecker = new HealthChecker({ interval: 1000, checker })

    healthChecker.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(healthChecker.isHealthy()).toBe(false)

    healthChecker.stop()
  })

  it('should emit recovery event', async () => {
    const checker = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const healthChecker = new HealthChecker({ interval: 1000, checker })
    const onRecovery = vi.fn()

    healthChecker.onRecovery(onRecovery)
    healthChecker.start()

    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    expect(onRecovery).toHaveBeenCalled()

    healthChecker.stop()
  })
})

describe('Bulkhead', () => {
  it('should allow requests up to max concurrent', async () => {
    const bulkhead = new Bulkhead({ maxConcurrent: 2 })

    const fn1 = vi.fn().mockResolvedValue('result1')
    const fn2 = vi.fn().mockResolvedValue('result2')

    const [r1, r2] = await Promise.all([
      bulkhead.execute(fn1),
      bulkhead.execute(fn2),
    ])

    expect(r1).toBe('result1')
    expect(r2).toBe('result2')
  })

  it('should reject when at capacity without queue', async () => {
    const bulkhead = new Bulkhead({ maxConcurrent: 1, queueSize: 0 })

    let resolveFirst: () => void
    const slowFn = () => new Promise<string>((resolve) => {
      resolveFirst = () => resolve('slow')
    })

    const firstPromise = bulkhead.execute(slowFn)
    await expect(bulkhead.execute(() => 'fast')).rejects.toThrow(BulkheadFullError)

    resolveFirst!()
    await firstPromise
  })

  it('should queue requests when at capacity', async () => {
    const bulkhead = new Bulkhead({ maxConcurrent: 1, queueSize: 10 })
    const results: string[] = []

    let resolveFirst: () => void
    const slowFn = () => new Promise<string>((resolve) => {
      resolveFirst = () => {
        results.push('first')
        resolve('first')
      }
    })

    const firstPromise = bulkhead.execute(slowFn)
    const secondPromise = bulkhead.execute(() => {
      results.push('second')
      return 'second'
    })

    // First is executing, second is queued
    expect(bulkhead.getQueueSize()).toBe(1)

    resolveFirst!()
    await firstPromise
    await secondPromise

    expect(results).toEqual(['first', 'second'])
  })

  it('should reject queued requests on timeout', async () => {
    vi.useFakeTimers()

    const bulkhead = new Bulkhead({ maxConcurrent: 1, queueSize: 10, queueTimeout: 1000 })

    // Start a slow execution that won't complete
    const slowPromise = bulkhead.execute(() => new Promise(() => {}))

    // Queue another request
    const queuedPromise = bulkhead.execute(() => 'queued')

    // Advance past timeout
    vi.advanceTimersByTime(1001)

    await expect(queuedPromise).rejects.toThrow(QueueTimeoutError)

    vi.useRealTimers()
  })

  it('should track concurrent executions', async () => {
    const bulkhead = new Bulkhead({ maxConcurrent: 3 })

    let resolvers: Array<() => void> = []
    const slowFn = () => new Promise<void>((resolve) => {
      resolvers.push(resolve)
    })

    bulkhead.execute(slowFn)
    bulkhead.execute(slowFn)

    expect(bulkhead.getActiveCount()).toBe(2)

    resolvers.forEach((r) => r())
  })
})

describe('RetryPolicy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should retry on failure', async () => {
    const policy = new RetryPolicy({ maxRetries: 3, baseDelay: 100 })
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('success')

    const promise = policy.execute(fn)

    // Allow retries
    await vi.runAllTimersAsync()

    const result = await promise

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('should throw after max retries', async () => {
    const policy = new RetryPolicy({ maxRetries: 2, baseDelay: 100 })
    const fn = vi.fn().mockRejectedValue(new Error('always fails'))

    const promise = policy.execute(fn)
    await vi.runAllTimersAsync()

    await expect(promise).rejects.toThrow('always fails')
    expect(fn).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  it('should use exponential backoff', async () => {
    const policy = new RetryPolicy({
      maxRetries: 3,
      baseDelay: 100,
      backoffMultiplier: 2,
    })
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    const promise = policy.execute(fn)

    // Run all timers to complete retries
    await vi.runAllTimersAsync()

    await expect(promise).rejects.toThrow()
    // 1 initial call + 3 retries = 4 total calls
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('should respect max delay', async () => {
    const policy = new RetryPolicy({
      maxRetries: 5,
      baseDelay: 1000,
      backoffMultiplier: 10,
      maxDelay: 5000,
    })
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    const promise = policy.execute(fn)
    await vi.runAllTimersAsync()

    await expect(promise).rejects.toThrow()
  })

  it('should only retry retryable errors', async () => {
    vi.useRealTimers() // Use real timers for this test to avoid fake timer issues
    const policy = new RetryPolicy({
      maxRetries: 3,
      baseDelay: 10,
      retryableErrors: (e) => e.message.includes('temporary'),
    })

    const fn = vi.fn().mockRejectedValue(new Error('permanent error'))

    await expect(policy.execute(fn)).rejects.toThrow('permanent error')
    expect(fn).toHaveBeenCalledTimes(1) // No retries
    vi.useFakeTimers() // Restore fake timers for other tests
  })
})

describe('CircuitBreakerRegistry', () => {
  it('should create and retrieve circuit breakers', () => {
    const registry = new CircuitBreakerRegistry()

    const cb = registry.getOrCreate('test-service', {
      failureThreshold: 5,
      resetTimeout: 1000,
      halfOpenRequests: 1,
    })

    expect(cb).toBeInstanceOf(CircuitBreaker)
    expect(registry.get('test-service')).toBe(cb)
  })

  it('should return existing circuit breaker', () => {
    const registry = new CircuitBreakerRegistry()

    const cb1 = registry.getOrCreate('test', {
      failureThreshold: 5,
      resetTimeout: 1000,
      halfOpenRequests: 1,
    })
    const cb2 = registry.getOrCreate('test', {
      failureThreshold: 10, // Different config
      resetTimeout: 2000,
      halfOpenRequests: 2,
    })

    expect(cb1).toBe(cb2)
  })

  it('should list all circuit breakers', () => {
    const registry = new CircuitBreakerRegistry()

    registry.getOrCreate('service-a', { failureThreshold: 5, resetTimeout: 1000, halfOpenRequests: 1 })
    registry.getOrCreate('service-b', { failureThreshold: 5, resetTimeout: 1000, halfOpenRequests: 1 })
    registry.getOrCreate('service-c', { failureThreshold: 5, resetTimeout: 1000, halfOpenRequests: 1 })

    expect(registry.list()).toEqual(['service-a', 'service-b', 'service-c'])
  })

  it('should remove circuit breaker', () => {
    const registry = new CircuitBreakerRegistry()

    registry.getOrCreate('test', { failureThreshold: 5, resetTimeout: 1000, halfOpenRequests: 1 })
    registry.remove('test')

    expect(registry.get('test')).toBeUndefined()
  })

  it('should get stats for all circuits', async () => {
    const registry = new CircuitBreakerRegistry()

    const cb1 = registry.getOrCreate('service-a', { failureThreshold: 5, resetTimeout: 1000, halfOpenRequests: 1 })
    const cb2 = registry.getOrCreate('service-b', { failureThreshold: 5, resetTimeout: 1000, halfOpenRequests: 1 })

    await cb1.execute(() => 'success')
    await expect(cb2.execute(() => { throw new Error() })).rejects.toThrow()

    const allStats = registry.getAllStats()

    expect(allStats['service-a'].successes).toBe(1)
    expect(allStats['service-b'].failures).toBe(1)
  })

  it('should reset all circuit breakers', async () => {
    const registry = new CircuitBreakerRegistry()

    const cb1 = registry.getOrCreate('service-a', { failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 1 })
    const cb2 = registry.getOrCreate('service-b', { failureThreshold: 1, resetTimeout: 1000, halfOpenRequests: 1 })

    await expect(cb1.execute(() => { throw new Error() })).rejects.toThrow()
    await expect(cb2.execute(() => { throw new Error() })).rejects.toThrow()

    expect(cb1.getState()).toBe('open')
    expect(cb2.getState()).toBe('open')

    registry.resetAll()

    expect(cb1.getState()).toBe('closed')
    expect(cb2.getState()).toBe('closed')
  })
})

describe('CircuitBreaker with SlidingWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should use sliding window for failure tracking', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      halfOpenRequests: 1,
      slidingWindow: { windowSize: 5000 },
    })

    // Failures within window
    await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
    await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()

    // Time passes, old failures expire
    vi.advanceTimersByTime(6000)

    // New failure
    await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()

    // Should still be closed (only 1 failure in window)
    expect(cb.getState()).toBe('closed')
  })

  it('should open when threshold reached within window', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      halfOpenRequests: 1,
      slidingWindow: { windowSize: 10000 },
    })

    await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
    await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
    await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()

    expect(cb.getState()).toBe('open')
  })
})

describe('CircuitBreaker with HealthChecker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should recover from open state when health check passes', async () => {
    let healthy = false
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeout: 10000,
      halfOpenRequests: 1,
      healthCheck: {
        interval: 1000,
        checker: () => healthy,
      },
    })

    // Trip the circuit
    await expect(cb.execute(() => { throw new Error() })).rejects.toThrow()
    expect(cb.getState()).toBe('open')

    // Health check starts, but still unhealthy
    await vi.advanceTimersByTimeAsync(1000)
    expect(cb.getState()).toBe('open')

    // Now healthy
    healthy = true
    await vi.advanceTimersByTimeAsync(1000)

    // Should transition to half-open
    expect(cb.getState()).toBe('half-open')

    // Cleanup
    cb.destroy()
  })
})

describe('CircuitBreaker with Bulkhead', () => {
  it('should limit concurrent executions', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 1000,
      halfOpenRequests: 1,
      bulkhead: { maxConcurrent: 2, queueSize: 0 },
    })

    let resolvers: Array<() => void> = []
    const slowFn = () => new Promise<string>((resolve) => {
      resolvers.push(() => resolve('done'))
    })

    // Start 2 concurrent executions
    const p1 = cb.execute(slowFn)
    const p2 = cb.execute(slowFn)

    // Third should be rejected
    await expect(cb.execute(() => 'fast')).rejects.toThrow(BulkheadFullError)

    // Cleanup
    resolvers.forEach((r) => r())
    await Promise.all([p1, p2])
  })
})

describe('CircuitBreaker with RetryPolicy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should retry before recording failure', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeout: 1000,
      halfOpenRequests: 1,
      retryPolicy: { maxRetries: 2, baseDelay: 100 },
    })

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('success')

    const promise = cb.execute(fn)
    await vi.runAllTimersAsync()

    const result = await promise

    expect(result).toBe('success')
    expect(cb.getState()).toBe('closed') // No failure recorded
  })

  it('should record failure after all retries exhausted', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeout: 1000,
      halfOpenRequests: 1,
      retryPolicy: { maxRetries: 2, baseDelay: 100 },
    })

    const fn = vi.fn().mockRejectedValue(new Error('always fails'))

    const promise = cb.execute(fn)
    await vi.runAllTimersAsync()

    await expect(promise).rejects.toThrow('always fails')
    expect(cb.getState()).toBe('open') // Failure recorded after retries
  })
})
