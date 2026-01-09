/**
 * DuckDB WASM Buffer Registration Tests for Cloudflare Workers
 *
 * Tests for registering ArrayBuffer/Uint8Array data as virtual files.
 * This enables the R2/Parquet workflow where:
 * 1. Worker fetches Parquet from R2
 * 2. Buffer is registered with DuckDB
 * 3. SQL queries reference the virtual file via parquet_scan()
 *
 * @see https://duckdb.org/docs/stable/clients/wasm/data_ingestion.html
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'

import {
  createDuckDB,
  clearCache,
  registerFileBuffer,
  dropFile,
  getFileBuffer,
  hasFile,
  listFiles,
  getFileSize,
  clearAllFiles,
  getTotalMemoryUsage,
  type DuckDBInstance,
} from '@dotdo/duckdb-worker'

// Import WASM as ES module (Cloudflare Workers ES module style)
import duckdbWasm from '../../wasm/duckdb-worker.wasm'

// Use WASM module from ES module import
const createDB = (config?: Parameters<typeof createDuckDB>[0]) =>
  createDuckDB(config, { wasmModule: duckdbWasm })

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Create CSV data as a buffer for testing
 */
function createTestCSVBuffer(): Uint8Array {
  const csv = 'id,name,value\n1,Alice,100\n2,Bob,200\n3,Charlie,300'
  return new TextEncoder().encode(csv)
}

/**
 * Create JSON array data as a buffer
 */
function createTestJSONBuffer(): Uint8Array {
  const json = JSON.stringify([
    { id: 1, name: 'Alpha', score: 85.5 },
    { id: 2, name: 'Beta', score: 92.3 },
    { id: 3, name: 'Gamma', score: 78.1 },
  ])
  return new TextEncoder().encode(json)
}

/**
 * Create larger buffer for memory tests
 */
function createLargeBuffer(sizeKB: number): Uint8Array {
  const size = sizeKB * 1024
  const buffer = new Uint8Array(size)
  // Fill with deterministic data
  for (let i = 0; i < size; i++) {
    buffer[i] = i % 256
  }
  return buffer
}

// ============================================================================
// RUNTIME BUFFER MANAGEMENT TESTS
// ============================================================================

/**
 * Buffer registration tests using vitest-pool-workers with WASM module binding.
 * Tests the runtime file buffer management for R2/Parquet workflows.
 */
