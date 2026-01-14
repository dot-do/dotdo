/**
 * Parquet Read Performance Benchmarks
 *
 * Tests read performance for Parquet files in Workers environment:
 * - Single record reads
 * - Column projection optimization
 * - Row group navigation
 * - Predicate pushdown filtering
 *
 * Expected performance targets:
 * - Read single record: <20ms
 * - Read with projection: <15ms
 * - Navigate row groups: <30ms
 * - Predicate pushdown: <25ms
 *
 * @see db/iceberg/parquet.ts for implementation
 * @see dotdo-x3p2c for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable latency for single record read (ms)
 */
const MAX_SINGLE_READ_P50_MS = 20

/**
 * Maximum acceptable latency for projected read (ms)
 * Column projection should be faster than full read
 */
const MAX_PROJECTED_READ_P50_MS = 15

/**
 * Maximum acceptable latency for row group navigation (ms)
 */
const MAX_ROW_GROUP_NAV_P50_MS = 30

/**
 * Maximum acceptable latency for predicate pushdown (ms)
 */
const MAX_PREDICATE_PUSHDOWN_P50_MS = 25

/**
 * Number of iterations for read benchmarks
 */
const READ_ITERATIONS = 100

/**
 * Number of warmup iterations
 */
const WARMUP_ITERATIONS = 10

// ============================================================================
// SINGLE RECORD READ BENCHMARKS
// ============================================================================

