/**
 * Tests for BaseFunctionExecutor
 *
 * Tests the common execution patterns extracted into the base class:
 * - Retry logic
 * - State management
 * - Event emission
 * - Middleware pipeline
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BaseFunctionExecutor,
  calculateDelay,
  normalizeError,
  sleep,
  generateInvocationId,
  ExecutionTimeoutError,
  ExecutionCancelledError,
  ExecutionRetryExhaustedError,
  ExecutionValidationError,
  type BaseExecutorOptions,
  type FunctionType,
  type RetryConfig,
  type MiddlewareContext,
} from '../BaseFunctionExecutor'

// ============================================================================
// TEST EXECUTOR IMPLEMENTATION
// ============================================================================

class TestFunctionExecutor extends BaseFunctionExecutor<BaseExecutorOptions> {
  getFunctionType(): FunctionType {
    return 'code'
  }

  protected async executeCore<TInput, TOutput>(
    input: TInput,
    options: Record<string, unknown>
  ): Promise<TOutput> {
    // Simple pass-through for testing
    return input as unknown as TOutput
  }

  // Expose protected methods for testing
  public testCreateStateWrapper() {
    return this.createStateWrapper()
  }

  public async testEmit(event: string, data: unknown) {
    return this.emit(event, data)
  }

  public async testExecuteWithRetry<T>(
    fn: () => Promise<T>,
    config: RetryConfig,
    signal?: AbortSignal
  ) {
    return this.executeWithRetry(fn, config, signal)
  }

  public async testExecuteWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    signal?: AbortSignal
  ) {
    return this.executeWithTimeout(fn, timeout, signal)
  }

  public async testApplyMiddleware<TInput, TOutput>(
    ctx: MiddlewareContext<TInput>,
    coreFn: () => Promise<TOutput>
  ) {
    return this.applyMiddleware(ctx, coreFn)
  }

  public testInterpolateTemplate(template: string, variables: Record<string, unknown>) {
    return this.interpolateTemplate(template, variables)
  }

  public testEstimateMemoryUsage() {
    return this.estimateMemoryUsage()
  }

  public testGetDOId() {
    return this.getDOId()
  }
}

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('BaseFunctionExecutor Helper Functions', () => {
  describe('sleep', () => {
    it('should sleep for the specified duration', async () => {
      const start = Date.now()
      await sleep(50)
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
      expect(elapsed).toBeLessThan(100)
    })
  })

  describe('generateInvocationId', () => {
    it('should generate a valid UUID', () => {
      const id = generateInvocationId()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('should generate unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateInvocationId())
      }
      expect(ids.size).toBe(100)
    })
  })

  describe('calculateDelay', () => {
    it('should calculate fixed delay', () => {
      const config: RetryConfig = { maxAttempts: 3, delay: 100, backoff: 'fixed' }
      expect(calculateDelay(0, config)).toBe(100)
      expect(calculateDelay(1, config)).toBe(100)
      expect(calculateDelay(2, config)).toBe(100)
    })

    it('should calculate exponential delay', () => {
      const config: RetryConfig = { maxAttempts: 3, delay: 100, backoff: 'exponential' }
      expect(calculateDelay(0, config)).toBe(100)
      expect(calculateDelay(1, config)).toBe(200)
      expect(calculateDelay(2, config)).toBe(400)
    })

    it('should calculate linear delay', () => {
      const config: RetryConfig = { maxAttempts: 3, delay: 100, backoff: 'linear', increment: 50 }
      expect(calculateDelay(0, config)).toBe(100)
      expect(calculateDelay(1, config)).toBe(150)
      expect(calculateDelay(2, config)).toBe(200)
    })

    it('should respect maxDelay', () => {
      const config: RetryConfig = { maxAttempts: 5, delay: 100, backoff: 'exponential', maxDelay: 300 }
      expect(calculateDelay(0, config)).toBe(100)
      expect(calculateDelay(1, config)).toBe(200)
      expect(calculateDelay(2, config)).toBe(300)
      expect(calculateDelay(3, config)).toBe(300)
    })

    it('should add jitter for exponential-jitter', () => {
      const config: RetryConfig = { maxAttempts: 3, delay: 100, backoff: 'exponential-jitter' }
      const delay = calculateDelay(1, config)
      // With jitter, delay should be between 100 and 400 (200 * 0.5 to 200 * 2)
      expect(delay).toBeGreaterThanOrEqual(100)
      expect(delay).toBeLessThanOrEqual(400)
    })
  })

  describe('normalizeError', () => {
    it('should pass through Error instances', () => {
      const error = new Error('test error')
      expect(normalizeError(error)).toBe(error)
    })

    it('should handle null', () => {
      const error = normalizeError(null)
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('null error thrown')
    })

    it('should handle undefined', () => {
      const error = normalizeError(undefined)
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('undefined error thrown')
    })

    it('should handle string', () => {
      const error = normalizeError('test error')
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('test error')
    })

    it('should handle objects with message', () => {
      const error = normalizeError({ message: 'test error' })
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('test error')
    })

    it('should handle objects without message', () => {
      const error = normalizeError({ foo: 'bar' })
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('foo')
    })
  })
})

// ============================================================================
// ERROR CLASSES TESTS
// ============================================================================

describe('Error Classes', () => {
  it('should create ExecutionTimeoutError', () => {
    const error = new ExecutionTimeoutError('test timeout')
    expect(error.name).toBe('ExecutionTimeoutError')
    expect(error.message).toBe('test timeout')
    expect(error).toBeInstanceOf(Error)
  })

  it('should create ExecutionCancelledError', () => {
    const error = new ExecutionCancelledError('test cancel')
    expect(error.name).toBe('ExecutionCancelledError')
    expect(error.message).toBe('test cancel')
    expect(error).toBeInstanceOf(Error)
  })

  it('should create ExecutionCancelledError with default message', () => {
    const error = new ExecutionCancelledError()
    expect(error.message).toBe('Execution cancelled')
  })

  it('should create ExecutionRetryExhaustedError', () => {
    const error = new ExecutionRetryExhaustedError('retries exhausted')
    expect(error.name).toBe('ExecutionRetryExhaustedError')
    expect(error.message).toBe('retries exhausted')
  })

  it('should create ExecutionValidationError', () => {
    const error = new ExecutionValidationError('validation failed')
    expect(error.name).toBe('ExecutionValidationError')
    expect(error.message).toBe('validation failed')
  })
})

// ============================================================================
// BASE EXECUTOR TESTS
// ============================================================================

describe('BaseFunctionExecutor', () => {
  let executor: TestFunctionExecutor
  let mockState: BaseExecutorOptions['state']
  let mockStorage: Map<string, unknown>
  let eventHandler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockStorage = new Map()
    mockState = {
      id: { toString: () => 'test-do-id' },
      storage: {
        get: vi.fn(async (key) => mockStorage.get(key)),
        put: vi.fn(async (key, value) => { mockStorage.set(key, value) }),
        delete: vi.fn(async (key) => mockStorage.delete(key)),
        list: vi.fn(async () => mockStorage),
      },
    }

    eventHandler = vi.fn()

    executor = new TestFunctionExecutor({
      state: mockState,
      env: { TEST_VAR: 'test_value' },
      onEvent: eventHandler,
    })
  })

  describe('getFunctionType', () => {
    it('should return the function type', () => {
      expect(executor.getFunctionType()).toBe('code')
    })
  })

  describe('createStateWrapper', () => {
    it('should create a state wrapper with get/put/delete/list', async () => {
      const wrapper = executor.testCreateStateWrapper()

      await wrapper.put('key1', 'value1')
      expect(mockStorage.get('key1')).toBe('value1')

      const value = await wrapper.get<string>('key1')
      expect(value).toBe('value1')

      const deleted = await wrapper.delete('key1')
      expect(deleted).toBe(true)

      const notFound = await wrapper.get<string>('key1')
      expect(notFound).toBeNull()
    })

    it('should return null for missing keys', async () => {
      const wrapper = executor.testCreateStateWrapper()
      const value = await wrapper.get<string>('nonexistent')
      expect(value).toBeNull()
    })
  })

  describe('emit', () => {
    it('should emit events through the event handler', async () => {
      await executor.testEmit('test.event', { foo: 'bar' })
      expect(eventHandler).toHaveBeenCalledWith('test.event', { foo: 'bar' })
    })

    it('should handle missing event handler', async () => {
      const executorNoHandler = new TestFunctionExecutor({
        state: mockState,
        env: {},
      })
      await expect(executorNoHandler.testEmit('test.event', {})).resolves.not.toThrow()
    })
  })

  describe('executeWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success')
      const config: RetryConfig = { maxAttempts: 3, delay: 10 }

      const { result, retryCount } = await executor.testExecuteWithRetry(fn, config)

      expect(result).toBe('success')
      expect(retryCount).toBe(0)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success')

      const config: RetryConfig = { maxAttempts: 3, delay: 10 }

      const { result, retryCount } = await executor.testExecuteWithRetry(fn, config)

      expect(result).toBe('success')
      expect(retryCount).toBe(2)
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should throw ExecutionRetryExhaustedError when all attempts fail', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'))
      const config: RetryConfig = { maxAttempts: 3, delay: 10 }

      await expect(executor.testExecuteWithRetry(fn, config))
        .rejects.toThrow(ExecutionRetryExhaustedError)

      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should respect retryIf condition', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('skip retry'))
        .mockResolvedValue('success')

      const config: RetryConfig = {
        maxAttempts: 3,
        delay: 10,
        retryIf: (error) => !error.message.includes('skip'),
      }

      await expect(executor.testExecuteWithRetry(fn, config))
        .rejects.toThrow('skip retry')

      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should call onRetry callback', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockResolvedValue('success')

      const onRetry = vi.fn()
      const config: RetryConfig = { maxAttempts: 3, delay: 10, onRetry }

      await executor.testExecuteWithRetry(fn, config)

      expect(onRetry).toHaveBeenCalledWith({
        attempt: 1,
        delay: 10,
        error: expect.any(Error),
      })
    })

    it('should emit retry events', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success')

      const config: RetryConfig = { maxAttempts: 3, delay: 10 }

      await executor.testExecuteWithRetry(fn, config)

      expect(eventHandler).toHaveBeenCalledWith('function.retry', {
        attempt: 1,
        error: 'fail',
        delay: 10,
      })
    })

    it('should handle cancellation', async () => {
      const controller = new AbortController()
      controller.abort()

      const fn = vi.fn().mockResolvedValue('success')
      const config: RetryConfig = { maxAttempts: 3, delay: 10 }

      await expect(executor.testExecuteWithRetry(fn, config, controller.signal))
        .rejects.toThrow(ExecutionCancelledError)

      expect(fn).not.toHaveBeenCalled()
    })
  })

  describe('executeWithTimeout', () => {
    it('should complete within timeout', async () => {
      const fn = vi.fn().mockResolvedValue('success')

      const result = await executor.testExecuteWithTimeout(fn, 1000)

      expect(result).toBe('success')
    })

    it('should throw ExecutionTimeoutError when timeout exceeded', async () => {
      const fn = () => new Promise((resolve) => setTimeout(resolve, 100, 'success'))

      await expect(executor.testExecuteWithTimeout(fn, 10))
        .rejects.toThrow(ExecutionTimeoutError)
    })

    it('should handle external abort signal during execution', async () => {
      const controller = new AbortController()

      // Function that takes longer than the abort delay
      const fn = () => new Promise((resolve) => setTimeout(resolve, 200, 'success'))

      // Abort after a short delay
      setTimeout(() => controller.abort(), 20)

      await expect(executor.testExecuteWithTimeout(fn, 5000, controller.signal))
        .rejects.toThrow(ExecutionCancelledError)
    })
  })

  describe('middleware', () => {
    it('should apply middleware in order', async () => {
      const order: string[] = []

      const middleware1 = vi.fn(async (ctx, next) => {
        order.push('m1-before')
        const result = await next()
        order.push('m1-after')
        return result
      })

      const middleware2 = vi.fn(async (ctx, next) => {
        order.push('m2-before')
        const result = await next()
        order.push('m2-after')
        return result
      })

      executor.use(middleware1).use(middleware2)

      const ctx: MiddlewareContext = {
        functionId: 'test',
        invocationId: 'inv-1',
        functionType: 'code',
        input: {},
        startTime: Date.now(),
        metadata: {},
      }

      const result = await executor.testApplyMiddleware(ctx, async () => {
        order.push('core')
        return 'result'
      })

      expect(result).toBe('result')
      expect(order).toEqual(['m1-before', 'm2-before', 'core', 'm2-after', 'm1-after'])
    })

    it('should handle middleware that modifies result', async () => {
      const middleware = vi.fn(async (ctx, next) => {
        const result = await next()
        return `${result}-modified`
      })

      executor.use(middleware)

      const ctx: MiddlewareContext = {
        functionId: 'test',
        invocationId: 'inv-1',
        functionType: 'code',
        input: {},
        startTime: Date.now(),
        metadata: {},
      }

      const result = await executor.testApplyMiddleware(ctx, async () => 'original')

      expect(result).toBe('original-modified')
    })

    it('should skip middleware when none registered', async () => {
      const ctx: MiddlewareContext = {
        functionId: 'test',
        invocationId: 'inv-1',
        functionType: 'code',
        input: {},
        startTime: Date.now(),
        metadata: {},
      }

      const result = await executor.testApplyMiddleware(ctx, async () => 'direct')

      expect(result).toBe('direct')
    })
  })

  describe('interpolateTemplate', () => {
    it('should substitute simple variables', () => {
      const result = executor.testInterpolateTemplate(
        'Hello {{name}}!',
        { name: 'World' }
      )
      expect(result).toBe('Hello World!')
    })

    it('should handle multiple variables', () => {
      const result = executor.testInterpolateTemplate(
        '{{greeting}} {{name}}!',
        { greeting: 'Hello', name: 'World' }
      )
      expect(result).toBe('Hello World!')
    })

    it('should leave unmatched variables as-is', () => {
      const result = executor.testInterpolateTemplate(
        'Hello {{name}}!',
        {}
      )
      expect(result).toBe('Hello {{name}}!')
    })

    it('should handle undefined values', () => {
      const result = executor.testInterpolateTemplate(
        'Hello {{name}}!',
        { name: undefined }
      )
      expect(result).toBe('Hello {{name}}!')
    })
  })

  describe('estimateMemoryUsage', () => {
    it('should return a number', () => {
      const memory = executor.testEstimateMemoryUsage()
      expect(typeof memory).toBe('number')
      expect(memory).toBeGreaterThan(0)
    })
  })

  describe('getDOId', () => {
    it('should return the DO ID', () => {
      expect(executor.testGetDOId()).toBe('test-do-id')
    })
  })
})
