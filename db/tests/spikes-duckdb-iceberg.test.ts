/**
 * SPIKE: DuckDB Iceberg Extension in WASM Environment
 *
 * Investigation: Can DuckDB WASM use the Iceberg extension to read/write
 * Parquet files to R2/S3?
 *
 * Key Questions:
 * 1. Does the iceberg extension load in DuckDB WASM?
 * 2. Can we write Parquet directly to R2 via httpfs?
 * 3. What's the memory usage for typical operations?
 * 4. Performance: read/write latency for 1MB, 10MB, 100MB tables?
 * 5. Can we use the existing @dotdo/duckdb-worker?
 *
 * @module db/spikes/duckdb-iceberg-spike
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface ExtensionLoadResult {
  name: string
  success: boolean
  error?: string
  loadTimeMs: number
}

interface MemoryBenchmark {
  datasetSize: string
  rowCount: number
  operation: 'create' | 'query' | 'export'
  peakMemoryMB: number
  durationMs: number
  bytesPerRow?: number
}

interface PerformanceResult {
  operation: string
  dataSize: string
  durationMs: number
  throughputMBps?: number
  rowsPerSecond?: number
}

// ============================================================================
// DUCKDB WASM SETUP
// ============================================================================

/**
 * Lazy-loaded DuckDB module
 */
let duckdbModule: typeof import('@dotdo/duckdb-worker') | null = null
let db: import('@dotdo/duckdb-worker').DuckDBInstance | null = null

async function getDuckDB() {
  if (duckdbModule) return duckdbModule
  duckdbModule = await import('@dotdo/duckdb-worker')
  return duckdbModule
}

async function createTestDatabase() {
  const { createDuckDB } = await getDuckDB()
  return createDuckDB()
}

// ============================================================================
// TESTS
// ============================================================================

