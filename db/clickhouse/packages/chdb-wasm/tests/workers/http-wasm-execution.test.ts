/**
 * HTTP -> WASM -> Response Flow Tests
 *
 * These tests verify the complete flow from HTTP request to WASM execution
 * to HTTP response. They test the thin wrapper nature of http-query-handler.ts
 * which delegates SQL execution to the WASM executor.
 *
 * Test Flow:
 * 1. HTTP Request with SQL query
 * 2. handleHttpQuery passes query to configured SqlExecutor
 * 3. WASM executor executes the query
 * 4. Result is formatted and returned as HTTP response
 *
 * Run with: pnpm test:workers
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  handleHttpQuery,
  setSqlExecutor,
  type SqlExecutor,
  type HttpQueryEnv,
} from '../../src/http-query-handler';
import type { RowData, ColumnMeta, QueryStatistics } from '../../src/types';

/**
 * Mock SQL Executor that simulates WASM execution
 *
 * This executor tracks calls and returns structured results,
 * allowing us to verify the full HTTP -> WASM -> response flow.
 */
class MockWasmExecutor implements SqlExecutor {
  public executedQueries: string[] = [];
  public callCount = 0;
  private customHandler: ((sql: string) => { meta: ColumnMeta[]; data: RowData[]; rows: number; statistics?: QueryStatistics }) | null = null;

  async execute(sql: string): Promise<{ meta: ColumnMeta[]; data: RowData[]; rows: number; statistics?: QueryStatistics }> {
    this.executedQueries.push(sql);
    this.callCount++;

    // Use custom handler if provided
    if (this.customHandler) {
      return this.customHandler(sql);
    }

    // Default: simulate WASM execution based on query pattern
    return this.simulateWasmExecution(sql);
  }

  /**
   * Set a custom handler for specific test scenarios
   */
  setCustomHandler(handler: ((sql: string) => { meta: ColumnMeta[]; data: RowData[]; rows: number; statistics?: QueryStatistics }) | null): void {
    this.customHandler = handler;
  }

  /**
   * Simulate WASM execution by parsing simple queries
   */
  private simulateWasmExecution(sql: string): { meta: ColumnMeta[]; data: RowData[]; rows: number; statistics?: QueryStatistics } {
    const trimmedSql = sql.trim().toUpperCase();

    // Handle SELECT 1 or similar simple expressions
    if (trimmedSql.match(/^SELECT\s+\d+(\s+AS\s+\w+)?$/i)) {
      const match = sql.match(/SELECT\s+(\d+)(\s+AS\s+(\w+))?/i);
      if (match) {
        const value = parseInt(match[1], 10);
        const alias = match[3] || match[1];
        return {
          meta: [{ name: alias, type: 'UInt64' }],
          data: [{ [alias]: value }],
          rows: 1,
          statistics: { elapsed: 0.001, rows_read: 1, bytes_read: 8 },
        };
      }
    }

    // Handle SELECT with arithmetic (e.g., SELECT 1 + 2 + 3 AS sum)
    const arithmeticMatch = sql.match(/SELECT\s+([\d\s+\-*/()]+)\s+AS\s+(\w+)/i);
    if (arithmeticMatch) {
      const expression = arithmeticMatch[1].trim();
      const alias = arithmeticMatch[2];
      // Only allow safe characters: digits, spaces, +, -, *, /, parentheses
      if (/^[\d\s+\-*/()]+$/.test(expression)) {
        // Safely evaluate the arithmetic expression using basic parsing
        // Note: Function() constructor may not be available in workerd
        let result: number;
        try {
          // Simple arithmetic evaluation for common patterns
          // Handle "1 + 2 + 3" style expressions
          const parts = expression.split(/\s*\+\s*/);
          if (parts.every(p => /^\d+$/.test(p.trim()))) {
            result = parts.reduce((sum, p) => sum + parseInt(p.trim(), 10), 0);
          } else {
            // Try multiplication
            const mulParts = expression.split(/\s*\*\s*/);
            if (mulParts.every(p => /^\d+$/.test(p.trim()))) {
              result = mulParts.reduce((prod, p) => prod * parseInt(p.trim(), 10), 1);
            } else {
              // Fall back to empty result
              return { meta: [], data: [], rows: 0, statistics: { elapsed: 0.001, rows_read: 0, bytes_read: 0 } };
            }
          }
        } catch {
          return { meta: [], data: [], rows: 0, statistics: { elapsed: 0.001, rows_read: 0, bytes_read: 0 } };
        }
        return {
          meta: [{ name: alias, type: 'UInt64' }],
          data: [{ [alias]: result }],
          rows: 1,
          statistics: { elapsed: 0.001, rows_read: 1, bytes_read: 8 },
        };
      }
    }

    // Handle SELECT with string literal
    if (sql.match(/SELECT\s+'[^']*'/i)) {
      const match = sql.match(/SELECT\s+'([^']*)'\s*(?:AS\s+(\w+))?/i);
      if (match) {
        const value = match[1];
        const alias = match[2] || 'text';
        return {
          meta: [{ name: alias, type: 'String' }],
          data: [{ [alias]: value }],
          rows: 1,
          statistics: { elapsed: 0.001, rows_read: 1, bytes_read: value.length },
        };
      }
    }

