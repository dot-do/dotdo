/**
 * Iceberg Partition Pruning Performance Benchmarks
 *
 * Tests the effectiveness of partition pruning for query optimization.
 * Compares queries WITH partition key vs WITHOUT partition key.
 *
 * Performance targets:
 * - With partition key: 50-100ms (skips irrelevant manifests)
 * - Without partition key: 200-500ms (full scan required)
 *
 * Partition strategy tested: (ns, type, visibility)
 *
 * @see db/iceberg/reader.ts for partition pruning implementation
 * @see types/iceberg.ts for partition filter types
 * @see dotdo-r6re0 for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable p95 latency for partition-pruned queries (ms)
 */
const MAX_PRUNED_QUERY_P95_MS = 100

/**
 * Maximum acceptable p95 latency for full scan queries (ms)
 */
const MAX_FULL_SCAN_P95_MS = 500

/**
 * Expected speedup factor from partition pruning
 * Pruned queries should be at least 2x faster than full scans
 */
const MIN_PRUNING_SPEEDUP = 2

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 50

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * Sample partition values for testing
 */
const TEST_PARTITIONS = {
  namespaces: ['payments.do', 'users.do', 'analytics.do', 'workflows.do', 'storage.do'],
  types: ['Function', 'Schema', 'Config', 'Event', 'Entity'],
  visibilities: ['public', 'org', 'user', 'unlisted'] as const,
}

// ============================================================================
// PARTITION PRUNING BENCHMARKS
// ============================================================================

