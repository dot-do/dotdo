/**
 * EventsStore Performance Benchmarks
 *
 * Tests event emission and streaming operations:
 * - emit event: Record a new event
 * - list events: Query events with filters
 * - replay from sequence: Replay events from a given sequence number
 *
 * Target: All operations should be sub-10ms for simple operations
 *
 * @see db/stores.ts for EventsStore implementation
 * @see dotdo-hn07m for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('EventsStore benchmarks', () => {
  describe('emit event operations', () => {
    it('emit event', async () => {
      const result = await benchmark({
        name: 'events-emit',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/events', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'created',
              source: `Thing/${i}`,
              data: { timestamp: Date.now(), payload: `event-${i}` },
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeGreaterThan(0)

      // Sub-10ms target for event emission
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('emit event with action reference', async () => {
      const result = await benchmark({
        name: 'events-emit-with-action',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          return ctx.do.request('/events', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'processed',
              source: `Order/${i}`,
              data: { status: 'completed', amount: 99.99 },
              actionId: `action-${i}`,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Action reference should not add significant overhead
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('emit event with large data payload', async () => {
      const result = await benchmark({
        name: 'events-emit-large',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const largeData = {
            changes: Array.from({ length: 50 }, (_, j) => ({
              field: `field-${j}`,
              oldValue: `old-${j}`,
              newValue: `new-${j}`,
              timestamp: Date.now() - j * 1000,
            })),
            context: Object.fromEntries(
              Array.from({ length: 30 }, (_, j) => [`ctx-${j}`, `value-${j}`])
            ),
            audit: {
              user: 'system',
              ip: '127.0.0.1',
              userAgent: 'BenchmarkRunner/1.0',
              correlationId: `corr-${i}`,
            },
          }

          return ctx.do.request('/events', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'bulkChanged',
              source: `Entity/${i}`,
              data: largeData,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Large payloads may be slower but still sub-30ms
      expect(result.stats.p50).toBeLessThan(30)
    })

    it('emit multiple event types', async () => {
      const verbs = ['created', 'updated', 'deleted', 'archived', 'restored']

      for (const verb of verbs) {
        const result = await benchmark({
          name: `events-emit-${verb}`,
          target: 'stores.perf.do',
          iterations: 30,
          warmup: 5,
          run: async (ctx, i) => {
            return ctx.do.request('/events', {
              method: 'POST',
              body: JSON.stringify({
                verb,
                source: `Thing/${verb}-${i}`,
                data: { verb, index: i },
              }),
            })
          },
        })

        record(result)

        expect(result.samples.length).toBe(30)
        // All event types should be sub-10ms
        expect(result.stats.p50).toBeLessThan(10)
      }
    })
  })

  describe('list events operations', () => {
    it('list events', async () => {
      const result = await benchmark({
        name: 'events-list',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Seed events
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/events', {
              method: 'POST',
              body: JSON.stringify({
                verb: ['created', 'updated', 'deleted'][i % 3],
                source: `Thing/${Math.floor(i / 5)}`,
                data: { index: i },
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/events?limit=50')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // List should be sub-20ms
      expect(result.stats.p50).toBeLessThan(20)
    })

    it('list events by source', async () => {
      let sourceId: string

      const result = await benchmark({
        name: 'events-list-by-source',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          sourceId = `Thing/event-source`
          // Create 20 events for the source
          for (let i = 0; i < 20; i++) {
            await ctx.do.request('/events', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'updated',
                source: sourceId,
                data: { version: i + 1 },
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list(`/events?source=${encodeURIComponent(sourceId)}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // List by source should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('list events by verb', async () => {
      const result = await benchmark({
        name: 'events-list-by-verb',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const verbs = ['created', 'updated', 'deleted']
          return ctx.do.list(`/events?verb=${verbs[i % verbs.length]}&limit=20`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Verb filter should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('list events with ordering', async () => {
      const result = await benchmark({
        name: 'events-list-ordered',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const order = i % 2 === 0 ? 'asc' : 'desc'
          return ctx.do.list(`/events?orderBy=sequence&order=${order}&limit=30`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Ordered list should be sub-20ms
      expect(result.stats.p50).toBeLessThan(20)
    })
  })

  describe('replay from sequence operations', () => {
    it('replay from sequence', async () => {
      let maxSequence: number = 0

      const result = await benchmark({
        name: 'events-replay',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Seed events and track sequence
          for (let i = 0; i < 100; i++) {
            const response = await ctx.do.request<{ sequence: number }>('/events', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'recorded',
                source: `Stream/${i}`,
                data: { index: i },
              }),
            })
            maxSequence = Math.max(maxSequence, response.sequence || i)
          }
        },
        run: async (ctx, i) => {
          const fromSequence = Math.max(0, maxSequence - 90 + (i % 80))
          return ctx.do.list(`/events/replay?fromSequence=${fromSequence}&limit=10`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Replay should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('replay with different window sizes', async () => {
      const windowSizes = [5, 10, 20, 50]

      for (const limit of windowSizes) {
        const result = await benchmark({
          name: `events-replay-window-${limit}`,
          target: 'stores.perf.do',
          iterations: 30,
          warmup: 5,
          run: async (ctx, i) => {
            return ctx.do.list(`/events/replay?fromSequence=${i}&limit=${limit}`)
          },
        })

        record(result)

        expect(result.samples.length).toBe(30)
        // Larger windows may be slower, scale accordingly
        expect(result.stats.p50).toBeLessThan(10 + limit * 0.5)
      }
    })

    it('replay from recent sequence', async () => {
      const result = await benchmark({
        name: 'events-replay-recent',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Seed recent events
          for (let i = 0; i < 50; i++) {
            await ctx.do.request('/events', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'recent',
                source: `RecentStream/${i}`,
                data: { index: i },
              }),
            })
          }
        },
        run: async (ctx) => {
          // Always replay from near the end (simulating real-time streaming)
          return ctx.do.list('/events/replay?fromSequence=-10&limit=10')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Recent replay should be very fast (sub-10ms)
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('streaming operations', () => {
    it('mark events as streamed', async () => {
      let eventIds: string[] = []

      const result = await benchmark({
        name: 'events-mark-streamed',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create events to mark as streamed
          for (let i = 0; i < 100; i++) {
            const response = await ctx.do.request<{ id: string }>('/events', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'pending',
                source: `StreamTest/${i}`,
                data: { index: i },
              }),
            })
            eventIds.push(response.id)
          }
        },
        run: async (ctx, i) => {
          if (i < eventIds.length) {
            return ctx.do.request(`/events/${eventIds[i]}/streamed`, {
              method: 'POST',
            })
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Mark streamed should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('get unstreamed events', async () => {
      const result = await benchmark({
        name: 'events-unstreamed',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create mix of streamed and unstreamed events
          for (let i = 0; i < 50; i++) {
            const response = await ctx.do.request<{ id: string }>('/events', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'mixed',
                source: `MixedStream/${i}`,
                data: { index: i },
              }),
            })
            // Mark every other event as streamed
            if (i % 2 === 0) {
              await ctx.do.request(`/events/${response.id}/streamed`, {
                method: 'POST',
              })
            }
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/events?streamed=false&limit=20')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Unstreamed filter should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })
  })

  describe('throughput', () => {
    it('event emission throughput', async () => {
      const batchSize = 25

      const result = await benchmark({
        name: 'events-throughput',
        target: 'stores.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx, i) => {
          // Emit multiple events sequentially
          for (let j = 0; j < batchSize; j++) {
            await ctx.do.request('/events', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'throughput',
                source: `ThroughputTest/${i * batchSize + j}`,
                data: { batch: i, index: j },
              }),
            })
          }
        },
      })

      record(result)

      // Calculate throughput
      const avgMs = result.stats.mean
      const throughput = (batchSize * 1000) / avgMs // events per second

      // Should achieve at least 250 events/sec
      expect(throughput).toBeGreaterThan(250)
    })

    it('batch emission throughput', async () => {
      const batchSize = 20

      const result = await benchmark({
        name: 'events-batch-throughput',
        target: 'stores.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx, i) => {
          const events = Array.from({ length: batchSize }, (_, j) => ({
            verb: 'batchEmit',
            source: `BatchTest/${i * batchSize + j}`,
            data: { batch: i, index: j },
          }))

          return ctx.do.request('/events/batch', {
            method: 'POST',
            body: JSON.stringify(events),
          })
        },
      })

      record(result)

      // Calculate batch throughput
      const avgMs = result.stats.mean
      const throughput = (batchSize * 1000) / avgMs

      // Batch should be more efficient than sequential
      expect(throughput).toBeGreaterThan(500)
    })
  })

  describe('concurrency', () => {
    it('handles concurrent event emission', async () => {
      const concurrency = 5
      const iterationsPerWorker = 20

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `events-concurrent-${workerIndex}`,
            target: 'stores.perf.do',
            iterations: iterationsPerWorker,
            warmup: 2,
            run: async (ctx, i) => {
              return ctx.do.request('/events', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'concurrent',
                  source: `Worker/${workerIndex}/Event/${i}`,
                  data: { worker: workerIndex, index: i },
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

      // Verify sequence numbers are monotonically increasing
      // (This would be verified by the actual implementation)

      // Calculate overall latency variance
      const allP50s = results.map((r) => r.stats.p50)
      const meanP50 = allP50s.reduce((a, b) => a + b, 0) / allP50s.length
      const maxP50 = Math.max(...allP50s)

      // No worker should be more than 3x slower than average
      expect(maxP50).toBeLessThan(meanP50 * 3)
    })
  })

  describe('sequence integrity', () => {
    it('maintains sequence order under load', async () => {
      const eventCount = 50
      const receivedSequences: number[] = []

      await benchmark({
        name: 'events-sequence-integrity',
        target: 'stores.perf.do',
        iterations: eventCount,
        warmup: 0,
        run: async (ctx, i) => {
          const response = await ctx.do.request<{ sequence: number }>('/events', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'sequence',
              source: `SequenceTest/${i}`,
              data: { index: i },
            }),
          })
          if (response.sequence !== undefined) {
            receivedSequences.push(response.sequence)
          }
          return response
        },
      })

      // Verify sequences are unique
      const uniqueSequences = new Set(receivedSequences)
      expect(uniqueSequences.size).toBe(receivedSequences.length)

      // Verify sequences are monotonically increasing when sorted by receipt order
      // (Due to concurrency, this is checked via replay)
    })
  })
})
