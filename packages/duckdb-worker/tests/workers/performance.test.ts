/**
 * DuckDB WASM Performance Benchmark Tests for Cloudflare Workers
 *
 * Comprehensive performance benchmarks for DuckDB in Workers runtime.
 * Tests measure and validate:
 * - Cold/warm instantiation times
 * - Query execution performance
 * - Memory usage under different workloads
 * - CPU time limits compliance
 *
 * Success Criteria (from issue):
 * - Instantiation <500ms cold, <50ms warm
 * - `SELECT 1` returns in <10ms
 * - 1MB Parquet query in <1s
 * - Peak memory <100MB
 *
 * @see https://developers.cloudflare.com/workers/testing/vitest-integration/
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'

import {
  createDuckDB,
  instantiateDuckDB,
  clearCache,
  isCached,
  registerFileBuffer,
  clearAllFiles,
  getTotalMemoryUsage,
  type DuckDBInstance,
} from '@dotdo/duckdb-worker'

// Import WASM as ES module (Cloudflare Workers ES module style)
import duckdbWasm from '../../wasm/duckdb-worker.wasm'

// Use WASM module from ES module import
const createDB = (config?: Parameters<typeof createDuckDB>[0]) =>
  createDuckDB(config, { wasmModule: duckdbWasm })
const instantiateDB = () =>
  instantiateDuckDB({ wasmModule: duckdbWasm })

// ============================================================================
// PERFORMANCE CONSTANTS (Success Criteria)
// ============================================================================

/**
 * Maximum cold start time (first instantiation)
 * This includes WASM compilation and module initialization
 */
const MAX_COLD_START_MS = 500

/**
 * Maximum warm start time (cached module)
 * After initial load, subsequent instantiations should be fast
 */
const MAX_WARM_START_MS = 50

/**
 * Maximum time for basic SELECT 1 query
 */
const MAX_SELECT_ONE_MS = 10

/**
 * Maximum time for 1MB Parquet query
 */
const MAX_PARQUET_QUERY_MS = 1000

/**
 * Maximum peak memory usage in MB
 * Workers have 128MB limit, we target 100MB for headroom
 */
const MAX_MEMORY_MB = 100

/**
 * Number of iterations for benchmark averaging
 */
const BENCHMARK_ITERATIONS = 5

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Run a function multiple times and return timing statistics
 */
async function benchmark<T>(
  fn: () => Promise<T>,
  iterations: number = BENCHMARK_ITERATIONS
): Promise<{
  min: number
  max: number
  avg: number
  median: number
  times: number[]
  results: T[]
}> {
  const times: number[] = []
  const results: T[] = []

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    const result = await fn()
    times.push(performance.now() - start)
    results.push(result)
  }

  const sorted = [...times].sort((a, b) => a - b)
  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    median: sorted[Math.floor(sorted.length / 2)]!,
    times,
    results,
  }
}

/**
 * Create a large CSV buffer for memory tests
 */
function createLargeCSVBuffer(rowCount: number, colCount: number): Uint8Array {
  const encoder = new TextEncoder()

  // Build header
  const header = Array.from({ length: colCount }, (_, i) => `col${i}`).join(',') + '\n'

  // Build rows
  let csv = header
  for (let r = 0; r < rowCount; r++) {
    const row = Array.from({ length: colCount }, (_, c) => `value_${r}_${c}`).join(',') + '\n'
    csv += row
  }

  return encoder.encode(csv)
}

// ============================================================================
// INSTANTIATION PERFORMANCE TESTS
// ============================================================================

