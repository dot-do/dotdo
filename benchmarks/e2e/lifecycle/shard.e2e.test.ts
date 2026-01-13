/**
 * E2E Benchmarks: shard() / unshard() Operations
 *
 * Tests DO sharding strategies for horizontal scaling.
 * Targets: shard.perf.do
 *
 * Operations tested:
 * - Hash strategy sharding
 * - Range strategy sharding
 * - RoundRobin strategy sharding
 * - Unshard (merge) operations
 *
 * @see db/core/shard.ts for sharding implementation
 */

import { describe, it, expect, afterAll } from 'vitest'
import { benchmark, record, type BenchmarkResult } from '../../lib'

// ============================================================================
// BENCHMARK CONFIGURATION
// ============================================================================

/** Target DO endpoint for shard operations */
const TARGET = 'shard.perf.do'

/** Number of iterations for latency benchmarks */
const ITERATIONS = 20

/** Number of warmup iterations */
const WARMUP = 3

/** Maximum acceptable latency for shard creation (ms) */
const MAX_SHARD_CREATE_MS = 2000

/** Maximum acceptable latency for shard routing (ms) */
const MAX_SHARD_ROUTE_MS = 100

/** Maximum acceptable latency for unshard/merge (ms) */
const MAX_UNSHARD_MS = 5000

/** Maximum acceptable latency for scatter-gather (ms) */
const MAX_SCATTER_GATHER_MS = 500

// ============================================================================
// E2E SHARD BENCHMARKS
// ============================================================================

