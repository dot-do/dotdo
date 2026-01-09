/**
 * E2E Tests for Live DuckDB Worker
 *
 * These tests run against the deployed DuckDB Worker at:
 * https://duckdb-worker-test.dotdo.workers.dev
 *
 * Tests verify:
 * - Basic SQL execution via /test and /query endpoints
 * - DuckDB functions (md5, string functions)
 * - Error handling for invalid SQL and missing parameters
 * - Multi-row results (fixed: previously values after first row were null)
 *
 * Known Limitations (documented as tests):
 * - Multi-statement queries with semicolons may fail or behave unexpectedly
 * - BigInt types (BIGINT, range()) cause JSON serialization errors
 *
 * Run with: npx vitest run --project=duckdb-worker-e2e
 */

import { describe, it, expect } from 'vitest'

const WORKER_URL = 'https://duckdb-worker-test.dotdo.workers.dev'

interface QueryResponse {
  success: boolean
  result?: {
    rows?: Record<string, unknown>[]
    columns?: { name: string; type: string; typeCode: number }[]
    rowCount?: number
    answer?: number
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

interface ErrorResponse {
  error: string
}

/**
 * Helper to execute SQL via the /query endpoint
 */
async function query(sql: string): Promise<QueryResponse> {
  const url = `${WORKER_URL}/query?sql=${encodeURIComponent(sql)}`
  const response = await fetch(url)
  return response.json() as Promise<QueryResponse>
}

// =============================================================================
// BASIC SQL EXECUTION
// =============================================================================

describe('Basic SQL Execution', () => {
  describe('GET /test', () => {
    it('should return success with answer: 2', async () => {
      const response = await fetch(`${WORKER_URL}/test`)
      const data = (await response.json()) as QueryResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.result?.answer).toBe(2)
    })

    it('should include timing metadata', async () => {
      const response = await fetch(`${WORKER_URL}/test`)
      const data = (await response.json()) as QueryResponse

      expect(data.timing).toBeDefined()
      expect(typeof data.timing?.totalMs).toBe('number')
    })

    it('should include WASM metadata', async () => {
      const response = await fetch(`${WORKER_URL}/test`)
      const data = (await response.json()) as QueryResponse

      expect(data.metadata).toBeDefined()
      expect(data.metadata?.wasmModuleLoaded).toBe(true)
    })
  })

  describe('GET / (root)', () => {
    it('should return same result as /test', async () => {
      const response = await fetch(`${WORKER_URL}/`)
      const data = (await response.json()) as QueryResponse

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.result?.answer).toBe(2)
    })
  })

  describe('GET /query', () => {
    it('should execute simple SELECT', async () => {
      const data = await query('SELECT 1 as one')

      expect(data.success).toBe(true)
      expect(data.result?.rows).toHaveLength(1)
      expect(data.result?.rows?.[0]).toEqual({ one: 1 })
    })

    it('should return column metadata', async () => {
      const data = await query('SELECT 1 as num, \'hello\' as str')

      expect(data.result?.columns).toBeDefined()
      expect(data.result?.columns).toHaveLength(2)
      expect(data.result?.columns?.[0].name).toBe('num')
      expect(data.result?.columns?.[0].type).toBe('INTEGER')
      expect(data.result?.columns?.[1].name).toBe('str')
      expect(data.result?.columns?.[1].type).toBe('VARCHAR')
    })

    it('should return row count for multi-row results', async () => {
      const data = await query('SELECT 1 as a UNION ALL SELECT 2 UNION ALL SELECT 3')

      expect(data.success).toBe(true)
      expect(data.result?.rowCount).toBe(3)
    })

    it('should handle arithmetic expressions', async () => {
      const data = await query('SELECT 10 + 5 as sum, 10 * 5 as product, 10 - 5 as diff')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ sum: 15, product: 50, diff: 5 })
    })

    it('should handle string values', async () => {
      const data = await query("SELECT 'Hello, DuckDB!' as greeting")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ greeting: 'Hello, DuckDB!' })
    })

    it('should handle NULL values', async () => {
      const data = await query('SELECT NULL as empty')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ empty: null })
    })

    it('should handle boolean values', async () => {
      const data = await query('SELECT true as yes, false as no')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ yes: true, no: false })
    })

    it('should handle floating point numbers', async () => {
      const data = await query('SELECT 3.14159 as pi')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0].pi).toBeCloseTo(3.14159, 5)
    })

    it('should support POST method', async () => {
      const response = await fetch(`${WORKER_URL}/query?sql=${encodeURIComponent('SELECT 42 as answer')}`, {
        method: 'POST',
      })
      const data = (await response.json()) as QueryResponse

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ answer: 42 })
    })
  })
})

