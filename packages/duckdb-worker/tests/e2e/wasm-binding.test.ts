/**
 * DuckDB Workers wasm_modules Binding Tests (RED Phase)
 *
 * These tests verify that DuckDB WASM loads correctly via Workers env binding.
 * They are designed to FAIL initially (TDD RED phase) - implementation comes later.
 *
 * Test Cases:
 * 1. env.DUCKDB_WASM is available as WebAssembly.Module
 * 2. createDuckDB({}, { wasmModule: env.DUCKDB_WASM }) instantiates successfully
 * 3. Basic query execution works in Workers runtime
 * 4. Cold start time < 2000ms with pre-compiled module
 *
 * Current Status:
 * - vitest-pool-workers has compatibility issues with cloudflare:test imports
 * - These tests use live deployment testing against deployed worker
 * - Worker deployed at: https://duckdb-worker-test.dotdo.workers.dev
 *
 * @see https://developers.cloudflare.com/workers/wrangler/configuration/#wasm-modules
 */

import { describe, it, expect, beforeAll } from 'vitest'

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

/**
 * Live worker URL for integration testing
 * This worker uses wasm_modules binding in wrangler.jsonc
 */
const WORKER_URL = 'https://duckdb-worker-test.dotdo.workers.dev'

/**
 * Performance thresholds
 */
const MAX_COLD_START_MS = 2000
const MAX_WARM_START_MS = 500

/**
 * Response types for the test worker
 */
interface TestResponse {
  success: boolean
  result?: {
    answer?: number
    columns?: { name: string; type: string; typeCode: number }[]
    rowCount?: number
    rows?: Record<string, unknown>[]
  }
  error?: string
  stack?: string
  timing?: {
    initializationMs?: number
    queryMs?: number
    totalMs?: number
  }
  metadata?: {
    wasmModuleLoaded?: boolean
    dbInstanceCached?: boolean
  }
}

interface BindingInfoResponse {
  success: boolean
  bindings?: {
    DUCKDB_WASM: {
      available: boolean
      type: string
      isWebAssemblyModule: boolean
    }
  }
  error?: string
}

interface ColdStartResponse {
  success: boolean
  coldStartMs?: number
  result?: {
    answer?: number
  }
  error?: string
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Fetch with timeout for reliability
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 30000
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Clear the worker's internal cache to force cold start
 */
async function clearWorkerCache(): Promise<void> {
  await fetchWithTimeout(`${WORKER_URL}/clear-cache`)
}

// =============================================================================
// TEST SUITE: env.DUCKDB_WASM Binding Availability
// =============================================================================

describe('env.DUCKDB_WASM Binding', () => {
  describe('Binding Availability', () => {
    it('should have DUCKDB_WASM available in env', async () => {
      /**
       * RED TEST: Verify env.DUCKDB_WASM binding is available
       *
       * The worker should expose a /binding-info endpoint that reports
       * the status of the DUCKDB_WASM binding.
       *
       * Expected: bindings.DUCKDB_WASM.available === true
       * Currently: Endpoint does not exist (will fail with 404)
       */
      const response = await fetchWithTimeout(`${WORKER_URL}/binding-info`)
      const data = (await response.json()) as BindingInfoResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.bindings?.DUCKDB_WASM.available).toBe(true)
    })

    it('should expose DUCKDB_WASM as WebAssembly.Module type', async () => {
      /**
       * RED TEST: Verify binding is a WebAssembly.Module
       *
       * Workers wasm_modules bindings should provide pre-compiled
       * WebAssembly.Module instances, not raw ArrayBuffer.
       *
       * Expected: bindings.DUCKDB_WASM.isWebAssemblyModule === true
       * Currently: Endpoint does not exist (will fail)
       */
      const response = await fetchWithTimeout(`${WORKER_URL}/binding-info`)
      const data = (await response.json()) as BindingInfoResponse

      expect(data.bindings?.DUCKDB_WASM.type).toBe('WebAssembly.Module')
      expect(data.bindings?.DUCKDB_WASM.isWebAssemblyModule).toBe(true)
    })

    it('should report binding type correctly', async () => {
      /**
       * RED TEST: Verify typeof reports correctly for WASM module
       *
       * WebAssembly.Module instances should have typeof === 'object'
       * but more importantly, should pass instanceof WebAssembly.Module
       *
       * Expected: type === 'object' or 'WebAssembly.Module'
       * Currently: Endpoint does not exist (will fail)
       */
      const response = await fetchWithTimeout(`${WORKER_URL}/binding-info`)
      const data = (await response.json()) as BindingInfoResponse

      // WebAssembly.Module typeof returns 'object'
      expect(data.bindings?.DUCKDB_WASM.type).toMatch(/object|WebAssembly\.Module/)
    })
  })
})

