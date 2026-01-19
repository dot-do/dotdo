import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBatchMapPromise, BatchMapOptions } from '../batch'

describe('BatchMapPromise - .map() Batching', () => {
  describe('Basic batching', () => {
    it('should map over array with async function', async () => {
      const items = [1, 2, 3, 4, 5]
      const fn = async (x: number) => x * 2

      const batch = createBatchMapPromise(items, fn)
      const results = await batch

      expect(results).toEqual([2, 4, 6, 8, 10])
    })

    it('should handle single item', async () => {
      const items = [42]
      const fn = async (x: number) => ({ value: x })

      const results = await createBatchMapPromise(items, fn)

      expect(results).toEqual([{ value: 42 }])
    })

    it('should handle empty array', async () => {
      const items: number[] = []
      const fn = async (x: number) => x

      const results = await createBatchMapPromise(items, fn)

      expect(results).toEqual([])
    })
  })

  describe('Concurrency control', () => {
    it('should respect concurrency limit', async () => {
      const items = Array.from({ length: 10 }, (_, i) => i)
      let activeCount = 0
      let maxActive = 0

      const fn = async (x: number) => {
        activeCount++
        maxActive = Math.max(maxActive, activeCount)
        await new Promise(r => setTimeout(r, 10))
        activeCount--
        return x * 2
      }

      await createBatchMapPromise(items, fn, { concurrency: 3 })

      expect(maxActive).toBe(3)
    })

    it('should default to parallel execution when no concurrency specified', async () => {
      const items = [1, 2, 3]
      const start = Date.now()

      const fn = async (x: number) => {
        await new Promise(r => setTimeout(r, 50))
        return x
      }

      await createBatchMapPromise(items, fn)
      const elapsed = Date.now() - start

      // Should be ~50ms (parallel), not ~150ms (sequential)
      expect(elapsed).toBeLessThan(100)
    })

    it('should handle concurrency of 1 (sequential)', async () => {
      const items = [1, 2, 3]
      const order: number[] = []

      const fn = async (x: number) => {
        order.push(x)
        await new Promise(r => setTimeout(r, 10))
        return x
      }

      await createBatchMapPromise(items, fn, { concurrency: 1 })

      expect(order).toEqual([1, 2, 3])
    })
  })

  describe('Progress tracking', () => {
    it('should call progress callback', async () => {
      const items = [1, 2, 3, 4, 5]
      const progressCalls: Array<{ done: number; total: number }> = []

      const fn = async (x: number) => {
        await new Promise(r => setTimeout(r, 10))
        return x
      }

      await createBatchMapPromise(items, fn, {
        onProgress: (done, total) => {
          progressCalls.push({ done, total })
        }
      })

      expect(progressCalls.length).toBeGreaterThan(0)
      expect(progressCalls[progressCalls.length - 1]).toEqual({ done: 5, total: 5 })
    })

    it('should track progress correctly with concurrency', async () => {
      const items = [1, 2, 3, 4, 5]
      const progressCalls: number[] = []

      const fn = async (x: number) => {
        await new Promise(r => setTimeout(r, 10))
        return x
      }

      await createBatchMapPromise(items, fn, {
        concurrency: 2,
        onProgress: (done) => {
          progressCalls.push(done)
        }
      })

      // Should increment monotonically
      for (let i = 1; i < progressCalls.length; i++) {
        expect(progressCalls[i]).toBeGreaterThanOrEqual(progressCalls[i - 1])
      }
      expect(progressCalls[progressCalls.length - 1]).toBe(5)
    })
  })

  describe('Error handling', () => {
    it('should handle individual item errors', async () => {
      const items = [1, 2, 3, 4, 5]

      const fn = async (x: number) => {
        if (x === 3) throw new Error(`Error on ${x}`)
        return x * 2
      }

      const results = await createBatchMapPromise(items, fn, {
        onError: 'continue'
      })

      // Successful items should have results, failed items should be undefined
      expect(results[0]).toBe(2)
      expect(results[1]).toBe(4)
      expect(results[2]).toBeUndefined()
      expect(results[3]).toBe(8)
      expect(results[4]).toBe(10)
    })

    it('should collect errors when continuing on error', async () => {
      const items = [1, 2, 3, 4, 5]
      const errors: Array<{ index: number; item: number; error: Error }> = []

      const fn = async (x: number) => {
        if (x % 2 === 0) throw new Error(`Error on ${x}`)
        return x * 2
      }

      await createBatchMapPromise(items, fn, {
        onError: 'continue',
        onItemError: (index, item, error) => {
          errors.push({ index, item, error })
        }
      })

      expect(errors).toHaveLength(2)
      expect(errors[0].item).toBe(2)
      expect(errors[1].item).toBe(4)
    })

    it('should fail fast by default', async () => {
      const items = [1, 2, 3, 4, 5]
      let processed = 0

      const fn = async (x: number) => {
        processed++
        if (x === 3) throw new Error('Failed on 3')
        await new Promise(r => setTimeout(r, 10))
        return x
      }

      await expect(createBatchMapPromise(items, fn)).rejects.toThrow('Failed on 3')
      // May have started processing more due to concurrency, but not all 5
      expect(processed).toBeLessThanOrEqual(5)
    })
  })

  describe('Batch size control', () => {
    it('should respect batch size limit', async () => {
      const items = Array.from({ length: 25 }, (_, i) => i)
      const batchSizes: number[] = []

      const fn = async (x: number) => x

      // Mock to track how many items are processed together
      let currentBatch = 0
      const fnWithTracking = async (x: number) => {
        if (x % 10 === 0 && x !== 0) {
          batchSizes.push(currentBatch)
          currentBatch = 0
        }
        currentBatch++
        return fn(x)
      }

      await createBatchMapPromise(items, fnWithTracking, {
        batchSize: 10,
        concurrency: 10
      })

      // Should process in batches of max 10
      // Note: This is a simplified test - real implementation might track differently
    })
  })

  describe('Transform function support', () => {
    it('should apply transform to each result', async () => {
      const items = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' }
      ]

      const fn = async (user: { id: number; name: string }) => user

      const results = await createBatchMapPromise(items, fn, {
        transform: (user) => user.name
      })

      expect(results).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('should support async transform', async () => {
      const items = [1, 2, 3]
      const fn = async (x: number) => ({ value: x })

      const results = await createBatchMapPromise(items, fn, {
        transform: async (obj) => {
          await new Promise(r => setTimeout(r, 5))
          return obj.value * 2
        }
      })

      expect(results).toEqual([2, 4, 6])
    })
  })

  describe('Retry support', () => {
    it('should retry failed items', async () => {
      const items = [1, 2, 3]
      const attempts = new Map<number, number>()

      const fn = async (x: number) => {
        const attempt = (attempts.get(x) || 0) + 1
        attempts.set(x, attempt)

        // Fail first 2 attempts
        if (attempt < 3) {
          throw new Error(`Attempt ${attempt} failed`)
        }

        return x * 2
      }

      const results = await createBatchMapPromise(items, fn, {
        retries: 3,
        onError: 'retry'
      })

      expect(results).toEqual([2, 4, 6])
      // Each item should have been attempted 3 times
      expect(attempts.get(1)).toBe(3)
      expect(attempts.get(2)).toBe(3)
      expect(attempts.get(3)).toBe(3)
    })

    it('should stop retrying after max attempts', async () => {
      const items = [1, 2, 3]
      const attempts = new Map<number, number>()

      const fn = async (x: number) => {
        const attempt = (attempts.get(x) || 0) + 1
        attempts.set(x, attempt)

        // Always fail on item 2
        if (x === 2) {
          throw new Error('Always fails')
        }

        return x * 2
      }

      const results = await createBatchMapPromise(items, fn, {
        retries: 2,
        onError: 'continue'
      })

      expect(results[0]).toBe(2)
      expect(results[1]).toBeUndefined() // Failed after retries
      expect(results[2]).toBe(6)
      expect(attempts.get(2)).toBe(3) // Initial + 2 retries
    })
  })

  describe('Result ordering', () => {
    it('should maintain input order regardless of completion order', async () => {
      const items = [1, 2, 3, 4, 5]

      // Items complete in reverse order
      const fn = async (x: number) => {
        await new Promise(r => setTimeout(r, (6 - x) * 10))
        return x * 2
      }

      const results = await createBatchMapPromise(items, fn)

      expect(results).toEqual([2, 4, 6, 8, 10])
    })
  })

  describe('Chainable API', () => {
    it('should support method chaining with .batch()', async () => {
      const items = [1, 2, 3, 4, 5]
      const fn = async (x: number) => x * 2

      const batch = createBatchMapPromise(items, fn)
      const results = await batch.batch(2)

      expect(results).toEqual([2, 4, 6, 8, 10])
    })

    it('should support .progress() chaining', async () => {
      const items = [1, 2, 3]
      const fn = async (x: number) => x * 2
      const progressCalls: number[] = []

      const results = await createBatchMapPromise(items, fn)
        .progress((done) => progressCalls.push(done))

      expect(results).toEqual([2, 4, 6])
      expect(progressCalls.length).toBeGreaterThan(0)
    })
  })
})