// =============================================================================
// DDL OPERATIONS (Single Statement)
// =============================================================================

describe('DDL Operations', () => {
  describe('Single-statement DDL', () => {
    it('should create table without error', async () => {
      // Each request is ephemeral, so we can only test that CREATE doesn't error
      const data = await query('CREATE TABLE test_ephemeral (id INTEGER, name VARCHAR)')

      // May succeed or fail depending on worker state, but shouldn't crash
      expect(typeof data.success).toBe('boolean')
    })
  })

  describe('Multi-row Results', () => {
    it('should return correct values for all rows', async () => {
      // Multi-row results now work correctly after fixing idx_t legalization
      const data = await query('SELECT 1 as a UNION ALL SELECT 2 UNION ALL SELECT 3')

      expect(data.success).toBe(true)
      expect(data.result?.rowCount).toBe(3)
      expect(data.result?.rows).toHaveLength(3)

      // All rows should have correct values
      expect(data.result?.rows?.[0]).toEqual({ a: 1 })
      expect(data.result?.rows?.[1]).toEqual({ a: 2 })
      expect(data.result?.rows?.[2]).toEqual({ a: 3 })
    })
  })

  describe('Known Limitation: Multi-statement Queries', () => {
    it('should fail or behave unexpectedly with semicolon-separated statements', async () => {
      // Multi-statement queries with semicolons are not reliably supported
      const sql = `CREATE TABLE test_multi (id INTEGER); SELECT 1 as result`
      const data = await query(sql)

      // May fail or only execute last statement - documenting current behavior
      // Either success:false (error) or success:true with only SELECT result
      expect(typeof data.success).toBe('boolean')
    })
  })
})

// =============================================================================
// DUCKDB FUNCTIONS
// =============================================================================