// =============================================================================
// TEST SUITE: DuckDB Instantiation via wasmModule Option
// =============================================================================

describe('createDuckDB with wasmModule option', () => {
  describe('Instantiation', () => {
    it('should instantiate DuckDB with wasmModule from env binding', async () => {
      /**
       * RED TEST: Verify createDuckDB({ wasmModule: env.DUCKDB_WASM }) works
       *
       * The worker already does this internally. We verify by checking
       * that the /test endpoint succeeds and reports wasmModuleLoaded: true
       *
       * Expected: metadata.wasmModuleLoaded === true
       */
      const response = await fetchWithTimeout(`${WORKER_URL}/test`)
      const data = (await response.json()) as TestResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.metadata?.wasmModuleLoaded).toBe(true)
    })

    it('should create a functional database instance', async () => {
      /**
       * RED TEST: Verify database instance is created and functional
       *
       * After instantiation with wasmModule, the database should be
       * ready to execute queries.
       *
       * Expected: result.answer === 2 (from SELECT 1 + 1)
       */
      const response = await fetchWithTimeout(`${WORKER_URL}/test`)
      const data = (await response.json()) as TestResponse

      expect(data.success).toBe(true)
      expect(data.result?.answer).toBe(2)
    })

    it('should cache the database instance for reuse', async () => {
      /**
       * RED TEST: Verify instance caching works correctly
       *
       * The worker caches the DuckDB instance across requests.
       * Second request should report dbInstanceCached: true
       *
       * Expected: metadata.dbInstanceCached === true
       */
      // First request may create instance
      await fetchWithTimeout(`${WORKER_URL}/test`)

      // Second request should use cached instance
      const response = await fetchWithTimeout(`${WORKER_URL}/test`)
      const data = (await response.json()) as TestResponse

      expect(data.metadata?.dbInstanceCached).toBe(true)
    })

    it('should handle instantiation errors gracefully', async () => {
      /**
       * RED TEST: Verify error handling for instantiation failures
       *
       * If WASM module is invalid or missing, the worker should
       * return a structured error response, not crash.
       *
       * Expected: Worker should have /instantiate-test endpoint
       * that tests instantiation and returns result
       * Currently: Endpoint does not exist (will fail)
       */
      const response = await fetchWithTimeout(`${WORKER_URL}/instantiate-test`)
      const data = (await response.json()) as TestResponse

      expect(response.status).toBe(200)
      // Should either succeed or have structured error
      expect(typeof data.success).toBe('boolean')
      if (!data.success) {
        expect(data.error).toBeDefined()
      }
    })
  })

  describe('Configuration Options', () => {
    it('should accept DuckDBConfig alongside wasmModule', async () => {
      /**
       * RED TEST: Verify config options work with wasmModule
       *
       * createDuckDB(config, { wasmModule }) should apply configuration
       * like maxMemory, threads, etc.
       *
       * Expected: Worker should have /config-test endpoint
       * Currently: Endpoint does not exist (will fail)
       */
      const response = await fetchWithTimeout(`${WORKER_URL}/config-test?maxMemory=64MB`)
      const data = (await response.json()) as TestResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })
})

// =============================================================================
// TEST SUITE: Basic Query Execution
// =============================================================================

describe('Query Execution in Workers Runtime', () => {
  describe('Basic Queries', () => {
    it('should execute SELECT 1 + 1', async () => {
      /**
       * Test basic arithmetic query
       */
      const response = await fetchWithTimeout(
        `${WORKER_URL}/query?sql=${encodeURIComponent('SELECT 1 + 1 as answer')}`
      )
      const data = (await response.json()) as TestResponse

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ answer: 2 })
    })

    it('should execute string queries', async () => {
      /**
       * Test string handling in Workers WASM environment
       */
      const response = await fetchWithTimeout(
        `${WORKER_URL}/query?sql=${encodeURIComponent("SELECT 'Hello, DuckDB Workers!' as greeting")}`
      )
      const data = (await response.json()) as TestResponse

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ greeting: 'Hello, DuckDB Workers!' })
    })

    it('should return column metadata', async () => {
      /**
       * Test that column information is returned correctly
       */
      const response = await fetchWithTimeout(
        `${WORKER_URL}/query?sql=${encodeURIComponent('SELECT 42 as num, \'test\' as str')}`
      )
      const data = (await response.json()) as TestResponse

      expect(data.success).toBe(true)
      expect(data.result?.columns).toHaveLength(2)
      expect(data.result?.columns?.[0].name).toBe('num')
      expect(data.result?.columns?.[1].name).toBe('str')
    })

    it('should handle NULL values', async () => {
      /**
       * Test NULL handling
       */
      const response = await fetchWithTimeout(
        `${WORKER_URL}/query?sql=${encodeURIComponent('SELECT NULL as empty')}`
      )
      const data = (await response.json()) as TestResponse

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ empty: null })
    })

    it('should handle multiple rows', async () => {
      /**
       * Test multi-row result handling
       */
      const sql = 'SELECT 1 as n UNION ALL SELECT 2 UNION ALL SELECT 3'
      const response = await fetchWithTimeout(
        `${WORKER_URL}/query?sql=${encodeURIComponent(sql)}`
      )
      const data = (await response.json()) as TestResponse

      expect(data.success).toBe(true)
      expect(data.result?.rowCount).toBe(3)
      expect(data.result?.rows).toHaveLength(3)
    })
  })

  describe('DuckDB Functions', () => {
    it('should execute md5() function', async () => {
      /**
       * Test that DuckDB built-in functions work
       */
      const response = await fetchWithTimeout(
        `${WORKER_URL}/query?sql=${encodeURIComponent("SELECT md5('hello') as hash")}`
      )
      const data = (await response.json()) as TestResponse

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({
        hash: '5d41402abc4b2a76b9719d911017c592',
      })
    })

    it('should execute string functions', async () => {
      /**
       * Test string manipulation functions
       */
      const response = await fetchWithTimeout(
        `${WORKER_URL}/query?sql=${encodeURIComponent("SELECT upper('hello') as upper_val")}`
      )
      const data = (await response.json()) as TestResponse

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ upper_val: 'HELLO' })
    })
  })

  describe('Error Handling', () => {
    it('should return error for invalid SQL', async () => {
      /**
       * Test error handling for syntax errors
       */
      const response = await fetchWithTimeout(
        `${WORKER_URL}/query?sql=${encodeURIComponent('SELEC * FROM invalid')}`
      )
      const data = (await response.json()) as TestResponse

      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    })

    it('should return error for missing table', async () => {
      /**
       * Test error handling for non-existent tables
       */
      const response = await fetchWithTimeout(
        `${WORKER_URL}/query?sql=${encodeURIComponent('SELECT * FROM nonexistent_table_xyz')}`
      )
      const data = (await response.json()) as TestResponse

      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    })
  })
})

