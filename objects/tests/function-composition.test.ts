/**
 * Tests for FunctionComposition
 *
 * Tests function composition utilities:
 * - pipe
 * - parallel
 * - conditional
 * - retry
 * - timeout
 * - fallback
 */

import { describe, it, expect, vi } from 'vitest'
import {
  pipe,
  createPipeline,
  parallel,
  parallelWithResults,
  conditional,
  switchCase,
  retry,
  withTimeout,
  fallback,
  tryEach,
  mapOver,
  filterBy,
  reduceWith,
  tap,
  log,
  PipelineError,
  ParallelExecutionError,
  TimeoutError,
  RetryExhaustedError,
} from '../FunctionComposition'

describe('FunctionComposition', () => {
  describe('pipe', () => {
    it('should execute functions in sequence', async () => {
      const addOne = (x: number) => x + 1
      const double = (x: number) => x * 2
      const toString = (x: number) => `Result: ${x}`

      const pipeline = pipe(addOne, double, toString)

      const result = await pipeline(5)

      expect(result).toBe('Result: 12') // (5 + 1) * 2 = 12
    })

    it('should pass context to each function', async () => {
      const fn1 = vi.fn((x: number) => x + 1)
      const fn2 = vi.fn((x: number) => x * 2)

      const pipeline = pipe(fn1, fn2)
      const context = { metadata: { test: true } }

      await pipeline(5, context)

      expect(fn1).toHaveBeenCalledWith(5, context)
      expect(fn2).toHaveBeenCalledWith(6, context)
    })

    it('should handle async functions', async () => {
      const asyncAddOne = async (x: number) => x + 1
      const asyncDouble = async (x: number) => x * 2

      const pipeline = pipe(asyncAddOne, asyncDouble)

      const result = await pipeline(5)

      expect(result).toBe(12)
    })

    it('should throw PipelineError on failure', async () => {
      const fn1 = (x: number) => x + 1
      const fn2 = () => { throw new Error('fail') }
      const fn3 = (x: number) => x * 2

      const pipeline = pipe(fn1, fn2, fn3)

      await expect(pipeline(5)).rejects.toThrow(PipelineError)
    })

    it('should include stage info in PipelineError', async () => {
      const fn1 = (x: number) => x + 1
      const fn2 = () => { throw new Error('fail') }

      const pipeline = pipe(fn1, fn2)

      try {
        await pipeline(5)
      } catch (error) {
        expect(error).toBeInstanceOf(PipelineError)
        const pipelineError = error as PipelineError
        expect(pipelineError.stageIndex).toBe(1)
        expect(pipelineError.cause.message).toBe('fail')
      }
    })
  })

  describe('createPipeline', () => {
    it('should return detailed results', async () => {
      const result = await createPipeline([
        { name: 'addOne', fn: (x: number) => x + 1 },
        { name: 'double', fn: (x: number) => x * 2 },
        { name: 'toString', fn: (x: number) => `Result: ${x}` },
      ])(5)

      expect(result.success).toBe(true)
      expect(result.result).toBe('Result: 12')
      expect(result.stages).toHaveLength(3)
      expect(result.stages[0].name).toBe('addOne')
      expect(result.stages[0].success).toBe(true)
      expect(result.stages[0].result).toBe(6)
    })

    it('should capture stage durations', async () => {
      const result = await createPipeline([
        { name: 'delay', fn: async () => { await new Promise(r => setTimeout(r, 10)); return 1 } },
      ])(null)

      expect(result.stages[0].duration).toBeGreaterThanOrEqual(10)
    })

    it('should handle errors gracefully', async () => {
      const result = await createPipeline([
        { name: 'succeed', fn: (x: number) => x + 1 },
        { name: 'fail', fn: () => { throw new Error('oops') } },
        { name: 'neverRuns', fn: (x: number) => x * 2 },
      ])(5)

      expect(result.success).toBe(false)
      expect(result.stages).toHaveLength(2)
      expect(result.stages[1].success).toBe(false)
      expect(result.stages[1].error?.message).toBe('oops')
    })
  })

  describe('parallel', () => {
    it('should execute functions in parallel', async () => {
      const fn1 = vi.fn((x: number) => x + 1)
      const fn2 = vi.fn((x: number) => x * 2)
      const fn3 = vi.fn((x: number) => x - 1)

      const parallelFn = parallel(fn1, fn2, fn3)

      const results = await parallelFn(5)

      expect(results).toEqual([6, 10, 4])
      expect(fn1).toHaveBeenCalledWith(5, undefined)
      expect(fn2).toHaveBeenCalledWith(5, undefined)
      expect(fn3).toHaveBeenCalledWith(5, undefined)
    })

    it('should handle async functions', async () => {
      const fn1 = async (x: number) => { await new Promise(r => setTimeout(r, 10)); return x + 1 }
      const fn2 = async (x: number) => { await new Promise(r => setTimeout(r, 10)); return x * 2 }

      const start = Date.now()
      const results = await parallel(fn1, fn2)(5)
      const elapsed = Date.now() - start

      expect(results).toEqual([6, 10])
      expect(elapsed).toBeLessThan(30) // Both run in parallel
    })

    it('should settle all with errors when settleAll is true', async () => {
      const fn1 = (x: number) => x + 1
      const fn2 = () => { throw new Error('fail') }
      const fn3 = (x: number) => x * 2

      const results = await parallel(fn1, fn2, fn3, { settleAll: true })(5)

      // When settleAll is true, failed functions return undefined
      expect(results[0]).toBe(6)
      expect(results[1]).toBe(undefined)
      expect(results[2]).toBe(10)
    })
  })

  describe('parallelWithResults', () => {
    it('should return detailed results', async () => {
      const result = await parallelWithResults([
        (x: number) => x + 1,
        (x: number) => x * 2,
      ])(5)

      expect(result.success).toBe(true)
      expect(result.results).toEqual([6, 10])
      expect(result.completed).toBe(2)
      expect(result.failed).toBe(0)
    })

    it('should capture errors', async () => {
      const result = await parallelWithResults([
        (x: number) => x + 1,
        () => { throw new Error('fail') },
      ], { settleAll: true })(5)

      expect(result.success).toBe(false)
      expect(result.results[0]).toBe(6)
      expect(result.errors[1]?.message).toBe('fail')
      expect(result.completed).toBe(1)
      expect(result.failed).toBe(1)
    })
  })

  describe('conditional', () => {
    it('should execute onTrue when condition is true', async () => {
      const onTrue = vi.fn((x: number) => x * 2)
      const onFalse = vi.fn((x: number) => x * 3)

      const conditionalFn = conditional(
        (x: number) => x > 0,
        onTrue,
        onFalse
      )

      const result = await conditionalFn(5)

      expect(result).toBe(10)
      expect(onTrue).toHaveBeenCalled()
      expect(onFalse).not.toHaveBeenCalled()
    })

    it('should execute onFalse when condition is false', async () => {
      const onTrue = vi.fn((x: number) => x * 2)
      const onFalse = vi.fn((x: number) => x * 3)

      const conditionalFn = conditional(
        (x: number) => x > 0,
        onTrue,
        onFalse
      )

      const result = await conditionalFn(-5)

      expect(result).toBe(-15)
      expect(onTrue).not.toHaveBeenCalled()
      expect(onFalse).toHaveBeenCalled()
    })

    it('should return undefined when no onFalse and condition is false', async () => {
      const conditionalFn = conditional(
        (x: number) => x > 0,
        (x: number) => x * 2
      )

      const result = await conditionalFn(-5)

      expect(result).toBeUndefined()
    })

    it('should handle async predicate', async () => {
      const conditionalFn = conditional(
        async (x: number) => x > 0,
        (x: number) => x * 2
      )

      const result = await conditionalFn(5)

      expect(result).toBe(10)
    })
  })

  describe('switchCase', () => {
    it('should execute matching case', async () => {
      const switchFn = switchCase(
        (x: { type: string }) => x.type,
        {
          a: () => 'case a',
          b: () => 'case b',
          c: () => 'case c',
        }
      )

      expect(await switchFn({ type: 'a' })).toBe('case a')
      expect(await switchFn({ type: 'b' })).toBe('case b')
      expect(await switchFn({ type: 'c' })).toBe('case c')
    })

    it('should execute default case when no match', async () => {
      const switchFn = switchCase(
        (x: { type: string }) => x.type,
        {
          a: () => 'case a',
        },
        () => 'default case'
      )

      const result = await switchFn({ type: 'unknown' })

      expect(result).toBe('default case')
    })

    it('should return undefined when no match and no default', async () => {
      const switchFn = switchCase(
        (x: { type: string }) => x.type,
        {
          a: () => 'case a',
        }
      )

      const result = await switchFn({ type: 'unknown' })

      expect(result).toBeUndefined()
    })
  })

  describe('retry', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn((x: number) => x * 2)

      const retryFn = retry(fn, { maxAttempts: 3, delay: 10 })

      const result = await retryFn(5)

      expect(result).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success')

      const retryFn = retry(fn, { maxAttempts: 3, delay: 10 })

      const result = await retryFn(null)

      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should throw RetryExhaustedError when all attempts fail', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fail'))

      const retryFn = retry(fn, { maxAttempts: 3, delay: 10 })

      await expect(retryFn(null)).rejects.toThrow(RetryExhaustedError)
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should use exponential backoff', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success')

      const onRetry = vi.fn()
      const retryFn = retry(fn, {
        maxAttempts: 3,
        delay: 100,
        backoff: 'exponential',
        onRetry,
      })

      await retryFn(null)

      // First retry uses base delay (100ms)
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error))
    })

    it('should respect retryIf condition', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('do not retry'))

      const retryFn = retry(fn, {
        maxAttempts: 3,
        delay: 10,
        retryIf: (error) => !error.message.includes('do not retry'),
      })

      await expect(retryFn(null)).rejects.toThrow('do not retry')
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe('withTimeout', () => {
    it('should complete within timeout', async () => {
      const fn = async (x: number) => x * 2

      const timeoutFn = withTimeout(fn, 1000)

      const result = await timeoutFn(5)

      expect(result).toBe(10)
    })

    it('should throw TimeoutError when timeout exceeded', async () => {
      const fn = async () => {
        await new Promise(r => setTimeout(r, 100))
        return 'success'
      }

      const timeoutFn = withTimeout(fn, 10)

      await expect(timeoutFn(null)).rejects.toThrow(TimeoutError)
    })
  })

  describe('fallback', () => {
    it('should use primary when it succeeds', async () => {
      const primary = vi.fn((x: number) => x * 2)
      const alternative = vi.fn((x: number) => x * 3)

      const fallbackFn = fallback(primary, alternative)

      const result = await fallbackFn(5)

      expect(result).toBe(10)
      expect(primary).toHaveBeenCalled()
      expect(alternative).not.toHaveBeenCalled()
    })

    it('should use alternative when primary fails', async () => {
      const primary = vi.fn(() => { throw new Error('fail') })
      const alternative = vi.fn((x: number) => x * 3)

      const fallbackFn = fallback(primary, alternative)

      const result = await fallbackFn(5)

      expect(result).toBe(15)
      expect(primary).toHaveBeenCalled()
      expect(alternative).toHaveBeenCalled()
    })

    it('should respect shouldFallback condition', async () => {
      const primary = vi.fn(() => { throw new Error('do not fallback') })
      const alternative = vi.fn((x: number) => x * 3)

      const fallbackFn = fallback(
        primary,
        alternative,
        (error) => !error.message.includes('do not fallback')
      )

      await expect(fallbackFn(5)).rejects.toThrow('do not fallback')
      expect(alternative).not.toHaveBeenCalled()
    })
  })

  describe('tryEach', () => {
    it('should use first successful function', async () => {
      const fn1 = vi.fn(() => { throw new Error('fail 1') })
      const fn2 = vi.fn(() => { throw new Error('fail 2') })
      const fn3 = vi.fn((x: number) => x * 2)

      const tryEachFn = tryEach(fn1, fn2, fn3)

      const result = await tryEachFn(5)

      expect(result).toBe(10)
      expect(fn1).toHaveBeenCalled()
      expect(fn2).toHaveBeenCalled()
      expect(fn3).toHaveBeenCalled()
    })

    it('should throw last error when all fail', async () => {
      const fn1 = () => { throw new Error('fail 1') }
      const fn2 = () => { throw new Error('fail 2') }
      const fn3 = () => { throw new Error('fail 3') }

      const tryEachFn = tryEach(fn1, fn2, fn3)

      await expect(tryEachFn(null)).rejects.toThrow('fail 3')
    })
  })

  describe('mapOver', () => {
    it('should map function over array', async () => {
      const double = (x: number) => x * 2

      const mapFn = mapOver(double)

      const result = await mapFn([1, 2, 3, 4, 5])

      expect(result).toEqual([2, 4, 6, 8, 10])
    })

    it('should handle parallel execution', async () => {
      const asyncDouble = async (x: number) => {
        await new Promise(r => setTimeout(r, 10))
        return x * 2
      }

      const start = Date.now()
      const result = await mapOver(asyncDouble, { parallel: true })([1, 2, 3, 4, 5])
      const elapsed = Date.now() - start

      expect(result).toEqual([2, 4, 6, 8, 10])
      expect(elapsed).toBeLessThan(50) // All run in parallel
    })

    it('should respect maxConcurrency', async () => {
      let concurrent = 0
      let maxConcurrent = 0

      const asyncFn = async (x: number) => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise(r => setTimeout(r, 10))
        concurrent--
        return x * 2
      }

      const result = await mapOver(asyncFn, { parallel: true, maxConcurrency: 2 })([1, 2, 3, 4, 5])

      expect(result).toEqual([2, 4, 6, 8, 10])
      expect(maxConcurrent).toBeLessThanOrEqual(2)
    })
  })

  describe('filterBy', () => {
    it('should filter array by predicate', async () => {
      const isEven = (x: number) => x % 2 === 0

      const filterFn = filterBy(isEven)

      const result = await filterFn([1, 2, 3, 4, 5])

      expect(result).toEqual([2, 4])
    })

    it('should handle async predicate', async () => {
      const asyncIsEven = async (x: number) => x % 2 === 0

      const filterFn = filterBy(asyncIsEven)

      const result = await filterFn([1, 2, 3, 4, 5])

      expect(result).toEqual([2, 4])
    })
  })

  describe('reduceWith', () => {
    it('should reduce array to single value', async () => {
      const sum = (acc: number, x: number) => acc + x

      const reduceFn = reduceWith(sum, 0)

      const result = await reduceFn([1, 2, 3, 4, 5])

      expect(result).toBe(15)
    })

    it('should handle async reducer', async () => {
      const asyncSum = async (acc: number, x: number) => acc + x

      const reduceFn = reduceWith(asyncSum, 0)

      const result = await reduceFn([1, 2, 3, 4, 5])

      expect(result).toBe(15)
    })
  })

  describe('tap', () => {
    it('should execute side effect without modifying input', async () => {
      const sideEffect = vi.fn()

      const tapFn = tap(sideEffect)

      const result = await tapFn(5)

      expect(result).toBe(5)
      expect(sideEffect).toHaveBeenCalledWith(5, undefined)
    })

    it('should work with async side effects', async () => {
      const sideEffect = vi.fn(async () => {
        await new Promise(r => setTimeout(r, 10))
      })

      const tapFn = tap(sideEffect)

      const result = await tapFn(5)

      expect(result).toBe(5)
      expect(sideEffect).toHaveBeenCalled()
    })
  })

  describe('log', () => {
    it('should log and pass through value', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const logFn = log('Test')

      const result = await logFn('hello')

      expect(result).toBe('hello')
      expect(consoleSpy).toHaveBeenCalledWith('[Test]', 'hello')

      consoleSpy.mockRestore()
    })

    it('should work without label', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const logFn = log()

      const result = await logFn('hello')

      expect(result).toBe('hello')
      expect(consoleSpy).toHaveBeenCalledWith('hello')

      consoleSpy.mockRestore()
    })
  })

  describe('complex compositions', () => {
    it('should compose pipe with parallel', async () => {
      const processItem = pipe(
        (x: number) => x + 1,
        (x: number) => x * 2
      )

      const processAll = parallel(
        processItem,
        (x: number) => x - 1,
        (x: number) => x * 3
      )

      const result = await processAll(5)

      expect(result).toEqual([12, 4, 15])
    })

    it('should compose retry with timeout', async () => {
      let attempt = 0
      const fn = async (x: number) => {
        attempt++
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 100))
        }
        return x * 2
      }

      const withRetryAndTimeout = retry(
        withTimeout(fn, 50),
        { maxAttempts: 5, delay: 10 }
      )

      const result = await withRetryAndTimeout(5)

      expect(result).toBe(10)
      expect(attempt).toBe(3)
    })

    it('should compose fallback with conditional', async () => {
      const riskyOperation = (x: number) => {
        if (x < 0) throw new Error('negative')
        return x * 2
      }

      const safeOperation = (x: number) => Math.abs(x) * 2

      const conditionalFallback = conditional(
        (x: number) => x >= 0,
        riskyOperation,
        fallback(riskyOperation, safeOperation)
      )

      expect(await conditionalFallback(5)).toBe(10)
      expect(await conditionalFallback(-5)).toBe(10)
    })
  })
})
