/**
 * JSON Round-Trip Tests
 *
 * Tests verifying JSON input/output format support works correctly:
 * - JSON parsing and serialization
 * - Different JSON formats (JSON, JSONCompact, JSONEachRow)
 * - JSONExtract-style functions via the formatter
 * - Round-trip integrity (data in = data out)
 * - Edge cases (nulls, arrays, nested objects, special characters)
 *
 * Run with: pnpm test
 */

import { describe, it, expect } from 'vitest';
import {
  formatResult,
  getFormatter,
  detectFormat,
  JsonFormatter,
  JsonCompactFormatter,
  JsonEachRowFormatter,
  type QueryResult,
} from '../../src/formatters';

// ============================================================================
// Test Data Fixtures
// ============================================================================

/**
 * Sample JSON data representing typical query results
 */
const jsonTestData = {
  meta: [
    { name: 'id', type: 'UInt32' },
    { name: 'name', type: 'String' },
    { name: 'metadata', type: 'String' },
  ],
  data: [
    { id: 1, name: 'Alice', metadata: '{"role": "admin", "active": true}' },
    { id: 2, name: 'Bob', metadata: '{"role": "user", "active": false}' },
  ],
  rows: 2,
  statistics: { elapsed: 0.001, rows_read: 2, bytes_read: 100 },
};

/**
 * Complex nested JSON data
 */
const nestedJsonData: QueryResult = {
  meta: [
    { name: 'user_id', type: 'UInt64' },
    { name: 'profile', type: 'String' },
    { name: 'tags', type: 'Array(String)' },
  ],
  data: [
    {
      user_id: 1001,
      profile: '{"settings": {"theme": "dark", "notifications": {"email": true, "push": false}}}',
      tags: ['developer', 'admin'],
    },
    {
      user_id: 1002,
      profile: '{"settings": {"theme": "light", "notifications": {"email": false, "push": true}}}',
      tags: ['user'],
    },
  ],
  rows: 2,
};

/**
 * JSON with special characters
 */
const specialCharJsonData: QueryResult = {
  meta: [
    { name: 'id', type: 'UInt32' },
    { name: 'content', type: 'String' },
  ],
  data: [
    { id: 1, content: 'Hello "World"' },
    { id: 2, content: 'Line1\nLine2' },
    { id: 3, content: 'Tab\there' },
    { id: 4, content: 'Unicode: Japanese text' },
    { id: 5, content: 'Backslash: path\\to\\file' },
  ],
  rows: 5,
};

/**
 * JSON with null values
 */
const nullJsonData: QueryResult = {
  meta: [
    { name: 'id', type: 'UInt32' },
    { name: 'optional_name', type: 'Nullable(String)' },
    { name: 'optional_value', type: 'Nullable(Float64)' },
  ],
  data: [
    { id: 1, optional_name: 'Has name', optional_value: 10.5 },
    { id: 2, optional_name: null, optional_value: 20.3 },
    { id: 3, optional_name: 'Also has name', optional_value: null },
    { id: 4, optional_name: null, optional_value: null },
  ],
  rows: 4,
};

/**
 * JSON with numeric edge cases
 */
const numericJsonData: QueryResult = {
  meta: [
    { name: 'int_val', type: 'Int64' },
    { name: 'uint_val', type: 'UInt64' },
    { name: 'float_val', type: 'Float64' },
  ],
  data: [
    { int_val: 0, uint_val: 0, float_val: 0.0 },
    { int_val: -1, uint_val: 1, float_val: 0.1 },
    { int_val: Number.MAX_SAFE_INTEGER, uint_val: Number.MAX_SAFE_INTEGER, float_val: 1.7976931348623157e308 },
    { int_val: Number.MIN_SAFE_INTEGER, uint_val: 0, float_val: -1.7976931348623157e308 },
    { int_val: 0, uint_val: 0, float_val: 2.2250738585072014e-308 }, // Smallest positive float
  ],
  rows: 5,
};

// ============================================================================
// Test Suites
// ============================================================================

