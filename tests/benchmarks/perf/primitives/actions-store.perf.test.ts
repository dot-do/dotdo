/**
 * ActionsStore Performance Benchmarks
 *
 * Tests action logging and lifecycle operations:
 * - log action: Record a new action
 * - list by target: Query actions for a target
 * - complete action: Mark action as completed
 * - fail action: Mark action as failed
 *
 * Target: All operations should be sub-10ms for simple operations
 *
 * @see db/stores.ts for ActionsStore implementation
 * @see dotdo-hn07m for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('ActionsStore benchmarks', () => {
  describe('log action operations', () => {
    it('log action', async () => {
      const result = await benchmark({
        name: 'actions-log',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/actions', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'create',
              target: `Thing/${i}`,
              actor: 'User/benchmark',
              input: { data: `test-${i}` },
              durability: 'try',
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeGreaterThan(0)

      // Sub-10ms target for action logging
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('log action with durability levels', async () => {
      const durabilities: Array<'send' | 'try' | 'do'> = ['send', 'try', 'do']

      for (const durability of durabilities) {
        const result = await benchmark({
          name: `actions-log-${durability}`,
          target: 'stores.perf.do',
          iterations: 50,
          warmup: 5,
          run: async (ctx, i) => {
            return ctx.do.request('/actions', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'process',
                target: `Item/${durability}-${i}`,
                actor: 'System/worker',
                input: { level: durability },
                durability,
              }),
            })
          },
        })

        record(result)

        expect(result.samples.length).toBe(50)
        // All durability levels should be sub-15ms
        expect(result.stats.p50).toBeLessThan(15)
      }
    })

    it('log action with workflow context', async () => {
      const result = await benchmark({
        name: 'actions-log-workflow',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          return ctx.do.request('/actions', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'step',
              target: `Workflow/${i}`,
              actor: 'Workflow/orchestrator',
              input: { stepIndex: i, payload: 'test' },
              durability: 'do',
              requestId: `req-${i}`,
              sessionId: `session-${Math.floor(i / 10)}`,
              workflowId: `workflow-${Math.floor(i / 5)}`,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Workflow context should not add significant overhead
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('log action with large input', async () => {
      const result = await benchmark({
        name: 'actions-log-large-input',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const largeInput = {
            items: Array.from({ length: 100 }, (_, j) => ({
              id: `item-${j}`,
              name: `Item ${j}`,
              properties: { a: 1, b: 2, c: 3 },
            })),
            metadata: Object.fromEntries(
              Array.from({ length: 50 }, (_, j) => [`key-${j}`, `value-${j}`])
            ),
          }

          return ctx.do.request('/actions', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'bulkProcess',
              target: `Batch/${i}`,
              actor: 'System/batch-processor',
              input: largeInput,
              durability: 'do',
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Large payloads may be slower but still sub-50ms
      expect(result.stats.p50).toBeLessThan(50)
    })
  })

  describe('list by target operations', () => {
    it('list by target', async () => {
      let targetId: string

      const result = await benchmark({
        name: 'actions-list-by-target',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          targetId = `Thing/action-target`
          // Create 20 actions for the target
          for (let i = 0; i < 20; i++) {
            await ctx.do.request('/actions', {
              method: 'POST',
              body: JSON.stringify({
                verb: ['create', 'update', 'delete'][i % 3],
                target: targetId,
                actor: `User/actor-${i % 5}`,
                input: { index: i },
                durability: 'try',
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list(`/actions?target=${encodeURIComponent(targetId)}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // List by target should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('list by actor', async () => {
      let actorId: string

      const result = await benchmark({
        name: 'actions-list-by-actor',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          actorId = `User/prolific-actor`
          // Create 30 actions by the actor
          for (let i = 0; i < 30; i++) {
            await ctx.do.request('/actions', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'action',
                target: `Target/${i}`,
                actor: actorId,
                input: { index: i },
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list(`/actions?actor=${encodeURIComponent(actorId)}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // List by actor should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('list by status', async () => {
      const result = await benchmark({
        name: 'actions-list-by-status',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const statuses = ['pending', 'running', 'completed', 'failed']
          return ctx.do.list(`/actions?status=${statuses[i % statuses.length]}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Status filter should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('list by verb', async () => {
      const result = await benchmark({
        name: 'actions-list-by-verb',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const verbs = ['create', 'update', 'delete', 'process', 'notify']
          return ctx.do.list(`/actions?verb=${verbs[i % verbs.length]}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Verb filter should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })
  })

  describe('complete/fail action operations', () => {
    it('complete action', async () => {
      let actionIds: string[] = []

      const result = await benchmark({
        name: 'actions-complete',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create pending actions
          for (let i = 0; i < 100; i++) {
            const response = await ctx.do.request<{ id: string }>('/actions', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'process',
                target: `Item/${i}`,
                actor: 'Worker/benchmark',
                durability: 'try',
              }),
            })
            actionIds.push(response.id)
          }
        },
        run: async (ctx, i) => {
          if (i < actionIds.length) {
            return ctx.do.request(`/actions/${actionIds[i]}/complete`, {
              method: 'POST',
              body: JSON.stringify({
                output: { result: 'success', processedAt: Date.now() },
              }),
            })
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Complete action should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('fail action', async () => {
      let actionIds: string[] = []

      const result = await benchmark({
        name: 'actions-fail',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create pending actions
          for (let i = 0; i < 100; i++) {
            const response = await ctx.do.request<{ id: string }>('/actions', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'risky',
                target: `Item/${i}`,
                actor: 'Worker/benchmark',
                durability: 'do',
              }),
            })
            actionIds.push(response.id)
          }
        },
        run: async (ctx, i) => {
          if (i < actionIds.length) {
            return ctx.do.request(`/actions/${actionIds[i]}/fail`, {
              method: 'POST',
              body: JSON.stringify({
                error: {
                  message: 'Simulated failure for benchmark',
                  code: 'BENCHMARK_ERROR',
                  stack: 'Error: Simulated failure\n    at benchmark',
                },
              }),
            })
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Fail action should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('action lifecycle: create -> start -> complete', async () => {
      const result = await benchmark({
        name: 'actions-lifecycle',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          // Create
          const action = await ctx.do.request<{ id: string }>('/actions', {
            method: 'POST',
            body: JSON.stringify({
              verb: 'fullLifecycle',
              target: `Item/${i}`,
              actor: 'Worker/lifecycle',
              durability: 'do',
            }),
          })

          // Start
          await ctx.do.request(`/actions/${action.id}/start`, {
            method: 'POST',
          })

          // Complete
          await ctx.do.request(`/actions/${action.id}/complete`, {
            method: 'POST',
            body: JSON.stringify({
              output: { completed: true },
            }),
          })

          return action
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Full lifecycle should be sub-30ms (3 operations)
      expect(result.stats.p50).toBeLessThan(30)
    })
  })

  describe('retry operations', () => {
    it('retry action', async () => {
      let actionIds: string[] = []

      const result = await benchmark({
        name: 'actions-retry',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create failed actions
          for (let i = 0; i < 50; i++) {
            const response = await ctx.do.request<{ id: string }>('/actions', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'retryable',
                target: `Item/${i}`,
                actor: 'Worker/benchmark',
                durability: 'do',
              }),
            })
            // Mark as failed
            await ctx.do.request(`/actions/${response.id}/fail`, {
              method: 'POST',
              body: JSON.stringify({ error: { message: 'Initial failure' } }),
            })
            actionIds.push(response.id)
          }
        },
        run: async (ctx, i) => {
          if (i < actionIds.length) {
            return ctx.do.request(`/actions/${actionIds[i]}/retry`, {
              method: 'POST',
            })
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Retry should be sub-15ms
      expect(result.stats.p50).toBeLessThan(15)
    })
  })

  describe('get action operations', () => {
    it('get action by ID', async () => {
      let actionIds: string[] = []

      const result = await benchmark({
        name: 'actions-get',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create actions
          for (let i = 0; i < 100; i++) {
            const response = await ctx.do.request<{ id: string }>('/actions', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'lookup',
                target: `Item/${i}`,
                actor: 'Worker/benchmark',
              }),
            })
            actionIds.push(response.id)
          }
        },
        run: async (ctx, i) => {
          return ctx.do.get(`/actions/${actionIds[i % actionIds.length]}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Get by ID should be very fast (sub-5ms)
      expect(result.stats.p50).toBeLessThan(5)
    })
  })

  describe('throughput', () => {
    it('action logging throughput', async () => {
      const batchSize = 20

      const result = await benchmark({
        name: 'actions-throughput',
        target: 'stores.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx, i) => {
          // Log multiple actions sequentially
          for (let j = 0; j < batchSize; j++) {
            await ctx.do.request('/actions', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'throughput',
                target: `Item/${i * batchSize + j}`,
                actor: 'Worker/throughput',
              }),
            })
          }
        },
      })

      record(result)

      // Calculate throughput
      const avgMs = result.stats.mean
      const throughput = (batchSize * 1000) / avgMs // actions per second

      // Should achieve at least 200 actions/sec
      expect(throughput).toBeGreaterThan(200)
    })
  })

  describe('concurrency', () => {
    it('handles concurrent action logging', async () => {
      const concurrency = 5
      const iterationsPerWorker = 20

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `actions-concurrent-${workerIndex}`,
            target: 'stores.perf.do',
            iterations: iterationsPerWorker,
            warmup: 2,
            run: async (ctx, i) => {
              return ctx.do.request('/actions', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'concurrent',
                  target: `Worker/${workerIndex}/Item/${i}`,
                  actor: `Worker/${workerIndex}`,
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
  })
})
