/**
 * Puffin Stats Performance Benchmarks
 *
 * Tests performance of Puffin sidecar file operations including:
 * - Stats generation from data files
 * - Column statistics calculation
 * - SetIndex creation for low-cardinality columns
 * - Puffin file serialization
 *
 * Expected performance:
 * - Stats generation: <100ms
 * - Column statistics: <50ms
 * - SetIndex creation: <20ms
 * - Serialization: <30ms
 *
 * @see db/iceberg/puffin.ts for implementation
 * @see dotdo-6vjve for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Maximum acceptable latency for full stats generation (ms) */
const MAX_STATS_GENERATION_P50_MS = 100

/** Maximum acceptable latency for column statistics (ms) */
const MAX_COLUMN_STATS_P50_MS = 50

/** Maximum acceptable latency for SetIndex creation (ms) */
const MAX_SET_INDEX_P50_MS = 20

/** Maximum acceptable latency for serialization (ms) */
const MAX_SERIALIZE_P50_MS = 30

/** Default iterations for benchmarks */
const DEFAULT_ITERATIONS = 50

/** Warmup iterations */
const WARMUP_ITERATIONS = 5

// ============================================================================
// PUFFIN STATS GENERATION BENCHMARKS
// ============================================================================

describe('Puffin stats benchmarks', () => {
  describe('stats generation', () => {
    it('generates stats from data file', async () => {
      const result = await benchmark({
        name: 'puffin-generate-stats',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/puffin/generate', {
            method: 'POST',
            body: JSON.stringify({
              dataFile: 'test-data.parquet',
              columns: ['id', 'name', 'status', 'timestamp'],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Puffin Stats Generation ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_STATS_GENERATION_P50_MS)
    })

    it('generates stats with varying row counts', async () => {
      const rowCounts = [1000, 10000, 100000]
      const results: Array<{ rows: number; p50: number; p99: number }> = []

      for (const rowCount of rowCounts) {
        const result = await benchmark({
          name: `puffin-stats-${rowCount}-rows`,
          target: 'iceberg.perf.do',
          iterations: 30,
          warmup: 3,
          datasetSize: rowCount,
          run: async (ctx) => {
            return ctx.do.request('/iceberg/puffin/generate', {
              method: 'POST',
              body: JSON.stringify({
                dataFile: `test-${rowCount}.parquet`,
                rowCount,
              }),
            })
          },
        })

        results.push({
          rows: rowCount,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })

        record(result)
      }

      console.log('\n=== Stats Generation by Row Count ===')
      console.log('  Rows      | p50 (ms) | p99 (ms)')
      console.log('  ----------|----------|----------')
      for (const r of results) {
        console.log(
          `  ${r.rows.toString().padStart(9)} | ${r.p50.toFixed(3).padStart(8)} | ${r.p99.toFixed(3).padStart(8)}`
        )
      }

      // Stats generation should scale sub-linearly with row count
      // 100x rows should not be 100x slower
      if (results.length >= 2 && results[0]!.p50 > 0) {
        const ratio = results[results.length - 1]!.p50 / results[0]!.p50
        const rowRatio = results[results.length - 1]!.rows / results[0]!.rows
        expect(ratio).toBeLessThan(rowRatio)
      }
    })
  })

  describe('column statistics', () => {
    it('calculates column statistics', async () => {
      const result = await benchmark({
        name: 'puffin-column-stats',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/puffin/column-stats', {
            method: 'POST',
            body: JSON.stringify({
              dataFile: 'test-data.parquet',
              columnId: 3,
              columnType: 'string',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Column Statistics ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_COLUMN_STATS_P50_MS)
    })

    it('calculates bloom filter statistics', async () => {
      const result = await benchmark({
        name: 'puffin-bloom-stats',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/puffin/bloom-stats', {
            method: 'POST',
            body: JSON.stringify({
              columnId: 5,
              expectedElements: 10000,
              falsePositiveRate: 0.01,
            }),
          })
        },
      })

      record(result)

      expect(result.stats.p50).toBeLessThan(MAX_COLUMN_STATS_P50_MS)
    })

    it('calculates ngram bloom filter statistics', async () => {
      const result = await benchmark({
        name: 'puffin-ngram-stats',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/puffin/ngram-stats', {
            method: 'POST',
            body: JSON.stringify({
              columnId: 6,
              expectedElements: 5000,
              ngramSize: 3,
            }),
          })
        },
      })

      record(result)

      expect(result.stats.p50).toBeLessThan(MAX_COLUMN_STATS_P50_MS)
    })
  })

  describe('SetIndex creation', () => {
    it('creates SetIndex for low-cardinality column', async () => {
      const result = await benchmark({
        name: 'puffin-set-index',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/puffin/set-index', {
            method: 'POST',
            body: JSON.stringify({
              columnId: 7,
              values: ['active', 'pending', 'completed', 'cancelled', 'failed'],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== SetIndex Creation ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_SET_INDEX_P50_MS)
    })

    it('creates SetIndex with varying cardinalities', async () => {
      const cardinalities = [5, 50, 500]
      const results: Array<{ cardinality: number; p50: number }> = []

      for (const cardinality of cardinalities) {
        const values = Array.from({ length: cardinality }, (_, i) => `value-${i}`)

        const result = await benchmark({
          name: `puffin-set-index-${cardinality}`,
          target: 'iceberg.perf.do',
          iterations: 30,
          warmup: 3,
          run: async (ctx) => {
            return ctx.do.request('/iceberg/puffin/set-index', {
              method: 'POST',
              body: JSON.stringify({
                columnId: 7,
                values,
              }),
            })
          },
        })

        results.push({
          cardinality,
          p50: result.stats.p50,
        })

        record(result)
      }

      // SetIndex should scale linearly with cardinality for reasonable sizes
      console.log('\n=== SetIndex by Cardinality ===')
      for (const r of results) {
        console.log(`  ${r.cardinality} values: ${r.p50.toFixed(3)} ms`)
      }
    })
  })

  describe('Puffin file serialization', () => {
    it('serializes puffin file', async () => {
      const result = await benchmark({
        name: 'puffin-serialize',
        target: 'iceberg.perf.do',
        iterations: DEFAULT_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/puffin/serialize', {
            method: 'POST',
            body: JSON.stringify({
              snapshotId: 123456789,
              sequenceNumber: 1,
              blobs: [
                { type: 'bloom-filter-v1', fieldId: 3 },
                { type: 'set-index-v1', fieldId: 7 },
              ],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Puffin Serialization ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_SERIALIZE_P50_MS)
    })

    it('serializes puffin file with multiple blobs', async () => {
      const blobCounts = [1, 5, 10]
      const results: Array<{ blobs: number; p50: number; sizeKB?: number }> = []

      for (const blobCount of blobCounts) {
        const blobs = Array.from({ length: blobCount }, (_, i) => ({
          type: i % 2 === 0 ? 'bloom-filter-v1' : 'set-index-v1',
          fieldId: i + 1,
        }))

        const result = await benchmark({
          name: `puffin-serialize-${blobCount}-blobs`,
          target: 'iceberg.perf.do',
          iterations: 30,
          warmup: 3,
          run: async (ctx) => {
            const response = await ctx.fetch('/iceberg/puffin/serialize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                snapshotId: 123456789,
                sequenceNumber: 1,
                blobs,
              }),
            })
            return response
          },
        })

        results.push({
          blobs: blobCount,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Serialization by Blob Count ===')
      for (const r of results) {
        console.log(`  ${r.blobs} blobs: ${r.p50.toFixed(3)} ms`)
      }

      // Serialization time should scale linearly with blob count
      if (results.length >= 2 && results[0]!.p50 > 0) {
        const ratio = results[results.length - 1]!.p50 / results[0]!.p50
        const blobRatio = results[results.length - 1]!.blobs / results[0]!.blobs
        // Allow 2x overhead for bookkeeping
        expect(ratio).toBeLessThan(blobRatio * 2)
      }
    })
  })

  describe('end-to-end puffin workflow', () => {
    it('complete puffin generation workflow', async () => {
      const result = await benchmark({
        name: 'puffin-e2e-workflow',
        target: 'iceberg.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx) => {
          // Full workflow: generate stats, create filters, serialize
          return ctx.do.request('/iceberg/puffin/workflow', {
            method: 'POST',
            body: JSON.stringify({
              dataFile: 'test-data.parquet',
              columns: [
                { id: 3, name: 'id', type: 'string', bloom: true },
                { id: 5, name: 'email', type: 'string', ngram: true },
                { id: 7, name: 'status', type: 'string', setIndex: true },
              ],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== End-to-End Puffin Workflow ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      // End-to-end should complete within combined expectations
      expect(result.stats.p50).toBeLessThan(MAX_STATS_GENERATION_P50_MS + MAX_SERIALIZE_P50_MS)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Puffin Stats Summary', () => {
  it('should document expected performance', () => {
    console.log('\n========================================')
    console.log('PUFFIN STATS PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Expected benchmarks:')
    console.log(`  - Stats generation: <${MAX_STATS_GENERATION_P50_MS}ms`)
    console.log(`  - Column statistics: <${MAX_COLUMN_STATS_P50_MS}ms`)
    console.log(`  - SetIndex creation: <${MAX_SET_INDEX_P50_MS}ms`)
    console.log(`  - Serialization: <${MAX_SERIALIZE_P50_MS}ms`)
    console.log('')

    console.log('Key optimizations:')
    console.log('  - MurmurHash3 for bloom filters')
    console.log('  - Binary serialization with minimal overhead')
    console.log('  - Range-addressable format for partial fetches')
    console.log('  - JSON footer for fast metadata lookup')
    console.log('')

    expect(true).toBe(true)
  })
})
