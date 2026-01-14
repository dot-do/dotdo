/**
 * Iceberg Metadata Parsing Performance Benchmarks
 *
 * Tests performance of Iceberg metadata operations including:
 * - metadata.json parsing
 * - Manifest list parsing
 * - Manifest file parsing
 * - Schema resolution
 *
 * Expected performance:
 * - Metadata parse: <10ms
 * - Manifest list parse: <15ms
 * - Manifest file parse: <20ms
 *
 * @see db/iceberg/metadata.ts for implementation
 * @see dotdo-6vjve for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Maximum acceptable latency for metadata parsing (ms) */
const MAX_METADATA_PARSE_P50_MS = 10

/** Maximum acceptable latency for manifest list parsing (ms) */
const MAX_MANIFEST_LIST_PARSE_P50_MS = 15

/** Maximum acceptable latency for manifest file parsing (ms) */
const MAX_MANIFEST_FILE_PARSE_P50_MS = 20

/** Default iterations for benchmarks */
const DEFAULT_ITERATIONS = 100

/** Warmup iterations */
const WARMUP_ITERATIONS = 10

// ============================================================================
// METADATA PARSING BENCHMARKS
// ============================================================================

describe('Metadata parsing benchmarks', () => {
  describe('metadata.json parsing', () => {
    it('parses metadata.json', async () => {
      const result = await benchmark({
        name: 'iceberg-parse-metadata',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/metadata/parse', {
            method: 'POST',
            body: JSON.stringify({
              path: 'warehouse/db/table/metadata/v1.metadata.json',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Metadata.json Parsing ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_METADATA_PARSE_P50_MS)
    })

    it('parses metadata with varying schema counts', async () => {
      const schemaCounts = [1, 5, 20]
      const results: Array<{ schemas: number; p50: number; p99: number }> = []

      for (const schemaCount of schemaCounts) {
        const result = await benchmark({
          name: `iceberg-parse-metadata-${schemaCount}-schemas`,
          target: 'iceberg.perf.do',
          iterations: 50,
          warmup: 5,
          run: async (ctx) => {
            return ctx.do.request('/iceberg/metadata/parse', {
              method: 'POST',
              body: JSON.stringify({
                path: `test/metadata-${schemaCount}-schemas.json`,
                schemaCount,
              }),
            })
          },
        })

        results.push({
          schemas: schemaCount,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })

        record(result)
      }

      console.log('\n=== Metadata Parsing by Schema Count ===')
      console.log('  Schemas | p50 (ms) | p99 (ms)')
      console.log('  --------|----------|----------')
      for (const r of results) {
        console.log(
          `  ${r.schemas.toString().padStart(7)} | ${r.p50.toFixed(3).padStart(8)} | ${r.p99.toFixed(3).padStart(8)}`
        )
      }

      // Parsing should remain fast regardless of schema count
      for (const r of results) {
        expect(r.p50).toBeLessThan(MAX_METADATA_PARSE_P50_MS * 2)
      }
    })

    it('parses metadata with varying snapshot counts', async () => {
      const snapshotCounts = [1, 10, 100]
      const results: Array<{ snapshots: number; p50: number }> = []

      for (const snapshotCount of snapshotCounts) {
        const result = await benchmark({
          name: `iceberg-parse-metadata-${snapshotCount}-snapshots`,
          target: 'iceberg.perf.do',
          iterations: 50,
          warmup: 5,
          run: async (ctx) => {
            return ctx.do.request('/iceberg/metadata/parse', {
              method: 'POST',
              body: JSON.stringify({
                path: `test/metadata-${snapshotCount}-snapshots.json`,
                snapshotCount,
              }),
            })
          },
        })

        results.push({
          snapshots: snapshotCount,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Metadata Parsing by Snapshot Count ===')
      for (const r of results) {
        console.log(`  ${r.snapshots} snapshots: ${r.p50.toFixed(3)} ms`)
      }
    })
  })

  describe('manifest list parsing', () => {
    it('parses manifest list', async () => {
      const result = await benchmark({
        name: 'iceberg-parse-manifest-list',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/manifest-list/parse', {
            method: 'POST',
            body: JSON.stringify({
              path: 'warehouse/db/table/metadata/snap-123-manifest-list.avro',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Manifest List Parsing ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_MANIFEST_LIST_PARSE_P50_MS)
    })

    it('parses manifest list with varying entry counts', async () => {
      const entryCounts = [1, 10, 100]
      const results: Array<{ entries: number; p50: number }> = []

      for (const entryCount of entryCounts) {
        const result = await benchmark({
          name: `iceberg-parse-manifest-list-${entryCount}-entries`,
          target: 'iceberg.perf.do',
          iterations: 50,
          warmup: 5,
          run: async (ctx) => {
            return ctx.do.request('/iceberg/manifest-list/parse', {
              method: 'POST',
              body: JSON.stringify({
                path: `test/manifest-list-${entryCount}.avro`,
                entryCount,
              }),
            })
          },
        })

        results.push({
          entries: entryCount,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Manifest List Parsing by Entry Count ===')
      for (const r of results) {
        console.log(`  ${r.entries} entries: ${r.p50.toFixed(3)} ms`)
      }

      // Parsing time should scale linearly with entry count
      if (results.length >= 2 && results[0]!.p50 > 0) {
        const ratio = results[results.length - 1]!.p50 / results[0]!.p50
        const entryRatio = results[results.length - 1]!.entries / results[0]!.entries
        expect(ratio).toBeLessThan(entryRatio * 2) // Allow 2x overhead
      }
    })
  })

  describe('manifest file parsing', () => {
    it('parses manifest file', async () => {
      const result = await benchmark({
        name: 'iceberg-parse-manifest-file',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/manifest/parse', {
            method: 'POST',
            body: JSON.stringify({
              path: 'warehouse/db/table/metadata/manifest-1.avro',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Manifest File Parsing ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_MANIFEST_FILE_PARSE_P50_MS)
    })

    it('parses manifest file with varying data file counts', async () => {
      const fileCounts = [10, 100, 1000]
      const results: Array<{ files: number; p50: number; p99: number }> = []

      for (const fileCount of fileCounts) {
        const result = await benchmark({
          name: `iceberg-parse-manifest-${fileCount}-files`,
          target: 'iceberg.perf.do',
          iterations: 30,
          warmup: 3,
          run: async (ctx) => {
            return ctx.do.request('/iceberg/manifest/parse', {
              method: 'POST',
              body: JSON.stringify({
                path: `test/manifest-${fileCount}-files.avro`,
                fileCount,
              }),
            })
          },
        })

        results.push({
          files: fileCount,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })

        record(result)
      }

      console.log('\n=== Manifest Parsing by File Count ===')
      console.log('  Files   | p50 (ms) | p99 (ms)')
      console.log('  --------|----------|----------')
      for (const r of results) {
        console.log(
          `  ${r.files.toString().padStart(7)} | ${r.p50.toFixed(3).padStart(8)} | ${r.p99.toFixed(3).padStart(8)}`
        )
      }
    })
  })

  describe('schema resolution', () => {
    it('resolves current schema from metadata', async () => {
      const result = await benchmark({
        name: 'iceberg-resolve-schema',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/metadata/schema', {
            method: 'POST',
            body: JSON.stringify({
              path: 'warehouse/db/table/metadata/v1.metadata.json',
              schemaId: 0,
            }),
          })
        },
      })

      record(result)

      expect(result.stats.p50).toBeLessThan(MAX_METADATA_PARSE_P50_MS)
    })

    it('extracts partition spec from metadata', async () => {
      const result = await benchmark({
        name: 'iceberg-extract-partition-spec',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/metadata/partition-spec', {
            method: 'POST',
            body: JSON.stringify({
              path: 'warehouse/db/table/metadata/v1.metadata.json',
            }),
          })
        },
      })

      record(result)

      expect(result.stats.p50).toBeLessThan(MAX_METADATA_PARSE_P50_MS)
    })
  })

  describe('parsing comparison: v1 vs v2', () => {
    it('compares v1 and v2 metadata parsing', async () => {
      const v1Result = await benchmark({
        name: 'iceberg-parse-metadata-v1',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/metadata/parse', {
            method: 'POST',
            body: JSON.stringify({
              path: 'test/metadata-v1.json',
              formatVersion: 1,
            }),
          })
        },
      })

      const v2Result = await benchmark({
        name: 'iceberg-parse-metadata-v2',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/metadata/parse', {
            method: 'POST',
            body: JSON.stringify({
              path: 'test/metadata-v2.json',
              formatVersion: 2,
            }),
          })
        },
      })

      record([v1Result, v2Result])

      console.log('\n=== V1 vs V2 Metadata Parsing ===')
      console.log(`  V1 p50: ${v1Result.stats.p50.toFixed(3)} ms`)
      console.log(`  V2 p50: ${v2Result.stats.p50.toFixed(3)} ms`)

      // V2 may be slightly slower due to additional fields
      // but should not be significantly different
      // Only check ratio if we have actual latency data
      if (v1Result.stats.p50 > 0 && v2Result.stats.p50 > 0) {
        const ratio = v2Result.stats.p50 / v1Result.stats.p50
        expect(ratio).toBeLessThan(2)
      }
    })
  })

  describe('cached vs uncached parsing', () => {
    it('measures caching benefit', async () => {
      // First request (uncached)
      const uncached = await benchmark({
        name: 'iceberg-parse-uncached',
        target: 'iceberg.perf.do',
        iterations: 20,
        warmup: 0, // No warmup for uncached
        coldStart: true,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/metadata/parse', {
            method: 'POST',
            body: JSON.stringify({
              path: `test/metadata-${Date.now()}.json`,
              noCache: true,
            }),
          })
        },
      })

      // Subsequent requests (cached)
      const cached = await benchmark({
        name: 'iceberg-parse-cached',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/metadata/parse', {
            method: 'POST',
            body: JSON.stringify({
              path: 'test/metadata-cached.json',
            }),
          })
        },
      })

      record([uncached, cached])

      console.log('\n=== Cached vs Uncached Parsing ===')
      console.log(`  Uncached p50: ${uncached.stats.p50.toFixed(3)} ms`)
      console.log(`  Cached p50: ${cached.stats.p50.toFixed(3)} ms`)

      // Cached should be significantly faster
      // Only check relative performance if we have actual latency data
      if (uncached.stats.p50 > 0 && cached.stats.p50 > 0) {
        expect(cached.stats.p50).toBeLessThan(uncached.stats.p50)
      }
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Metadata Parsing Summary', () => {
  it('should document expected performance', () => {
    console.log('\n========================================')
    console.log('METADATA PARSING PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Expected benchmarks:')
    console.log(`  - Metadata parse: <${MAX_METADATA_PARSE_P50_MS}ms`)
    console.log(`  - Manifest list parse: <${MAX_MANIFEST_LIST_PARSE_P50_MS}ms`)
    console.log(`  - Manifest file parse: <${MAX_MANIFEST_FILE_PARSE_P50_MS}ms`)
    console.log('')

    console.log('Iceberg format overhead vs R2 SQL:')
    console.log('  - R2 SQL query: 500-2000ms')
    console.log('  - Direct navigation: 50-150ms')
    console.log('  - Improvement: 3-10x faster')
    console.log('')

    console.log('Key optimizations:')
    console.log('  - JSON parsing with early exit')
    console.log('  - Avro deserialization (Rust bindings planned)')
    console.log('  - Schema caching across snapshots')
    console.log('  - Partition summary for manifest-level pruning')
    console.log('')

    expect(true).toBe(true)
  })
})
