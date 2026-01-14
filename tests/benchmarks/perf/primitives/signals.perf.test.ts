/**
 * Signal Benchmarks
 *
 * Performance benchmarks for the Signal primitive in the Temporal compat layer:
 * - Send signal to workflow
 * - Wait for signal
 * - Signal buffering and retrieval
 * - Cross-workflow signaling
 *
 * Expected Performance Targets:
 * | Operation | Expected |
 * |-----------|----------|
 * | Send signal | <5ms |
 * | Wait for signal | <10ms |
 * | Get pending signals | <5ms |
 * | Cross-workflow signal | <20ms |
 *
 * @see @dotdo/compat-temporal for Temporal-compatible implementation (moved to compat repo)
 * @see benchmarks/lib for benchmark runner utilities
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('Signal benchmarks', () => {
  describe('send signal', () => {
    it('send signal to workflow', async () => {
      const workflowIds: string[] = []

      const result = await benchmark({
        name: 'signal-send',
        target: 'workflow.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          // Create workflows to receive signals
          for (let i = 0; i < 20; i++) {
            const response = await ctx.do.request<{ workflowId: string }>('/workflows/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `signal-workflow-${i}`,
                handler: 'signalHandler',
              }),
            })
            workflowIds.push(response.workflowId)
          }
        },
        run: async (ctx, iteration) => {
          const workflowId = workflowIds[iteration % workflowIds.length]
          return ctx.do.request('/signals/send', {
            method: 'POST',
            body: JSON.stringify({
              workflowId,
              signalName: 'dataReady',
              data: {
                batch: iteration,
                timestamp: Date.now(),
                payload: { items: [1, 2, 3, 4, 5] },
              },
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Send Signal to Workflow ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })

    it('send signal with large payload', async () => {
      const workflowIds: string[] = []

      const result = await benchmark({
        name: 'signal-send-large',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          for (let i = 0; i < 10; i++) {
            const response = await ctx.do.request<{ workflowId: string }>('/workflows/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `signal-large-${i}`,
                handler: 'largeSignalHandler',
              }),
            })
            workflowIds.push(response.workflowId)
          }
        },
        run: async (ctx, iteration) => {
          const workflowId = workflowIds[iteration % workflowIds.length]
          // Create a larger payload (~10KB)
          const largePayload = {
            batch: iteration,
            items: Array.from({ length: 100 }, (_, i) => ({
              id: `item-${i}`,
              data: `data-${iteration}-${i}`,
              metadata: {
                created: Date.now(),
                index: i,
                extra: 'x'.repeat(50),
              },
            })),
          }

          return ctx.do.request('/signals/send', {
            method: 'POST',
            body: JSON.stringify({
              workflowId,
              signalName: 'bulkData',
              data: largePayload,
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Send Signal with Large Payload (~10KB) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms for larger payloads
    })

    it('send multiple signals rapidly', async () => {
      let workflowId: string

      const result = await benchmark({
        name: 'signal-send-burst',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const response = await ctx.do.request<{ workflowId: string }>('/workflows/create', {
            method: 'POST',
            body: JSON.stringify({
              id: 'signal-burst-workflow',
              handler: 'burstSignalHandler',
            }),
          })
          workflowId = response.workflowId
        },
        run: async (ctx, iteration) => {
          // Send 5 signals per iteration
          const signals = Array.from({ length: 5 }, (_, i) => ({
            signalName: `signal-${i}`,
            data: { iteration, index: i },
          }))

          return ctx.do.request('/signals/send-batch', {
            method: 'POST',
            body: JSON.stringify({
              workflowId,
              signals,
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Send Signal Burst (5 per iteration) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(15) // <15ms for batch of 5
    })
  })

  describe('wait for signal', () => {
    it('wait for signal (pre-sent)', async () => {
      const workflowIds: string[] = []
      const signalNames: string[] = []

      const result = await benchmark({
        name: 'signal-wait-present',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create workflows and pre-send signals
          for (let i = 0; i < 20; i++) {
            const response = await ctx.do.request<{ workflowId: string }>('/workflows/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `wait-workflow-${i}`,
                handler: 'waitHandler',
              }),
            })
            workflowIds.push(response.workflowId)

            // Pre-send signals
            for (let j = 0; j < 5; j++) {
              const signalName = `signal-${i}-${j}`
              await ctx.do.request('/signals/send', {
                method: 'POST',
                body: JSON.stringify({
                  workflowId: response.workflowId,
                  signalName,
                  data: { index: j },
                }),
              })
              signalNames.push(`${response.workflowId}:${signalName}`)
            }
          }
        },
        run: async (ctx, iteration) => {
          const [workflowId, signalName] = signalNames[iteration % signalNames.length]!.split(':')
          return ctx.do.request('/signals/wait', {
            method: 'POST',
            body: JSON.stringify({
              workflowId,
              signalName,
              timeout: 1000, // Short timeout since signal already exists
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Wait for Signal (Pre-sent) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms when signal already exists
    })

    it('get pending signals', async () => {
      const workflowIds: string[] = []

      const result = await benchmark({
        name: 'signal-get-pending',
        target: 'workflow.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          // Create workflows with various pending signals
          for (let i = 0; i < 20; i++) {
            const response = await ctx.do.request<{ workflowId: string }>('/workflows/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `pending-workflow-${i}`,
                handler: 'pendingHandler',
              }),
            })
            workflowIds.push(response.workflowId)

            // Send different numbers of signals
            const signalCount = (i % 10) + 1
            for (let j = 0; j < signalCount; j++) {
              await ctx.do.request('/signals/send', {
                method: 'POST',
                body: JSON.stringify({
                  workflowId: response.workflowId,
                  signalName: `pending-signal-${j}`,
                  data: { index: j },
                }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const workflowId = workflowIds[iteration % workflowIds.length]
          return ctx.do.request(`/signals/pending?workflowId=${workflowId}`)
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Get Pending Signals ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })

    it('consume signal (mark as processed)', async () => {
      const signalRefs: Array<{ workflowId: string; signalId: string }> = []

      const result = await benchmark({
        name: 'signal-consume',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create workflows and send signals to consume
          for (let i = 0; i < 10; i++) {
            const response = await ctx.do.request<{ workflowId: string }>('/workflows/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `consume-workflow-${i}`,
                handler: 'consumeHandler',
              }),
            })

            // Send many signals
            for (let j = 0; j < 20; j++) {
              const signalResponse = await ctx.do.request<{ signalId: string }>('/signals/send', {
                method: 'POST',
                body: JSON.stringify({
                  workflowId: response.workflowId,
                  signalName: `consume-signal-${j}`,
                  data: { value: j },
                }),
              })
              signalRefs.push({
                workflowId: response.workflowId,
                signalId: signalResponse.signalId,
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const ref = signalRefs[iteration % signalRefs.length]!
          return ctx.do.request('/signals/consume', {
            method: 'POST',
            body: JSON.stringify({
              workflowId: ref.workflowId,
              signalId: ref.signalId,
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Consume Signal (Mark Processed) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })
  })

  describe('cross-workflow signaling', () => {
    it('signal from workflow to workflow', async () => {
      const workflowPairs: Array<{ source: string; target: string }> = []

      const result = await benchmark({
        name: 'signal-cross-workflow',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create pairs of workflows
          for (let i = 0; i < 10; i++) {
            const source = await ctx.do.request<{ workflowId: string }>('/workflows/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `source-workflow-${i}`,
                handler: 'sourceHandler',
              }),
            })

            const target = await ctx.do.request<{ workflowId: string }>('/workflows/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `target-workflow-${i}`,
                handler: 'targetHandler',
              }),
            })

            workflowPairs.push({
              source: source.workflowId,
              target: target.workflowId,
            })
          }
        },
        run: async (ctx, iteration) => {
          const pair = workflowPairs[iteration % workflowPairs.length]!
          return ctx.do.request('/signals/cross-workflow', {
            method: 'POST',
            body: JSON.stringify({
              sourceWorkflowId: pair.source,
              targetWorkflowId: pair.target,
              signalName: 'handoff',
              data: {
                iteration,
                handoffTime: Date.now(),
              },
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Cross-Workflow Signal ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(20) // <20ms target (may involve DO hop)
    })

    it('broadcast signal to multiple workflows', async () => {
      const broadcastGroups: Array<{ groupId: string; workflowIds: string[] }> = []

      const result = await benchmark({
        name: 'signal-broadcast',
        target: 'workflow.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create groups of workflows for broadcast
          for (let g = 0; g < 5; g++) {
            const workflowIds: string[] = []
            for (let i = 0; i < 10; i++) {
              const response = await ctx.do.request<{ workflowId: string }>('/workflows/create', {
                method: 'POST',
                body: JSON.stringify({
                  id: `broadcast-${g}-${i}`,
                  handler: 'broadcastHandler',
                  group: `group-${g}`,
                }),
              })
              workflowIds.push(response.workflowId)
            }
            broadcastGroups.push({
              groupId: `group-${g}`,
              workflowIds,
            })
          }
        },
        run: async (ctx, iteration) => {
          const group = broadcastGroups[iteration % broadcastGroups.length]!
          return ctx.do.request('/signals/broadcast', {
            method: 'POST',
            body: JSON.stringify({
              workflowIds: group.workflowIds,
              signalName: 'groupNotification',
              data: {
                groupId: group.groupId,
                iteration,
                timestamp: Date.now(),
              },
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Broadcast Signal (10 workflows) ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(50) // <50ms for 10 workflows
    })
  })

  describe('signal queries', () => {
    it('query signal history', async () => {
      const workflowIds: string[] = []

      const result = await benchmark({
        name: 'signal-query-history',
        target: 'workflow.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create workflows with signal history
          for (let i = 0; i < 10; i++) {
            const response = await ctx.do.request<{ workflowId: string }>('/workflows/create', {
              method: 'POST',
              body: JSON.stringify({
                id: `history-workflow-${i}`,
                handler: 'historyHandler',
              }),
            })
            workflowIds.push(response.workflowId)

            // Build up signal history
            for (let j = 0; j < 50; j++) {
              await ctx.do.request('/signals/send', {
                method: 'POST',
                body: JSON.stringify({
                  workflowId: response.workflowId,
                  signalName: `event-${j % 5}`,
                  data: { index: j },
                }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const workflowId = workflowIds[iteration % workflowIds.length]
          return ctx.do.request(`/signals/history?workflowId=${workflowId}&limit=20`)
        },
        teardown: async (ctx) => {
          await ctx.do.request('/workflows/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Query Signal History ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms target
    })
  })

  describe('summary', () => {
    it('should report signal benchmark targets', () => {
      console.log('\n========================================')
      console.log('SIGNAL BENCHMARK SUMMARY')
      console.log('========================================\n')

      console.log('Performance Targets:')
      console.log('  | Operation | Target |')
      console.log('  |-----------|--------|')
      console.log('  | Send signal | <5ms |')
      console.log('  | Send large | <10ms |')
      console.log('  | Send burst (5) | <15ms |')
      console.log('  | Wait (pre-sent) | <10ms |')
      console.log('  | Get pending | <5ms |')
      console.log('  | Consume | <5ms |')
      console.log('  | Cross-workflow | <20ms |')
      console.log('  | Broadcast (10) | <50ms |')
      console.log('  | Query history | <10ms |')
      console.log('')

      console.log('Signal Operations:')
      console.log('  - Send: O(1) append to signal queue')
      console.log('  - Wait: O(1) check + optional blocking')
      console.log('  - Pending: O(n) where n = pending signals')
      console.log('  - Consume: O(1) mark as processed')
      console.log('  - Broadcast: O(n) where n = target workflows')
      console.log('')

      console.log('Signal Features:')
      console.log('  - Buffered delivery (signals persist)')
      console.log('  - Cross-workflow communication')
      console.log('  - Broadcast to groups')
      console.log('  - Signal history queries')
      console.log('  - Timeout support')
      console.log('')

      expect(true).toBe(true)
    })
  })
})
