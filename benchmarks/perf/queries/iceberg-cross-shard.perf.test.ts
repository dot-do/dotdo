/**
 * Iceberg Cross-Shard Query Performance Benchmarks
 *
 * Tests scatter-gather query patterns across sharded Iceberg tables.
 * Measures overhead of querying multiple shards vs single shard.
 *
 * Performance targets:
 * - Single shard with key: 50-100ms
 * - Scatter-gather 10 shards: 150-300ms
 *
 * Key patterns tested:
 * - Targeted single-shard queries (optimal)
 * - Scatter-gather across all shards
 * - Parallel shard queries
 * - Aggregation overhead
 *
 * @see db/core/shard.ts for shard routing
 * @see dotdo-r6re0 for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable p95 latency for single shard queries (ms)
 */
const MAX_SINGLE_SHARD_P95_MS = 100

/**
 * Maximum acceptable p95 latency for scatter-gather across 10 shards (ms)
 */
const MAX_SCATTER_10_SHARDS_P95_MS = 300

/**
 * Expected overhead per shard in scatter-gather (ms)
 * Due to parallel execution, this should be sub-linear
 */
const EXPECTED_PER_SHARD_OVERHEAD_MS = 15

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 50

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * Sample shard keys for consistent routing
 */
const SHARD_KEYS = Array.from({ length: 20 }, (_, i) => `tenant-${i}`)

/**
 * Sample query types
 */
const QUERY_TYPES = ['count', 'aggregate', 'list', 'lookup']

// ============================================================================
// CROSS-SHARD BENCHMARKS
// ============================================================================

