/**
 * Activity Benchmarks
 *
 * Performance benchmarks for the Activity primitive in the Temporal compat layer:
 * - Local activity execution (same isolate)
 * - Remote DO activity execution (cross-DO RPC)
 * - Activity heartbeats for long-running tasks
 *
 * Expected Performance Targets:
 * | Operation | Expected |
 * |-----------|----------|
 * | Local activity | <10ms |
 * | Remote DO activity | <50ms |
 * | Heartbeat | <5ms |
 * | Heartbeat check | <2ms |
 *
 * @see @dotdo/compat-temporal for Temporal-compatible implementation (moved to compat repo)
 * @see benchmarks/lib for benchmark runner utilities
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('Activity benchmarks', () => {
  describe('local execution', () => {
    it('execute local activity', async () => {
      const result = await benchmark({
        name: 'activity-local-execute',
        target: 'workflow.perf.do',
        iterations: 200,
        warmup: 20,
        run: async (ctx, iteration) => {
          return ctx.do.request('/activities/execute-local', {
            method: 'POST',
            body: JSON.stringify({
              activityName: 'processItem',
              args: {
                itemId: `item-${iteration}`,
                data: { value: iteration, timestamp: Date.now() },
              },
              options: {
                timeout: 5000,
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- Local Activity Execution ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms target
    })

    it('execute local activity with result', async () => {
      const result = await benchmark({
        name: 'activity-local-with-result',
        target: 'workflow.perf.do',
        iterations: 200,
        warmup: 20,
        run: async (ctx, iteration) => {
          return ctx.do.request('/activities/execute-local', {
            method: 'POST',
            body: JSON.stringify({
              activityName: 'transformData',
              args: {
                input: Array.from({ length: 100 }, (_, i) => ({
                  id: i,
                  value: iteration * i,
                })),
              },
              options: {
                timeout: 10000,
                returnResult: true,
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- Local Activity with Result ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(15) // <15ms with result serialization
    })
  })

  describe('remote execution', () => {
    it('execute remote DO activity', async () => {
      const result = await benchmark({
        name: 'activity-remote-do',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          return ctx.do.request('/activities/execute-remote', {
            method: 'POST',
            body: JSON.stringify({
              activityName: 'remoteProcess',
              targetDO: `worker-${iteration % 10}`,
              args: {
                taskId: `remote-task-${iteration}`,
                payload: { data: 'test', index: iteration },
              },
              options: {
                timeout: 10000,
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- Remote DO Activity Execution ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(50) // <50ms target (includes DO hop)
    })

    it('execute remote DO activity with routing', async () => {
      const result = await benchmark({
        name: 'activity-remote-routed',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          // Route to different DOs based on shard key
          const shardKey = `customer-${iteration % 100}`
          return ctx.do.request('/activities/execute-remote', {
            method: 'POST',
            body: JSON.stringify({
              activityName: 'processCustomerData',
              routing: {
                type: 'shardKey',
                key: shardKey,
              },
              args: {
                customerId: shardKey,
                operation: 'update',
              },
              options: {
                timeout: 15000,
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- Remote DO Activity with Routing ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(50) // <50ms target
    })

    it('execute parallel remote activities', async () => {
      const result = await benchmark({
        name: 'activity-remote-parallel',
        target: 'workflow.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, iteration) => {
          const activities = Array.from({ length: 5 }, (_, i) => ({
            activityName: 'parallelTask',
            targetDO: `worker-${i}`,
            args: { taskIndex: i, batchId: iteration },
          }))

          return ctx.do.request('/activities/execute-parallel', {
            method: 'POST',
            body: JSON.stringify({
              activities,
              options: {
                timeout: 30000,
                failFast: false, // Continue even if some fail
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- Parallel Remote Activities (5 DOs) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(100) // <100ms for 5 parallel
    })
  })

  describe('heartbeat', () => {
    it('heartbeat activity', async () => {
      const activityIds: string[] = []

      const result = await benchmark({
        name: 'activity-heartbeat',
        target: 'workflow.perf.do',
        iterations: 500,
        warmup: 50,
        setup: async (ctx) => {
          // Start long-running activities that need heartbeats
          for (let i = 0; i < 50; i++) {
            const response = await ctx.do.request<{ activityId: string }>('/activities/start-long-running', {
              method: 'POST',
              body: JSON.stringify({
                activityName: 'longRunningTask',
                args: { taskId: `long-${i}` },
                options: {
                  heartbeatTimeout: 30000,
                },
              }),
            })
            activityIds.push(response.activityId)
          }
        },
        run: async (ctx, iteration) => {
          const activityId = activityIds[iteration % activityIds.length]
          return ctx.do.request('/activities/heartbeat', {
            method: 'POST',
            body: JSON.stringify({
              activityId,
              details: {
                progress: (iteration % 100) + '%',
                itemsProcessed: iteration,
                timestamp: Date.now(),
              },
            }),
          })
        },
        teardown: async (ctx) => {
          // Stop all long-running activities
          for (const activityId of activityIds) {
            await ctx.do.request('/activities/cancel', {
              method: 'POST',
              body: JSON.stringify({ activityId }),
            })
          }
        },
      })

      record(result)

      console.log('\n--- Activity Heartbeat ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })

    it('check activity alive status', async () => {
      const activityIds: string[] = []

      const result = await benchmark({
        name: 'activity-alive-check',
        target: 'workflow.perf.do',
        iterations: 500,
        warmup: 50,
        setup: async (ctx) => {
          // Start activities and send initial heartbeats
          for (let i = 0; i < 50; i++) {
            const response = await ctx.do.request<{ activityId: string }>('/activities/start-long-running', {
              method: 'POST',
              body: JSON.stringify({
                activityName: 'checkableTask',
                args: { taskId: `check-${i}` },
              }),
            })
            activityIds.push(response.activityId)

            // Send initial heartbeat
            await ctx.do.request('/activities/heartbeat', {
              method: 'POST',
              body: JSON.stringify({
                activityId: response.activityId,
                details: { started: true },
              }),
            })
          }
        },
        run: async (ctx, iteration) => {
          const activityId = activityIds[iteration % activityIds.length]
          return ctx.do.request(`/activities/is-alive?activityId=${activityId}`)
        },
        teardown: async (ctx) => {
          for (const activityId of activityIds) {
            await ctx.do.request('/activities/cancel', {
              method: 'POST',
              body: JSON.stringify({ activityId }),
            })
          }
        },
      })

      record(result)

      console.log('\n--- Activity Alive Check ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(2) // <2ms target
    })

    it('heartbeat with progress tracking', async () => {
      const activityIds: string[] = []

      const result = await benchmark({
        name: 'activity-heartbeat-progress',
        target: 'workflow.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          for (let i = 0; i < 20; i++) {
            const response = await ctx.do.request<{ activityId: string }>('/activities/start-long-running', {
              method: 'POST',
              body: JSON.stringify({
                activityName: 'progressTask',
                args: { totalItems: 1000 },
              }),
            })
            activityIds.push(response.activityId)
          }
        },
        run: async (ctx, iteration) => {
          const activityId = activityIds[iteration % activityIds.length]
          const progress = (iteration % 100) / 100

          return ctx.do.request('/activities/heartbeat', {
            method: 'POST',
            body: JSON.stringify({
              activityId,
              details: {
                progress,
                itemsProcessed: Math.floor(progress * 1000),
                currentItem: `item-${iteration}`,
                eta: Date.now() + (1 - progress) * 60000,
              },
            }),
          })
        },
        teardown: async (ctx) => {
          for (const activityId of activityIds) {
            await ctx.do.request('/activities/cancel', {
              method: 'POST',
              body: JSON.stringify({ activityId }),
            })
          }
        },
      })

      record(result)

      console.log('\n--- Activity Heartbeat with Progress ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })
  })

  describe('activity deduplication', () => {
    it('deduplicate repeated activity calls', async () => {
      const result = await benchmark({
        name: 'activity-dedup',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          // Same idempotency key should return cached result
          const idempotencyKey = `dedup-key-${iteration % 10}`
          return ctx.do.request('/activities/execute-local', {
            method: 'POST',
            body: JSON.stringify({
              activityName: 'idempotentTask',
              args: { key: idempotencyKey },
              options: {
                idempotencyKey,
                dedup: true,
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- Activity Deduplication ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms (may hit cache)
    })
  })

  describe('summary', () => {
    it('should report activity benchmark targets', () => {
      console.log('\n========================================')
      console.log('ACTIVITY BENCHMARK SUMMARY')
      console.log('========================================\n')

      console.log('Performance Targets:')
      console.log('  | Operation | Target |')
      console.log('  |-----------|--------|')
      console.log('  | Local execute | <10ms |')
      console.log('  | Local with result | <15ms |')
      console.log('  | Remote DO | <50ms |')
      console.log('  | Remote routed | <50ms |')
      console.log('  | Parallel 5 | <100ms |')
      console.log('  | Heartbeat | <5ms |')
      console.log('  | Alive check | <2ms |')
      console.log('  | Deduplication | <10ms |')
      console.log('')

      console.log('Activity Types:')
      console.log('  - Local: Execute in same V8 isolate')
      console.log('  - Remote: Cross-DO RPC via stub')
      console.log('  - Parallel: Fan-out to multiple DOs')
      console.log('')

      console.log('Activity Features:')
      console.log('  - Heartbeat for long-running tasks')
      console.log('  - Automatic timeout handling')
      console.log('  - Idempotency / deduplication')
      console.log('  - Routing by shard key')
      console.log('  - Progress tracking')
      console.log('')

      expect(true).toBe(true)
    })
  })
})
