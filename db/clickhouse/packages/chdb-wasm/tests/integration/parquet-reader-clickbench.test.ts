/**
 * Parquet Reader Integration Tests - ClickBench Dataset
 *
 * These tests verify the ParquetReader can read the real ClickBench hits dataset
 * from ClickHouse's public dataset server.
 *
 * NOTE: These tests require network access and may be slow.
 * They are marked with .skip by default and can be enabled for manual testing.
 */

import { describe, it, expect } from 'vitest';
import { ParquetReader, createParquetReader } from '../../src/parquet-reader';
import { ParquetDataSource, createClickBenchParquetSource } from '../../src/clickbench/parquet-data-source';

// ClickBench hits dataset URL (14GB compressed, ~100M rows)
const CLICKBENCH_HITS_URL = 'https://datasets.clickhouse.com/hits_compatible/hits.parquet';

// Smaller sample dataset URL for faster tests
const CLICKBENCH_SAMPLE_URL = 'https://datasets.clickhouse.com/hits_compatible/hits.parquet';

describe.skip('ParquetReader - ClickBench Integration', () => {
  describe('getMetadata', () => {
    it('should read metadata from ClickBench hits.parquet', async () => {
      const reader = new ParquetReader(CLICKBENCH_HITS_URL);
      const metadata = await reader.getMetadata();

      // Verify basic metadata
      expect(metadata.rowCount).toBeGreaterThan(0);
      expect(metadata.rowGroups).toBeGreaterThan(0);
      expect(metadata.schema.length).toBeGreaterThan(0);

      // Verify expected columns exist
      const columnNames = metadata.schema.map(c => c.name);
      expect(columnNames).toContain('WatchID');
      expect(columnNames).toContain('CounterID');
      expect(columnNames).toContain('UserID');
      expect(columnNames).toContain('EventTime');
      expect(columnNames).toContain('URL');

      console.log(`ClickBench hits.parquet metadata:`);
      console.log(`  Row count: ${metadata.rowCount.toLocaleString()}`);
      console.log(`  Row groups: ${metadata.rowGroups}`);
      console.log(`  Columns: ${metadata.schema.length}`);
      console.log(`  File size: ${(metadata.fileSize! / (1024 * 1024 * 1024)).toFixed(2)} GB`);
    }, 30000);

    it('should support HTTP range requests', async () => {
      const reader = new ParquetReader(CLICKBENCH_HITS_URL);
      const supportsRanges = await reader.supportsRangeRequests();

      expect(supportsRanges).toBe(true);
    }, 10000);
  });

  describe('readColumns', () => {
    it('should read specific columns with limit', async () => {
      const reader = new ParquetReader(CLICKBENCH_HITS_URL);
      const result = await reader.readColumns(['CounterID', 'UserID'], { limit: 100 });

      expect(result.rows).toBe(100);
      expect(result.data.length).toBe(100);
      expect(result.meta.length).toBe(2);

      // Verify column data
      for (const row of result.data) {
        expect(row).toHaveProperty('CounterID');
        expect(row).toHaveProperty('UserID');
        expect(typeof row.CounterID).toBe('number');
      }

      console.log(`Read ${result.rows} rows in ${result.elapsedMs.toFixed(2)}ms`);
      console.log(`Sample row:`, result.data[0]);
    }, 60000);

    it('should read with offset', async () => {
      const reader = new ParquetReader(CLICKBENCH_HITS_URL);

      // Read first 10 rows
      const first = await reader.readColumns(['WatchID'], { limit: 10 });

      // Read 10 rows starting at offset 5
      const offset = await reader.readColumns(['WatchID'], { limit: 10, offset: 5 });

      // The 6th row from first should equal 1st row from offset
      expect(offset.data[0].WatchID).toBe(first.data[5].WatchID);
    }, 60000);

    it('should read all columns when no column list specified', async () => {
      const reader = new ParquetReader(CLICKBENCH_HITS_URL);
      const result = await reader.readAll({ limit: 10 });

      // Should have all 105 columns
      expect(result.meta.length).toBeGreaterThan(100);
      expect(Object.keys(result.data[0]).length).toBeGreaterThan(100);

      console.log(`Read ${result.meta.length} columns`);
    }, 60000);
  });

  describe('getRowGroupStats', () => {
    it('should return row group statistics', async () => {
      const reader = new ParquetReader(CLICKBENCH_HITS_URL);
      const stats = await reader.getRowGroupStats();

      expect(stats.length).toBeGreaterThan(0);

      for (const rg of stats) {
        expect(rg.rowGroupIndex).toBeGreaterThanOrEqual(0);
        expect(rg.numRows).toBeGreaterThan(0);
        expect(rg.totalByteSize).toBeGreaterThan(0);
      }

      console.log(`Row group stats (first 5):`);
      for (const rg of stats.slice(0, 5)) {
        console.log(`  RG ${rg.rowGroupIndex}: ${rg.numRows.toLocaleString()} rows, ${(rg.totalByteSize / 1024 / 1024).toFixed(2)} MB`);
      }
    }, 30000);
  });
});