describe('DuckDB WASM Buffer Registration in Workers', () => {
  // Clean up before each test
  beforeEach(() => {
    clearAllFiles()
  })

  afterAll(() => {
    clearAllFiles()
  })

  describe('registerFileBuffer()', () => {
    it('should register an ArrayBuffer', () => {
      /**
       * Test basic ArrayBuffer registration.
       */
      const buffer = new ArrayBuffer(100)
      registerFileBuffer('test.bin', buffer)

      expect(hasFile('test.bin')).toBe(true)
      expect(getFileSize('test.bin')).toBe(100)
    })

    it('should register a Uint8Array', () => {
      /**
       * Test Uint8Array registration.
       */
      const data = new Uint8Array([1, 2, 3, 4, 5])
      registerFileBuffer('data.bin', data)

      expect(hasFile('data.bin')).toBe(true)
      expect(getFileSize('data.bin')).toBe(5)
    })

    it('should overwrite existing file', () => {
      /**
       * Test that re-registering overwrites.
       */
      registerFileBuffer('file.txt', new ArrayBuffer(50))
      registerFileBuffer('file.txt', new ArrayBuffer(100))

      expect(getFileSize('file.txt')).toBe(100)
    })

    it('should preserve buffer contents', () => {
      /**
       * Test that buffer contents are preserved.
       */
      const original = new Uint8Array([10, 20, 30, 40, 50])
      registerFileBuffer('numbers.bin', original)

      const retrieved = getFileBuffer('numbers.bin')
      expect(retrieved).toBeDefined()
      expect(Array.from(retrieved!)).toEqual([10, 20, 30, 40, 50])
    })

    it('should handle empty buffer', () => {
      /**
       * Test empty buffer registration.
       */
      registerFileBuffer('empty.bin', new ArrayBuffer(0))

      expect(hasFile('empty.bin')).toBe(true)
      expect(getFileSize('empty.bin')).toBe(0)
    })

    it('should handle large buffers (1MB)', () => {
      /**
       * Test registration of larger buffers.
       */
      const largeBuffer = createLargeBuffer(1024) // 1MB
      registerFileBuffer('large.bin', largeBuffer)

      expect(hasFile('large.bin')).toBe(true)
      expect(getFileSize('large.bin')).toBe(1024 * 1024)
    })
  })

  describe('dropFile()', () => {
    it('should remove registered file', () => {
      /**
       * Test file removal.
       */
      registerFileBuffer('temp.dat', new ArrayBuffer(10))
      expect(hasFile('temp.dat')).toBe(true)

      const result = dropFile('temp.dat')
      expect(result).toBe(true)
      expect(hasFile('temp.dat')).toBe(false)
    })

    it('should return false for non-existent file', () => {
      /**
       * Test removal of non-existent file.
       */
      const result = dropFile('does-not-exist.txt')
      expect(result).toBe(false)
    })
  })

  describe('listFiles()', () => {
    it('should return empty array when no files', () => {
      /**
       * Test listing with no files.
       */
      expect(listFiles()).toEqual([])
    })

    it('should list all registered files', () => {
      /**
       * Test listing multiple files.
       */
      registerFileBuffer('a.txt', new ArrayBuffer(1))
      registerFileBuffer('b.txt', new ArrayBuffer(2))
      registerFileBuffer('c.txt', new ArrayBuffer(3))

      const files = listFiles()
      expect(files).toHaveLength(3)
      expect(files).toContain('a.txt')
      expect(files).toContain('b.txt')
      expect(files).toContain('c.txt')
    })
  })

  describe('getTotalMemoryUsage()', () => {
    it('should return 0 when no files', () => {
      /**
       * Test memory usage with no files.
       */
      expect(getTotalMemoryUsage()).toBe(0)
    })

    it('should sum all file sizes', () => {
      /**
       * Test total memory calculation.
       */
      registerFileBuffer('a.bin', new ArrayBuffer(100))
      registerFileBuffer('b.bin', new ArrayBuffer(200))
      registerFileBuffer('c.bin', new ArrayBuffer(300))

      expect(getTotalMemoryUsage()).toBe(600)
    })

    it('should update after file removal', () => {
      /**
       * Test memory tracking after removal.
       */
      registerFileBuffer('a.bin', new ArrayBuffer(100))
      registerFileBuffer('b.bin', new ArrayBuffer(200))
      expect(getTotalMemoryUsage()).toBe(300)

      dropFile('a.bin')
      expect(getTotalMemoryUsage()).toBe(200)
    })
  })

  describe('clearAllFiles()', () => {
    it('should remove all files', () => {
      /**
       * Test clearing all files.
       */
      registerFileBuffer('a.bin', new ArrayBuffer(100))
      registerFileBuffer('b.bin', new ArrayBuffer(200))
      registerFileBuffer('c.bin', new ArrayBuffer(300))
      expect(listFiles()).toHaveLength(3)

      clearAllFiles()
      expect(listFiles()).toHaveLength(0)
      expect(getTotalMemoryUsage()).toBe(0)
    })
  })
})

// ============================================================================
// DATABASE BUFFER INTEGRATION TESTS
// ============================================================================

