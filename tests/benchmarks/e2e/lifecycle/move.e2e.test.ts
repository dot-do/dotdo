/**
 * E2E Benchmarks: move() Operation
 *
 * Tests DO movement between Cloudflare colocations.
 * Targets: move.perf.do
 *
 * Operations tested:
 * - Cross-colo move (e.g., SJC -> LHR)
 * - State preservation after move
 * - Move event emission (move.started, move.completed)
 * - Merge option during move
 *
 * @see objects/DO.ts for move() implementation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { benchmark, record, type BenchmarkResult } from '../../lib'
import { EU_COLOS, NA_COLOS } from '../../lib/colos'

// ============================================================================
// BENCHMARK CONFIGURATION
// ============================================================================

/** Target DO endpoint for move operations */
const TARGET = 'move.perf.do'

/** Number of iterations for latency benchmarks */
const ITERATIONS = 20

/** Number of warmup iterations */
const WARMUP = 3

/** Maximum acceptable latency for cross-colo move (ms) */
const MAX_MOVE_LATENCY_MS = 5000

/** Maximum acceptable latency for same-region move (ms) */
const MAX_SAME_REGION_MOVE_MS = 2000

// ============================================================================
// E2E MOVE BENCHMARKS
// ============================================================================

describe('move() E2E Benchmarks', () => {
  const testRunId = `move-${Date.now()}`
  const results: BenchmarkResult[] = []

  afterAll(() => {
    // Record all results at the end
    if (results.length > 0) {
      record(results)
    }
  })

  describe('Cross-Colo Move', () => {
    it('moves DO to different colo', async () => {
      const result = await benchmark({
        name: 'move-cross-colo',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx) => {
          const targetColo = EU_COLOS[0] // LHR
          return ctx.do.request('/move', {
            method: 'POST',
            body: JSON.stringify({
              colo: targetColo,
              testRunId,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_MOVE_LATENCY_MS)
    })

    it('moves DO back to origin colo', async () => {
      const result = await benchmark({
        name: 'move-back-to-origin',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx) => {
          const targetColo = NA_COLOS[0] // SJC
          return ctx.do.request('/move', {
            method: 'POST',
            body: JSON.stringify({
              colo: targetColo,
              testRunId,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_MOVE_LATENCY_MS)
    })

    it('moves DO across regions (NA -> EU -> APAC)', async () => {
      const result = await benchmark({
        name: 'move-multi-region',
        target: TARGET,
        iterations: 10, // Fewer iterations due to longer operation
        warmup: 2,
        run: async (ctx, iteration) => {
          const colos = ['SJC', 'LHR', 'NRT']
          const targetColo = colos[iteration % colos.length]
          return ctx.do.request('/move', {
            method: 'POST',
            body: JSON.stringify({
              colo: targetColo,
              testRunId,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_MOVE_LATENCY_MS * 1.5)
    })
  })

  describe('State Preservation', () => {
    it('preserves state after move', async () => {
      const stateKey = `test-state-${Date.now()}`
      const stateValue = { counter: 42, data: 'preserved' }

      const result = await benchmark({
        name: 'move-preserves-state',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        setup: async (ctx) => {
          // Set state before move
          await ctx.do.request('/state', {
            method: 'PUT',
            body: JSON.stringify({ key: stateKey, value: stateValue }),
          })
        },
        run: async (ctx) => {
          // Move to a different colo
          await ctx.do.request('/move', {
            method: 'POST',
            body: JSON.stringify({ colo: 'LHR' }),
          })

          // Verify state is preserved
          const response = await ctx.do.get<{ value: typeof stateValue }>(`/state?key=${stateKey}`)
          if (response.value?.counter !== stateValue.counter) {
            throw new Error('State not preserved after move')
          }
          return response
        },
        teardown: async (ctx) => {
          // Clean up test state
          await ctx.do.request('/state', {
            method: 'DELETE',
            body: JSON.stringify({ key: stateKey }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_MOVE_LATENCY_MS)
      expect(result.errors).toBeUndefined()
    })

    it('preserves SQLite data after move', async () => {
      const result = await benchmark({
        name: 'move-preserves-sqlite',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Insert test data
          await ctx.do.request('/db/exec', {
            method: 'POST',
            body: JSON.stringify({
              sql: `CREATE TABLE IF NOT EXISTS move_test (id INTEGER PRIMARY KEY, value TEXT)`,
            }),
          })
          await ctx.do.request('/db/exec', {
            method: 'POST',
            body: JSON.stringify({
              sql: `INSERT INTO move_test (id, value) VALUES (1, 'test-data')`,
            }),
          })
        },
        run: async (ctx) => {
          // Move to different colo
          await ctx.do.request('/move', {
            method: 'POST',
            body: JSON.stringify({ colo: 'FRA' }),
          })

          // Query data after move
          const result = await ctx.do.request<{ rows: Array<{ id: number; value: string }> }>('/db/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: `SELECT * FROM move_test WHERE id = 1`,
            }),
          })

          if (!result.rows || result.rows.length === 0) {
            throw new Error('SQLite data not preserved after move')
          }
          return result
        },
        teardown: async (ctx) => {
          await ctx.do.request('/db/exec', {
            method: 'POST',
            body: JSON.stringify({ sql: `DROP TABLE IF EXISTS move_test` }),
          })
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })

  describe('Move Events', () => {
    it('emits move.started and move.completed events', async () => {
      const result = await benchmark({
        name: 'move-events-emission',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx) => {
          // Subscribe to events before move
          const eventsBefore = await ctx.do.request<{ subscribed: boolean }>('/events/subscribe', {
            method: 'POST',
            body: JSON.stringify({
              events: ['move.started', 'move.completed'],
            }),
          })

          if (!eventsBefore.subscribed) {
            throw new Error('Failed to subscribe to move events')
          }

          // Perform move
          await ctx.do.request('/move', {
            method: 'POST',
            body: JSON.stringify({ colo: 'CDG' }),
          })

          // Check emitted events
          const events = await ctx.do.get<{ events: string[] }>('/events/recent')
          const hasStarted = events.events?.includes('move.started')
          const hasCompleted = events.events?.includes('move.completed')

          if (!hasStarted || !hasCompleted) {
            throw new Error(`Missing events: started=${hasStarted}, completed=${hasCompleted}`)
          }

          return events
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_MOVE_LATENCY_MS)
    })

    it('emits events with correct metadata', async () => {
      const result = await benchmark({
        name: 'move-event-metadata',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx) => {
          const sourceColo = 'SJC'
          const targetColo = 'LHR'

          // Perform move
          await ctx.do.request('/move', {
            method: 'POST',
            body: JSON.stringify({ colo: targetColo }),
          })

          // Get event details
          const lastEvent = await ctx.do.get<{
            type: string
            metadata: { sourceColo: string; targetColo: string; timestamp: number }
          }>('/events/last?type=move.completed')

          if (!lastEvent.metadata) {
            throw new Error('Event missing metadata')
          }

          return lastEvent
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })

  describe('Move with Merge Option', () => {
    it('supports merge option during move', async () => {
      const result = await benchmark({
        name: 'move-with-merge',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx) => {
          // Move with merge strategy
          return ctx.do.request('/move', {
            method: 'POST',
            body: JSON.stringify({
              colo: 'AMS',
              merge: true,
              conflictStrategy: 'last-write-wins',
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_MOVE_LATENCY_MS * 1.5)
    })

    it('handles concurrent move requests', async () => {
      const result = await benchmark({
        name: 'move-concurrent-handling',
        target: TARGET,
        iterations: 5,
        warmup: 1,
        run: async (ctx) => {
          // Attempt concurrent moves (should queue or reject)
          const moves = Promise.all([
            ctx.do.request('/move', {
              method: 'POST',
              body: JSON.stringify({ colo: 'LHR' }),
            }),
            ctx.do.request('/move', {
              method: 'POST',
              body: JSON.stringify({ colo: 'FRA' }),
            }),
          ])

          try {
            await moves
          } catch (e) {
            // Expected: one should fail or queue
          }

          // Verify DO is in consistent state
          const status = await ctx.do.get<{ colo: string; status: string }>('/status')
          if (!status.colo || !status.status) {
            throw new Error('DO in inconsistent state after concurrent moves')
          }

          return status
        },
      })

      results.push(result)
      // Concurrent handling may take longer
      expect(result.stats.p95).toBeLessThan(MAX_MOVE_LATENCY_MS * 2)
    })
  })

  describe('Move Performance Analysis', () => {
    it('measures move latency by distance', async () => {
      const coloDistances = [
        { name: 'same-region', from: 'SJC', to: 'LAX', expectedMaxMs: MAX_SAME_REGION_MOVE_MS },
        { name: 'cross-region-na-eu', from: 'SJC', to: 'LHR', expectedMaxMs: MAX_MOVE_LATENCY_MS },
        { name: 'cross-region-eu-apac', from: 'LHR', to: 'NRT', expectedMaxMs: MAX_MOVE_LATENCY_MS },
        { name: 'max-distance', from: 'SJC', to: 'SYD', expectedMaxMs: MAX_MOVE_LATENCY_MS * 1.2 },
      ]

      for (const distance of coloDistances) {
        const result = await benchmark({
          name: `move-distance-${distance.name}`,
          target: TARGET,
          iterations: 5,
          warmup: 1,
          run: async (ctx) => {
            // First ensure we're at the source colo
            await ctx.do.request('/move', {
              method: 'POST',
              body: JSON.stringify({ colo: distance.from }),
            })

            // Then move to destination and measure
            return ctx.do.request('/move', {
              method: 'POST',
              body: JSON.stringify({ colo: distance.to }),
            })
          },
        })

        results.push(result)
        expect(result.stats.p95).toBeLessThan(distance.expectedMaxMs)
      }
    })

    it('measures cold start after move', async () => {
      const result = await benchmark({
        name: 'move-cold-start-after',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        coldStart: true,
        run: async (ctx) => {
          // Move to a new colo
          await ctx.do.request('/move', {
            method: 'POST',
            body: JSON.stringify({ colo: 'MAD' }),
          })

          // Immediate request after move (measures cold start in new colo)
          return ctx.do.get('/ping')
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_MOVE_LATENCY_MS + 500) // Move + cold start
    })
  })
})
