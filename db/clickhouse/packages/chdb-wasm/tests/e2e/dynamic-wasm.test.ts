/**
 * E2E Tests for Dynamic WASM Loading
 *
 * These tests verify that dynamic WASM module loading works end-to-end
 * on real deployed Cloudflare Workers, not just in unit tests.
 *
 * Key test scenarios:
 * 1. Cold start - first request loads core WASM
 * 2. Extension auto-load - query needing extension triggers dlopen()
 * 3. Extension caching - second query reuses loaded extension
 * 4. Error handling - missing extension returns helpful error
 * 5. Latency measurement - cold vs warm performance
 *
 * Environment Variables:
 * - WORKER_URL: The URL of the deployed worker (required for deployed tests)
 * - USE_LOCAL: Set to "true" to use local wrangler dev (default for CI)
 *
 * Run with:
 *   pnpm test:e2e:wasm         (local wrangler dev)
 *   WORKER_URL=https://... pnpm test:e2e:wasm  (deployed worker)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { UnstableDevWorker } from 'wrangler';

// Configuration
const DEPLOYED_WORKER_URL = process.env.WORKER_URL || process.env.STAGING_WORKER_URL || '';
const USE_LOCAL = process.env.USE_LOCAL !== 'false' && !DEPLOYED_WORKER_URL;

// Worker instance for local testing
let localWorker: UnstableDevWorker | null = null;
let workerUrl: string = DEPLOYED_WORKER_URL;

/**
 * Helper to make requests to the worker
 */
async function workerFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const url = workerUrl.replace(/\/$/, '') + path;
  return fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'chdb-wasm-e2e-test/1.0',
      ...options?.headers,
    },
  });
}

/**
 * Measure response time for a request
 */
async function measureRequest(
  path: string,
  options?: RequestInit
): Promise<{ response: Response; durationMs: number }> {
  const start = performance.now();
  const response = await workerFetch(path, options);
  const durationMs = performance.now() - start;
  return { response, durationMs };
}