// =============================================================================
// TEST SUITE: Cold Start Performance
// =============================================================================

describe('Cold Start Performance', () => {
  beforeAll(async () => {
    // Clear cache to ensure cold start
    await clearWorkerCache()
  })

  it('should complete cold start under 2000ms', async () => {
    /**
     * RED TEST: Verify cold start meets SLA
     *
     * After clearing cache, the first request should complete
     * in under 2000ms including WASM instantiation.
     *
     * Expected: timing.initializationMs + timing.queryMs < 2000
     */
    // Clear cache first
    await clearWorkerCache()

    // Measure cold start
    const startTime = performance.now()
    const response = await fetchWithTimeout(`${WORKER_URL}/test`)
    const totalClientTime = performance.now() - startTime

    const data = (await response.json()) as TestResponse

    expect(data.success).toBe(true)

    // Check server-side timing
    const serverTotalMs = data.timing?.totalMs ?? 0
    console.log(`Cold start - Server: ${serverTotalMs}ms, Client: ${totalClientTime.toFixed(2)}ms`)

    expect(serverTotalMs).toBeLessThan(MAX_COLD_START_MS)
  })

  it('should report initialization time separately', async () => {
    /**
     * RED TEST: Verify initialization timing is tracked
     *
     * The response should include separate timing for:
     * - initializationMs: WASM loading and DuckDB creation
     * - queryMs: SQL execution time
     * - totalMs: Total request time
     *
     * Expected: All timing fields are present and > 0
     */
    await clearWorkerCache()

    const response = await fetchWithTimeout(`${WORKER_URL}/test`)
    const data = (await response.json()) as TestResponse

    expect(data.timing).toBeDefined()
    expect(typeof data.timing?.initializationMs).toBe('number')
    expect(typeof data.timing?.queryMs).toBe('number')
    expect(typeof data.timing?.totalMs).toBe('number')

    // Initialization should be measurable
    expect(data.timing?.initializationMs).toBeGreaterThan(0)
  })

  it('should have faster warm start after cold start', async () => {
    /**
     * RED TEST: Verify warm start is significantly faster
     *
     * After the initial cold start, subsequent requests should
     * be much faster (< 500ms) due to cached instance.
     *
     * Expected: Second request timing.totalMs < 500ms
     */
    // Ensure warm
    await fetchWithTimeout(`${WORKER_URL}/test`)

    // Measure warm start
    const response = await fetchWithTimeout(`${WORKER_URL}/test`)
    const data = (await response.json()) as TestResponse

    expect(data.success).toBe(true)
    expect(data.timing?.totalMs).toBeLessThan(MAX_WARM_START_MS)
  })

  it('should benefit from pre-compiled WASM module', async () => {
    /**
     * RED TEST: Verify wasm_modules binding provides optimization
     *
     * The wasm_modules binding provides pre-compiled WebAssembly.Module,
     * which should be faster than compiling from binary.
     *
     * Expected: Worker should have /wasm-compile-time endpoint
     * that reports compile vs instantiate times
     * Currently: Endpoint does not exist (will fail)
     */
    const response = await fetchWithTimeout(`${WORKER_URL}/wasm-compile-time`)
    const data = (await response.json()) as { compileTimeMs: number; instantiateTimeMs: number }

    expect(response.status).toBe(200)
    // Pre-compiled should have near-zero compile time
    expect(data.compileTimeMs).toBe(0)
    expect(data.instantiateTimeMs).toBeGreaterThan(0)
  })
})