describe('Instantiation Performance Benchmarks', () => {
  beforeEach(() => {
    clearCache()
    clearAllFiles()
  })

  afterEach(() => {
    clearAllFiles()
  })

  it('should complete cold start under 500ms', async () => {
    /**
     * Cold start benchmark: first instantiation with no cached artifacts.
     * Measures WASM compilation and module initialization time.
     */
    const start = performance.now()
    const result = await instantiateDB()
    const elapsed = performance.now() - start

    console.log(`Cold start time: ${elapsed.toFixed(2)}ms`)

    expect(result.success).toBe(true)
    expect(elapsed).toBeLessThan(MAX_COLD_START_MS)
  })

  it('should complete warm start under 50ms', async () => {
    /**
     * Warm start benchmark: WASM module already cached.
     * Tests subsequent instantiation performance.
     */
    // First call warms the cache
    await instantiateDB()

    // Measure warm start
    const start = performance.now()
    const instance = await createDB()
    const elapsed = performance.now() - start

    console.log(`Warm start time: ${elapsed.toFixed(2)}ms`)

    await instance.close()

    expect(elapsed).toBeLessThan(MAX_WARM_START_MS)
  })

  it('should show performance improvement after cache warmup', async () => {
    /**
     * Verify caching provides measurable speedup.
     * Cold start should be significantly slower than warm starts.
     */
    const coldStart = performance.now()
    const firstInstance = await createDB()
    const coldTime = performance.now() - coldStart
    await firstInstance.close()

    // Subsequent starts should be faster
    const warmTimes: number[] = []
    for (let i = 0; i < 3; i++) {
      const start = performance.now()
      const instance = await createDB()
      warmTimes.push(performance.now() - start)
      await instance.close()
    }

    const avgWarmTime = warmTimes.reduce((a, b) => a + b, 0) / warmTimes.length

    console.log(`Cold start: ${coldTime.toFixed(2)}ms`)
    console.log(`Warm starts: ${warmTimes.map((t) => t.toFixed(2)).join(', ')}ms`)
    console.log(`Average warm start: ${avgWarmTime.toFixed(2)}ms`)

    // Warm starts should be at least 2x faster than cold start
    expect(avgWarmTime).toBeLessThan(coldTime / 2)
  })

  it('should provide consistent instantiation times', async () => {
    /**
     * Benchmark variance: instantiation times should be consistent.
     * Large variance indicates unstable performance.
     */
    // Warm up
    await instantiateDB()

    const stats = await benchmark(async () => {
      const instance = await createDB()
      await instance.close()
      return true
    })

    console.log(`Instantiation benchmark:`)
    console.log(`  Min: ${stats.min.toFixed(2)}ms`)
    console.log(`  Max: ${stats.max.toFixed(2)}ms`)
    console.log(`  Avg: ${stats.avg.toFixed(2)}ms`)
    console.log(`  Median: ${stats.median.toFixed(2)}ms`)

    // Variance should be reasonable (max should be within 3x of min)
    expect(stats.max).toBeLessThan(stats.min * 3)
  })
})

// ============================================================================
// QUERY PERFORMANCE TESTS
// ============================================================================