describe.skip('ParquetDataSource - ClickBench Integration', () => {
  describe('createClickBenchParquetSource', () => {
    it('should create a data source for the default ClickBench URL', async () => {
      const dataSource = createClickBenchParquetSource();
      const metadata = await dataSource.getMetadata();

      expect(metadata.rowCount).toBeGreaterThan(0);
      console.log(`Data source created for ${metadata.rowCount.toLocaleString()} rows`);
    }, 30000);
  });

  describe('readColumns', () => {
    it('should read columns with default options', async () => {
      const dataSource = new ParquetDataSource({ url: CLICKBENCH_HITS_URL });
      const rows = await dataSource.readColumns(['CounterID', 'UserID'], { limit: 100 });

      expect(rows.length).toBe(100);
      expect(rows[0]).toHaveProperty('CounterID');
      expect(rows[0]).toHaveProperty('UserID');
    }, 60000);

    it('should filter rows by conditions', async () => {
      const dataSource = new ParquetDataSource({ url: CLICKBENCH_HITS_URL });

      // Read rows where CounterID > 100000
      const rows = await dataSource.readColumns(['CounterID', 'UserID'], {
        limit: 1000,
        conditions: [
          { column: 'CounterID', operator: '>', value: 100000 },
        ],
      });

      // All returned rows should have CounterID > 100000
      for (const row of rows) {
        expect(row.CounterID).toBeGreaterThan(100000);
      }

      console.log(`Found ${rows.length} rows with CounterID > 100000`);
    }, 60000);
  });
});

describe('ParquetReader - Example Usage', () => {
  it('should demonstrate the API usage pattern', async () => {
    // This test demonstrates the API without actually making network calls

    // Example 1: Create a reader
    const reader = createParquetReader(CLICKBENCH_HITS_URL);

    // The reader exposes these methods:
    expect(typeof reader.getMetadata).toBe('function');
    expect(typeof reader.getColumnNames).toBe('function');
    expect(typeof reader.readColumns).toBe('function');
    expect(typeof reader.readAll).toBe('function');
    expect(typeof reader.supportsRangeRequests).toBe('function');
    expect(typeof reader.getRowGroupStats).toBe('function');

    // Example 2: Create from buffer
    const buffer = new ArrayBuffer(100);
    const bufferReader = ParquetReader.fromBuffer(buffer);
    expect(typeof bufferReader.readColumns).toBe('function');

    // Example 3: Create a ClickBench data source
    const dataSource = createClickBenchParquetSource({
      maxRowsPerQuery: 10000,
      cacheMetadata: true,
    });
    expect(typeof dataSource.getMetadata).toBe('function');
    expect(typeof dataSource.readColumns).toBe('function');
    expect(typeof dataSource.readData).toBe('function');
  });

  it('should show the expected data format', () => {
    // Document the expected result format
    const exampleResult = {
      data: [
        { CounterID: 123, UserID: 456 },
        { CounterID: 789, UserID: 101112 },
      ],
      meta: [
        { name: 'CounterID', type: 'Int32' },
        { name: 'UserID', type: 'Int64' },
      ],
      rows: 2,
      totalRows: 99997497, // Total rows in the file
      elapsedMs: 150.5,
    };

    expect(exampleResult.data).toBeInstanceOf(Array);
    expect(exampleResult.meta).toBeInstanceOf(Array);
    expect(typeof exampleResult.rows).toBe('number');
    expect(typeof exampleResult.totalRows).toBe('number');
    expect(typeof exampleResult.elapsedMs).toBe('number');
  });
});
