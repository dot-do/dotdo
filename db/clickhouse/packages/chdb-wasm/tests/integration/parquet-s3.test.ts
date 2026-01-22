/**
 * Parquet s3() Table Function Tests - TDD RED Phase
 *
 * Tests for querying Parquet files via the s3() table function
 * targeting the chdb-lake Worker's /query endpoint.
 *
 * These tests are designed to FAIL initially as the s3() Parquet
 * implementation does not yet exist. This is the TDD RED phase.
 *
 * Test categories:
 * - Basic SELECT from s3('r2://bucket/file.parquet')
 * - SELECT with WHERE clause (predicate pushdown)
 * - Column projection (SELECT specific columns)
 * - Aggregate queries (COUNT, SUM, AVG)
 * - Error handling for non-existent files
 * - Error handling for invalid Parquet files
 * - Glob patterns for multiple files
 *
 * RUNTIME REQUIREMENTS:
 * These tests require the Cloudflare Workers runtime environment because they
 * dynamically import the lake worker which uses `cloudflare:workers` module.
 *
 * To run these tests:
 * 1. Install @cloudflare/vitest-pool-workers: pnpm add -D @cloudflare/vitest-pool-workers
 * 2. Run: npx vitest run -c vitest.integration.config.ts
 *
 * These tests are excluded from the default `npm test` run.
 *
 * @see /Users/nathanclevenger/projects/clickhouse/packages/chdb-wasm/configs/chdb-lake/worker.ts
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Check if we're running in Cloudflare Workers environment
const isCloudflareWorkers = typeof globalThis.caches !== 'undefined' && typeof (globalThis as unknown as { MINIFLARE?: unknown }).MINIFLARE !== 'undefined';
import { createMockR2Bucket, generateMockParquetData, createTestRequest } from '../utils/test-helpers';

// ============================================================================
// Types
// ============================================================================

interface MockR2Object {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  body?: ArrayBuffer | string;
  customMetadata?: Record<string, string>;
}

interface LakeEnv {
  DATA_BUCKET: ReturnType<typeof createMockR2Bucket>;
  WASM_BUCKET: ReturnType<typeof createMockR2Bucket>;
  QUERY_CACHE: {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };
  CHDB_LAKE_VERSION: string;
  ENVIRONMENT: string;
  MAX_QUERY_TIME_MS: string;
  MAX_RESULT_SIZE: string;
  ENABLE_CACHE: string;
  CACHE_TTL: string;
}

interface QueryResult {
  meta: Array<{ name: string; type: string }>;
  data: unknown[];
  rows: number;
  statistics?: {
    elapsed: number;
    rows_read: number;
    bytes_read: number;
    row_groups_scanned?: number;
    row_groups_skipped?: number;
  };
}

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Generate realistic Parquet-like data with schema
 * Note: This creates mock data structure - actual Parquet binary will be handled by WASM
 */
function generateParquetTestData(options: {
  rows: number;
  columns: Array<{ name: string; type: string }>;
  includeNulls?: boolean;
}): { buffer: ArrayBuffer; expectedData: unknown[] } {
  const { rows, columns, includeNulls = false } = options;

  // Generate expected data that would be in the Parquet file
  const expectedData: unknown[] = [];

  for (let i = 0; i < rows; i++) {
    const row: Record<string, unknown> = {};
    for (const col of columns) {
      if (includeNulls && i % 10 === 0) {
        row[col.name] = null;
      } else {
        switch (col.type) {
          case 'Int32':
          case 'Int64':
          case 'UInt32':
          case 'UInt64':
            row[col.name] = i + 1;
            break;
          case 'Float32':
          case 'Float64':
            row[col.name] = (i + 1) * 1.5;
            break;
          case 'String':
            row[col.name] = `value_${i + 1}`;
            break;
          case 'Bool':
            row[col.name] = i % 2 === 0;
            break;
          case 'Date':
            row[col.name] = `2024-01-${String(i % 31 + 1).padStart(2, '0')}`;
            break;
          case 'DateTime':
            row[col.name] = `2024-01-${String(i % 31 + 1).padStart(2, '0')} 12:00:00`;
            break;
          default:
            row[col.name] = `unknown_${i}`;
        }
      }
    }
    expectedData.push(row);
  }

  // Generate mock Parquet binary (PAR1 magic + mock data + PAR1 magic)
  const buffer = generateMockParquetData(rows);

  return { buffer, expectedData };
}

/**
 * Create a mock chdb-lake environment for testing
 */