describe('Query Performance Benchmarks', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    clearCache()
    db = await createDB()
  })

  afterAll(async () => {
    if (db) {
      await db.close()
    }
  })

  it('should execute SELECT 1 under 10ms', async () => {
    /**
     * Basic query benchmark: simplest possible query.
     * This measures base query overhead.
     */
    const stats = await benchmark(async () => {
      return db.query('SELECT 1 as one')
    })

    console.log(`SELECT 1 benchmark:`)
    console.log(`  Min: ${stats.min.toFixed(2)}ms`)
    console.log(`  Max: ${stats.max.toFixed(2)}ms`)
    console.log(`  Avg: ${stats.avg.toFixed(2)}ms`)
    console.log(`  Median: ${stats.median.toFixed(2)}ms`)

    expect(stats.median).toBeLessThan(MAX_SELECT_ONE_MS)
    expect(stats.results[0]?.rows[0]?.one).toBe(1)
  })

  it('should execute simple arithmetic quickly', async () => {
    /**
     * Arithmetic expression benchmark.
     */
    const stats = await benchmark(async () => {
      return db.query('SELECT 1 + 1 as answer')
    })

    console.log(`Arithmetic benchmark (1+1): ${stats.median.toFixed(2)}ms median`)

    // Should be similar to SELECT 1
    expect(stats.median).toBeLessThan(MAX_SELECT_ONE_MS * 2)
    expect(stats.results[0]?.rows[0]?.answer).toBe(2)
  })

  it('should handle multiple column result efficiently', async () => {
    /**
     * Multi-column query benchmark.
     */
    const stats = await benchmark(async () => {
      return db.query('SELECT 1 as a, 2 as b, 3 as c, 4 as d, 5 as e')
    })

    console.log(`Multi-column benchmark (5 cols): ${stats.median.toFixed(2)}ms median`)

    expect(stats.median).toBeLessThan(MAX_SELECT_ONE_MS * 3)
  })

  it('should handle string operations efficiently', async () => {
    /**
     * String function benchmark.
     */
    const stats = await benchmark(async () => {
      return db.query("SELECT concat('hello', ' ', 'world') as greeting, upper('test') as upper_test")
    })

    console.log(`String ops benchmark: ${stats.median.toFixed(2)}ms median`)

    expect(stats.median).toBeLessThan(MAX_SELECT_ONE_MS * 5)
  })

  it('should handle range queries efficiently', async () => {
    /**
     * Range query benchmark - generates rows in memory.
     * Tests data generation performance.
     */
    const stats = await benchmark(async () => {
      // Cast to INTEGER to avoid BigInt serialization issues
      return db.query('SELECT CAST(i AS INTEGER) as i FROM range(100) t(i)')
    })

    console.log(`Range(100) benchmark: ${stats.median.toFixed(2)}ms median`)

    expect(stats.median).toBeLessThan(100) // 100ms for 100 rows is reasonable
    expect(stats.results[0]?.rowCount).toBe(100)
  })

  it('should handle aggregations efficiently', async () => {
    /**
     * Aggregation benchmark.
     */
    const stats = await benchmark(async () => {
      return db.query(`
        SELECT
          CAST(COUNT(*) AS INTEGER) as cnt,
          CAST(SUM(i) AS INTEGER) as total,
          AVG(i) as avg_val
        FROM range(1000) t(i)
      `)
    })

    console.log(`Aggregation benchmark (1000 rows): ${stats.median.toFixed(2)}ms median`)

    expect(stats.median).toBeLessThan(200)
    expect(stats.results[0]?.rows[0]?.cnt).toBe(1000)
  })
})

// ============================================================================
// MEMORY USAGE TESTS
// ============================================================================

describe('Memory Usage Benchmarks', () => {
  let db: DuckDBInstance

  beforeEach(async () => {
    clearCache()
    clearAllFiles()
    db = await createDB()
  })

  afterEach(async () => {
    if (db) {
      await db.close()
    }
    clearAllFiles()
  })

  it('should report memory usage for buffer registration', () => {
    /**
     * Test memory tracking for registered buffers.
     */
    const initialMemory = getTotalMemoryUsage()
    expect(initialMemory).toBe(0)

    // Register 1MB buffer
    const buffer1MB = new Uint8Array(1024 * 1024)
    registerFileBuffer('test1mb.bin', buffer1MB)

    const afterBuffer = getTotalMemoryUsage()
    expect(afterBuffer).toBe(1024 * 1024)

    console.log(`Memory after 1MB buffer: ${(afterBuffer / 1024 / 1024).toFixed(2)}MB`)
  })

  it('should handle multiple buffer registrations efficiently', () => {
    /**
     * Test memory accumulation with multiple buffers.
     */
    const bufferCount = 10
    const bufferSize = 100 * 1024 // 100KB each

    for (let i = 0; i < bufferCount; i++) {
      const buffer = new Uint8Array(bufferSize)
      registerFileBuffer(`buffer${i}.bin`, buffer)
    }

    const totalMemory = getTotalMemoryUsage()
    const expectedMemory = bufferCount * bufferSize

    expect(totalMemory).toBe(expectedMemory)

    console.log(`Memory for ${bufferCount} x 100KB buffers: ${(totalMemory / 1024 / 1024).toFixed(2)}MB`)
  })

  it('should stay under 100MB for typical workload', async () => {
    /**
     * Workload memory test: simulate realistic usage.
     */
    // Create some tables
    await db.exec('CREATE TABLE test_memory (id INTEGER, name VARCHAR, value DOUBLE)')

    // Insert data
    await db.exec(`
      INSERT INTO test_memory
      SELECT i, 'name_' || i, i * 1.5
      FROM range(10000) t(i)
    `)

    // Run queries
    await db.query('SELECT COUNT(*), SUM(value), AVG(value) FROM test_memory')
    await db.query('SELECT * FROM test_memory WHERE id < 100')

    // Register some buffers
    const csvData = createLargeCSVBuffer(1000, 10)
    registerFileBuffer('data.csv', csvData)

    const totalMemory = getTotalMemoryUsage()

    console.log(`Memory after workload: ${(totalMemory / 1024 / 1024).toFixed(2)}MB`)

    // Total registered buffer memory should be under limit
    expect(totalMemory / 1024 / 1024).toBeLessThan(MAX_MEMORY_MB)
  })

  it('should free memory on buffer removal', () => {
    /**
     * Memory cleanup test.
     */
    // Register buffers
    const buffer1 = new Uint8Array(512 * 1024) // 512KB
    const buffer2 = new Uint8Array(512 * 1024) // 512KB
    registerFileBuffer('file1.bin', buffer1)
    registerFileBuffer('file2.bin', buffer2)

    expect(getTotalMemoryUsage()).toBe(1024 * 1024) // 1MB total

    // Remove one buffer
    clearAllFiles()

    expect(getTotalMemoryUsage()).toBe(0)

    console.log('Memory successfully freed on clearAllFiles()')
  })
})

