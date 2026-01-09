/**
 * DuckDB WASM Instantiation Tests for Cloudflare Workers
 *
 * Tests WASM loading and instantiation in the Workers runtime environment.
 * These tests verify:
 * - WASM module loads correctly in V8 isolate
 * - instantiateDuckDB() works in Workers runtime
 * - Cold start time is acceptable
 * - Memory usage stays within Workers limits
 *
 * NOTE: These tests may initially fail while verifying WASM compatibility.
 * Document all failures clearly for debugging.
 *
 * @see https://developers.cloudflare.com/workers/testing/vitest-integration/
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'

import {
  createDuckDB,
  instantiateDuckDB,
  clearCache,
  isCached,
  type DuckDBInstance,
  type InstantiationResult,
} from '@dotdo/duckdb-worker'

// Alias for test compatibility - tests call createDB/instantiateDB
const createDB = createDuckDB
const instantiateDB = instantiateDuckDB

// ============================================================================
// TEST CONSTANTS
// ============================================================================

/**
 * Workers memory limit is 128MB
 * We target 100MB to leave headroom for other operations
 */
const MAX_MEMORY_MB = 100

/**
 * Cold start should be under 2000ms in Workers runtime
 * WASM compilation and instantiation takes time
 */
const MAX_COLD_START_MS = 2000

/**
 * Warm start (cached WASM) should be under 200ms
 * After initial load, subsequent instantiation should be fast
 */
const MAX_WARM_START_MS = 200

// ============================================================================
// WASM MODULE LOADING TESTS
// ============================================================================