describe('DuckDB Buffer Query Integration', () => {
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

  afterEach(async () => {
    // Clean up registered buffers via db instance
    clearAllFiles()
  })

  describe('CSV Buffer Registration', () => {
    it('should register CSV and query with read_csv', async () => {
      /**
       * Test CSV file registration and querying.
       * This is a common pattern for data loading in Workers.
       */
      const csvBuffer = createTestCSVBuffer()
      await db.registerBuffer('test.csv', csvBuffer)

      // Query using DuckDB's read_csv function
      const result = await db.query<{ id: number; name: string; value: number }>(
        "SELECT * FROM read_csv('test.csv') ORDER BY id"
      )

      expect(result.rows).toHaveLength(3)
      expect(result.rows[0]).toEqual({ id: 1, name: 'Alice', value: 100 })
      expect(result.rows[1]).toEqual({ id: 2, name: 'Bob', value: 200 })
      expect(result.rows[2]).toEqual({ id: 3, name: 'Charlie', value: 300 })
    })

    it('should query CSV with filtering', async () => {
      /**
       * Test query with WHERE clause on CSV.
       */
      const csvBuffer = createTestCSVBuffer()
      await db.registerBuffer('filtered.csv', csvBuffer)

      const result = await db.query<{ name: string; value: number }>(
        "SELECT name, value FROM read_csv('filtered.csv') WHERE value > 150"
      )

      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((r) => r.name)).toContain('Bob')
      expect(result.rows.map((r) => r.name)).toContain('Charlie')
    })

    it('should query CSV with aggregations', async () => {
      /**
       * Test aggregate queries on CSV.
       */
      const csvBuffer = createTestCSVBuffer()
      await db.registerBuffer('agg.csv', csvBuffer)

      const result = await db.query<{ total: number; avg: number; cnt: number }>(
        "SELECT SUM(value) as total, AVG(value) as avg, COUNT(*) as cnt FROM read_csv('agg.csv')"
      )

      expect(result.rows[0]).toEqual({
        total: 600,
        avg: 200,
        cnt: 3,
      })
    })
  })

  describe('JSON Buffer Registration', () => {
    it('should register JSON and query with read_json', async () => {
      /**
       * Test JSON file registration and querying.
       */
      const jsonBuffer = createTestJSONBuffer()
      await db.registerBuffer('test.json', jsonBuffer)

      const result = await db.query<{ id: number; name: string; score: number }>(
        "SELECT * FROM read_json('test.json') ORDER BY id"
      )

      expect(result.rows).toHaveLength(3)
      expect(result.rows[0].name).toBe('Alpha')
      expect(result.rows[0].score).toBeCloseTo(85.5, 1)
    })
  })

  describe('dropBuffer()', () => {
    it('should remove buffer and fail query', async () => {
      /**
       * Test that dropping buffer makes it unavailable.
       */
      const csvBuffer = createTestCSVBuffer()
      await db.registerBuffer('drop-test.csv', csvBuffer)

      // Verify it works first
      const result = await db.query("SELECT COUNT(*) as cnt FROM read_csv('drop-test.csv')")
      expect(result.rows[0].cnt).toBe(3)

      // Drop and verify query fails
      await db.dropBuffer('drop-test.csv')

      await expect(
        db.query("SELECT * FROM read_csv('drop-test.csv')")
      ).rejects.toThrow()
    })
  })

  describe('Buffer Lifecycle', () => {
    it('should handle buffer overwrite', async () => {
      /**
       * Test that re-registering updates the data.
       */
      const csv1 = new TextEncoder().encode('x\n1\n2')
      const csv2 = new TextEncoder().encode('x\n10\n20\n30')

      await db.registerBuffer('overwrite.csv', csv1)
      let result = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM read_csv('overwrite.csv')"
      )
      expect(result.rows[0].cnt).toBe(2)

      await db.registerBuffer('overwrite.csv', csv2)
      result = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM read_csv('overwrite.csv')"
      )
      expect(result.rows[0].cnt).toBe(3)
    })

    it('should handle multiple buffers', async () => {
      /**
       * Test multiple simultaneous registered buffers.
       */
      const csv1 = new TextEncoder().encode('a\n1\n2')
      const csv2 = new TextEncoder().encode('b\n3\n4')

      await db.registerBuffer('file1.csv', csv1)
      await db.registerBuffer('file2.csv', csv2)

      const result = await db.query<{ total: number }>(`
        SELECT SUM(total) as total FROM (
          SELECT SUM(a) as total FROM read_csv('file1.csv')
          UNION ALL
          SELECT SUM(b) as total FROM read_csv('file2.csv')
        )
      `)

      expect(result.rows[0].total).toBe(1 + 2 + 3 + 4)
    })
  })
})

// ============================================================================
// PARQUET INTEGRATION TESTS (Mock Data)
// ============================================================================

