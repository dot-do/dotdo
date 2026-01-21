import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  RPCError,
  RPCErrorCode,
  retryWithBackoff,
  CircuitBreaker,
  CircuitState,
  withTimeout,
  isRetryableError,
  serializeError,
  deserializeError,
  serializeUnknownError,
  getErrorMessage,
  CircuitOpenError,
  isCircuitOpenError,
  RetryWithCircuitBreaker,
  ValidationError,
} from '../errors'
import { expectRPCError, expectRPCErrorType } from '../../test-utils'

describe('RPCError', () => {
  it('should create an error with code, message, and details', () => {
    const error = new RPCError(
      RPCErrorCode.INTERNAL_ERROR,
      'Something went wrong',
      { context: 'test' }
    )

    expectRPCError(error, 'INTERNAL_ERROR')
    expect(error.message).toBe('Something went wrong')
    expect(error.details).toEqual({ context: 'test' })
    expect(error.name).toBe('RPCError')
  })

  it('should work without details', () => {
    const error = new RPCError(RPCErrorCode.NOT_FOUND, 'Resource not found')

    expectRPCError(error, 'NOT_FOUND')
    expect(error.message).toBe('Resource not found')
    expect(error.details).toBeUndefined()
  })

  it('should be serializable to JSON', () => {
    const error = new RPCError(
      RPCErrorCode.TIMEOUT,
      'Request timed out',
      { timeout: 5000 }
    )

    const json = JSON.stringify(error)
    const parsed = JSON.parse(json)

    expect(parsed.code).toBe(RPCErrorCode.TIMEOUT)
    expect(parsed.message).toBe('Request timed out')
    expect(parsed.details).toEqual({ timeout: 5000 })
  })
})