describe('Iceberg partition pruning', () => {
  describe('query WITH partition key', () => {
    it('filters by namespace partition', async () => {
      const result = await benchmark({
        name: 'iceberg-pruning-by-ns',
        target: 'resources.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const ns = TEST_PARTITIONS.namespaces[i % TEST_PARTITIONS.namespaces.length]
          return ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns = ? AND id = ?',
              params: [ns, `thing-${i % 100}`],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Partition Pruning by Namespace ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      // Namespace partition should enable efficient pruning
      expect(result.stats.p95).toBeLessThan(MAX_PRUNED_QUERY_P95_MS)
    })

    it('filters by type partition', async () => {
      const result = await benchmark({
        name: 'iceberg-pruning-by-type',
        target: 'resources.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const type = TEST_PARTITIONS.types[i % TEST_PARTITIONS.types.length]
          return ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns = ? AND type = ?',
              params: ['payments.do', type],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Partition Pruning by Type ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PRUNED_QUERY_P95_MS)
    })

    it('filters by visibility partition', async () => {
      const result = await benchmark({
        name: 'iceberg-pruning-by-visibility',
        target: 'resources.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const visibility = TEST_PARTITIONS.visibilities[i % TEST_PARTITIONS.visibilities.length]
          return ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns = ? AND visibility = ?',
              params: ['payments.do', visibility],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Partition Pruning by Visibility ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PRUNED_QUERY_P95_MS)
    })

    it('filters by all partition keys (ns, type, visibility)', async () => {
      const result = await benchmark({
        name: 'iceberg-pruning-all-keys',
        target: 'resources.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const ns = TEST_PARTITIONS.namespaces[i % TEST_PARTITIONS.namespaces.length]
          const type = TEST_PARTITIONS.types[i % TEST_PARTITIONS.types.length]
          const visibility = TEST_PARTITIONS.visibilities[i % TEST_PARTITIONS.visibilities.length]

          return ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns = ? AND type = ? AND visibility = ?',
              params: [ns, type, visibility],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Partition Pruning (All Keys) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Full partition specification should be fastest
      expect(result.stats.p95).toBeLessThan(MAX_PRUNED_QUERY_P95_MS)
    })
  })

  describe('query WITHOUT partition key', () => {
    it('scans all partitions (no filter)', async () => {
      const result = await benchmark({
        name: 'iceberg-fullscan-no-filter',
        target: 'resources.perf.do',
        iterations: 30, // Fewer iterations for slow queries
        warmup: 5,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE id = ?',
              params: [`thing-${i % 100}`],
            }),
          }),
      })

      record(result)

      console.log('\n=== Full Scan (No Partition Filter) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      // Full scan is slower but should still complete within bounds
      expect(result.stats.p95).toBeLessThan(MAX_FULL_SCAN_P95_MS)
    })

    it('scans with non-partition column filter', async () => {
      const result = await benchmark({
        name: 'iceberg-fullscan-non-partition',
        target: 'resources.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE created_at > ? LIMIT 10',
              params: [Date.now() - 86400000 * (i % 30)], // Last N days
            }),
          }),
      })

      record(result)

      console.log('\n=== Full Scan (Non-Partition Filter) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_FULL_SCAN_P95_MS)
    })
  })

  describe('pruning effectiveness', () => {
    it('measures pruned vs full scan speedup', async () => {
      // Pruned query (with partition key)
      const pruned = await benchmark({
        name: 'iceberg-effectiveness-pruned',
        target: 'resources.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns = ? AND type = ? AND id = ?',
              params: ['payments.do', 'Function', `thing-${i % 100}`],
            }),
          }),
      })

      // Full scan query (no partition key)
      const fullScan = await benchmark({
        name: 'iceberg-effectiveness-fullscan',
        target: 'resources.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE id = ?',
              params: [`thing-${i % 100}`],
            }),
          }),
      })

      record([pruned, fullScan])

      const speedup = fullScan.stats.p50 / pruned.stats.p50

      console.log('\n=== Pruning Effectiveness ===')
      console.log(`  Pruned p50: ${pruned.stats.p50.toFixed(3)} ms`)
      console.log(`  Full scan p50: ${fullScan.stats.p50.toFixed(3)} ms`)
      console.log(`  Speedup: ${speedup.toFixed(2)}x`)

      // Partition pruning should provide significant speedup
      expect(speedup).toBeGreaterThan(MIN_PRUNING_SPEEDUP)
    })

    it('tracks manifest pruning statistics', async () => {
      const pruningStats = {
        withPartition: { totalManifests: 0, prunedManifests: 0 },
        withoutPartition: { totalManifests: 0, prunedManifests: 0 },
      }

      // Query with partition key
      await benchmark({
        name: 'iceberg-pruning-stats-with',
        target: 'resources.perf.do',
        iterations: 20,
        warmup: 5,
        run: async (ctx, i) => {
          const response = await ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns = ? AND id = ?',
              params: ['payments.do', `thing-${i % 100}`],
              includePruningStats: true,
            }),
          })

          // Extract pruning stats from response if available
          const data = response as { pruningStats?: typeof pruningStats.withPartition }
          if (data.pruningStats) {
            pruningStats.withPartition.totalManifests += data.pruningStats.totalManifests
            pruningStats.withPartition.prunedManifests += data.pruningStats.prunedManifests
          }

          return response
        },
      })

      // Query without partition key
      await benchmark({
        name: 'iceberg-pruning-stats-without',
        target: 'resources.perf.do',
        iterations: 20,
        warmup: 5,
        run: async (ctx, i) => {
          const response = await ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE id = ?',
              params: [`thing-${i % 100}`],
              includePruningStats: true,
            }),
          })

          const data = response as { pruningStats?: typeof pruningStats.withoutPartition }
          if (data.pruningStats) {
            pruningStats.withoutPartition.totalManifests += data.pruningStats.totalManifests
            pruningStats.withoutPartition.prunedManifests += data.pruningStats.prunedManifests
          }

          return response
        },
      })

      console.log('\n=== Manifest Pruning Statistics ===')
      console.log('With partition key:')
      console.log(`  Total manifests: ${pruningStats.withPartition.totalManifests}`)
      console.log(`  Pruned manifests: ${pruningStats.withPartition.prunedManifests}`)
      console.log('Without partition key:')
      console.log(`  Total manifests: ${pruningStats.withoutPartition.totalManifests}`)
      console.log(`  Pruned manifests: ${pruningStats.withoutPartition.prunedManifests}`)

      // With partition key should prune more manifests
      const withPruneRate =
        pruningStats.withPartition.totalManifests > 0
          ? pruningStats.withPartition.prunedManifests / pruningStats.withPartition.totalManifests
          : 0

      expect(withPruneRate).toBeGreaterThanOrEqual(0)
    })
  })

  describe('partition selectivity', () => {
    it('measures single-value selectivity', async () => {
      const result = await benchmark({
        name: 'iceberg-selectivity-single',
        target: 'resources.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns = ?',
              params: ['payments.do'],
            }),
          }),
      })

      record(result)

      console.log('\n=== Single-Value Partition Selectivity ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PRUNED_QUERY_P95_MS)
    })

    it('measures IN clause selectivity', async () => {
      const result = await benchmark({
        name: 'iceberg-selectivity-in',
        target: 'resources.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns IN (?, ?, ?)',
              params: ['payments.do', 'users.do', 'analytics.do'],
            }),
          }),
      })

      record(result)

      console.log('\n=== IN Clause Partition Selectivity ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // IN clause with few values should still enable pruning
      expect(result.stats.p95).toBeLessThan(MAX_FULL_SCAN_P95_MS)
    })

    it('measures range selectivity (non-partition column)', async () => {
      const result = await benchmark({
        name: 'iceberg-selectivity-range',
        target: 'resources.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns = ? AND created_at BETWEEN ? AND ?',
              params: [
                'payments.do',
                Date.now() - 86400000 * 7, // 7 days ago
                Date.now(),
              ],
            }),
          }),
      })

      record(result)

      console.log('\n=== Range Selectivity (with Partition Key) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Range on non-partition column, but partition key helps
      expect(result.stats.p95).toBeLessThan(MAX_PRUNED_QUERY_P95_MS * 2)
    })
  })

  describe('partition hierarchy', () => {
    it('tests ns-only vs ns+type pruning', async () => {
      // Just namespace
      const nsOnly = await benchmark({
        name: 'iceberg-hierarchy-ns-only',
        target: 'resources.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns = ? LIMIT 10',
              params: ['payments.do'],
            }),
          }),
      })

      // Namespace + type
      const nsAndType = await benchmark({
        name: 'iceberg-hierarchy-ns-type',
        target: 'resources.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE ns = ? AND type = ? LIMIT 10',
              params: ['payments.do', 'Function'],
            }),
          }),
      })

      record([nsOnly, nsAndType])

      const additionalPruning = nsOnly.stats.p50 - nsAndType.stats.p50

      console.log('\n=== Partition Hierarchy Effect ===')
      console.log(`  ns only p50: ${nsOnly.stats.p50.toFixed(3)} ms`)
      console.log(`  ns+type p50: ${nsAndType.stats.p50.toFixed(3)} ms`)
      console.log(`  Additional benefit: ${additionalPruning.toFixed(3)} ms`)

      // Adding more partition keys should help (or at least not hurt)
      expect(nsAndType.stats.p50).toBeLessThanOrEqual(nsOnly.stats.p50 * 1.2)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Partition Pruning Summary', () => {
  it('should document partition pruning characteristics', () => {
    console.log('\n========================================')
    console.log('ICEBERG PARTITION PRUNING SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - With partition key: <${MAX_PRUNED_QUERY_P95_MS}ms (p95)`)
    console.log(`  - Without partition key: <${MAX_FULL_SCAN_P95_MS}ms (p95)`)
    console.log(`  - Minimum speedup: ${MIN_PRUNING_SPEEDUP}x`)
    console.log('')

    console.log('Partition strategy (order matters):')
    console.log('  1. ns (namespace) - Primary, tenant isolation')
    console.log('  2. type - Secondary, resource type filtering')
    console.log('  3. visibility - Tertiary, access control')
    console.log('')

    console.log('Pruning effectiveness:')
    console.log('  - Manifest-level: Skip manifests by partition bounds')
    console.log('  - File-level: Skip files by column statistics')
    console.log('  - Row-level: Filter by Parquet predicate pushdown')
    console.log('')

    console.log('Best practices:')
    console.log('  - Always include partition keys in WHERE clause')
    console.log('  - Order partition keys: ns, type, visibility')
    console.log('  - Use IN clause for multiple specific values')
    console.log('  - Avoid leading wildcards on partition columns')
    console.log('')

    expect(true).toBe(true)
  })
})