describe('Parquet read benchmarks', () => {
  describe('single record reads', () => {
    it('read single record by row index', async () => {
      const result = await benchmark({
        name: 'parquet-read-single',
        target: 'iceberg.perf.do',
        iterations: READ_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const rowIndex = i % 1000 // Cycle through first 1000 rows
          const response = await ctx.fetch(`/parquet/read?row=${rowIndex}`)
          if (!response.ok) {
            throw new Error(`Read failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Single Record Read ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Target: <${MAX_SINGLE_READ_P50_MS}ms`)

      expect(result.stats.p50).toBeLessThan(MAX_SINGLE_READ_P50_MS)
      expect(result.samples.length).toBe(READ_ITERATIONS)
    })

    it('read single record by ID', async () => {
      const result = await benchmark({
        name: 'parquet-read-by-id',
        target: 'iceberg.perf.do',
        iterations: READ_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const id = `record-${i % 1000}`
          const response = await ctx.fetch(`/parquet/read?id=${id}`)
          if (!response.ok) {
            throw new Error(`Read by ID failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Read by ID ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_SINGLE_READ_P50_MS)
    })

    it('read random access pattern', async () => {
      const result = await benchmark({
        name: 'parquet-read-random',
        target: 'iceberg.perf.do',
        iterations: READ_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          // Random row index to test non-sequential access
          const rowIndex = Math.floor(Math.random() * 10000)
          const response = await ctx.fetch(`/parquet/read?row=${rowIndex}`)
          if (!response.ok) {
            throw new Error(`Random read failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Random Access Read ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      // Random access may be slightly slower
      expect(result.stats.p50).toBeLessThan(MAX_SINGLE_READ_P50_MS * 1.5)
    })
  })

  // ==========================================================================
  // COLUMN PROJECTION BENCHMARKS
  // ==========================================================================

  describe('column projection', () => {
    it('read with column projection (3 columns)', async () => {
      const result = await benchmark({
        name: 'parquet-read-projected-3',
        target: 'iceberg.perf.do',
        iterations: READ_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const columns = 'id,name,value'
          const response = await ctx.fetch(`/parquet/read?row=${i % 1000}&columns=${columns}`)
          if (!response.ok) {
            throw new Error(`Projected read failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Column Projection (3 cols) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Target: <${MAX_PROJECTED_READ_P50_MS}ms`)

      expect(result.stats.p50).toBeLessThan(MAX_PROJECTED_READ_P50_MS)
    })

    it('read with single column projection', async () => {
      const result = await benchmark({
        name: 'parquet-read-projected-1',
        target: 'iceberg.perf.do',
        iterations: READ_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const response = await ctx.fetch(`/parquet/read?row=${i % 1000}&columns=id`)
          if (!response.ok) {
            throw new Error(`Single column read failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Single Column Projection ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      // Single column should be fastest
      expect(result.stats.p50).toBeLessThan(MAX_PROJECTED_READ_P50_MS)
    })

    it('compares projected vs full read performance', async () => {
      // Full read (all columns)
      const fullRead = await benchmark({
        name: 'parquet-read-full',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const response = await ctx.fetch(`/parquet/read?row=${i % 1000}`)
          if (!response.ok) {
            throw new Error(`Full read failed: ${response.status}`)
          }
          return response.json()
        },
      })

      // Projected read (3 columns)
      const projectedRead = await benchmark({
        name: 'parquet-read-projected',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const response = await ctx.fetch(`/parquet/read?row=${i % 1000}&columns=id,name,value`)
          if (!response.ok) {
            throw new Error(`Projected read failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record([fullRead, projectedRead])

      const speedup = fullRead.stats.p50 / projectedRead.stats.p50

      console.log('\n=== Projected vs Full Read Comparison ===')
      console.log(`  Full read p50: ${fullRead.stats.p50.toFixed(3)} ms`)
      console.log(`  Projected read p50: ${projectedRead.stats.p50.toFixed(3)} ms`)
      console.log(`  Speedup: ${speedup.toFixed(2)}x`)

      // Projected read should be faster (or at least not slower)
      expect(projectedRead.stats.p50).toBeLessThanOrEqual(fullRead.stats.p50 * 1.1)
    })
  })

  // ==========================================================================
  // ROW GROUP NAVIGATION BENCHMARKS
  // ==========================================================================

  describe('row group navigation', () => {
    it('navigate row groups sequentially', async () => {
      const result = await benchmark({
        name: 'parquet-rowgroup-sequential',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const rowGroup = i % 10 // Assume 10 row groups
          const response = await ctx.fetch(`/parquet/rowgroup?group=${rowGroup}`)
          if (!response.ok) {
            throw new Error(`Row group read failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Row Group Sequential ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Target: <${MAX_ROW_GROUP_NAV_P50_MS}ms`)

      expect(result.stats.p50).toBeLessThan(MAX_ROW_GROUP_NAV_P50_MS)
    })

    it('navigate row groups randomly', async () => {
      const result = await benchmark({
        name: 'parquet-rowgroup-random',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          const rowGroup = Math.floor(Math.random() * 10)
          const response = await ctx.fetch(`/parquet/rowgroup?group=${rowGroup}`)
          if (!response.ok) {
            throw new Error(`Random row group read failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Row Group Random ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_ROW_GROUP_NAV_P50_MS)
    })

    it('read specific rows within row group', async () => {
      const result = await benchmark({
        name: 'parquet-rowgroup-with-offset',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const rowGroup = i % 10
          const offset = (i * 100) % 10000 // Offset within row group
          const limit = 10
          const response = await ctx.fetch(`/parquet/rowgroup?group=${rowGroup}&offset=${offset}&limit=${limit}`)
          if (!response.ok) {
            throw new Error(`Row group with offset failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Row Group with Offset ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_ROW_GROUP_NAV_P50_MS)
    })
  })

  // ==========================================================================
  // PREDICATE PUSHDOWN BENCHMARKS
  // ==========================================================================

  describe('predicate pushdown', () => {
    it('filter with equality predicate', async () => {
      const result = await benchmark({
        name: 'parquet-predicate-eq',
        target: 'iceberg.perf.do',
        iterations: READ_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const value = `category-${i % 10}`
          const response = await ctx.fetch(`/parquet/query?filter=category:${value}`)
          if (!response.ok) {
            throw new Error(`Equality filter failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Predicate Pushdown (equality) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Target: <${MAX_PREDICATE_PUSHDOWN_P50_MS}ms`)

      expect(result.stats.p50).toBeLessThan(MAX_PREDICATE_PUSHDOWN_P50_MS)
    })

    it('filter with range predicate', async () => {
      const result = await benchmark({
        name: 'parquet-predicate-range',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const minValue = i * 100
          const maxValue = minValue + 1000
          const response = await ctx.fetch(`/parquet/query?filter=value:${minValue}..${maxValue}`)
          if (!response.ok) {
            throw new Error(`Range filter failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Predicate Pushdown (range) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_PREDICATE_PUSHDOWN_P50_MS)
    })

    it('filter with combined predicates', async () => {
      const result = await benchmark({
        name: 'parquet-predicate-combined',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const category = `category-${i % 5}`
          const minValue = i * 10
          // Combined filter: category AND value range
          const response = await ctx.fetch(`/parquet/query?filter=category:${category}&filter=value:${minValue}..${minValue + 100}`)
          if (!response.ok) {
            throw new Error(`Combined filter failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Combined Predicates ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      // Combined predicates may be slightly slower
      expect(result.stats.p50).toBeLessThan(MAX_PREDICATE_PUSHDOWN_P50_MS * 1.5)
    })

    it('compares pushdown vs full scan performance', async () => {
      // With predicate pushdown
      const pushdown = await benchmark({
        name: 'parquet-with-pushdown',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          const response = await ctx.fetch('/parquet/query?filter=category:category-1&pushdown=true')
          if (!response.ok) {
            throw new Error(`Pushdown query failed: ${response.status}`)
          }
          return response.json()
        },
      })

      // Without predicate pushdown (full scan)
      const fullScan = await benchmark({
        name: 'parquet-without-pushdown',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          const response = await ctx.fetch('/parquet/query?filter=category:category-1&pushdown=false')
          if (!response.ok) {
            throw new Error(`Full scan query failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record([pushdown, fullScan])

      const speedup = fullScan.stats.p50 / pushdown.stats.p50

      console.log('\n=== Pushdown vs Full Scan Comparison ===')
      console.log(`  With pushdown p50: ${pushdown.stats.p50.toFixed(3)} ms`)
      console.log(`  Full scan p50: ${fullScan.stats.p50.toFixed(3)} ms`)
      console.log(`  Speedup: ${speedup.toFixed(2)}x`)

      // Pushdown should provide significant speedup for selective predicates
      expect(pushdown.stats.p50).toBeLessThan(fullScan.stats.p50 * 1.1)
    })
  })

  // ==========================================================================
  // BATCH READ BENCHMARKS
  // ==========================================================================

  describe('batch reads', () => {
    it.each([10, 50, 100])('read batch of %d records', async (batchSize) => {
      const result = await benchmark({
        name: `parquet-read-batch-${batchSize}`,
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const offset = (i * batchSize) % 10000
          const response = await ctx.fetch(`/parquet/read?offset=${offset}&limit=${batchSize}`)
          if (!response.ok) {
            throw new Error(`Batch read failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log(`\n=== Parquet Batch Read (${batchSize} records) ===`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  Per-record avg: ${(result.stats.p50 / batchSize).toFixed(3)} ms`)

      // Batch read should scale sub-linearly
      const expectedMax = MAX_SINGLE_READ_P50_MS + batchSize * 0.5 // ~0.5ms per additional record
      expect(result.stats.p50).toBeLessThan(expectedMax)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Parquet Read Summary', () => {
  it('should document expected read performance', () => {
    console.log('\n========================================')
    console.log('PARQUET READ PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Expected performance targets:')
    console.log(`  - Single record read: <${MAX_SINGLE_READ_P50_MS}ms`)
    console.log(`  - Column projection: <${MAX_PROJECTED_READ_P50_MS}ms`)
    console.log(`  - Row group navigation: <${MAX_ROW_GROUP_NAV_P50_MS}ms`)
    console.log(`  - Predicate pushdown: <${MAX_PREDICATE_PUSHDOWN_P50_MS}ms`)
    console.log('')

    console.log('Optimization techniques:')
    console.log('  - Column projection: Read only needed columns')
    console.log('  - Row group skipping: Skip row groups based on stats')
    console.log('  - Predicate pushdown: Filter at storage level')
    console.log('  - Page index: Fine-grained filtering within row groups')
    console.log('')

    console.log('parquet-wasm optimizations:')
    console.log('  - Zero-copy Arrow IPC deserialization')
    console.log('  - Lazy column reading')
    console.log('  - Streaming decompression')
    console.log('')

    expect(true).toBe(true)
  })
})