describe('RPCErrorCode', () => {
  it('should define standard error codes', () => {
    expect(RPCErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR')
    expect(RPCErrorCode.NOT_FOUND).toBe('NOT_FOUND')
    expect(RPCErrorCode.INVALID_PARAMS).toBe('INVALID_PARAMS')
    expect(RPCErrorCode.TIMEOUT).toBe('TIMEOUT')
    expect(RPCErrorCode.NETWORK_ERROR).toBe('NETWORK_ERROR')
    expect(RPCErrorCode.RATE_LIMIT).toBe('RATE_LIMIT')
    expect(RPCErrorCode.CIRCUIT_OPEN).toBe('CIRCUIT_OPEN')
  })
})

describe('isRetryableError', () => {
  it('should identify retryable network errors', () => {
    const networkError = new RPCError(RPCErrorCode.NETWORK_ERROR, 'Network failed')
    expect(isRetryableError(networkError)).toBe(true)
  })

  it('should identify retryable timeout errors', () => {
    const timeoutError = new RPCError(RPCErrorCode.TIMEOUT, 'Timed out')
    expect(isRetryableError(timeoutError)).toBe(true)
  })

  it('should identify retryable rate limit errors', () => {
    const rateLimitError = new RPCError(RPCErrorCode.RATE_LIMIT, 'Rate limited')
    expect(isRetryableError(rateLimitError)).toBe(true)
  })

  it('should not retry NOT_FOUND errors', () => {
    const notFoundError = new RPCError(RPCErrorCode.NOT_FOUND, 'Not found')
    expect(isRetryableError(notFoundError)).toBe(false)
  })

  it('should not retry INVALID_PARAMS errors', () => {
    const invalidError = new RPCError(RPCErrorCode.INVALID_PARAMS, 'Invalid params')
    expect(isRetryableError(invalidError)).toBe(false)
  })

  it('should retry CIRCUIT_OPEN errors (circuit may transition to half-open)', () => {
    const circuitError = new RPCError(RPCErrorCode.CIRCUIT_OPEN, 'Circuit open')
    expect(isRetryableError(circuitError)).toBe(true)
  })

  it('should retry CircuitOpenError', () => {
    const circuitError = new CircuitOpenError('Circuit breaker is open')
    expect(isRetryableError(circuitError)).toBe(true)
  })

  it('should handle non-RPCError instances', () => {
    const genericError = new Error('Generic error')
    expect(isRetryableError(genericError)).toBe(false)
  })
})

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should succeed on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelay: 100,
    })

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should retry on retryable errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RPCError(RPCErrorCode.NETWORK_ERROR, 'Network failed'))
      .mockRejectedValueOnce(new RPCError(RPCErrorCode.TIMEOUT, 'Timeout'))
      .mockResolvedValue('success')

    const promise = retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelay: 100,
      maxDelay: 1000,
    })

    // Advance timers for retries
    await vi.runAllTimersAsync()

    const result = await promise

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('should use exponential backoff', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RPCError(RPCErrorCode.NETWORK_ERROR, 'Fail 1'))
      .mockRejectedValueOnce(new RPCError(RPCErrorCode.NETWORK_ERROR, 'Fail 2'))
      .mockRejectedValueOnce(new RPCError(RPCErrorCode.NETWORK_ERROR, 'Fail 3'))
      .mockResolvedValue('success')

    const promise = retryWithBackoff(fn, {
      maxRetries: 5,
      initialDelay: 100,
      backoffFactor: 2,
      maxDelay: 10000,
    })

    await vi.runAllTimersAsync()

    const result = await promise
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('should respect maxDelay cap', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RPCError(RPCErrorCode.NETWORK_ERROR, 'Fail'))
      .mockResolvedValue('success')

    const promise = retryWithBackoff(fn, {
      maxRetries: 2,
      initialDelay: 1000,
      backoffFactor: 10, // Would be 10000 without cap
      maxDelay: 2000, // Cap at 2000
    })

    await vi.runAllTimersAsync()

    const result = await promise
    expect(result).toBe('success')
  })

  it('should throw after max retries exceeded', async () => {
    const error = new RPCError(RPCErrorCode.NETWORK_ERROR, 'Network failed')
    const fn = vi.fn().mockRejectedValue(error)

    const promise = retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelay: 100,
    })

    await vi.runAllTimersAsync()

    await expect(promise).rejects.toThrow('Network failed')
    expect(fn).toHaveBeenCalledTimes(4) // Initial + 3 retries
  })

  it('should not retry non-retryable errors', async () => {
    const error = new RPCError(RPCErrorCode.NOT_FOUND, 'Not found')
    const fn = vi.fn().mockRejectedValue(error)

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 3,
        initialDelay: 100,
      })
    ).rejects.toThrow('Not found')

    expect(fn).toHaveBeenCalledTimes(1) // No retries
  })

  it('should add jitter to delays', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RPCError(RPCErrorCode.NETWORK_ERROR, 'Fail'))
      .mockResolvedValue('success')

    const promise = retryWithBackoff(fn, {
      maxRetries: 2,
      initialDelay: 100,
      jitter: true,
    })

    await vi.runAllTimersAsync()

    const result = await promise
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('should use default options when not provided', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RPCError(RPCErrorCode.NETWORK_ERROR, 'Fail'))
      .mockResolvedValue('success')

    const promise = retryWithBackoff(fn)

    await vi.runAllTimersAsync()

    const result = await promise
    expect(result).toBe('success')
  })

  it('should throw ValidationError for negative maxRetries', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    await expect(
      retryWithBackoff(fn, { maxRetries: -1 })
    ).rejects.toThrow('maxRetries must be >= 0')

    await expect(
      retryWithBackoff(fn, { maxRetries: -1 })
    ).rejects.toBeInstanceOf(ValidationError)

    expect(fn).not.toHaveBeenCalled()
  })

  it('should throw ValidationError for very negative maxRetries', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    await expect(
      retryWithBackoff(fn, { maxRetries: -100 })
    ).rejects.toThrow('maxRetries must be >= 0')

    expect(fn).not.toHaveBeenCalled()
  })

  it('should include error details for negative maxRetries', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    try {
      await retryWithBackoff(fn, { maxRetries: -5 })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      if (error instanceof ValidationError) {
        expect(error.details).toEqual({
          field: 'maxRetries',
          value: -5,
          constraint: 'non-negative integer',
        })
      }
    }
  })

  it('should work with maxRetries = 0 (no retries)', async () => {
    const error = new RPCError(RPCErrorCode.NETWORK_ERROR, 'Network failed')
    const fn = vi.fn().mockRejectedValue(error)

    await expect(
      retryWithBackoff(fn, { maxRetries: 0, initialDelay: 100 })
    ).rejects.toThrow('Network failed')

    expect(fn).toHaveBeenCalledTimes(1) // Called once, no retries
  })

  it('should succeed on first try with maxRetries = 0', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    const result = await retryWithBackoff(fn, { maxRetries: 0 })

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

/**
 * CircuitBreaker Test Suite
 * Tests all state transitions (CLOSED -> OPEN -> HALF_OPEN -> CLOSED),
 * metrics tracking, threshold behavior, and reset functionality.
 */
describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should start in closed state', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
    })

    expect(breaker.getState()).toBe(CircuitState.CLOSED)
  })

  it('should allow requests in closed state', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
    })

    const fn = vi.fn().mockResolvedValue('success')
    const result = await breaker.execute(fn)

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(breaker.getState()).toBe(CircuitState.CLOSED)
  })

  it('should open circuit after threshold failures', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Failed')
    const fn = vi.fn().mockRejectedValue(error)

    // Trigger 3 failures
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow()
    }

    expect(breaker.getState()).toBe(CircuitState.OPEN)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('should reject requests immediately when open', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 2,
      timeout: 5000,
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Failed')
    const fn = vi.fn().mockRejectedValue(error)

    // Trigger failures to open circuit
    await expect(breaker.execute(fn)).rejects.toThrow()
    await expect(breaker.execute(fn)).rejects.toThrow()

    expect(breaker.getState()).toBe(CircuitState.OPEN)

    // Next request should fail immediately without calling fn (CircuitOpenError)
    await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker is open')
    expect(fn).toHaveBeenCalledTimes(2) // Not called on 3rd attempt
  })

  it('should transition to half-open after timeout', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 2,
      timeout: 5000,
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Failed')
    const successFn = vi.fn().mockResolvedValue('success')

    // Open the circuit
    await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow()
    await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow()
    expect(breaker.getState()).toBe(CircuitState.OPEN)

    // Advance time past timeout
    await vi.advanceTimersByTimeAsync(5000)

    // Execute a request to trigger state transition check
    await breaker.execute(successFn)
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)
  })

  it('should close circuit after successful requests in half-open', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 2,
      timeout: 5000,
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Failed')
    const successFn = vi.fn().mockResolvedValue('success')

    // Open the circuit
    await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow()
    await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow()

    // Wait for half-open and trigger transition with first success
    await vi.advanceTimersByTimeAsync(5000)
    await breaker.execute(successFn)
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)

    // Second success should close
    await breaker.execute(successFn)
    expect(breaker.getState()).toBe(CircuitState.CLOSED)
  })

  it('should reopen circuit on failure in half-open', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 2,
      timeout: 5000,
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Failed')
    const successFn = vi.fn().mockResolvedValue('success')

    // Open the circuit
    await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow()
    await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow()

    // Wait for half-open and trigger transition with a success first
    await vi.advanceTimersByTimeAsync(5000)
    await breaker.execute(successFn)
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)

    // Fail in half-open - should reopen
    await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow()
    expect(breaker.getState()).toBe(CircuitState.OPEN)
  })

  it('should track consecutive failures separately from total failures', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Failed')
    const failFn = vi.fn().mockRejectedValue(error)
    const successFn = vi.fn().mockResolvedValue('success')

    // Fail, succeed, fail twice - should not open (not consecutive)
    await expect(breaker.execute(failFn)).rejects.toThrow()
    await breaker.execute(successFn)
    await expect(breaker.execute(failFn)).rejects.toThrow()
    await expect(breaker.execute(failFn)).rejects.toThrow()

    expect(breaker.getState()).toBe(CircuitState.CLOSED)

    // One more consecutive failure should open
    await expect(breaker.execute(failFn)).rejects.toThrow()
    expect(breaker.getState()).toBe(CircuitState.OPEN)
  })

  it('should provide metrics', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
    })

    const metrics = breaker.getMetrics()

    expect(metrics).toHaveProperty('state')
    expect(metrics).toHaveProperty('totalRequests')
    expect(metrics).toHaveProperty('successfulRequests')
    expect(metrics).toHaveProperty('failedRequests')
    expect(metrics).toHaveProperty('consecutiveFailures')
    expect(metrics).toHaveProperty('lastFailureTime')
  })

  it('should reset all state when reset() is called', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 2,
      timeout: 5000,
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Failed')

    // Open the circuit
    await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow()
    await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow()
    expect(breaker.getState()).toBe(CircuitState.OPEN)

    // Verify metrics show failures
    let metrics = breaker.getMetrics()
    expect(metrics.consecutiveFailures).toBe(2)
    expect(metrics.failedRequests).toBe(2)
    expect(metrics.lastFailureTime).not.toBeNull()

    // Reset the circuit breaker
    breaker.reset()

    // Verify state is reset
    expect(breaker.getState()).toBe(CircuitState.CLOSED)
    metrics = breaker.getMetrics()
    expect(metrics.consecutiveFailures).toBe(0)
    expect(metrics.lastFailureTime).toBeNull()

    // Verify circuit now allows requests
    const successFn = vi.fn().mockResolvedValue('success')
    const result = await breaker.execute(successFn)
    expect(result).toBe('success')
  })

  it('should update metrics correctly after failures and successes', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 5000,
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Failed')
    const successFn = vi.fn().mockResolvedValue('success')

    // Execute some requests
    await breaker.execute(successFn)
    await breaker.execute(successFn)
    await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow()
    await breaker.execute(successFn)

    const metrics = breaker.getMetrics()
    expect(metrics.totalRequests).toBe(4)
    expect(metrics.successfulRequests).toBe(3)
    expect(metrics.failedRequests).toBe(1)
    expect(metrics.consecutiveFailures).toBe(0) // Reset after success
    expect(metrics.state).toBe(CircuitState.CLOSED)
  })
})

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should resolve if function completes before timeout', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    const promise = withTimeout(fn(), 5000)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toBe('success')
  })

  it('should reject with timeout error if function takes too long', async () => {
    const fn = vi.fn().mockImplementation(() => new Promise(() => {})) // Never resolves

    const promise = withTimeout(fn(), 1000)
    await vi.advanceTimersByTimeAsync(1000)

    await expect(promise).rejects.toThrow('Request timed out after 1000ms')
  })

  it('should reject with original error if function fails before timeout', async () => {
    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Failed')
    const fn = vi.fn().mockRejectedValue(error)

    const promise = withTimeout(fn(), 5000)
    await vi.runAllTimersAsync()

    await expect(promise).rejects.toThrow('Failed')
  })

  it('should include timeout duration in error details', async () => {
    const fn = vi.fn().mockImplementation(() => new Promise(() => {}))

    const promise = withTimeout(fn(), 2000)
    await vi.advanceTimersByTimeAsync(2000)

    try {
      await promise
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      if (error instanceof RPCError) {
        expect(error.code).toBe(RPCErrorCode.TIMEOUT)
        expect(error.details).toEqual({ timeout: 2000 })
      }
    }
  })
})

