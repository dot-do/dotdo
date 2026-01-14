/**
 * DuckDB WASM Instantiation Tests
 *
 * RED phase TDD tests to prove DuckDB WASM can be instantiated in Cloudflare Workers.
 * These tests are designed to FAIL until we implement the actual DuckDB WASM loading.
 *
 * Test Cases:
 * 1. WASM module loads without error
 * 2. Memory usage stays under 128MB limit
 * 3. Startup time < 500ms (cold) / < 50ms (warm)
 * 4. Basic `SELECT 1` query returns result
 *
 * @see https://developers.cloudflare.com/workers/testing/vitest-integration/
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { env, SELF } from 'cloudflare:test'

// Import from a module that doesn't exist yet - this will cause the test to fail
// until we implement the DuckDB WASM loader
import {
  createDuckDB,
  instantiateDuckDB,
  type DuckDBInstance,
  type DuckDBConfig,
  type InstantiationMetrics,
} from '../index'

// ============================================================================
// TEST CONSTANTS
// ============================================================================

/**
 * Workers memory limit is 128MB
 * We target 100MB to leave headroom for other operations
 */
const MAX_MEMORY_MB = 100

/**
 * Cold start should be under 500ms
 * This is critical for Workers where cold starts impact user experience
 */
const MAX_COLD_START_MS = 500

/**
 * Warm start (cached WASM) should be under 50ms
 * After initial load, subsequent instantiation should be fast
 */
const MAX_WARM_START_MS = 50

// ============================================================================
// WASM MODULE LOADING TESTS
// ============================================================================

