/**
 * E2E Tests for Deployed Cloudflare Worker
 *
 * IMPORTANT: These tests REQUIRE a deployed worker URL.
 * They will FAIL immediately if WORKER_URL environment variable is not set.
 *
 * This is intentional for TDD - tests should fail in CI until:
 * 1. A staging worker is deployed
 * 2. WORKER_URL is configured in CI environment
 *
 * Usage:
 *   WORKER_URL=https://your-worker.workers.dev pnpm test:e2e:deployed
 *
 * These tests make REAL HTTP requests to the deployed worker.
 * They do NOT use miniflare or any local simulation.
 */
import { describe, it, expect, beforeAll } from 'vitest';

// STRICT REQUIREMENT: WORKER_URL must be set
const WORKER_URL = process.env.WORKER_URL;

/**
 * Fail immediately if WORKER_URL is not set.
 * This is the TDD RED phase - tests must fail without proper configuration.
 */
if (!WORKER_URL) {
  describe('E2E: Deployed Worker', () => {
    it('REQUIRES WORKER_URL environment variable to be set', () => {
      throw new Error(
        'WORKER_URL environment variable is required.\n\n' +
          'To run these tests, set WORKER_URL to your deployed worker:\n' +
          '  WORKER_URL=https://your-worker.workers.dev pnpm test:e2e:deployed-worker\n\n' +
          'This test suite requires a REAL deployed Cloudflare Worker.\n' +
          'It does NOT use miniflare or local simulation.'
      );
    });
  });
} else {
  /**
   * Helper to make HTTP requests to the deployed worker
   */
  async function workerFetch(
    path: string,
    options?: RequestInit
  ): Promise<Response> {
    const url = WORKER_URL!.replace(/\/$/, '') + path;
    return fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'chdb-wasm-e2e-deployed-test/1.0',
        ...options?.headers,
      },
    });
  }

  describe('E2E: Deployed Worker', () => {
    beforeAll(() => {
      console.log('\n========================================');
      console.log('  E2E Tests - Deployed Worker');
      console.log(`  URL: ${WORKER_URL}`);
      console.log('========================================\n');
    });

    describe('Health Endpoints', () => {
      it('GET /ping should return "Ok."', async () => {
        const response = await workerFetch('/ping');

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('text/plain');

        const body = await response.text();
        expect(body).toBe('Ok.\n');
      });

      it('GET /replicas_status should return "Ok."', async () => {
        const response = await workerFetch('/replicas_status');

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body).toBe('Ok.\n');
      });

      it('/ping should respond within 1 second', async () => {
        const start = performance.now();
        const response = await workerFetch('/ping');
        const duration = performance.now() - start;

        expect(response.status).toBe(200);
        expect(duration).toBeLessThan(1000);
        console.log(`  /ping response time: ${duration.toFixed(2)}ms`);
      });
    });

    describe('Basic SQL Query: SELECT 1', () => {
      it('GET /?query=SELECT+1 should return "1"', async () => {
        const response = await workerFetch('/?query=SELECT+1');

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body.trim()).toBe('1');
      });

      it('POST / with body "SELECT 1" should return "1"', async () => {
        const response = await workerFetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
          },
          body: 'SELECT 1',
        });

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body.trim()).toBe('1');
      });

      it('SELECT 1 should return correct JSON format', async () => {
        const response = await workerFetch('/?query=SELECT+1+AS+result&default_format=JSON');

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('application/json');

        const result = await response.json();
        expect(result).toHaveProperty('meta');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('rows');
        expect(result.data).toHaveLength(1);
        expect(result.data[0].result).toBe(1);
      });
    });

    describe('SELECT with Data', () => {
      it('should execute arithmetic expressions', async () => {
        const response = await workerFetch('/?query=SELECT+2+%2B+2+AS+result&default_format=JSON');

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.data[0].result).toBe(4);
      });

      it('should handle multiple columns', async () => {
        const response = await workerFetch(
          '/?query=SELECT+1+AS+a,+2+AS+b,+3+AS+c&default_format=JSON'
        );

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.data[0]).toEqual({ a: 1, b: 2, c: 3 });
      });

      it('should handle string values', async () => {
        const response = await workerFetch(
          "/?query=SELECT+'hello'+AS+greeting&default_format=JSON"
        );

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.data[0].greeting).toBe('hello');
      });

      it('should handle numbers() table function', async () => {
        const response = await workerFetch(
          '/?query=SELECT+number+FROM+numbers(5)&default_format=JSON'
        );

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.data).toHaveLength(5);
        expect(result.data.map((r: { number: number }) => r.number)).toEqual([0, 1, 2, 3, 4]);
      });

      it('should handle aggregate functions', async () => {
        const response = await workerFetch(
          '/?query=SELECT+COUNT(*)+AS+cnt,+SUM(number)+AS+total+FROM+numbers(10)&default_format=JSON'
        );

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.data[0].cnt).toBe(10);
        expect(result.data[0].total).toBe(45); // 0+1+2+...+9 = 45
      });

      it('should handle NULL values', async () => {
        const response = await workerFetch(
          '/?query=SELECT+NULL+AS+null_val,+1+AS+one&default_format=JSON'
        );

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.data[0].null_val).toBeNull();
        expect(result.data[0].one).toBe(1);
      });
    });

    describe('Error Handling', () => {
      it('should return error for invalid SQL syntax', async () => {
        const response = await workerFetch('/?query=SELEKT+invalid+syntax');

        // Expect 400 or 500 for syntax errors
        expect([400, 500]).toContain(response.status);
        const body = await response.text();
        expect(body.toLowerCase()).toMatch(/syntax|parse|unexpected|error/);
      });

      it('should return error for empty query', async () => {
        const response = await workerFetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
          },
          body: '',
        });

        // Empty query should return error
        expect([400, 500]).toContain(response.status);
      });

      it('should return error for unknown table', async () => {
        const response = await workerFetch('/?query=SELECT+*+FROM+nonexistent_table_xyz123');

        // Unknown table should return error
        expect([400, 404, 500]).toContain(response.status);
        const body = await response.text();
        expect(body.toLowerCase()).toMatch(/unknown|not.*exist|table|error/);
      });

      it('should return 405 for unsupported HTTP methods', async () => {
        const response = await workerFetch('/?query=SELECT+1', {
          method: 'DELETE',
        });

        expect(response.status).toBe(405);
      });
    });

    describe('Response Headers', () => {
      it('should include Content-Type header', async () => {
        const response = await workerFetch('/?query=SELECT+1');

        expect(response.headers.get('Content-Type')).toBeTruthy();
      });

      it('should return correct Content-Type for JSON format', async () => {
        const response = await workerFetch('/?query=SELECT+1&default_format=JSON');

        expect(response.headers.get('Content-Type')).toContain('application/json');
      });

      it('should return correct Content-Type for CSV format', async () => {
        const response = await workerFetch('/?query=SELECT+1&default_format=CSV');

        expect(response.headers.get('Content-Type')).toContain('text/csv');
      });

      it('should return correct Content-Type for TabSeparated format', async () => {
        const response = await workerFetch('/?query=SELECT+1&default_format=TabSeparated');

        expect(response.headers.get('Content-Type')).toContain('text/tab-separated-values');
      });

      it('should include X-ClickHouse-Query-Id header', async () => {
        const response = await workerFetch('/?query=SELECT+1');

        expect(response.headers.get('X-ClickHouse-Query-Id')).toBeTruthy();
      });
    });

    describe('CORS Headers', () => {
      it('should include Access-Control-Allow-Origin header', async () => {
        const response = await workerFetch('/?query=SELECT+1');

        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      });

      it('should handle OPTIONS preflight request', async () => {
        const response = await workerFetch('/', {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://example.com',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'Content-Type',
          },
        });

        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
        expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      });

      it('should include CORS headers on error responses', async () => {
        const response = await workerFetch('/?query=INVALID_SYNTAX_ERROR');

        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      });
    });

    describe('Output Formats', () => {
      it('should support JSON format', async () => {
        const response = await workerFetch('/?query=SELECT+1+AS+num&default_format=JSON');

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('data');
        expect(result.data[0].num).toBe(1);
      });

      it('should support JSONEachRow format', async () => {
        const response = await workerFetch('/?query=SELECT+number+FROM+numbers(3)&default_format=JSONEachRow');

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');

        const body = await response.text();
        const lines = body.trim().split('\n');
        expect(lines.length).toBe(3);
        expect(JSON.parse(lines[0])).toEqual({ number: 0 });
      });

      it('should support CSV format', async () => {
        const response = await workerFetch('/?query=SELECT+1,+2,+3&default_format=CSV');

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('text/csv');

        const body = await response.text();
        expect(body.trim()).toBe('1,2,3');
      });

      it('should support TabSeparated format', async () => {
        const response = await workerFetch('/?query=SELECT+1,+2,+3&default_format=TabSeparated');

        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body.trim()).toBe('1\t2\t3');
      });

      it('should support FORMAT in query string', async () => {
        const response = await workerFetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
          },
          body: 'SELECT 1 AS num FORMAT JSON',
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.data[0].num).toBe(1);
      });

      it('should support X-ClickHouse-Format header', async () => {
        const response = await workerFetch('/?query=SELECT+1+AS+val', {
          headers: {
            'X-ClickHouse-Format': 'JSON',
          },
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.data[0].val).toBe(1);
      });
    });

    describe('Performance', () => {
      it('should respond to queries within 5 seconds', async () => {
        const start = performance.now();
        const response = await workerFetch('/?query=SELECT+1');
        const duration = performance.now() - start;

        expect(response.status).toBe(200);
        expect(duration).toBeLessThan(5000);
        console.log(`  Query response time: ${duration.toFixed(2)}ms`);
      });

      it('should handle concurrent requests', async () => {
        const numRequests = 5;
        const start = performance.now();

        const promises = Array.from({ length: numRequests }, (_, i) =>
          workerFetch(`/?query=SELECT+${i}`)
        );

        const responses = await Promise.all(promises);
        const duration = performance.now() - start;

        // All requests should succeed
        for (const response of responses) {
          expect(response.status).toBe(200);
        }

        console.log(`  ${numRequests} concurrent requests: ${duration.toFixed(2)}ms total`);
        console.log(`  Average: ${(duration / numRequests).toFixed(2)}ms per request`);
      });
    });

    describe('Timeout Behavior', () => {
      it('should handle slow queries gracefully', async () => {
        // Query that simulates work but shouldn't cause timeout
        // sleepEachRow causes a small delay per row
        const response = await workerFetch(
          '/?query=SELECT+sleepEachRow(0.01)+FROM+numbers(10)&default_format=JSON'
        );

        // Should either succeed or return a timeout error gracefully
        expect([200, 408, 500, 504]).toContain(response.status);
      });

      it('should complete queries within Worker CPU time limits', async () => {
        // Cloudflare Workers have 30-50ms CPU time limit (unbound can have more)
        // This query should complete within limits
        const start = performance.now();
        const response = await workerFetch(
          '/?query=SELECT+sum(number)+FROM+numbers(10000)&default_format=JSON'
        );
        const duration = performance.now() - start;

        expect(response.status).toBe(200);
        // Network latency + processing should complete in reasonable time
        expect(duration).toBeLessThan(10000); // 10 second timeout including network
        console.log(`  CPU-bound query completed in: ${duration.toFixed(2)}ms`);
      });

      it('should respect max_execution_time setting if supported', async () => {
        // Test if max_execution_time setting is honored
        const response = await workerFetch(
          '/?query=SELECT+1&max_execution_time=30'
        );

        // Should succeed regardless of whether setting is implemented
        expect([200, 400]).toContain(response.status);
      });

      it('should handle client-side request timeout', async () => {
        // Test with AbortController timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          const response = await workerFetch('/?query=SELECT+1', {
            signal: controller.signal,
          });

          clearTimeout(timeoutId);
          expect(response.status).toBe(200);
        } catch (error: unknown) {
          clearTimeout(timeoutId);
          // AbortError is acceptable if we explicitly aborted
          if (error instanceof Error && error.name === 'AbortError') {
            // This means request took longer than 5 seconds - potential issue
            console.log('  Request was aborted due to client timeout');
          }
          throw error;
        }
      });
    });

    describe('Large Response Handling', () => {
      it('should handle moderately large result sets', async () => {
        const response = await workerFetch(
          '/?query=SELECT+number+FROM+numbers(1000)&default_format=JSON'
        );

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.data).toHaveLength(1000);
      });

      it('should stream large results with JSONEachRow', async () => {
        const response = await workerFetch(
          '/?query=SELECT+number+FROM+numbers(100)&default_format=JSONEachRow'
        );

        expect(response.status).toBe(200);
        const body = await response.text();
        const lines = body.trim().split('\n');
        expect(lines.length).toBe(100);
      });
    });

    describe('Query Parameters', () => {
      it('should support query parameter via query string', async () => {
        const response = await workerFetch('/?query=SELECT+1');
        expect(response.status).toBe(200);
      });

      it('should support query via POST body', async () => {
        const response = await workerFetch('/', {
          method: 'POST',
          body: 'SELECT 1',
        });
        expect(response.status).toBe(200);
      });

      it('should support database parameter', async () => {
        const response = await workerFetch('/?database=system&query=SELECT+1');
        expect(response.status).toBe(200);
      });

      it('should support enable_http_compression parameter', async () => {
        const response = await workerFetch(
          '/?query=SELECT+1&enable_http_compression=1',
          {
            headers: {
              'Accept-Encoding': 'gzip',
            },
          }
        );

        // Should succeed; compression may or may not be implemented
        expect([200, 400]).toContain(response.status);
      });
    });
  });
}