describe('shard() / unshard() E2E Benchmarks', () => {
  const testRunId = `shard-${Date.now()}`
  const results: BenchmarkResult[] = []

  afterAll(() => {
    if (results.length > 0) {
      record(results)
    }
  })

  describe('Hash Strategy Sharding', () => {
    it('creates shards with hash strategy', async () => {
      const result = await benchmark({
        name: 'shard-hash-create',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        shardCount: 8,
        run: async (ctx, iteration) => {
          const namespace = `hash-shard-${testRunId}-${iteration}`

          return ctx.do.request('/shard', {
            method: 'POST',
            body: JSON.stringify({
              strategy: 'hash',
              shardCount: 8,
              namespace,
              key: 'tenant_id',
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_SHARD_CREATE_MS)
    })

    it('routes requests to correct hash shard', async () => {
      const result = await benchmark({
        name: 'shard-hash-routing',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        setup: async (ctx) => {
          // Create sharded setup
          await ctx.do.request('/shard', {
            method: 'POST',
            body: JSON.stringify({
              strategy: 'hash',
              shardCount: 4,
              namespace: `hash-route-${testRunId}`,
              key: 'user_id',
            }),
          })
        },
        run: async (ctx, iteration) => {
          const userId = `user-${iteration}-${Date.now()}`

          // Route request to appropriate shard
          return ctx.do.request('/query', {
            method: 'POST',
            body: JSON.stringify({
              user_id: userId,
              operation: 'read',
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_SHARD_ROUTE_MS)
    })

    it('verifies consistent hash routing', async () => {
      const result = await benchmark({
        name: 'shard-hash-consistency',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          const key = `consistent-key-${iteration}`

          // Route same key multiple times
          const routes: number[] = []
          for (let i = 0; i < 5; i++) {
            const response = await ctx.do.request<{ shardId: number }>('/route', {
              method: 'POST',
              body: JSON.stringify({ key }),
            })
            routes.push(response.shardId)
          }

          // All routes should go to same shard
          const uniqueRoutes = new Set(routes)
          if (uniqueRoutes.size !== 1) {
            throw new Error(`Inconsistent routing: ${routes.join(', ')}`)
          }

          return { key, shardId: routes[0] }
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it('measures hash distribution quality', async () => {
      const result = await benchmark({
        name: 'shard-hash-distribution',
        target: TARGET,
        iterations: 5,
        warmup: 1,
        shardCount: 8,
        run: async (ctx) => {
          // Generate 1000 keys and check distribution
          const keys = Array.from({ length: 1000 }, (_, i) => `dist-key-${i}-${Date.now()}`)

          const distribution = await ctx.do.request<{
            shardCounts: number[]
            stdDev: number
            balance: number
          }>('/shard/distribution', {
            method: 'POST',
            body: JSON.stringify({ keys, shardCount: 8 }),
          })

          if (distribution.balance < 0.6) {
            throw new Error(`Poor distribution balance: ${distribution.balance}`)
          }

          return distribution
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })

  describe('Range Strategy Sharding', () => {
    it('creates shards with range strategy', async () => {
      const result = await benchmark({
        name: 'shard-range-create',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        shardCount: 4,
        run: async (ctx, iteration) => {
          const namespace = `range-shard-${testRunId}-${iteration}`

          return ctx.do.request('/shard', {
            method: 'POST',
            body: JSON.stringify({
              strategy: 'range',
              shardCount: 4,
              namespace,
              ranges: [
                { min: 0, max: 250000 },
                { min: 250000, max: 500000 },
                { min: 500000, max: 750000 },
                { min: 750000, max: 1000000 },
              ],
              key: 'id',
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_SHARD_CREATE_MS)
    })

    it('routes requests to correct range shard', async () => {
      const result = await benchmark({
        name: 'shard-range-routing',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        setup: async (ctx) => {
          await ctx.do.request('/shard', {
            method: 'POST',
            body: JSON.stringify({
              strategy: 'range',
              shardCount: 4,
              namespace: `range-route-${testRunId}`,
              ranges: [
                { min: 0, max: 1000 },
                { min: 1000, max: 2000 },
                { min: 2000, max: 3000 },
                { min: 3000, max: 4000 },
              ],
              key: 'id',
            }),
          })
        },
        run: async (ctx, iteration) => {
          const id = (iteration % 4) * 1000 + 500 // Distribute across shards

          return ctx.do.request<{ shardId: number }>('/query', {
            method: 'POST',
            body: JSON.stringify({
              id,
              operation: 'read',
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_SHARD_ROUTE_MS)
    })

    it('handles range boundary cases', async () => {
      const result = await benchmark({
        name: 'shard-range-boundaries',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx, iteration) => {
          // Test boundary values
          const boundaries = [0, 999, 1000, 1001, 2999, 3000]
          const boundary = boundaries[iteration % boundaries.length]

          const response = await ctx.do.request<{ shardId: number; value: number }>('/route', {
            method: 'POST',
            body: JSON.stringify({
              key: boundary,
              strategy: 'range',
            }),
          })

          return response
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_SHARD_ROUTE_MS)
    })

    it('measures range query performance', async () => {
      const result = await benchmark({
        name: 'shard-range-query',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          // Range query spanning multiple shards
          const minVal = iteration * 500
          const maxVal = minVal + 1500 // Spans 2-3 shards

          return ctx.do.request<{ results: unknown[]; shardsQueried: number }>('/query/range', {
            method: 'POST',
            body: JSON.stringify({
              min: minVal,
              max: maxVal,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_SCATTER_GATHER_MS)
    })
  })

  describe('RoundRobin Strategy Sharding', () => {
    it('creates shards with roundRobin strategy', async () => {
      const result = await benchmark({
        name: 'shard-roundrobin-create',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        shardCount: 4,
        run: async (ctx, iteration) => {
          const namespace = `rr-shard-${testRunId}-${iteration}`

          return ctx.do.request('/shard', {
            method: 'POST',
            body: JSON.stringify({
              strategy: 'roundRobin',
              shardCount: 4,
              namespace,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_SHARD_CREATE_MS)
    })

    it('distributes requests evenly', async () => {
      const result = await benchmark({
        name: 'shard-roundrobin-distribution',
        target: TARGET,
        iterations: 20,
        warmup: 4,
        run: async (ctx, iteration) => {
          // Make request and track which shard handles it
          const response = await ctx.do.request<{ shardId: number; requestNumber: number }>('/write', {
            method: 'POST',
            body: JSON.stringify({
              data: { iteration },
            }),
          })

          return response
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_SHARD_ROUTE_MS)
    })

    it('maintains roundRobin counter across restarts', async () => {
      const result = await benchmark({
        name: 'shard-roundrobin-persistence',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          // Get current counter
          const before = await ctx.do.get<{ counter: number }>('/shard/counter')

          // Make a few requests
          for (let i = 0; i < 3; i++) {
            await ctx.do.request('/write', {
              method: 'POST',
              body: JSON.stringify({ data: { i } }),
            })
          }

          // Verify counter incremented
          const after = await ctx.do.get<{ counter: number }>('/shard/counter')

          if (after.counter !== before.counter + 3) {
            throw new Error(`Counter mismatch: expected ${before.counter + 3}, got ${after.counter}`)
          }

          return { before: before.counter, after: after.counter }
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })

  describe('Unshard (Merge) Operations', () => {
    it('merges shards back to single DO', async () => {
      const result = await benchmark({
        name: 'unshard-merge',
        target: TARGET,
        iterations: 5,
        warmup: 1,
        run: async (ctx, iteration) => {
          const namespace = `merge-${testRunId}-${iteration}`

          // First create shards
          await ctx.do.request('/shard', {
            method: 'POST',
            body: JSON.stringify({
              strategy: 'hash',
              shardCount: 4,
              namespace,
              key: 'id',
            }),
          })

          // Add some data to shards
          for (let i = 0; i < 20; i++) {
            await ctx.do.request('/write', {
              method: 'POST',
              body: JSON.stringify({
                id: `item-${i}`,
                data: { value: i },
              }),
            })
          }

          // Unshard (merge)
          return ctx.do.request('/unshard', {
            method: 'POST',
            body: JSON.stringify({
              namespace,
              targetId: `merged-${namespace}`,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_UNSHARD_MS)
    })

    it('preserves all data during unshard', async () => {
      const result = await benchmark({
        name: 'unshard-data-preservation',
        target: TARGET,
        iterations: 5,
        warmup: 1,
        run: async (ctx, iteration) => {
          const namespace = `preserve-${testRunId}-${iteration}`
          const itemCount = 50

          // Create shards
          await ctx.do.request('/shard', {
            method: 'POST',
            body: JSON.stringify({
              strategy: 'hash',
              shardCount: 4,
              namespace,
              key: 'id',
            }),
          })

          // Add data
          for (let i = 0; i < itemCount; i++) {
            await ctx.do.request('/write', {
              method: 'POST',
              body: JSON.stringify({
                id: `item-${i}`,
                data: { index: i },
              }),
            })
          }

          // Unshard
          await ctx.do.request('/unshard', {
            method: 'POST',
            body: JSON.stringify({
              namespace,
              targetId: `merged-${namespace}`,
            }),
          })

          // Verify all data preserved
          const merged = await ctx.do.get<{ count: number }>(`/count?namespace=merged-${namespace}`)

          if (merged.count !== itemCount) {
            throw new Error(`Data loss: expected ${itemCount}, got ${merged.count}`)
          }

          return merged
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it('handles unshard with conflict resolution', async () => {
      const result = await benchmark({
        name: 'unshard-conflict-resolution',
        target: TARGET,
        iterations: 5,
        warmup: 1,
        run: async (ctx, iteration) => {
          const namespace = `conflict-${testRunId}-${iteration}`

          // Create shards with potentially conflicting data
          await ctx.do.request('/shard', {
            method: 'POST',
            body: JSON.stringify({
              strategy: 'hash',
              shardCount: 2,
              namespace,
              key: 'id',
            }),
          })

          // Add data with same ID to different shards (simulated conflict)
          await ctx.do.request('/write/direct', {
            method: 'POST',
            body: JSON.stringify({
              shardId: 0,
              id: 'conflict-item',
              data: { version: 1, source: 'shard-0' },
            }),
          })

          await ctx.do.request('/write/direct', {
            method: 'POST',
            body: JSON.stringify({
              shardId: 1,
              id: 'conflict-item',
              data: { version: 2, source: 'shard-1' },
            }),
          })

          // Unshard with conflict strategy
          return ctx.do.request('/unshard', {
            method: 'POST',
            body: JSON.stringify({
              namespace,
              targetId: `merged-${namespace}`,
              conflictStrategy: 'last-write-wins',
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_UNSHARD_MS)
    })

    it('measures unshard latency by data size', async () => {
      const sizes = [100, 500, 1000]

      for (const size of sizes) {
        const result = await benchmark({
          name: `unshard-size-${size}`,
          target: TARGET,
          iterations: 3,
          warmup: 1,
          datasetSize: size,
          run: async (ctx, iteration) => {
            const namespace = `size-${size}-${testRunId}-${iteration}`

            // Create and populate shards
            await ctx.do.request('/shard', {
              method: 'POST',
              body: JSON.stringify({
                strategy: 'hash',
                shardCount: 4,
                namespace,
                key: 'id',
              }),
            })

            await ctx.do.request('/seed', {
              method: 'POST',
              body: JSON.stringify({ records: size }),
            })

            // Unshard
            return ctx.do.request('/unshard', {
              method: 'POST',
              body: JSON.stringify({
                namespace,
                targetId: `merged-${namespace}`,
              }),
            })
          },
        })

        results.push(result)
      }
    })
  })

  describe('Scatter-Gather Operations', () => {
    it('queries all shards (scatter-gather)', async () => {
      const result = await benchmark({
        name: 'shard-scatter-gather',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        setup: async (ctx) => {
          await ctx.do.request('/shard', {
            method: 'POST',
            body: JSON.stringify({
              strategy: 'hash',
              shardCount: 8,
              namespace: `scatter-${testRunId}`,
              key: 'id',
            }),
          })

          // Seed data across shards
          await ctx.do.request('/seed', {
            method: 'POST',
            body: JSON.stringify({ records: 100 }),
          })
        },
        run: async (ctx) => {
          // Query that requires scatter-gather
          return ctx.do.request<{ results: unknown[]; shardsQueried: number }>('/query/all', {
            method: 'POST',
            body: JSON.stringify({
              filter: { active: true },
              limit: 50,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_SCATTER_GATHER_MS)
    })

    it('aggregates across shards', async () => {
      const result = await benchmark({
        name: 'shard-aggregate',
        target: TARGET,
        iterations: ITERATIONS,
        warmup: WARMUP,
        run: async (ctx) => {
          // Aggregate query (sum, count, avg)
          return ctx.do.request<{ sum: number; count: number; avg: number }>('/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              field: 'amount',
              operations: ['sum', 'count', 'avg'],
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_SCATTER_GATHER_MS)
    })
  })

  describe('Shard Rebalancing', () => {
    it('rebalances shards', async () => {
      const result = await benchmark({
        name: 'shard-rebalance',
        target: TARGET,
        iterations: 5,
        warmup: 1,
        run: async (ctx, iteration) => {
          const namespace = `rebalance-${testRunId}-${iteration}`

          // Create initial shards
          await ctx.do.request('/shard', {
            method: 'POST',
            body: JSON.stringify({
              strategy: 'hash',
              shardCount: 4,
              namespace,
              key: 'id',
            }),
          })

          // Add some data
          await ctx.do.request('/seed', {
            method: 'POST',
            body: JSON.stringify({ records: 100 }),
          })

          // Rebalance (change shard count)
          return ctx.do.request('/shard/rebalance', {
            method: 'POST',
            body: JSON.stringify({
              namespace,
              newShardCount: 8,
            }),
          })
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_UNSHARD_MS)
    })

    it('measures key redistribution during rebalance', async () => {
      const result = await benchmark({
        name: 'shard-rebalance-redistribution',
        target: TARGET,
        iterations: 3,
        warmup: 1,
        run: async (ctx, iteration) => {
          const namespace = `redistrib-${testRunId}-${iteration}`

          // Create shards
          await ctx.do.request('/shard', {
            method: 'POST',
            body: JSON.stringify({
              strategy: 'consistent',
              shardCount: 4,
              namespace,
              key: 'id',
            }),
          })

          // Seed data
          await ctx.do.request('/seed', {
            method: 'POST',
            body: JSON.stringify({ records: 500 }),
          })

          // Get distribution before
          const before = await ctx.do.get<{ distribution: number[] }>('/shard/distribution')

          // Rebalance to 8 shards
          await ctx.do.request('/shard/rebalance', {
            method: 'POST',
            body: JSON.stringify({
              namespace,
              newShardCount: 8,
            }),
          })

          // Get distribution after
          const after = await ctx.do.get<{ distribution: number[] }>('/shard/distribution')

          return { before: before.distribution, after: after.distribution }
        },
      })

      results.push(result)
      expect(result.stats.p95).toBeLessThan(MAX_UNSHARD_MS * 1.5)
    })
  })

  describe('Shard Event Handling', () => {
    it('emits sharding lifecycle events', async () => {
      const result = await benchmark({
        name: 'shard-events',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          const namespace = `events-${testRunId}-${iteration}`

          // Subscribe to shard events
          await ctx.do.request('/events/subscribe', {
            method: 'POST',
            body: JSON.stringify({
              events: ['shard.created', 'shard.routing', 'shard.rebalanced'],
            }),
          })

          // Create shards
          await ctx.do.request('/shard', {
            method: 'POST',
            body: JSON.stringify({
              strategy: 'hash',
              shardCount: 4,
              namespace,
              key: 'id',
            }),
          })

          // Check events
          const events = await ctx.do.get<{ events: string[] }>('/events/recent')

          if (!events.events?.includes('shard.created')) {
            throw new Error('shard.created event not emitted')
          }

          return events
        },
      })

      results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })
})