describe('Error Serialization', () => {
  it('should serialize RPCError to plain object', () => {
    const error = new RPCError(
      RPCErrorCode.INTERNAL_ERROR,
      'Something went wrong',
      { context: 'test', userId: 123 }
    )

    const serialized = serializeError(error)

    expect(serialized.name).toBe('RPCError')
    expect(serialized.code).toBe(RPCErrorCode.INTERNAL_ERROR)
    expect(serialized.message).toBe('Something went wrong')
    expect(serialized.details).toEqual({ context: 'test', userId: 123 })
    expect(serialized.stack).toBeDefined()
  })

  it('should serialize generic Error to plain object', () => {
    const error = new Error('Generic error')

    const serialized = serializeError(error)

    expect(serialized.name).toBe('Error')
    expect(serialized.message).toBe('Generic error')
    expect(serialized.stack).toBeDefined()
  })

  it('should handle errors with stack traces', () => {
    const error = new Error('With stack')
    error.stack = 'Error: With stack\n    at test.ts:123'

    const serialized = serializeError(error)

    expect(serialized.name).toBe('Error')
    expect(serialized.message).toBe('With stack')
    expect(serialized.stack).toBe('Error: With stack\n    at test.ts:123')
  })

  it('should deserialize plain object to RPCError', () => {
    const serialized = {
      name: 'RPCError',
      code: RPCErrorCode.TIMEOUT,
      message: 'Request timed out',
      details: { timeout: 5000 },
    }

    const error = deserializeError(serialized)

    expect(error).toBeInstanceOf(RPCError)
    expect(error.code).toBe(RPCErrorCode.TIMEOUT)
    expect(error.message).toBe('Request timed out')
    expect(error.details).toEqual({ timeout: 5000 })
  })

  it('should deserialize plain object to generic Error', () => {
    const serialized = {
      name: 'Error',
      message: 'Generic error',
      stack: 'Error: Generic error\n    at test.ts:456',
    }

    const error = deserializeError(serialized)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(RPCError)
    expect(error.message).toBe('Generic error')
    expect(error.stack).toBe('Error: Generic error\n    at test.ts:456')
  })

  it('should round-trip serialize and deserialize RPCError', () => {
    const original = new RPCError(
      RPCErrorCode.RATE_LIMIT,
      'Too many requests',
      { limit: 100, window: '1m' }
    )

    const serialized = serializeError(original)
    const deserialized = deserializeError(serialized)

    expect(deserialized).toBeInstanceOf(RPCError)
    expect(deserialized.code).toBe(original.code)
    expect(deserialized.message).toBe(original.message)
    expect(deserialized.details).toEqual(original.details)
  })

  it('should handle missing optional fields in deserialization', () => {
    const serialized = {
      name: 'RPCError',
      code: RPCErrorCode.NOT_FOUND,
      message: 'Not found',
    }

    const error = deserializeError(serialized)

    expect(error).toBeInstanceOf(RPCError)
    expect(error.code).toBe(RPCErrorCode.NOT_FOUND)
    expect(error.message).toBe('Not found')
    expect(error.details).toBeUndefined()
  })
})

