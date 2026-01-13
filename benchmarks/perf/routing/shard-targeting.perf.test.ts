/**
 * Shard Targeting Performance Benchmarks
 *
 * Tests routing performance for explicit shard targeting via query strings:
 * - ?shard=N - Direct shard index routing
 * - ?shardKey=X - Hash-based routing by key
 * - ?scatter=true - Scatter-gather across all shards
 *
 * @see db/core/shard.ts for implementation
 * @see dotdo-gj6wa for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('shard targeting', () => {
  describe('explicit shard via ?shard=N', () => {
    it.each([0, 1, 2, 3, 4])('routes to shard %d', async (shardIndex) => {
      const result = await benchmark({
        name: `shard-explicit-${shardIndex}`,
        target: 'sharded.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          return ctx.fetch(`/query?shard=${shardIndex}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: 'SELECT COUNT(*) FROM things' }),
          })
        },
      })

      record(result)

      // Verify benchmark completed successfully
      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeGreaterThan(0)
      expect(result.stats.p99).toBeGreaterThan(0)
    })

    it('maintains consistent latency across all shards', async () => {
      const shardResults: Array<{ shard: number; p50: number; p99: number }> = []

      for (const shardIndex of [0, 1, 2, 3, 4, 5, 6, 7]) {
        const result = await benchmark({
          name: `shard-latency-${shardIndex}`,
          target: 'sharded.perf.do',
          iterations: 30,
          warmup: 5,
          run: async (ctx) => {
            return ctx.fetch(`/query?shard=${shardIndex}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sql: 'SELECT 1' }),
            })
          },
        })

        shardResults.push({
          shard: shardIndex,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })
      }

      // Calculate variance across shards
      const p50Values = shardResults.map((r) => r.p50)
      const p50Mean = p50Values.reduce((a, b) => a + b, 0) / p50Values.length
      const p50Variance = p50Values.reduce((a, b) => a + Math.pow(b - p50Mean, 2), 0) / p50Values.length
      const p50StdDev = Math.sqrt(p50Variance)
      const p50CV = p50StdDev / p50Mean // Coefficient of variation

      // All shards should have similar latency (CV < 50%)
      expect(p50CV).toBeLessThan(0.5)

      record(
        shardResults.map((r) => ({
          name: `shard-consistency-${r.shard}`,
          target: 'sharded.perf.do',
          iterations: 30,
          stats: { p50: r.p50, p95: r.p99, p99: r.p99, min: 0, max: 0, mean: r.p50, stddev: 0 },
          samples: [],
          timestamp: new Date().toISOString(),
          metadata: { shard: r.shard },
        }))
      )
    })
  })

  describe('hash routing by key', () => {
    it('routes consistently by shardKey', async () => {
      const result = await benchmark({
        name: 'shard-hash-routing',
        target: 'sharded.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const key = `user:${i % 100}`
          return ctx.fetch(`/things/${key}?shardKey=${key}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeGreaterThan(0)
    })

    it('distributes keys evenly across shards', async () => {
      const shardHits: Record<number, number> = {}
      const iterations = 200

      const result = await benchmark({
        name: 'shard-distribution',
        target: 'sharded.perf.do',
        iterations,
        warmup: 10,
        run: async (ctx, i) => {
          const key = `tenant:${crypto.randomUUID()}`
          const response = await ctx.fetch(`/things/${key}?shardKey=${key}`)

          // Track which shard served the request
          const data = (await response.json()) as { shard?: number }
          if (data.shard !== undefined) {
            shardHits[data.shard] = (shardHits[data.shard] || 0) + 1
          }

          return response
        },
      })

      record(result)

      // Calculate distribution metrics
      const shards = Object.keys(shardHits).map(Number)
      const counts = Object.values(shardHits)

      if (shards.length > 1) {
        const mean = iterations / shards.length
        const variance = counts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / counts.length
        const cv = Math.sqrt(variance) / mean

        // Distribution should be reasonably even (CV < 50%)
        expect(cv).toBeLessThan(0.5)
      }
    })

    it('same key always routes to same shard', async () => {
      const testKey = 'consistency-test-key'
      const shardsHit = new Set<string>()

      await benchmark({
        name: 'shard-consistency-check',
        target: 'sharded.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          const response = await ctx.fetch(`/things/${testKey}?shardKey=${testKey}`)
          const data = (await response.json()) as { shard?: number }
          if (data.shard !== undefined) {
            shardsHit.add(String(data.shard))
          }
          return response
        },
      })

      // Same key should always route to same shard
      expect(shardsHit.size).toBe(1)
    })
  })

  describe('scatter-gather', () => {
    it('measures scatter-gather overhead vs targeted', async () => {
      const scatter = await benchmark({
        name: 'shard-scatter-gather',
        target: 'sharded.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) =>
          ctx.fetch('/query?scatter=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: 'SELECT COUNT(*) FROM things' }),
          }),
      })

      const targeted = await benchmark({
        name: 'shard-targeted',
        target: 'sharded.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) =>
          ctx.fetch('/query?shard=0', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: 'SELECT COUNT(*) FROM things' }),
          }),
      })

      record([scatter, targeted])

      // Scatter-gather should be slower than targeted
      // but not excessively so due to parallel execution
      const overheadRatio = scatter.stats.p50 / targeted.stats.p50
      expect(overheadRatio).toBeGreaterThan(1)
      // Should be less than 10x even for many shards (parallel execution)
      expect(overheadRatio).toBeLessThan(10)
    })

    it('scatter-gather scales with shard count', async () => {
      const shardCounts = [2, 4, 8]
      const results: Array<{ shards: number; p50: number; p99: number }> = []

      for (const shardCount of shardCounts) {
        const result = await benchmark({
          name: `scatter-gather-${shardCount}-shards`,
          target: 'sharded.perf.do',
          iterations: 20,
          warmup: 5,
          shardCount,
          run: async (ctx) =>
            ctx.fetch(`/query?scatter=true&shards=${shardCount}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sql: 'SELECT COUNT(*) FROM things' }),
            }),
        })

        results.push({
          shards: shardCount,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })

        record(result)
      }

      // Latency should scale sub-linearly (parallel execution)
      // Going from 2 to 8 shards (4x) should not be 4x slower
      if (results.length >= 2) {
        const ratio = results[results.length - 1]!.p50 / results[0]!.p50
        const shardRatio = results[results.length - 1]!.shards / results[0]!.shards
        expect(ratio).toBeLessThan(shardRatio)
      }
    })

    it('aggregates results correctly', async () => {
      const result = await benchmark({
        name: 'scatter-gather-aggregation',
        target: 'sharded.perf.do',
        iterations: 20,
        warmup: 5,
        run: async (ctx) => {
          const response = await ctx.fetch('/query?scatter=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: 'SELECT COUNT(*) FROM things' }),
          })

          const data = (await response.json()) as {
            results?: Array<{ count: number }>
            aggregated?: { totalCount: number }
          }

          // Verify aggregation structure
          expect(data.results).toBeDefined()
          expect(Array.isArray(data.results)).toBe(true)

          return response
        },
      })

      record(result)
    })
  })

  describe('shard failover', () => {
    it('handles unavailable shard gracefully', async () => {
      const result = await benchmark({
        name: 'shard-failover',
        target: 'sharded.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          // Request with failover flag
          const response = await ctx.fetch('/query?shard=999&failover=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: 'SELECT 1' }),
          })

          // Should either succeed with fallback or return graceful error
          expect(response.status).toBeLessThan(500)
          return response
        },
      })

      record(result)

      // Verify no unhandled errors
      expect(result.errors?.length ?? 0).toBe(0)
    })
  })

  describe('shard rebalancing under load', () => {
    it('maintains performance during concurrent access', async () => {
      const concurrency = 10
      const iterationsPerWorker = 20

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `shard-concurrent-${workerIndex}`,
            target: 'sharded.perf.do',
            iterations: iterationsPerWorker,
            warmup: 2,
            run: async (ctx, i) => {
              const shardIndex = (workerIndex + i) % 8
              return ctx.fetch(`/query?shard=${shardIndex}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: 'SELECT 1' }),
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
