/**
 * @module rpc.do/tests/retry-transport
 *
 * Tests for RetryTransport with exponential backoff
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import type { RPCMessage, RPCResponse } from '../src/types'
import type { Transport } from '../src/transport/types'

describe('RetryTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('retry behavior', () => {
    it('should retry on transient errors', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const sendMock = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue({ result: 'ok' })

      const baseTransport = { send: sendMock }

      const transport = new RetryTransport({
        transport: baseTransport,
        maxRetries: 3,
        jitter: 'none',
      })

      const resultPromise = transport.send({ method: 'test', args: [] })

      // Fast-forward through all retries
      await vi.runAllTimersAsync()

      const result = await resultPromise
      expect(result.result).toBe('ok')
      expect(baseTransport.send).toHaveBeenCalledTimes(3)
    })

    it('should not retry on non-retryable errors', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const sendMock = vi.fn().mockResolvedValue({
        error: { type: 'NotFoundError', code: 'NOT_FOUND', message: 'Not found' },
      })

      const baseTransport = { send: sendMock }

      const transport = new RetryTransport({
        transport: baseTransport,
        maxRetries: 3,
      })

      const result = await transport.send({ method: 'test', args: [] })

      expect(result.error?.code).toBe('NOT_FOUND')
      expect(baseTransport.send).toHaveBeenCalledTimes(1)
    })

    it('should retry on retryable error codes', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const sendMock = vi.fn()
        .mockResolvedValueOnce({
          error: { type: 'ServiceError', code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' },
        })
        .mockResolvedValue({ result: 'recovered' })

      const baseTransport = { send: sendMock }

      const transport = new RetryTransport({
        transport: baseTransport,
        maxRetries: 3,
        jitter: 'none',
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()

      const result = await resultPromise
      expect(result.result).toBe('recovered')
      expect(baseTransport.send).toHaveBeenCalledTimes(2)
    })

    it('should exhaust retries and return error', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const sendMock = vi.fn().mockRejectedValue(new Error('Persistent failure'))
      const baseTransport = { send: sendMock }

      const transport = new RetryTransport({
        transport: baseTransport,
        maxRetries: 3,
        jitter: 'none',
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()

      const result = await resultPromise
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('RETRY_EXHAUSTED')
      expect(result.error?.message).toContain('4 attempts')
      // 1 initial + 3 retries = 4 total
      expect(baseTransport.send).toHaveBeenCalledTimes(4)
    })

    it('should preserve correlation ID across retries', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const sendMock = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue({ result: 'ok', correlationId: 'test-id' })

      const baseTransport: Transport = { send: sendMock as Transport['send'] }

      const transport = new RetryTransport({
        transport: baseTransport,
        maxRetries: 3,
        jitter: 'none',
      })

      const resultPromise = transport.send({ method: 'test', args: [], correlationId: 'test-id' })
      await vi.runAllTimersAsync()

      const result = await resultPromise
      expect(result.correlationId).toBe('test-id')

      // Verify same message passed each time
      const calls = sendMock.mock.calls as Array<[RPCMessage]>
      expect(calls[0]?.[0]?.correlationId).toBe('test-id')
      expect(calls[1]?.[0]?.correlationId).toBe('test-id')
    })
  })

  describe('exponential backoff', () => {
    it('should use exponential backoff with configurable multiplier', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const delays: number[] = []

      const transport = new RetryTransport({
        transport: { send: vi.fn().mockRejectedValue(new Error('fail')) },
        maxRetries: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
        jitter: 'none',
        onRetry: (_attempt, delay) => delays.push(delay),
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()
      await resultPromise

      expect(delays).toEqual([100, 200, 400])
    })

    it('should cap delay at maxDelay', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const delays: number[] = []

      const transport = new RetryTransport({
        transport: { send: vi.fn().mockRejectedValue(new Error('fail')) },
        maxRetries: 5,
        initialDelay: 100,
        backoffMultiplier: 10,
        maxDelay: 500,
        jitter: 'none',
        onRetry: (_attempt, delay) => delays.push(delay),
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()
      await resultPromise

      // Should be [100, 500, 500, 500, 500] due to cap
      expect(delays).toEqual([100, 500, 500, 500, 500])
    })

    it('should use default values when not specified', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const delays: number[] = []

      const transport = new RetryTransport({
        transport: { send: vi.fn().mockRejectedValue(new Error('fail')) },
        jitter: 'none',
        onRetry: (_attempt, delay) => delays.push(delay),
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()
      await resultPromise

      // Default: initialDelay=100, multiplier=2, maxRetries=3
      expect(delays).toEqual([100, 200, 400])
    })
  })

  describe('jitter strategies', () => {
    it('should support full jitter', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      // Seed Math.random for predictable test
      const mockRandom = vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const delays: number[] = []

      const transport = new RetryTransport({
        transport: { send: vi.fn().mockRejectedValue(new Error('fail')) },
        maxRetries: 2,
        initialDelay: 100,
        backoffMultiplier: 2,
        jitter: 'full',
        onRetry: (_attempt, delay) => delays.push(delay),
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()
      await resultPromise

      // Full jitter: random() * delay = 0.5 * delay
      expect(delays).toEqual([50, 100])

      mockRandom.mockRestore()
    })

    it('should support equal jitter', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const mockRandom = vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const delays: number[] = []

      const transport = new RetryTransport({
        transport: { send: vi.fn().mockRejectedValue(new Error('fail')) },
        maxRetries: 2,
        initialDelay: 100,
        backoffMultiplier: 2,
        jitter: 'equal',
        onRetry: (_attempt, delay) => delays.push(delay),
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()
      await resultPromise

      // Equal jitter: delay/2 + random() * delay/2 = 50 + 0.5 * 50 = 75
      // Second: 100 + 0.5 * 100 = 150
      expect(delays).toEqual([75, 150])

      mockRandom.mockRestore()
    })

    it('should support decorrelated jitter', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const mockRandom = vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const delays: number[] = []

      const transport = new RetryTransport({
        transport: { send: vi.fn().mockRejectedValue(new Error('fail')) },
        maxRetries: 2,
        initialDelay: 100,
        maxDelay: 1000,
        jitter: 'decorrelated',
        onRetry: (_attempt, delay) => delays.push(delay),
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()
      await resultPromise

      // Decorrelated jitter: min(maxDelay, random() * previousDelay * 3)
      // First: min(1000, 0.5 * 100 * 3) = 150
      // Second: min(1000, 0.5 * 150 * 3) = 225
      expect(delays).toEqual([150, 225])

      mockRandom.mockRestore()
    })

    it('should support no jitter', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const delays: number[] = []

      const transport = new RetryTransport({
        transport: { send: vi.fn().mockRejectedValue(new Error('fail')) },
        maxRetries: 2,
        initialDelay: 100,
        backoffMultiplier: 2,
        jitter: 'none',
        onRetry: (_attempt, delay) => delays.push(delay),
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()
      await resultPromise

      expect(delays).toEqual([100, 200])
    })

    it('should default to full jitter', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const mockRandom = vi.spyOn(Math, 'random').mockReturnValue(0.5)
      const delays: number[] = []

      const transport = new RetryTransport({
        transport: { send: vi.fn().mockRejectedValue(new Error('fail')) },
        maxRetries: 1,
        initialDelay: 100,
        onRetry: (_attempt, delay) => delays.push(delay),
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()
      await resultPromise

      // Default jitter is 'full': random() * delay = 0.5 * 100 = 50
      expect(delays).toEqual([50])

      mockRandom.mockRestore()
    })
  })

  describe('custom retry predicate', () => {
    it('should use custom isRetryable function', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const sendMock = vi.fn().mockResolvedValue({
        error: { type: 'CustomError', code: 'CUSTOM_RETRYABLE', message: 'Custom retryable' },
      })

      const baseTransport = { send: sendMock }

      const transport = new RetryTransport({
        transport: baseTransport,
        maxRetries: 2,
        jitter: 'none',
        isRetryable: (error) => error.code === 'CUSTOM_RETRYABLE',
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()

      const result = await resultPromise
      expect(result.error?.code).toBe('RETRY_EXHAUSTED')
      // 1 initial + 2 retries = 3 total
      expect(baseTransport.send).toHaveBeenCalledTimes(3)
    })

    it('should not retry when custom predicate returns false', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const sendMock = vi.fn().mockResolvedValue({
        error: { type: 'CustomError', code: 'CUSTOM_NON_RETRYABLE', message: 'Do not retry' },
      })

      const baseTransport = { send: sendMock }

      const transport = new RetryTransport({
        transport: baseTransport,
        maxRetries: 3,
        isRetryable: (error) => error.code === 'SHOULD_RETRY',
      })

      const result = await transport.send({ method: 'test', args: [] })

      expect(result.error?.code).toBe('CUSTOM_NON_RETRYABLE')
      expect(baseTransport.send).toHaveBeenCalledTimes(1)
    })
  })

  describe('onRetry callback', () => {
    it('should call onRetry with attempt number and delay', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const retryInfo: Array<{ attempt: number; delay: number; error: Error }> = []

      const transport = new RetryTransport({
        transport: { send: vi.fn().mockRejectedValue(new Error('Network error')) },
        maxRetries: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
        jitter: 'none',
        onRetry: (attempt, delay, error) => retryInfo.push({ attempt, delay, error }),
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()
      await resultPromise

      expect(retryInfo).toHaveLength(3)
      expect(retryInfo[0]?.attempt).toBe(1)
      expect(retryInfo[0]?.delay).toBe(100)
      expect(retryInfo[0]?.error.message).toBe('Network error')

      expect(retryInfo[1]?.attempt).toBe(2)
      expect(retryInfo[1]?.delay).toBe(200)

      expect(retryInfo[2]?.attempt).toBe(3)
      expect(retryInfo[2]?.delay).toBe(400)
    })

    it('should include error from response in onRetry callback', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const errors: Error[] = []

      const sendMock = vi.fn().mockResolvedValue({
        error: { type: 'ServiceError', code: 'TIMEOUT', message: 'Request timed out' },
      })

      const transport = new RetryTransport({
        transport: { send: sendMock },
        maxRetries: 1,
        jitter: 'none',
        onRetry: (_attempt, _delay, error) => errors.push(error),
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()
      await resultPromise

      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toBe('Request timed out')
    })
  })

  describe('transport delegation', () => {
    it('should delegate close to underlying transport', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const baseTransport = {
        send: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const transport = new RetryTransport({ transport: baseTransport })

      await transport.close()

      expect(baseTransport.close).toHaveBeenCalled()
    })

    it('should delegate getState to underlying transport', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const baseTransport = {
        send: vi.fn(),
        getState: vi.fn().mockReturnValue('CONNECTED'),
      }

      const transport = new RetryTransport({ transport: baseTransport })

      const state = transport.getState()

      expect(state).toBe('CONNECTED')
      expect(baseTransport.getState).toHaveBeenCalled()
    })

    it('should delegate addEventListener to underlying transport', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const unsubscribe = vi.fn()
      const baseTransport = {
        send: vi.fn(),
        addEventListener: vi.fn().mockReturnValue(unsubscribe),
      }

      const transport = new RetryTransport({ transport: baseTransport })

      const listener = vi.fn()
      const result = transport.addEventListener(listener)

      expect(baseTransport.addEventListener).toHaveBeenCalledWith(listener)
      expect(result).toBe(unsubscribe)
    })

    it('should handle transport without optional methods', async () => {
      const { RetryTransport } = await import('../src/transport/retry')

      const baseTransport = {
        send: vi.fn().mockResolvedValue({ result: 'ok' }),
      }

      const transport = new RetryTransport({ transport: baseTransport })

      // close should be a no-op
      await expect(transport.close()).resolves.toBeUndefined()

      // getState should return CONNECTED as default
      expect(transport.getState()).toBe('CONNECTED')

      // addEventListener should return a no-op unsubscribe
      const unsub = transport.addEventListener(vi.fn())
      expect(typeof unsub).toBe('function')
    })
  })

  describe('default retryable error codes', () => {
    it.each([
      ['NETWORK_ERROR', true],
      ['TIMEOUT', true],
      ['SERVICE_UNAVAILABLE', true],
      ['RATE_LIMIT', true],
      ['NOT_FOUND', false],
      ['VALIDATION_ERROR', false],
      ['UNAUTHORIZED', false],
      ['FORBIDDEN', false],
    ])('should handle error code %s as retryable: %s', async (code, shouldRetry) => {
      const { RetryTransport } = await import('../src/transport/retry')

      const sendMock = vi.fn()
        .mockResolvedValueOnce({
          error: { type: 'Error', code, message: 'Error' },
        })
        .mockResolvedValue({ result: 'recovered' })

      const baseTransport = { send: sendMock }

      const transport = new RetryTransport({
        transport: baseTransport,
        maxRetries: 1,
        jitter: 'none',
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()

      const result = await resultPromise

      if (shouldRetry) {
        expect(baseTransport.send).toHaveBeenCalledTimes(2)
        expect(result.result).toBe('recovered')
      } else {
        expect(baseTransport.send).toHaveBeenCalledTimes(1)
        expect(result.error?.code).toBe(code)
      }
    })
  })

  describe('RetryPolicy presets', () => {
    it('should export aggressive policy preset', async () => {
      const { RetryPolicy } = await import('../src/transport/retry')

      expect(RetryPolicy.aggressive).toBeDefined()
      expect(RetryPolicy.aggressive.maxRetries).toBe(5)
      expect(RetryPolicy.aggressive.initialDelay).toBe(50)
      expect(RetryPolicy.aggressive.backoffMultiplier).toBe(1.5)
    })

    it('should export conservative policy preset', async () => {
      const { RetryPolicy } = await import('../src/transport/retry')

      expect(RetryPolicy.conservative).toBeDefined()
      expect(RetryPolicy.conservative.maxRetries).toBe(3)
      expect(RetryPolicy.conservative.initialDelay).toBe(500)
      expect(RetryPolicy.conservative.backoffMultiplier).toBe(2)
    })

    it('should export none policy preset (no retries)', async () => {
      const { RetryPolicy } = await import('../src/transport/retry')

      expect(RetryPolicy.none).toBeDefined()
      expect(RetryPolicy.none.maxRetries).toBe(0)
    })

    it('should work with policy presets', async () => {
      const { RetryTransport, RetryPolicy } = await import('../src/transport/retry')

      const sendMock = vi.fn().mockResolvedValue({
        error: { type: 'NetworkError', code: 'NETWORK_ERROR', message: 'fail' },
      })

      const baseTransport = { send: sendMock }

      const transport = new RetryTransport({
        transport: baseTransport,
        ...RetryPolicy.aggressive,
        jitter: 'none',
      })

      const resultPromise = transport.send({ method: 'test', args: [] })
      await vi.runAllTimersAsync()
      await resultPromise

      // aggressive has maxRetries: 5, so 6 total attempts
      expect(baseTransport.send).toHaveBeenCalledTimes(6)
    })
  })

  describe('createRetryTransport factory', () => {
    it('should create transport with factory function', async () => {
      const { createRetryTransport, RetryTransport } = await import('../src/transport/retry')

      const baseTransport = { send: vi.fn().mockResolvedValue({ result: 'ok' }) }
      const transport = createRetryTransport({
        transport: baseTransport,
        maxRetries: 2,
      })

      expect(transport).toBeInstanceOf(RetryTransport)
    })
  })
})
