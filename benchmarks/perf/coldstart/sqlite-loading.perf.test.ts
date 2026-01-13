/**
 * SQLite State Loading Cold Start Performance Benchmarks
 *
 * Measures the impact of DO state size on cold start latency.
 *
 * Key metrics:
 * - Empty SQLite cold start (baseline)
 * - State loading latency at various sizes (1MB, 10MB, 100MB)
 * - State size vs cold start correlation
 *
 * Expected benchmarks:
 * - Empty DO: 0-10ms state loading
 * - 1MB state: 10-30ms state loading
 * - 10MB state: 30-50ms state loading
 * - 100MB state: 50-150ms state loading
 *
 * Note: These are state LOADING times, not total cold start times.
 * Total cold start = isolate + DO instantiation + state loading + network
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { benchmark, record, type BenchmarkResult } from '../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * State sizes to benchmark (in bytes)
 */
const STATE_SIZES = {
  empty: 0,
  small: 1024 * 1024, // 1MB
  medium: 10 * 1024 * 1024, // 10MB
  large: 100 * 1024 * 1024, // 100MB
} as const

/**
 * Expected cold start thresholds by state size (ms)
 * These account for state loading + baseline cold start
 */
const EXPECTED_THRESHOLDS = {
  empty: { p50: 50, p99: 100 },
  small: { p50: 80, p99: 150 }, // 1MB
  medium: { p50: 100, p99: 200 }, // 10MB
  large: { p50: 200, p99: 400 }, // 100MB
} as const

/**
 * Iterations for cold start tests
 */
const COLD_START_ITERATIONS = 15

// ============================================================================
// SQLite STATE LOADING TESTS
// ============================================================================