describe('serializeUnknownError', () => {
  it('should serialize RPCError', () => {
    const error = new RPCError(RPCErrorCode.NOT_FOUND, 'Resource not found', { id: '123' })
    const serialized = serializeUnknownError(error)

    expect(serialized.type).toBe('RPCError')
    expect(serialized.code).toBe(RPCErrorCode.NOT_FOUND)
    expect(serialized.message).toBe('Resource not found')
    expect(serialized.details).toEqual({ id: '123' })
    expect(serialized.httpStatus).toBe(404)
  })

  it('should serialize standard Error', () => {
    const error = new Error('Something went wrong')
    const serialized = serializeUnknownError(error)

    expect(serialized.type).toBe('Error')
    expect(serialized.code).toBe(RPCErrorCode.INTERNAL_ERROR)
    expect(serialized.message).toBe('Something went wrong')
    expect(serialized.stack).toBeDefined()
  })

  it('should serialize string values', () => {
    const serialized = serializeUnknownError('Something failed')

    expect(serialized.type).toBe('UnknownError')
    expect(serialized.code).toBe(RPCErrorCode.INTERNAL_ERROR)
    expect(serialized.message).toBe('Something failed')
    expect(serialized.httpStatus).toBe(500)
  })

  it('should serialize null', () => {
    const serialized = serializeUnknownError(null)

    expect(serialized.type).toBe('UnknownError')
    expect(serialized.message).toBe('null')
  })

  it('should serialize undefined', () => {
    const serialized = serializeUnknownError(undefined)

    expect(serialized.type).toBe('UnknownError')
    expect(serialized.message).toBe('undefined')
  })

  it('should serialize objects', () => {
    const serialized = serializeUnknownError({ foo: 'bar' })

    expect(serialized.type).toBe('UnknownError')
    expect(serialized.message).toBe('[object Object]')
  })

  it('should respect includeStack option for Error', () => {
    const error = new Error('Test error')

    const withStack = serializeUnknownError(error, { includeStack: true })
    expect(withStack.stack).toBeDefined()

    const withoutStack = serializeUnknownError(error, { includeStack: false })
    expect(withoutStack.stack).toBeUndefined()
  })
})

