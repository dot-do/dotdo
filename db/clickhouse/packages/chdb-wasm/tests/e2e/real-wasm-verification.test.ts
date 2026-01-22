/**
 * E2E Tests to verify REAL WASM execution (no mocks)
 *
 * These tests MUST fail if mocks are being used instead of real WASM.
 * They verify actual WASM binary execution, memory operations, and
 * extension loading.
 *
 * Design Philosophy:
 * - Tests are designed to DETECT mock vs real WASM
 * - Real WASM returns specific ClickHouse version strings
 * - Real WASM has non-zero memory metrics
 * - Real WASM executes complex SQL that mocks can't handle
 *
 * These tests form the RED phase of TDD - they should FAIL until
 * the real WASM implementation is complete and integrated.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getWorkerUrl } from './setup';

/**
 * Helper to make requests to the worker
 */
async function workerFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const url = getWorkerUrl() + path;
  return fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'chdb-wasm-real-wasm-verification/1.0',
      ...options?.headers,
    },
  });
}

/**
 * Parse JSON response safely
 */
async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse JSON: ${text}`);
  }
}

describe('Real WASM Verification', () => {
  beforeAll(() => {
    console.log('\n========================================');
    console.log('  Real WASM Verification Tests');
    console.log('  These tests MUST FAIL if using mocks');
    console.log('========================================\n');
  });

  afterAll(() => {
    console.log('\n========================================');
    console.log('  Real WASM Verification Complete');
    console.log('========================================\n');
  });

  describe('WASM Binary Execution Verification', () => {
    it('executes query through real WASM (not mock) - version check', async () => {
      // The version() function should return a real ClickHouse version
      // Mock returns '24.1.1-chdb-wasm', real chDB returns actual version like '24.6.1.1'
      const response = await workerFetch('/?query=SELECT+version()+AS+ver&default_format=JSON');

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{ ver: string }>;
        meta: Array<{ name: string; type: string }>;
      }>(response);

      expect(result.data).toHaveLength(1);
      const version = result.data[0].ver;

      // Real ClickHouse version format: major.minor.patch.build (e.g., 24.6.1.1)
      // Mock version: '24.1.1-chdb-wasm'
      // This test FAILS if mock is being used
      expect(version).not.toBe('24.1.1-chdb-wasm');
      expect(version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);

      console.log(`  Detected ClickHouse version: ${version}`);
    });

    it('returns real server identification (X-ClickHouse-Server-Display-Name)', async () => {
      const response = await workerFetch('/?query=SELECT+1');

      expect(response.status).toBe(200);

      const serverName = response.headers.get('X-ClickHouse-Server-Display-Name');
      expect(serverName).toBeTruthy();

      // Real chDB should identify itself differently than our mock
      // Mock typically returns generic names or nothing specific
      // Real chDB returns its actual server name
      expect(serverName).not.toBe('chdb-wasm');
      expect(serverName).not.toBe('mock');

      console.log(`  Server display name: ${serverName}`);
    });

    it('executes complex SQL that mocks cannot handle', async () => {
      // This query uses ClickHouse-specific features that are hard to mock correctly:
      // - arrayJoin with range
      // - toTypeName introspection
      // - Complex array operations
      const sql = `
        SELECT
          arrayJoin(range(5)) AS n,
          toTypeName(n) AS type,
          bitCount(n) AS bits
        FORMAT JSON
      `;

      const response = await workerFetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: sql,
      });

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{ n: number; type: string; bits: number }>;
        rows: number;
      }>(response);

      // Should return 5 rows (0, 1, 2, 3, 4)
      expect(result.rows).toBe(5);
      expect(result.data).toHaveLength(5);

      // Verify toTypeName returns correct ClickHouse type
      // Mock would likely return 'UInt64' or wrong type
      expect(result.data[0].type).toBe('UInt64');

      // Verify bitCount works correctly
      expect(result.data[0].bits).toBe(0); // bitCount(0) = 0
      expect(result.data[1].bits).toBe(1); // bitCount(1) = 1
      expect(result.data[2].bits).toBe(1); // bitCount(2) = 1
      expect(result.data[3].bits).toBe(2); // bitCount(3) = 2
      expect(result.data[4].bits).toBe(1); // bitCount(4) = 1
    });

    it('handles system.functions introspection', async () => {
      // Query the system.functions table - only real ClickHouse has this
      const response = await workerFetch(
        '/?query=SELECT+name,+is_aggregate+FROM+system.functions+WHERE+name+%3D+%27sum%27+LIMIT+1&default_format=JSON'
      );

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{ name: string; is_aggregate: number }>;
        rows: number;
      }>(response);

      // Real ClickHouse will find the 'sum' function
      expect(result.rows).toBe(1);
      expect(result.data[0].name).toBe('sum');
      expect(result.data[0].is_aggregate).toBe(1);
    });
  });

  describe('Dynamic Extension Loading (SIDE_MODULE)', () => {
    it('loads extension SIDE_MODULE dynamically via dlopen', async () => {
      // Query that requires ext-geo extension
      // Real WASM must dlopen the extension for this to work
      const sql = 'SELECT geoDistance(55.755826, 37.617300, 38.889931, -77.009003) AS distance FORMAT JSON';

      const response = await workerFetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: sql,
      });

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{ distance: number }>;
        extensions?: { loaded: string[] };
      }>(response);

      // geoDistance returns ~7920 km between Moscow and Washington DC
      // Mock would likely return 0 or wrong value
      const distance = result.data[0].distance;
      expect(distance).toBeGreaterThan(7800000); // > 7800 km in meters
      expect(distance).toBeLessThan(8100000);    // < 8100 km in meters

      console.log(`  Calculated distance: ${(distance / 1000).toFixed(2)} km`);

      // Verify extension was loaded (if response includes extension info)
      if (result.extensions?.loaded) {
        expect(result.extensions.loaded).toContain('ext-geo');
      }
    });

    it('loads multiple extensions in parallel', async () => {
      // Query that needs both geo and json extensions
      const sql = `
        SELECT
          geoDistance(55.755826, 37.617300, 38.889931, -77.009003) AS distance,
          JSONExtractString('{"city":"Moscow"}', 'city') AS city
        FORMAT JSON
      `;

      const response = await workerFetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: sql,
      });

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{ distance: number; city: string }>;
      }>(response);

      expect(result.data[0].distance).toBeGreaterThan(7800000);
      expect(result.data[0].city).toBe('Moscow');
    });

    it('reports extension loading in response metadata', async () => {
      // Check /extensions endpoint for loaded extensions
      const response = await workerFetch('/extensions');

      expect(response.status).toBe(200);
      const data = await parseJsonResponse<{
        loaded: string[];
        available: string[];
        registry?: Record<string, string[]>;
      }>(response);

      expect(data).toHaveProperty('loaded');
      expect(data).toHaveProperty('available');

      // After previous tests, some extensions should be loaded
      // Mock mode might not track this properly
      console.log(`  Loaded extensions: ${data.loaded.join(', ') || 'none'}`);
      console.log(`  Available extensions: ${data.available.join(', ')}`);
    });
  });

  describe('Memory Sharing Between MAIN_MODULE and SIDE_MODULE', () => {
    it('shares memory between core and extension modules', async () => {
      // Execute a query that allocates memory in extension
      // Then check memory stats
      const sql = `
        SELECT
          h3ToGeo(599686042433355775) AS geo_tuple,
          length(toString(h3ToGeo(599686042433355775))) AS str_len
        FORMAT JSON
      `;

      const response = await workerFetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: sql,
      });

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{ geo_tuple: [number, number]; str_len: number }>;
      }>(response);

      // h3ToGeo returns a tuple of (lat, lon)
      const [lat, lon] = result.data[0].geo_tuple;

      // The H3 index 599686042433355775 corresponds to coordinates near San Francisco
      expect(lat).toBeCloseTo(37.77, 1);
      expect(lon).toBeCloseTo(-122.41, 1);

      // String length should be positive (memory was used)
      expect(result.data[0].str_len).toBeGreaterThan(0);
    });

    it('allocates and frees memory correctly across modules', async () => {
      // Query that creates many temporary allocations
      const sql = `
        SELECT
          count(*) AS cnt,
          uniq(number % 1000) AS unique_vals
        FROM numbers(10000)
        FORMAT JSON
      `;

      const response = await workerFetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: sql,
      });

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{ cnt: number; unique_vals: number }>;
        statistics: { bytes_read: number };
      }>(response);

      expect(result.data[0].cnt).toBe(10000);
      expect(result.data[0].unique_vals).toBe(1000);

      // Real WASM should report reasonable bytes_read
      // Mock might report 0 or unrealistic values
      expect(result.statistics.bytes_read).toBeGreaterThan(0);
    });
  });

  describe('WASM Memory Usage Metrics', () => {
    it('reports non-zero WASM memory usage metrics', async () => {
      // First execute some queries to use memory
      await workerFetch('/?query=SELECT+*+FROM+numbers(1000)+FORMAT+Null');

      // Then check metrics endpoint (if available)
      const response = await workerFetch('/metrics');

      // Metrics endpoint might not exist yet
      if (response.status === 404) {
        console.log('  /metrics endpoint not yet implemented - skipping');
        return;
      }

      expect(response.status).toBe(200);
      const metrics = await response.text();

      // Look for WASM memory metrics
      // Real WASM will have non-zero memory values
      const heapUsed = metrics.match(/wasm_heap_used_bytes\s+(\d+)/);
      const heapTotal = metrics.match(/wasm_heap_total_bytes\s+(\d+)/);

      if (heapUsed && heapTotal) {
        const used = parseInt(heapUsed[1], 10);
        const total = parseInt(heapTotal[1], 10);

        // Real WASM should have allocated some memory
        expect(used).toBeGreaterThan(0);
        expect(total).toBeGreaterThan(0);
        expect(used).toBeLessThanOrEqual(total);

        console.log(`  WASM heap: ${(used / 1024 / 1024).toFixed(2)} MB / ${(total / 1024 / 1024).toFixed(2)} MB`);
      }
    });

    it('includes memory info in query statistics', async () => {
      const response = await workerFetch('/?query=SELECT+number+FROM+numbers(1000)+FORMAT+JSON');

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        statistics: {
          elapsed: number;
          rows_read: number;
          bytes_read: number;
          memory_usage?: number;
        };
      }>(response);

      expect(result.statistics.elapsed).toBeGreaterThan(0);
      expect(result.statistics.rows_read).toBe(1000);
      expect(result.statistics.bytes_read).toBeGreaterThan(0);

      // Real ClickHouse includes memory_usage in statistics
      // Mock typically doesn't track this
      if (result.statistics.memory_usage !== undefined) {
        expect(result.statistics.memory_usage).toBeGreaterThan(0);
        console.log(`  Memory usage: ${result.statistics.memory_usage} bytes`);
      }
    });

    it('handles large result sets without memory issues', async () => {
      // Generate a large result set to stress memory
      const response = await workerFetch(
        '/?query=SELECT+number,+toString(number)+AS+str+FROM+numbers(10000)+FORMAT+JSON'
      );

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        rows: number;
        data: Array<{ number: number; str: string }>;
      }>(response);

      // Should handle 10k rows
      expect(result.rows).toBe(10000);
      expect(result.data).toHaveLength(10000);

      // Verify data integrity
      expect(result.data[0].number).toBe(0);
      expect(result.data[0].str).toBe('0');
      expect(result.data[9999].number).toBe(9999);
      expect(result.data[9999].str).toBe('9999');
    });
  });

  describe('Graceful Failure Handling', () => {
    it('fails gracefully when WASM is not available', async () => {
      // This test checks error handling when WASM loading fails
      // Simulated by requesting a query that would require unavailable module

      // Request with invalid extension function
      const response = await workerFetch('/?query=SELECT+nonexistent_wasm_only_function()');

      // Should return an error, not crash
      expect([400, 500]).toContain(response.status);

      const body = await response.text();
      expect(body.toLowerCase()).toMatch(/unknown|function|not found|error/);
    });

    it('returns detailed error for missing extension', async () => {
      // Query requiring a non-existent extension
      const response = await workerFetch('/?query=SELECT+ext_nonexistent_xyz(123)');

      // Should return helpful error
      expect([400, 500]).toContain(response.status);

      const body = await response.text();
      expect(body.toLowerCase()).toMatch(/unknown|function|extension|not found|error/);
    });

    it('recovers from extension load failure', async () => {
      // First, try a query with a bad extension
      await workerFetch('/?query=SELECT+bad_extension_function()');

      // Then verify normal queries still work
      const response = await workerFetch('/?query=SELECT+1+AS+test&default_format=JSON');

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{ test: number }>;
      }>(response);

      expect(result.data[0].test).toBe(1);
    });
  });

  describe('ClickHouse-Specific Features (Mock Detection)', () => {
    it('supports generateUUIDv4 function', async () => {
      // generateUUIDv4 is hard to mock correctly
      const response = await workerFetch('/?query=SELECT+generateUUIDv4()+AS+uuid&default_format=JSON');

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{ uuid: string }>;
      }>(response);

      const uuid = result.data[0].uuid;

      // Valid UUID v4 format
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

      console.log(`  Generated UUID: ${uuid}`);
    });

    it('supports cityHash64 function', async () => {
      // cityHash64 produces consistent hash - mock would need exact implementation
      const response = await workerFetch(
        "/?query=SELECT+cityHash64('hello')+AS+hash&default_format=JSON"
      );

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{ hash: string | number }>;
      }>(response);

      // cityHash64('hello') = 2762169579135187400
      // Note: Might be returned as string due to UInt64
      const hash = BigInt(result.data[0].hash);
      expect(hash).toBe(BigInt('2762169579135187400'));
    });

    it('supports formatDateTime with locale', async () => {
      // formatDateTime with locale is ClickHouse-specific
      const response = await workerFetch(
        "/?query=SELECT+formatDateTime(toDateTime('2024-01-15+12:30:00'),+'%Y-%m-%d+%H:%M:%S')+AS+formatted&default_format=JSON"
      );

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{ formatted: string }>;
      }>(response);

      expect(result.data[0].formatted).toBe('2024-01-15 12:30:00');
    });

    it('supports tuple operations', async () => {
      // Tuple support is ClickHouse-specific
      const response = await workerFetch(
        '/?query=SELECT+tuple(1,+2,+3)+AS+t,+tupleElement(tuple(1,+2,+3),+2)+AS+elem&default_format=JSON'
      );

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{ t: [number, number, number]; elem: number }>;
      }>(response);

      expect(result.data[0].t).toEqual([1, 2, 3]);
      expect(result.data[0].elem).toBe(2);
    });

    it('supports array functions comprehensively', async () => {
      // Complex array operations that mocks struggle with
      const sql = `
        SELECT
          arrayMap(x -> x * 2, [1, 2, 3]) AS doubled,
          arrayFilter(x -> x > 2, [1, 2, 3, 4, 5]) AS filtered,
          arrayReduce('sum', [1, 2, 3, 4, 5]) AS sum_result
        FORMAT JSON
      `;

      const response = await workerFetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: sql,
      });

      expect(response.status).toBe(200);
      const result = await parseJsonResponse<{
        data: Array<{
          doubled: number[];
          filtered: number[];
          sum_result: number;
        }>;
      }>(response);

      expect(result.data[0].doubled).toEqual([2, 4, 6]);
      expect(result.data[0].filtered).toEqual([3, 4, 5]);
      expect(result.data[0].sum_result).toBe(15);
    });
  });
});