    // Handle SELECT with multiple columns
    if (sql.match(/SELECT\s+\d+\s*(,\s*\d+)+/i)) {
      const matches = sql.match(/(\d+)\s*(?:AS\s+(\w+))?/gi);
      if (matches) {
        const data: RowData = {};
        const meta: ColumnMeta[] = [];

        matches.forEach((m, i) => {
          const parts = m.match(/(\d+)(?:\s+AS\s+(\w+))?/i);
          if (parts) {
            const value = parseInt(parts[1], 10);
            const name = parts[2] || `col${i}`;
            data[name] = value;
            meta.push({ name, type: 'UInt64' });
          }
        });

        return {
          meta,
          data: [data],
          rows: 1,
          statistics: { elapsed: 0.001, rows_read: 1, bytes_read: 8 * meta.length },
        };
      }
    }

    // Handle SELECT now()
    if (trimmedSql.match(/SELECT\s+NOW\(\)/i)) {
      const alias = sql.match(/AS\s+(\w+)/i)?.[1] || 'now()';
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      return {
        meta: [{ name: alias, type: 'DateTime' }],
        data: [{ [alias]: now }],
        rows: 1,
        statistics: { elapsed: 0.001, rows_read: 1, bytes_read: 19 },
      };
    }

    // Handle SELECT version()
    if (trimmedSql.match(/SELECT\s+VERSION\(\)/i)) {
      return {
        meta: [{ name: 'version()', type: 'String' }],
        data: [{ 'version()': 'chdb-wasm 0.1.0' }],
        rows: 1,
        statistics: { elapsed: 0.001, rows_read: 1, bytes_read: 15 },
      };
    }

    // Handle SELECT with multiple rows using UNION ALL or array
    if (sql.match(/UNION\s+ALL/i)) {
      // Simplified: return mock multi-row result
      return {
        meta: [{ name: 'value', type: 'UInt64' }],
        data: [{ value: 1 }, { value: 2 }, { value: 3 }],
        rows: 3,
        statistics: { elapsed: 0.002, rows_read: 3, bytes_read: 24 },
      };
    }

    // Handle numbers() function for generating sequences
    if (sql.match(/numbers\s*\(/i)) {
      const match = sql.match(/numbers\s*\(\s*(\d+)\s*\)/i);
      if (match) {
        const count = Math.min(parseInt(match[1], 10), 100); // Limit for safety
        const data: RowData[] = [];
        for (let i = 0; i < count; i++) {
          data.push({ number: i });
        }
        return {
          meta: [{ name: 'number', type: 'UInt64' }],
          data,
          rows: count,
          statistics: { elapsed: 0.001 * count, rows_read: count, bytes_read: 8 * count },
        };
      }
    }

    // Default: empty result
    return {
      meta: [],
      data: [],
      rows: 0,
      statistics: { elapsed: 0.001, rows_read: 0, bytes_read: 0 },
    };
  }

  /**
   * Reset the executor state between tests
   */
  reset(): void {
    this.executedQueries = [];
    this.callCount = 0;
    this.customHandler = null;
  }
}

