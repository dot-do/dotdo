/**
 * Iceberg Manifest Navigation Performance Benchmarks
 *
 * Tests performance of manifest chain navigation including:
 * - Navigating manifest chain from snapshot
 * - Discovering data files within manifests
 * - Reading with caching strategies
 * - Multi-manifest traversal
 *
 * Expected performance:
 * - Manifest navigation: <30ms
 * - Data file discovery: <20ms
 * - Cached navigation: <10ms
 *
 * @see db/iceberg/manifest.ts for implementation
 * @see dotdo-6vjve for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record, type BenchmarkResult } from '../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Maximum acceptable latency for manifest chain navigation (ms) */
const MAX_MANIFEST_NAVIGATION_P50_MS = 30

/** Maximum acceptable latency for data file discovery (ms) */
const MAX_DATA_FILE_DISCOVERY_P50_MS = 20

/** Maximum acceptable latency for cached navigation (ms) */
const MAX_CACHED_NAVIGATION_P50_MS = 10

/** Default iterations for benchmarks */
const DEFAULT_ITERATIONS = 50

/** Warmup iterations */
const WARMUP_ITERATIONS = 5

// ============================================================================
// MANIFEST NAVIGATION BENCHMARKS
// ============================================================================

describe('Manifest navigation benchmarks', () => {
  describe('navigate manifest chain', () => {
    it('navigates manifest chain from current snapshot', async () => {
      const result = await benchmark({
        name: 'iceberg-navigate-manifest-chain',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/navigate/manifest-chain', {
            method: 'POST',
            body: JSON.stringify({
              table: 'warehouse/db/things',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Manifest Chain Navigation ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_MANIFEST_NAVIGATION_P50_MS)
    })

    it('navigates to specific snapshot', async () => {
      const result = await benchmark({
        name: 'iceberg-navigate-snapshot',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/navigate/snapshot', {
            method: 'POST',
            body: JSON.stringify({
              table: 'warehouse/db/things',
              snapshotId: 123456789,
            }),
          })
        },
      })

      record(result)

      expect(result.stats.p50).toBeLessThan(MAX_MANIFEST_NAVIGATION_P50_MS)
    })

    it('navigates chain with varying manifest counts', async () => {
      const manifestCounts = [1, 5, 20]
      const results: Array<{ manifests: number; p50: number; p99: number }> = []

      for (const manifestCount of manifestCounts) {
        const result = await benchmark({
          name: `iceberg-navigate-${manifestCount}-manifests`,
          target: 'iceberg.perf.do',
          iterations: 30,
          warmup: 3,
          run: async (ctx) => {
            return ctx.do.request('/iceberg/navigate/manifest-chain', {
              method: 'POST',
              body: JSON.stringify({
                table: `test/table-${manifestCount}-manifests`,
                manifestCount,
              }),
            })
          },
        })

        results.push({
          manifests: manifestCount,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })

        record(result)
      }

      console.log('\n=== Navigation by Manifest Count ===')
      console.log('  Manifests | p50 (ms) | p99 (ms)')
      console.log('  ----------|----------|----------')
      for (const r of results) {
        console.log(
          `  ${r.manifests.toString().padStart(9)} | ${r.p50.toFixed(3).padStart(8)} | ${r.p99.toFixed(3).padStart(8)}`
        )
      }

      // Navigation should scale sub-linearly with manifest count
      // due to partition pruning eliminating most manifests
      if (results.length >= 2 && results[0]!.p50 > 0) {
        const ratio = results[results.length - 1]!.p50 / results[0]!.p50
        const manifestRatio = results[results.length - 1]!.manifests / results[0]!.manifests
        expect(ratio).toBeLessThan(manifestRatio) // Better than linear
      }
    })
  })

  describe('discover data files', () => {
    it('discovers data files from manifest', async () => {
      const result = await benchmark({
        name: 'iceberg-discover-data-files',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/navigate/data-files', {
            method: 'POST',
            body: JSON.stringify({
              manifest: 'warehouse/db/table/metadata/manifest-1.avro',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Data File Discovery ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_DATA_FILE_DISCOVERY_P50_MS)
    })

    it('discovers files with partition filter', async () => {
      const result = await benchmark({
        name: 'iceberg-discover-filtered',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/navigate/data-files', {
            method: 'POST',
            body: JSON.stringify({
              manifest: 'warehouse/db/table/metadata/manifest-1.avro',
              filter: {
                ns: 'payments.do',
                type: 'Function',
              },
            }),
          })
        },
      })

      record(result)

      // Filtered discovery should be faster than unfiltered
      expect(result.stats.p50).toBeLessThan(MAX_DATA_FILE_DISCOVERY_P50_MS)
    })

    it('discovers files with varying file counts', async () => {
      const fileCounts = [10, 100, 1000]
      const results: Array<{ files: number; p50: number }> = []

      for (const fileCount of fileCounts) {
        const result = await benchmark({
          name: `iceberg-discover-${fileCount}-files`,
          target: 'iceberg.perf.do',
          iterations: 30,
          warmup: 3,
          run: async (ctx) => {
            return ctx.do.request('/iceberg/navigate/data-files', {
              method: 'POST',
              body: JSON.stringify({
                manifest: `test/manifest-${fileCount}-files.avro`,
                fileCount,
              }),
            })
          },
        })

        results.push({
          files: fileCount,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Discovery by File Count ===')
      for (const r of results) {
        console.log(`  ${r.files} files: ${r.p50.toFixed(3)} ms`)
      }
    })
  })

  describe('read with caching', () => {
    it('measures caching impact on navigation', async () => {
      // Uncached read (cold)
      const uncached = await benchmark({
        name: 'iceberg-navigate-uncached',
        target: 'iceberg.perf.do',
        iterations: 20,
        warmup: 0,
        coldStart: true,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/navigate/manifest-chain', {
            method: 'POST',
            body: JSON.stringify({
              table: `test/table-${Date.now()}`,
              noCache: true,
            }),
          })
        },
      })

      // Cached read (warm)
      const cached = await benchmark({
        name: 'iceberg-navigate-cached',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/navigate/manifest-chain', {
            method: 'POST',
            body: JSON.stringify({
              table: 'test/table-cached',
            }),
          })
        },
      })

      record([uncached, cached])

      console.log('\n=== Cached vs Uncached Navigation ===')
      console.log(`  Uncached p50: ${uncached.stats.p50.toFixed(3)} ms`)
      console.log(`  Cached p50: ${cached.stats.p50.toFixed(3)} ms`)

      const speedup = uncached.stats.p50 > 0 ? uncached.stats.p50 / cached.stats.p50 : 0
      console.log(`  Speedup: ${speedup.toFixed(2)}x`)

      expect(cached.stats.p50).toBeLessThan(MAX_CACHED_NAVIGATION_P50_MS)
      // Only check relative performance if we have actual latency data
      if (uncached.stats.p50 > 0 && cached.stats.p50 > 0) {
        expect(cached.stats.p50).toBeLessThan(uncached.stats.p50)
      }
    })

    it('measures cache hit rate impact', async () => {
      // Mixed cache scenario
      const result = await benchmark({
        name: 'iceberg-navigate-mixed-cache',
        target: 'iceberg.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          // Alternate between cached and uncached requests
          const table = iteration % 2 === 0 ? 'test/table-cached' : `test/table-${iteration}`

          return ctx.do.request('/iceberg/navigate/manifest-chain', {
            method: 'POST',
            body: JSON.stringify({ table }),
          })
        },
      })

      record(result)

      // Mixed cache should be between cached and uncached performance
      expect(result.stats.p50).toBeLessThan(MAX_MANIFEST_NAVIGATION_P50_MS)
    })
  })

  describe('multi-manifest traversal', () => {
    it('traverses multiple manifests in parallel', async () => {
      const result = await benchmark({
        name: 'iceberg-parallel-manifest-traversal',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 3,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/navigate/parallel-manifests', {
            method: 'POST',
            body: JSON.stringify({
              table: 'warehouse/db/things',
              manifestPaths: [
                'metadata/manifest-1.avro',
                'metadata/manifest-2.avro',
                'metadata/manifest-3.avro',
              ],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Parallel Manifest Traversal ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      // Parallel traversal should not be much slower than single manifest
      expect(result.stats.p50).toBeLessThan(MAX_MANIFEST_NAVIGATION_P50_MS * 2)
    })

    it('compares sequential vs parallel traversal', async () => {
      const sequential = await benchmark({
        name: 'iceberg-sequential-traversal',
        target: 'iceberg.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/navigate/sequential-manifests', {
            method: 'POST',
            body: JSON.stringify({
              table: 'test/table-multi-manifest',
              manifestCount: 5,
            }),
          })
        },
      })

      const parallel = await benchmark({
        name: 'iceberg-parallel-traversal',
        target: 'iceberg.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/navigate/parallel-manifests', {
            method: 'POST',
            body: JSON.stringify({
              table: 'test/table-multi-manifest',
              manifestCount: 5,
            }),
          })
        },
      })

      record([sequential, parallel])

      console.log('\n=== Sequential vs Parallel ===')
      console.log(`  Sequential p50: ${sequential.stats.p50.toFixed(3)} ms`)
      console.log(`  Parallel p50: ${parallel.stats.p50.toFixed(3)} ms`)

      // Parallel should be faster for multiple manifests
      // Only check relative performance if we have actual latency data
      if (sequential.stats.p50 > 0 && parallel.stats.p50 > 0) {
        expect(parallel.stats.p50).toBeLessThan(sequential.stats.p50)
      }
    })
  })

  describe('end-to-end navigation', () => {
    it('navigates from metadata to data file paths', async () => {
      const result = await benchmark({
        name: 'iceberg-e2e-navigation',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/navigate/e2e', {
            method: 'POST',
            body: JSON.stringify({
              table: 'warehouse/db/things',
              partition: {
                ns: 'payments.do',
                type: 'Function',
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n=== End-to-End Navigation ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      // E2E should complete within combined expectations
      const combinedExpected = MAX_MANIFEST_NAVIGATION_P50_MS + MAX_DATA_FILE_DISCOVERY_P50_MS
      expect(result.stats.p50).toBeLessThan(combinedExpected)
    })

    it('measures navigation consistency', async () => {
      const results: BenchmarkResult[] = []

      // Run multiple batches to check consistency
      for (let batch = 0; batch < 5; batch++) {
        const result = await benchmark({
          name: `iceberg-navigation-batch-${batch}`,
          target: 'iceberg.perf.do',
          iterations: 20,
          warmup: 2,
          run: async (ctx) => {
            return ctx.do.request('/iceberg/navigate/e2e', {
              method: 'POST',
              body: JSON.stringify({
                table: 'warehouse/db/things',
              }),
            })
          },
        })
        results.push(result)
      }

      record(results)

      // Calculate variance across batches
      const p50s = results.map((r) => r.stats.p50)
      const p50Mean = p50s.reduce((a, b) => a + b, 0) / p50s.length
      const p50Variance = p50s.reduce((a, b) => a + Math.pow(b - p50Mean, 2), 0) / p50s.length
      const p50StdDev = Math.sqrt(p50Variance)
      const cv = p50Mean > 0 ? p50StdDev / p50Mean : 0

      console.log('\n=== Navigation Consistency ===')
      console.log(`  Mean p50: ${p50Mean.toFixed(3)} ms`)
      console.log(`  StdDev: ${p50StdDev.toFixed(3)} ms`)
      console.log(`  CV: ${(cv * 100).toFixed(1)}%`)

      // Navigation should be consistent (CV < 30%)
      expect(cv).toBeLessThan(0.3)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Manifest Navigation Summary', () => {
  it('should document expected performance', () => {
    console.log('\n========================================')
    console.log('MANIFEST NAVIGATION PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Expected benchmarks:')
    console.log(`  - Manifest navigation: <${MAX_MANIFEST_NAVIGATION_P50_MS}ms`)
    console.log(`  - Data file discovery: <${MAX_DATA_FILE_DISCOVERY_P50_MS}ms`)
    console.log(`  - Cached navigation: <${MAX_CACHED_NAVIGATION_P50_MS}ms`)
    console.log('')

    console.log('Navigation chain:')
    console.log('  1. metadata.json -> current-snapshot-id -> manifest-list path')
    console.log('  2. manifest-list.avro -> filter by partition -> manifest paths')
    console.log('  3. manifest-file.avro -> filter by partition -> data file paths')
    console.log('  4. data-file.parquet -> read record')
    console.log('')

    console.log('Key optimizations:')
    console.log('  - Partition summary pruning at manifest-list level')
    console.log('  - Parallel manifest file fetching')
    console.log('  - Metadata caching with TTL')
    console.log('  - Range requests for manifest headers')
    console.log('')

    expect(true).toBe(true)
  })
})