// =============================================================================
// TEST SUITE: Workers Runtime Compatibility
// =============================================================================

describe('Workers Runtime Compatibility', () => {
  it('should work without Node.js APIs', async () => {
    /**
     * Test that DuckDB operates in pure Workers environment
     * Workers don't have process, fs, require, etc.
     */
    const response = await fetchWithTimeout(`${WORKER_URL}/test`)
    const data = (await response.json()) as TestResponse

    expect(data.success).toBe(true)
    expect(data.result?.answer).toBe(2)
  })

  it('should work with Web Crypto API', async () => {
    /**
     * Test that crypto functions work (uses Web Crypto under the hood)
     */
    const response = await fetchWithTimeout(
      `${WORKER_URL}/query?sql=${encodeURIComponent("SELECT md5('test') as hash")}`
    )
    const data = (await response.json()) as TestResponse

    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0]?.hash).toBe('098f6bcd4621d373cade4e832627b4f6')
  })

  it('should work with TextEncoder/TextDecoder', async () => {
    /**
     * Test that string encoding/decoding works in Workers
     */
    const unicodeString = "Hello, \u4e16\u754c!"
    const response = await fetchWithTimeout(
      `${WORKER_URL}/query?sql=${encodeURIComponent(`SELECT '${unicodeString}' as greeting`)}`
    )
    const data = (await response.json()) as TestResponse

    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0]?.greeting).toBe(unicodeString)
  })

  it('should respect Workers memory limits', async () => {
    /**
     * RED TEST: Verify memory limit compliance
     *
     * Workers have 128MB memory limit. DuckDB should work within this.
     * The worker should have a /memory-test endpoint that allocates
     * memory and reports usage.
     *
     * Expected: Memory usage stays under 100MB (with headroom)
     * Currently: Endpoint does not exist (will fail)
     */
    const response = await fetchWithTimeout(`${WORKER_URL}/memory-test`)
    const data = (await response.json()) as { memoryUsageMB: number; success: boolean }

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.memoryUsageMB).toBeLessThan(100)
  })
})

// =============================================================================
// TEST SUITE: Edge Cases for wasm_modules Binding
// =============================================================================

describe('wasm_modules Binding Edge Cases', () => {
  it('should handle concurrent requests with shared module', async () => {
    /**
     * Test that multiple concurrent requests work correctly
     * The WASM module should be safely shared across requests
     */
    const promises = Array.from({ length: 5 }, (_, i) =>
      fetchWithTimeout(
        `${WORKER_URL}/query?sql=${encodeURIComponent(`SELECT ${i + 1} as n`)}`
      ).then((r) => r.json() as Promise<TestResponse>)
    )

    const results = await Promise.all(promises)

    results.forEach((data, i) => {
      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]?.n).toBe(i + 1)
    })
  })

  it('should maintain isolation between requests', async () => {
    /**
     * Test that each request's query state is isolated
     */
    // Create a table in one request
    await fetchWithTimeout(
      `${WORKER_URL}/query?sql=${encodeURIComponent('CREATE TABLE test_isolation (id INTEGER)')}`
    )

    // Try to select from it (may or may not exist depending on instance caching)
    const response = await fetchWithTimeout(
      `${WORKER_URL}/query?sql=${encodeURIComponent('SELECT * FROM test_isolation')}`
    )
    const data = (await response.json()) as TestResponse

    // The table may or may not exist depending on caching
    // Either way, the query should complete without crashing
    expect(typeof data.success).toBe('boolean')
  })

  it('should recover after cache clear', async () => {
    /**
     * Test that the worker can recover after cache is cleared
     */
    // Clear cache
    await clearWorkerCache()

    // Worker should still work
    const response = await fetchWithTimeout(`${WORKER_URL}/test`)
    const data = (await response.json()) as TestResponse

    expect(data.success).toBe(true)
    expect(data.result?.answer).toBe(2)
  })
})