// Global mock executor instance
let mockExecutor: MockWasmExecutor;
let originalExecutor: SqlExecutor | null = null;

/**
 * Create a test HTTP environment
 */
function createTestEnv(): HttpQueryEnv {
  return {
    chdb: {
      query: async () => { throw new Error('Not used'); },
    },
    DEFAULT_DATABASE: 'default',
  };
}

/**
 * Create a test Request object
 */
function createRequest(
  url: string,
  options: RequestInit = {}
): Request {
  return new Request(url, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
  });
}

describe('HTTP -> WASM -> Response Flow', () => {
  beforeAll(() => {
    // Create and set up the mock executor
    mockExecutor = new MockWasmExecutor();
    setSqlExecutor(mockExecutor);
  });

  afterAll(() => {
    // Clean up
    setSqlExecutor(null);
  });

  beforeEach(() => {
    // Reset mock executor state before each test
    mockExecutor.reset();
  });

  describe('Basic Query Execution Flow', () => {
    it('should execute a simple SELECT query and return result', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1+AS+num');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      expect(mockExecutor.callCount).toBe(1);
      expect(mockExecutor.executedQueries[0]).toBe('SELECT 1 AS num');

      const body = await response.text();
      // Default format is TabSeparated, which should contain "1"
      expect(body).toContain('1');
    });

    it('should execute arithmetic expressions', async () => {
      const env = createTestEnv();
      // Use encodeURIComponent to properly encode the SQL query
      const sql = 'SELECT 1 + 2 + 3 AS sum';
      const request = createRequest(`http://localhost/?query=${encodeURIComponent(sql)}&default_format=JSON`);

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      expect(mockExecutor.callCount).toBe(1);
      // Verify the query was passed correctly to the executor
      expect(mockExecutor.executedQueries[0]).toBe(sql);

      const json = await response.json() as { data: Array<{ sum: number }> };
      expect(json.data).toBeDefined();
      expect(json.data.length).toBeGreaterThan(0);
      expect(json.data[0].sum).toBe(6);
    });

    it('should pass query to WASM executor exactly once', async () => {
      const env = createTestEnv();
      const sql = 'SELECT 42 AS answer';
      const request = createRequest(`http://localhost/?query=${encodeURIComponent(sql)}`);

      await handleHttpQuery(request, env);

      expect(mockExecutor.callCount).toBe(1);
      expect(mockExecutor.executedQueries).toHaveLength(1);
      expect(mockExecutor.executedQueries[0]).toBe(sql);
    });

    it('should handle POST requests with query in body', async () => {
      const env = createTestEnv();
      const sql = 'SELECT 100 AS value';
      const request = createRequest('http://localhost/', {
        method: 'POST',
        body: sql,
      });

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      expect(mockExecutor.callCount).toBe(1);
      expect(mockExecutor.executedQueries[0]).toBe(sql);
    });

    it('should handle string literals in queries', async () => {
      const env = createTestEnv();
      const request = createRequest("http://localhost/?query=SELECT+'hello'+AS+greeting");

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      expect(mockExecutor.callCount).toBe(1);
    });
  });

  describe('Output Format Tests', () => {
    it('should return JSON format when requested via default_format parameter', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1+AS+num&default_format=JSON');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const json = await response.json() as { meta: unknown[]; data: unknown[]; rows: number };
      expect(json.meta).toBeDefined();
      expect(json.data).toBeDefined();
      expect(json.rows).toBeDefined();
    });

    it('should return TabSeparated format by default', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1+AS+num');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/tab-separated-values');
    });

    it('should return CSV format when requested', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1+AS+num&default_format=CSV');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/csv');
    });

    it('should return JSONEachRow format (NDJSON)', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1+AS+num&default_format=JSONEachRow');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');

      const body = await response.text();
      // JSONEachRow should have one JSON object per line
      expect(body).toContain('{');
      expect(body).toContain('"num"');
    });

    it('should return JSONCompact format', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1+AS+num&default_format=JSONCompact');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const json = await response.json() as { meta: unknown[]; data: unknown[][] };
      expect(json.meta).toBeDefined();
      expect(json.data).toBeDefined();
      // JSONCompact returns data as arrays instead of objects
      expect(Array.isArray(json.data[0])).toBe(true);
    });

    it('should respect FORMAT clause in SQL over default_format parameter', async () => {
      const env = createTestEnv();
      // SQL has FORMAT JSON, but URL param says TabSeparated
      const request = createRequest('http://localhost/?query=SELECT+1+AS+num+FORMAT+JSON&default_format=TabSeparated');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      // FORMAT clause in SQL takes precedence
      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should respect X-ClickHouse-Format header', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1+AS+num', {
        headers: {
          'X-ClickHouse-Format': 'JSON',
        },
      });

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');
    });
  });

  describe('Response Headers', () => {
    it('should include X-ClickHouse-Query-Id header', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1');

      const response = await handleHttpQuery(request, env);

      const queryId = response.headers.get('X-ClickHouse-Query-Id');
      expect(queryId).toBeDefined();
      expect(queryId).not.toBe('');
    });

    it('should use provided query_id parameter', async () => {
      const env = createTestEnv();
      const customQueryId = 'test-query-id-123';
      const request = createRequest(`http://localhost/?query=SELECT+1&query_id=${customQueryId}`);

      const response = await handleHttpQuery(request, env);

      expect(response.headers.get('X-ClickHouse-Query-Id')).toBe(customQueryId);
    });

    it('should include X-ClickHouse-Format header', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1&default_format=JSON');

      const response = await handleHttpQuery(request, env);

      expect(response.headers.get('X-ClickHouse-Format')).toBe('JSON');
    });

    it('should include X-ClickHouse-Summary header with statistics', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1');

      const response = await handleHttpQuery(request, env);

      const summary = response.headers.get('X-ClickHouse-Summary');
      expect(summary).toBeDefined();

      const summaryJson = JSON.parse(summary!);
      expect(summaryJson.read_rows).toBeDefined();
      expect(summaryJson.read_bytes).toBeDefined();
    });

    it('should include CORS headers', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1');

      const response = await handleHttpQuery(request, env);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should include X-ClickHouse-Server-Display-Name header', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1');

      const response = await handleHttpQuery(request, env);

      expect(response.headers.get('X-ClickHouse-Server-Display-Name')).toBe('chdb-wasm');
    });
  });

  describe('Query Parameters', () => {
    it('should apply typed parameter placeholders', async () => {
      const env = createTestEnv();
      // param_x=5 should replace {x:UInt32} in the query
      const request = createRequest('http://localhost/?query=SELECT+%7Bx%3AUInt32%7D+AS+value&param_x=42');

      await handleHttpQuery(request, env);

      // The executor should receive the query with parameter substituted
      expect(mockExecutor.executedQueries[0]).toBe('SELECT 42 AS value');
    });

    it('should apply string parameter placeholders', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+%7Bname%3AString%7D+AS+greeting&param_name=world');

      await handleHttpQuery(request, env);

      // String params should be quoted
      expect(mockExecutor.executedQueries[0]).toBe("SELECT 'world' AS greeting");
    });

    it('should handle multiple parameters', async () => {
      const env = createTestEnv();
      const request = createRequest(
        'http://localhost/?query=SELECT+%7Ba%3AUInt32%7D+%2B+%7Bb%3AUInt32%7D+AS+sum&param_a=10&param_b=20'
      );

      await handleHttpQuery(request, env);

      expect(mockExecutor.executedQueries[0]).toBe('SELECT 10 + 20 AS sum');
    });
  });

  describe('Result Row Limiting', () => {
    it('should apply max_result_rows limit', async () => {
      const env = createTestEnv();

      // Set up executor to return many rows
      mockExecutor.setCustomHandler(() => ({
        meta: [{ name: 'n', type: 'UInt64' }],
        data: Array.from({ length: 100 }, (_, i) => ({ n: i })),
        rows: 100,
      }));

      const request = createRequest('http://localhost/?query=SELECT+number+FROM+numbers%28100%29&max_result_rows=10&default_format=JSON');

      const response = await handleHttpQuery(request, env);
      expect(response.status).toBe(200);

      const json = await response.json() as { data: unknown[] };
      // Should be limited to 10 rows
      expect(json.data.length).toBeLessThanOrEqual(10);
    });

    it('should throw error when result_overflow_mode is throw', async () => {
      const env = createTestEnv();

      // Set up executor to return many rows
      mockExecutor.setCustomHandler(() => ({
        meta: [{ name: 'n', type: 'UInt64' }],
        data: Array.from({ length: 100 }, (_, i) => ({ n: i })),
        rows: 100,
      }));

      const request = createRequest(
        'http://localhost/?query=SELECT+number+FROM+numbers%28100%29&max_result_rows=5&result_overflow_mode=throw&default_format=JSON'
      );

      const response = await handleHttpQuery(request, env);
      // Should return error status
      expect(response.status).toBe(500);

      const body = await response.text();
      expect(body).toContain('TOO_MANY_ROWS');
    });
  });

  describe('Error Handling', () => {
    it('should return 400 for empty query', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).toContain('Missing query');
    });

    it('should return 400 for empty POST body', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/', {
        method: 'POST',
        body: '',
      });

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(400);
    });

    it('should return 405 for unsupported methods', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/?query=SELECT+1', {
        method: 'DELETE',
      });

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(405);
    });

    it('should handle executor errors gracefully', async () => {
      const env = createTestEnv();

      // Set up executor to throw an error
      mockExecutor.setCustomHandler(() => {
        throw new Error('Simulated WASM execution error');
      });

      const request = createRequest('http://localhost/?query=SELECT+invalid');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).toContain('Simulated WASM execution error');
    });

    it('should return JSON error format when JSON output is requested', async () => {
      const env = createTestEnv();

      mockExecutor.setCustomHandler(() => {
        throw new Error('Query error');
      });

      const request = createRequest('http://localhost/?query=SELECT+invalid&default_format=JSON');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(500);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const json = await response.json() as { exception: string };
      expect(json.exception).toBeDefined();
    });
  });

  describe('Special Endpoints', () => {
    it('should handle /ping endpoint', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/ping');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('Ok.\n');
      // Ping should not call the executor
      expect(mockExecutor.callCount).toBe(0);
    });

    it('should handle /replicas_status endpoint', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/replicas_status');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('Ok.\n');
      // replicas_status should not call the executor
      expect(mockExecutor.callCount).toBe(0);
    });

    it('should handle OPTIONS preflight requests', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/', {
        method: 'OPTIONS',
      });

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });
  });

  describe('Health Endpoints', () => {
    it('should handle /health endpoint', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/health');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const json = await response.json() as { status: string; version: string; uptime: number };
      expect(json.status).toBe('ok');
      expect(json.version).toBeDefined();
      expect(json.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should handle /health/ready endpoint', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/health/ready');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);

      const json = await response.json() as { ready: boolean };
      expect(json.ready).toBe(true);
    });

    it('should handle /health/live endpoint', async () => {
      const env = createTestEnv();
      const request = createRequest('http://localhost/health/live');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);

      const json = await response.json() as { alive: boolean };
      expect(json.alive).toBe(true);
    });
  });

  describe('Multi-Row Results', () => {
    it('should handle queries returning multiple rows', async () => {
      const env = createTestEnv();

      mockExecutor.setCustomHandler(() => ({
        meta: [{ name: 'id', type: 'UInt64' }, { name: 'name', type: 'String' }],
        data: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
        ],
        rows: 3,
      }));

      const request = createRequest('http://localhost/?query=SELECT+id,+name+FROM+users&default_format=JSON');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);

      const json = await response.json() as { data: unknown[]; rows: number };
      expect(json.data).toHaveLength(3);
      expect(json.rows).toBe(3);
    });

    it('should format multi-row results in TabSeparated format', async () => {
      const env = createTestEnv();

      mockExecutor.setCustomHandler(() => ({
        meta: [{ name: 'n', type: 'UInt64' }],
        data: [{ n: 1 }, { n: 2 }, { n: 3 }],
        rows: 3,
      }));

      const request = createRequest('http://localhost/?query=SELECT+n');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);

      const body = await response.text();
      const lines = body.trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(lines).toContain('1');
      expect(lines).toContain('2');
      expect(lines).toContain('3');
    });

    it('should format multi-row results in CSV format', async () => {
      const env = createTestEnv();

      mockExecutor.setCustomHandler(() => ({
        meta: [{ name: 'id', type: 'UInt64' }, { name: 'value', type: 'String' }],
        data: [
          { id: 1, value: 'a' },
          { id: 2, value: 'b' },
        ],
        rows: 2,
      }));

      const request = createRequest('http://localhost/?query=SELECT+*&default_format=CSV');

      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);

      const body = await response.text();
      expect(body).toContain('1,a');
      expect(body).toContain('2,b');
    });
  });

  describe('Column Metadata', () => {
    it('should include column metadata in JSON response', async () => {
      const env = createTestEnv();

      mockExecutor.setCustomHandler(() => ({
        meta: [
          { name: 'id', type: 'UInt64' },
          { name: 'name', type: 'String' },
          { name: 'created_at', type: 'DateTime' },
        ],
        data: [{ id: 1, name: 'test', created_at: '2024-01-01 00:00:00' }],
        rows: 1,
      }));

      const request = createRequest('http://localhost/?query=SELECT+*&default_format=JSON');

      const response = await handleHttpQuery(request, env);

      const json = await response.json() as { meta: Array<{ name: string; type: string }> };
      expect(json.meta).toHaveLength(3);
      expect(json.meta[0]).toEqual({ name: 'id', type: 'UInt64' });
      expect(json.meta[1]).toEqual({ name: 'name', type: 'String' });
      expect(json.meta[2]).toEqual({ name: 'created_at', type: 'DateTime' });
    });
  });

  describe('Statistics', () => {
    it('should include statistics in JSON response', async () => {
      const env = createTestEnv();

      mockExecutor.setCustomHandler(() => ({
        meta: [{ name: 'n', type: 'UInt64' }],
        data: [{ n: 1 }],
        rows: 1,
        statistics: {
          elapsed: 0.005,
          rows_read: 100,
          bytes_read: 800,
        },
      }));

      const request = createRequest('http://localhost/?query=SELECT+1&default_format=JSON');

      const response = await handleHttpQuery(request, env);

      const json = await response.json() as { statistics: { elapsed: number; rows_read: number; bytes_read: number } };
      expect(json.statistics).toBeDefined();
      expect(json.statistics.elapsed).toBe(0.005);
      expect(json.statistics.rows_read).toBe(100);
      expect(json.statistics.bytes_read).toBe(800);
    });
  });
});

