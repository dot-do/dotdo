/**
 * E2E Benchmarks: promote() / demote() Operations
 *
 * Tests Thing <-> DO promotion and demotion lifecycle.
 * Targets: promote.perf.do
 *
 * Operations tested:
 * - Thing -> DO promotion (activate)
 * - DO -> Thing demotion (deactivate)
 * - History preservation during transitions
 * - Atomic vs staged promotion modes
 *
 * @see objects/DO.ts for promote()/demote() implementation
 * @see types/Thing.ts for Thing type definition
 */

import { describe, it, expect, afterAll } from 'vitest'
import { benchmark, record, type BenchmarkResult } from '../../lib'

// ============================================================================
// BENCHMARK CONFIGURATION
// ============================================================================

/** Target DO endpoint for promote operations */
const TARGET = 'promote.perf.do'

/** Number of iterations for latency benchmarks */
const ITERATIONS = 20

/** Number of warmup iterations */
const WARMUP = 3

/** Maximum acceptable latency for promotion (ms) */
const MAX_PROMOTE_LATENCY_MS = 2000

/** Maximum acceptable latency for demotion (ms) */
const MAX_DEMOTE_LATENCY_MS = 1500

/** Maximum acceptable latency for atomic mode (ms) */
const MAX_ATOMIC_LATENCY_MS = 3000

// ============================================================================
// E2E PROMOTE/DEMOTE BENCHMARKS
// ============================================================================