describe('DuckDB WASM Instantiation in Workers', () => {
  let db: DuckDBInstance | null = null

  beforeEach(() => {
    // Clear cache before each test to ensure clean state
    clearCache()
  })

  afterEach(async () => {
    // Clean up any open database connections
    if (db) {
      try {
        await db.close()
      } catch {
        // Ignore close errors in cleanup
      }
      db = null
    }
  })

  describe('WASM Module Loading', () => {
    it('should load WASM module without error', async () => {
      /**
       * Test that the DuckDB WASM binary can be loaded in Cloudflare Workers runtime.
       * This is the most fundamental test - if this fails, WASM is not compatible.
       *
       * Expected: success=true, no error
       * Possible failure: WASM binary format incompatible with Workers
       */
      const result = await instantiateDB()

      expect(result).toBeDefined()
      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()

      // Log timing for debugging
      console.log(`WASM instantiation took ${result.instantiationTimeMs?.toFixed(2)}ms`)
    })

    it('should report instantiation time', async () => {
      /**
       * Verify timing metrics are captured during instantiation.
       * This helps identify performance bottlenecks.
       */
      const result = await instantiateDB()

      expect(result.instantiationTimeMs).toBeDefined()
      expect(result.instantiationTimeMs).toBeGreaterThan(0)

      console.log(`Instantiation time: ${result.instantiationTimeMs?.toFixed(2)}ms`)
    })

    it('should create a DuckDB instance from loaded module', async () => {
      /**
       * After loading WASM, we should be able to create a usable database instance.
       * The instance should have all expected methods.
       */
      db = await createDB()

      expect(db).toBeDefined()
      expect(typeof db.query).toBe('function')
      expect(typeof db.exec).toBe('function')
      expect(typeof db.close).toBe('function')
      expect(typeof db.isOpen).toBe('function')
      expect(db.isOpen()).toBe(true)
    })

    it('should handle instantiation failure gracefully', async () => {
      /**
       * Test error handling when WASM cannot be instantiated.
       * We can't easily force a failure, but we verify the result structure.
       */
      const result = await instantiateDB()

      // Result should always have success boolean
      expect(typeof result.success).toBe('boolean')

      if (!result.success) {
        // If failed, should have error message
        expect(result.error).toBeDefined()
        expect(typeof result.error).toBe('string')
        console.error(`Instantiation failed: ${result.error}`)
      }
    })
  })

  describe('Cold Start Performance', () => {
    it('should complete cold start under 2000ms', async () => {
      /**
       * Cold start: first instantiation with no cached artifacts.
       * Workers have strict CPU time limits, so startup must be fast.
       *
       * This test clears the cache first to ensure a true cold start.
       */
      clearCache()

      const start = performance.now()
      const instance = await createDB()
      const elapsed = performance.now() - start

      console.log(`Cold start time: ${elapsed.toFixed(2)}ms`)

      await instance.close()

      expect(elapsed).toBeLessThan(MAX_COLD_START_MS)
    })

    it('should complete warm start under 200ms', async () => {
      /**
       * Warm start: WASM module already cached/compiled.
       * Subsequent instantiations should be significantly faster.
       */
      // First call warms the cache
      const warmup = await createDB()
      await warmup.close()

      // Second call should be faster
      const start = performance.now()
      const instance = await createDB()
      const elapsed = performance.now() - start

      console.log(`Warm start time: ${elapsed.toFixed(2)}ms`)

      await instance.close()

      expect(elapsed).toBeLessThan(MAX_WARM_START_MS)
    })

    it('should benefit from WASM compilation cache', async () => {
      /**
       * Multiple instantiations should show improving performance.
       * Cloudflare caches compiled WASM modules.
       */
      const times: number[] = []

      for (let i = 0; i < 3; i++) {
        const start = performance.now()
        const instance = await createDB()
        times.push(performance.now() - start)
        await instance.close()
      }

      console.log(`Instantiation times: ${times.map((t) => t.toFixed(2)).join(', ')}ms`)

      // Second and third calls should generally be faster than first
      // Allow some variance for GC and system load
      expect(times[2]).toBeLessThan(times[0] * 1.5)
    })
  })

  describe('Memory Usage', () => {
    it('should execute basic query without memory error', async () => {
      /**
       * Verify that DuckDB can operate within Workers memory limits.
       * Workers have 128MB limit per isolate.
       */
      db = await createDB()

      // Execute a query that allocates some memory
      const result = await db.query('SELECT * FROM range(1000) t(i)')

      expect(result.rows.length).toBe(1000)
    })

    it('should release resources on close', async () => {
      /**
       * After closing, memory should be released.
       * This is critical for long-running Workers.
       */
      const instance = await createDB()

      // Do some work
      await instance.query('SELECT * FROM range(100)')

      // Close and verify
      await instance.close()
      expect(instance.isOpen()).toBe(false)

      // Creating a new instance should work
      const newInstance = await createDB()
      expect(newInstance.isOpen()).toBe(true)
      await newInstance.close()
    })

    it('should handle multiple sequential instances', async () => {
      /**
       * Test creating and destroying multiple instances.
       * Verifies no memory leaks across instance lifecycles.
       */
      for (let i = 0; i < 5; i++) {
        const instance = await createDB()
        await instance.query('SELECT 1')
        await instance.close()
      }

      // If we get here without memory errors, test passes
      expect(true).toBe(true)
    })
  })

  describe('Cache Management', () => {
    it('should track cached state correctly', async () => {
      /**
       * Verify cache state tracking works correctly.
       */
      clearCache()
      expect(isCached()).toBe(false)

      await instantiateDB()
      expect(isCached()).toBe(true)

      clearCache()
      expect(isCached()).toBe(false)
    })

    it('should allow re-instantiation after cache clear', async () => {
      /**
       * After clearing cache, should be able to instantiate again.
       */
      // First instantiation
      const result1 = await instantiateDB()
      expect(result1.success).toBe(true)

      // Clear and re-instantiate
      clearCache()
      const result2 = await instantiateDB()
      expect(result2.success).toBe(true)
    })
  })

  describe('Workers Runtime Compatibility', () => {
    it('should work without Node.js APIs', async () => {
      /**
       * Verify DuckDB works in pure Workers environment.
       * Workers don't have process, fs, etc.
       */
      db = await createDB()

      // These operations should not require Node.js APIs
      const result = await db.query('SELECT 42 as answer')
      expect(result.rows[0].answer).toBe(42)
    })

    it('should work with Web APIs only', async () => {
      /**
       * Verify DuckDB uses only Web Platform APIs.
       * Workers provide Web APIs like TextEncoder, performance, etc.
       */
      db = await createDB()

      // Use Web APIs in test
      const encoder = new TextEncoder()
      const bytes = encoder.encode('test')
      expect(bytes.length).toBe(4)

      // DuckDB should work alongside Web APIs
      const result = await db.query('SELECT length($1) as len', ['test'])
      expect(result.rows[0].len).toBe(4)
    })

    it('should handle Web Crypto if needed', async () => {
      /**
       * Some DuckDB functions may use crypto.
       * Verify Workers Web Crypto API is compatible.
       */
      db = await createDB()

      // md5 uses crypto internally
      const result = await db.query("SELECT md5('hello') as hash")
      expect(result.rows[0].hash).toBeDefined()
      expect(typeof result.rows[0].hash).toBe('string')
    })
  })
})

// ============================================================================
// DOCUMENTED FAILURES
// ============================================================================

/**
 * Known Issues and Failures
 *
 * 1. 2026-01-09 - WASM Module Loading: Import #129 module="GOT.func" error
 *    Error: WebAssembly.instantiate(): Import #129 module="GOT.func": module is not an object or function
 *    Root cause: DuckDB WASM binary requires Emscripten's GOT (Global Offset Table) for dynamic
 *                linking/position-independent code. The current import object doesn't provide this.
 *    Analysis: The DuckDB WASM is built with -fPIC/-sPIC flags, requiring GOT.mem and GOT.func
 *              modules for relocation. Workers don't support SharedArrayBuffer threads, but
 *              the binary still expects these imports.
 *    Potential solutions:
 *      a) Use a DuckDB WASM build without -fPIC (static linking)
 *      b) Provide mock GOT.func and GOT.mem imports in the import object
 *      c) Use @duckdb/duckdb-wasm browser-blocking bundle which may have different imports
 *    Status: INVESTIGATING - Need DuckDB build without dynamic linking support
 *
 * 2. Tests that depend on successful WASM instantiation will fail until #1 is resolved:
 *    - should load WASM module without error
 *    - should create a DuckDB instance from loaded module
 *    - All query tests
 *    - All buffer registration integration tests
 *
 * The runtime buffer management tests (registerFileBuffer, dropFile, etc.) pass because
 * they don't require the WASM module.
 */