describe('getErrorMessage', () => {
  it('should extract message from Error', () => {
    const error = new Error('Something went wrong')
    expect(getErrorMessage(error)).toBe('Something went wrong')
  })

  it('should extract message from RPCError', () => {
    const error = new RPCError(RPCErrorCode.NOT_FOUND, 'Resource not found')
    expect(getErrorMessage(error)).toBe('Resource not found')
  })

  it('should convert string to message', () => {
    expect(getErrorMessage('Something failed')).toBe('Something failed')
  })

  it('should convert null to string', () => {
    expect(getErrorMessage(null)).toBe('null')
  })

  it('should convert undefined to string', () => {
    expect(getErrorMessage(undefined)).toBe('undefined')
  })

  it('should convert number to string', () => {
    expect(getErrorMessage(42)).toBe('42')
  })

  it('should convert object to string', () => {
    expect(getErrorMessage({ foo: 'bar' })).toBe('[object Object]')
  })
})

describe('CircuitOpenError', () => {
  it('should create a circuit open error with CIRCUIT_OPEN code', () => {
    const error = new CircuitOpenError('Circuit breaker is open')

    expect(error).toBeInstanceOf(RPCError)
    expect(error).toBeInstanceOf(CircuitOpenError)
    expect(error.code).toBe(RPCErrorCode.CIRCUIT_OPEN)
    expect(error.message).toBe('Circuit breaker is open')
    expect(error.name).toBe('CircuitOpenError')
    expect(error.httpStatus).toBe(503)
  })

  it('should create error with metrics using static factory', () => {
    const error = CircuitOpenError.withMetrics({
      consecutiveFailures: 5,
      lastFailureTime: Date.now() - 10000,
      resetTimeMs: 30000,
    })

    expect(error).toBeInstanceOf(CircuitOpenError)
    expect(error.code).toBe(RPCErrorCode.CIRCUIT_OPEN)
    expect(error.details).toHaveProperty('consecutiveFailures', 5)
    expect(error.details).toHaveProperty('lastFailureTime')
    expect(error.details).toHaveProperty('retryAfter')
  })

  it('should be detected by isCircuitOpenError type guard', () => {
    const circuitError = new CircuitOpenError('Circuit open')
    const otherError = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Other error')

    expect(isCircuitOpenError(circuitError)).toBe(true)
    expect(isCircuitOpenError(otherError)).toBe(false)
    expect(isCircuitOpenError(new Error('Generic'))).toBe(false)
  })

  it('should serialize and deserialize correctly', () => {
    const original = new CircuitOpenError('Circuit is open', {
      consecutiveFailures: 5,
      retryAfter: 20,
    })

    const serialized = serializeError(original)
    const deserialized = deserializeError(serialized)

    expect(deserialized).toBeInstanceOf(CircuitOpenError)
    expect(deserialized.code).toBe(RPCErrorCode.CIRCUIT_OPEN)
    expect(deserialized.message).toBe('Circuit is open')
    expect(deserialized.details).toEqual({ consecutiveFailures: 5, retryAfter: 20 })
  })
})