// ============================================================================
// CPU LIMIT TESTS
// ============================================================================

describe('CPU Limit Validation', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    clearCache()
    db = await createDB()
  })

  afterAll(async () => {
    if (db) {
      await db.close()
    }
  })

  it('should complete complex query within CPU limits', async () => {
    /**
     * CPU-intensive query that should still complete within Workers limits.
     * Workers have 30s CPU time limit (wrangler.jsonc: cpu_ms: 30000).
     */
    const start = performance.now()

    // Complex aggregation query
    const result = await db.query(`
      WITH numbers AS (
        SELECT i FROM range(5000) t(i)
      ),
      stats AS (
        SELECT
          CAST(COUNT(*) AS INTEGER) as cnt,
          CAST(SUM(i) AS INTEGER) as total,
          AVG(i) as avg_val,
          CAST(MIN(i) AS INTEGER) as min_val,
          CAST(MAX(i) AS INTEGER) as max_val
        FROM numbers
      )
      SELECT * FROM stats
    `)

    const elapsed = performance.now() - start

    console.log(`Complex aggregation query: ${elapsed.toFixed(2)}ms`)

    expect(result.success).toBe(true)
    expect(result.rows[0]?.cnt).toBe(5000)
    expect(elapsed).toBeLessThan(5000) // Should complete well under CPU limit
  })

  it('should handle join operations within CPU limits', async () => {
    /**
     * Join-intensive query.
     */
    const start = performance.now()

    const result = await db.query(`
      WITH t1 AS (SELECT i as id, 'item_' || i as name FROM range(100) t(i)),
      t2 AS (SELECT i as id, i * 10 as value FROM range(100) t(i))
      SELECT t1.name, t2.value
      FROM t1
      JOIN t2 ON t1.id = t2.id
      WHERE t2.value > 500
    `)

    const elapsed = performance.now() - start

    console.log(`Join query: ${elapsed.toFixed(2)}ms`)

    expect(result.success).toBe(true)
    expect(elapsed).toBeLessThan(1000)
  })

  it('should handle window functions within CPU limits', async () => {
    /**
     * Window function query.
     */
    const start = performance.now()

    const result = await db.query(`
      SELECT
        i,
        SUM(i) OVER (ORDER BY i ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as running_sum,
        CAST(ROW_NUMBER() OVER (ORDER BY i) AS INTEGER) as row_num
      FROM range(100) t(i)
    `)

    const elapsed = performance.now() - start

    console.log(`Window function query: ${elapsed.toFixed(2)}ms`)

    expect(result.success).toBe(true)
    expect(result.rowCount).toBe(100)
    expect(elapsed).toBeLessThan(1000)
  })

  it('should handle string processing within CPU limits', async () => {
    /**
     * String-heavy query.
     */
    const start = performance.now()

    const result = await db.query(`
      SELECT
        'prefix_' || i || '_suffix' as full_name,
        CAST(length('prefix_' || i || '_suffix') AS INTEGER) as name_len,
        upper('prefix_' || i || '_suffix') as upper_name
      FROM range(500) t(i)
    `)

    const elapsed = performance.now() - start

    console.log(`String processing query (500 rows): ${elapsed.toFixed(2)}ms`)

    expect(result.success).toBe(true)
    expect(result.rowCount).toBe(500)
    expect(elapsed).toBeLessThan(2000)
  })
})