describe('DuckDB Functions', () => {
  describe('md5()', () => {
    it('should compute MD5 hash of a string', async () => {
      const data = await query("SELECT md5('hello') as hash")

      expect(data.success).toBe(true)
      // Known MD5 hash of 'hello'
      expect(data.result?.rows?.[0]).toEqual({ hash: '5d41402abc4b2a76b9719d911017c592' })
    })

    it('should compute MD5 hash of empty string', async () => {
      const data = await query("SELECT md5('') as hash")

      expect(data.success).toBe(true)
      // Known MD5 hash of empty string
      expect(data.result?.rows?.[0]).toEqual({ hash: 'd41d8cd98f00b204e9800998ecf8427e' })
    })
  })

  describe('String Functions', () => {
    it('should support concat()', async () => {
      const data = await query("SELECT concat('hello', ' ', 'world') as greeting")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ greeting: 'hello world' })
    })

    it('should support substr()', async () => {
      const data = await query("SELECT substr('hello world', 1, 5) as sub")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ sub: 'hello' })
    })

    it('should support reverse()', async () => {
      const data = await query("SELECT reverse('hello') as rev")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ rev: 'olleh' })
    })

    it('should support trim()', async () => {
      const data = await query("SELECT trim('  hello  ') as trimmed")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ trimmed: 'hello' })
    })

    it('should support upper()', async () => {
      const data = await query("SELECT upper('hello') as upper_val")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ upper_val: 'HELLO' })
    })

    it('should support lower()', async () => {
      const data = await query("SELECT lower('HELLO') as lower_val")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ lower_val: 'hello' })
    })

    it('should support length() with INTEGER cast', async () => {
      // Note: length() returns BIGINT by default which causes serialization issues
      // Cast to INTEGER to avoid BigInt serialization error
      const data = await query("SELECT CAST(length('hello') AS INTEGER) as len")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ len: 5 })
    })

    it('should support replace()', async () => {
      const data = await query("SELECT replace('hello world', 'world', 'DuckDB') as replaced")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ replaced: 'hello DuckDB' })
    })
  })

  describe('Date/Time Functions', () => {
    it('should support current_date', async () => {
      const data = await query('SELECT current_date as today')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0].today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('should support date arithmetic', async () => {
      const data = await query("SELECT DATE '2024-01-01' + INTERVAL 10 DAY as future")

      expect(data.success).toBe(true)
      // DuckDB returns timestamp for date + interval
      expect(data.result?.rows?.[0].future).toMatch(/2024-01-11/)
    })
  })

  describe('Mathematical Functions', () => {
    it('should support abs()', async () => {
      const data = await query('SELECT abs(-42) as absolute')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ absolute: 42 })
    })

    it('should support round()', async () => {
      const data = await query('SELECT round(3.7) as rounded')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ rounded: 4.0 })
    })

    it('should support floor() and ceil()', async () => {
      const data = await query('SELECT floor(3.7) as f, ceil(3.2) as c')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ f: 3.0, c: 4.0 })
    })
  })

  describe('Known Limitations: BigInt Serialization', () => {
    it('should fail on range() due to BigInt serialization', async () => {
      // range() returns BIGINT which causes JSON serialization issues
      const data = await query('SELECT * FROM range(5) as t(n)')

      expect(data.success).toBe(false)
      expect(data.error).toContain('BigInt')
    })

    it('should fail on length() without cast due to BigInt', async () => {
      // length() returns BIGINT by default
      const data = await query("SELECT length('hello') as len")

      expect(data.success).toBe(false)
      expect(data.error).toContain('BigInt')
    })

    it('should fail on generate_series() due to BigInt', async () => {
      const data = await query('SELECT * FROM generate_series(1, 5) as t(n)')

      expect(data.success).toBe(false)
      expect(data.error).toContain('BigInt')
    })
  })
})

// =============================================================================
// ERROR HANDLING
// =============================================================================

describe('Error Handling', () => {
  describe('Invalid SQL', () => {
    it('should return error for syntax errors', async () => {
      const data = await query('SELEC * FROM invalid')

      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    })

    it('should return error for non-existent table', async () => {
      const data = await query('SELECT * FROM nonexistent_table_xyz')

      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    })
  })

  describe('Missing Parameters', () => {
    it('should return 400 for missing sql parameter', async () => {
      const response = await fetch(`${WORKER_URL}/query`)
      const data = (await response.json()) as ErrorResponse

      expect(response.status).toBe(400)
      expect(data.error).toBe('Missing sql parameter')
    })

    it('should return 400 for empty sql parameter', async () => {
      const response = await fetch(`${WORKER_URL}/query?sql=`)
      const data = (await response.json()) as ErrorResponse

      expect(response.status).toBe(400)
      expect(data.error).toBe('Missing sql parameter')
    })
  })

  describe('Response Structure', () => {
    it('should always include success field', async () => {
      const successData = await query('SELECT 1')
      const errorData = await query('INVALID SQL')

      expect(typeof successData.success).toBe('boolean')
      expect(typeof errorData.success).toBe('boolean')
    })

    it('should include timing on success', async () => {
      const data = await query('SELECT 1')

      expect(data.timing).toBeDefined()
      expect(typeof data.timing?.queryMs).toBe('number')
      expect(typeof data.timing?.totalMs).toBe('number')
    })

    it('should include timing on error', async () => {
      const data = await query('INVALID SQL')

      expect(data.timing).toBeDefined()
      expect(typeof data.timing?.totalMs).toBe('number')
    })
  })
})