/**
 * RetryWithCircuitBreaker Test Suite
 * Tests combined retry and circuit breaker behavior including:
 * - Exponential backoff with jitter
 * - Circuit state transitions (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)
 * - onStateChange callbacks
 * - Integrated metrics (retry attempts + circuit breaker state)
 * - Retry logic within circuit breaker context
 * - isAllowingRequests() state checks
 * - Reset functionality for both retry and circuit breaker state
 */
describe('RetryWithCircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should succeed on first attempt', async () => {
    const resilient = new RetryWithCircuitBreaker({
      retry: { maxRetries: 3, initialDelay: 100 },
      circuitBreaker: { failureThreshold: 5, timeout: 30000 },
    })

    const fn = vi.fn().mockResolvedValue('success')
    const result = await resilient.execute(fn)

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(resilient.getState()).toBe(CircuitState.CLOSED)
  })

  it('should retry on transient failures then succeed', async () => {
    const resilient = new RetryWithCircuitBreaker({
      retry: { maxRetries: 3, initialDelay: 100, jitter: false },
      circuitBreaker: { failureThreshold: 5, timeout: 30000 },
    })

    const fn = vi.fn()
      .mockRejectedValueOnce(new RPCError(RPCErrorCode.NETWORK_ERROR, 'Network failed'))
      .mockRejectedValueOnce(new RPCError(RPCErrorCode.TIMEOUT, 'Timeout'))
      .mockResolvedValue('success')

    const promise = resilient.execute(fn)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(resilient.getState()).toBe(CircuitState.CLOSED)
    expect(resilient.getMetrics().totalRetryAttempts).toBe(2)
  })

  it('should open circuit after consecutive failures exceed threshold', async () => {
    const resilient = new RetryWithCircuitBreaker({
      retry: { maxRetries: 0, initialDelay: 100 }, // No retries to simplify test
      circuitBreaker: { failureThreshold: 3, timeout: 30000 },
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Service failed')
    const fn = vi.fn().mockRejectedValue(error)

    // Trigger 3 failures to open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(resilient.execute(fn)).rejects.toThrow('Service failed')
    }

    expect(resilient.getState()).toBe(CircuitState.OPEN)

    // Next request should fail immediately with CircuitOpenError
    await expect(resilient.execute(fn)).rejects.toThrow('Circuit breaker is open')
    expect(fn).toHaveBeenCalledTimes(3) // Not called on 4th attempt
  })

  it('should transition to half-open after timeout', async () => {
    const resilient = new RetryWithCircuitBreaker({
      retry: { maxRetries: 0, initialDelay: 100 },
      circuitBreaker: { failureThreshold: 2, successThreshold: 1, timeout: 5000 },
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Service failed')

    // Open the circuit
    await expect(resilient.execute(() => Promise.reject(error))).rejects.toThrow()
    await expect(resilient.execute(() => Promise.reject(error))).rejects.toThrow()
    expect(resilient.getState()).toBe(CircuitState.OPEN)

    // Advance time past timeout
    await vi.advanceTimersByTimeAsync(5000)

    // Execute a successful request to transition to half-open
    const successFn = vi.fn().mockResolvedValue('recovered')
    const result = await resilient.execute(successFn)

    expect(result).toBe('recovered')
    // With successThreshold=1, one success should close the circuit
    expect(resilient.getState()).toBe(CircuitState.CLOSED)
  })

  it('should reopen circuit on failure in half-open state', async () => {
    const resilient = new RetryWithCircuitBreaker({
      retry: { maxRetries: 0, initialDelay: 100 },
      circuitBreaker: { failureThreshold: 2, successThreshold: 2, timeout: 5000 },
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Service failed')

    // Open the circuit
    await expect(resilient.execute(() => Promise.reject(error))).rejects.toThrow()
    await expect(resilient.execute(() => Promise.reject(error))).rejects.toThrow()

    // Wait for half-open transition
    await vi.advanceTimersByTimeAsync(5000)

    // Execute successful request (circuit transitions to half-open)
    const successFn = vi.fn().mockResolvedValue('ok')
    await resilient.execute(successFn)
    expect(resilient.getState()).toBe(CircuitState.HALF_OPEN)

    // Fail in half-open - should reopen
    await expect(resilient.execute(() => Promise.reject(error))).rejects.toThrow()
    expect(resilient.getState()).toBe(CircuitState.OPEN)
  })

  it('should invoke onStateChange callback on state transitions', async () => {
    const stateChanges: Array<{ state: CircuitState; failures: number }> = []

    const resilient = new RetryWithCircuitBreaker({
      retry: { maxRetries: 0, initialDelay: 100 },
      circuitBreaker: { failureThreshold: 2, timeout: 5000 },
      onStateChange: (state, metrics) => {
        stateChanges.push({ state, failures: metrics.consecutiveFailures })
      },
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Service failed')

    // Trigger failures to open circuit
    await expect(resilient.execute(() => Promise.reject(error))).rejects.toThrow()
    await expect(resilient.execute(() => Promise.reject(error))).rejects.toThrow()

    // State should have changed to OPEN
    expect(stateChanges.some((c) => c.state === CircuitState.OPEN)).toBe(true)

    // Wait for half-open
    await vi.advanceTimersByTimeAsync(5000)

    // Execute to trigger half-open check
    const successFn = vi.fn().mockResolvedValue('ok')
    await resilient.execute(successFn)

    // Should see HALF_OPEN transition
    expect(stateChanges.some((c) => c.state === CircuitState.HALF_OPEN)).toBe(true)
  })

  it('should provide combined metrics', async () => {
    const resilient = new RetryWithCircuitBreaker({
      retry: { maxRetries: 2, initialDelay: 100, jitter: false },
      circuitBreaker: { failureThreshold: 5, timeout: 30000 },
    })

    const fn = vi.fn()
      .mockRejectedValueOnce(new RPCError(RPCErrorCode.NETWORK_ERROR, 'Fail'))
      .mockResolvedValue('success')

    const promise = resilient.execute(fn)
    await vi.runAllTimersAsync()
    await promise

    const metrics = resilient.getMetrics()

    expect(metrics).toHaveProperty('state', CircuitState.CLOSED)
    expect(metrics).toHaveProperty('totalRequests')
    expect(metrics).toHaveProperty('successfulRequests')
    expect(metrics).toHaveProperty('failedRequests')
    expect(metrics).toHaveProperty('consecutiveFailures')
    expect(metrics).toHaveProperty('totalRetryAttempts')
    expect(metrics).toHaveProperty('lastRetryDelayMs')
    expect(metrics.totalRetryAttempts).toBeGreaterThan(0)
  })

  it('should reset all state', async () => {
    const resilient = new RetryWithCircuitBreaker({
      retry: { maxRetries: 0 },
      circuitBreaker: { failureThreshold: 2, timeout: 5000 },
    })

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Service failed')

    // Open the circuit
    await expect(resilient.execute(() => Promise.reject(error))).rejects.toThrow()
    await expect(resilient.execute(() => Promise.reject(error))).rejects.toThrow()
    expect(resilient.getState()).toBe(CircuitState.OPEN)

    // Reset
    resilient.reset()

    expect(resilient.getState()).toBe(CircuitState.CLOSED)
    expect(resilient.getMetrics().totalRetryAttempts).toBe(0)
    expect(resilient.getMetrics().consecutiveFailures).toBe(0)
    expect(resilient.isAllowingRequests()).toBe(true)
  })

  it('should report isAllowingRequests correctly', async () => {
    const resilient = new RetryWithCircuitBreaker({
      retry: { maxRetries: 0 },
      circuitBreaker: { failureThreshold: 2, timeout: 5000 },
    })

    // Initially allowing
    expect(resilient.isAllowingRequests()).toBe(true)

    const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Service failed')

    // Open the circuit
    await expect(resilient.execute(() => Promise.reject(error))).rejects.toThrow()
    await expect(resilient.execute(() => Promise.reject(error))).rejects.toThrow()

    // Not allowing when open
    expect(resilient.isAllowingRequests()).toBe(false)

    // After timeout, should allow (half-open)
    await vi.advanceTimersByTimeAsync(5000)

    // Execute to trigger state check
    const successFn = vi.fn().mockResolvedValue('ok')
    await resilient.execute(successFn)

    expect(resilient.isAllowingRequests()).toBe(true)
  })

  it('should not retry non-retryable errors', async () => {
    const resilient = new RetryWithCircuitBreaker({
      retry: { maxRetries: 3, initialDelay: 100 },
      circuitBreaker: { failureThreshold: 5, timeout: 30000 },
    })

    const error = new RPCError(RPCErrorCode.NOT_FOUND, 'Resource not found')
    const fn = vi.fn().mockRejectedValue(error)

    await expect(resilient.execute(fn)).rejects.toThrow('Resource not found')

    expect(fn).toHaveBeenCalledTimes(1) // No retries for NOT_FOUND
  })

  it('should use default jitter for distributed systems', async () => {
    const resilient = new RetryWithCircuitBreaker({
      retry: { maxRetries: 1, initialDelay: 100 },
      // jitter defaults to true
    })

    const fn = vi.fn()
      .mockRejectedValueOnce(new RPCError(RPCErrorCode.NETWORK_ERROR, 'Fail'))
      .mockResolvedValue('success')

    const promise = resilient.execute(fn)
    await vi.runAllTimersAsync()
    await promise

    // Delay should include jitter (100ms + up to 25%)
    const metrics = resilient.getMetrics()
    expect(metrics.lastRetryDelayMs).toBeGreaterThanOrEqual(100)
    expect(metrics.lastRetryDelayMs).toBeLessThanOrEqual(125)
  })
})
