/**
 * Workflow Benchmarks
 *
 * Performance benchmarks for the Workflow Durable Object primitive
 * (Temporal compat layer):
 * - DAG execution (single task, parallel fan-out)
 * - DAG creation with dependencies
 * - Run status checking
 * - Retry policies (fixed, exponential)
 * - Scheduling (CRON triggers)
 * - Sensors (cross-DAG coordination)
 * - State persistence (save, load, replay)
 *
 * Expected Performance Targets:
 * | Operation | Expected |
 * |-----------|----------|
 * | Single task | <20ms |
 * | Parallel 10 tasks | <100ms |
 * | Create DAG | <10ms |
 * | Save state | <10ms |
 * | Load state | <5ms |
 * | Replay checkpoint | <20ms |
 *
 * @see @dotdo/compat-temporal for Temporal-compatible implementations (moved to compat repo)
 * @see benchmarks/lib for benchmark runner utilities
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('Workflow benchmarks', () => {
  describe('DAG execution', () => {
    it('execute single task', async () => {
      const result = await benchmark({
        name: 'workflow-task-single',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.request('/workflows/execute', {
            method: 'POST',
            body: JSON.stringify({ taskId: 'simple-task', handler: 'echo' }),
          })
        },
      })

      record(result)

      console.log('\n--- Workflow Single Task Execution ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(20) // <20ms target
    })

    it('execute parallel tasks (fan-out 10)', async () => {
      const result = await benchmark({
        name: 'workflow-parallel-10',
        target: 'workflow.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, iteration) => {
          const tasks = Array.from({ length: 10 }, (_, i) => ({
            taskId: `parallel-${iteration}-${i}`,
            handler: 'process',
            args: { index: i },
          }))

          return ctx.do.request('/workflows/execute-parallel', {
            method: 'POST',
            body: JSON.stringify({ tasks }),
          })
        },
      })

      record(result)

      console.log('\n--- Workflow Parallel 10 Tasks (Fan-Out) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(100) // <100ms target for 10 parallel
    })

    it('create DAG with dependencies', async () => {
      const result = await benchmark({
        name: 'workflow-create-dag',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          // ETL-style DAG: extract -> transform1, transform2 -> load -> validate
          const dag = {
            id: `dag-${iteration}`,
            tasks: [
              { id: 'extract', handler: 'extract', deps: [] },
              { id: 'transform1', handler: 'transform', deps: ['extract'] },
              { id: 'transform2', handler: 'transform', deps: ['extract'] },
              { id: 'load', handler: 'load', deps: ['transform1', 'transform2'] },
              { id: 'validate', handler: 'validate', deps: ['load'] },
            ],
          }

          return ctx.do.request('/workflows/dag/create', {
            method: 'POST',
            body: JSON.stringify(dag),
          })
        },
      })

      record(result)

      console.log('\n--- Workflow Create DAG with Dependencies ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms target
    })

    it('start and check DAG run status', async () => {
      // Setup: Create DAGs to check status of
      const dagIds: string[] = []

      const result = await benchmark({
        name: 'workflow-dag-status',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create and start multiple DAGs
          for (let i = 0; i < 20; i++) {
            const response = await ctx.do.request<{ dagId: string }>('/workflows/dag/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `status-dag-${i}`,
                tasks: [
                  { id: 'task1', handler: 'process', deps: [] },
                  { id: 'task2', handler: 'process', deps: ['task1'] },
                ],
              }),
            })
            dagIds.push(response.dagId)

            // Start some DAGs
            if (i % 2 === 0) {
              await ctx.do.request('/workflows/dag/start', {
                method: 'POST',
                body: JSON.stringify({ dagId: response.dagId }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const dagId = dagIds[iteration % dagIds.length]
          return ctx.do.request(`/workflows/dag/status?dagId=${dagId}`)
        },
        teardown: async (ctx) => {
          // Clean up DAGs
          await ctx.do.request('/workflows/dag/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Workflow DAG Status Check ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms target
    })
  })

  describe('retry policies', () => {
    it('fixed backoff retry', async () => {
      const result = await benchmark({
        name: 'workflow-retry-fixed',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          return ctx.do.request('/workflows/retry/execute', {
            method: 'POST',
            body: JSON.stringify({
              taskId: `retry-fixed-${iteration}`,
              handler: 'transient-fail',
              retryPolicy: {
                type: 'fixed',
                maxAttempts: 3,
                delayMs: 100,
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- Workflow Fixed Backoff Retry ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(50) // <50ms target (includes retry logic)
    })

    it('exponential backoff with jitter', async () => {
      const result = await benchmark({
        name: 'workflow-retry-exponential',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          return ctx.do.request('/workflows/retry/execute', {
            method: 'POST',
            body: JSON.stringify({
              taskId: `retry-exp-${iteration}`,
              handler: 'transient-fail',
              retryPolicy: {
                type: 'exponential',
                maxAttempts: 5,
                initialDelayMs: 50,
                maxDelayMs: 1000,
                multiplier: 2,
                jitter: true,
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- Workflow Exponential Backoff with Jitter ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(50) // <50ms target
    })
  })

  describe('scheduling', () => {
    it('schedule CRON trigger', async () => {
      const result = await benchmark({
        name: 'workflow-schedule-cron',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          return ctx.do.request('/workflows/schedule/register', {
            method: 'POST',
            body: JSON.stringify({
              id: `schedule-${iteration}`,
              cron: '*/5 * * * *', // Every 5 minutes
              handler: 'processQueue',
              args: { batchSize: 100 },
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/schedule/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Workflow Schedule CRON Trigger ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms target
    })

    it('get next trigger time', async () => {
      const scheduleIds: string[] = []

      const result = await benchmark({
        name: 'workflow-schedule-next',
        target: 'workflow.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          // Register various CRON schedules
          const expressions = [
            '* * * * *', // Every minute
            '*/5 * * * *', // Every 5 minutes
            '0 * * * *', // Hourly
            '0 0 * * *', // Daily
            '0 0 * * 0', // Weekly
          ]

          for (let i = 0; i < expressions.length; i++) {
            const response = await ctx.do.request<{ scheduleId: string }>('/workflows/schedule/register', {
              method: 'POST',
              body: JSON.stringify({
                id: `next-${i}`,
                cron: expressions[i],
                handler: `handler-${i}`,
              }),
            })
            scheduleIds.push(response.scheduleId)
          }
        },
        run: async (ctx, iteration) => {
          const scheduleId = scheduleIds[iteration % scheduleIds.length]
          return ctx.do.request(`/workflows/schedule/next?scheduleId=${scheduleId}`)
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/schedule/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Workflow Get Next Trigger Time ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })
  })

  describe('sensors', () => {
    it('create cross-DAG sensor', async () => {
      const result = await benchmark({
        name: 'workflow-sensor-create',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          return ctx.do.request('/workflows/sensor/create', {
            method: 'POST',
            body: JSON.stringify({
              id: `sensor-${iteration}`,
              type: 'dag_completed',
              target: `upstream-dag-${iteration % 10}`,
              timeout: 60000,
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/sensor/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Workflow Create Cross-DAG Sensor ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms target
    })

    it('check sensor condition', async () => {
      const sensorIds: string[] = []

      const result = await benchmark({
        name: 'workflow-sensor-check',
        target: 'workflow.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          // Create sensors to check
          for (let i = 0; i < 20; i++) {
            const response = await ctx.do.request<{ sensorId: string }>('/workflows/sensor/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `check-sensor-${i}`,
                type: 'dag_completed',
                target: `dag-${i}`,
                timeout: 60000,
              }),
            })
            sensorIds.push(response.sensorId)
          }
        },
        run: async (ctx, iteration) => {
          const sensorId = sensorIds[iteration % sensorIds.length]
          return ctx.do.request(`/workflows/sensor/check?sensorId=${sensorId}`)
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/sensor/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Workflow Check Sensor Condition ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })
  })

  describe('state persistence', () => {
    it('save workflow state', async () => {
      const result = await benchmark({
        name: 'workflow-state-save',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          return ctx.do.request('/workflows/state/save', {
            method: 'POST',
            body: JSON.stringify({
              workflowId: `workflow-${iteration}`,
              runId: `run-${iteration}`,
              state: {
                status: 'running',
                currentStep: iteration % 10,
                variables: {
                  counter: iteration,
                  data: { items: Array.from({ length: 10 }, (_, i) => i * iteration) },
                },
                history: Array.from({ length: iteration % 50 }, (_, i) => ({
                  eventId: i,
                  eventType: 'ACTIVITY_COMPLETED',
                  timestamp: Date.now() - i * 1000,
                })),
              },
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/state/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Workflow Save State ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms target
    })

    it('load workflow state', async () => {
      const workflowIds: string[] = []

      const result = await benchmark({
        name: 'workflow-state-load',
        target: 'workflow.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          // Seed workflow states
          for (let i = 0; i < 50; i++) {
            await ctx.do.request('/workflows/state/save', {
              method: 'POST',
              body: JSON.stringify({
                workflowId: `load-workflow-${i}`,
                runId: `run-1`,
                state: {
                  status: i % 2 === 0 ? 'running' : 'completed',
                  currentStep: i,
                  variables: { index: i, data: { value: i * 10 } },
                },
              }),
            })
            workflowIds.push(`load-workflow-${i}`)
          }
        },
        run: async (ctx, iteration) => {
          const workflowId = workflowIds[iteration % workflowIds.length]
          return ctx.do.request(`/workflows/state/load?workflowId=${workflowId}&runId=run-1`)
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/state/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Workflow Load State ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })

    it('replay from checkpoint', async () => {
      const checkpointIds: Array<{ workflowId: string; checkpointId: string }> = []

      const result = await benchmark({
        name: 'workflow-state-replay',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create workflows with checkpoints
          for (let i = 0; i < 20; i++) {
            // Save initial state
            await ctx.do.request('/workflows/state/save', {
              method: 'POST',
              body: JSON.stringify({
                workflowId: `replay-workflow-${i}`,
                runId: 'run-1',
                state: {
                  status: 'running',
                  currentStep: 0,
                  variables: { index: i },
                },
              }),
            })

            // Create multiple checkpoints
            for (let j = 0; j < 5; j++) {
              await ctx.do.request('/workflows/state/checkpoint', {
                method: 'POST',
                body: JSON.stringify({
                  workflowId: `replay-workflow-${i}`,
                  runId: 'run-1',
                  checkpointId: `checkpoint-${j}`,
                  data: { step: j, accumulated: j * 10 },
                }),
              })
              checkpointIds.push({
                workflowId: `replay-workflow-${i}`,
                checkpointId: `checkpoint-${j}`,
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const { workflowId, checkpointId } = checkpointIds[iteration % checkpointIds.length]!
          return ctx.do.request('/workflows/state/replay', {
            method: 'POST',
            body: JSON.stringify({
              workflowId,
              runId: 'run-1',
              checkpointId,
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/state/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Workflow Replay from Checkpoint ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(20) // <20ms target
    })
  })

  describe('summary', () => {
    it('should report workflow benchmark targets', () => {
      console.log('\n========================================')
      console.log('WORKFLOW BENCHMARK SUMMARY')
      console.log('========================================\n')

      console.log('Performance Targets:')
      console.log('  | Operation | Target |')
      console.log('  |-----------|--------|')
      console.log('  | Single task | <20ms |')
      console.log('  | Parallel 10 tasks | <100ms |')
      console.log('  | Create DAG | <10ms |')
      console.log('  | DAG status | <10ms |')
      console.log('  | Save state | <10ms |')
      console.log('  | Load state | <5ms |')
      console.log('  | Replay checkpoint | <20ms |')
      console.log('  | Fixed retry | <50ms |')
      console.log('  | Exp retry | <50ms |')
      console.log('  | Schedule CRON | <10ms |')
      console.log('  | Next trigger | <5ms |')
      console.log('  | Create sensor | <10ms |')
      console.log('  | Check sensor | <5ms |')
      console.log('')

      console.log('Workflow Operations:')
      console.log('  - Task execution: O(1) dispatch')
      console.log('  - Parallel execution: O(n) concurrent, O(1) fan-out')
      console.log('  - DAG creation: O(tasks) dependency graph build')
      console.log('  - State save: O(state_size) serialization')
      console.log('  - Checkpoint: O(checkpoint_size) persistence')
      console.log('  - Replay: O(history_size) reconstruction')
      console.log('')

      console.log('Temporal Compat Features:')
      console.log('  - Activity deduplication')
      console.log('  - Workflow history store')
      console.log('  - Timer management')
      console.log('  - Deadline handling')
      console.log('  - Signal/Query primitives')
      console.log('')

      expect(true).toBe(true)
    })
  })
})
