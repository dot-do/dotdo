/**
 * DLQStore Performance Benchmarks
 *
 * Tests Dead Letter Queue operations:
 * - add to DLQ: Add failed event to queue
 * - replay entry: Attempt to replay a failed event
 * - purge exhausted: Remove entries that have exceeded max retries
 *
 * Target: All operations should be sub-10ms for simple operations
 *
 * @see db/stores.ts for DLQStore implementation
 * @see dotdo-hn07m for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('DLQStore benchmarks', () => {
  describe('add to DLQ operations', () => {
    it('add to DLQ', async () => {
      const result = await benchmark({
        name: 'dlq-add',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/dlq', {
            method: 'POST',
            body: JSON.stringify({
              eventId: `event-${i}`,
              verb: 'Test.created',
              source: `Thing/${i}`,
              data: { index: i, payload: 'test data' },
              error: 'Handler failed: timeout after 30s',
              maxRetries: 3,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeGreaterThan(0)

      // Sub-10ms target for DLQ add
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('add to DLQ with error stack', async () => {
      const result = await benchmark({
        name: 'dlq-add-with-stack',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const errorStack = `Error: Handler failed\n    at processEvent (/workers/handler.js:42:15)\n    at EventsStore.dispatch (/stores/events.js:156:23)\n    at async DurableObject.fetch (/do/index.js:89:12)\n    at async handleRequest (/workers/api.js:25:5)`

          return ctx.do.request('/dlq', {
            method: 'POST',
            body: JSON.stringify({
              eventId: `event-stack-${i}`,
              verb: 'Order.failed',
              source: `Order/${i}`,
              data: { orderId: i, amount: 99.99 },
              error: 'Handler failed: database connection timeout',
              errorStack,
              maxRetries: 5,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Stack trace should not add significant overhead
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('add to DLQ with large data payload', async () => {
      const result = await benchmark({
        name: 'dlq-add-large-data',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const largeData = {
            items: Array.from({ length: 50 }, (_, j) => ({
              id: `item-${j}`,
              name: `Item ${j}`,
              properties: { a: 1, b: 2, c: 3 },
              nested: { deep: { value: `nested-${j}` } },
            })),
            context: Object.fromEntries(
              Array.from({ length: 30 }, (_, j) => [`ctx-${j}`, `value-${j}`])
            ),
          }

          return ctx.do.request('/dlq', {
            method: 'POST',
            body: JSON.stringify({
              eventId: `event-large-${i}`,
              verb: 'Batch.failed',
              source: `Batch/${i}`,
              data: largeData,
              error: 'Batch processing failed: partial completion',
              maxRetries: 3,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Large payloads may be slower but still sub-30ms
      expect(result.stats.p50).toBeLessThan(30)
    })

    it('add to DLQ with different retry limits', async () => {
      const retryLimits = [1, 3, 5, 10]

      for (const maxRetries of retryLimits) {
        const result = await benchmark({
          name: `dlq-add-retries-${maxRetries}`,
          target: 'stores.perf.do',
          iterations: 30,
          warmup: 5,
          run: async (ctx, i) => {
            return ctx.do.request('/dlq', {
              method: 'POST',
              body: JSON.stringify({
                eventId: `event-retry-${maxRetries}-${i}`,
                verb: 'Retryable.failed',
                source: `Retryable/${i}`,
                data: { index: i },
                error: 'Transient failure',
                maxRetries,
              }),
            })
          },
        })

        record(result)

        expect(result.samples.length).toBe(30)
        // Retry limit should not affect add performance
        expect(result.stats.p50).toBeLessThan(10)
      }
    })
  })

  describe('replay entry operations', () => {
    it('replay entry', async () => {
      let entryIds: string[] = []
      let replayIndex = 0

      const result = await benchmark({
        name: 'dlq-replay',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Seed DLQ entries
          for (let i = 0; i < 100; i++) {
            const response = await ctx.do.request<{ id: string }>('/dlq', {
              method: 'POST',
              body: JSON.stringify({
                eventId: `replay-event-${i}`,
                verb: 'Replayable.failed',
                source: `Replayable/${i}`,
                data: { index: i },
                error: 'Initial failure',
                maxRetries: 5,
              }),
            })
            entryIds.push(response.id)
          }
        },
        run: async (ctx) => {
          // Cycle through entries (they may be deleted on successful replay)
          const id = entryIds[replayIndex % entryIds.length]
          replayIndex++
          return ctx.do.request(`/dlq/${id}/replay`, {
            method: 'POST',
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Replay should be sub-15ms (includes handler invocation attempt)
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('replay with increment retry', async () => {
      let entryIds: string[] = []

      const result = await benchmark({
        name: 'dlq-replay-increment',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create entries for retry increment testing
          for (let i = 0; i < 50; i++) {
            const response = await ctx.do.request<{ id: string }>('/dlq', {
              method: 'POST',
              body: JSON.stringify({
                eventId: `retry-event-${i}`,
                verb: 'Retryable.failed',
                source: `Retryable/${i}`,
                data: { index: i },
                error: 'Failure',
                maxRetries: 10,
              }),
            })
            entryIds.push(response.id)
          }
        },
        run: async (ctx, i) => {
          if (i < entryIds.length) {
            // Increment retry count (simulating failed replay)
            return ctx.do.request(`/dlq/${entryIds[i]}/increment`, {
              method: 'POST',
            })
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Increment should be fast (sub-10ms)
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('replay exhausted entry (max retries reached)', async () => {
      let exhaustedId: string

      const result = await benchmark({
        name: 'dlq-replay-exhausted',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create an entry and exhaust its retries
          const response = await ctx.do.request<{ id: string }>('/dlq', {
            method: 'POST',
            body: JSON.stringify({
              eventId: 'exhausted-event',
              verb: 'Exhausted.failed',
              source: 'Exhausted/1',
              data: { test: true },
              error: 'Permanent failure',
              maxRetries: 3,
            }),
          })
          exhaustedId = response.id

          // Increment retries to exhaust
          for (let i = 0; i < 3; i++) {
            await ctx.do.request(`/dlq/${exhaustedId}/increment`, {
              method: 'POST',
            })
          }
        },
        run: async (ctx) => {
          try {
            // Attempt replay on exhausted entry
            await ctx.do.request(`/dlq/${exhaustedId}/replay`, {
              method: 'POST',
            })
          } catch {
            // Expected to fail - measuring latency of rejection
          }
          return null
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Exhausted check should be fast
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('purge exhausted operations', () => {
    it('purge exhausted', async () => {
      const result = await benchmark({
        name: 'dlq-purge-exhausted',
        target: 'stores.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Seed with mix of active and exhausted entries
          for (let i = 0; i < 50; i++) {
            const response = await ctx.do.request<{ id: string }>('/dlq', {
              method: 'POST',
              body: JSON.stringify({
                eventId: `purge-event-${i}`,
                verb: 'Purgeable.failed',
                source: `Purgeable/${i}`,
                data: { index: i },
                error: 'Failure',
                maxRetries: 3,
              }),
            })

            // Exhaust every other entry
            if (i % 2 === 0) {
              for (let j = 0; j < 3; j++) {
                await ctx.do.request(`/dlq/${response.id}/increment`, {
                  method: 'POST',
                })
              }
            }
          }
        },
        run: async (ctx) => {
          return ctx.do.request('/dlq/purge', {
            method: 'POST',
            body: JSON.stringify({ exhausted: true }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // Purge may be slower due to scanning - sub-50ms
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('purge by age', async () => {
      const result = await benchmark({
        name: 'dlq-purge-by-age',
        target: 'stores.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx) => {
          // Purge entries older than 24 hours
          return ctx.do.request('/dlq/purge', {
            method: 'POST',
            body: JSON.stringify({ olderThanHours: 24 }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // Age-based purge should be reasonably fast
      expect(result.stats.p50).toBeLessThan(50)
    })
  })

  describe('list operations', () => {
    it('list DLQ entries', async () => {
      const result = await benchmark({
        name: 'dlq-list',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Seed DLQ entries
          for (let i = 0; i < 50; i++) {
            await ctx.do.request('/dlq', {
              method: 'POST',
              body: JSON.stringify({
                eventId: `list-event-${i}`,
                verb: ['TypeA.failed', 'TypeB.failed', 'TypeC.failed'][i % 3],
                source: `Source/${i}`,
                data: { index: i },
                error: 'Failure for list test',
                maxRetries: 3,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/dlq?limit=20')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // List should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('list by verb', async () => {
      const result = await benchmark({
        name: 'dlq-list-by-verb',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const verbs = ['TypeA.failed', 'TypeB.failed', 'TypeC.failed']
          return ctx.do.list(`/dlq?verb=${encodeURIComponent(verbs[i % verbs.length])}&limit=20`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Verb filter should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('list exhausted only', async () => {
      const result = await benchmark({
        name: 'dlq-list-exhausted',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.list('/dlq?exhausted=true&limit=20')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Exhausted filter should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('list pending only', async () => {
      const result = await benchmark({
        name: 'dlq-list-pending',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.list('/dlq?exhausted=false&limit=20')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Pending filter should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })
  })

  describe('get operations', () => {
    it('get DLQ entry by ID', async () => {
      let entryIds: string[] = []

      const result = await benchmark({
        name: 'dlq-get',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create entries
          for (let i = 0; i < 100; i++) {
            const response = await ctx.do.request<{ id: string }>('/dlq', {
              method: 'POST',
              body: JSON.stringify({
                eventId: `get-event-${i}`,
                verb: 'Gettable.failed',
                source: `Gettable/${i}`,
                data: { index: i },
                error: 'Failure',
                maxRetries: 3,
              }),
            })
            entryIds.push(response.id)
          }
        },
        run: async (ctx, i) => {
          return ctx.do.get(`/dlq/${entryIds[i % entryIds.length]}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Get by ID should be very fast (sub-5ms)
      expect(result.stats.p50).toBeLessThan(5)
    })
  })

  describe('delete operations', () => {
    it('delete DLQ entry', async () => {
      let entryIds: string[] = []

      const result = await benchmark({
        name: 'dlq-delete',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create entries to delete
          for (let i = 0; i < 100; i++) {
            const response = await ctx.do.request<{ id: string }>('/dlq', {
              method: 'POST',
              body: JSON.stringify({
                eventId: `delete-event-${i}`,
                verb: 'Deletable.failed',
                source: `Deletable/${i}`,
                data: { index: i },
                error: 'Failure',
                maxRetries: 3,
              }),
            })
            entryIds.push(response.id)
          }
        },
        run: async (ctx, i) => {
          if (i < entryIds.length) {
            return ctx.do.delete(`/dlq/${entryIds[i]}`)
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Delete should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('throughput', () => {
    it('DLQ add throughput', async () => {
      const batchSize = 20

      const result = await benchmark({
        name: 'dlq-throughput',
        target: 'stores.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx, i) => {
          // Add multiple entries sequentially
          for (let j = 0; j < batchSize; j++) {
            await ctx.do.request('/dlq', {
              method: 'POST',
              body: JSON.stringify({
                eventId: `throughput-event-${i * batchSize + j}`,
                verb: 'Throughput.failed',
                source: `Throughput/${i * batchSize + j}`,
                data: { batch: i, index: j },
                error: 'Throughput test failure',
                maxRetries: 3,
              }),
            })
          }
        },
      })

      record(result)

      // Calculate throughput
      const avgMs = result.stats.mean
      const throughput = (batchSize * 1000) / avgMs // entries per second

      // Should achieve at least 200 entries/sec
      expect(throughput).toBeGreaterThan(200)
    })
  })

  describe('concurrency', () => {
    it('handles concurrent DLQ adds', async () => {
      const concurrency = 5
      const iterationsPerWorker = 20

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `dlq-concurrent-add-${workerIndex}`,
            target: 'stores.perf.do',
            iterations: iterationsPerWorker,
            warmup: 2,
            run: async (ctx, i) => {
              return ctx.do.request('/dlq', {
                method: 'POST',
                body: JSON.stringify({
                  eventId: `concurrent-event-${workerIndex}-${i}`,
                  verb: 'Concurrent.failed',
                  source: `Worker/${workerIndex}/Item/${i}`,
                  data: { worker: workerIndex, index: i },
                  error: 'Concurrent test failure',
                  maxRetries: 3,
                }),
              })
            },
          })
        )
      )

      record(results)

      // All workers should complete without excessive errors
      for (const result of results) {
        expect(result.errors?.length ?? 0).toBeLessThan(iterationsPerWorker * 0.1)
      }

      // Calculate overall latency variance
      const allP50s = results.map((r) => r.stats.p50)
      const meanP50 = allP50s.reduce((a, b) => a + b, 0) / allP50s.length
      const maxP50 = Math.max(...allP50s)

      // No worker should be more than 3x slower than average
      expect(maxP50).toBeLessThan(meanP50 * 3)
    })

    it('handles concurrent replays', async () => {
      const concurrency = 3
      const iterationsPerWorker = 15
      let allEntryIds: string[][] = []

      // Setup: Create entries for each worker
      for (let w = 0; w < concurrency; w++) {
        const workerEntries: string[] = []
        for (let i = 0; i < 30; i++) {
          const response = await (await fetch(`https://stores.perf.do/dlq`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventId: `replay-concurrent-${w}-${i}`,
              verb: 'Replayable.failed',
              source: `Replayable/${w}/${i}`,
              data: { worker: w, index: i },
              error: 'Initial failure',
              maxRetries: 10,
            }),
          })).json() as { id: string }
          workerEntries.push(response.id)
        }
        allEntryIds.push(workerEntries)
      }

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `dlq-concurrent-replay-${workerIndex}`,
            target: 'stores.perf.do',
            iterations: iterationsPerWorker,
            warmup: 2,
            run: async (ctx, i) => {
              const entryIds = allEntryIds[workerIndex] || []
              if (i < entryIds.length) {
                return ctx.do.request(`/dlq/${entryIds[i]}/replay`, {
                  method: 'POST',
                })
              }
            },
          })
        )
      )

      record(results)

      // Concurrent replays should complete without excessive errors
      for (const result of results) {
        expect(result.errors?.length ?? 0).toBeLessThan(iterationsPerWorker * 0.2)
      }
    })
  })

  describe('stats', () => {
    it('get DLQ stats', async () => {
      const result = await benchmark({
        name: 'dlq-stats',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.get('/dlq/stats')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Stats should be fast (aggregation query)
      expect(result.stats.p50).toBeLessThan(20)
    })
  })
})