describe('DuckDB WASM Instantiation', () => {
  let db: DuckDBInstance | null = null

  afterAll(async () => {
    // Clean up any open database connections
    if (db) {
      await db.close()
      db = null
    }
  })

  describe('WASM Module Loading', () => {
    it('should load WASM module without error', async () => {
      // This test verifies that the DuckDB WASM binary can be loaded
      // in the Cloudflare Workers runtime environment

      const result = await instantiateDuckDB()

      expect(result).toBeDefined()
      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should create a DuckDB instance from loaded module', async () => {
      // After loading WASM, we should be able to create a usable database instance

      db = await createDuckDB()

      expect(db).toBeDefined()
      expect(typeof db.query).toBe('function')
      expect(typeof db.close).toBe('function')
    })

    it('should support in-memory database mode', async () => {
      // Workers don't have persistent filesystem, so in-memory is primary mode

      const config: DuckDBConfig = {
        path: ':memory:',
      }

      db = await createDuckDB(config)

      expect(db).toBeDefined()
      expect(db.path).toBe(':memory:')
    })

    it('should handle WASM instantiation failures gracefully', async () => {
      // Provide invalid config that should fail
      const invalidConfig: DuckDBConfig = {
        path: ':memory:',
        // @ts-expect-error - intentionally invalid to test error handling
        wasmPath: '/nonexistent/path/to/duckdb.wasm',
      }

      await expect(createDuckDB(invalidConfig)).rejects.toThrow()
    })
  })

  // ============================================================================
  // MEMORY USAGE TESTS
  // ============================================================================

  describe('Memory Usage', () => {
    let metrics: InstantiationMetrics

    beforeAll(async () => {
      // Get fresh metrics from a clean instantiation
      const result = await instantiateDuckDB({ measureMetrics: true })
      metrics = result.metrics!
    })

    it('should stay under 128MB memory limit during instantiation', () => {
      // Workers have a hard 128MB limit per isolate
      // DuckDB WASM must fit within this constraint

      const memoryMB = metrics.peakMemoryBytes / (1024 * 1024)

      console.log(`Peak memory during instantiation: ${memoryMB.toFixed(2)} MB`)

      expect(memoryMB).toBeLessThan(MAX_MEMORY_MB)
    })

    it('should report accurate memory metrics', () => {
      // Verify the metrics object has expected properties

      expect(metrics).toBeDefined()
      expect(typeof metrics.peakMemoryBytes).toBe('number')
      expect(typeof metrics.wasmModuleSizeBytes).toBe('number')
      expect(typeof metrics.heapUsedBytes).toBe('number')

      // WASM module should be non-trivial size (DuckDB is ~10-20MB compressed)
      expect(metrics.wasmModuleSizeBytes).toBeGreaterThan(1024 * 1024) // > 1MB
    })

    it('should release memory after database close', async () => {
      // After closing, memory should be released back to the runtime

      const beforeClose = metrics.heapUsedBytes

      db = await createDuckDB()
      await db.close()

      const afterClose = await getHeapUsage()

      // Memory after close should not significantly exceed baseline
      // Allow 10% variance for GC timing differences
      expect(afterClose).toBeLessThan(beforeClose * 1.1)
    })

    it('should not leak memory across multiple instantiations', async () => {
      // Create and destroy multiple instances to test for leaks

      const instances: DuckDBInstance[] = []
      const memoryReadings: number[] = []

      for (let i = 0; i < 5; i++) {
        instances.push(await createDuckDB())
        memoryReadings.push(await getHeapUsage())
      }

      // Close all instances
      for (const instance of instances) {
        await instance.close()
      }

      const finalMemory = await getHeapUsage()

      // Final memory should not grow linearly with number of instances
      // Should be roughly back to starting point after cleanup
      const averageMemory =
        memoryReadings.reduce((a, b) => a + b, 0) / memoryReadings.length

      console.log(`Average memory: ${averageMemory / (1024 * 1024)} MB`)
      console.log(`Final memory: ${finalMemory / (1024 * 1024)} MB`)

      // Final should be less than 2x average (indicates cleanup works)
      expect(finalMemory).toBeLessThan(averageMemory * 2)
    })
  })

  // ============================================================================
  // STARTUP TIME TESTS
  // ============================================================================

  describe('Startup Time', () => {
    it('should complete cold start under 500ms', async () => {
      // Cold start: first instantiation with no cached artifacts

      const start = performance.now()
      const instance = await createDuckDB()
      const elapsed = performance.now() - start

      console.log(`Cold start time: ${elapsed.toFixed(2)} ms`)

      await instance.close()

      expect(elapsed).toBeLessThan(MAX_COLD_START_MS)
    })

    it('should complete warm start under 50ms', async () => {
      // Warm start: WASM module already cached/compiled

      // First call warms the cache
      const warmup = await createDuckDB()
      await warmup.close()

      // Second call should be faster
      const start = performance.now()
      const instance = await createDuckDB()
      const elapsed = performance.now() - start

      console.log(`Warm start time: ${elapsed.toFixed(2)} ms`)

      await instance.close()

      expect(elapsed).toBeLessThan(MAX_WARM_START_MS)
    })

    it('should report timing metrics', async () => {
      const result = await instantiateDuckDB({ measureMetrics: true })
      const metrics = result.metrics!

      expect(metrics).toBeDefined()
      expect(typeof metrics.instantiationTimeMs).toBe('number')
      expect(typeof metrics.compilationTimeMs).toBe('number')
      expect(typeof metrics.initializationTimeMs).toBe('number')

      // Verify timing breakdown adds up approximately
      const totalReported =
        metrics.compilationTimeMs + metrics.initializationTimeMs
      expect(metrics.instantiationTimeMs).toBeGreaterThanOrEqual(
        totalReported * 0.9
      )
    })

    it('should benefit from WASM compilation cache', async () => {
      // Cloudflare caches compiled WASM modules
      // Second instantiation should be significantly faster

      const times: number[] = []

      for (let i = 0; i < 3; i++) {
        const start = performance.now()
        const instance = await createDuckDB()
        times.push(performance.now() - start)
        await instance.close()
      }

      console.log(`Instantiation times: ${times.map((t) => t.toFixed(2)).join(', ')} ms`)

      // Each subsequent call should be faster or equal
      // Allow 10% variance for measurement noise
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeLessThan(times[i - 1] * 1.1 + 5) // 10% + 5ms tolerance
      }
    })
  })

  // ============================================================================
  // BASIC QUERY TESTS
  // ============================================================================

  describe('Basic Query Execution', () => {
    beforeEach(async () => {
      db = await createDuckDB()
    })

    afterAll(async () => {
      if (db) {
        await db.close()
        db = null
      }
    })

    it('should execute SELECT 1 and return result', async () => {
      // Most basic test that DuckDB is actually working

      const result = await db!.query('SELECT 1 as value')

      expect(result).toBeDefined()
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].value).toBe(1)
    })

    it('should execute SELECT with multiple columns', async () => {
      const result = await db!.query('SELECT 1 as a, 2 as b, 3 as c')

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('should execute SELECT with string data', async () => {
      const result = await db!.query("SELECT 'hello' as greeting")

      expect(result.rows[0].greeting).toBe('hello')
    })

    it('should handle NULL values', async () => {
      const result = await db!.query('SELECT NULL as empty')

      expect(result.rows[0].empty).toBeNull()
    })

    it('should execute arithmetic expressions', async () => {
      const result = await db!.query('SELECT 2 + 2 as sum, 10 * 5 as product')

      expect(result.rows[0].sum).toBe(4)
      expect(result.rows[0].product).toBe(50)
    })

    it('should handle query errors gracefully', async () => {
      // Invalid SQL should throw a clear error

      await expect(db!.query('SELECT * FROM nonexistent_table')).rejects.toThrow()
    })

    it('should support parameterized queries', async () => {
      const result = await db!.query('SELECT $1::INTEGER as num', [42])

      expect(result.rows[0].num).toBe(42)
    })

    it('should return column metadata', async () => {
      const result = await db!.query('SELECT 1 as num, \'test\' as str')

      expect(result.columns).toBeDefined()
      expect(result.columns).toHaveLength(2)
      expect(result.columns[0].name).toBe('num')
      expect(result.columns[1].name).toBe('str')
    })
  })

  // ============================================================================
  // WORKERS RUNTIME COMPATIBILITY TESTS
  // ============================================================================

  describe('Workers Runtime Compatibility', () => {
    it('should work without filesystem access', async () => {
      // Workers don't have traditional filesystem
      // DuckDB WASM should work entirely in-memory

      db = await createDuckDB({ path: ':memory:' })

      // Should be able to create tables and query without filesystem
      await db.query('CREATE TABLE test (id INTEGER)')
      await db.query('INSERT INTO test VALUES (1), (2), (3)')
      const result = await db.query('SELECT COUNT(*) as count FROM test')

      expect(result.rows[0].count).toBe(3)
    })

    it('should work with Web Crypto API', async () => {
      // DuckDB might need crypto for certain operations
      // Verify it works with Workers' Web Crypto

      db = await createDuckDB()

      // MD5 is supported in DuckDB
      const result = await db.query("SELECT md5('test') as hash")

      expect(result.rows[0].hash).toBeDefined()
      expect(typeof result.rows[0].hash).toBe('string')
    })

    it('should handle concurrent queries', async () => {
      db = await createDuckDB()

      // Execute multiple queries concurrently
      const queries = [
        db.query('SELECT 1 as n'),
        db.query('SELECT 2 as n'),
        db.query('SELECT 3 as n'),
      ]

      const results = await Promise.all(queries)

      expect(results[0].rows[0].n).toBe(1)
      expect(results[1].rows[0].n).toBe(2)
      expect(results[2].rows[0].n).toBe(3)
    })

    it('should respect request timeout constraints', async () => {
      // Workers have CPU time limits
      // Queries should be interruptible

      db = await createDuckDB()

      // Create a query that would take too long without proper limits
      // This should either complete quickly or be canceled
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1000)

      try {
        // This query should complete within reasonable time
        await db.query('SELECT * FROM range(1000)', { signal: controller.signal })
      } finally {
        clearTimeout(timeout)
      }

      // If we get here without timeout, the test passes
      expect(true).toBe(true)
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get current heap memory usage
 * Note: This may not be accurate in Workers environment
 */
async function getHeapUsage(): Promise<number> {
  // In Workers, we can't use process.memoryUsage()
  // This is a placeholder that the implementation will provide
  const result = await instantiateDuckDB({ measureMetrics: true })
  return result.metrics?.heapUsedBytes ?? 0
}
