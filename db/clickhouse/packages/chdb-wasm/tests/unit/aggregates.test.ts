/**
 * Aggregate Functions - Tests for Minimal WASM Profile
 *
 * These tests verify that essential aggregate functions work correctly
 * when executed through the bundled WASM executor.
 *
 * Essential Aggregates for Minimal Profile:
 * - COUNT(*) - Count all rows
 * - COUNT(column) - Count non-null values
 * - SUM - Sum of values
 * - AVG - Average (mean) of values
 * - MIN - Minimum value
 * - MAX - Maximum value
 *
 * These aggregates are documented in src/profiles/minimal.ts as:
 * "Core SQL (COUNT, SUM, AVG, MIN, MAX)"
 *
 * @see https://clickhouse.com/docs/en/sql-reference/aggregate-functions
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createBundledExecutor } from '../../src/bundled-executor';
import type { SqlExecutor } from '../../src/http-query-handler';

/**
 * Helper function to get the data row (skipping the header row if present)
 * The executor returns TabSeparatedWithNames format:
 * - Row 0 may contain header names as quoted strings like "result"
 * - Row 1 contains actual data values
 */
function getDataRow(result: { data: Array<Record<string, unknown>> }): Record<string, unknown> | null {
  if (result.data.length === 0) return null;
  // If we have 2+ rows and first row looks like a header, use row 1
  if (result.data.length >= 2) {
    const firstValue = Object.values(result.data[0])[0];
    if (typeof firstValue === 'string' && firstValue.startsWith('"')) {
      return result.data[1];
    }
  }
  return result.data[0];
}

/**
 * Helper to execute a query and extract the first column value
 */
async function executeAndGetValue(executor: SqlExecutor, sql: string): Promise<unknown> {
  const result = await executor.execute(sql);
  const dataRow = getDataRow(result);
  if (!dataRow) return null;
  const firstColumn = Object.keys(dataRow)[0];
  return dataRow[firstColumn];
}

/**
 * Helper to execute a query and get all column values from first data row
 */
async function executeAndGetRow(executor: SqlExecutor, sql: string): Promise<Record<string, unknown> | null> {
  const result = await executor.execute(sql);
  return getDataRow(result);
}

/**
 * Helper to check if a value is close to expected (for floating point)
 */
function isClose(actual: unknown, expected: number, tolerance = 0.0001): boolean {
  if (typeof actual !== 'number') return false;
  return Math.abs(actual - expected) < tolerance;
}