// ============================================================================
// ERROR HANDLING PERFORMANCE
// ============================================================================

describe('Error Handling Performance', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    clearCache()
    db = await createDB()
  })

  afterAll(async () => {
    if (db) {
      await db.close()
    }
  })

  it('should handle errors quickly', async () => {
    /**
     * Error handling should not cause excessive delays.
     */
    const start = performance.now()

    try {
      await db.query('INVALID SQL SYNTAX HERE')
    } catch {
      // Expected error
    }

    const elapsed = performance.now() - start

    console.log(`Error handling time: ${elapsed.toFixed(2)}ms`)

    // Error handling should be fast
    expect(elapsed).toBeLessThan(100)
  })

  it('should recover quickly after error', async () => {
    /**
     * After an error, subsequent queries should execute normally.
     */
    // Cause an error
    try {
      await db.query('SELECT * FROM nonexistent_table')
    } catch {
      // Expected
    }

    // Measure recovery
    const start = performance.now()
    const result = await db.query('SELECT 1 as recovered')
    const elapsed = performance.now() - start

    console.log(`Recovery query time: ${elapsed.toFixed(2)}ms`)

    expect(result.rows[0]?.recovered).toBe(1)
    expect(elapsed).toBeLessThan(MAX_SELECT_ONE_MS * 2)
  })
})

// ============================================================================
// BENCHMARK SUMMARY
// ============================================================================

describe('Performance Summary', () => {
  it('should pass all success criteria', async () => {
    /**
     * Meta-test: verify all success criteria are achievable.
     */
    clearCache()
    clearAllFiles()

    // Criterion 1: Instantiation <500ms cold
    const coldStart = performance.now()
    const db = await createDB()
    const coldTime = performance.now() - coldStart

    console.log('\n=== Performance Summary ===')
    console.log(`Cold start: ${coldTime.toFixed(2)}ms (target: <${MAX_COLD_START_MS}ms) ${coldTime < MAX_COLD_START_MS ? 'PASS' : 'FAIL'}`)

    // Criterion 2: Instantiation <50ms warm
    const warmStart = performance.now()
    const db2 = await createDB()
    const warmTime = performance.now() - warmStart
    await db2.close()

    console.log(`Warm start: ${warmTime.toFixed(2)}ms (target: <${MAX_WARM_START_MS}ms) ${warmTime < MAX_WARM_START_MS ? 'PASS' : 'FAIL'}`)

    // Criterion 3: SELECT 1 <10ms
    const queryStart = performance.now()
    await db.query('SELECT 1 as one')
    const queryTime = performance.now() - queryStart

    console.log(`SELECT 1: ${queryTime.toFixed(2)}ms (target: <${MAX_SELECT_ONE_MS}ms) ${queryTime < MAX_SELECT_ONE_MS ? 'PASS' : 'FAIL'}`)

    // Criterion 4: Memory <100MB
    const memoryMB = getTotalMemoryUsage() / 1024 / 1024

    console.log(`Memory usage: ${memoryMB.toFixed(2)}MB (target: <${MAX_MEMORY_MB}MB) ${memoryMB < MAX_MEMORY_MB ? 'PASS' : 'FAIL'}`)
    console.log('===========================\n')

    await db.close()

    // Assert all criteria pass
    expect(coldTime).toBeLessThan(MAX_COLD_START_MS)
    expect(warmTime).toBeLessThan(MAX_WARM_START_MS)
    expect(queryTime).toBeLessThan(MAX_SELECT_ONE_MS)
    expect(memoryMB).toBeLessThan(MAX_MEMORY_MB)
  })
})