describe('Iceberg cross-shard queries', () => {
  describe('single shard with key', () => {
    it('targeted query to specific shard', async () => {
      const result = await benchmark({
        name: 'iceberg-single-shard-targeted',
        target: 'sharded.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        shardCount: 10,
        run: async (ctx, i) => {
          const shardKey = SHARD_KEYS[i % SHARD_KEYS.length]
          return ctx.do.request(`/iceberg/query?shardKey=${shardKey}`, {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns = ? AND id = ?',
              params: [shardKey, `thing-${i % 100}`],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Single Shard Targeted Query ===')
      console.log(`  Shards: 10`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      // Single shard should be fast
      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_SHARD_P95_MS)
    })

    it('query with explicit shard index', async () => {
      const result = await benchmark({
        name: 'iceberg-single-shard-explicit',
        target: 'sharded.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        shardCount: 10,
        run: async (ctx, i) => {
          const shardIndex = i % 10
          return ctx.do.request(`/iceberg/query?shard=${shardIndex}`, {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE id = ?',
              params: [`thing-${i % 100}`],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Single Shard Explicit Index ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_SHARD_P95_MS)
    })

    it('consistent routing for same key', async () => {
      const testKey = 'consistency-test-tenant'
      const shardsHit = new Set<string>()

      const result = await benchmark({
        name: 'iceberg-single-shard-consistency',
        target: 'sharded.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 10,
        run: async (ctx, i) => {
          const response = await ctx.do.request(`/iceberg/query?shardKey=${testKey}`, {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns = ? LIMIT 1',
              params: [testKey],
            }),
          })

          const data = response as { shard?: number }
          if (data.shard !== undefined) {
            shardsHit.add(String(data.shard))
          }

          return response
        },
      })

      record(result)

      console.log('\n=== Shard Routing Consistency ===')
      console.log(`  Unique shards hit: ${shardsHit.size}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      // Same key should always route to same shard
      expect(shardsHit.size).toBe(1)
    })
  })

  describe('scatter-gather across 10 shards', () => {
    it('aggregation across all shards', async () => {
      const result = await benchmark({
        name: 'iceberg-scatter-10-aggregate',
        target: 'sharded.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 10,
        run: async (ctx) =>
          ctx.do.request('/iceberg/query?scatter=true', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT COUNT(*) as count FROM things',
              aggregate: 'sum', // Sum counts from all shards
            }),
          }),
      })

      record(result)

      console.log('\n=== Scatter-Gather (10 Shards) - Aggregation ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Min: ${result.stats.min.toFixed(3)} ms`)
      console.log(`  Max: ${result.stats.max.toFixed(3)} ms`)

      // Scatter-gather should complete within bounds
      expect(result.stats.p95).toBeLessThan(MAX_SCATTER_10_SHARDS_P95_MS)
    })

    it('list across all shards with limit', async () => {
      const result = await benchmark({
        name: 'iceberg-scatter-10-list',
        target: 'sharded.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 10,
        run: async (ctx) =>
          ctx.do.request('/iceberg/query?scatter=true', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things ORDER BY created_at DESC LIMIT 10',
              merge: 'topN', // Merge results and return top 10
            }),
          }),
      })

      record(result)

      console.log('\n=== Scatter-Gather (10 Shards) - List ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SCATTER_10_SHARDS_P95_MS)
    })

    it('search across all shards', async () => {
      const result = await benchmark({
        name: 'iceberg-scatter-10-search',
        target: 'sharded.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 10,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query?scatter=true', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE name LIKE ? LIMIT 20',
              params: [`%search-term-${i % 10}%`],
              merge: 'concat', // Concatenate results from all shards
            }),
          }),
      })

      record(result)

      console.log('\n=== Scatter-Gather (10 Shards) - Search ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SCATTER_10_SHARDS_P95_MS)
    })
  })

  describe('scatter-gather overhead', () => {
    it('measures overhead vs targeted query', async () => {
      // Targeted single-shard query
      const targeted = await benchmark({
        name: 'iceberg-overhead-targeted',
        target: 'sharded.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        shardCount: 10,
        run: async (ctx, i) =>
          ctx.do.request(`/iceberg/query?shard=${i % 10}`, {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT COUNT(*) FROM things',
            }),
          }),
      })

      // Scatter-gather across all shards
      const scattered = await benchmark({
        name: 'iceberg-overhead-scattered',
        target: 'sharded.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 10,
        run: async (ctx) =>
          ctx.do.request('/iceberg/query?scatter=true', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT COUNT(*) FROM things',
              aggregate: 'sum',
            }),
          }),
      })

      record([targeted, scattered])

      const overheadRatio = scattered.stats.p50 / targeted.stats.p50
      const absoluteOverhead = scattered.stats.p50 - targeted.stats.p50

      console.log('\n=== Scatter-Gather Overhead ===')
      console.log(`  Targeted p50: ${targeted.stats.p50.toFixed(3)} ms`)
      console.log(`  Scattered p50: ${scattered.stats.p50.toFixed(3)} ms`)
      console.log(`  Overhead ratio: ${overheadRatio.toFixed(2)}x`)
      console.log(`  Absolute overhead: ${absoluteOverhead.toFixed(3)} ms`)

      // Scatter-gather should be slower but with parallel execution
      // it should be less than 10x slower for 10 shards
      expect(overheadRatio).toBeLessThan(10)
      expect(overheadRatio).toBeGreaterThan(1)
    })

    it('measures scaling with shard count', async () => {
      const shardCounts = [2, 4, 8, 16]
      const results: Array<{ shards: number; p50: number; p95: number }> = []

      for (const shardCount of shardCounts) {
        const result = await benchmark({
          name: `iceberg-scaling-${shardCount}-shards`,
          target: 'sharded.perf.do',
          iterations: 20,
          warmup: 5,
          shardCount,
          run: async (ctx) =>
            ctx.do.request(`/iceberg/query?scatter=true&shards=${shardCount}`, {
              method: 'POST',
              body: JSON.stringify({
                sql: 'SELECT COUNT(*) FROM things',
                aggregate: 'sum',
              }),
            }),
        })

        results.push({
          shards: shardCount,
          p50: result.stats.p50,
          p95: result.stats.p95,
        })

        record(result)
      }

      console.log('\n=== Scatter-Gather Scaling ===')
      console.log('  Shards | p50 (ms)  | p95 (ms)')
      console.log('  -------|-----------|----------')
      for (const r of results) {
        console.log(
          `  ${r.shards.toString().padStart(6)} | ${r.p50.toFixed(3).padStart(9)} | ${r.p95.toFixed(3).padStart(8)}`
        )
      }

      // Calculate scaling factor
      if (results.length >= 2) {
        const first = results[0]!
        const last = results[results.length - 1]!
        const shardRatio = last.shards / first.shards
        const latencyRatio = last.p50 / first.p50

        console.log(`\n  Shard ratio: ${shardRatio}x`)
        console.log(`  Latency ratio: ${latencyRatio.toFixed(2)}x`)
        console.log(`  Scaling efficiency: ${(shardRatio / latencyRatio).toFixed(2)}`)

        // Latency should scale sub-linearly due to parallel execution
        expect(latencyRatio).toBeLessThan(shardRatio)
      }
    })
  })

  describe('partial scatter', () => {
    it('queries subset of shards', async () => {
      const result = await benchmark({
        name: 'iceberg-partial-scatter',
        target: 'sharded.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        shardCount: 10,
        run: async (ctx, i) => {
          // Query only 3 specific shards
          const shards = [i % 10, (i + 3) % 10, (i + 6) % 10]
          return ctx.do.request('/iceberg/query?scatter=partial', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT COUNT(*) FROM things',
              shards,
              aggregate: 'sum',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Partial Scatter (3 of 10 shards) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Partial scatter should be between single and full scatter
      expect(result.stats.p95).toBeLessThan(MAX_SCATTER_10_SHARDS_P95_MS)
    })

    it('queries shards by key range', async () => {
      const result = await benchmark({
        name: 'iceberg-range-scatter',
        target: 'sharded.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 10,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query?scatter=range', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns >= ? AND ns < ? LIMIT 10',
              params: [`tenant-${(i % 5) * 2}`, `tenant-${(i % 5) * 2 + 2}`],
            }),
          }),
      })

      record(result)

      console.log('\n=== Range-Based Scatter ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SCATTER_10_SHARDS_P95_MS)
    })
  })

  describe('aggregation patterns', () => {
    it('sum aggregation', async () => {
      const result = await benchmark({
        name: 'iceberg-aggregate-sum',
        target: 'sharded.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 10,
        run: async (ctx) =>
          ctx.do.request('/iceberg/query?scatter=true', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT SUM(amount) as total FROM transactions',
              aggregate: 'sum',
            }),
          }),
      })

      record(result)

      console.log('\n=== SUM Aggregation ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SCATTER_10_SHARDS_P95_MS)
    })

    it('count distinct aggregation', async () => {
      const result = await benchmark({
        name: 'iceberg-aggregate-distinct',
        target: 'sharded.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 10,
        run: async (ctx) =>
          ctx.do.request('/iceberg/query?scatter=true', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT COUNT(DISTINCT user_id) as users FROM events',
              aggregate: 'hll_union', // HyperLogLog union for approximate distinct
            }),
          }),
      })

      record(result)

      console.log('\n=== COUNT DISTINCT Aggregation ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SCATTER_10_SHARDS_P95_MS)
    })

    it('group by aggregation', async () => {
      const result = await benchmark({
        name: 'iceberg-aggregate-groupby',
        target: 'sharded.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 10,
        run: async (ctx) =>
          ctx.do.request('/iceberg/query?scatter=true', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT type, COUNT(*) as count FROM things GROUP BY type',
              aggregate: 'merge_groupby', // Merge grouped results
            }),
          }),
      })

      record(result)

      console.log('\n=== GROUP BY Aggregation ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SCATTER_10_SHARDS_P95_MS)
    })
  })

  describe('concurrent shard access', () => {
    it('parallel queries to different shards', async () => {
      const concurrency = 5
      const iterationsPerWorker = 20

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `iceberg-concurrent-worker-${workerIndex}`,
            target: 'sharded.perf.do',
            iterations: iterationsPerWorker,
            warmup: 3,
            shardCount: 10,
            run: async (ctx, i) => {
              const shard = (workerIndex * 2 + i) % 10
              return ctx.do.request(`/iceberg/query?shard=${shard}`, {
                method: 'POST',
                body: JSON.stringify({
                  sql: 'SELECT * FROM things LIMIT 10',
                }),
              })
            },
          })
        )
      )

      record(results)

      console.log('\n=== Concurrent Shard Access ===')
      console.log(`  Workers: ${concurrency}`)
      console.log(`  Iterations per worker: ${iterationsPerWorker}`)

      const allP50s = results.map((r) => r.stats.p50)
      const meanP50 = allP50s.reduce((a, b) => a + b, 0) / allP50s.length
      const maxP50 = Math.max(...allP50s)

      console.log(`  Mean p50: ${meanP50.toFixed(3)} ms`)
      console.log(`  Max p50: ${maxP50.toFixed(3)} ms`)

      // Concurrent access should not dramatically increase latency
      expect(maxP50).toBeLessThan(MAX_SINGLE_SHARD_P95_MS * 2)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Cross-Shard Summary', () => {
  it('should document cross-shard performance characteristics', () => {
    console.log('\n========================================')
    console.log('ICEBERG CROSS-SHARD QUERY SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - Single shard with key: <${MAX_SINGLE_SHARD_P95_MS}ms (p95)`)
    console.log(`  - Scatter-gather 10 shards: <${MAX_SCATTER_10_SHARDS_P95_MS}ms (p95)`)
    console.log('')

    console.log('Query patterns:')
    console.log('  - Targeted: Route to specific shard by key')
    console.log('  - Scatter-gather: Query all shards in parallel')
    console.log('  - Partial scatter: Query subset of shards')
    console.log('  - Range scatter: Query shards by key range')
    console.log('')

    console.log('Aggregation types:')
    console.log('  - sum: Add numeric values from all shards')
    console.log('  - topN: Merge and return top N results')
    console.log('  - hll_union: Approximate distinct count')
    console.log('  - merge_groupby: Combine grouped results')
    console.log('')

    console.log('Scaling characteristics:')
    console.log('  - Parallel execution: Sub-linear latency growth')
    console.log(`  - Per-shard overhead: ~${EXPECTED_PER_SHARD_OVERHEAD_MS}ms`)
    console.log('  - Aggregation overhead: Minimal (in-memory)')
    console.log('')

    console.log('Best practices:')
    console.log('  - Use targeted queries when shard key is known')
    console.log('  - Limit scatter-gather result sizes')
    console.log('  - Use approximate algorithms for large datasets')
    console.log('  - Consider partial scatter for selective queries')
    console.log('')

    expect(true).toBe(true)
  })
})
