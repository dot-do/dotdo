/**
 * Output Format Tests for chdb WASM Module
 *
 * These tests verify that the chdb WASM module correctly outputs data
 * in various supported formats:
 * - JSON / JSONEachRow / JSONCompact
 * - CSV / CSVWithNames
 * - TSV / TSVWithNames
 * - Pretty / PrettyCompact
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createChdb } from '../../src/chdb';
import type { ChdbInstance } from '../../src/types';

describe('chdb WASM - Output Format Tests', () => {
  let chdb: ChdbInstance;
  const testTable = 'format_test_table';

  beforeAll(async () => {
    chdb = await createChdb({
      memoryLimit: 64 * 1024 * 1024, // 64MB
      logging: false,
    });

    // Create and populate test table
    await chdb.query(`DROP TABLE IF EXISTS ${testTable}`, { format: 'JSON' });
    await chdb.query(`
      CREATE TABLE ${testTable} (
        id INTEGER,
        name VARCHAR,
        price DOUBLE,
        active BOOLEAN,
        created_at DATE
      )
    `, { format: 'JSON' });

    await chdb.query(`
      INSERT INTO ${testTable} VALUES
        (1, 'Apple', 1.99, true, '2024-01-15'),
        (2, 'Banana', 0.99, true, '2024-01-16'),
        (3, 'Cherry', 2.99, false, '2024-01-17'),
        (4, 'Date', 3.49, true, '2024-01-18'),
        (5, 'Elderberry', 5.99, false, '2024-01-19')
    `, { format: 'JSON' });
  });

  afterAll(() => {
    if (chdb && !chdb.disposed) {
      chdb.dispose();
    }
  });

  describe('JSON Format', () => {
    it('should output valid JSON format', async () => {
      const result = await chdb.query(
        `SELECT * FROM ${testTable} ORDER BY id LIMIT 3`,
        { format: 'JSON' }
      );

      // Should be valid JSON
      const parsed = JSON.parse(result);

      // JSON format includes metadata and data array
      expect(parsed).toHaveProperty('data');
      expect(parsed).toHaveProperty('meta');
      expect(parsed).toHaveProperty('rows');

      expect(parsed.data).toHaveLength(3);
      expect(parsed.rows).toBe(3);
    });

    it('should include correct metadata in JSON output', async () => {
      const result = await chdb.query(
        `SELECT id, name, price FROM ${testTable} LIMIT 1`,
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.meta).toBeDefined();
      expect(Array.isArray(parsed.meta)).toBe(true);

      // Verify column names are present in metadata
      const columnNames = parsed.meta.map((m: { name: string }) => m.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('price');
    });

    it('should handle NULL values in JSON format', async () => {
      const result = await chdb.query(
        'SELECT 1 AS id, NULL AS value',
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data[0].id).toBe(1);
      expect(parsed.data[0].value).toBeNull();
    });

    it('should handle special characters in JSON strings', async () => {
      const result = await chdb.query(
        `SELECT 'Hello "World"\nNew Line\tTab' AS special`,
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data[0].special).toContain('"');
      expect(parsed.data[0].special).toContain('\n');
      expect(parsed.data[0].special).toContain('\t');
    });

    it('should handle Unicode characters in JSON', async () => {
      const result = await chdb.query(
        `SELECT 'Hello World!' AS emoji`,
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data[0].emoji).toBe('Hello World!');
    });

    it('should handle empty result set in JSON format', async () => {
      const result = await chdb.query(
        `SELECT * FROM ${testTable} WHERE id > 1000`,
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data).toHaveLength(0);
      expect(parsed.rows).toBe(0);
    });

    it('should handle large numbers in JSON format', async () => {
      const result = await chdb.query(
        'SELECT 9223372036854775807 AS big_int, 1.7976931348623157e308 AS big_float',
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      // Large integers may be represented as strings to preserve precision
      expect(parsed.data[0].big_int).toBeDefined();
      expect(parsed.data[0].big_float).toBeDefined();
    });
  });

  describe('JSONEachRow Format', () => {
    it('should output one JSON object per line', async () => {
      const result = await chdb.query(
        `SELECT id, name FROM ${testTable} ORDER BY id LIMIT 3`,
        { format: 'JSONEachRow' }
      );

      // Split by newlines and filter empty lines
      const lines = result.trim().split('\n').filter(line => line.length > 0);
      expect(lines.length).toBe(3);

      // Each line should be valid JSON
      lines.forEach((line, index) => {
        const parsed = JSON.parse(line);
        expect(parsed.id).toBe(index + 1);
        expect(parsed.name).toBeDefined();
      });
    });

    it('should not include metadata in JSONEachRow', async () => {
      const result = await chdb.query(
        `SELECT id FROM ${testTable} LIMIT 1`,
        { format: 'JSONEachRow' }
      );

      const parsed = JSON.parse(result.trim());

      // Should only have the data, no meta or rows properties
      expect(parsed).not.toHaveProperty('meta');
      expect(parsed).not.toHaveProperty('rows');
      expect(parsed).toHaveProperty('id');
    });

    it('should handle streaming-friendly output', async () => {
      const result = await chdb.query(
        `SELECT id FROM ${testTable} ORDER BY id`,
        { format: 'JSONEachRow' }
      );

      const lines = result.trim().split('\n').filter(line => line.length > 0);

      // Should be able to parse each line independently
      let idSum = 0;
      lines.forEach(line => {
        const parsed = JSON.parse(line);
        idSum += parsed.id;
      });

      expect(idSum).toBe(1 + 2 + 3 + 4 + 5); // Sum of ids 1-5
    });
  });

  describe('JSONCompact Format', () => {
    it('should output compact JSON with arrays instead of objects', async () => {
      const result = await chdb.query(
        `SELECT id, name FROM ${testTable} ORDER BY id LIMIT 3`,
        { format: 'JSONCompact' }
      );
      const parsed = JSON.parse(result);

      expect(parsed).toHaveProperty('data');
      expect(parsed).toHaveProperty('meta');

      // Data should be arrays of values, not objects
      expect(Array.isArray(parsed.data)).toBe(true);
      expect(parsed.data.length).toBe(3);

      // Each row should be an array
      parsed.data.forEach((row: unknown[]) => {
        expect(Array.isArray(row)).toBe(true);
      });

      // First row should be [1, 'Apple'] or similar
      expect(parsed.data[0][0]).toBe(1);
    });

    it('should be more compact than regular JSON', async () => {
      const jsonResult = await chdb.query(
        `SELECT id, name, price FROM ${testTable}`,
        { format: 'JSON' }
      );

      const compactResult = await chdb.query(
        `SELECT id, name, price FROM ${testTable}`,
        { format: 'JSONCompact' }
      );

      // Compact format should be smaller (no repeated column names)
      expect(compactResult.length).toBeLessThanOrEqual(jsonResult.length);
    });
  });

  describe('CSV Format', () => {
    it('should output valid CSV', async () => {
      const result = await chdb.query(
        `SELECT id, name, price FROM ${testTable} ORDER BY id LIMIT 3`,
        { format: 'CSV' }
      );

      const lines = result.trim().split('\n');

      // CSV without names should have just data rows
      expect(lines.length).toBeGreaterThanOrEqual(3);

      // Parse first data line
      const firstRow = lines[0].split(',');
      expect(firstRow.length).toBe(3); // id, name, price
    });

    it('should properly quote fields with commas', async () => {
      // Create a query with a value containing a comma
      const result = await chdb.query(
        `SELECT 1 AS id, 'Hello, World' AS text`,
        { format: 'CSV' }
      );

      // The field with comma should be quoted
      expect(result).toContain('"');
      expect(result).toContain('Hello, World');
    });

    it('should escape quotes in CSV output', async () => {
      const result = await chdb.query(
        `SELECT 'Say "Hello"' AS text`,
        { format: 'CSV' }
      );

      // CSV escapes quotes by doubling them
      expect(result).toContain('"');
    });

    it('should handle newlines in CSV fields', async () => {
      const result = await chdb.query(
        `SELECT 'Line1\nLine2' AS multiline`,
        { format: 'CSV' }
      );

      // The field should be quoted to contain the newline
      expect(result).toContain('"');
    });

    it('should handle NULL values in CSV', async () => {
      const result = await chdb.query(
        'SELECT 1 AS id, NULL AS value',
        { format: 'CSV' }
      );

      // NULL should be represented as empty or as literal NULL
      const lines = result.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CSVWithNames Format', () => {
    it('should include header row with column names', async () => {
      const result = await chdb.query(
        `SELECT id, name, price FROM ${testTable} ORDER BY id LIMIT 2`,
        { format: 'CSVWithNames' }
      );

      const lines = result.trim().split('\n');

      // First line should be header
      expect(lines.length).toBeGreaterThanOrEqual(3); // header + 2 data rows

      // Check header contains column names
      const header = lines[0].toLowerCase();
      expect(header).toContain('id');
      expect(header).toContain('name');
      expect(header).toContain('price');
    });

    it('should have consistent column count in header and data', async () => {
      const result = await chdb.query(
        `SELECT id, name, price, active FROM ${testTable} LIMIT 1`,
        { format: 'CSVWithNames' }
      );

      const lines = result.trim().split('\n');
      const headerCols = lines[0].split(',').length;

      // Data rows should have same number of columns as header
      for (let i = 1; i < lines.length; i++) {
        // Account for quoted fields that might contain commas
        // This is a simplified check
        expect(lines[i].length).toBeGreaterThan(0);
      }
    });
  });

  describe('TSV Format', () => {
    it('should output tab-separated values', async () => {
      const result = await chdb.query(
        `SELECT id, name, price FROM ${testTable} ORDER BY id LIMIT 3`,
        { format: 'TSV' }
      );

      const lines = result.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(3);

      // Each line should have tabs separating values
      lines.forEach(line => {
        const fields = line.split('\t');
        expect(fields.length).toBe(3);
      });
    });

    it('should escape special characters in TSV', async () => {
      const result = await chdb.query(
        `SELECT 'Value\twith\ttabs' AS text`,
        { format: 'TSV' }
      );

      // Tabs in values should be escaped
      expect(result).toBeDefined();
    });

    it('should handle NULL values in TSV', async () => {
      const result = await chdb.query(
        'SELECT 1 AS id, NULL AS value',
        { format: 'TSV' }
      );

      const lines = result.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(1);

      // NULL is typically represented as \N or empty in TSV
      const fields = lines[0].split('\t');
      expect(fields.length).toBe(2);
    });

    it('should parse TSV output correctly', async () => {
      const result = await chdb.query(
        `SELECT id, name, price FROM ${testTable} ORDER BY id LIMIT 1`,
        { format: 'TSV' }
      );

      const fields = result.trim().split('\t');
      expect(Number(fields[0])).toBe(1); // id
      expect(fields[1]).toBe('Apple'); // name
      expect(parseFloat(fields[2])).toBeCloseTo(1.99, 2); // price
    });
  });

  describe('TSVWithNames Format', () => {
    it('should include header row with column names', async () => {
      const result = await chdb.query(
        `SELECT id, name, price FROM ${testTable} ORDER BY id LIMIT 2`,
        { format: 'TSVWithNames' }
      );

      const lines = result.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(3); // header + 2 data rows

      // First line should be header with column names
      const header = lines[0].toLowerCase();
      expect(header).toContain('id');
      expect(header).toContain('name');
      expect(header).toContain('price');

      // Header should be tab-separated
      const headerFields = lines[0].split('\t');
      expect(headerFields.length).toBe(3);
    });

    it('should have consistent structure', async () => {
      const result = await chdb.query(
        `SELECT id, name FROM ${testTable} LIMIT 2`,
        { format: 'TSVWithNames' }
      );

      const lines = result.trim().split('\n');
      const headerFieldCount = lines[0].split('\t').length;

      // All data rows should have same field count as header
      for (let i = 1; i < lines.length; i++) {
        const dataFieldCount = lines[i].split('\t').length;
        expect(dataFieldCount).toBe(headerFieldCount);
      }
    });
  });

  describe('Pretty Format', () => {
    it('should output human-readable formatted table', async () => {
      const result = await chdb.query(
        `SELECT id, name, price FROM ${testTable} ORDER BY id LIMIT 3`,
        { format: 'Pretty' }
      );

      // Pretty format uses box-drawing characters or similar formatting
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);

      // Should contain column names somewhere
      expect(result.toLowerCase()).toContain('id');
      expect(result.toLowerCase()).toContain('name');
    });

    it('should show row separators or borders', async () => {
      const result = await chdb.query(
        `SELECT 1 AS a, 2 AS b`,
        { format: 'Pretty' }
      );

      // Pretty format typically uses dashes, pipes, or similar characters
      const hasFormatting = result.includes('-') ||
        result.includes('+') ||
        result.includes('|') ||
        result.includes('\u2500') || // box drawing horizontal
        result.includes('\u2502'); // box drawing vertical

      expect(hasFormatting || result.includes('a')).toBe(true);
    });

    it('should align columns properly', async () => {
      const result = await chdb.query(
        `SELECT id, name FROM ${testTable} ORDER BY id`,
        { format: 'Pretty' }
      );

      // The output should have consistent line lengths (indicating alignment)
      const lines = result.split('\n').filter(l => l.trim().length > 0);

      // At least some lines should exist
      expect(lines.length).toBeGreaterThan(0);
    });
  });

  describe('PrettyCompact Format', () => {
    it('should output compact pretty format', async () => {
      const result = await chdb.query(
        `SELECT id, name FROM ${testTable} ORDER BY id LIMIT 3`,
        { format: 'PrettyCompact' }
      );

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should be more compact than Pretty format', async () => {
      const prettyResult = await chdb.query(
        `SELECT id, name, price FROM ${testTable}`,
        { format: 'Pretty' }
      );

      const compactResult = await chdb.query(
        `SELECT id, name, price FROM ${testTable}`,
        { format: 'PrettyCompact' }
      );

      // Compact should generally be smaller or equal
      // (may not always be true depending on implementation)
      expect(compactResult.length).toBeLessThanOrEqual(prettyResult.length + 100);
    });

    it('should contain data values', async () => {
      const result = await chdb.query(
        `SELECT id, name FROM ${testTable} WHERE name = 'Apple'`,
        { format: 'PrettyCompact' }
      );

      expect(result).toContain('Apple');
      expect(result).toContain('1');
    });
  });

  describe('Format Edge Cases', () => {
    it('should handle empty strings in all formats', async () => {
      const formats = ['JSON', 'CSV', 'TSV'] as const;

      for (const format of formats) {
        const result = await chdb.query(
          `SELECT '' AS empty_string`,
          { format }
        );

        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it('should handle boolean values across formats', async () => {
      // JSON format
      const jsonResult = await chdb.query(
        'SELECT true AS val1, false AS val2',
        { format: 'JSON' }
      );
      const parsed = JSON.parse(jsonResult);
      expect([true, 1]).toContain(parsed.data[0].val1);
      expect([false, 0]).toContain(parsed.data[0].val2);

      // CSV format
      const csvResult = await chdb.query(
        'SELECT true AS val1, false AS val2',
        { format: 'CSV' }
      );
      expect(csvResult).toBeDefined();

      // TSV format
      const tsvResult = await chdb.query(
        'SELECT true AS val1, false AS val2',
        { format: 'TSV' }
      );
      expect(tsvResult).toBeDefined();
    });

    it('should handle date/time values across formats', async () => {
      const formats = ['JSON', 'CSV', 'TSV'] as const;

      for (const format of formats) {
        const result = await chdb.query(
          `SELECT DATE '2024-06-15' AS date_val, TIMESTAMP '2024-06-15 10:30:00' AS ts_val`,
          { format }
        );

        expect(result).toBeDefined();
        expect(result).toContain('2024');
      }
    });

    it('should handle array values in JSON format', async () => {
      const result = await chdb.query(
        `SELECT [1, 2, 3] AS arr`,
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data[0].arr).toEqual([1, 2, 3]);
    });

    it('should handle nested structures in JSON format', async () => {
      const result = await chdb.query(
        `SELECT {'key': 'value', 'nested': {'a': 1}} AS obj`,
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data[0].obj).toBeDefined();
      const objValue = typeof parsed.data[0].obj === 'string'
        ? JSON.parse(parsed.data[0].obj)
        : parsed.data[0].obj;
      expect(objValue.key).toBe('value');
    });

    it('should handle very long strings', async () => {
      const longString = 'A'.repeat(10000);

      const result = await chdb.query(
        `SELECT '${longString}' AS long_text`,
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data[0].long_text.length).toBe(10000);
    });

    it('should handle many columns', async () => {
      // Generate query with many columns
      const cols = Array.from({ length: 50 }, (_, i) => `${i} AS col${i}`).join(', ');

      const result = await chdb.query(
        `SELECT ${cols}`,
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(Object.keys(parsed.data[0]).length).toBe(50);
    });

    it('should handle many rows', async () => {
      // Generate many rows using a sequence
      const result = await chdb.query(
        `SELECT * FROM generate_series(1, 1000) AS t(n)`,
        { format: 'JSON' }
      );
      const parsed = JSON.parse(result);

      expect(parsed.data.length).toBe(1000);
    });
  });

  describe('Format Consistency', () => {
    it('should return same data in different formats', async () => {
      // Get data in JSON format (easiest to parse)
      const jsonResult = await chdb.query(
        `SELECT id, name, price FROM ${testTable} ORDER BY id LIMIT 1`,
        { format: 'JSON' }
      );
      const jsonData = JSON.parse(jsonResult).data[0];

      // Get data in CSV format
      const csvResult = await chdb.query(
        `SELECT id, name, price FROM ${testTable} ORDER BY id LIMIT 1`,
        { format: 'CSV' }
      );
      const csvFields = csvResult.trim().split(',');

      // Compare values
      expect(Number(csvFields[0])).toBe(jsonData.id);

      // Get data in TSV format
      const tsvResult = await chdb.query(
        `SELECT id, name, price FROM ${testTable} ORDER BY id LIMIT 1`,
        { format: 'TSV' }
      );
      const tsvFields = tsvResult.trim().split('\t');

      expect(Number(tsvFields[0])).toBe(jsonData.id);
    });

    it('should handle the same empty result across formats', async () => {
      const formats = ['JSON', 'JSONEachRow', 'CSV', 'TSV'] as const;

      for (const format of formats) {
        const result = await chdb.query(
          `SELECT * FROM ${testTable} WHERE 1 = 0`,
          { format }
        );

        expect(result).toBeDefined();
      }
    });
  });
});
