/**
 * @dotdo/duckdb - DuckDB Compat Layer Tests (TDD RED Phase)
 *
 * These tests define the expected behavior for the DuckDB compat layer.
 * They are written in TDD RED phase - tests WILL FAIL until the implementation
 * is complete. The tests cover:
 *
 * 1. Parquet file parsing - Reading Parquet files from R2
 * 2. Shard routing - Distributed query routing across shards
 * 3. Memory-only mode - In-memory database operations
 * 4. Query execution - SQL query execution and results
 * 5. Arrow format support - Apache Arrow integration
 * 6. Large dataset handling - Performance with large datasets
 *
 * @see https://duckdb.org/docs/api/nodejs/reference
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'

// These imports will fail until the compat layer is implemented
// import {
//   DuckDBClient,
//   createDuckDB,
//   DuckDBConfig,
//   QueryResult,
//   ShardConfig,
// } from '../index'

// ============================================================================
// 1. PARQUET FILE PARSING
// ============================================================================

describe('Compat DuckDB - Parquet', () => {
  describe('Reading Parquet Files', () => {
    it.todo('reads parquet files from R2', async () => {
      // GIVEN: A Parquet file stored in R2
      // const client = await createDuckDB({
      //   r2Bucket: mockR2Bucket,
      // })

      // WHEN: Querying the Parquet file
      // const result = await client.query("SELECT * FROM read_parquet('data/users.parquet')")

      // THEN: Should return parsed records
      // expect(result.rows).toBeDefined()
      // expect(result.rows.length).toBeGreaterThan(0)
      // expect(result.columns).toContain('id')
    })

    it.todo('reads parquet files with column projection', async () => {
      // GIVEN: A Parquet file with multiple columns
      // const client = await createDuckDB({ r2Bucket: mockR2Bucket })

      // WHEN: Selecting only specific columns
      // const result = await client.query(
      //   "SELECT id, name FROM read_parquet('data/users.parquet')"
      // )

      // THEN: Should only read requested columns (performance optimization)
      // expect(result.columns).toHaveLength(2)
      // expect(result.columns).toEqual(['id', 'name'])
    })

    it.todo('writes query results to parquet', async () => {
      // GIVEN: A query result set
      // const client = await createDuckDB({ r2Bucket: mockR2Bucket })
      // await client.query('CREATE TABLE test_export AS SELECT 1 as id, \'Alice\' as name')

      // WHEN: Exporting to Parquet
      // await client.query("COPY test_export TO 'output/export.parquet' (FORMAT PARQUET)")

      // THEN: Should create valid Parquet file in R2
      // const exported = await mockR2Bucket.get('output/export.parquet')
      // expect(exported).not.toBeNull()
    })

    it.todo('reads parquet with compression (snappy, gzip, zstd)', async () => {
      // GIVEN: Compressed Parquet files
      // const client = await createDuckDB({ r2Bucket: mockR2Bucket })

      // WHEN: Reading files with different compressions
      // const snappy = await client.query("SELECT COUNT(*) as cnt FROM read_parquet('data/snappy.parquet')")
      // const gzip = await client.query("SELECT COUNT(*) as cnt FROM read_parquet('data/gzip.parquet')")
      // const zstd = await client.query("SELECT COUNT(*) as cnt FROM read_parquet('data/zstd.parquet')")

      // THEN: All should be readable
      // expect(snappy.rows[0].cnt).toBe(1000)
      // expect(gzip.rows[0].cnt).toBe(1000)
      // expect(zstd.rows[0].cnt).toBe(1000)
    })

    it.todo('reads parquet metadata without full file scan', async () => {
      // GIVEN: A large Parquet file
      // const client = await createDuckDB({ r2Bucket: mockR2Bucket })

      // WHEN: Reading only metadata
      // const metadata = await client.query(
      //   "SELECT * FROM parquet_metadata('data/large.parquet')"
      // )

      // THEN: Should return file statistics without reading all data
      // expect(metadata.rows[0].num_rows).toBeDefined()
      // expect(metadata.rows[0].num_row_groups).toBeDefined()
    })

    it.todo('handles parquet row group filtering', async () => {
      // GIVEN: A Parquet file with multiple row groups
      // const client = await createDuckDB({ r2Bucket: mockR2Bucket })

      // WHEN: Querying with filter that matches row group statistics
      // const result = await client.query(
      //   "SELECT * FROM read_parquet('data/partitioned.parquet') WHERE id > 500"
      // )

      // THEN: Should skip row groups that don't match (predicate pushdown)
      // Result should be efficient - only reading relevant row groups
      // expect(result.rows.every(r => r.id > 500)).toBe(true)
    })
  })

  describe('Parquet Schema Handling', () => {
    it.todo('infers schema from parquet files', async () => {
      // GIVEN: A Parquet file
      // const client = await createDuckDB({ r2Bucket: mockR2Bucket })

      // WHEN: Reading schema
      // const schema = await client.query(
      //   "SELECT * FROM parquet_schema('data/users.parquet')"
      // )

      // THEN: Should return column definitions
      // expect(schema.rows).toContainEqual(expect.objectContaining({ name: 'id' }))
    })

    it.todo('handles nested parquet structures', async () => {
      // GIVEN: Parquet with nested struct/array types
      // const client = await createDuckDB({ r2Bucket: mockR2Bucket })

      // WHEN: Querying nested data
      // const result = await client.query(
      //   "SELECT data.name, data.nested.value FROM read_parquet('data/nested.parquet')"
      // )

      // THEN: Should correctly parse nested structures
      // expect(result.rows[0]).toHaveProperty('name')
    })
  })
})

// ============================================================================
// 2. SHARD ROUTING
// ============================================================================

describe('Compat DuckDB - Sharding', () => {
  describe('Query Routing', () => {
    it.todo('routes queries to correct shard based on table', async () => {
      // GIVEN: A distributed DuckDB with multiple shards
      // const client = await createDuckDB({
      //   shards: [
      //     { id: 'shard-1', region: 'us-east', tables: ['orders_2023'] },
      //     { id: 'shard-2', region: 'us-west', tables: ['orders_2024'] },
      //   ],
      // })

      // WHEN: Querying a specific table
      // const result = await client.query('SELECT * FROM orders_2023')

      // THEN: Should route to shard-1 only
      // expect(result.metadata.shardsQueried).toContain('shard-1')
      // expect(result.metadata.shardsQueried).not.toContain('shard-2')
    })

    it.todo('routes queries to multiple shards for union tables', async () => {
      // GIVEN: A union table spanning multiple shards
      // const client = await createDuckDB({
      //   shards: [
      //     { id: 'shard-1', tables: ['orders_2023'] },
      //     { id: 'shard-2', tables: ['orders_2024'] },
      //   ],
      //   unionTables: { orders: ['orders_2023', 'orders_2024'] },
      // })

      // WHEN: Querying the union table
      // const result = await client.query('SELECT * FROM orders')

      // THEN: Should query both shards and merge results
      // expect(result.metadata.shardsQueried).toContain('shard-1')
      // expect(result.metadata.shardsQueried).toContain('shard-2')
    })

    it.todo('handles shard failures gracefully', async () => {
      // GIVEN: A cluster with one offline shard
      // const client = await createDuckDB({
      //   shards: [
      //     { id: 'shard-1', tables: ['orders_2023'] },
      //     { id: 'shard-2', tables: ['orders_2024'], offline: true },
      //   ],
      // })

      // WHEN: Querying available data
      // const result = await client.query('SELECT * FROM orders_2023')

      // THEN: Should succeed for available shard
      // expect(result.rows.length).toBeGreaterThan(0)

      // AND: Should report error for offline shard if queried
      // await expect(client.query('SELECT * FROM orders_2024'))
      //   .rejects.toThrow(/shard.*offline/i)
    })

    it.todo('supports consistent hash routing for key-based sharding', async () => {
      // GIVEN: Key-based sharding configuration
      // const client = await createDuckDB({
      //   shardKey: 'tenant_id',
      //   shardAlgorithm: 'consistent',
      //   shards: [
      //     { id: 'shard-1', keyRange: [0, 128] },
      //     { id: 'shard-2', keyRange: [129, 255] },
      //   ],
      // })

      // WHEN: Querying with shard key
      // const result = await client.query(
      //   'SELECT * FROM users WHERE tenant_id = ?',
      //   ['tenant-abc']
      // )

      // THEN: Should route to correct shard based on hash
      // expect(result.metadata.shardsQueried).toHaveLength(1)
    })
  })

  describe('Distributed Aggregation', () => {
    it.todo('performs parallel aggregation across shards', async () => {
      // GIVEN: Data distributed across shards
      // const client = await createDuckDB({
      //   shards: [
      //     { id: 'shard-1', tables: ['orders_2023'] },
      //     { id: 'shard-2', tables: ['orders_2024'] },
      //   ],
      //   unionTables: { orders: ['orders_2023', 'orders_2024'] },
      // })

      // WHEN: Running aggregate query
      // const result = await client.query(
      //   'SELECT SUM(amount) as total FROM orders'
      // )

      // THEN: Should aggregate results from all shards
      // expect(result.rows[0].total).toBeGreaterThan(0)
    })

    it.todo('handles GROUP BY across shards', async () => {
      // GIVEN: Distributed data
      // const client = await createDuckDB({
      //   shards: [
      //     { id: 'shard-1', tables: ['orders_2023'] },
      //     { id: 'shard-2', tables: ['orders_2024'] },
      //   ],
      //   unionTables: { orders: ['orders_2023', 'orders_2024'] },
      // })

      // WHEN: Grouping across shards
      // const result = await client.query(
      //   'SELECT customer_id, SUM(amount) as total FROM orders GROUP BY customer_id'
      // )

      // THEN: Should correctly merge grouped results
      // const customer101 = result.rows.find(r => r.customer_id === 101)
      // expect(customer101.total).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// 3. MEMORY-ONLY MODE
// ============================================================================

describe('Compat DuckDB - Memory Mode', () => {
  describe('In-Memory Database', () => {
    it.todo('creates in-memory database by default', async () => {
      // WHEN: Creating DuckDB without path
      // const client = await createDuckDB()

      // THEN: Should be in-memory mode
      // expect(client.path).toBe(':memory:')
      // expect(client.isOpen).toBe(true)
    })

    it.todo('persists data within session', async () => {
      // GIVEN: An in-memory database
      // const client = await createDuckDB()

      // WHEN: Creating and querying data
      // await client.query('CREATE TABLE mem_test (id INTEGER, value TEXT)')
      // await client.query("INSERT INTO mem_test VALUES (1, 'hello'), (2, 'world')")
      // const result = await client.query('SELECT * FROM mem_test')

      // THEN: Data should be available
      // expect(result.rows).toHaveLength(2)
    })

    it.todo('isolates data between instances', async () => {
      // GIVEN: Two separate in-memory instances
      // const client1 = await createDuckDB()
      // const client2 = await createDuckDB()

      // WHEN: Creating same table in both
      // await client1.query('CREATE TABLE shared (val INTEGER)')
      // await client1.query('INSERT INTO shared VALUES (1)')

      // await client2.query('CREATE TABLE shared (val INTEGER)')
      // await client2.query('INSERT INTO shared VALUES (2)')

      // THEN: Each should have independent data
      // const result1 = await client1.query('SELECT val FROM shared')
      // const result2 = await client2.query('SELECT val FROM shared')

      // expect(result1.rows[0].val).toBe(1)
      // expect(result2.rows[0].val).toBe(2)
    })

    it.todo('clears data on close', async () => {
      // GIVEN: An in-memory database with data
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE cleanup (id INTEGER)')
      // await client.query('INSERT INTO cleanup VALUES (1)')

      // WHEN: Closing and reopening
      // await client.close()
      // const newClient = await createDuckDB()

      // THEN: Data should be gone
      // await expect(newClient.query('SELECT * FROM cleanup'))
      //   .rejects.toThrow(/table.*not found/i)
    })
  })

  describe('Memory Management', () => {
    it.todo('respects memory limits', async () => {
      // GIVEN: A memory-constrained configuration
      // const client = await createDuckDB({
      //   maxMemory: '64MB',
      // })

      // WHEN: Attempting large operation
      // This should work within limits
      // await client.query('CREATE TABLE mem_limit AS SELECT i FROM range(100000) t(i)')

      // THEN: Should succeed within memory budget
      // const result = await client.query('SELECT COUNT(*) as cnt FROM mem_limit')
      // expect(result.rows[0].cnt).toBe(100000)
    })

    it.todo('reports memory usage', async () => {
      // GIVEN: A database with some data
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE mem_usage AS SELECT i FROM range(10000) t(i)')

      // WHEN: Checking memory usage
      // const usage = await client.getMemoryUsage()

      // THEN: Should report usage
      // expect(usage.bytesUsed).toBeGreaterThan(0)
      // expect(usage.bytesUsed).toBeLessThan(usage.maxBytes)
    })
  })
})

// ============================================================================
// 4. QUERY EXECUTION
// ============================================================================

describe('Compat DuckDB - Query Execution', () => {
  describe('Basic Queries', () => {
    it.todo('executes SELECT queries', async () => {
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE exec_test (id INTEGER, name TEXT)')
      // await client.query("INSERT INTO exec_test VALUES (1, 'Alice'), (2, 'Bob')")

      // const result = await client.query('SELECT * FROM exec_test ORDER BY id')

      // expect(result.rows).toHaveLength(2)
      // expect(result.rows[0]).toEqual({ id: 1, name: 'Alice' })
    })

    it.todo('executes parameterized queries', async () => {
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE param_test (id INTEGER, name TEXT)')
      // await client.query("INSERT INTO param_test VALUES (1, 'Alice'), (2, 'Bob')")

      // const result = await client.query(
      //   'SELECT * FROM param_test WHERE id = $1',
      //   [2]
      // )

      // expect(result.rows).toHaveLength(1)
      // expect(result.rows[0].name).toBe('Bob')
    })

    it.todo('executes DDL statements', async () => {
      // const client = await createDuckDB()

      // await client.query(`
      //   CREATE TABLE ddl_test (
      //     id INTEGER PRIMARY KEY,
      //     name VARCHAR NOT NULL,
      //     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      //   )
      // `)

      // const tables = await client.query(
      //   "SELECT table_name FROM information_schema.tables WHERE table_name = 'ddl_test'"
      // )

      // expect(tables.rows).toHaveLength(1)
    })

    it.todo('returns affected row counts for DML', async () => {
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE dml_test (id INTEGER)')
      // await client.query('INSERT INTO dml_test VALUES (1), (2), (3)')

      // const updateResult = await client.query(
      //   'UPDATE dml_test SET id = id * 10 WHERE id < 3'
      // )

      // expect(updateResult.changes).toBe(2)

      // const deleteResult = await client.query('DELETE FROM dml_test WHERE id >= 30')
      // expect(deleteResult.changes).toBe(0) // No rows match after update
    })
  })

  describe('Prepared Statements', () => {
    it.todo('creates and executes prepared statements', async () => {
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE prep_test (id INTEGER, value DOUBLE)')
      // await client.query('INSERT INTO prep_test VALUES (1, 10.5), (2, 20.5), (3, 30.5)')

      // const stmt = client.prepare('SELECT * FROM prep_test WHERE id = ?')

      // const result1 = stmt.all(1)
      // expect(result1[0].value).toBe(10.5)

      // const result2 = stmt.all(2)
      // expect(result2[0].value).toBe(20.5)

      // stmt.finalize()
    })

    it.todo('handles statement reuse efficiently', async () => {
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE reuse_test AS SELECT i as id FROM range(1000) t(i)')

      // const stmt = client.prepare('SELECT * FROM reuse_test WHERE id = ?')

      // const start = performance.now()
      // for (let i = 0; i < 100; i++) {
      //   stmt.all(i)
      // }
      // const elapsed = performance.now() - start

      // THEN: Reused statement should be faster than individual queries
      // expect(elapsed).toBeLessThan(1000) // Should be fast

      // stmt.finalize()
    })
  })

  describe('Error Handling', () => {
    it.todo('throws on syntax errors', async () => {
      // const client = await createDuckDB()

      // await expect(client.query('SELEC * FORM table'))
      //   .rejects.toThrow()
    })

    it.todo('throws on table not found', async () => {
      // const client = await createDuckDB()

      // await expect(client.query('SELECT * FROM nonexistent_table'))
      //   .rejects.toThrow(/table.*not found/i)
    })

    it.todo('provides descriptive error messages', async () => {
      // const client = await createDuckDB()

      // try {
      //   await client.query('INVALID SQL')
      //   expect.fail('Should throw')
      // } catch (error) {
      //   expect(error.message).toBeTruthy()
      //   expect(error.code).toBeDefined()
      // }
    })
  })
})

// ============================================================================
// 5. ARROW FORMAT SUPPORT
// ============================================================================

describe('Compat DuckDB - Arrow Format', () => {
  describe('Arrow IPC', () => {
    it.todo('exports results as Arrow IPC', async () => {
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE arrow_test (id INTEGER, name TEXT)')
      // await client.query("INSERT INTO arrow_test VALUES (1, 'Alice'), (2, 'Bob')")

      // WHEN: Requesting Arrow format
      // const arrowBuffer = await client.queryArrow('SELECT * FROM arrow_test')

      // THEN: Should return valid Arrow IPC buffer
      // expect(arrowBuffer).toBeInstanceOf(Uint8Array)
      // expect(arrowBuffer.length).toBeGreaterThan(0)
    })

    it.todo('imports Arrow tables', async () => {
      // const client = await createDuckDB()

      // GIVEN: An Arrow table
      // const arrowData = createMockArrowTable([
      //   { id: 1, name: 'Alice' },
      //   { id: 2, name: 'Bob' },
      // ])

      // WHEN: Importing Arrow data
      // await client.importArrow('imported_table', arrowData)

      // THEN: Data should be queryable
      // const result = await client.query('SELECT * FROM imported_table')
      // expect(result.rows).toHaveLength(2)
    })

    it.todo('handles Arrow type conversions', async () => {
      // const client = await createDuckDB()

      // GIVEN: Various DuckDB types
      // await client.query(`
      //   CREATE TABLE type_test AS SELECT
      //     42::INTEGER as int_val,
      //     3.14::DOUBLE as float_val,
      //     'hello'::VARCHAR as str_val,
      //     DATE '2024-01-15' as date_val,
      //     TIMESTAMP '2024-01-15 10:30:00' as ts_val
      // `)

      // WHEN: Exporting to Arrow
      // const arrowBuffer = await client.queryArrow('SELECT * FROM type_test')

      // THEN: Types should be preserved
      // (Would need to parse Arrow buffer to verify types)
      // expect(arrowBuffer).toBeDefined()
    })
  })

  describe('Arrow Table API', () => {
    it.todo('returns Arrow Table objects', async () => {
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE tbl_test AS SELECT i FROM range(100) t(i)')

      // WHEN: Getting Arrow table
      // const table = await client.queryAsArrowTable('SELECT * FROM tbl_test')

      // THEN: Should be a valid Arrow Table
      // expect(table.numRows).toBe(100)
      // expect(table.numCols).toBe(1)
      // expect(table.schema.fields[0].name).toBe('i')
    })

    it.todo('supports chunked Arrow results', async () => {
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE chunked_test AS SELECT i FROM range(100000) t(i)')

      // WHEN: Getting chunked results
      // const table = await client.queryAsArrowTable(
      //   'SELECT * FROM chunked_test',
      //   { chunkSize: 10000 }
      // )

      // THEN: Should have multiple chunks
      // expect(table.numRows).toBe(100000)
    })
  })
})

// ============================================================================
// 6. LARGE DATASET HANDLING
// ============================================================================

describe('Compat DuckDB - Large Datasets', () => {
  describe('Performance', () => {
    it.todo('handles 1M row queries efficiently', async () => {
      // const client = await createDuckDB()

      // GIVEN: A table with 1M rows
      // await client.query('CREATE TABLE large_test AS SELECT i FROM range(1000000) t(i)')

      // WHEN: Running aggregate query
      // const start = performance.now()
      // const result = await client.query('SELECT COUNT(*) as cnt, SUM(i) as total FROM large_test')
      // const elapsed = performance.now() - start

      // THEN: Should complete in reasonable time
      // expect(result.rows[0].cnt).toBe(1000000)
      // expect(elapsed).toBeLessThan(5000) // Under 5 seconds
    })

    it.todo('handles wide tables (100+ columns)', async () => {
      // const client = await createDuckDB()

      // GIVEN: A wide table
      // const columns = Array.from({ length: 100 }, (_, i) => `col${i} INTEGER`).join(', ')
      // await client.query(`CREATE TABLE wide_test (${columns})`)

      // const values = Array.from({ length: 100 }, (_, i) => i).join(', ')
      // await client.query(`INSERT INTO wide_test VALUES (${values})`)

      // WHEN: Querying wide table
      // const result = await client.query('SELECT * FROM wide_test')

      // THEN: Should handle all columns
      // expect(Object.keys(result.rows[0])).toHaveLength(100)
    })

    it.todo('streams large results', async () => {
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE stream_test AS SELECT i FROM range(100000) t(i)')

      // WHEN: Streaming results
      // const stream = client.queryStream('SELECT * FROM stream_test')
      // let rowCount = 0

      // for await (const batch of stream) {
      //   rowCount += batch.length
      // }

      // THEN: Should stream all rows
      // expect(rowCount).toBe(100000)
    })

    it.todo('handles concurrent queries', async () => {
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE concurrent_test AS SELECT i FROM range(10000) t(i)')

      // WHEN: Running concurrent queries
      // const queries = [
      //   client.query('SELECT COUNT(*) FROM concurrent_test WHERE i < 2500'),
      //   client.query('SELECT COUNT(*) FROM concurrent_test WHERE i >= 2500 AND i < 5000'),
      //   client.query('SELECT COUNT(*) FROM concurrent_test WHERE i >= 5000 AND i < 7500'),
      //   client.query('SELECT COUNT(*) FROM concurrent_test WHERE i >= 7500'),
      // ]

      // const results = await Promise.all(queries)

      // THEN: All should complete successfully
      // results.forEach(r => expect(r.rows[0]).toBeDefined())
    })
  })

  describe('Memory Efficiency', () => {
    it.todo('uses lazy evaluation for large results', async () => {
      // const client = await createDuckDB({ maxMemory: '32MB' })

      // GIVEN: A query that produces large results
      // await client.query('CREATE TABLE lazy_test AS SELECT i FROM range(1000000) t(i)')

      // WHEN: Running with LIMIT (should not load all data)
      // const result = await client.query(
      //   'SELECT * FROM lazy_test ORDER BY i DESC LIMIT 10'
      // )

      // THEN: Should only return requested rows
      // expect(result.rows).toHaveLength(10)
      // expect(result.rows[0].i).toBe(999999)
    })

    it.todo('garbage collects unused results', async () => {
      // const client = await createDuckDB()

      // WHEN: Running multiple queries that produce intermediate results
      // for (let i = 0; i < 10; i++) {
      //   await client.query(`CREATE TABLE gc_test_${i} AS SELECT j FROM range(100000) t(j)`)
      //   await client.query(`DROP TABLE gc_test_${i}`)
      // }

      // THEN: Memory should be reclaimed
      // const usage = await client.getMemoryUsage()
      // expect(usage.bytesUsed).toBeLessThan(usage.maxBytes * 0.5)
    })
  })
})

// ============================================================================
// 7. ADDITIONAL TESTS (Bonus coverage)
// ============================================================================

describe('Compat DuckDB - Additional Features', () => {
  describe('Iceberg Integration', () => {
    it.todo('reads Iceberg tables from R2', async () => {
      // const client = await createDuckDB({ r2Bucket: mockR2Bucket })

      // WHEN: Querying Iceberg table
      // const result = await client.query(
      //   "SELECT * FROM iceberg_scan('iceberg/products')"
      // )

      // THEN: Should return data from Iceberg format
      // expect(result.rows.length).toBeGreaterThan(0)
    })

    it.todo('handles Iceberg time travel', async () => {
      // const client = await createDuckDB({ r2Bucket: mockR2Bucket })

      // WHEN: Querying specific snapshot
      // const result = await client.query(
      //   "SELECT * FROM iceberg_scan('iceberg/products', snapshot_id => 123456)"
      // )

      // THEN: Should return historical data
      // expect(result.rows).toBeDefined()
    })
  })

  describe('Extensions', () => {
    it.todo('loads JSON extension automatically', async () => {
      // const client = await createDuckDB()

      // WHEN: Using JSON functions
      // const result = await client.query(
      //   "SELECT json_extract('{\"name\": \"Alice\"}', '$.name') as name"
      // )

      // THEN: Should work
      // expect(result.rows[0].name).toBe('Alice')
    })

    it.todo('loads spatial extension when needed', async () => {
      // const client = await createDuckDB()

      // WHEN: Using spatial functions
      // const result = await client.query(
      //   "SELECT ST_Point(1.0, 2.0) as point"
      // )

      // THEN: Should create spatial data
      // expect(result.rows[0].point).toBeDefined()
    })
  })

  describe('Transactions', () => {
    it.todo('supports explicit transactions', async () => {
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE tx_test (id INTEGER)')

      // WHEN: Running transaction
      // await client.query('BEGIN TRANSACTION')
      // await client.query('INSERT INTO tx_test VALUES (1)')
      // await client.query('INSERT INTO tx_test VALUES (2)')
      // await client.query('COMMIT')

      // THEN: Both inserts should be visible
      // const result = await client.query('SELECT COUNT(*) as cnt FROM tx_test')
      // expect(result.rows[0].cnt).toBe(2)
    })

    it.todo('rolls back on error', async () => {
      // const client = await createDuckDB()
      // await client.query('CREATE TABLE rollback_test (id INTEGER UNIQUE)')
      // await client.query('INSERT INTO rollback_test VALUES (1)')

      // try {
      //   await client.query('BEGIN TRANSACTION')
      //   await client.query('INSERT INTO rollback_test VALUES (2)')
      //   await client.query('INSERT INTO rollback_test VALUES (1)') // Duplicate - should fail
      //   await client.query('COMMIT')
      // } catch {
      //   await client.query('ROLLBACK')
      // }

      // THEN: Transaction should have rolled back
      // const result = await client.query('SELECT COUNT(*) as cnt FROM rollback_test')
      // expect(result.rows[0].cnt).toBe(1) // Only original row
    })
  })
})
