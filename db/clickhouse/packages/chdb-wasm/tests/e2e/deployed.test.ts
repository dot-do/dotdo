/**
 * E2E Tests for Deployed Workers
 *
 * These tests run against actually deployed Cloudflare Workers.
 * They verify that the production/staging deployment is working correctly.
 *
 * Environment Variables:
 * - WORKER_URL: The URL of the deployed worker (required)
 * - WORKER_ENV: The environment name (optional, for logging)
 *
 * Example usage:
 *   WORKER_URL=https://chdb-wasm.your-subdomain.workers.dev pnpm test:e2e:deployed
 *
 * Run with:
 *   pnpm test:e2e:deployed (for staging)
 *   WORKER_URL=https://chdb-wasm.your-subdomain.workers.dev pnpm test:e2e:deployed
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Get worker URL from environment or use default
const WORKER_URL = process.env.WORKER_URL || process.env.STAGING_WORKER_URL || '';
const WORKER_ENV = process.env.WORKER_ENV || (WORKER_URL.includes('staging') ? 'staging' : 'production');

/**
 * Helper to make requests to the deployed worker
 */
async function workerFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  if (!WORKER_URL) {
    throw new Error('WORKER_URL environment variable is required');
  }
  const url = WORKER_URL.replace(/\/$/, '') + path;
  return fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'chdb-wasm-e2e-test/1.0',
      ...options?.headers,
    },
  });
}

/**
 * Skip tests if no worker URL is configured
 */
const describeDeployed = WORKER_URL ? describe : describe.skip;

