/**
 * Formatters Module Tests (RED phase - clickhouse-8098)
 *
 * Tests for the extracted formatters module that handles:
 * - JSON format
 * - JSONCompact format
 * - JSONEachRow format
 * - TabSeparated (TSV) format
 * - CSV format
 * - Pretty format
 * - Format detection from query/headers
 */

import { describe, it, expect } from 'vitest';
import {
  type QueryResult,
  type Formatter,
  type FormatterOptions,
  formatResult,
  getFormatter,
  detectFormat,
  getContentType,
  FORMAT_CONTENT_TYPES,
  // Individual formatters
  JsonFormatter,
  JsonCompactFormatter,
  JsonEachRowFormatter,
  TabSeparatedFormatter,
  CsvFormatter,
  PrettyFormatter,
} from '../../src/formatters';

// Test data fixtures
const sampleMeta = [
  { name: 'id', type: 'UInt32' },
  { name: 'name', type: 'String' },
  { name: 'value', type: 'Float64' },
];

const sampleData = [
  { id: 1, name: 'Alice', value: 10.5 },
  { id: 2, name: 'Bob', value: 20.3 },
  { id: 3, name: 'Charlie', value: 30.7 },
];

const sampleResult: QueryResult = {
  meta: sampleMeta,
  data: sampleData,
  rows: 3,
  statistics: {
    elapsed: 0.001,
    rows_read: 3,
    bytes_read: 100,
  },
};

const emptyResult: QueryResult = {
  meta: sampleMeta,
  data: [],
  rows: 0,
  statistics: {
    elapsed: 0.001,
    rows_read: 0,
    bytes_read: 0,
  },
};

const singleRowResult: QueryResult = {
  meta: [{ name: 'result', type: 'UInt64' }],
  data: [{ result: 42 }],
  rows: 1,
  statistics: {
    elapsed: 0.001,
    rows_read: 1,
    bytes_read: 8,
  },
};