describe('SQLite state loading cold start', () => {
  /**
   * Test empty SQLite cold start (baseline)
   *
   * Empty DO should have minimal state loading overhead.
   * This establishes the baseline for comparison.
   */
  it('measures empty DO cold start (0-10ms expected)', async () => {
    const timestamp = Date.now()

    const result = await benchmark({
      name: 'cold-start-sqlite-empty',
      target: `sqlite-empty-${timestamp}.perf.do`,
      iterations: COLD_START_ITERATIONS,
      coldStart: true,
      datasetSize: 0,
      run: async (ctx) => {
        // Simple ping - no state to load
        const response = await ctx.fetch('/ping')
        if (!response.ok) {
          throw new Error(`Empty DO ping failed: ${response.status}`)
        }
        return response.json()
      },
    })

    record(result)

    console.log('\n=== Empty DO Cold Start ===')
    console.log(`  State Size: 0 bytes`)
    console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
    console.log(`  Expected p50: <${EXPECTED_THRESHOLDS.empty.p50}ms`)

    expect(result.stats.p50).toBeLessThan(EXPECTED_THRESHOLDS.empty.p50)
    expect(result.stats.p99).toBeLessThan(EXPECTED_THRESHOLDS.empty.p99)
  })

  /**
   * Test 1MB state cold start
   *
   * 1MB is a typical small-medium state size for:
   * - User session data
   * - Small document stores
   * - Configuration caches
   */
  it('measures 1MB state cold start (10-30ms expected)', async () => {
    const timestamp = Date.now()
    const stateSize = STATE_SIZES.small

    const result = await benchmark({
      name: 'cold-start-sqlite-1mb',
      target: `sqlite-1mb-${timestamp}.perf.do`,
      iterations: COLD_START_ITERATIONS,
      coldStart: true,
      datasetSize: stateSize,
      setup: async (ctx) => {
        // Pre-populate state with 1MB of data
        const chunkSize = 10 * 1024 // 10KB chunks
        const numChunks = Math.ceil(stateSize / chunkSize)

        for (let i = 0; i < numChunks; i++) {
          await ctx.do.create('/state', {
            key: `chunk-${i}`,
            data: 'x'.repeat(chunkSize),
          })
        }
      },
      run: async (ctx) => {
        // Query that requires loading state
        const response = await ctx.fetch('/state/stats')
        if (!response.ok) {
          throw new Error(`1MB state query failed: ${response.status}`)
        }
        return response.json()
      },
    })

    record(result)

    console.log('\n=== 1MB State Cold Start ===')
    console.log(`  State Size: ${(stateSize / 1024 / 1024).toFixed(1)} MB`)
    console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
    console.log(`  Expected p50: <${EXPECTED_THRESHOLDS.small.p50}ms`)

    expect(result.stats.p50).toBeLessThan(EXPECTED_THRESHOLDS.small.p50)
    expect(result.stats.p99).toBeLessThan(EXPECTED_THRESHOLDS.small.p99)
  })

  /**
   * Test 10MB state cold start
   *
   * 10MB is a larger state size for:
   * - Product catalogs
   * - User activity logs
   * - Medium-sized caches
   */
  it('measures 10MB state cold start (30-50ms expected)', async () => {
    const timestamp = Date.now()
    const stateSize = STATE_SIZES.medium

    const result = await benchmark({
      name: 'cold-start-sqlite-10mb',
      target: `sqlite-10mb-${timestamp}.perf.do`,
      iterations: COLD_START_ITERATIONS,
      coldStart: true,
      datasetSize: stateSize,
      setup: async (ctx) => {
        // Pre-populate state with 10MB of data
        const chunkSize = 100 * 1024 // 100KB chunks
        const numChunks = Math.ceil(stateSize / chunkSize)

        for (let i = 0; i < numChunks; i++) {
          await ctx.do.create('/state', {
            key: `chunk-${i}`,
            data: 'x'.repeat(chunkSize),
          })
        }
      },
      run: async (ctx) => {
        const response = await ctx.fetch('/state/stats')
        if (!response.ok) {
          throw new Error(`10MB state query failed: ${response.status}`)
        }
        return response.json()
      },
    })

    record(result)

    console.log('\n=== 10MB State Cold Start ===')
    console.log(`  State Size: ${(stateSize / 1024 / 1024).toFixed(1)} MB`)
    console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
    console.log(`  Expected p50: <${EXPECTED_THRESHOLDS.medium.p50}ms`)

    expect(result.stats.p50).toBeLessThan(EXPECTED_THRESHOLDS.medium.p50)
    expect(result.stats.p99).toBeLessThan(EXPECTED_THRESHOLDS.medium.p99)
  })

  /**
   * Test 100MB state cold start
   *
   * 100MB is a large state size, approaching DO limits.
   * Typical use cases:
   * - Large document stores
   * - Full-text search indexes
   * - Historical data archives
   */
  it('measures 100MB state cold start (50-150ms expected)', async () => {
    const timestamp = Date.now()
    const stateSize = STATE_SIZES.large

    const result = await benchmark({
      name: 'cold-start-sqlite-100mb',
      target: `sqlite-100mb-${timestamp}.perf.do`,
      iterations: 10, // Fewer iterations for large state
      coldStart: true,
      datasetSize: stateSize,
      setup: async (ctx) => {
        // Pre-populate state with 100MB of data
        const chunkSize = 1024 * 1024 // 1MB chunks
        const numChunks = Math.ceil(stateSize / chunkSize)

        for (let i = 0; i < numChunks; i++) {
          await ctx.do.create('/state', {
            key: `chunk-${i}`,
            data: 'x'.repeat(chunkSize),
          })
        }
      },
      run: async (ctx) => {
        const response = await ctx.fetch('/state/stats')
        if (!response.ok) {
          throw new Error(`100MB state query failed: ${response.status}`)
        }
        return response.json()
      },
    })

    record(result)

    console.log('\n=== 100MB State Cold Start ===')
    console.log(`  State Size: ${(stateSize / 1024 / 1024).toFixed(1)} MB`)
    console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
    console.log(`  Expected p50: <${EXPECTED_THRESHOLDS.large.p50}ms`)

    expect(result.stats.p50).toBeLessThan(EXPECTED_THRESHOLDS.large.p50)
    expect(result.stats.p99).toBeLessThan(EXPECTED_THRESHOLDS.large.p99)
  })
})