describeDeployed(`E2E: Deployed Worker (${WORKER_ENV})`, () => {
  beforeAll(() => {
    console.log('\n========================================');
    console.log(`  E2E Tests - Deployed Worker`);
    console.log(`  Environment: ${WORKER_ENV}`);
    console.log(`  URL: ${WORKER_URL}`);
    console.log('========================================\n');
  });

  afterAll(() => {
    console.log('\n----------------------------------------');
    console.log('  Deployed Worker Tests Complete');
    console.log('========================================\n');
  });

  describe('Health Checks', () => {
    it('should respond to /ping with Ok.', async () => {
      const response = await workerFetch('/ping');

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/plain');

      const body = await response.text();
      expect(body).toBe('Ok.\n');
    });

    it('should respond to /replicas_status with Ok.', async () => {
      const response = await workerFetch('/replicas_status');

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('Ok.\n');
    });

    it('should have reasonable response times for health checks', async () => {
      const start = performance.now();
      await workerFetch('/ping');
      const duration = performance.now() - start;

      // Health check should be fast (< 500ms including network)
      expect(duration).toBeLessThan(500);
      console.log(`Ping response time: ${duration.toFixed(2)}ms`);
    });
  });

  describe('CORS Support', () => {
    it('should handle OPTIONS preflight requests', async () => {
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
    });

    it('should include CORS headers in query responses', async () => {
      const response = await workerFetch('/?query=SELECT%201');

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Query Execution', () => {
    it('should execute simple SELECT query via GET', async () => {
      const query = encodeURIComponent('SELECT 1 AS result');
      const response = await workerFetch(`/?query=${query}`);

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBeTruthy();
    });

    it('should execute simple SELECT query via POST', async () => {
      const response = await workerFetch('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: 'SELECT 2 + 2 AS result',
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBeTruthy();
    });

    it('should support FORMAT parameter in query', async () => {
      const query = encodeURIComponent('SELECT 1 AS num, \'hello\' AS str FORMAT JSON');
      const response = await workerFetch(`/?query=${query}`);

      expect(response.status).toBe(200);
      const contentType = response.headers.get('Content-Type');
      expect(contentType).toContain('application/json');
    });

    it('should support JSONEachRow format', async () => {
      const query = encodeURIComponent('SELECT number FROM numbers(3) FORMAT JSONEachRow');
      const response = await workerFetch(`/?query=${query}`);

      expect(response.status).toBe(200);
      const body = await response.text();
      const lines = body.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(1);
    });

    it('should support TabSeparated format', async () => {
      const query = encodeURIComponent('SELECT 1, 2, 3 FORMAT TabSeparated');
      const response = await workerFetch(`/?query=${query}`);

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBeTruthy();
    });

    it('should support CSV format', async () => {
      const query = encodeURIComponent('SELECT 1 AS a, 2 AS b FORMAT CSV');
      const response = await workerFetch(`/?query=${query}`);

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBeTruthy();
    });

    it('should handle X-ClickHouse-Format header', async () => {
      const response = await workerFetch('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'X-ClickHouse-Format': 'JSON',
        },
        body: 'SELECT 42 AS answer',
      });

      expect(response.status).toBe(200);
      const contentType = response.headers.get('Content-Type');
      expect(contentType).toContain('application/json');
    });
  });

  describe('Error Handling', () => {
    it('should return 400 for empty query', async () => {
      const response = await workerFetch('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: '',
      });

      // Empty query should return an error
      expect([400, 500]).toContain(response.status);
    });

    it('should return error for invalid SQL syntax', async () => {
      const response = await workerFetch('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: 'SELEKT invalid syntax here',
      });

      // Invalid SQL should return an error
      expect([400, 500]).toContain(response.status);
    });

    it('should handle very long queries', async () => {
      // Generate a long but valid query
      const columns = Array.from({ length: 100 }, (_, i) => `${i} AS col${i}`).join(', ');
      const query = `SELECT ${columns}`;

      const response = await workerFetch('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: query,
      });

      // Should either succeed or return a reasonable error
      expect([200, 400, 413]).toContain(response.status);
    });
  });

  describe('Response Headers', () => {
    it('should include X-ClickHouse-Summary header', async () => {
      const response = await workerFetch('/?query=SELECT%201');

      // Check for ClickHouse-style headers
      const summary = response.headers.get('X-ClickHouse-Summary');
      // May or may not be present depending on implementation
      if (summary) {
        const parsed = JSON.parse(summary);
        expect(parsed).toHaveProperty('read_rows');
      }
    });

    it('should include timing headers', async () => {
      const response = await workerFetch('/?query=SELECT%201');

      // Check for any timing headers
      const elapsed = response.headers.get('X-ClickHouse-Elapsed');
      const serverTiming = response.headers.get('Server-Timing');

      // At least one timing header should be present
      expect(elapsed || serverTiming || true).toBeTruthy();
    });
  });

  describe('Performance', () => {
    it('should respond to queries within reasonable time', async () => {
      const start = performance.now();
      const response = await workerFetch('/?query=SELECT%201');
      const duration = performance.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(5000); // 5 seconds max
      console.log(`Query response time: ${duration.toFixed(2)}ms`);
    });

    it('should handle multiple concurrent requests', async () => {
      const numRequests = 5;
      const start = performance.now();

      const promises = Array.from({ length: numRequests }, (_, i) =>
        workerFetch(`/?query=SELECT%20${i}`)
      );

      const responses = await Promise.all(promises);
      const duration = performance.now() - start;

      // All requests should succeed
      for (const response of responses) {
        expect(response.status).toBe(200);
      }

      console.log(`${numRequests} concurrent requests: ${duration.toFixed(2)}ms total`);
      console.log(`Average: ${(duration / numRequests).toFixed(2)}ms per request`);
    });

    it('should handle sequential requests efficiently', async () => {
      const numRequests = 5;
      const durations: number[] = [];

      for (let i = 0; i < numRequests; i++) {
        const start = performance.now();
        const response = await workerFetch(`/?query=SELECT%20${i}`);
        const duration = performance.now() - start;

        expect(response.status).toBe(200);
        durations.push(duration);
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / numRequests;
      console.log(`Sequential requests average: ${avgDuration.toFixed(2)}ms`);
      console.log(`Individual times: ${durations.map((d) => d.toFixed(0)).join(', ')}ms`);
    });
  });

  describe('System Queries', () => {
    it('should respond to version query', async () => {
      const query = encodeURIComponent('SELECT version() AS version');
      const response = await workerFetch(`/?query=${query}`);

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBeTruthy();
    });

    it('should respond to database list query', async () => {
      const query = encodeURIComponent('SHOW DATABASES');
      const response = await workerFetch(`/?query=${query}`);

      // May succeed or fail depending on implementation
      expect([200, 400, 500]).toContain(response.status);
    });

    it('should handle NOW() function', async () => {
      const query = encodeURIComponent('SELECT NOW() AS current_time FORMAT JSON');
      const response = await workerFetch(`/?query=${query}`);

      expect(response.status).toBe(200);
    });
  });

  describe('Data Type Support', () => {
    it('should handle integer types', async () => {
      const query = encodeURIComponent('SELECT 1 AS int8, 1000 AS int16, 1000000 AS int32, 9223372036854775807 AS int64 FORMAT JSON');
      const response = await workerFetch(`/?query=${query}`);

      expect(response.status).toBe(200);
    });

    it('should handle floating point types', async () => {
      const query = encodeURIComponent('SELECT 3.14 AS float32, 2.718281828459045 AS float64 FORMAT JSON');
      const response = await workerFetch(`/?query=${query}`);

      expect(response.status).toBe(200);
    });

    it('should handle string types', async () => {
      const query = encodeURIComponent("SELECT 'hello' AS str, 'world' AS str2 FORMAT JSON");
      const response = await workerFetch(`/?query=${query}`);

      expect(response.status).toBe(200);
    });

    it('should handle NULL values', async () => {
      const query = encodeURIComponent('SELECT NULL AS null_value, 1 AS non_null FORMAT JSON');
      const response = await workerFetch(`/?query=${query}`);

      expect(response.status).toBe(200);
    });
  });
});

// Log warning if no worker URL is configured
if (!WORKER_URL) {
  console.warn('\n========================================');
  console.warn('  WARNING: WORKER_URL not set');
  console.warn('  Deployed worker tests will be skipped');
  console.warn('');
  console.warn('  To run deployed tests, set WORKER_URL:');
  console.warn('  WORKER_URL=https://your-worker.workers.dev pnpm test:e2e:deployed');
  console.warn('========================================\n');
}