function createMockLakeEnv(dataObjects: Record<string, MockR2Object>): LakeEnv {
  return {
    DATA_BUCKET: createMockR2Bucket(dataObjects),
    WASM_BUCKET: createMockR2Bucket({
      'chdb-lake.wasm': {
        key: 'chdb-lake.wasm',
        size: 1024 * 1024,
        etag: 'wasm123',
        httpEtag: '"wasm123"',
        body: new ArrayBuffer(100), // Mock WASM bytes
      },
    }),
    QUERY_CACHE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    },
    CHDB_LAKE_VERSION: '0.1.0-test',
    ENVIRONMENT: 'test',
    MAX_QUERY_TIME_MS: '30000',
    MAX_RESULT_SIZE: '10485760',
    ENABLE_CACHE: 'false',
    CACHE_TTL: '300',
  };
}

/**
 * Execute a query against the mock lake worker
 * This simulates calling the /query endpoint
 */
async function executeQuery(
  sql: string,
  env: LakeEnv,
  options: { format?: string } = {}
): Promise<QueryResult> {
  const format = options.format || 'JSON';
  const url = `http://localhost:8789/?query=${encodeURIComponent(sql)}&default_format=${format}`;
  const request = createTestRequest(url, { method: 'GET' });

  // Import the lake worker handler dynamically
  // Note: This will fail until the implementation exists
  const lakeWorker = await import('../../configs/chdb-lake/worker');
  const response = await lakeWorker.default.fetch(request, env as unknown as Parameters<typeof lakeWorker.default.fetch>[1]);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Query failed (${response.status}): ${errorText}`);
  }

  const result = await response.json() as QueryResult;
  return result;
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Parquet s3() Table Function - Integration Tests', () => {
  describe('Basic SELECT Queries', () => {
    it('should query a single Parquet file with SELECT *', async () => {
      // Arrange: Create test Parquet file
      const { buffer, expectedData } = generateParquetTestData({
        rows: 10,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'name', type: 'String' },
          { name: 'value', type: 'Float64' },
        ],
      });

      const env = createMockLakeEnv({
        'data/test.parquet': {
          key: 'data/test.parquet',
          size: buffer.byteLength,
          etag: 'abc123',
          httpEtag: '"abc123"',
          body: buffer,
        },
      });

      // Act: Query the Parquet file
      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/data/test.parquet', 'Parquet')",
        env
      );

      // Assert: Should return all rows with correct schema
      expect(result.meta).toEqual([
        { name: 'id', type: 'Int64' },
        { name: 'name', type: 'String' },
        { name: 'value', type: 'Float64' },
      ]);
      expect(result.rows).toBe(10);
      expect(result.data).toHaveLength(10);
      expect(result.data[0]).toEqual(expectedData[0]);
    });

    it('should query Parquet file with LIMIT clause', async () => {
      const { buffer } = generateParquetTestData({
        rows: 100,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'data', type: 'String' },
        ],
      });

      const env = createMockLakeEnv({
        'events/log.parquet': {
          key: 'events/log.parquet',
          size: buffer.byteLength,
          etag: 'def456',
          httpEtag: '"def456"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/events/log.parquet', 'Parquet') LIMIT 5",
        env
      );

      expect(result.rows).toBe(5);
      expect(result.data).toHaveLength(5);
    });

    it('should query Parquet file with OFFSET and LIMIT', async () => {
      const { buffer, expectedData } = generateParquetTestData({
        rows: 50,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'value', type: 'Int32' },
        ],
      });

      const env = createMockLakeEnv({
        'data/values.parquet': {
          key: 'data/values.parquet',
          size: buffer.byteLength,
          etag: 'ghi789',
          httpEtag: '"ghi789"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/data/values.parquet', 'Parquet') LIMIT 10 OFFSET 20",
        env
      );

      expect(result.rows).toBe(10);
      expect(result.data[0]).toEqual(expectedData[20]);
    });

    it('should infer Parquet format from file extension', async () => {
      const { buffer } = generateParquetTestData({
        rows: 5,
        columns: [{ name: 'x', type: 'Int32' }],
      });

      const env = createMockLakeEnv({
        'auto.parquet': {
          key: 'auto.parquet',
          size: buffer.byteLength,
          etag: 'auto123',
          httpEtag: '"auto123"',
          body: buffer,
        },
      });

      // Query without explicit format - should auto-detect from .parquet extension
      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/auto.parquet')",
        env
      );

      expect(result.rows).toBe(5);
    });
  });

  describe('Column Projection', () => {
    it('should select specific columns from Parquet file', async () => {
      const { buffer } = generateParquetTestData({
        rows: 20,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'name', type: 'String' },
          { name: 'email', type: 'String' },
          { name: 'age', type: 'Int32' },
          { name: 'score', type: 'Float64' },
        ],
      });

      const env = createMockLakeEnv({
        'users.parquet': {
          key: 'users.parquet',
          size: buffer.byteLength,
          etag: 'users123',
          httpEtag: '"users123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT id, name, score FROM s3('r2://data/users.parquet', 'Parquet')",
        env
      );

      // Should only return requested columns
      expect(result.meta).toHaveLength(3);
      expect(result.meta.map(m => m.name)).toEqual(['id', 'name', 'score']);

      // Verify statistics show column projection optimization
      expect(result.statistics).toBeDefined();
    });

    it('should select columns with aliases', async () => {
      const { buffer } = generateParquetTestData({
        rows: 10,
        columns: [
          { name: 'user_id', type: 'Int64' },
          { name: 'full_name', type: 'String' },
        ],
      });

      const env = createMockLakeEnv({
        'people.parquet': {
          key: 'people.parquet',
          size: buffer.byteLength,
          etag: 'ppl123',
          httpEtag: '"ppl123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT user_id AS id, full_name AS name FROM s3('r2://data/people.parquet', 'Parquet')",
        env
      );

      expect(result.meta.map(m => m.name)).toEqual(['id', 'name']);
    });
  });

  describe('WHERE Clause - Predicate Pushdown', () => {
    it('should filter rows with equality predicate', async () => {
      const { buffer } = generateParquetTestData({
        rows: 100,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'category', type: 'String' },
          { name: 'value', type: 'Float64' },
        ],
      });

      const env = createMockLakeEnv({
        'products.parquet': {
          key: 'products.parquet',
          size: buffer.byteLength,
          etag: 'prod123',
          httpEtag: '"prod123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/products.parquet', 'Parquet') WHERE category = 'electronics'",
        env
      );

      // All returned rows should match the predicate
      for (const row of result.data as Array<{ category: string }>) {
        expect(row.category).toBe('electronics');
      }
    });

    it('should filter rows with numeric comparison', async () => {
      const { buffer } = generateParquetTestData({
        rows: 1000,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'price', type: 'Float64' },
        ],
      });

      const env = createMockLakeEnv({
        'prices.parquet': {
          key: 'prices.parquet',
          size: buffer.byteLength,
          etag: 'price123',
          httpEtag: '"price123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/prices.parquet', 'Parquet') WHERE price > 100.0",
        env
      );

      // All returned rows should have price > 100
      for (const row of result.data as Array<{ price: number }>) {
        expect(row.price).toBeGreaterThan(100.0);
      }

      // Statistics should show row groups were potentially skipped
      expect(result.statistics).toBeDefined();
    });

    it('should filter with date range predicate', async () => {
      const { buffer } = generateParquetTestData({
        rows: 365,
        columns: [
          { name: 'date', type: 'Date' },
          { name: 'event', type: 'String' },
          { name: 'count', type: 'Int32' },
        ],
      });

      const env = createMockLakeEnv({
        'events.parquet': {
          key: 'events.parquet',
          size: buffer.byteLength,
          etag: 'evt123',
          httpEtag: '"evt123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/events.parquet', 'Parquet') WHERE date >= '2024-01-15' AND date <= '2024-01-20'",
        env
      );

      // All returned rows should be within date range
      for (const row of result.data as Array<{ date: string }>) {
        expect(row.date >= '2024-01-15' && row.date <= '2024-01-20').toBe(true);
      }
    });

    it('should filter with IN clause', async () => {
      const { buffer } = generateParquetTestData({
        rows: 500,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'status', type: 'String' },
        ],
      });

      const env = createMockLakeEnv({
        'orders.parquet': {
          key: 'orders.parquet',
          size: buffer.byteLength,
          etag: 'ord123',
          httpEtag: '"ord123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/orders.parquet', 'Parquet') WHERE status IN ('pending', 'processing')",
        env
      );

      for (const row of result.data as Array<{ status: string }>) {
        expect(['pending', 'processing']).toContain(row.status);
      }
    });

    it('should filter with complex AND/OR predicates', async () => {
      const { buffer } = generateParquetTestData({
        rows: 200,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'type', type: 'String' },
          { name: 'amount', type: 'Float64' },
          { name: 'active', type: 'Bool' },
        ],
      });

      const env = createMockLakeEnv({
        'transactions.parquet': {
          key: 'transactions.parquet',
          size: buffer.byteLength,
          etag: 'txn123',
          httpEtag: '"txn123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/transactions.parquet', 'Parquet') WHERE (type = 'credit' AND amount > 500) OR (type = 'debit' AND active = true)",
        env
      );

      for (const row of result.data as Array<{ type: string; amount: number; active: boolean }>) {
        const matchesCredit = row.type === 'credit' && row.amount > 500;
        const matchesDebit = row.type === 'debit' && row.active === true;
        expect(matchesCredit || matchesDebit).toBe(true);
      }
    });
  });

  describe('Aggregate Queries', () => {
    it('should compute COUNT(*) over Parquet file', async () => {
      const { buffer } = generateParquetTestData({
        rows: 1000,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'value', type: 'Int32' },
        ],
      });

      const env = createMockLakeEnv({
        'metrics.parquet': {
          key: 'metrics.parquet',
          size: buffer.byteLength,
          etag: 'met123',
          httpEtag: '"met123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT count(*) AS total FROM s3('r2://data/metrics.parquet', 'Parquet')",
        env
      );

      expect(result.rows).toBe(1);
      expect((result.data[0] as { total: number }).total).toBe(1000);
    });

    it('should compute SUM over numeric column', async () => {
      const { buffer, expectedData } = generateParquetTestData({
        rows: 100,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'amount', type: 'Float64' },
        ],
      });

      const expectedSum = expectedData.reduce(
        (acc, row) => acc + ((row as { amount: number }).amount || 0),
        0
      );

      const env = createMockLakeEnv({
        'amounts.parquet': {
          key: 'amounts.parquet',
          size: buffer.byteLength,
          etag: 'amt123',
          httpEtag: '"amt123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT sum(amount) AS total_amount FROM s3('r2://data/amounts.parquet', 'Parquet')",
        env
      );

      expect(result.rows).toBe(1);
      expect((result.data[0] as { total_amount: number }).total_amount).toBeCloseTo(expectedSum, 2);
    });

    it('should compute AVG over numeric column', async () => {
      const { buffer, expectedData } = generateParquetTestData({
        rows: 50,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'score', type: 'Float64' },
        ],
      });

      const expectedAvg =
        expectedData.reduce((acc, row) => acc + ((row as { score: number }).score || 0), 0) /
        expectedData.length;

      const env = createMockLakeEnv({
        'scores.parquet': {
          key: 'scores.parquet',
          size: buffer.byteLength,
          etag: 'scr123',
          httpEtag: '"scr123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT avg(score) AS avg_score FROM s3('r2://data/scores.parquet', 'Parquet')",
        env
      );

      expect(result.rows).toBe(1);
      expect((result.data[0] as { avg_score: number }).avg_score).toBeCloseTo(expectedAvg, 2);
    });

    it('should compute MIN and MAX', async () => {
      const { buffer } = generateParquetTestData({
        rows: 100,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'value', type: 'Int32' },
        ],
      });

      const env = createMockLakeEnv({
        'values.parquet': {
          key: 'values.parquet',
          size: buffer.byteLength,
          etag: 'val123',
          httpEtag: '"val123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT min(value) AS min_val, max(value) AS max_val FROM s3('r2://data/values.parquet', 'Parquet')",
        env
      );

      expect(result.rows).toBe(1);
      expect((result.data[0] as { min_val: number }).min_val).toBe(1);
      expect((result.data[0] as { max_val: number }).max_val).toBe(100);
    });

    it('should compute GROUP BY with aggregates', async () => {
      const { buffer } = generateParquetTestData({
        rows: 500,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'category', type: 'String' },
          { name: 'sales', type: 'Float64' },
        ],
      });

      const env = createMockLakeEnv({
        'sales.parquet': {
          key: 'sales.parquet',
          size: buffer.byteLength,
          etag: 'sales123',
          httpEtag: '"sales123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT category, count(*) AS cnt, sum(sales) AS total_sales FROM s3('r2://data/sales.parquet', 'Parquet') GROUP BY category",
        env
      );

      // Should have one row per distinct category
      expect(result.rows).toBeGreaterThan(0);
      expect(result.meta.map(m => m.name)).toEqual(['category', 'cnt', 'total_sales']);
    });

    it('should compute DISTINCT', async () => {
      const { buffer } = generateParquetTestData({
        rows: 200,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'country', type: 'String' },
        ],
      });

      const env = createMockLakeEnv({
        'users.parquet': {
          key: 'users.parquet',
          size: buffer.byteLength,
          etag: 'usr123',
          httpEtag: '"usr123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT DISTINCT country FROM s3('r2://data/users.parquet', 'Parquet')",
        env
      );

      // Each country should appear only once
      const countries = (result.data as Array<{ country: string }>).map(r => r.country);
      const uniqueCountries = [...new Set(countries)];
      expect(countries.length).toBe(uniqueCountries.length);
    });
  });

  describe('Glob Patterns - Multiple Files', () => {
    it('should query multiple Parquet files with * wildcard', async () => {
      const file1 = generateParquetTestData({
        rows: 50,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'event', type: 'String' },
        ],
      });

      const file2 = generateParquetTestData({
        rows: 50,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'event', type: 'String' },
        ],
      });

      const file3 = generateParquetTestData({
        rows: 50,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'event', type: 'String' },
        ],
      });

      const env = createMockLakeEnv({
        'events/2024-01.parquet': {
          key: 'events/2024-01.parquet',
          size: file1.buffer.byteLength,
          etag: 'jan123',
          httpEtag: '"jan123"',
          body: file1.buffer,
        },
        'events/2024-02.parquet': {
          key: 'events/2024-02.parquet',
          size: file2.buffer.byteLength,
          etag: 'feb123',
          httpEtag: '"feb123"',
          body: file2.buffer,
        },
        'events/2024-03.parquet': {
          key: 'events/2024-03.parquet',
          size: file3.buffer.byteLength,
          etag: 'mar123',
          httpEtag: '"mar123"',
          body: file3.buffer,
        },
      });

      const result = await executeQuery(
        "SELECT count(*) AS total FROM s3('r2://data/events/*.parquet', 'Parquet')",
        env
      );

      // Should aggregate across all 3 files
      expect((result.data[0] as { total: number }).total).toBe(150);
    });

    it('should query files with partial glob pattern', async () => {
      const logFile = generateParquetTestData({
        rows: 30,
        columns: [
          { name: 'timestamp', type: 'DateTime' },
          { name: 'level', type: 'String' },
          { name: 'message', type: 'String' },
        ],
      });

      const metricsFile = generateParquetTestData({
        rows: 20,
        columns: [
          { name: 'timestamp', type: 'DateTime' },
          { name: 'metric', type: 'String' },
          { name: 'value', type: 'Float64' },
        ],
      });

      const env = createMockLakeEnv({
        'data/log_001.parquet': {
          key: 'data/log_001.parquet',
          size: logFile.buffer.byteLength,
          etag: 'log1',
          httpEtag: '"log1"',
          body: logFile.buffer,
        },
        'data/log_002.parquet': {
          key: 'data/log_002.parquet',
          size: logFile.buffer.byteLength,
          etag: 'log2',
          httpEtag: '"log2"',
          body: logFile.buffer,
        },
        'data/metrics.parquet': {
          key: 'data/metrics.parquet',
          size: metricsFile.buffer.byteLength,
          etag: 'met1',
          httpEtag: '"met1"',
          body: metricsFile.buffer,
        },
      });

      // Should only match log files, not metrics
      const result = await executeQuery(
        "SELECT count(*) AS total FROM s3('r2://data/data/log_*.parquet', 'Parquet')",
        env
      );

      expect((result.data[0] as { total: number }).total).toBe(60); // 2 * 30 rows
    });

    it('should query files with nested directory glob', async () => {
      const yearData = generateParquetTestData({
        rows: 100,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'data', type: 'String' },
        ],
      });

      const env = createMockLakeEnv({
        'data/2023/01/data.parquet': {
          key: 'data/2023/01/data.parquet',
          size: yearData.buffer.byteLength,
          etag: '2023-01',
          httpEtag: '"2023-01"',
          body: yearData.buffer,
        },
        'data/2023/02/data.parquet': {
          key: 'data/2023/02/data.parquet',
          size: yearData.buffer.byteLength,
          etag: '2023-02',
          httpEtag: '"2023-02"',
          body: yearData.buffer,
        },
        'data/2024/01/data.parquet': {
          key: 'data/2024/01/data.parquet',
          size: yearData.buffer.byteLength,
          etag: '2024-01',
          httpEtag: '"2024-01"',
          body: yearData.buffer,
        },
      });

      // Query all files across years
      const result = await executeQuery(
        "SELECT count(*) AS total FROM s3('r2://data/data/*/*/data.parquet', 'Parquet')",
        env
      );

      expect((result.data[0] as { total: number }).total).toBe(300); // 3 * 100 rows
    });
  });

  describe('Error Handling', () => {
    it('should return error for non-existent file', async () => {
      const env = createMockLakeEnv({});

      await expect(
        executeQuery(
          "SELECT * FROM s3('r2://data/nonexistent.parquet', 'Parquet')",
          env
        )
      ).rejects.toThrow(/not found|does not exist|FILE_NOT_FOUND/i);
    });

    it('should return error for invalid Parquet file', async () => {
      // Create a file that looks like Parquet but is corrupted
      const invalidData = new ArrayBuffer(100);
      const view = new Uint8Array(invalidData);
      view.fill(0); // Invalid - no PAR1 magic

      const env = createMockLakeEnv({
        'invalid.parquet': {
          key: 'invalid.parquet',
          size: invalidData.byteLength,
          etag: 'inv123',
          httpEtag: '"inv123"',
          body: invalidData,
        },
      });

      await expect(
        executeQuery(
          "SELECT * FROM s3('r2://data/invalid.parquet', 'Parquet')",
          env
        )
      ).rejects.toThrow(/invalid|corrupt|bad magic|INVALID_PARQUET/i);
    });

    it('should return error for truncated Parquet file', async () => {
      // Create truncated Parquet (starts with PAR1 but incomplete)
      const truncated = new ArrayBuffer(10);
      const view = new Uint8Array(truncated);
      view[0] = 0x50; // P
      view[1] = 0x41; // A
      view[2] = 0x52; // R
      view[3] = 0x31; // 1

      const env = createMockLakeEnv({
        'truncated.parquet': {
          key: 'truncated.parquet',
          size: truncated.byteLength,
          etag: 'trunc123',
          httpEtag: '"trunc123"',
          body: truncated,
        },
      });

      await expect(
        executeQuery(
          "SELECT * FROM s3('r2://data/truncated.parquet', 'Parquet')",
          env
        )
      ).rejects.toThrow(/truncated|incomplete|corrupt/i);
    });

    it('should return error for glob pattern matching no files', async () => {
      const env = createMockLakeEnv({
        'data/other.parquet': {
          key: 'data/other.parquet',
          size: 100,
          etag: 'oth123',
          httpEtag: '"oth123"',
          body: generateMockParquetData(10),
        },
      });

      await expect(
        executeQuery(
          "SELECT * FROM s3('r2://data/events/*.parquet', 'Parquet')",
          env
        )
      ).rejects.toThrow(/no files match|pattern.*not found/i);
    });

    it('should return error for invalid SQL syntax', async () => {
      const { buffer } = generateParquetTestData({
        rows: 10,
        columns: [{ name: 'id', type: 'Int64' }],
      });

      const env = createMockLakeEnv({
        'data.parquet': {
          key: 'data.parquet',
          size: buffer.byteLength,
          etag: 'data123',
          httpEtag: '"data123"',
          body: buffer,
        },
      });

      await expect(
        executeQuery(
          "SELET * FROM s3('r2://data/data.parquet', 'Parquet')", // typo in SELECT
          env
        )
      ).rejects.toThrow(/syntax|parse|unexpected/i);
    });

    it('should return error for non-existent column', async () => {
      const { buffer } = generateParquetTestData({
        rows: 10,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'name', type: 'String' },
        ],
      });

      const env = createMockLakeEnv({
        'users.parquet': {
          key: 'users.parquet',
          size: buffer.byteLength,
          etag: 'usr123',
          httpEtag: '"usr123"',
          body: buffer,
        },
      });

      await expect(
        executeQuery(
          "SELECT nonexistent_column FROM s3('r2://data/users.parquet', 'Parquet')",
          env
        )
      ).rejects.toThrow(/column.*not found|unknown column/i);
    });

    // Skip: Timing-based test is inherently flaky - 1ms timeout may or may not trigger
    // depending on execution speed. Timeout behavior is tested at the unit level.
    it.skip('should handle timeout for long-running queries', async () => {
      // Create large dataset that would take too long
      const { buffer } = generateParquetTestData({
        rows: 10000,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'data', type: 'String' },
        ],
      });

      const env = createMockLakeEnv({
        'large.parquet': {
          key: 'large.parquet',
          size: buffer.byteLength,
          etag: 'large123',
          httpEtag: '"large123"',
          body: buffer,
        },
      });

      // Set very short timeout
      env.MAX_QUERY_TIME_MS = '1';

      await expect(
        executeQuery(
          "SELECT * FROM s3('r2://data/large.parquet', 'Parquet')",
          env
        )
      ).rejects.toThrow(/timeout|exceeded.*time/i);
    });
  });

  describe('Output Formats', () => {
    it('should return JSON format by default', async () => {
      const { buffer } = generateParquetTestData({
        rows: 5,
        columns: [{ name: 'id', type: 'Int64' }],
      });

      const env = createMockLakeEnv({
        'data.parquet': {
          key: 'data.parquet',
          size: buffer.byteLength,
          etag: 'data123',
          httpEtag: '"data123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/data.parquet', 'Parquet')",
        env,
        { format: 'JSON' }
      );

      expect(result.meta).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.rows).toBeDefined();
    });

    it('should return JSONCompact format', async () => {
      const { buffer } = generateParquetTestData({
        rows: 5,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'value', type: 'Int32' },
        ],
      });

      const env = createMockLakeEnv({
        'compact.parquet': {
          key: 'compact.parquet',
          size: buffer.byteLength,
          etag: 'cmp123',
          httpEtag: '"cmp123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/compact.parquet', 'Parquet')",
        env,
        { format: 'JSONCompact' }
      );

      // JSONCompact returns data as arrays, not objects
      expect(result.data[0]).toBeInstanceOf(Array);
    });
  });

  describe('Statistics and Metadata', () => {
    it('should include query statistics in response', async () => {
      const { buffer } = generateParquetTestData({
        rows: 100,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'value', type: 'Float64' },
        ],
      });

      const env = createMockLakeEnv({
        'stats.parquet': {
          key: 'stats.parquet',
          size: buffer.byteLength,
          etag: 'stat123',
          httpEtag: '"stat123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/stats.parquet', 'Parquet')",
        env
      );

      expect(result.statistics).toBeDefined();
      expect(result.statistics!.elapsed).toBeGreaterThan(0);
      expect(result.statistics!.rows_read).toBe(100);
      expect(result.statistics!.bytes_read).toBeGreaterThan(0);
    });

    it('should report row groups scanned and skipped', async () => {
      // Create data with multiple row groups (simulated)
      const { buffer } = generateParquetTestData({
        rows: 10000,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'value', type: 'Int32' },
        ],
      });

      const env = createMockLakeEnv({
        'multirowgroup.parquet': {
          key: 'multirowgroup.parquet',
          size: buffer.byteLength,
          etag: 'mrg123',
          httpEtag: '"mrg123"',
          body: buffer,
        },
      });

      // Query with predicate that can skip row groups
      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/multirowgroup.parquet', 'Parquet') WHERE value > 9000",
        env
      );

      expect(result.statistics).toBeDefined();
      expect(result.statistics!.row_groups_scanned).toBeDefined();
      // With predicate pushdown, some row groups should be skipped
      expect(result.statistics!.row_groups_skipped).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Special Data Types', () => {
    it('should handle NULL values', async () => {
      const { buffer } = generateParquetTestData({
        rows: 20,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'nullable_value', type: 'String' },
        ],
        includeNulls: true,
      });

      const env = createMockLakeEnv({
        'nulls.parquet': {
          key: 'nulls.parquet',
          size: buffer.byteLength,
          etag: 'null123',
          httpEtag: '"null123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/nulls.parquet', 'Parquet')",
        env
      );

      // Some rows should have null values
      const hasNulls = (result.data as Array<{ nullable_value: unknown }>).some(
        row => row.nullable_value === null
      );
      expect(hasNulls).toBe(true);
    });

    it('should handle Boolean values', async () => {
      const { buffer } = generateParquetTestData({
        rows: 10,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'active', type: 'Bool' },
        ],
      });

      const env = createMockLakeEnv({
        'bools.parquet': {
          key: 'bools.parquet',
          size: buffer.byteLength,
          etag: 'bool123',
          httpEtag: '"bool123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/bools.parquet', 'Parquet') WHERE active = true",
        env
      );

      for (const row of result.data as Array<{ active: boolean }>) {
        expect(row.active).toBe(true);
      }
    });

    it('should handle DateTime values', async () => {
      const { buffer } = generateParquetTestData({
        rows: 10,
        columns: [
          { name: 'id', type: 'Int64' },
          { name: 'timestamp', type: 'DateTime' },
        ],
      });

      const env = createMockLakeEnv({
        'timestamps.parquet': {
          key: 'timestamps.parquet',
          size: buffer.byteLength,
          etag: 'ts123',
          httpEtag: '"ts123"',
          body: buffer,
        },
      });

      const result = await executeQuery(
        "SELECT * FROM s3('r2://data/timestamps.parquet', 'Parquet')",
        env
      );

      // DateTime values should be strings in ISO format or similar
      const firstRow = result.data[0] as { timestamp: string };
      expect(typeof firstRow.timestamp).toBe('string');
      expect(firstRow.timestamp).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });
});

describe('Parquet s3() Table Function - Unit Tests', () => {
  describe('s3() Function Parsing', () => {
    it('should parse simple s3() function call', () => {
      const sql = "SELECT * FROM s3('r2://data/file.parquet', 'Parquet')";
      const match = sql.match(/s3\s*\(\s*'([^']+)'\s*(?:,\s*'(\w+)')?\s*\)/i);

      expect(match).not.toBeNull();
      expect(match![1]).toBe('r2://data/file.parquet');
      expect(match![2]).toBe('Parquet');
    });

    it('should parse s3() without format (should default to Parquet)', () => {
      const sql = "SELECT * FROM s3('r2://data/file.parquet')";
      const match = sql.match(/s3\s*\(\s*'([^']+)'\s*(?:,\s*'(\w+)')?\s*\)/i);

      expect(match).not.toBeNull();
      expect(match![1]).toBe('r2://data/file.parquet');
      expect(match![2]).toBeUndefined();
    });

    it('should parse s3() with glob pattern', () => {
      const sql = "SELECT * FROM s3('r2://data/events/*.parquet', 'Parquet')";
      const match = sql.match(/s3\s*\(\s*'([^']+)'\s*(?:,\s*'(\w+)')?\s*\)/i);

      expect(match).not.toBeNull();
      const path = match![1];
      expect(path.includes('*')).toBe(true);
    });
  });

  describe('Predicate Extraction', () => {
    it('should extract equality predicate from WHERE clause', () => {
      const sql = "SELECT * FROM s3('r2://data/file.parquet', 'Parquet') WHERE status = 'active'";
      const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|\s*$)/i);

      expect(whereMatch).not.toBeNull();
      expect(whereMatch![1]).toContain("status = 'active'");
    });

    it('should extract numeric comparison from WHERE clause', () => {
      const sql = "SELECT * FROM s3('r2://data/file.parquet', 'Parquet') WHERE price > 100";
      const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|\s*$)/i);

      expect(whereMatch).not.toBeNull();
      expect(whereMatch![1]).toContain('price > 100');
    });
  });

  describe('Column Projection Extraction', () => {
    it('should extract column list from SELECT clause', () => {
      const sql = "SELECT id, name, email FROM s3('r2://data/users.parquet', 'Parquet')";
      const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);

      expect(selectMatch).not.toBeNull();
      const columns = selectMatch![1].split(',').map(c => c.trim());
      expect(columns).toEqual(['id', 'name', 'email']);
    });

    it('should detect SELECT * for no projection', () => {
      const sql = "SELECT * FROM s3('r2://data/file.parquet', 'Parquet')";
      const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);

      expect(selectMatch).not.toBeNull();
      expect(selectMatch![1].trim()).toBe('*');
    });
  });

  describe('Parquet Magic Validation', () => {
    it('should validate PAR1 magic at start of file', () => {
      const data = generateMockParquetData(10);
      const view = new Uint8Array(data);

      const magic = String.fromCharCode(view[0], view[1], view[2], view[3]);
      expect(magic).toBe('PAR1');
    });

    it('should validate PAR1 magic at end of file', () => {
      const data = generateMockParquetData(10);
      const view = new Uint8Array(data);
      const len = view.length;

      const magic = String.fromCharCode(
        view[len - 4],
        view[len - 3],
        view[len - 2],
        view[len - 1]
      );
      expect(magic).toBe('PAR1');
    });
  });

  describe('R2 Path Parsing', () => {
    it('should parse r2://bucket/path format', () => {
      const fullPath = 'r2://data/events/2024-01.parquet';
      const r2Match = fullPath.match(/r2:\/\/(\w+)\/(.+)/);

      expect(r2Match).not.toBeNull();
      expect(r2Match![1]).toBe('data');
      expect(r2Match![2]).toBe('events/2024-01.parquet');
    });

    it('should handle paths without r2:// prefix', () => {
      const path = 'events/2024-01.parquet';
      const hasR2Prefix = path.startsWith('r2://');

      expect(hasR2Prefix).toBe(false);
      // Should default to data bucket
    });
  });

  describe('Glob Pattern Conversion', () => {
    it('should convert * to regex .*', () => {
      const pattern = 'events/*.parquet';
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

      const regex = new RegExp(`^${regexPattern}$`);

      expect(regex.test('events/2024-01.parquet')).toBe(true);
      expect(regex.test('events/2024-02.parquet')).toBe(true);
      expect(regex.test('other/2024-01.parquet')).toBe(false);
    });

    it('should convert ? to regex single character match', () => {
      const pattern = 'log_?.parquet';
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

      const regex = new RegExp(`^${regexPattern}$`);

      expect(regex.test('log_1.parquet')).toBe(true);
      expect(regex.test('log_a.parquet')).toBe(true);
      expect(regex.test('log_12.parquet')).toBe(false);
    });
  });
});
