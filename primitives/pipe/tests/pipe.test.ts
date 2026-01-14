import { describe, it, expect, vi } from 'vitest'
import { Pipe } from '../index'

describe('Pipe', () => {
  describe('process()', () => {
    it('transforms input to output using processor function', async () => {
      const pipe = Pipe((input: number) => input * 2)
      const result = await pipe.process(5)
      expect(result).toBe(10)
    })

    it('handles async processor functions', async () => {
      const pipe = Pipe(async (input: string) => {
        return input.toUpperCase()
      })
      const result = await pipe.process('hello')
      expect(result).toBe('HELLO')
    })

    it('infers types correctly', async () => {
      const pipe = Pipe((input: { name: string }) => ({ greeting: `Hello, ${input.name}` }))
      const result = await pipe.process({ name: 'World' })
      expect(result).toEqual({ greeting: 'Hello, World' })
    })
  })

  describe('use() - middleware composition', () => {
    it('executes middleware in order', async () => {
      const order: string[] = []

      const pipe = Pipe((input: number) => {
        order.push('processor')
        return input * 2
      })
        .use(async (input, next) => {
          order.push('middleware1-before')
          const result = await next(input)
          order.push('middleware1-after')
          return result
        })
        .use(async (input, next) => {
          order.push('middleware2-before')
          const result = await next(input)
          order.push('middleware2-after')
          return result
        })

      await pipe.process(5)

      expect(order).toEqual([
        'middleware1-before',
        'middleware2-before',
        'processor',
        'middleware2-after',
        'middleware1-after',
      ])
    })

    it('middleware can modify input', async () => {
      const pipe = Pipe((input: number) => input * 2)
        .use(async (input, next) => {
          return next(input + 10) // Add 10 before processing
        })

      const result = await pipe.process(5)
      expect(result).toBe(30) // (5 + 10) * 2 = 30
    })

    it('middleware can modify output', async () => {
      const pipe = Pipe((input: number) => input * 2)
        .use(async (input, next) => {
          const result = await next(input)
          return result + 100 // Add 100 after processing
        })

      const result = await pipe.process(5)
      expect(result).toBe(110) // 5 * 2 + 100 = 110
    })
  })

  describe('before() - input hooks', () => {
    it('transforms input before processing', async () => {
      const pipe = Pipe((input: number) => input * 2)
        .before((input) => input + 10)

      const result = await pipe.process(5)
      expect(result).toBe(30) // (5 + 10) * 2 = 30
    })

    it('chains multiple before hooks', async () => {
      const pipe = Pipe((input: number) => input * 2)
        .before((input) => input + 10)
        .before((input) => input * 3)

      const result = await pipe.process(5)
      // First: 5 + 10 = 15
      // Second: 15 * 3 = 45
      // Process: 45 * 2 = 90
      expect(result).toBe(90)
    })

    it('supports async before hooks', async () => {
      const pipe = Pipe((input: string) => input.toUpperCase())
        .before(async (input) => {
          return input.trim()
        })

      const result = await pipe.process('  hello  ')
      expect(result).toBe('HELLO')
    })
  })

  describe('after() - output hooks', () => {
    it('transforms output after processing', async () => {
      const pipe = Pipe((input: number) => input * 2)
        .after((output) => output + 100)

      const result = await pipe.process(5)
      expect(result).toBe(110) // 5 * 2 + 100 = 110
    })

    it('chains multiple after hooks', async () => {
      const pipe = Pipe((input: number) => input * 2)
        .after((output) => output + 100)
        .after((output) => output * 10)

      const result = await pipe.process(5)
      // Process: 5 * 2 = 10
      // First after: 10 + 100 = 110
      // Second after: 110 * 10 = 1100
      expect(result).toBe(1100)
    })

    it('supports async after hooks', async () => {
      const pipe = Pipe((input: string) => input.toUpperCase())
        .after(async (output) => {
          return `Result: ${output}`
        })

      const result = await pipe.process('hello')
      expect(result).toBe('Result: HELLO')
    })
  })

  describe('combined hooks and middleware', () => {
    it('executes in correct order: before -> middleware -> processor -> middleware -> after', async () => {
      const order: string[] = []

      const pipe = Pipe((input: number) => {
        order.push('processor')
        return input * 2
      })
        .before((input) => {
          order.push('before')
          return input
        })
        .after((output) => {
          order.push('after')
          return output
        })
        .use(async (input, next) => {
          order.push('middleware-before')
          const result = await next(input)
          order.push('middleware-after')
          return result
        })

      await pipe.process(5)

      expect(order).toEqual([
        'before',
        'middleware-before',
        'processor',
        'middleware-after',
        'after',
      ])
    })
  })

  describe('onError() - error handling', () => {
    it('calls error handler when processor throws', async () => {
      const errorHandler = vi.fn()
      const pipe = Pipe((): number => {
        throw new Error('Processor failed')
      }).onError(errorHandler)

      await expect(pipe.process(5)).rejects.toThrow('Processor failed')
      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error))
      expect(errorHandler.mock.calls[0][0].message).toBe('Processor failed')
    })

    it('calls multiple error handlers', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      const pipe = Pipe((): number => {
        throw new Error('Fail')
      })
        .onError(handler1)
        .onError(handler2)

      await expect(pipe.process(5)).rejects.toThrow('Fail')
      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('calls error handler when middleware throws', async () => {
      const errorHandler = vi.fn()

      const pipe = Pipe((input: number) => input * 2)
        .use(async () => {
          throw new Error('Middleware failed')
        })
        .onError(errorHandler)

      await expect(pipe.process(5)).rejects.toThrow('Middleware failed')
      expect(errorHandler).toHaveBeenCalled()
    })

    it('calls error handler when before hook throws', async () => {
      const errorHandler = vi.fn()

      const pipe = Pipe((input: number) => input * 2)
        .before(() => {
          throw new Error('Before hook failed')
        })
        .onError(errorHandler)

      await expect(pipe.process(5)).rejects.toThrow('Before hook failed')
      expect(errorHandler).toHaveBeenCalled()
    })

    it('calls error handler when after hook throws', async () => {
      const errorHandler = vi.fn()

      const pipe = Pipe((input: number) => input * 2)
        .after(() => {
          throw new Error('After hook failed')
        })
        .onError(errorHandler)

      await expect(pipe.process(5)).rejects.toThrow('After hook failed')
      expect(errorHandler).toHaveBeenCalled()
    })
  })

  describe('retry() - retry with backoff', () => {
    it('retries on failure up to maxAttempts', async () => {
      let attempts = 0

      const pipe = Pipe((): number => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
        return 42
      }).retry({ maxAttempts: 3 })

      const result = await pipe.process(5)
      expect(result).toBe(42)
      expect(attempts).toBe(3)
    })

    it('throws after exhausting all retries', async () => {
      let attempts = 0

      const pipe = Pipe((): number => {
        attempts++
        throw new Error('Permanent failure')
      }).retry({ maxAttempts: 3 })

      await expect(pipe.process(5)).rejects.toThrow('Permanent failure')
      expect(attempts).toBe(3)
    })

    it('applies exponential backoff delay', async () => {
      let attempts = 0
      const timestamps: number[] = []

      const pipe = Pipe((): number => {
        timestamps.push(Date.now())
        attempts++
        if (attempts < 3) {
          throw new Error('Temp')
        }
        return 42
      }).retry({
        maxAttempts: 3,
        delayMs: 50,
        backoffMultiplier: 2,
      })

      await pipe.process(5)

      // Check delays between attempts (with some tolerance)
      // First retry: ~50ms, Second retry: ~100ms
      const delay1 = timestamps[1] - timestamps[0]
      const delay2 = timestamps[2] - timestamps[1]

      expect(delay1).toBeGreaterThanOrEqual(45)
      expect(delay1).toBeLessThan(100)
      expect(delay2).toBeGreaterThanOrEqual(90)
      expect(delay2).toBeLessThan(200)
    })

    it('respects maxDelayMs cap', async () => {
      let attempts = 0
      const timestamps: number[] = []

      const pipe = Pipe((): number => {
        timestamps.push(Date.now())
        attempts++
        if (attempts < 4) {
          throw new Error('Temp')
        }
        return 42
      }).retry({
        maxAttempts: 4,
        delayMs: 50,
        backoffMultiplier: 10,
        maxDelayMs: 100,
      })

      await pipe.process(5)

      // Third delay should be capped at 100ms despite multiplier
      const delay3 = timestamps[3] - timestamps[2]
      expect(delay3).toBeGreaterThanOrEqual(90)
      expect(delay3).toBeLessThan(150)
    })

    it('uses retryOn predicate to filter retryable errors', async () => {
      let attempts = 0

      const pipe = Pipe((): number => {
        attempts++
        if (attempts === 1) {
          throw new Error('RetryableError')
        }
        if (attempts === 2) {
          throw new Error('NonRetryableError')
        }
        return 42
      }).retry({
        maxAttempts: 5,
        retryOn: (error) => error.message === 'RetryableError',
      })

      await expect(pipe.process(5)).rejects.toThrow('NonRetryableError')
      expect(attempts).toBe(2)
    })
  })

  describe('timeout() - operation timeout', () => {
    it('throws TimeoutError when operation exceeds timeout', async () => {
      const pipe = Pipe(async (): Promise<number> => {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return 42
      }).timeout(50)

      await expect(pipe.process(5)).rejects.toThrow('Timeout')
    })

    it('succeeds when operation completes within timeout', async () => {
      const pipe = Pipe(async (): Promise<number> => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return 42
      }).timeout(100)

      const result = await pipe.process(5)
      expect(result).toBe(42)
    })

    it('timeout works with middleware', async () => {
      const pipe = Pipe((input: number) => input * 2)
        .use(async (input, next) => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          return next(input)
        })
        .timeout(50)

      await expect(pipe.process(5)).rejects.toThrow('Timeout')
    })
  })

  describe('circuitBreaker() - prevent cascade failures', () => {
    it('opens circuit after threshold failures', async () => {
      let callCount = 0

      const pipe = Pipe((): number => {
        callCount++
        throw new Error('Service unavailable')
      }).circuitBreaker({
        threshold: 3,
        resetTimeMs: 1000,
      })

      // First 3 calls should attempt and fail
      await expect(pipe.process(1)).rejects.toThrow('Service unavailable')
      await expect(pipe.process(2)).rejects.toThrow('Service unavailable')
      await expect(pipe.process(3)).rejects.toThrow('Service unavailable')

      // Circuit should be open now - 4th call should fail immediately
      await expect(pipe.process(4)).rejects.toThrow('Circuit breaker is open')

      // Should only have called the processor 3 times
      expect(callCount).toBe(3)
    })

    it('resets circuit after resetTimeMs', async () => {
      let callCount = 0
      let shouldFail = true

      const pipe = Pipe((): number => {
        callCount++
        if (shouldFail) {
          throw new Error('Service unavailable')
        }
        return 42
      }).circuitBreaker({
        threshold: 2,
        resetTimeMs: 50,
      })

      // Trigger circuit open
      await expect(pipe.process(1)).rejects.toThrow('Service unavailable')
      await expect(pipe.process(2)).rejects.toThrow('Service unavailable')

      // Circuit is open
      await expect(pipe.process(3)).rejects.toThrow('Circuit breaker is open')

      // Wait for reset
      await new Promise((resolve) => setTimeout(resolve, 60))

      // Fix the service
      shouldFail = false

      // Circuit should be half-open, allowing a test request
      const result = await pipe.process(4)
      expect(result).toBe(42)
      expect(callCount).toBe(3) // 2 failures + 1 success
    })

    it('circuit remains open on failure after reset attempt', async () => {
      let callCount = 0

      const pipe = Pipe((): number => {
        callCount++
        throw new Error('Still failing')
      }).circuitBreaker({
        threshold: 2,
        resetTimeMs: 50,
      })

      // Trigger circuit open
      await expect(pipe.process(1)).rejects.toThrow('Still failing')
      await expect(pipe.process(2)).rejects.toThrow('Still failing')

      // Wait for reset
      await new Promise((resolve) => setTimeout(resolve, 60))

      // Half-open test request fails
      await expect(pipe.process(3)).rejects.toThrow('Still failing')

      // Circuit should be open again
      await expect(pipe.process(4)).rejects.toThrow('Circuit breaker is open')

      expect(callCount).toBe(3) // 2 initial + 1 half-open attempt
    })

    it('successful operations do not count toward threshold', async () => {
      let callCount = 0
      let failCount = 0

      const pipe = Pipe((input: number): number => {
        callCount++
        if (input % 2 === 0) {
          failCount++
          throw new Error('Even numbers fail')
        }
        return input * 2
      }).circuitBreaker({
        threshold: 3,
        resetTimeMs: 1000,
      })

      // Mix of successes and failures
      expect(await pipe.process(1)).toBe(2) // success
      await expect(pipe.process(2)).rejects.toThrow('Even numbers fail') // fail 1
      expect(await pipe.process(3)).toBe(6) // success
      await expect(pipe.process(4)).rejects.toThrow('Even numbers fail') // fail 2
      expect(await pipe.process(5)).toBe(10) // success
      await expect(pipe.process(6)).rejects.toThrow('Even numbers fail') // fail 3

      // Now circuit is open
      await expect(pipe.process(7)).rejects.toThrow('Circuit breaker is open')

      expect(callCount).toBe(6)
      expect(failCount).toBe(3)
    })
  })

  describe('batch() - batch processing', () => {
    it('processes multiple inputs in batches', async () => {
      let batchCount = 0

      const pipe = Pipe((input: number) => {
        batchCount++
        return input * 2
      })

      const batchedPipe = pipe.batch(3)
      const results = await batchedPipe.process([1, 2, 3, 4, 5])

      expect(results).toEqual([2, 4, 6, 8, 10])
      // With batch size 3: [1,2,3] and [4,5] = 5 individual calls
      expect(batchCount).toBe(5)
    })

    it('handles empty input array', async () => {
      const pipe = Pipe((input: number) => input * 2)
      const batchedPipe = pipe.batch(3)
      const results = await batchedPipe.process([])

      expect(results).toEqual([])
    })

    it('handles single item', async () => {
      const pipe = Pipe((input: number) => input * 2)
      const batchedPipe = pipe.batch(3)
      const results = await batchedPipe.process([5])

      expect(results).toEqual([10])
    })

    it('preserves order of results', async () => {
      // Simulate varying processing times
      const pipe = Pipe(async (input: number): Promise<number> => {
        await new Promise((resolve) => setTimeout(resolve, input * 10))
        return input * 2
      })

      const batchedPipe = pipe.batch(5)
      const results = await batchedPipe.process([3, 1, 4, 1, 5])

      // Results should be in same order as input despite varying processing times
      expect(results).toEqual([6, 2, 8, 2, 10])
    })

    it('applies middleware to each item', async () => {
      const processed: number[] = []

      const pipe = Pipe((input: number) => input * 2)
        .use(async (input, next) => {
          processed.push(input)
          return next(input)
        })

      const batchedPipe = pipe.batch(2)
      await batchedPipe.process([1, 2, 3])

      expect(processed).toEqual([1, 2, 3])
    })

    it('collects errors from failed items', async () => {
      const pipe = Pipe((input: number): number => {
        if (input === 3) {
          throw new Error('Cannot process 3')
        }
        return input * 2
      })

      const batchedPipe = pipe.batch(5)

      await expect(batchedPipe.process([1, 2, 3, 4, 5])).rejects.toThrow('Cannot process 3')
    })

    it('processes batches concurrently within batch size', async () => {
      const startTimes: number[] = []
      const endTimes: number[] = []

      const pipe = Pipe(async (input: number): Promise<number> => {
        startTimes.push(Date.now())
        await new Promise((resolve) => setTimeout(resolve, 50))
        endTimes.push(Date.now())
        return input * 2
      })

      const batchedPipe = pipe.batch(3)
      const start = Date.now()
      await batchedPipe.process([1, 2, 3])
      const totalTime = Date.now() - start

      // All 3 should run in parallel, so total time should be ~50ms not ~150ms
      expect(totalTime).toBeLessThan(100)
    })
  })
})