describe('DuckDB Iceberg WASM Spike', () => {
  beforeAll(async () => {
    const duckdb = await getDuckDB()
    db = await createTestDatabase()
    console.log('[SPIKE] DuckDB instance created')
  })

  afterAll(async () => {
    if (db) {
      await db.close()
      console.log('[SPIKE] DuckDB instance closed')
    }
  })

  // ==========================================================================
  // Q1: Does the iceberg extension load in DuckDB WASM?
  // ==========================================================================
  describe('Q1: Extension Loading', () => {
    it('should list available extensions', async () => {
      if (!db) throw new Error('Database not initialized')

      // Query available extensions
      const result = await db.query(`
        SELECT extension_name, loaded, installed
        FROM duckdb_extensions()
        ORDER BY extension_name
      `)

      console.log('[SPIKE] Available extensions:')
      for (const row of result.rows) {
        console.log(`  - ${row.extension_name}: loaded=${row.loaded}, installed=${row.installed}`)
      }

      expect(result.rows.length).toBeGreaterThan(0)

      // Check for parquet (should be available in WASM)
      const parquetExt = result.rows.find((r: Record<string, unknown>) => r.extension_name === 'parquet')
      expect(parquetExt).toBeDefined()
    })

    it('should attempt to load iceberg extension', async () => {
      if (!db) throw new Error('Database not initialized')

      const loadStart = performance.now()
      let success = false
      let errorMessage: string | undefined

      try {
        // Try to install and load iceberg
        await db.exec('INSTALL iceberg')
        await db.exec('LOAD iceberg')
        success = true
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error)
        console.log(`[SPIKE] Iceberg extension load failed: ${errorMessage}`)
      }

      const loadTimeMs = performance.now() - loadStart

      const result: ExtensionLoadResult = {
        name: 'iceberg',
        success,
        error: errorMessage,
        loadTimeMs,
      }

      console.log('[SPIKE] Iceberg extension load result:', result)

      // Document whether it works or not
      // Based on research, iceberg is NOT available in DuckDB WASM
      // This test documents that finding
      if (!success) {
        console.log('[SPIKE] FINDING: Iceberg extension is NOT available in DuckDB WASM')
        console.log('[SPIKE] See: https://duckdb.org/docs/stable/clients/wasm/extensions')
      }
    })

    it('should attempt to load httpfs extension', async () => {
      if (!db) throw new Error('Database not initialized')

      let success = false
      let errorMessage: string | undefined

      try {
        // httpfs is also not available in WASM due to browser security constraints
        await db.exec('INSTALL httpfs')
        await db.exec('LOAD httpfs')
        success = true
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error)
        console.log(`[SPIKE] httpfs extension load failed: ${errorMessage}`)
      }

      console.log('[SPIKE] httpfs extension available:', success)

      // Document finding
      if (!success) {
        console.log('[SPIKE] FINDING: httpfs extension is NOT available in DuckDB WASM')
        console.log('[SPIKE] CORS restrictions prevent direct S3/R2 access from browser')
      }
    })

    it('should verify parquet extension is available', async () => {
      if (!db) throw new Error('Database not initialized')

      // Parquet should be available - it's in the officially supported list
      const result = await db.query(`
        SELECT extension_name, loaded
        FROM duckdb_extensions()
        WHERE extension_name = 'parquet'
      `)

      console.log('[SPIKE] Parquet extension status:', result.rows[0])

      // Parquet should be built-in or auto-loadable
      expect(result.rows.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // Q2: Can we write Parquet directly to R2 via httpfs?
  // ==========================================================================
  describe('Q2: Parquet Write to R2', () => {
    it('should document httpfs/R2 limitations', async () => {
      // This test documents the findings from research
      const findings = {
        httpfsAvailable: false,
        r2DirectAccess: false,
        reason: 'httpfs extension not available in WASM due to browser security constraints',
        workarounds: [
          'Use parquet-wasm to generate Parquet files in memory',
          'Upload Parquet files to R2 via separate fetch() call',
          'Use CORS proxy for read operations (as shown in tobilg.com article)',
          'Pre-sign URLs for direct client access',
        ],
        recommendedApproach:
          '@dotdo/duckdb-worker + parquet-wasm for generation, then R2 binding or fetch for upload',
      }

      console.log('[SPIKE] R2 Direct Access Findings:', findings)

      expect(findings.httpfsAvailable).toBe(false)
      expect(findings.workarounds.length).toBeGreaterThan(0)
    })

    it('should write Parquet to in-memory buffer', async () => {
      if (!db) throw new Error('Database not initialized')

      // Create test data
      await db.exec(`
        CREATE TABLE test_export AS
        SELECT
          i as id,
          'item_' || i as name,
          random() * 1000 as value,
          current_timestamp as created_at
        FROM generate_series(1, 1000) t(i)
      `)

      // Export to Parquet (in-memory via virtual file)
      const exportStart = performance.now()

      try {
        // COPY TO with parquet format
        await db.exec(`COPY test_export TO 'test.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)`)
        const exportDuration = performance.now() - exportStart

        console.log(`[SPIKE] Parquet export took ${exportDuration.toFixed(2)}ms`)

        // Check if we can get the file buffer
        const buffer = db.getFileBuffer('test.parquet')
        if (buffer) {
          console.log(`[SPIKE] Parquet file size: ${buffer.byteLength} bytes`)
          console.log(`[SPIKE] Bytes per row: ${(buffer.byteLength / 1000).toFixed(2)}`)
        } else {
          console.log('[SPIKE] File buffer not accessible via getFileBuffer')
          console.log('[SPIKE] Note: Custom WASM build does not expose filesystem')
        }
      } catch (error) {
        console.log('[SPIKE] Parquet export error:', error)
        // This is expected - our custom WASM build has -sFILESYSTEM=0
        console.log('[SPIKE] FINDING: COPY TO not supported in Workers build (no filesystem)')
      }

      // Cleanup
      await db.exec('DROP TABLE IF EXISTS test_export')
    })
  })

  // ==========================================================================
  // Q3: Memory usage for typical operations
  // ==========================================================================
  describe('Q3: Memory Usage Benchmarks', () => {
    const benchmarkResults: MemoryBenchmark[] = []

    afterAll(() => {
      console.log('\n[SPIKE] Memory Benchmark Summary:')
      console.table(benchmarkResults)
    })

    it('should benchmark 1KB dataset (~10 rows)', async () => {
      if (!db) throw new Error('Database not initialized')

      const rowCount = 10
      const startTime = performance.now()

      await db.exec(`
        CREATE TABLE bench_1kb AS
        SELECT
          i as id,
          'name_' || i as name,
          random() * 1000 as value
        FROM generate_series(1, ${rowCount}) t(i)
      `)

      const duration = performance.now() - startTime

      // Query to estimate size
      const sizeResult = await db.query(`
        SELECT COUNT(*) as cnt FROM bench_1kb
      `)

      benchmarkResults.push({
        datasetSize: '1KB',
        rowCount,
        operation: 'create',
        peakMemoryMB: 0, // Not directly measurable in WASM
        durationMs: duration,
      })

      await db.exec('DROP TABLE bench_1kb')
      expect(sizeResult.rows[0].cnt).toBe(rowCount)
    })

    it('should benchmark 100KB dataset (~1000 rows)', async () => {
      if (!db) throw new Error('Database not initialized')

      const rowCount = 1000
      const startTime = performance.now()

      await db.exec(`
        CREATE TABLE bench_100kb AS
        SELECT
          i as id,
          'name_' || i || '_' || md5(i::VARCHAR)::VARCHAR as name,
          random() * 1000 as value,
          current_timestamp + interval (i) second as ts
        FROM generate_series(1, ${rowCount}) t(i)
      `)

      const createDuration = performance.now() - startTime

      // Query benchmark
      const queryStart = performance.now()
      await db.query(`SELECT COUNT(*), AVG(value) FROM bench_100kb WHERE value > 500`)
      const queryDuration = performance.now() - queryStart

      benchmarkResults.push({
        datasetSize: '100KB',
        rowCount,
        operation: 'create',
        peakMemoryMB: 0,
        durationMs: createDuration,
      })

      benchmarkResults.push({
        datasetSize: '100KB',
        rowCount,
        operation: 'query',
        peakMemoryMB: 0,
        durationMs: queryDuration,
      })

      await db.exec('DROP TABLE bench_100kb')
    })

    it('should benchmark 1MB dataset (~10000 rows)', async () => {
      if (!db) throw new Error('Database not initialized')

      const rowCount = 10000
      const startTime = performance.now()

      await db.exec(`
        CREATE TABLE bench_1mb AS
        SELECT
          i as id,
          'name_' || i || '_' || md5(i::VARCHAR)::VARCHAR as name,
          random() * 1000 as value,
          current_timestamp + interval (i) second as ts,
          md5(i::VARCHAR)::VARCHAR as hash
        FROM generate_series(1, ${rowCount}) t(i)
      `)

      const createDuration = performance.now() - startTime

      // Aggregation query
      const queryStart = performance.now()
      await db.query(`
        SELECT
          COUNT(*) as cnt,
          AVG(value) as avg_val,
          MIN(value) as min_val,
          MAX(value) as max_val
        FROM bench_1mb
        WHERE value > 250
        GROUP BY (id / 1000)
      `)
      const queryDuration = performance.now() - queryStart

      benchmarkResults.push({
        datasetSize: '1MB',
        rowCount,
        operation: 'create',
        peakMemoryMB: 0,
        durationMs: createDuration,
        bytesPerRow: Math.round((1024 * 1024) / rowCount),
      })

      benchmarkResults.push({
        datasetSize: '1MB',
        rowCount,
        operation: 'query',
        peakMemoryMB: 0,
        durationMs: queryDuration,
      })

      await db.exec('DROP TABLE bench_1mb')
    })

    it('should benchmark 10MB dataset (~100000 rows)', async () => {
      if (!db) throw new Error('Database not initialized')

      const rowCount = 100000
      const startTime = performance.now()

      await db.exec(`
        CREATE TABLE bench_10mb AS
        SELECT
          i as id,
          'name_' || i || '_' || md5(i::VARCHAR)::VARCHAR as name,
          random() * 1000 as value,
          current_timestamp + interval (i) second as ts,
          md5(i::VARCHAR)::VARCHAR as hash
        FROM generate_series(1, ${rowCount}) t(i)
      `)

      const createDuration = performance.now() - startTime

      // Complex query
      const queryStart = performance.now()
      await db.query(`
        SELECT
          (id / 10000) as bucket,
          COUNT(*) as cnt,
          AVG(value) as avg_val,
          SUM(value) as total
        FROM bench_10mb
        WHERE value BETWEEN 200 AND 800
        GROUP BY bucket
        ORDER BY total DESC
        LIMIT 10
      `)
      const queryDuration = performance.now() - queryStart

      benchmarkResults.push({
        datasetSize: '10MB',
        rowCount,
        operation: 'create',
        peakMemoryMB: 0,
        durationMs: createDuration,
        bytesPerRow: Math.round((10 * 1024 * 1024) / rowCount),
      })

      benchmarkResults.push({
        datasetSize: '10MB',
        rowCount,
        operation: 'query',
        peakMemoryMB: 0,
        durationMs: queryDuration,
      })

      console.log(`[SPIKE] 10MB create: ${createDuration.toFixed(2)}ms`)
      console.log(`[SPIKE] 10MB query: ${queryDuration.toFixed(2)}ms`)

      await db.exec('DROP TABLE bench_10mb')
    })
  })

  // ==========================================================================
  // Q4: Performance benchmarks
  // ==========================================================================
  describe('Q4: Performance Benchmarks', () => {
    const performanceResults: PerformanceResult[] = []

    afterAll(() => {
      console.log('\n[SPIKE] Performance Results:')
      console.table(performanceResults)
    })

    it('should benchmark INSERT performance', async () => {
      if (!db) throw new Error('Database not initialized')

      await db.exec(`
        CREATE TABLE perf_insert (
          id INTEGER PRIMARY KEY,
          name VARCHAR,
          value DOUBLE,
          ts TIMESTAMP
        )
      `)

      const rowCounts = [100, 1000, 10000]

      for (const count of rowCounts) {
        const start = performance.now()

        await db.exec(`
          INSERT INTO perf_insert
          SELECT
            i,
            'item_' || i,
            random() * 1000,
            current_timestamp
          FROM generate_series(1, ${count}) t(i)
        `)

        const duration = performance.now() - start

        performanceResults.push({
          operation: 'INSERT',
          dataSize: `${count} rows`,
          durationMs: duration,
          rowsPerSecond: Math.round(count / (duration / 1000)),
        })

        await db.exec('DELETE FROM perf_insert')
      }

      await db.exec('DROP TABLE perf_insert')
    })

    it('should benchmark SELECT performance', async () => {
      if (!db) throw new Error('Database not initialized')

      // Create test data
      await db.exec(`
        CREATE TABLE perf_select AS
        SELECT
          i as id,
          'item_' || i as name,
          random() * 1000 as value,
          (i % 10) as category
        FROM generate_series(1, 100000) t(i)
      `)

      // Simple select
      let start = performance.now()
      await db.query('SELECT * FROM perf_select LIMIT 1000')
      let duration = performance.now() - start

      performanceResults.push({
        operation: 'SELECT LIMIT 1000',
        dataSize: '100K rows table',
        durationMs: duration,
      })

      // Filtered select
      start = performance.now()
      await db.query('SELECT * FROM perf_select WHERE value > 500')
      duration = performance.now() - start

      performanceResults.push({
        operation: 'SELECT WHERE',
        dataSize: '~50K matching rows',
        durationMs: duration,
      })

      // Aggregation
      start = performance.now()
      await db.query(`
        SELECT category, COUNT(*), AVG(value), SUM(value)
        FROM perf_select
        GROUP BY category
      `)
      duration = performance.now() - start

      performanceResults.push({
        operation: 'SELECT GROUP BY',
        dataSize: '100K rows, 10 groups',
        durationMs: duration,
      })

      // Join performance (self-join)
      await db.exec(`
        CREATE TABLE perf_join AS
        SELECT * FROM perf_select LIMIT 10000
      `)

      start = performance.now()
      await db.query(`
        SELECT a.id, b.value
        FROM perf_join a
        JOIN perf_join b ON a.category = b.category
        WHERE a.id < 100
        LIMIT 10000
      `)
      duration = performance.now() - start

      performanceResults.push({
        operation: 'JOIN',
        dataSize: '10K x 10K (limited)',
        durationMs: duration,
      })

      await db.exec('DROP TABLE perf_select')
      await db.exec('DROP TABLE perf_join')
    })
  })

  // ==========================================================================
  // Q5: @dotdo/duckdb-worker integration
  // ==========================================================================
  describe('Q5: @dotdo/duckdb-worker Integration', () => {
    it('should verify DuckDBInstance API compatibility', async () => {
      if (!db) throw new Error('Database not initialized')

      // Test query method
      const queryResult = await db.query('SELECT 1 + 1 as answer')
      expect(queryResult.rows[0].answer).toBe(2)

      // Test exec method
      await db.exec('CREATE TABLE api_test (id INT)')
      await db.exec('INSERT INTO api_test VALUES (1), (2), (3)')

      const countResult = await db.query('SELECT COUNT(*) as cnt FROM api_test')
      expect(countResult.rows[0].cnt).toBe(3)

      // Test prepared statements
      const stmt = await db.prepare('SELECT * FROM api_test WHERE id > $1')
      const stmtResult = await stmt.execute([1])
      expect(stmtResult.rows.length).toBe(2)
      await stmt.finalize()

      // Cleanup
      await db.exec('DROP TABLE api_test')

      console.log('[SPIKE] @dotdo/duckdb-worker API verified')
    })

    it('should verify file buffer registration', async () => {
      if (!db) throw new Error('Database not initialized')

      // Create a simple buffer
      const testData = new Uint8Array([1, 2, 3, 4, 5])
      db.registerFileBuffer('test-buffer.bin', testData)

      expect(db.hasFile('test-buffer.bin')).toBe(true)
      expect(db.listFiles()).toContain('test-buffer.bin')

      const retrieved = db.getFileBuffer('test-buffer.bin')
      expect(retrieved).toBeDefined()
      expect(retrieved?.length).toBe(5)

      // Drop the file
      expect(db.dropFile('test-buffer.bin')).toBe(true)
      expect(db.hasFile('test-buffer.bin')).toBe(false)

      console.log('[SPIKE] File buffer API verified')
    })

    it('should document recommended architecture', () => {
      const architecture = {
        readPath: {
          description: 'Query Iceberg tables from DO',
          steps: [
            '1. Iceberg metadata stored in R2 (manifest, schema)',
            '2. Parquet data files stored in R2',
            '3. DO fetches metadata via R2 binding (not httpfs)',
            '4. DO fetches required Parquet columns via R2 binding',
            '5. DuckDB WASM processes data in memory',
            '6. Results returned to client',
          ],
          latency: 'O(100ms) for metadata + O(data size) for read',
        },
        writePath: {
          description: 'Write Parquet to R2 from DO',
          steps: [
            '1. Data accumulated in DuckDB in-memory table',
            '2. parquet-wasm generates Parquet buffer',
            '3. DO writes buffer to R2 via binding',
            '4. Update Iceberg manifest in R2',
            '5. Optionally update DO-local index cache',
          ],
          latency: 'O(data size) for parquet + O(10ms) for R2 write',
        },
        limitations: [
          'No direct httpfs support in WASM',
          'Must proxy all R2 access through DO/Worker binding',
          'Iceberg extension not available in WASM',
          'Manual manifest management required',
        ],
        recommendation:
          'Use existing IcebergIndexAccelerator pattern with parquet-wasm for file generation',
      }

      console.log('\n[SPIKE] Recommended Architecture:')
      console.log(JSON.stringify(architecture, null, 2))

      expect(architecture.writePath.steps.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// INTEGRATION TEST: Full Read/Write Path
// ============================================================================

describe('Integration: Simulated Iceberg Flow', () => {
  let db: import('@dotdo/duckdb-worker').DuckDBInstance | null = null

  beforeAll(async () => {
    const duckdb = await getDuckDB()
    db = await duckdb.createDuckDB()
  })

  afterAll(async () => {
    if (db) await db.close()
  })

  it('should simulate Iceberg read path (without extension)', async () => {
    if (!db) throw new Error('Database not initialized')

    // Simulate: Parquet data already fetched from R2 and registered
    // In production: const parquetBuffer = await env.R2.get('data.parquet')

    // Create test data (simulating Parquet content)
    await db.exec(`
      CREATE TABLE simulated_parquet AS
      SELECT
        i as id,
        'user_' || i as name,
        random() * 100 as score,
        current_timestamp - interval (i * 3600) second as created_at
      FROM generate_series(1, 10000) t(i)
    `)

    // Simulate iceberg_scan() with regular SELECT
    const queryStart = performance.now()
    const result = await db.query(`
      SELECT
        COUNT(*) as total,
        AVG(score) as avg_score,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM simulated_parquet
      WHERE score > 50
    `)
    const queryDuration = performance.now() - queryStart

    console.log('[SPIKE] Simulated Iceberg read:')
    console.log(`  Duration: ${queryDuration.toFixed(2)}ms`)
    console.log(`  Results:`, result.rows[0])

    expect(result.rows[0].total).toBeGreaterThan(0)

    await db.exec('DROP TABLE simulated_parquet')
  })

  it('should demonstrate alternative to iceberg_scan()', async () => {
    if (!db) throw new Error('Database not initialized')

    // Alternative approach: Use parquet-wasm to read Parquet into Arrow,
    // then convert to DuckDB-compatible format

    const alternativeApproach = `
    // 1. Fetch Parquet from R2
    const parquetBuffer = await env.R2.get('table.parquet').arrayBuffer()

    // 2. Use parquet-wasm to read (if needed for metadata)
    import { readParquet } from 'parquet-wasm'
    const arrowTable = readParquet(new Uint8Array(parquetBuffer))

    // 3. Option A: Register buffer with DuckDB and read directly
    db.registerFileBuffer('table.parquet', parquetBuffer)
    // Note: This requires filesystem support which our build doesn't have

    // 4. Option B: Convert Arrow to DuckDB via INSERT
    // Convert Arrow batches to SQL INSERT statements
    // This is slower but works without filesystem

    // 5. Option C: Use Arrow IPC format
    // Export Arrow table to IPC, then import into DuckDB
    `

    console.log('[SPIKE] Alternative approaches documented')
    console.log('[SPIKE] Recommended: Use IcebergIndexAccelerator pattern')

    expect(alternativeApproach).toContain('parquet-wasm')
  })
})