describe('Formatters Module', () => {
  describe('Formatter Interface', () => {
    it('should export Formatter interface with required methods', () => {
      // Type check - if this compiles, the interface is correct
      const formatter: Formatter = {
        format: (_result: QueryResult, _options?: FormatterOptions) => '',
        contentType: 'text/plain',
      };
      expect(formatter).toBeDefined();
      expect(typeof formatter.format).toBe('function');
      expect(typeof formatter.contentType).toBe('string');
    });

    it('should export FormatterOptions interface', () => {
      const options: FormatterOptions = {
        includeStatistics: true,
        prettyPrint: false,
      };
      expect(options).toBeDefined();
    });
  });

  describe('JsonFormatter', () => {
    it('should format result as valid JSON', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(sampleResult);

      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should include meta, data, rows, and statistics', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(sampleResult);
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('meta');
      expect(parsed).toHaveProperty('data');
      expect(parsed).toHaveProperty('rows');
      expect(parsed).toHaveProperty('statistics');
    });

    it('should output data as array of objects with column names as keys', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(sampleResult);
      const parsed = JSON.parse(output);

      expect(Array.isArray(parsed.data)).toBe(true);
      expect(parsed.data[0]).toHaveProperty('id', 1);
      expect(parsed.data[0]).toHaveProperty('name', 'Alice');
      expect(parsed.data[0]).toHaveProperty('value', 10.5);
    });

    it('should handle empty result set', () => {
      const formatter = new JsonFormatter();
      const output = formatter.format(emptyResult);
      const parsed = JSON.parse(output);

      expect(parsed.data).toHaveLength(0);
      expect(parsed.rows).toBe(0);
    });

    it('should have correct content type', () => {
      const formatter = new JsonFormatter();
      expect(formatter.contentType).toBe('application/json; charset=UTF-8');
    });

    it('should handle NULL values', () => {
      const result: QueryResult = {
        meta: [{ name: 'val', type: 'Nullable(String)' }],
        data: [{ val: null }],
        rows: 1,
      };
      const formatter = new JsonFormatter();
      const output = formatter.format(result);
      const parsed = JSON.parse(output);

      expect(parsed.data[0].val).toBeNull();
    });
  });

  describe('JsonCompactFormatter', () => {
    it('should format data as arrays instead of objects', () => {
      const formatter = new JsonCompactFormatter();
      const output = formatter.format(sampleResult);
      const parsed = JSON.parse(output);

      expect(Array.isArray(parsed.data)).toBe(true);
      expect(Array.isArray(parsed.data[0])).toBe(true);
    });

    it('should maintain column order in arrays', () => {
      const formatter = new JsonCompactFormatter();
      const output = formatter.format(sampleResult);
      const parsed = JSON.parse(output);

      // First row should be [1, 'Alice', 10.5] based on meta order
      expect(parsed.data[0]).toEqual([1, 'Alice', 10.5]);
    });

    it('should include meta for column name lookup', () => {
      const formatter = new JsonCompactFormatter();
      const output = formatter.format(sampleResult);
      const parsed = JSON.parse(output);

      expect(parsed.meta).toEqual(sampleMeta);
    });

    it('should be more compact than regular JSON', () => {
      const jsonFormatter = new JsonFormatter();
      const compactFormatter = new JsonCompactFormatter();

      const jsonOutput = jsonFormatter.format(sampleResult);
      const compactOutput = compactFormatter.format(sampleResult);

      // Compact format should be smaller (no repeated keys)
      expect(compactOutput.length).toBeLessThanOrEqual(jsonOutput.length);
    });

    it('should have correct content type', () => {
      const formatter = new JsonCompactFormatter();
      expect(formatter.contentType).toBe('application/json; charset=UTF-8');
    });
  });

  describe('JsonEachRowFormatter', () => {
    it('should output one JSON object per line', () => {
      const formatter = new JsonEachRowFormatter();
      const output = formatter.format(sampleResult);
      const lines = output.trim().split('\n');

      expect(lines).toHaveLength(3);
    });

    it('should not include metadata wrapper', () => {
      const formatter = new JsonEachRowFormatter();
      const output = formatter.format(sampleResult);
      const firstLine = output.trim().split('\n')[0];
      const parsed = JSON.parse(firstLine);

      expect(parsed).not.toHaveProperty('meta');
      expect(parsed).not.toHaveProperty('rows');
      expect(parsed).toHaveProperty('id');
    });

    it('should end with newline', () => {
      const formatter = new JsonEachRowFormatter();
      const output = formatter.format(sampleResult);

      expect(output.endsWith('\n')).toBe(true);
    });

    it('should return empty string for empty result', () => {
      const formatter = new JsonEachRowFormatter();
      const output = formatter.format(emptyResult);

      expect(output).toBe('');
    });

    it('should be streaming-friendly (each line is valid JSON)', () => {
      const formatter = new JsonEachRowFormatter();
      const output = formatter.format(sampleResult);
      const lines = output.trim().split('\n');

      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it('should have correct content type (ndjson)', () => {
      const formatter = new JsonEachRowFormatter();
      expect(formatter.contentType).toBe('application/x-ndjson; charset=UTF-8');
    });
  });

  describe('TabSeparatedFormatter', () => {
    it('should output tab-separated values', () => {
      const formatter = new TabSeparatedFormatter();
      const output = formatter.format(sampleResult);
      const lines = output.trim().split('\n');

      expect(lines[0].split('\t')).toHaveLength(3);
    });

    it('should not include header by default', () => {
      const formatter = new TabSeparatedFormatter();
      const output = formatter.format(sampleResult);
      const firstLine = output.trim().split('\n')[0];

      // First line should be data, not column names
      expect(firstLine).toBe('1\tAlice\t10.5');
    });

    it('should include header when withNames option is true', () => {
      const formatter = new TabSeparatedFormatter({ withNames: true });
      const output = formatter.format(sampleResult);
      const lines = output.trim().split('\n');

      expect(lines[0]).toBe('id\tname\tvalue');
      expect(lines[1]).toBe('1\tAlice\t10.5');
    });

    it('should escape tabs in values', () => {
      const result: QueryResult = {
        meta: [{ name: 'text', type: 'String' }],
        data: [{ text: 'hello\tworld' }],
        rows: 1,
      };
      const formatter = new TabSeparatedFormatter();
      const output = formatter.format(result);

      expect(output.trim()).toBe('hello\\tworld');
    });

    it('should escape newlines in values', () => {
      const result: QueryResult = {
        meta: [{ name: 'text', type: 'String' }],
        data: [{ text: 'hello\nworld' }],
        rows: 1,
      };
      const formatter = new TabSeparatedFormatter();
      const output = formatter.format(result);

      expect(output.trim()).toBe('hello\\nworld');
    });

    it('should handle NULL values as empty string', () => {
      const result: QueryResult = {
        meta: [{ name: 'id', type: 'UInt32' }, { name: 'val', type: 'Nullable(String)' }],
        data: [{ id: 1, val: null }],
        rows: 1,
      };
      const formatter = new TabSeparatedFormatter();
      const output = formatter.format(result);

      // Output is "1\t\n", trim removes trailing \n but not internal \t
      expect(output).toBe('1\t\n');
    });

    it('should end with newline', () => {
      const formatter = new TabSeparatedFormatter();
      const output = formatter.format(sampleResult);

      expect(output.endsWith('\n')).toBe(true);
    });

    it('should return empty string for empty result', () => {
      const formatter = new TabSeparatedFormatter();
      const output = formatter.format(emptyResult);

      expect(output).toBe('');
    });

    it('should have correct content type', () => {
      const formatter = new TabSeparatedFormatter();
      expect(formatter.contentType).toBe('text/tab-separated-values; charset=UTF-8');
    });
  });

  describe('CsvFormatter', () => {
    it('should output comma-separated values', () => {
      const formatter = new CsvFormatter();
      const output = formatter.format(sampleResult);
      const lines = output.trim().split('\n');

      expect(lines[0].split(',').length).toBe(3);
    });

    it('should not include header by default', () => {
      const formatter = new CsvFormatter();
      const output = formatter.format(sampleResult);
      const firstLine = output.trim().split('\n')[0];

      expect(firstLine).toBe('1,Alice,10.5');
    });

    it('should include header when withNames option is true', () => {
      const formatter = new CsvFormatter({ withNames: true });
      const output = formatter.format(sampleResult);
      const lines = output.trim().split('\n');

      expect(lines[0]).toBe('"id","name","value"');
      expect(lines[1]).toBe('1,Alice,10.5');
    });

    it('should quote strings containing commas', () => {
      const result: QueryResult = {
        meta: [{ name: 'text', type: 'String' }],
        data: [{ text: 'hello, world' }],
        rows: 1,
      };
      const formatter = new CsvFormatter();
      const output = formatter.format(result);

      expect(output.trim()).toBe('"hello, world"');
    });

    it('should escape quotes by doubling them', () => {
      const result: QueryResult = {
        meta: [{ name: 'text', type: 'String' }],
        data: [{ text: 'say "hello"' }],
        rows: 1,
      };
      const formatter = new CsvFormatter();
      const output = formatter.format(result);

      expect(output.trim()).toBe('"say ""hello"""');
    });

    it('should quote strings containing newlines', () => {
      const result: QueryResult = {
        meta: [{ name: 'text', type: 'String' }],
        data: [{ text: 'hello\nworld' }],
        rows: 1,
      };
      const formatter = new CsvFormatter();
      const output = formatter.format(result);

      expect(output.trim()).toBe('"hello\nworld"');
    });

    it('should handle NULL values as empty string', () => {
      const result: QueryResult = {
        meta: [{ name: 'id', type: 'UInt32' }, { name: 'val', type: 'Nullable(String)' }],
        data: [{ id: 1, val: null }],
        rows: 1,
      };
      const formatter = new CsvFormatter();
      const output = formatter.format(result);

      expect(output.trim()).toBe('1,');
    });

    it('should end with newline', () => {
      const formatter = new CsvFormatter();
      const output = formatter.format(sampleResult);

      expect(output.endsWith('\n')).toBe(true);
    });

    it('should return empty string for empty result', () => {
      const formatter = new CsvFormatter();
      const output = formatter.format(emptyResult);

      expect(output).toBe('');
    });

    it('should have correct content type', () => {
      const formatter = new CsvFormatter();
      expect(formatter.contentType).toBe('text/csv; charset=UTF-8');
    });
  });

  describe('PrettyFormatter', () => {
    it('should format result as a human-readable table', () => {
      const formatter = new PrettyFormatter();
      const output = formatter.format(sampleResult);

      // Should contain box-drawing characters or dashes
      expect(output).toMatch(/[-+|]/);
    });

    it('should include column headers', () => {
      const formatter = new PrettyFormatter();
      const output = formatter.format(sampleResult);

      expect(output).toContain('id');
      expect(output).toContain('name');
      expect(output).toContain('value');
    });

    it('should include data values', () => {
      const formatter = new PrettyFormatter();
      const output = formatter.format(sampleResult);

      expect(output).toContain('Alice');
      expect(output).toContain('Bob');
      expect(output).toContain('Charlie');
    });

    it('should handle empty result set', () => {
      const formatter = new PrettyFormatter();
      const output = formatter.format(emptyResult);

      // Should still have header but no data rows
      expect(output).toContain('id');
    });

    it('should align columns', () => {
      const formatter = new PrettyFormatter();
      const output = formatter.format(sampleResult);
      const lines = output.split('\n').filter(l => l.includes('|'));

      // All data lines should have same length (properly aligned)
      const lengths = lines.map(l => l.length);
      const uniqueLengths = [...new Set(lengths)];
      expect(uniqueLengths.length).toBe(1);
    });

    it('should have correct content type', () => {
      const formatter = new PrettyFormatter();
      expect(formatter.contentType).toBe('text/plain; charset=UTF-8');
    });
  });

  describe('formatResult helper function', () => {
    it('should format using JSON formatter by default', () => {
      const output = formatResult(sampleResult);
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('meta');
      expect(parsed).toHaveProperty('data');
    });

    it('should format using specified format', () => {
      const output = formatResult(sampleResult, 'JSONEachRow');
      const lines = output.trim().split('\n');

      expect(lines).toHaveLength(3);
      expect(() => JSON.parse(lines[0])).not.toThrow();
    });

    it('should handle format aliases (TSV -> TabSeparated)', () => {
      const output = formatResult(sampleResult, 'TSV');
      expect(output.trim().split('\n')[0]).toBe('1\tAlice\t10.5');
    });

    it('should handle format aliases (TabSeparatedWithNames)', () => {
      const output = formatResult(sampleResult, 'TabSeparatedWithNames');
      const lines = output.trim().split('\n');

      expect(lines[0]).toBe('id\tname\tvalue');
    });

    it('should handle format aliases (CSVWithNames)', () => {
      const output = formatResult(sampleResult, 'CSVWithNames');
      const lines = output.trim().split('\n');

      expect(lines[0]).toBe('"id","name","value"');
    });

    it('should fall back to JSON for unknown format', () => {
      const output = formatResult(sampleResult, 'UnknownFormat');
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('meta');
    });
  });

  describe('getFormatter function', () => {
    it('should return JsonFormatter for JSON format', () => {
      const formatter = getFormatter('JSON');
      expect(formatter).toBeInstanceOf(JsonFormatter);
    });

    it('should return JsonCompactFormatter for JSONCompact format', () => {
      const formatter = getFormatter('JSONCompact');
      expect(formatter).toBeInstanceOf(JsonCompactFormatter);
    });

    it('should return JsonEachRowFormatter for JSONEachRow format', () => {
      const formatter = getFormatter('JSONEachRow');
      expect(formatter).toBeInstanceOf(JsonEachRowFormatter);
    });

    it('should return TabSeparatedFormatter for TabSeparated format', () => {
      const formatter = getFormatter('TabSeparated');
      expect(formatter).toBeInstanceOf(TabSeparatedFormatter);
    });

    it('should return TabSeparatedFormatter for TSV alias', () => {
      const formatter = getFormatter('TSV');
      expect(formatter).toBeInstanceOf(TabSeparatedFormatter);
    });

    it('should return CsvFormatter for CSV format', () => {
      const formatter = getFormatter('CSV');
      expect(formatter).toBeInstanceOf(CsvFormatter);
    });

    it('should return PrettyFormatter for Pretty format', () => {
      const formatter = getFormatter('Pretty');
      expect(formatter).toBeInstanceOf(PrettyFormatter);
    });

    it('should return JsonFormatter for unknown format', () => {
      const formatter = getFormatter('SomeUnknownFormat');
      expect(formatter).toBeInstanceOf(JsonFormatter);
    });
  });

  describe('detectFormat function', () => {
    it('should detect format from SQL FORMAT clause', () => {
      const format = detectFormat({
        sql: 'SELECT 1 FORMAT JSON',
      });
      expect(format).toBe('JSON');
    });

    it('should detect format from SQL FORMAT clause (case insensitive)', () => {
      const format = detectFormat({
        sql: 'SELECT 1 format jsoneachrow',
      });
      expect(format).toBe('JSONEachRow');
    });

    it('should detect format from X-ClickHouse-Format header', () => {
      const format = detectFormat({
        sql: 'SELECT 1',
        headers: { 'X-ClickHouse-Format': 'CSV' },
      });
      expect(format).toBe('CSV');
    });

    it('should detect format from default_format query param', () => {
      const format = detectFormat({
        sql: 'SELECT 1',
        params: { default_format: 'JSONCompact' },
      });
      expect(format).toBe('JSONCompact');
    });

    it('should prioritize SQL FORMAT over header', () => {
      const format = detectFormat({
        sql: 'SELECT 1 FORMAT JSON',
        headers: { 'X-ClickHouse-Format': 'CSV' },
      });
      expect(format).toBe('JSON');
    });

    it('should prioritize header over default_format param', () => {
      const format = detectFormat({
        sql: 'SELECT 1',
        headers: { 'X-ClickHouse-Format': 'JSON' },
        params: { default_format: 'CSV' },
      });
      expect(format).toBe('JSON');
    });

    it('should default to TabSeparated when no format specified', () => {
      const format = detectFormat({
        sql: 'SELECT 1',
      });
      expect(format).toBe('TabSeparated');
    });

    it('should strip FORMAT clause from SQL and return cleaned SQL', () => {
      const { sql, format } = detectFormat({
        sql: 'SELECT 1, 2, 3 FORMAT JSONEachRow',
        returnCleanSql: true,
      }) as { sql: string; format: string };

      expect(sql).toBe('SELECT 1, 2, 3');
      expect(format).toBe('JSONEachRow');
    });
  });

  describe('getContentType function', () => {
    it('should return correct content type for JSON', () => {
      expect(getContentType('JSON')).toBe('application/json; charset=UTF-8');
    });

    it('should return correct content type for JSONEachRow', () => {
      expect(getContentType('JSONEachRow')).toBe('application/x-ndjson; charset=UTF-8');
    });

    it('should return correct content type for CSV', () => {
      expect(getContentType('CSV')).toBe('text/csv; charset=UTF-8');
    });

    it('should return correct content type for TabSeparated', () => {
      expect(getContentType('TabSeparated')).toBe('text/tab-separated-values; charset=UTF-8');
    });

    it('should return correct content type for Pretty', () => {
      expect(getContentType('Pretty')).toBe('text/plain; charset=UTF-8');
    });

    it('should return text/plain for unknown format', () => {
      expect(getContentType('Unknown')).toBe('text/plain; charset=UTF-8');
    });
  });

  describe('FORMAT_CONTENT_TYPES constant', () => {
    it('should export FORMAT_CONTENT_TYPES mapping', () => {
      expect(FORMAT_CONTENT_TYPES).toBeDefined();
      expect(typeof FORMAT_CONTENT_TYPES).toBe('object');
    });

    it('should have all standard formats', () => {
      expect(FORMAT_CONTENT_TYPES).toHaveProperty('JSON');
      expect(FORMAT_CONTENT_TYPES).toHaveProperty('JSONCompact');
      expect(FORMAT_CONTENT_TYPES).toHaveProperty('JSONEachRow');
      expect(FORMAT_CONTENT_TYPES).toHaveProperty('CSV');
      expect(FORMAT_CONTENT_TYPES).toHaveProperty('CSVWithNames');
      expect(FORMAT_CONTENT_TYPES).toHaveProperty('TSV');
      expect(FORMAT_CONTENT_TYPES).toHaveProperty('TabSeparated');
      expect(FORMAT_CONTENT_TYPES).toHaveProperty('Pretty');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large numbers', () => {
      const result: QueryResult = {
        meta: [{ name: 'big', type: 'UInt64' }],
        data: [{ big: 9007199254740991 }], // Number.MAX_SAFE_INTEGER
        rows: 1,
      };
      const formatter = new JsonFormatter();
      const output = formatter.format(result);
      const parsed = JSON.parse(output);

      expect(parsed.data[0].big).toBe(9007199254740991);
    });

    it('should handle special characters in column names', () => {
      const result: QueryResult = {
        meta: [{ name: 'column with spaces', type: 'String' }],
        data: [{ 'column with spaces': 'value' }],
        rows: 1,
      };
      const formatter = new JsonFormatter();
      const output = formatter.format(result);
      const parsed = JSON.parse(output);

      expect(parsed.data[0]['column with spaces']).toBe('value');
    });

    it('should handle boolean values', () => {
      const result: QueryResult = {
        meta: [{ name: 'flag', type: 'Bool' }],
        data: [{ flag: true }, { flag: false }],
        rows: 2,
      };
      const formatter = new JsonFormatter();
      const output = formatter.format(result);
      const parsed = JSON.parse(output);

      expect(parsed.data[0].flag).toBe(true);
      expect(parsed.data[1].flag).toBe(false);
    });

    it('should handle array values', () => {
      const result: QueryResult = {
        meta: [{ name: 'arr', type: 'Array(UInt32)' }],
        data: [{ arr: [1, 2, 3] }],
        rows: 1,
      };
      const formatter = new JsonFormatter();
      const output = formatter.format(result);
      const parsed = JSON.parse(output);

      expect(parsed.data[0].arr).toEqual([1, 2, 3]);
    });

    it('should handle nested object values', () => {
      const result: QueryResult = {
        meta: [{ name: 'obj', type: 'Tuple(a UInt32, b String)' }],
        data: [{ obj: { a: 1, b: 'test' } }],
        rows: 1,
      };
      const formatter = new JsonFormatter();
      const output = formatter.format(result);
      const parsed = JSON.parse(output);

      expect(parsed.data[0].obj).toEqual({ a: 1, b: 'test' });
    });

    it('should handle empty string values', () => {
      const result: QueryResult = {
        meta: [{ name: 'str', type: 'String' }],
        data: [{ str: '' }],
        rows: 1,
      };
      const formatter = new CsvFormatter();
      const output = formatter.format(result);

      expect(output.trim()).toBe('');
    });

    it('should handle Unicode characters', () => {
      const result: QueryResult = {
        meta: [{ name: 'text', type: 'String' }],
        data: [{ text: 'Hello, World!' }],
        rows: 1,
      };
      const formatter = new JsonFormatter();
      const output = formatter.format(result);
      const parsed = JSON.parse(output);

      expect(parsed.data[0].text).toBe('Hello, World!');
    });
  });

  describe('Composability', () => {
    it('should allow creating custom formatter instances', () => {
      const customCsv = new CsvFormatter({ withNames: true });
      const standardCsv = new CsvFormatter();

      const withNames = customCsv.format(sampleResult);
      const withoutNames = standardCsv.format(sampleResult);

      expect(withNames.split('\n').length).toBeGreaterThan(withoutNames.split('\n').length);
    });

    it('should allow extending formatters', () => {
      // Test that formatters can be extended
      class CustomJsonFormatter extends JsonFormatter {
        format(result: QueryResult, options?: FormatterOptions): string {
          const output = super.format(result, options);
          const parsed = JSON.parse(output);
          parsed.custom_field = 'custom_value';
          return JSON.stringify(parsed);
        }
      }

      const formatter = new CustomJsonFormatter();
      const output = formatter.format(sampleResult);
      const parsed = JSON.parse(output);

      expect(parsed.custom_field).toBe('custom_value');
    });
  });
});
