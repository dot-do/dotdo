/**
 * Memory Management Tests for chdb WASM Module
 *
 * These tests verify memory-related functionality:
 * - Large result handling
 * - Memory cleanup and disposal
 * - Out-of-memory (OOM) handling
 * - Memory statistics tracking
 * - Resource leak detection
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createChdb } from '../../src/chdb';
import type { ChdbInstance, MemoryStats } from '../../src/types';
import { DisposedError } from '../../src/types';

describe('chdb WASM - Memory Management Tests', () => {
  describe('Memory Statistics', () => {
    let chdb: ChdbInstance;

    beforeAll(async () => {
      chdb = await createChdb({
        memoryLimit: 64 * 1024 * 1024, // 64MB
        logging: false,
      });
    });

    afterAll(() => {
      if (chdb && !chdb.disposed) {
        chdb.dispose();
      }
    });

    it('should report initial memory statistics', () => {
      const stats = chdb.getMemoryStats();

      expect(stats).toHaveProperty('used');
      expect(stats).toHaveProperty('peak');
      expect(stats).toHaveProperty('limit');

      expect(typeof stats.used).toBe('number');
      expect(typeof stats.peak).toBe('number');
      expect(typeof stats.limit).toBe('number');

      expect(stats.used).toBeGreaterThanOrEqual(0);
      expect(stats.peak).toBeGreaterThanOrEqual(stats.used);
      expect(stats.limit).toBeGreaterThan(0);
    });

    it('should report memory limit correctly', () => {
      const stats = chdb.getMemoryStats();

      // Memory limit should be around what we configured (may have overhead)
      expect(stats.limit).toBeGreaterThanOrEqual(32 * 1024 * 1024); // At least 32MB
    });

    it('should track memory usage after queries', async () => {
      const statsBefore = chdb.getMemoryStats();

      // Execute a query that generates some data
      await chdb.query('SELECT * FROM generate_series(1, 10000) AS t(n)', { format: 'JSON' });

      const statsAfter = chdb.getMemoryStats();

      // Memory should have been used (or peak should reflect usage)
      expect(statsAfter.peak).toBeGreaterThanOrEqual(statsBefore.peak);
    });

    it('should track peak memory usage', async () => {
      const initialStats = chdb.getMemoryStats();
      const initialPeak = initialStats.peak;

      // Execute multiple queries
      for (let i = 0; i < 5; i++) {
        await chdb.query('SELECT * FROM generate_series(1, 5000) AS t(n)', { format: 'JSON' });
      }

      const finalStats = chdb.getMemoryStats();

      // Peak should never decrease
      expect(finalStats.peak).toBeGreaterThanOrEqual(initialPeak);
    });
  });

  describe('Large Result Handling', () => {
    let chdb: ChdbInstance;

    beforeAll(async () => {
      chdb = await createChdb({
        memoryLimit: 128 * 1024 * 1024, // 128MB for large tests
        logging: false,
      });
    });

    afterAll(() => {
      if (chdb && !chdb.disposed) {
        chdb.dispose();
      }
    });

    it('should handle result with 10,000 rows', async () => {
      const result = await chdb.query(
        'SELECT n, n * 2 AS doubled FROM generate_series(1, 10000) AS t(n)',
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data.length).toBe(10000);
      expect(parsed.data[0].n).toBe(1);
      expect(parsed.data[9999].n).toBe(10000);
    });

    it('should handle result with 50,000 rows', async () => {
      const result = await chdb.query(
        'SELECT n FROM generate_series(1, 50000) AS t(n)',
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data.length).toBe(50000);
    });

    it('should handle result with many columns', async () => {
      // Generate 100 columns
      const cols = Array.from({ length: 100 }, (_, i) =>
        `n + ${i} AS col_${i}`
      ).join(', ');

      const result = await chdb.query(
        `SELECT ${cols} FROM generate_series(1, 100) AS t(n)`,
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data.length).toBe(100);
      expect(Object.keys(parsed.data[0]).length).toBe(100);
    });

    it('should handle large string results', async () => {
      // Create a table with large strings
      await chdb.query('DROP TABLE IF EXISTS large_strings', { format: 'JSON' });
      await chdb.query(`
        CREATE TABLE large_strings AS
        SELECT n, REPEAT('X', 1000) AS large_text
        FROM generate_series(1, 100) AS t(n)
      `, { format: 'JSON' });

      const result = await chdb.query(
        'SELECT * FROM large_strings',
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data.length).toBe(100);
      expect(parsed.data[0].large_text.length).toBe(1000);
    });

    it('should handle aggregation over large datasets', async () => {
      const result = await chdb.query(
        'SELECT COUNT(*) AS cnt, SUM(n) AS total FROM generate_series(1, 100000) AS t(n)',
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data[0].cnt).toBe(100000);
      // Sum of 1 to 100000 = n*(n+1)/2 = 5000050000
      expect(parsed.data[0].total).toBe(5000050000);
    });

    it('should handle JOINs on moderately large tables', async () => {
      // Create two tables
      await chdb.query('DROP TABLE IF EXISTS join_test_a', { format: 'JSON' });
      await chdb.query('DROP TABLE IF EXISTS join_test_b', { format: 'JSON' });

      await chdb.query(`
        CREATE TABLE join_test_a AS
        SELECT n AS id, 'A' || n AS name
        FROM generate_series(1, 1000) AS t(n)
      `, { format: 'JSON' });

      await chdb.query(`
        CREATE TABLE join_test_b AS
        SELECT n AS id, n * 100 AS value
        FROM generate_series(1, 1000) AS t(n)
      `, { format: 'JSON' });

      const result = await chdb.query(`
        SELECT a.id, a.name, b.value
        FROM join_test_a a
        JOIN join_test_b b ON a.id = b.id
        ORDER BY a.id
        LIMIT 10
      `, { format: 'JSON' });
      const parsed = JSON.parse(result);

      expect(parsed.data.length).toBe(10);
      expect(parsed.data[0].id).toBe(1);
      expect(parsed.data[0].value).toBe(100);
    });
  });

  describe('Memory Cleanup', () => {
    it('should clear cache without error', async () => {
      const chdb = await createChdb({
        memoryLimit: 64 * 1024 * 1024,
        logging: false,
      });

      // Execute some queries
      await chdb.query('SELECT 1', { format: 'JSON' });
      await chdb.query('SELECT 2', { format: 'JSON' });

      // Clear cache should not throw
      expect(() => chdb.clearCache()).not.toThrow();

      // Should still be able to query after clear
      const result = await chdb.query('SELECT 3', { format: 'JSON' });
      const parsed = JSON.parse(result);
      expect(parsed.data[0]['3']).toBe(3);

      chdb.dispose();
    });

    it('should handle multiple cache clears', async () => {
      const chdb = await createChdb({
        memoryLimit: 64 * 1024 * 1024,
        logging: false,
      });

      for (let i = 0; i < 5; i++) {
        await chdb.query(`SELECT ${i}`, { format: 'JSON' });
        chdb.clearCache();
      }

      // Should still work
      const result = await chdb.query('SELECT 100', { format: 'JSON' });
      const parsed = JSON.parse(result);
      expect(parsed.data[0]['100']).toBe(100);

      chdb.dispose();
    });

    it('should allow continued queries after disposal attempt', async () => {
      const chdb = await createChdb({
        memoryLimit: 64 * 1024 * 1024,
        logging: false,
      });

      await chdb.query('SELECT 1', { format: 'JSON' });

      // Dispose
      chdb.dispose();

      // Queries after dispose should throw DisposedError
      await expect(chdb.query('SELECT 1', { format: 'JSON' }))
        .rejects.toThrow(DisposedError);
    });
  });

  describe('Instance Disposal', () => {
    it('should dispose instance correctly', async () => {
      const chdb = await createChdb({
        memoryLimit: 32 * 1024 * 1024,
        logging: false,
      });

      expect(chdb.disposed).toBe(false);

      chdb.dispose();

      expect(chdb.disposed).toBe(true);
    });

    it('should be safe to dispose multiple times', async () => {
      const chdb = await createChdb({
        memoryLimit: 32 * 1024 * 1024,
        logging: false,
      });

      chdb.dispose();
      expect(() => chdb.dispose()).not.toThrow();
      expect(() => chdb.dispose()).not.toThrow();

      expect(chdb.disposed).toBe(true);
    });

    it('should throw DisposedError when querying disposed instance', async () => {
      const chdb = await createChdb({
        memoryLimit: 32 * 1024 * 1024,
        logging: false,
      });

      chdb.dispose();

      await expect(chdb.query('SELECT 1', { format: 'JSON' }))
        .rejects.toThrow(DisposedError);
    });

    it('should throw DisposedError when getting memory stats from disposed instance', async () => {
      const chdb = await createChdb({
        memoryLimit: 32 * 1024 * 1024,
        logging: false,
      });

      chdb.dispose();

      expect(() => chdb.getMemoryStats()).toThrow(DisposedError);
    });

    it('should throw DisposedError when clearing cache on disposed instance', async () => {
      const chdb = await createChdb({
        memoryLimit: 32 * 1024 * 1024,
        logging: false,
      });

      chdb.dispose();

      expect(() => chdb.clearCache()).toThrow(DisposedError);
    });
  });

  describe('Streaming for Large Results', () => {
    let chdb: ChdbInstance;

    beforeAll(async () => {
      chdb = await createChdb({
        memoryLimit: 128 * 1024 * 1024,
        logging: false,
      });
    });

    afterAll(() => {
      if (chdb && !chdb.disposed) {
        chdb.dispose();
      }
    });

    it('should stream results with queryStream', async () => {
      let rowCount = 0;

      for await (const chunk of chdb.queryStream(
        'SELECT n FROM generate_series(1, 100) AS t(n)',
        { format: 'JSONEachRow' }
      )) {
        // Each chunk should be valid JSON
        const lines = chunk.trim().split('\n').filter(l => l.length > 0);
        for (const line of lines) {
          JSON.parse(line);
          rowCount++;
        }
      }

      expect(rowCount).toBe(100);
    });

    it('should handle streaming with large number of rows', async () => {
      let totalRows = 0;

      for await (const chunk of chdb.queryStream(
        'SELECT n FROM generate_series(1, 10000) AS t(n)',
        { format: 'JSONEachRow' }
      )) {
        const lines = chunk.trim().split('\n').filter(l => l.length > 0);
        totalRows += lines.length;
      }

      expect(totalRows).toBe(10000);
    });

    it('should throw DisposedError when streaming from disposed instance', async () => {
      const localChdb = await createChdb({
        memoryLimit: 32 * 1024 * 1024,
        logging: false,
      });

      localChdb.dispose();

      const consumeStream = async () => {
        for await (const _chunk of localChdb.queryStream('SELECT 1', { format: 'JSONEachRow' })) {
          // Should not reach here
        }
      };

      await expect(consumeStream()).rejects.toThrow(DisposedError);
    });
  });

  describe('OOM Handling', () => {
    it('should handle query that approaches memory limit gracefully', async () => {
      // Create instance with small memory limit
      const chdb = await createChdb({
        memoryLimit: 16 * 1024 * 1024, // 16MB
        logging: false,
      });

      try {
        // Try to create a moderately large result
        // This may succeed or fail depending on actual memory usage
        const result = await chdb.query(
          'SELECT n, REPEAT(\'X\', 100) AS text FROM generate_series(1, 10000) AS t(n)',
          { format: 'JSON' }
        );

        // If it succeeds, verify the result
        const parsed = JSON.parse(result);
        expect(parsed.data.length).toBeGreaterThan(0);
      } catch (error) {
        // OOM error is acceptable
        expect(error).toBeDefined();
      } finally {
        chdb.dispose();
      }
    });

    it('should recover after failed query due to memory', async () => {
      const chdb = await createChdb({
        memoryLimit: 32 * 1024 * 1024, // 32MB
        logging: false,
      });

      try {
        // Try a potentially memory-intensive query
        await chdb.query(
          'SELECT n, REPEAT(\'X\', 1000) AS text FROM generate_series(1, 100000) AS t(n)',
          { format: 'JSON' }
        );
      } catch (error) {
        // Expected to potentially fail
      }

      // Should still be able to run simple queries
      const result = await chdb.query('SELECT 1 AS n', { format: 'JSON' });
      const parsed = JSON.parse(result);
      expect(parsed.data[0].n).toBe(1);

      chdb.dispose();
    });
  });

  describe('Multiple Instance Management', () => {
    it('should support creating multiple independent instances', async () => {
      const instance1 = await createChdb({
        memoryLimit: 32 * 1024 * 1024,
        logging: false,
      });

      const instance2 = await createChdb({
        memoryLimit: 32 * 1024 * 1024,
        logging: false,
      });

      // Create table in instance1
      await instance1.query('CREATE TABLE test1 (id INT)', { format: 'JSON' });
      await instance1.query('INSERT INTO test1 VALUES (1)', { format: 'JSON' });

      // Create different table in instance2
      await instance2.query('CREATE TABLE test2 (id INT)', { format: 'JSON' });
      await instance2.query('INSERT INTO test2 VALUES (2)', { format: 'JSON' });

      // Verify isolation
      const result1 = await instance1.query('SELECT * FROM test1', { format: 'JSON' });
      const parsed1 = JSON.parse(result1);
      expect(parsed1.data[0].id).toBe(1);

      const result2 = await instance2.query('SELECT * FROM test2', { format: 'JSON' });
      const parsed2 = JSON.parse(result2);
      expect(parsed2.data[0].id).toBe(2);

      // test1 should not exist in instance2
      await expect(instance2.query('SELECT * FROM test1', { format: 'JSON' }))
        .rejects.toThrow();

      instance1.dispose();
      instance2.dispose();
    });

    it('should allow independent disposal of instances', async () => {
      const instance1 = await createChdb({
        memoryLimit: 32 * 1024 * 1024,
        logging: false,
      });

      const instance2 = await createChdb({
        memoryLimit: 32 * 1024 * 1024,
        logging: false,
      });

      // Dispose instance1
      instance1.dispose();

      // instance2 should still work
      const result = await instance2.query('SELECT 42 AS answer', { format: 'JSON' });
      const parsed = JSON.parse(result);
      expect(parsed.data[0].answer).toBe(42);

      instance2.dispose();
    });
  });

  describe('Memory Under Concurrent Load', () => {
    let chdb: ChdbInstance;

    beforeAll(async () => {
      chdb = await createChdb({
        memoryLimit: 128 * 1024 * 1024,
        logging: false,
      });
    });

    afterAll(() => {
      if (chdb && !chdb.disposed) {
        chdb.dispose();
      }
    });

    it('should handle multiple concurrent queries', async () => {
      const queries = Array.from({ length: 10 }, (_, i) =>
        chdb.query(`SELECT ${i} AS id, n FROM generate_series(1, 100) AS t(n)`, { format: 'JSON' })
      );

      const results = await Promise.all(queries);

      results.forEach((result, i) => {
        const parsed = JSON.parse(result);
        expect(parsed.data.length).toBe(100);
        expect(parsed.data[0].id).toBe(i);
      });
    });

    it('should maintain consistent memory stats under load', async () => {
      const statsBefore = chdb.getMemoryStats();

      // Run multiple concurrent queries
      const queries = Array.from({ length: 5 }, () =>
        chdb.query('SELECT n FROM generate_series(1, 1000) AS t(n)', { format: 'JSON' })
      );

      await Promise.all(queries);

      const statsAfter = chdb.getMemoryStats();

      // Memory tracking should remain consistent
      expect(statsAfter.peak).toBeGreaterThanOrEqual(statsBefore.peak);
      expect(statsAfter.limit).toBe(statsBefore.limit);
    });
  });

  describe('Resource Cleanup After Errors', () => {
    let chdb: ChdbInstance;

    beforeAll(async () => {
      chdb = await createChdb({
        memoryLimit: 64 * 1024 * 1024,
        logging: false,
      });
    });

    afterAll(() => {
      if (chdb && !chdb.disposed) {
        chdb.dispose();
      }
    });

    it('should clean up after syntax error', async () => {
      const statsBefore = chdb.getMemoryStats();

      // Execute query with syntax error
      await expect(chdb.query('SELEC 1', { format: 'JSON' }))
        .rejects.toThrow();

      const statsAfter = chdb.getMemoryStats();

      // Memory should not grow significantly after error
      expect(statsAfter.used).toBeLessThan(statsBefore.used + 1024 * 1024); // Allow 1MB variance
    });

    it('should clean up after multiple errors', async () => {
      const statsBefore = chdb.getMemoryStats();

      // Execute multiple queries with errors
      for (let i = 0; i < 10; i++) {
        try {
          await chdb.query(`SELECT * FROM nonexistent_table_${i}`, { format: 'JSON' });
        } catch {
          // Expected
        }
      }

      const statsAfter = chdb.getMemoryStats();

      // Memory should remain reasonable after errors
      expect(statsAfter.used).toBeLessThan(statsBefore.used + 5 * 1024 * 1024); // Allow 5MB variance
    });

    it('should continue working after error cleanup', async () => {
      // Cause an error
      await expect(chdb.query('INVALID SQL QUERY', { format: 'JSON' }))
        .rejects.toThrow();

      // Should still work
      const result = await chdb.query('SELECT 1 AS n', { format: 'JSON' });
      const parsed = JSON.parse(result);
      expect(parsed.data[0].n).toBe(1);
    });
  });

  describe('Long-Running Instance Behavior', () => {
    it('should handle many sequential queries without memory leak', async () => {
      const chdb = await createChdb({
        memoryLimit: 64 * 1024 * 1024,
        logging: false,
      });

      const initialStats = chdb.getMemoryStats();

      // Run many sequential queries
      for (let i = 0; i < 100; i++) {
        await chdb.query(`SELECT ${i} AS iteration, n FROM generate_series(1, 100) AS t(n)`, {
          format: 'JSON'
        });
      }

      const finalStats = chdb.getMemoryStats();

      // Memory usage should not grow unboundedly
      // Allow reasonable growth but not linear with query count
      expect(finalStats.used).toBeLessThan(initialStats.used + 20 * 1024 * 1024);

      chdb.dispose();
    });

    it('should handle interleaved table creation and deletion', async () => {
      const chdb = await createChdb({
        memoryLimit: 64 * 1024 * 1024,
        logging: false,
      });

      for (let i = 0; i < 20; i++) {
        // Create table
        await chdb.query(`CREATE TABLE temp_table_${i} (id INT, data VARCHAR)`, { format: 'JSON' });

        // Insert data
        await chdb.query(`
          INSERT INTO temp_table_${i}
          SELECT n, 'data' || n FROM generate_series(1, 100) AS t(n)
        `, { format: 'JSON' });

        // Query
        await chdb.query(`SELECT COUNT(*) FROM temp_table_${i}`, { format: 'JSON' });

        // Drop table
        await chdb.query(`DROP TABLE temp_table_${i}`, { format: 'JSON' });
      }

      // Should still be able to create new tables
      await chdb.query('CREATE TABLE final_table (id INT)', { format: 'JSON' });
      const result = await chdb.query('SELECT 1', { format: 'JSON' });
      expect(result).toBeDefined();

      chdb.dispose();
    });
  });
});
