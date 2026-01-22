/**
 * E2E HTTP Interface Tests
 *
 * Tests the full HTTP interface of the chDB WASM Worker by:
 * - Spinning up a local worker using wrangler unstable_dev
 * - Making actual HTTP requests
 * - Verifying the complete request/response cycle
 *
 * These tests cover:
 * - GET/POST query execution
 * - Different output formats (JSON, CSV, TSV, JSONEachRow)
 * - Error handling
 * - CORS headers
 * - Ping endpoint
 * - Play UI
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getWorkerUrl } from './setup';

/**
 * Helper to make requests to the worker
 */
async function workerFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const url = getWorkerUrl() + path;
  return fetch(url, options);
}

describe('E2E: HTTP Interface', () => {
  let baseUrl: string;

  beforeAll(() => {
    baseUrl = getWorkerUrl();
    console.log(`Running E2E tests against: ${baseUrl}`);
  });

  describe('Ping Endpoint', () => {
    it('should respond to GET /ping with Ok.', async () => {
      const response = await workerFetch('/ping');

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/plain');

      const body = await response.text();
      expect(body).toBe('Ok.\n');
    });

    it('should respond to POST /ping with Ok.', async () => {
      const response = await workerFetch('/ping', { method: 'POST' });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('Ok.\n');
    });

    it('should include CORS headers on /ping', async () => {
      const response = await workerFetch('/ping');

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Replicas Status Endpoint', () => {
    it('should respond to GET /replicas_status with Ok.', async () => {
      const response = await workerFetch('/replicas_status');

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('Ok.\n');
    });
  });

  describe('CORS Preflight', () => {
    it('should handle OPTIONS requests for CORS preflight', async () => {
      const response = await workerFetch('/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should include X-ClickHouse-Format in allowed headers', async () => {
      const response = await workerFetch('/', {
        method: 'OPTIONS',
      });

      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-ClickHouse-Format');
    });
  });

  describe('GET Query Execution', () => {
    it('should execute simple SELECT 1 query', async () => {
      const response = await workerFetch('/?query=SELECT+1');

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('1\n');
    });

    it('should execute SELECT with arithmetic', async () => {
      const response = await workerFetch('/?query=SELECT+1+%2B+1');

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('2\n');
    });

    it('should handle SELECT with multiple columns', async () => {
      const response = await workerFetch('/?query=SELECT+1+as+a,+2+as+b,+3+as+c');

      expect(response.status).toBe(200);
      const body = await response.text();
      // TabSeparated format: values separated by tabs
      expect(body).toBe('1\t2\t3\n');
    });

    it('should include CORS headers in response', async () => {
      const response = await workerFetch('/?query=SELECT+1');

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should include X-ClickHouse-Query-Id header', async () => {
      const response = await workerFetch('/?query=SELECT+1');

      expect(response.headers.get('X-ClickHouse-Query-Id')).toBeTruthy();
    });
  });

  describe('POST Query Execution', () => {
    it('should execute query from POST body', async () => {
      const response = await workerFetch('/', {
        method: 'POST',
        body: 'SELECT 1',
        headers: {
          'Content-Type': 'text/plain',
        },
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('1\n');
    });

    it('should handle POST with application/x-www-form-urlencoded', async () => {
      const response = await workerFetch('/', {
        method: 'POST',
        body: 'SELECT 42',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('42\n');
    });

    it('should execute query from URL when POST body is empty', async () => {
      const response = await workerFetch('/?query=SELECT+100', {
        method: 'POST',
        body: '',
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('100\n');
    });

    it('should handle multiline queries', async () => {
      const query = `
        SELECT
          1 as a,
          2 as b
      `;
      const response = await workerFetch('/', {
        method: 'POST',
        body: query,
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('1\t2\n');
    });
  });

  describe('JSON Output Format', () => {
    it('should return JSON when default_format=JSON', async () => {
      const response = await workerFetch('/?query=SELECT+1+as+num&default_format=JSON');

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const result = await response.json();
      expect(result).toHaveProperty('meta');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('rows');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].num).toBe(1);
    });

    it('should include statistics in JSON response', async () => {
      const response = await workerFetch('/?query=SELECT+1&default_format=JSON');

      const result = await response.json();
      expect(result).toHaveProperty('statistics');
      expect(result.statistics).toHaveProperty('elapsed');
      expect(result.statistics).toHaveProperty('rows_read');
    });

    it('should return JSON when X-ClickHouse-Format header is JSON', async () => {
      const response = await workerFetch('/?query=SELECT+1+as+val', {
        headers: {
          'X-ClickHouse-Format': 'JSON',
        },
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.data[0].val).toBe(1);
    });

    it('should return JSON when FORMAT JSON is in query', async () => {
      const response = await workerFetch('/', {
        method: 'POST',
        body: 'SELECT 1 as x FORMAT JSON',
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.data[0].x).toBe(1);
    });

    it('should set X-ClickHouse-Format header to JSON', async () => {
      const response = await workerFetch('/?query=SELECT+1&default_format=JSON');

      expect(response.headers.get('X-ClickHouse-Format')).toBe('JSON');
    });
  });

  describe('JSONCompact Output Format', () => {
    it('should return JSONCompact format', async () => {
      const response = await workerFetch('/?query=SELECT+1+as+a,+2+as+b&default_format=JSONCompact');

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result).toHaveProperty('meta');
      expect(result).toHaveProperty('data');
      // JSONCompact uses arrays instead of objects
      expect(Array.isArray(result.data[0])).toBe(true);
      expect(result.data[0]).toEqual([1, 2]);
    });
  });

  describe('JSONEachRow Output Format', () => {
    it('should return JSONEachRow format (NDJSON)', async () => {
      const response = await workerFetch('/?query=SELECT+1+as+num&default_format=JSONEachRow');

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');

      const body = await response.text();
      expect(body).toBe('{"num":1}\n');
    });

    it('should return multiple JSON lines for multiple rows', async () => {
      const response = await workerFetch('/?query=SELECT+number+FROM+numbers(3)&default_format=JSONEachRow');

      expect(response.status).toBe(200);
      const body = await response.text();

      const lines = body.trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0])).toEqual({ number: 0 });
      expect(JSON.parse(lines[1])).toEqual({ number: 1 });
      expect(JSON.parse(lines[2])).toEqual({ number: 2 });
    });
  });

  describe('CSV Output Format', () => {
    it('should return CSV format', async () => {
      const response = await workerFetch('/?query=SELECT+1+as+a,+2+as+b&default_format=CSV');

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/csv');

      const body = await response.text();
      expect(body.trim()).toBe('1,2');
    });

    it('should return CSVWithNames format', async () => {
      const response = await workerFetch('/?query=SELECT+1+as+a,+2+as+b&default_format=CSVWithNames');

      expect(response.status).toBe(200);
      const body = await response.text();

      const lines = body.trim().split('\n');
      expect(lines).toHaveLength(2);
      // Header row with quoted column names
      expect(lines[0]).toContain('a');
      expect(lines[0]).toContain('b');
      // Data row
      expect(lines[1]).toBe('1,2');
    });
  });

  describe('TSV Output Format', () => {
    it('should return TabSeparated format by default', async () => {
      const response = await workerFetch('/?query=SELECT+1+as+x,+2+as+y');

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/tab-separated-values');

      const body = await response.text();
      expect(body).toBe('1\t2\n');
    });

    it('should return TabSeparated when explicitly requested', async () => {
      const response = await workerFetch('/?query=SELECT+1,+2,+3&default_format=TabSeparated');

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('1\t2\t3\n');
    });

    it('should return TabSeparatedWithNames format', async () => {
      const response = await workerFetch('/?query=SELECT+1+as+col1&default_format=TabSeparatedWithNames');

      expect(response.status).toBe(200);
      const body = await response.text();

      const lines = body.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines[0]).toBe('col1');
      expect(lines[1]).toBe('1');
    });
  });

  describe('Error Handling', () => {
    it('should return 400 for missing query', async () => {
      const response = await workerFetch('/');

      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body.toLowerCase()).toContain('query');
    });

    it('should return 400 for empty query', async () => {
      const response = await workerFetch('/?query=');

      expect(response.status).toBe(400);
    });

    it('should return 400 for empty POST body without query param', async () => {
      const response = await workerFetch('/', {
        method: 'POST',
        body: '',
      });

      expect(response.status).toBe(400);
    });

    it('should return error for SQL syntax errors', async () => {
      const response = await workerFetch('/?query=SELEC+1'); // typo

      // Syntax errors typically return 400 or 500
      expect([400, 500]).toContain(response.status);
      const body = await response.text();
      expect(body.toLowerCase()).toMatch(/syntax|parse|unexpected/);
    });

    it('should return 404 for unknown table', async () => {
      const response = await workerFetch('/?query=SELECT+*+FROM+nonexistent_table_xyz');

      expect([404, 500]).toContain(response.status);
      const body = await response.text();
      expect(body.toLowerCase()).toMatch(/unknown|not.*exist|table/);
    });

    it('should return 405 for unsupported HTTP methods', async () => {
      const response = await workerFetch('/?query=SELECT+1', {
        method: 'DELETE',
      });

      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBeTruthy();
    });

    it('should include CORS headers on error responses', async () => {
      const response = await workerFetch('/?query=INVALID_SQL_STATEMENT');

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Query Parameters', () => {
    it('should accept query_id parameter', async () => {
      const queryId = 'test-query-' + Date.now();
      const response = await workerFetch(`/?query=SELECT+1&query_id=${queryId}`);

      expect(response.status).toBe(200);
      expect(response.headers.get('X-ClickHouse-Query-Id')).toBe(queryId);
    });

    it('should accept database parameter', async () => {
      const response = await workerFetch('/?query=SELECT+1&database=default');

      expect(response.status).toBe(200);
    });

    it('should accept user parameter', async () => {
      const response = await workerFetch('/?query=SELECT+1&user=default');

      expect(response.status).toBe(200);
    });
  });

  describe('Response Headers', () => {
    it('should include X-ClickHouse-Server-Display-Name header', async () => {
      const response = await workerFetch('/?query=SELECT+1');

      expect(response.headers.get('X-ClickHouse-Server-Display-Name')).toBeTruthy();
    });

    it('should include X-ClickHouse-Summary header', async () => {
      const response = await workerFetch('/?query=SELECT+1');

      const summary = response.headers.get('X-ClickHouse-Summary');
      expect(summary).toBeTruthy();

      const summaryObj = JSON.parse(summary!);
      expect(summaryObj).toHaveProperty('read_rows');
      expect(summaryObj).toHaveProperty('read_bytes');
    });

    it('should set correct Content-Type for TabSeparated', async () => {
      const response = await workerFetch('/?query=SELECT+1&default_format=TabSeparated');

      expect(response.headers.get('Content-Type')).toContain('text/tab-separated-values');
    });

    it('should set correct Content-Type for CSV', async () => {
      const response = await workerFetch('/?query=SELECT+1&default_format=CSV');

      expect(response.headers.get('Content-Type')).toContain('text/csv');
    });

    it('should set correct Content-Type for JSON', async () => {
      const response = await workerFetch('/?query=SELECT+1&default_format=JSON');

      expect(response.headers.get('Content-Type')).toContain('application/json');
    });
  });

  describe('Play UI', () => {
    it('should serve Play UI at /play', async () => {
      const response = await workerFetch('/play');

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/html');
    });

    it('should have proper HTML structure', async () => {
      const response = await workerFetch('/play');
      const html = await response.text();

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('<head>');
      expect(html).toContain('<body>');
    });

    it('should contain query editor element', async () => {
      const response = await workerFetch('/play');
      const html = await response.text();

      expect(html).toContain('id="query-editor"');
    });

    it('should contain run button', async () => {
      const response = await workerFetch('/play');
      const html = await response.text();

      expect(html).toContain('id="run-button"');
    });

    it('should contain results area', async () => {
      const response = await workerFetch('/play');
      const html = await response.text();

      expect(html).toContain('id="results"');
    });

    it('should include title referencing chDB', async () => {
      const response = await workerFetch('/play');
      const html = await response.text();

      expect(html.toLowerCase()).toMatch(/<title>.*chdb.*<\/title>/i);
    });

    it('should accept query parameter for pre-populated query', async () => {
      const response = await workerFetch('/play?query=SELECT+42');

      expect(response.status).toBe(200);
    });

    it('should include escapeHtml function for XSS protection', async () => {
      const response = await workerFetch('/play');
      const html = await response.text();

      expect(html).toContain('function escapeHtml');
    });
  });

  describe('URL Encoding', () => {
    it('should handle URL-encoded queries', async () => {
      // SELECT 'hello world' encoded
      const response = await workerFetch('/?query=SELECT+%27hello+world%27');

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('hello world\n');
    });

    it('should handle special characters in queries', async () => {
      // SELECT 1 + 1 with + encoded as %2B
      const response = await workerFetch('/?query=SELECT+1+%2B+1');

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('2\n');
    });
  });

  describe('numbers() Table Function', () => {
    it('should support numbers(n) table function', async () => {
      const response = await workerFetch('/?query=SELECT+number+FROM+numbers(5)&default_format=JSON');

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result.data).toHaveLength(5);
      expect(result.data.map((r: { number: number }) => r.number)).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('Aggregate Functions', () => {
    it('should support COUNT function', async () => {
      const response = await workerFetch('/?query=SELECT+COUNT(*)+as+cnt+FROM+numbers(10)&default_format=JSON');

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.data[0].cnt).toBe(10);
    });

    it('should support SUM function', async () => {
      const response = await workerFetch('/?query=SELECT+SUM(number)+as+total+FROM+numbers(5)&default_format=JSON');

      expect(response.status).toBe(200);
      const result = await response.json();
      // 0 + 1 + 2 + 3 + 4 = 10
      expect(result.data[0].total).toBe(10);
    });
  });
});