describe('promote() / demote() E2E Benchmarks', () => {
  const testRunId = `promote-${Date.now()}`
  const results: BenchmarkResult[] = []

  afterAll(() => {
    if (results.length > 0) {
      record(results)
    }
  })

  describe('Thing -> DO Promotion', () => {
    it('promotes Thing to active DO', async () => {
      const result = await benchmark({
        name: 'promote-thing-to-do',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const thingId = `thing-${testRunId}-${iteration}`

          // Create a Thing (passive entity)
          await ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              id: thingId,
              type: 'customer',
              data: { name: 'Test Customer', email: 'test@example.com' },
            }),
          })

          // Promote to active DO
          return ctx.do.request(`/things/${thingId}/promote`, {
            method: 'POST',
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_PROMOTE_LATENCY_MS)
    })

    it('promotes with initialization hook', async () => {
      const result = await benchmark({
        name: 'promote-with-init-hook',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const thingId = `init-hook-${testRunId}-${iteration}`

          await ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              id: thingId,
              type: 'subscription',
              data: { plan: 'starter', status: 'pending' },
            }),
          })

          // Promote with initialization hook
          return ctx.do.request(`/things/${thingId}/promote`, {
            method: 'POST',
            body: JSON.stringify({
              onInit: {
                action: 'activate',
                setStatus: 'active',
                scheduleRenewal: true,
              },
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_PROMOTE_LATENCY_MS * 1.2)
    })

    it('promotes with alarm scheduling', async () => {
      const result = await benchmark({
        name: 'promote-with-alarm',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const thingId = `alarm-${testRunId}-${iteration}`

          await ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              id: thingId,
              type: 'reminder',
              data: { message: 'Test reminder' },
            }),
          })

          // Promote and schedule alarm
          return ctx.do.request(`/things/${thingId}/promote`, {
            method: 'POST',
            body: JSON.stringify({
              scheduleAlarm: {
                after: 3600000, // 1 hour
                action: 'notify',
              },
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_PROMOTE_LATENCY_MS)
    })
  })

  describe('DO -> Thing Demotion', () => {
    it('demotes active DO to Thing', async () => {
      const result = await benchmark({
        name: 'demote-do-to-thing',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        setup: async (ctx) => {
          // Create and promote a Thing first
          await ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              id: `demote-setup-${testRunId}`,
              type: 'session',
              data: { active: true },
            }),
          })
          await ctx.do.request(`/things/demote-setup-${testRunId}/promote`, {
            method: 'POST',
          })
        },
        run: async (ctx, iteration) => {
          const doId = `demote-${testRunId}-${iteration}`

          // Create active DO
          await ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              id: doId,
              data: { session: `session-${iteration}` },
            }),
          })

          // Demote to Thing
          return ctx.do.request(`/objects/${doId}/demote`, {
            method: 'POST',
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_DEMOTE_LATENCY_MS)
    })

    it('demotes with state archival', async () => {
      const result = await benchmark({
        name: 'demote-with-archive',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const doId = `archive-${testRunId}-${iteration}`

          // Create DO with state
          await ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              id: doId,
              data: {
                logs: Array.from({ length: 100 }, (_, i) => ({ entry: i, timestamp: Date.now() })),
              },
            }),
          })

          // Demote with archival
          return ctx.do.request(`/objects/${doId}/demote`, {
            method: 'POST',
            body: JSON.stringify({
              archive: {
                destination: 'r2',
                bucket: 'archive',
                compress: true,
              },
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_DEMOTE_LATENCY_MS * 1.5)
    })

    it('demotes with cleanup handlers', async () => {
      const result = await benchmark({
        name: 'demote-with-cleanup',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          const doId = `cleanup-${testRunId}-${iteration}`

          // Create DO with resources
          await ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              id: doId,
              data: { hasResources: true },
            }),
          })

          // Demote with cleanup
          return ctx.do.request(`/objects/${doId}/demote`, {
            method: 'POST',
            body: JSON.stringify({
              cleanup: {
                cancelAlarms: true,
                closeConnections: true,
                flushPending: true,
              },
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_DEMOTE_LATENCY_MS)
    })
  })

  describe('History Preservation', () => {
    it('preserves Thing history after promotion', async () => {
      const result = await benchmark({
        name: 'promote-preserves-history',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const thingId = `history-${testRunId}-${iteration}`

          // Create Thing with history
          await ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              id: thingId,
              type: 'order',
              data: { amount: 100 },
            }),
          })

          // Add history entries
          for (let i = 0; i < 5; i++) {
            await ctx.do.request(`/things/${thingId}/history`, {
              method: 'POST',
              body: JSON.stringify({
                event: 'status_change',
                data: { status: `status-${i}` },
              }),
            })
          }

          // Promote
          await ctx.do.request(`/things/${thingId}/promote`, {
            method: 'POST',
          })

          // Verify history is preserved
          const history = await ctx.do.get<{ entries: Array<{ event: string }> }>(
            `/objects/${thingId}/history`
          )

          if (!history.entries || history.entries.length < 5) {
            throw new Error('History not preserved after promotion')
          }

          return history
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it('preserves DO history after demotion', async () => {
      const result = await benchmark({
        name: 'demote-preserves-history',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const doId = `demote-history-${testRunId}-${iteration}`

          // Create active DO
          await ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              id: doId,
              data: { active: true },
            }),
          })

          // Generate history through operations
          for (let i = 0; i < 3; i++) {
            await ctx.do.request(`/objects/${doId}/action`, {
              method: 'POST',
              body: JSON.stringify({ action: 'update', value: i }),
            })
          }

          // Demote
          await ctx.do.request(`/objects/${doId}/demote`, {
            method: 'POST',
          })

          // Verify history in Thing
          const thing = await ctx.do.get<{ history: Array<{ action: string }> }>(`/things/${doId}`)

          if (!thing.history || thing.history.length < 3) {
            throw new Error('History not preserved after demotion')
          }

          return thing
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it('handles large history during transition', async () => {
      const result = await benchmark({
        name: 'transition-large-history',
        target: TARGET,
        iterations: 5,
        warmup: 1,
        run: async (ctx, iteration) => {
          const thingId = `large-history-${testRunId}-${iteration}`

          // Create Thing with large history
          await ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              id: thingId,
              type: 'audit-log',
              data: {},
            }),
          })

          // Add many history entries
          await ctx.do.request(`/things/${thingId}/history/batch`, {
            method: 'POST',
            body: JSON.stringify({
              entries: Array.from({ length: 1000 }, (_, i) => ({
                event: 'log',
                data: { index: i, timestamp: Date.now() },
              })),
            }),
          })

          // Promote with history
          return ctx.do.request(`/things/${thingId}/promote`, {
            method: 'POST',
            body: JSON.stringify({
              preserveHistory: true,
              historyLimit: 1000,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_PROMOTE_LATENCY_MS * 2)
    })
  })

  describe('Atomic vs Staged Modes', () => {
    it('measures atomic promotion (blockConcurrencyWhile)', async () => {
      const result = await benchmark({
        name: 'promote-atomic',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const thingId = `atomic-${testRunId}-${iteration}`

          await ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              id: thingId,
              type: 'account',
              data: { balance: 1000 },
            }),
          })

          // Atomic promotion - blocks all other requests
          return ctx.do.request(`/things/${thingId}/promote`, {
            method: 'POST',
            body: JSON.stringify({
              mode: 'atomic',
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_ATOMIC_LATENCY_MS)
    })

    it('measures staged promotion (2PC with tokens)', async () => {
      const result = await benchmark({
        name: 'promote-staged',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const thingId = `staged-${testRunId}-${iteration}`

          await ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              id: thingId,
              type: 'transaction',
              data: { amount: 500 },
            }),
          })

          // Staged promotion - prepare phase
          const prepare = await ctx.do.request<{ token: string }>(`/things/${thingId}/promote/prepare`, {
            method: 'POST',
          })

          // Commit phase
          return ctx.do.request(`/things/${thingId}/promote/commit`, {
            method: 'POST',
            body: JSON.stringify({
              token: prepare.token,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_ATOMIC_LATENCY_MS)
    })

    it('measures staged demotion with rollback capability', async () => {
      const result = await benchmark({
        name: 'demote-staged-rollback',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          const doId = `staged-rollback-${testRunId}-${iteration}`

          // Create DO
          await ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              id: doId,
              data: { value: 100 },
            }),
          })

          // Prepare demotion
          const prepare = await ctx.do.request<{ token: string; snapshot: unknown }>(
            `/objects/${doId}/demote/prepare`,
            { method: 'POST' }
          )

          // Simulate rollback (abort)
          await ctx.do.request(`/objects/${doId}/demote/abort`, {
            method: 'POST',
            body: JSON.stringify({ token: prepare.token }),
          })

          // Verify DO is still active
          const status = await ctx.do.get<{ active: boolean }>(`/objects/${doId}/status`)

          if (!status.active) {
            throw new Error('DO should still be active after rollback')
          }

          return status
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it('compares atomic vs staged performance', async () => {
      const modes = ['atomic', 'staged'] as const

      for (const mode of modes) {
        const result = await benchmark({
          name: `promote-mode-${mode}`,
          target: TARGET,
          iterations: ITERATIONS,
          warmup: WARMUP,
          run: async (ctx, iteration) => {
            const thingId = `mode-${mode}-${testRunId}-${iteration}`

            await ctx.do.request('/things', {
              method: 'POST',
              body: JSON.stringify({
                id: thingId,
                type: 'comparison',
                data: { mode },
              }),
            })

            if (mode === 'atomic') {
              return ctx.do.request(`/things/${thingId}/promote`, {
                method: 'POST',
                body: JSON.stringify({ mode: 'atomic' }),
              })
            } else {
              // Staged mode
              const prepare = await ctx.do.request<{ token: string }>(
                `/things/${thingId}/promote/prepare`,
                { method: 'POST' }
              )
              return ctx.do.request(`/things/${thingId}/promote/commit`, {
                method: 'POST',
                body: JSON.stringify({ token: prepare.token }),
              })
            }
          },
        })

        results.push(result)
      }

      // Both modes should complete within acceptable time
      const atomicResult = results.find((r) => r.name === 'promote-mode-atomic')
      const stagedResult = results.find((r) => r.name === 'promote-mode-staged')

      expect(atomicResult?.stats.p95).toBeLessThan(MAX_ATOMIC_LATENCY_MS)
      expect(stagedResult?.stats.p95).toBeLessThan(MAX_ATOMIC_LATENCY_MS)
    })
  })

  describe('Promotion/Demotion Cycles', () => {
    it('handles rapid promote/demote cycles', async () => {
      const result = await benchmark({
        name: 'rapid-promote-demote-cycle',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          const entityId = `cycle-${testRunId}-${iteration}`

          // Create as Thing
          await ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              id: entityId,
              type: 'cyclic',
              data: { cycle: 0 },
            }),
          })

          // Rapid cycles
          for (let cycle = 0; cycle < 3; cycle++) {
            // Promote
            await ctx.do.request(`/things/${entityId}/promote`, {
              method: 'POST',
            })

            // Do some work
            await ctx.do.request(`/objects/${entityId}/action`, {
              method: 'POST',
              body: JSON.stringify({ action: 'increment' }),
            })

            // Demote
            await ctx.do.request(`/objects/${entityId}/demote`, {
              method: 'POST',
            })
          }

          // Final state check
          return ctx.do.get(`/things/${entityId}`)
        },
      })

      results.push(result)
      // Rapid cycles will take longer
      expect(result.stats.p95).toBeLessThan((MAX_PROMOTE_LATENCY_MS + MAX_DEMOTE_LATENCY_MS) * 3)
    })

    it('measures state consistency through cycles', async () => {
      const result = await benchmark({
        name: 'cycle-state-consistency',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          const entityId = `consistency-${testRunId}-${iteration}`
          const initialValue = 100

          // Create Thing with initial value
          await ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              id: entityId,
              type: 'counter',
              data: { value: initialValue },
            }),
          })

          // Promote
          await ctx.do.request(`/things/${entityId}/promote`, {
            method: 'POST',
          })

          // Modify value
          await ctx.do.request(`/objects/${entityId}/increment`, {
            method: 'POST',
            body: JSON.stringify({ amount: 50 }),
          })

          // Demote
          await ctx.do.request(`/objects/${entityId}/demote`, {
            method: 'POST',
          })

          // Check final value
          const thing = await ctx.do.get<{ data: { value: number } }>(`/things/${entityId}`)

          if (thing.data?.value !== 150) {
            throw new Error(`Expected value 150, got ${thing.data?.value}`)
          }

          return thing
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })

  describe('Event Handling', () => {
    it('emits promotion events', async () => {
      const result = await benchmark({
        name: 'promote-events',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const thingId = `events-promote-${testRunId}-${iteration}`

          await ctx.do.request('/things', {
            method: 'POST',
            body: JSON.stringify({
              id: thingId,
              type: 'event-test',
              data: {},
            }),
          })

          // Subscribe to events
          await ctx.do.request('/events/subscribe', {
            method: 'POST',
            body: JSON.stringify({
              events: ['thing.promoted', 'do.activated'],
            }),
          })

          // Promote
          await ctx.do.request(`/things/${thingId}/promote`, {
            method: 'POST',
          })

          // Check events
          const events = await ctx.do.get<{ events: string[] }>('/events/recent')

          if (!events.events?.includes('thing.promoted')) {
            throw new Error('thing.promoted event not emitted')
          }

          return events
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it('emits demotion events', async () => {
      const result = await benchmark({
        name: 'demote-events',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const doId = `events-demote-${testRunId}-${iteration}`

          // Create DO
          await ctx.do.request('/objects', {
            method: 'POST',
            body: JSON.stringify({
              id: doId,
              data: {},
            }),
          })

          // Subscribe to events
          await ctx.do.request('/events/subscribe', {
            method: 'POST',
            body: JSON.stringify({
              events: ['do.deactivated', 'thing.created'],
            }),
          })

          // Demote
          await ctx.do.request(`/objects/${doId}/demote`, {
            method: 'POST',
          })

          // Check events
          const events = await ctx.do.get<{ events: string[] }>('/events/recent')

          if (!events.events?.includes('do.deactivated')) {
            throw new Error('do.deactivated event not emitted')
          }

          return events
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })
})