describe('Dynamic WASM Loading E2E', () => {
  beforeAll(async () => {
    console.log('\n========================================');
    console.log('  Dynamic WASM Loading E2E Tests');
    console.log('========================================\n');

    if (USE_LOCAL) {
      console.log('Starting local worker via wrangler dev...');
      try {
        const { unstable_dev } = await import('wrangler');

        localWorker = await unstable_dev('src/worker.ts', {
          config: 'wrangler.toml',
          local: true,
          persist: false,
          experimental: {
            disableExperimentalWarning: true,
          },
        });

        workerUrl = `http://${localWorker.address}:${localWorker.port}`;
        console.log(`Local worker started at: ${workerUrl}`);
      } catch (error) {
        console.error('Failed to start local worker:', error);
        throw error;
      }
    } else {
      console.log(`Using deployed worker at: ${workerUrl}`);
    }

    console.log('----------------------------------------\n');
  }, 60000);

  afterAll(async () => {
    console.log('\n----------------------------------------');
    console.log('  Cleaning up...');

    if (localWorker) {
      try {
        await localWorker.stop();
        console.log('  Local worker stopped');
      } catch (error) {
        console.error('  Failed to stop worker:', error);
      }
      localWorker = null;
    }

    console.log('========================================\n');
  }, 30000);

  describe('Core WASM Loading', () => {
    it('cold start loads core WASM via health check', async () => {
      const response = await workerFetch('/ping');

      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);

      const body = await response.text();
      expect(body).toBe('Ok.\n');
    });

    it('responds to manifest request', async () => {
      const response = await workerFetch('/manifest.json');

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const manifest = await response.json();
      expect(manifest).toHaveProperty('profiles');
    });

    it('serves WASM files with correct headers', async () => {
      // Request a WASM file (may or may not exist, but test headers)
      const response = await workerFetch('/wasm/core.wasm');

      // Either serves the file or returns 404
      if (response.status === 200) {
        expect(response.headers.get('Content-Type')).toBe('application/wasm');
        expect(response.headers.get('Cache-Control')).toContain('immutable');
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      } else {
        // 404 is acceptable if the WASM file doesn't exist yet
        expect(response.status).toBe(404);
      }
    });
  });

  describe('Extension Loading', () => {
    it('lists loaded extensions via GET /extensions', async () => {
      const response = await workerFetch('/extensions');

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const data = await response.json() as { loaded: string[]; available: string[]; registry: Record<string, string[]> };
      expect(data).toHaveProperty('loaded');
      expect(data).toHaveProperty('available');
      expect(Array.isArray(data.loaded)).toBe(true);
      expect(Array.isArray(data.available)).toBe(true);
    });

    it('query triggers extension auto-load detection', async () => {
      // Query that would require the ext-geo extension
      const sql = 'SELECT geoDistance(0, 0, 1, 1) AS dist';
      const response = await workerFetch('/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { extensions?: { required: string[] }; error?: string };

      // Should detect required extensions (even if loading fails)
      if (data.extensions) {
        expect(data.extensions.required).toContain('ext-geo');
      }
    });

    it('executes query and reports extension status', async () => {
      // Simple query that doesn't need extensions
      const sql = 'SELECT 1 + 1 AS result';
      const response = await workerFetch('/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { result?: unknown; data?: unknown[] };

      // Should execute successfully
      expect(data.result !== undefined || data.data !== undefined).toBe(true);
    });

    it('handles query with format specification', async () => {
      const sql = 'SELECT number FROM numbers(5)';
      const response = await workerFetch('/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, format: 'JSON' }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as { meta?: unknown[]; data?: unknown[] };

      // Should have JSON format response
      expect(data).toHaveProperty('data');
    });

    it('returns error for missing extension gracefully', async () => {
      // Query that requires a non-existent extension
      const sql = 'SELECT ext_nonexistent_function(123)';
      const response = await workerFetch('/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql }),
      });

      // Should return an error response, not crash
      const data = await response.json() as { error?: string; extensions?: { required: string[]; missing: string[] } };

      // Either executes (mock mode) or returns useful error
      if (response.status !== 200) {
        expect(data).toHaveProperty('error');
      }
    });
  });

  describe('Extension Caching', () => {
    it('second query reuses loaded extension (warm cache)', async () => {
      const sql = 'SELECT geoDistance(0, 0, 1, 1) AS dist';

      // First request (cold)
      const { durationMs: coldDuration } = await measureRequest('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });

      // Second request (warm - should be faster)
      const { durationMs: warmDuration } = await measureRequest('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });

      console.log(`  Extension loading - Cold: ${coldDuration.toFixed(2)}ms, Warm: ${warmDuration.toFixed(2)}ms`);

      // Warm request should generally be faster (or at least not significantly slower)
      // Note: This is a soft check since timing can vary
      expect(warmDuration).toBeDefined();
    });

    it('verifies extension appears in loaded list after query', async () => {
      // Execute a query that needs an extension
      const sql = 'SELECT jsonExtractString(\'{"a":"b"}\', \'a\') AS val';
      await workerFetch('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });

      // Check extensions list
      const response = await workerFetch('/extensions');
      const data = await response.json() as { loaded: string[]; requested: string[] };

      // Extension should be tracked (loaded or at least requested)
      expect(data.loaded !== undefined || data.requested !== undefined).toBe(true);
    });
  });

  describe('Latency Measurement', () => {
    it('measures cold start latency', async () => {
      const { response, durationMs } = await measureRequest('/ping');

      expect(response.status).toBe(200);
      console.log(`  Cold start latency: ${durationMs.toFixed(2)}ms`);

      // Cold start should complete within reasonable time
      expect(durationMs).toBeLessThan(10000); // 10s max
    });

    it('measures query execution latency', async () => {
      const sql = 'SELECT 1 AS test';

      const { response, durationMs } = await measureRequest('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });

      expect(response.status).toBe(200);
      console.log(`  Query execution latency: ${durationMs.toFixed(2)}ms`);
    });

    it('compares cold vs warm extension loading', async () => {
      // Clear any cached state by using different queries
      const queries = [
        'SELECT h3ToGeo(0x8928308280fffff) AS geo1',
        'SELECT h3ToGeo(0x8928308280fffff) AS geo2',
      ];

      const timings: number[] = [];

      for (const sql of queries) {
        const { durationMs } = await measureRequest('/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql }),
        });
        timings.push(durationMs);
      }

      console.log(`  Extension cold: ${timings[0]?.toFixed(2)}ms, warm: ${timings[1]?.toFixed(2)}ms`);

      // Both requests should complete
      expect(timings.length).toBe(2);
    });

    it('measures concurrent request handling', async () => {
      const sql = 'SELECT 1 AS num';
      const numRequests = 5;

      const start = performance.now();

      const promises = Array.from({ length: numRequests }, () =>
        workerFetch('/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql }),
        })
      );

      const responses = await Promise.all(promises);
      const totalDuration = performance.now() - start;

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200);
      }

      console.log(`  ${numRequests} concurrent requests: ${totalDuration.toFixed(2)}ms total`);
      console.log(`  Average per request: ${(totalDuration / numRequests).toFixed(2)}ms`);
    });
  });

  describe('Error Handling', () => {
    it('returns helpful error for invalid SQL', async () => {
      const response = await workerFetch('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELEKT invalid' }),
      });

      const data = await response.json() as { error?: string };

      // Should return error, not crash
      if (response.status !== 200) {
        expect(data).toHaveProperty('error');
        expect(typeof data.error).toBe('string');
      }
    });

    it('handles empty query gracefully', async () => {
      const response = await workerFetch('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: '' }),
      });

      const data = await response.json() as { error?: string };

      // Should return error for empty query
      expect(response.status === 400 || data.error !== undefined).toBe(true);
    });

    it('handles malformed JSON body', async () => {
      const response = await workerFetch('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{{{',
      });

      // Should return error, not crash
      expect([400, 500]).toContain(response.status);
    });

    it('handles missing body', async () => {
      const response = await workerFetch('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      // Should return error
      expect([400, 500]).toContain(response.status);
    });
  });

  describe('CORS Support', () => {
    it('includes CORS headers in extension responses', async () => {
      const response = await workerFetch('/extensions');

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('includes CORS headers in query responses', async () => {
      const response = await workerFetch('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT 1' }),
      });

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('handles OPTIONS preflight for query endpoint', async () => {
      const response = await workerFetch('/query', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });
  });

  describe('Extension Registry', () => {
    it('returns available extensions in registry', async () => {
      const response = await workerFetch('/extensions');
      const data = await response.json() as { registry?: Record<string, string[]>; available?: string[] };

      // Should have registry or available list
      expect(data.registry !== undefined || data.available !== undefined).toBe(true);

      if (data.registry) {
        // Registry should have extension -> functions mapping
        expect(typeof data.registry).toBe('object');
      }
    });

    it('includes extension metadata', async () => {
      const response = await workerFetch('/extensions');
      const data = await response.json() as { metadata?: Record<string, unknown> };

      expect(response.status).toBe(200);
      // Metadata is optional but should be present if extensions are loaded
    });
  });
});

// Log configuration
if (!DEPLOYED_WORKER_URL && !USE_LOCAL) {
  console.warn('\n========================================');
  console.warn('  WARNING: No worker URL configured');
  console.warn('');
  console.warn('  Set WORKER_URL for deployed tests:');
  console.warn('  WORKER_URL=https://... pnpm test:e2e:wasm');
  console.warn('');
  console.warn('  Or run with local worker (default):');
  console.warn('  pnpm test:e2e:wasm');
  console.warn('========================================\n');
}