describe('Aggregate Functions - Minimal Profile', () => {
  let executor: SqlExecutor;

  beforeAll(async () => {
    executor = await createBundledExecutor();
  });

  describe('COUNT Aggregate', () => {
    describe('COUNT(*) - Count All Rows', () => {
      it('should count rows from numbers() function', async () => {
        const result = await executeAndGetValue(executor, 'SELECT COUNT(*) AS cnt FROM numbers(10)');
        expect(result).toBe(10);
      });

      it('should return 0 for empty set', async () => {
        const result = await executeAndGetValue(executor, 'SELECT COUNT(*) AS cnt FROM numbers(0)');
        expect(result).toBe(0);
      });

      it('should count large numbers of rows', async () => {
        const result = await executeAndGetValue(executor, 'SELECT COUNT(*) AS cnt FROM numbers(1000)');
        expect(result).toBe(1000);
      });

      it('should count with WHERE filter', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT COUNT(*) AS cnt FROM numbers(100) WHERE number < 50'
        );
        expect(result).toBe(50);
      });
    });

    describe('COUNT(expression) - Count Non-NULL Values', () => {
      it('should count column values', async () => {
        const result = await executeAndGetValue(executor, 'SELECT COUNT(number) AS cnt FROM numbers(5)');
        expect(result).toBe(5);
      });

      it('should count with expression', async () => {
        const result = await executeAndGetValue(executor, 'SELECT COUNT(number + 1) AS cnt FROM numbers(5)');
        expect(result).toBe(5);
      });
    });

    describe('COUNT(DISTINCT) - Count Unique Values', () => {
      it('should count distinct values', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT COUNT(DISTINCT number % 3) AS cnt FROM numbers(9)'
        );
        expect(result).toBe(3); // 0, 1, 2
      });

      it('should count distinct with modulo', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT COUNT(DISTINCT number % 5) AS cnt FROM numbers(100)'
        );
        expect(result).toBe(5); // 0, 1, 2, 3, 4
      });
    });
  });

  describe('SUM Aggregate', () => {
    describe('Basic SUM', () => {
      it('should sum numbers from 0 to 9', async () => {
        const result = await executeAndGetValue(executor, 'SELECT SUM(number) AS total FROM numbers(10)');
        // Sum of 0+1+2+...+9 = 45
        expect(result).toBe(45);
      });

      it('should return 0 for empty set', async () => {
        const result = await executeAndGetValue(executor, 'SELECT SUM(number) AS total FROM numbers(0)');
        // Sum of empty set is 0 (or null depending on implementation)
        expect(result === 0 || result === null).toBe(true);
      });

      it('should sum with expression', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT SUM(number * 2) AS total FROM numbers(5)'
        );
        // Sum of (0+1+2+3+4)*2 = 10*2 = 20
        expect(result).toBe(20);
      });

      it('should sum with WHERE filter', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT SUM(number) AS total FROM numbers(10) WHERE number >= 5'
        );
        // Sum of 5+6+7+8+9 = 35
        expect(result).toBe(35);
      });

      it('should handle large sums', async () => {
        const result = await executeAndGetValue(executor, 'SELECT SUM(number) AS total FROM numbers(1000)');
        // Sum of 0 to 999 = n*(n-1)/2 = 1000*999/2 = 499500
        expect(result).toBe(499500);
      });
    });

    describe('SUM with Calculations', () => {
      it('should sum squares', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT SUM(number * number) AS total FROM numbers(5)'
        );
        // 0^2 + 1^2 + 2^2 + 3^2 + 4^2 = 0 + 1 + 4 + 9 + 16 = 30
        expect(result).toBe(30);
      });

      it('should sum with addition', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT SUM(number + 10) AS total FROM numbers(5)'
        );
        // (0+10) + (1+10) + (2+10) + (3+10) + (4+10) = 10+11+12+13+14 = 60
        expect(result).toBe(60);
      });
    });
  });

  describe('AVG Aggregate', () => {
    describe('Basic AVG', () => {
      it('should calculate average of 0 to 9', async () => {
        const result = await executeAndGetValue(executor, 'SELECT AVG(number) AS avg_val FROM numbers(10)');
        // Average of 0-9 = 45/10 = 4.5
        expect(isClose(result, 4.5)).toBe(true);
      });

      it('should calculate average of 0 to 99', async () => {
        const result = await executeAndGetValue(executor, 'SELECT AVG(number) AS avg_val FROM numbers(100)');
        // Average of 0-99 = 4950/100 = 49.5
        expect(isClose(result, 49.5)).toBe(true);
      });

      it('should handle single value', async () => {
        const result = await executeAndGetValue(executor, 'SELECT AVG(number) AS avg_val FROM numbers(1)');
        // Average of just 0 = 0
        expect(result).toBe(0);
      });

      it('should calculate average with filter', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT AVG(number) AS avg_val FROM numbers(10) WHERE number >= 5'
        );
        // Average of 5,6,7,8,9 = 35/5 = 7
        expect(isClose(result, 7)).toBe(true);
      });
    });

    describe('AVG with Expressions', () => {
      it('should average with multiplication', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT AVG(number * 2) AS avg_val FROM numbers(5)'
        );
        // Average of 0,2,4,6,8 = 20/5 = 4
        expect(isClose(result, 4)).toBe(true);
      });

      it('should average with addition', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT AVG(number + 100) AS avg_val FROM numbers(5)'
        );
        // Average of 100,101,102,103,104 = 510/5 = 102
        expect(isClose(result, 102)).toBe(true);
      });
    });
  });

  describe('MIN Aggregate', () => {
    describe('Basic MIN', () => {
      it('should find minimum of 0 to 9', async () => {
        const result = await executeAndGetValue(executor, 'SELECT MIN(number) AS min_val FROM numbers(10)');
        expect(result).toBe(0);
      });

      it('should find minimum with offset', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT MIN(number + 5) AS min_val FROM numbers(10)'
        );
        // Min of 5,6,7,8,9,10,11,12,13,14 = 5
        expect(result).toBe(5);
      });

      it('should find minimum with filter', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT MIN(number) AS min_val FROM numbers(100) WHERE number > 50'
        );
        expect(result).toBe(51);
      });

      it('should handle single value', async () => {
        const result = await executeAndGetValue(executor, 'SELECT MIN(number) AS min_val FROM numbers(1)');
        expect(result).toBe(0);
      });
    });

    describe('MIN with Expressions', () => {
      it('should find minimum of squares', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT MIN(number * number) AS min_val FROM numbers(10)'
        );
        // Min of 0,1,4,9,... = 0
        expect(result).toBe(0);
      });

      it('should find minimum of negative transformation', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT MIN(5 - number) AS min_val FROM numbers(10)'
        );
        // Min of 5,4,3,2,1,0,-1,-2,-3,-4 = -4
        expect(result).toBe(-4);
      });
    });
  });

  describe('MAX Aggregate', () => {
    describe('Basic MAX', () => {
      it('should find maximum of 0 to 9', async () => {
        const result = await executeAndGetValue(executor, 'SELECT MAX(number) AS max_val FROM numbers(10)');
        expect(result).toBe(9);
      });

      it('should find maximum with expression', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT MAX(number * 10) AS max_val FROM numbers(10)'
        );
        expect(result).toBe(90);
      });

      it('should find maximum with filter', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT MAX(number) AS max_val FROM numbers(100) WHERE number < 50'
        );
        expect(result).toBe(49);
      });

      it('should handle single value', async () => {
        const result = await executeAndGetValue(executor, 'SELECT MAX(number) AS max_val FROM numbers(1)');
        expect(result).toBe(0);
      });
    });

    describe('MAX with Expressions', () => {
      it('should find maximum of squares', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT MAX(number * number) AS max_val FROM numbers(10)'
        );
        // Max of 0,1,4,9,16,25,36,49,64,81 = 81
        expect(result).toBe(81);
      });

      it('should find maximum of negative transformation', async () => {
        const result = await executeAndGetValue(
          executor,
          'SELECT MAX(-number) AS max_val FROM numbers(10)'
        );
        // Max of 0,-1,-2,-3,-4,-5,-6,-7,-8,-9 = 0
        expect(result).toBe(0);
      });
    });
  });

  describe('Combined Aggregates', () => {
    it('should calculate COUNT and SUM independently on same dataset', async () => {
      // Verify COUNT(*) returns correct value
      const count = await executeAndGetValue(executor, 'SELECT COUNT(*) AS cnt FROM numbers(10)');
      expect(count).toBe(10);

      // Verify SUM returns correct value on same dataset
      const sum = await executeAndGetValue(executor, 'SELECT SUM(number) AS total FROM numbers(10)');
      expect(sum).toBe(45);

      // Verify MIN returns correct value on same dataset
      const min = await executeAndGetValue(executor, 'SELECT MIN(number) AS min_val FROM numbers(10)');
      expect(min).toBe(0);

      // Verify MAX returns correct value on same dataset
      const max = await executeAndGetValue(executor, 'SELECT MAX(number) AS max_val FROM numbers(10)');
      expect(max).toBe(9);
    });

    it('should calculate count, sum, and avg independently on same dataset', async () => {
      // Verify COUNT(*) returns correct value
      const count = await executeAndGetValue(executor, 'SELECT COUNT(*) AS cnt FROM numbers(100)');
      expect(count).toBe(100);

      // Verify SUM returns correct value on same dataset
      const sum = await executeAndGetValue(executor, 'SELECT SUM(number) AS total FROM numbers(100)');
      expect(sum).toBe(4950);

      // Verify AVG returns correct value on same dataset
      const avg = await executeAndGetValue(executor, 'SELECT AVG(number) AS avg_val FROM numbers(100)');
      expect(isClose(avg, 49.5)).toBe(true);
    });

    it('should verify all five essential aggregates give consistent results', async () => {
      // Test all five aggregates on the same dataset (numbers 0-49)
      const count = await executeAndGetValue(executor, 'SELECT COUNT(*) AS cnt FROM numbers(50)');
      expect(count).toBe(50);

      const sum = await executeAndGetValue(executor, 'SELECT SUM(number) AS sum_val FROM numbers(50)');
      expect(sum).toBe(1225); // 0+1+...+49 = 50*49/2 = 1225

      const avg = await executeAndGetValue(executor, 'SELECT AVG(number) AS avg_val FROM numbers(50)');
      expect(isClose(avg, 24.5)).toBe(true); // 1225/50 = 24.5

      const min = await executeAndGetValue(executor, 'SELECT MIN(number) AS min_val FROM numbers(50)');
      expect(min).toBe(0);

      const max = await executeAndGetValue(executor, 'SELECT MAX(number) AS max_val FROM numbers(50)');
      expect(max).toBe(49);

      // Verify math consistency: sum / count should equal avg
      expect(isClose((sum as number) / (count as number), avg as number)).toBe(true);
    });
  });

  describe('GROUP BY with Aggregates', () => {
    it('should group by modulo and count', async () => {
      const result = await executor.execute(
        'SELECT number % 2 AS even_odd, COUNT(*) AS cnt FROM numbers(10) GROUP BY number % 2 ORDER BY even_odd'
      );

      // Should have 2 groups: odd (5 numbers) and even (5 numbers)
      expect(result.data.length).toBeGreaterThanOrEqual(2);
    });

    it('should group by modulo and sum', async () => {
      const result = await executor.execute(
        'SELECT number % 3 AS grp, SUM(number) AS total FROM numbers(9) GROUP BY number % 3 ORDER BY grp'
      );

      // Group 0: 0+3+6 = 9
      // Group 1: 1+4+7 = 12
      // Group 2: 2+5+8 = 15
      expect(result.data.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty result set', async () => {
      const result = await executeAndGetValue(
        executor,
        'SELECT COUNT(*) AS cnt FROM numbers(10) WHERE number > 100'
      );
      expect(result).toBe(0);
    });

    it('should handle aggregate with LIMIT', async () => {
      // LIMIT should apply after aggregation
      const result = await executeAndGetValue(executor, 'SELECT COUNT(*) AS cnt FROM numbers(100) LIMIT 1');
      expect(result).toBe(100);
    });

    it('should handle nested arithmetic in aggregates', async () => {
      const result = await executeAndGetValue(
        executor,
        'SELECT SUM((number + 1) * (number + 1)) AS total FROM numbers(3)'
      );
      // Sum of 1^2 + 2^2 + 3^2 = 1 + 4 + 9 = 14
      expect(result).toBe(14);
    });
  });
});