describe('Parquet Buffer Integration (Simulated)', () => {
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

  describe('parquet_scan() Pattern', () => {
    it('should create and query in-memory Parquet', async () => {
      /**
       * Demonstrates the R2/Parquet pattern:
       * 1. Create data in DuckDB
       * 2. Export to Parquet (virtual file)
       * 3. Query using parquet_scan()
       *
       * In production, step 2 would be: fetch from R2, registerBuffer()
       */
      // Create source data
      await db.exec(`
        CREATE TABLE parquet_source AS
        SELECT * FROM (
          VALUES
            (1, 'Product A', 99.99),
            (2, 'Product B', 149.99),
            (3, 'Product C', 199.99)
        ) AS t(id, name, price)
      `)

      // Export to Parquet (creates virtual file)
      await db.exec("COPY parquet_source TO 'products.parquet' (FORMAT PARQUET)")

      // Query using parquet_scan()
      const result = await db.query<{ id: number; name: string; price: number }>(
        "SELECT * FROM parquet_scan('products.parquet') ORDER BY id"
      )

      expect(result.rows).toHaveLength(3)
      expect(result.rows[0]).toEqual({ id: 1, name: 'Product A', price: 99.99 })
      expect(result.rows[1]).toEqual({ id: 2, name: 'Product B', price: 149.99 })
      expect(result.rows[2]).toEqual({ id: 3, name: 'Product C', price: 199.99 })

      // Clean up
      await db.exec('DROP TABLE parquet_source')
    })

    it('should support Parquet predicate pushdown', async () => {
      /**
       * Test that filtering is efficient with Parquet.
       */
      await db.exec(`
        CREATE TABLE large_parquet AS
        SELECT
          i as id,
          'Item_' || i as name,
          i * 10.0 as value
        FROM range(1000) t(i)
      `)

      await db.exec("COPY large_parquet TO 'large.parquet' (FORMAT PARQUET)")

      const result = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM parquet_scan('large.parquet') WHERE id > 500"
      )

      expect(result.rows[0].cnt).toBe(499) // 501-999 inclusive

      await db.exec('DROP TABLE large_parquet')
    })

    it('should support column projection', async () => {
      /**
       * Test that only requested columns are read.
       */
      await db.exec(`
        CREATE TABLE wide_parquet AS
        SELECT
          i as id,
          'Name_' || i as name,
          i * 1.5 as score,
          'Category_' || (i % 5) as category,
          'Extra_' || i as extra_col
        FROM range(100) t(i)
      `)

      await db.exec("COPY wide_parquet TO 'wide.parquet' (FORMAT PARQUET)")

      // Only select specific columns
      const result = await db.query<{ id: number; name: string }>(
        "SELECT id, name FROM parquet_scan('wide.parquet') WHERE id < 5 ORDER BY id"
      )

      expect(result.rows).toHaveLength(5)
      expect(result.columns).toHaveLength(2)
      expect(result.columns.map((c) => c.name)).toEqual(['id', 'name'])

      await db.exec('DROP TABLE wide_parquet')
    })
  })

  describe('R2 Loading Pattern Simulation', () => {
    it('should demonstrate R2 fetch and query pattern', async () => {
      /**
       * This simulates the production R2 pattern:
       *
       * ```typescript
       * // Production code:
       * const response = await env.R2_BUCKET.get('data/sales.parquet')
       * const buffer = await response.arrayBuffer()
       * await db.registerBuffer('sales.parquet', buffer)
       *
       * // Then query:
       * const result = await db.query(`
       *   SELECT region, SUM(revenue)
       *   FROM parquet_scan('sales.parquet')
       *   GROUP BY region
       * `)
       * ```
       */

      // Simulate R2 data
      await db.exec(`
        CREATE TABLE r2_simulation AS
        SELECT * FROM (
          VALUES
            ('2024-01', 'NA', 1000),
            ('2024-01', 'EU', 800),
            ('2024-02', 'NA', 1200),
            ('2024-02', 'EU', 900)
        ) AS t(month, region, revenue)
      `)

      await db.exec("COPY r2_simulation TO 'sales.parquet' (FORMAT PARQUET)")

      // This is the query users would run
      const result = await db.query<{ region: string; total: number }>(`
        SELECT region, SUM(revenue) as total
        FROM parquet_scan('sales.parquet')
        GROUP BY region
        ORDER BY total DESC
      `)

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toEqual({ region: 'NA', total: 2200 })
      expect(result.rows[1]).toEqual({ region: 'EU', total: 1700 })

      await db.exec('DROP TABLE r2_simulation')
    })

    it('should join multiple Parquet files', async () => {
      /**
       * Test joining data from multiple "R2 files".
       */
      await db.exec(`
        CREATE TABLE orders_data AS
        SELECT * FROM (VALUES (1, 100), (2, 200)) AS t(id, amount)
      `)
      await db.exec(`
        CREATE TABLE customers_data AS
        SELECT * FROM (VALUES (1, 'Alice'), (2, 'Bob')) AS t(id, name)
      `)

      await db.exec("COPY orders_data TO 'orders.parquet' (FORMAT PARQUET)")
      await db.exec("COPY customers_data TO 'customers.parquet' (FORMAT PARQUET)")

      const result = await db.query<{ name: string; amount: number }>(`
        SELECT c.name, o.amount
        FROM parquet_scan('orders.parquet') o
        JOIN parquet_scan('customers.parquet') c ON o.id = c.id
        ORDER BY c.name
      `)

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toEqual({ name: 'Alice', amount: 100 })
      expect(result.rows[1]).toEqual({ name: 'Bob', amount: 200 })

      await db.exec('DROP TABLE orders_data')
      await db.exec('DROP TABLE customers_data')
    })
  })
})

// ============================================================================
// CLEANUP TESTS
// ============================================================================

describe('Buffer Cleanup on Close', () => {
  it('should clean up all buffers when database closes', async () => {
    /**
     * Test that closing database releases buffer memory.
     */
    const tempDb = await createDB()

    // Register multiple buffers
    const csv1 = new TextEncoder().encode('a\n1')
    const csv2 = new TextEncoder().encode('b\n2')
    await tempDb.registerBuffer('a.csv', csv1)
    await tempDb.registerBuffer('b.csv', csv2)

    // Close database
    await tempDb.close()

    // Verify closed
    expect(tempDb.isOpen()).toBe(false)
  })

  it('should throw when registering buffer after close', async () => {
    /**
     * Test that operations fail after close.
     */
    const tempDb = await createDB()
    await tempDb.close()

    await expect(
      tempDb.registerBuffer('test.csv', new TextEncoder().encode('x\n1'))
    ).rejects.toThrow()
  })
})