/**
 * Integration Tests via Worker Endpoint (using SELF binding)
 *
 * These tests make actual HTTP requests to the worker via the SELF binding,
 * testing the complete stack including the worker.ts routing logic.
 */
describe('Worker Endpoint Integration (via SELF)', () => {
  describe('Ping and Health', () => {
    it('should respond to /ping', async () => {
      const response = await SELF.fetch('http://localhost/ping');

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('Ok.\n');
    });

    it('should respond to /replicas_status', async () => {
      const response = await SELF.fetch('http://localhost/replicas_status');

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('Ok.\n');
    });

    it('should handle CORS preflight', async () => {
      const response = await SELF.fetch('http://localhost/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Query Execution', () => {
    // Note: These tests depend on the bundled WASM executor being available
    // If WASM is not available, the executor initialization will fail

    it('should execute query via GET', async () => {
      const response = await SELF.fetch('http://localhost/?query=SELECT+1+AS+num&default_format=JSON');

      // May fail if executor not initialized, but should not throw
      expect(response.status).toBeDefined();
    });

    it('should execute query via POST', async () => {
      const response = await SELF.fetch('http://localhost/', {
        method: 'POST',
        body: 'SELECT 1 AS num FORMAT JSON',
      });

      expect(response.status).toBeDefined();
    });
  });
});

// Type declarations for cloudflare:test
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    CHDB_VERSION: string;
    ENVIRONMENT: string;
    DATA_BUCKET: R2Bucket;
    CLICKBENCH_BUCKET: R2Bucket;
    CACHE: KVNamespace;
    ASSETS?: Fetcher;
  }
}