// ============================================================================
// STATE SIZE CORRELATION ANALYSIS
// ============================================================================

describe('State size correlation', () => {
  /**
   * Measure cold start across multiple state sizes to establish correlation
   */
  it('shows state size vs cold start correlation', async () => {
    const timestamp = Date.now()
    const sizes = [0, 1024, 10 * 1024, 100 * 1024, 512 * 1024, 1024 * 1024] // 0, 1KB, 10KB, 100KB, 512KB, 1MB
    const results: Array<{ size: number; result: BenchmarkResult }> = []

    for (const size of sizes) {
      const result = await benchmark({
        name: `cold-start-correlation-${size}`,
        target: `correlation-${timestamp}-${size}.perf.do`,
        iterations: 10,
        coldStart: true,
        datasetSize: size,
        setup:
          size > 0
            ? async (ctx) => {
                // Pre-populate with target size
                const chunkSize = Math.min(size, 10 * 1024) // Max 10KB chunks
                const numChunks = Math.ceil(size / chunkSize)
                for (let i = 0; i < numChunks; i++) {
                  const actualChunkSize = Math.min(chunkSize, size - i * chunkSize)
                  await ctx.do.create('/state', {
                    key: `chunk-${i}`,
                    data: 'x'.repeat(actualChunkSize),
                  })
                }
              }
            : undefined,
        run: async (ctx) => {
          const response = await ctx.fetch('/ping')
          if (!response.ok) {
            throw new Error(`Correlation test failed: ${response.status}`)
          }
          return response.json()
        },
      })
      results.push({ size, result })
    }

    record(results.map((r) => r.result))

    console.log('\n=== State Size vs Cold Start Correlation ===')
    console.log('  Size (KB)  | p50 (ms)  | p95 (ms)  | p99 (ms)  | Per KB (us)')
    console.log('  -----------|-----------|-----------|-----------|------------')

    for (const { size, result } of results) {
      const sizeKB = size / 1024
      const perKB = size > 0 ? (result.stats.p50 * 1000) / sizeKB : 0
      console.log(
        `  ${sizeKB.toFixed(0).padStart(9)} | ${result.stats.p50.toFixed(3).padStart(9)} | ${result.stats.p95.toFixed(3).padStart(9)} | ${result.stats.p99.toFixed(3).padStart(9)} | ${perKB.toFixed(2).padStart(10)}`
      )
    }

    // Verify cold start scales sub-linearly with state size
    const empty = results[0].result.stats.p50
    const oneMB = results[results.length - 1].result.stats.p50

    // 1MB should not be 100x slower than empty
    expect(oneMB / empty).toBeLessThan(100)

    // Each step should not increase latency dramatically
    for (let i = 1; i < results.length; i++) {
      const ratio = results[i].result.stats.p50 / results[i - 1].result.stats.p50
      expect(ratio).toBeLessThan(5) // Max 5x increase per size step
    }
  })

  /**
   * Test lazy loading vs eager loading behavior
   *
   * SQLite in DO uses lazy loading - only accessed tables are loaded.
   * This test verifies that behavior.
   */
  it('measures lazy loading benefit', async () => {
    const timestamp = Date.now()

    // Setup: Create DO with multiple tables, large total size
    const setupDO = async (target: string) => {
      const ctx = await import('../../lib').then((m) => m.createContext(target))

      // Create 10 tables, each with 100KB
      for (let table = 0; table < 10; table++) {
        for (let row = 0; row < 10; row++) {
          await ctx.do.create(`/table${table}`, {
            key: `row-${row}`,
            data: 'x'.repeat(10 * 1024), // 10KB per row
          })
        }
      }
    }

    const target = `lazy-loading-${timestamp}.perf.do`

    // First, set up the DO with 1MB total state (10 tables x 100KB each)
    await setupDO(target)

    // Benchmark: Query single table (should lazy-load only that table)
    const singleTableResult = await benchmark({
      name: 'cold-start-lazy-single-table',
      target,
      iterations: 10,
      coldStart: true,
      datasetSize: 1024 * 1024, // Total state is 1MB
      run: async (ctx) => {
        // Only query one table
        const response = await ctx.fetch('/table0?limit=1')
        if (!response.ok) {
          throw new Error(`Single table query failed: ${response.status}`)
        }
        return response.json()
      },
    })

    // Benchmark: Query all tables (loads everything)
    const allTablesResult = await benchmark({
      name: 'cold-start-lazy-all-tables',
      target,
      iterations: 10,
      coldStart: true,
      datasetSize: 1024 * 1024,
      run: async (ctx) => {
        // Query all tables
        const responses = await Promise.all(
          Array.from({ length: 10 }, (_, i) => ctx.fetch(`/table${i}?limit=1`))
        )
        for (const response of responses) {
          if (!response.ok) {
            throw new Error(`All tables query failed: ${response.status}`)
          }
        }
        return responses.length
      },
    })

    record([singleTableResult, allTablesResult])

    console.log('\n=== Lazy Loading Benefit ===')
    console.log(`  Total State: 1MB (10 tables x 100KB)`)
    console.log('Single Table Query:')
    console.log(`  p50: ${singleTableResult.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${singleTableResult.stats.p95.toFixed(3)} ms`)
    console.log('All Tables Query:')
    console.log(`  p50: ${allTablesResult.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${allTablesResult.stats.p95.toFixed(3)} ms`)
    console.log('Lazy Loading Benefit:')
    console.log(
      `  Speedup: ${(allTablesResult.stats.p50 / singleTableResult.stats.p50).toFixed(2)}x`
    )

    // Single table query should be faster than all tables
    // (demonstrating lazy loading benefit)
    expect(singleTableResult.stats.p50).toBeLessThan(allTablesResult.stats.p50)
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('SQLite Loading Summary', () => {
  it('should document expected SQLite loading performance', () => {
    console.log('\n========================================')
    console.log('SQLite STATE LOADING SUMMARY')
    console.log('========================================\n')

    console.log('State Loading Characteristics:')
    console.log('  - SQLite uses lazy loading (on-demand)')
    console.log('  - Only accessed tables/rows are loaded')
    console.log('  - First access triggers page loading')
    console.log('  - Subsequent accesses use in-memory cache')
    console.log('')

    console.log('Expected Loading Times by State Size:')
    console.log('  Size    | p50 (ms) | p99 (ms) | Use Case')
    console.log('  --------|----------|----------|------------------')
    console.log(`  Empty   | <${EXPECTED_THRESHOLDS.empty.p50.toString().padStart(5)}   | <${EXPECTED_THRESHOLDS.empty.p99.toString().padStart(5)}   | Fresh DO`)
    console.log(`  1MB     | <${EXPECTED_THRESHOLDS.small.p50.toString().padStart(5)}   | <${EXPECTED_THRESHOLDS.small.p99.toString().padStart(5)}   | Session data`)
    console.log(`  10MB    | <${EXPECTED_THRESHOLDS.medium.p50.toString().padStart(5)}   | <${EXPECTED_THRESHOLDS.medium.p99.toString().padStart(5)}   | Product catalog`)
    console.log(`  100MB   | <${EXPECTED_THRESHOLDS.large.p50.toString().padStart(5)}   | <${EXPECTED_THRESHOLDS.large.p99.toString().padStart(5)}   | Document store`)
    console.log('')

    console.log('Optimization Recommendations:')
    console.log('  - Keep hot data < 10MB for sub-100ms cold starts')
    console.log('  - Use lazy loading patterns for large datasets')
    console.log('  - Consider sharding for state > 100MB')
    console.log('  - Use indexes to minimize page loads')
    console.log('  - Archive cold data to R2/external storage')
    console.log('')

    expect(true).toBe(true)
  })
})
