/**
 * Timer Benchmarks
 *
 * Performance benchmarks for the Timer primitive in the Temporal compat layer:
 * - Create timer
 * - Cancel timer
 * - Check timer status
 * - Timer fire detection
 *
 * Expected Performance Targets:
 * | Operation | Expected |
 * |-----------|----------|
 * | Create timer | <5ms |
 * | Cancel timer | <5ms |
 * | Check timer | <2ms |
 * | List timers | <5ms |
 *
 * @see workflows/compat/temporal/timers.ts for implementation
 * @see benchmarks/lib for benchmark runner utilities
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('Timer benchmarks', () => {
  describe('create timer', () => {
    it('create timer', async () => {
      const result = await benchmark({
        name: 'timer-create',
        target: 'workflow.perf.do',
        iterations: 200,
        warmup: 20,
        run: async (ctx, iteration) => {
          return ctx.do.request('/timers/create', {
            method: 'POST',
            body: JSON.stringify({
              id: `timer-${iteration}`,
              durationMs: 5000 + (iteration % 10) * 1000, // 5-14 seconds
              callback: 'onTimeout',
              data: {
                iteration,
                created: Date.now(),
              },
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Create Timer ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })

    it('create timer with workflow context', async () => {
      const workflowIds: string[] = []

      const result = await benchmark({
        name: 'timer-create-workflow',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create workflows to attach timers to
          for (let i = 0; i < 20; i++) {
            const response = await ctx.do.request<{ workflowId: string }>('/workflows/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `timer-workflow-${i}`,
                handler: 'timerHandler',
              }),
            })
            workflowIds.push(response.workflowId)
          }
        },
        run: async (ctx, iteration) => {
          const workflowId = workflowIds[iteration % workflowIds.length]
          return ctx.do.request('/timers/create', {
            method: 'POST',
            body: JSON.stringify({
              id: `wf-timer-${iteration}`,
              workflowId,
              durationMs: 10000,
              callback: 'workflowTimeout',
              data: { step: iteration % 10 },
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
          await ctx.do.request('/workflows/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Create Timer with Workflow Context ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })

    it('create multiple timers rapidly', async () => {
      const result = await benchmark({
        name: 'timer-create-burst',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          // Create 5 timers per iteration
          const timers = Array.from({ length: 5 }, (_, i) => ({
            id: `burst-timer-${iteration}-${i}`,
            durationMs: 1000 * (i + 1),
            callback: `callback-${i}`,
          }))

          return ctx.do.request('/timers/create-batch', {
            method: 'POST',
            body: JSON.stringify({ timers }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Create Timer Burst (5 per iteration) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms for batch of 5
    })
  })

  describe('cancel timer', () => {
    it('cancel timer', async () => {
      const timerIds: string[] = []

      const result = await benchmark({
        name: 'timer-cancel',
        target: 'workflow.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          // Create timers to cancel
          for (let i = 0; i < 300; i++) {
            const response = await ctx.do.request<{ timerId: string }>('/timers/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `cancel-timer-${i}`,
                durationMs: 60000, // Long duration so they don't fire
                callback: 'onCancel',
              }),
            })
            timerIds.push(response.timerId)
          }
        },
        run: async (ctx, iteration) => {
          // Cancel timer and recreate for next iteration
          const timerId = timerIds[iteration % timerIds.length]
          const cancelResult = await ctx.do.request('/timers/cancel', {
            method: 'POST',
            body: JSON.stringify({ timerId }),
          })

          // Recreate for subsequent iterations
          await ctx.do.request('/timers/create', {
            method: 'POST',
            body: JSON.stringify({
              id: timerId,
              durationMs: 60000,
              callback: 'onCancel',
            }),
          })

          return cancelResult
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Cancel Timer ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })

    it('cancel non-existent timer (no-op)', async () => {
      const result = await benchmark({
        name: 'timer-cancel-noop',
        target: 'workflow.perf.do',
        iterations: 200,
        warmup: 20,
        run: async (ctx, iteration) => {
          // Try to cancel a timer that doesn't exist
          return ctx.do.request('/timers/cancel', {
            method: 'POST',
            body: JSON.stringify({
              timerId: `nonexistent-timer-${iteration}`,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- Cancel Non-existent Timer (No-op) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(3) // <3ms for no-op
    })

    it('cancel batch of timers', async () => {
      const timerBatches: string[][] = []

      const result = await benchmark({
        name: 'timer-cancel-batch',
        target: 'workflow.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create batches of timers
          for (let batch = 0; batch < 60; batch++) {
            const batchTimerIds: string[] = []
            for (let i = 0; i < 5; i++) {
              const response = await ctx.do.request<{ timerId: string }>('/timers/create', {
                method: 'POST',
                body: JSON.stringify({
                  id: `batch-cancel-${batch}-${i}`,
                  durationMs: 60000,
                  callback: 'onBatchCancel',
                }),
              })
              batchTimerIds.push(response.timerId)
            }
            timerBatches.push(batchTimerIds)
          }
        },
        run: async (ctx, iteration) => {
          const batch = timerBatches[iteration % timerBatches.length]!
          const cancelResult = await ctx.do.request('/timers/cancel-batch', {
            method: 'POST',
            body: JSON.stringify({ timerIds: batch }),
          })

          // Recreate for subsequent iterations
          for (const timerId of batch) {
            await ctx.do.request('/timers/create', {
              method: 'POST',
              body: JSON.stringify({
                id: timerId,
                durationMs: 60000,
                callback: 'onBatchCancel',
              }),
            })
          }

          return cancelResult
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Cancel Batch of Timers (5) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms for batch of 5
    })
  })

  describe('check timer', () => {
    it('check timer status', async () => {
      const timerIds: string[] = []

      const result = await benchmark({
        name: 'timer-check-status',
        target: 'workflow.perf.do',
        iterations: 500,
        warmup: 50,
        setup: async (ctx) => {
          // Create timers with various durations
          for (let i = 0; i < 50; i++) {
            const response = await ctx.do.request<{ timerId: string }>('/timers/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `check-timer-${i}`,
                durationMs: i * 100, // 0-5 seconds
                callback: 'onCheck',
              }),
            })
            timerIds.push(response.timerId)
          }
        },
        run: async (ctx, iteration) => {
          const timerId = timerIds[iteration % timerIds.length]
          return ctx.do.request(`/timers/status?timerId=${timerId}`)
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Check Timer Status ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(2) // <2ms target
    })

    it('check if timer fired', async () => {
      const timerIds: string[] = []

      const result = await benchmark({
        name: 'timer-check-fired',
        target: 'workflow.perf.do',
        iterations: 500,
        warmup: 50,
        setup: async (ctx) => {
          // Create timers - some with 0ms (already fired), some with long duration
          for (let i = 0; i < 50; i++) {
            const response = await ctx.do.request<{ timerId: string }>('/timers/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `fired-timer-${i}`,
                durationMs: i % 2 === 0 ? 0 : 60000, // Alternating fired/pending
                callback: 'onFire',
              }),
            })
            timerIds.push(response.timerId)
          }
        },
        run: async (ctx, iteration) => {
          const timerId = timerIds[iteration % timerIds.length]
          return ctx.do.request(`/timers/fired?timerId=${timerId}`)
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Check Timer Fired ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(2) // <2ms target
    })

    it('get remaining time', async () => {
      const timerIds: string[] = []

      const result = await benchmark({
        name: 'timer-remaining',
        target: 'workflow.perf.do',
        iterations: 300,
        warmup: 30,
        setup: async (ctx) => {
          // Create timers with known durations
          for (let i = 0; i < 30; i++) {
            const response = await ctx.do.request<{ timerId: string }>('/timers/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `remaining-timer-${i}`,
                durationMs: 30000 + i * 1000, // 30-60 seconds
                callback: 'onRemaining',
              }),
            })
            timerIds.push(response.timerId)
          }
        },
        run: async (ctx, iteration) => {
          const timerId = timerIds[iteration % timerIds.length]
          return ctx.do.request(`/timers/remaining?timerId=${timerId}`)
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Get Timer Remaining Time ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(2) // <2ms target
    })
  })

  describe('list timers', () => {
    it('list all timers', async () => {
      const result = await benchmark({
        name: 'timer-list-all',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create many timers
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/timers/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `list-timer-${i}`,
                durationMs: 60000,
                callback: 'onList',
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.request('/timers/list')
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- List All Timers (100 timers) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms for 100 timers
    })

    it('list pending timers', async () => {
      const result = await benchmark({
        name: 'timer-list-pending',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create mix of fired and pending timers
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/timers/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `pending-list-${i}`,
                durationMs: i % 2 === 0 ? 0 : 60000, // Half fired, half pending
                callback: 'onPendingList',
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.request('/timers/list?status=pending')
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- List Pending Timers (50 pending) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })

    it('list timers for workflow', async () => {
      const workflowIds: string[] = []

      const result = await benchmark({
        name: 'timer-list-workflow',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create workflows and attach timers
          for (let i = 0; i < 10; i++) {
            const response = await ctx.do.request<{ workflowId: string }>('/workflows/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `timer-list-wf-${i}`,
                handler: 'timerListHandler',
              }),
            })
            workflowIds.push(response.workflowId)

            // Add timers to each workflow
            for (let j = 0; j < 10; j++) {
              await ctx.do.request('/timers/create', {
                method: 'POST',
                body: JSON.stringify({
                  id: `wf-${i}-timer-${j}`,
                  workflowId: response.workflowId,
                  durationMs: 60000,
                  callback: 'workflowTimer',
                }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const workflowId = workflowIds[iteration % workflowIds.length]
          return ctx.do.request(`/timers/list?workflowId=${workflowId}`)
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
          await ctx.do.request('/workflows/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- List Timers for Workflow (10 timers each) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })
  })

  describe('timer deadlines', () => {
    it('check deadline exceeded', async () => {
      const timerIds: string[] = []

      const result = await benchmark({
        name: 'timer-deadline-check',
        target: 'workflow.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          // Create timers with deadlines (some exceeded, some not)
          const now = Date.now()
          for (let i = 0; i < 40; i++) {
            const response = await ctx.do.request<{ timerId: string }>('/timers/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `deadline-timer-${i}`,
                deadline: i % 2 === 0 ? now - 1000 : now + 60000, // Alternating
                callback: 'onDeadline',
                isDeadline: true,
              }),
            })
            timerIds.push(response.timerId)
          }
        },
        run: async (ctx, iteration) => {
          const timerId = timerIds[iteration % timerIds.length]
          return ctx.do.request(`/timers/deadline-exceeded?timerId=${timerId}`)
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Check Deadline Exceeded ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(2) // <2ms target
    })

    it('get approaching deadlines', async () => {
      const result = await benchmark({
        name: 'timer-approaching-deadlines',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const now = Date.now()
          // Create timers with various deadlines
          for (let i = 0; i < 50; i++) {
            await ctx.do.request('/timers/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `approaching-${i}`,
                deadline: now + i * 1000, // 0-50 seconds in future
                callback: 'onApproaching',
                isDeadline: true,
              }),
            })
          }
        },
        run: async (ctx) => {
          // Get deadlines within next 30 seconds
          return ctx.do.request('/timers/approaching?withinMs=30000')
        },
        teardown: async (ctx) => {
          await ctx.do.request('/timers/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Get Approaching Deadlines (within 30s) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })
  })

  describe('summary', () => {
    it('should report timer benchmark targets', () => {
      console.log('\n========================================')
      console.log('TIMER BENCHMARK SUMMARY')
      console.log('========================================\n')

      console.log('Performance Targets:')
      console.log('  | Operation | Target |')
      console.log('  |-----------|--------|')
      console.log('  | Create timer | <5ms |')
      console.log('  | Create with workflow | <5ms |')
      console.log('  | Create burst (5) | <10ms |')
      console.log('  | Cancel timer | <5ms |')
      console.log('  | Cancel batch (5) | <10ms |')
      console.log('  | Check status | <2ms |')
      console.log('  | Check fired | <2ms |')
      console.log('  | Get remaining | <2ms |')
      console.log('  | List all (100) | <10ms |')
      console.log('  | List pending | <5ms |')
      console.log('  | Deadline check | <2ms |')
      console.log('')

      console.log('Timer Operations:')
      console.log('  - Create: O(1) insert into timer heap')
      console.log('  - Cancel: O(log n) heap operation')
      console.log('  - Check: O(1) lookup')
      console.log('  - List: O(n) scan')
      console.log('  - Fire: O(log n) heap extract')
      console.log('')

      console.log('Timer Features:')
      console.log('  - Durable (survives DO restarts)')
      console.log('  - Workflow-scoped timers')
      console.log('  - Deadline management')
      console.log('  - Batch operations')
      console.log('  - Fire detection')
      console.log('')

      console.log('Timer Types:')
      console.log('  - Duration: Fire after X ms')
      console.log('  - Deadline: Fire at specific timestamp')
      console.log('  - Recurring: Fire repeatedly (via CRON)')
      console.log('')

      expect(true).toBe(true)
    })
  })
})