describe('JSON Round-Trip Tests', () => {
  describe('JSON Format - Round-Trip Integrity', () => {
    it('should preserve data through JSON format round-trip', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(jsonTestData);

      // Parse the output
      const parsed = JSON.parse(output);

      // Verify structure is preserved
      expect(parsed.meta).toEqual(jsonTestData.meta);
      expect(parsed.data).toEqual(jsonTestData.data);
      expect(parsed.rows).toBe(jsonTestData.rows);
    });

    it('should preserve nested JSON strings in data', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(jsonTestData);
      const parsed = JSON.parse(output);

      // The metadata field contains JSON string - verify it's parseable
      const metadata1 = JSON.parse(parsed.data[0].metadata);
      expect(metadata1.role).toBe('admin');
      expect(metadata1.active).toBe(true);

      const metadata2 = JSON.parse(parsed.data[1].metadata);
      expect(metadata2.role).toBe('user');
      expect(metadata2.active).toBe(false);
    });

    it('should preserve array values through round-trip', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(nestedJsonData);
      const parsed = JSON.parse(output);

      expect(parsed.data[0].tags).toEqual(['developer', 'admin']);
      expect(parsed.data[1].tags).toEqual(['user']);
    });

    it('should preserve null values through round-trip', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(nullJsonData);
      const parsed = JSON.parse(output);

      expect(parsed.data[0].optional_name).toBe('Has name');
      expect(parsed.data[1].optional_name).toBeNull();
      expect(parsed.data[2].optional_value).toBeNull();
      expect(parsed.data[3].optional_name).toBeNull();
      expect(parsed.data[3].optional_value).toBeNull();
    });

    it('should preserve numeric precision through round-trip', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(numericJsonData);
      const parsed = JSON.parse(output);

      // Verify all numeric values
      expect(parsed.data[0].int_val).toBe(0);
      expect(parsed.data[0].float_val).toBe(0.0);
      expect(parsed.data[1].int_val).toBe(-1);
      expect(parsed.data[2].int_val).toBe(Number.MAX_SAFE_INTEGER);
      expect(parsed.data[3].int_val).toBe(Number.MIN_SAFE_INTEGER);
    });
  });

  describe('JSONCompact Format - Round-Trip Integrity', () => {
    it('should preserve data through JSONCompact format round-trip', () => {
      const formatter = new JsonCompactFormatter();
      const output = formatter.format(jsonTestData);
      const parsed = JSON.parse(output);

      // JSONCompact uses arrays for data
      expect(parsed.meta).toEqual(jsonTestData.meta);
      expect(Array.isArray(parsed.data)).toBe(true);
      expect(Array.isArray(parsed.data[0])).toBe(true);
      expect(parsed.rows).toBe(jsonTestData.rows);
    });

    it('should convert object data to array format correctly', () => {
      const formatter = new JsonCompactFormatter();
      const output = formatter.format(jsonTestData);
      const parsed = JSON.parse(output);

      // First row should be [1, 'Alice', '{"role": "admin", ...}']
      expect(parsed.data[0][0]).toBe(1);
      expect(parsed.data[0][1]).toBe('Alice');
      expect(typeof parsed.data[0][2]).toBe('string');
      expect(JSON.parse(parsed.data[0][2]).role).toBe('admin');
    });

    it('should reconstruct original data from JSONCompact output', () => {
      const formatter = new JsonCompactFormatter();
      const output = formatter.format(jsonTestData);
      const parsed = JSON.parse(output);

      // Reconstruct original format from compact
      const reconstructedData = parsed.data.map((row: unknown[]) => {
        const obj: Record<string, unknown> = {};
        parsed.meta.forEach((col: { name: string }, i: number) => {
          obj[col.name] = row[i];
        });
        return obj;
      });

      expect(reconstructedData).toEqual(jsonTestData.data);
    });
  });

  describe('JSONEachRow Format - Round-Trip Integrity', () => {
    it('should preserve data through JSONEachRow format round-trip', () => {
      const formatter = new JsonEachRowFormatter();
      const output = formatter.format(jsonTestData);

      // Each line should be valid JSON
      const lines = output.trim().split('\n');
      expect(lines.length).toBe(2);

      const row1 = JSON.parse(lines[0]);
      const row2 = JSON.parse(lines[1]);

      expect(row1.id).toBe(1);
      expect(row1.name).toBe('Alice');
      expect(row2.id).toBe(2);
      expect(row2.name).toBe('Bob');
    });

    it('should be streamable - each line independently parseable', () => {
      const formatter = new JsonEachRowFormatter();
      const output = formatter.format(nestedJsonData);
      const lines = output.trim().split('\n');

      // Simulate streaming: parse each line independently
      const parsedRows = lines.map(line => JSON.parse(line));

      expect(parsedRows[0].user_id).toBe(1001);
      expect(parsedRows[0].tags).toEqual(['developer', 'admin']);
      expect(parsedRows[1].user_id).toBe(1002);
      expect(parsedRows[1].tags).toEqual(['user']);
    });

    it('should handle empty result set', () => {
      const emptyData: QueryResult = {
        meta: [{ name: 'id', type: 'UInt32' }],
        data: [],
        rows: 0,
      };

      const formatter = new JsonEachRowFormatter();
      const output = formatter.format(emptyData);

      expect(output).toBe('');
    });
  });

  describe('Special Characters Handling', () => {
    it('should escape quotes in JSON output', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(specialCharJsonData);
      const parsed = JSON.parse(output);

      expect(parsed.data[0].content).toBe('Hello "World"');
    });

    it('should handle newlines in JSON output', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(specialCharJsonData);
      const parsed = JSON.parse(output);

      expect(parsed.data[1].content).toBe('Line1\nLine2');
    });

    it('should handle tabs in JSON output', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(specialCharJsonData);
      const parsed = JSON.parse(output);

      expect(parsed.data[2].content).toBe('Tab\there');
    });

    it('should handle unicode characters in JSON output', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(specialCharJsonData);
      const parsed = JSON.parse(output);

      expect(parsed.data[3].content).toBe('Unicode: Japanese text');
    });

    it('should handle backslashes in JSON output', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(specialCharJsonData);
      const parsed = JSON.parse(output);

      expect(parsed.data[4].content).toBe('Backslash: path\\to\\file');
    });
  });

  describe('Format Detection from SQL', () => {
    it('should detect JSON format from SQL FORMAT clause', () => {
      const format = detectFormat({ sql: 'SELECT * FROM users FORMAT JSON' });
      expect(format).toBe('JSON');
    });

    it('should detect JSONCompact format from SQL', () => {
      const format = detectFormat({ sql: 'SELECT 1 FORMAT JSONCompact' });
      expect(format).toBe('JSONCompact');
    });

    it('should detect JSONEachRow format from SQL', () => {
      const format = detectFormat({ sql: 'SELECT * FROM logs FORMAT JSONEachRow' });
      expect(format).toBe('JSONEachRow');
    });

    it('should be case-insensitive for format detection', () => {
      const formats = [
        { sql: 'SELECT 1 FORMAT json', expected: 'JSON' },
        { sql: 'SELECT 1 FORMAT JSONEACHROW', expected: 'JSONEachRow' },
        { sql: 'SELECT 1 FORMAT jsoncompact', expected: 'JSONCompact' },
      ];

      for (const { sql, expected } of formats) {
        expect(detectFormat({ sql })).toBe(expected);
      }
    });

    it('should strip FORMAT clause when returning clean SQL', () => {
      const result = detectFormat({
        sql: 'SELECT id, name FROM users WHERE active = 1 FORMAT JSON',
        returnCleanSql: true,
      }) as { sql: string; format: string };

      expect(result.sql).toBe('SELECT id, name FROM users WHERE active = 1');
      expect(result.format).toBe('JSON');
    });
  });

  describe('formatResult Helper Function', () => {
    it('should format as JSON by default', () => {
      const output = formatResult(jsonTestData);
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('meta');
      expect(parsed).toHaveProperty('data');
      expect(parsed).toHaveProperty('rows');
    });

    it('should format as JSONCompact when specified', () => {
      const output = formatResult(jsonTestData, 'JSONCompact');
      const parsed = JSON.parse(output);

      expect(Array.isArray(parsed.data[0])).toBe(true);
    });

    it('should format as JSONEachRow when specified', () => {
      const output = formatResult(jsonTestData, 'JSONEachRow');
      const lines = output.trim().split('\n');

      expect(lines.length).toBe(2);
      expect(() => JSON.parse(lines[0])).not.toThrow();
    });
  });

  describe('Cross-Format Consistency', () => {
    it('should produce equivalent data across all JSON formats', () => {
      const jsonFormatter = new JsonFormatter();
      const compactFormatter = new JsonCompactFormatter();
      const eachRowFormatter = new JsonEachRowFormatter();

      // Format with each formatter
      const jsonOutput = JSON.parse(jsonFormatter.format(jsonTestData));
      const compactOutput = JSON.parse(compactFormatter.format(jsonTestData));
      const eachRowLines = eachRowFormatter.format(jsonTestData).trim().split('\n');
      const eachRowOutput = eachRowLines.map(line => JSON.parse(line));

      // Verify all contain the same data
      expect(jsonOutput.data.length).toBe(compactOutput.data.length);
      expect(jsonOutput.data.length).toBe(eachRowOutput.length);

      // Verify first row values match across formats
      expect(jsonOutput.data[0].id).toBe(compactOutput.data[0][0]);
      expect(jsonOutput.data[0].id).toBe(eachRowOutput[0].id);

      expect(jsonOutput.data[0].name).toBe(compactOutput.data[0][1]);
      expect(jsonOutput.data[0].name).toBe(eachRowOutput[0].name);
    });
  });

  describe('JSONColumns Format Simulation', () => {
    /**
     * JSONColumns format stores data as column arrays instead of row arrays
     * This test simulates the format transformation
     */
    it('should be possible to convert to columnar JSON format', () => {
      const result: QueryResult = {
        meta: [
          { name: 'id', type: 'UInt32' },
          { name: 'name', type: 'String' },
        ],
        data: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
        ],
        rows: 3,
      };

      // Convert to columnar format
      const columnar: Record<string, unknown[]> = {};
      for (const col of result.meta) {
        columnar[col.name] = result.data.map(row => row[col.name]);
      }

      // Verify columnar structure
      expect(columnar.id).toEqual([1, 2, 3]);
      expect(columnar.name).toEqual(['Alice', 'Bob', 'Charlie']);

      // Verify it can be serialized to JSON
      const jsonOutput = JSON.stringify(columnar);
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.id).toEqual([1, 2, 3]);
      expect(parsed.name).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('should handle null values in columnar conversion', () => {
      // Convert nullJsonData to columnar format
      const columnar: Record<string, unknown[]> = {};
      for (const col of nullJsonData.meta) {
        columnar[col.name] = nullJsonData.data.map(row => row[col.name]);
      }

      // Verify nulls are preserved in arrays
      expect(columnar.optional_name).toEqual(['Has name', null, 'Also has name', null]);
      expect(columnar.optional_value).toEqual([10.5, 20.3, null, null]);

      // Verify JSON serialization preserves nulls
      const jsonOutput = JSON.stringify(columnar);
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.optional_name[1]).toBeNull();
      expect(parsed.optional_value[2]).toBeNull();
    });
  });

  describe('JSON Statistics Inclusion', () => {
    it('should include statistics in JSON output when present', () => {
      const resultWithStats: QueryResult = {
        meta: [{ name: 'n', type: 'UInt64' }],
        data: [{ n: 1 }],
        rows: 1,
        statistics: {
          elapsed: 0.123,
          rows_read: 1000,
          bytes_read: 50000,
        },
      };

      const formatter = new JsonFormatter();
      const output = formatter.format(resultWithStats);
      const parsed = JSON.parse(output);

      expect(parsed.statistics).toBeDefined();
      expect(parsed.statistics.elapsed).toBe(0.123);
      expect(parsed.statistics.rows_read).toBe(1000);
      expect(parsed.statistics.bytes_read).toBe(50000);
    });

    it('should omit statistics from JSONEachRow output', () => {
      const resultWithStats: QueryResult = {
        meta: [{ name: 'n', type: 'UInt64' }],
        data: [{ n: 1 }],
        rows: 1,
        statistics: {
          elapsed: 0.123,
          rows_read: 1000,
          bytes_read: 50000,
        },
      };

      const formatter = new JsonEachRowFormatter();
      const output = formatter.format(resultWithStats);
      const parsed = JSON.parse(output.trim());

      // JSONEachRow only outputs data rows, no statistics wrapper
      expect(parsed).not.toHaveProperty('statistics');
      expect(parsed).toHaveProperty('n', 1);
    });
  });

  describe('Large Data Set Handling', () => {
    it('should handle large number of rows', () => {
      // Generate 1000 rows
      const largeData: QueryResult = {
        meta: [
          { name: 'id', type: 'UInt64' },
          { name: 'value', type: 'Float64' },
        ],
        data: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          value: Math.random(),
        })),
        rows: 1000,
      };

      const formatter = new JsonFormatter();
      const output = formatter.format(largeData);
      const parsed = JSON.parse(output);

      expect(parsed.data.length).toBe(1000);
      expect(parsed.rows).toBe(1000);
    });

    it('should handle large number of columns', () => {
      // Generate data with 50 columns
      const meta = Array.from({ length: 50 }, (_, i) => ({
        name: `col_${i}`,
        type: 'String',
      }));

      const row: Record<string, string> = {};
      meta.forEach(col => {
        row[col.name] = `value_${col.name}`;
      });

      const wideData: QueryResult = {
        meta,
        data: [row],
        rows: 1,
      };

      const formatter = new JsonFormatter();
      const output = formatter.format(wideData);
      const parsed = JSON.parse(output);

      expect(parsed.meta.length).toBe(50);
      expect(Object.keys(parsed.data[0]).length).toBe(50);
    });
  });

  describe('Content Type Headers', () => {
    it('should return correct content type for JSON formatter', () => {
      const formatter = new JsonFormatter();
      expect(formatter.contentType).toBe('application/json; charset=UTF-8');
    });

    it('should return correct content type for JSONCompact formatter', () => {
      const formatter = new JsonCompactFormatter();
      expect(formatter.contentType).toBe('application/json; charset=UTF-8');
    });

    it('should return correct content type for JSONEachRow formatter', () => {
      const formatter = new JsonEachRowFormatter();
      expect(formatter.contentType).toBe('application/x-ndjson; charset=UTF-8');
    });
  });
});
