/**
 * Query Cache Tests (RED Phase)
 *
 * Tests for Cache API query caching implementation using Cloudflare Cache API patterns.
 *
 * Test cases:
 * 1. Cache key generation from SQL query + format
 * 2. Cache hit returns cached response without re-executing
 * 3. Cache miss executes query and stores in cache
 * 4. Different queries have different cache keys
 * 5. Same query with different formats have different cache keys
 * 6. Cache-Control headers are set correctly
 * 7. Stale-while-revalidate behavior
 * 8. Cache bypass with ?nocache=1 parameter
 * 9. Cache invalidation on write queries (INSERT, CREATE, DROP)
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/cache/
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Import the module under test (to be implemented)
import {
  generateCacheKey,
  QueryCache,
  type QueryCacheOptions,
  type CacheableRequest,
  isWriteQuery,
} from '../../src/query-cache';

// Mock Cloudflare Cache API types
interface MockCacheStorage {
  default: MockCache;
}

interface MockCache {
  match: Mock<[Request], Promise<Response | undefined>>;
  put: Mock<[Request, Response], Promise<void>>;
  delete: Mock<[Request], Promise<boolean>>;
}

/**
 * Create a mock Cloudflare Cache API
 */
function createMockCacheAPI(): MockCacheStorage {
  return {
    default: {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(true),
    },
  };
}

/**
 * Create a test request for caching
 */
function createCacheableRequest(
  query: string,
  options?: {
    format?: string;
    nocache?: boolean;
    baseUrl?: string;
  }
): CacheableRequest {
  const baseUrl = options?.baseUrl ?? 'https://chdb.example.com';
  const params = new URLSearchParams();
  params.set('query', query);
  if (options?.format) {
    params.set('default_format', options.format);
  }
  if (options?.nocache) {
    params.set('nocache', '1');
  }
  const url = `${baseUrl}/?${params.toString()}`;
  return new Request(url, { method: 'GET' }) as CacheableRequest;
}

/**
 * Create a mock query executor
 */
function createMockExecutor() {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({
      meta: [{ name: 'result', type: 'UInt8' }],
      data: [{ result: 1 }],
      rows: 1,
      statistics: { elapsed: 0.001 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    })
  );
}

describe('Query Cache', () => {
  let mockCaches: MockCacheStorage;
  let queryCache: QueryCache;

  beforeEach(() => {
    mockCaches = createMockCacheAPI();
    queryCache = new QueryCache(mockCaches as unknown as CacheStorage);
  });

  describe('Cache Key Generation', () => {
    it('should generate cache key from SQL query and format', () => {
      const query = 'SELECT 1';
      const format = 'JSON';

      const cacheKey = generateCacheKey(query, format);

      // Cache key should be a Request object suitable for Cache API
      expect(cacheKey).toBeInstanceOf(Request);
      expect(cacheKey.method).toBe('GET');
      // URL should contain hashed query info
      expect(cacheKey.url).toContain('chdb-cache');
    });

    it('should generate deterministic cache keys for same query + format', () => {
      const query = 'SELECT 1 + 1 AS result';
      const format = 'JSON';

      const key1 = generateCacheKey(query, format);
      const key2 = generateCacheKey(query, format);

      expect(key1.url).toBe(key2.url);
    });

    it('should generate different cache keys for different queries', () => {
      const key1 = generateCacheKey('SELECT 1', 'JSON');
      const key2 = generateCacheKey('SELECT 2', 'JSON');

      expect(key1.url).not.toBe(key2.url);
    });

    it('should generate different cache keys for same query with different formats', () => {
      const query = 'SELECT 1';
      const keyJson = generateCacheKey(query, 'JSON');
      const keyCsv = generateCacheKey(query, 'CSV');
      const keyTsv = generateCacheKey(query, 'TabSeparated');

      expect(keyJson.url).not.toBe(keyCsv.url);
      expect(keyJson.url).not.toBe(keyTsv.url);
      expect(keyCsv.url).not.toBe(keyTsv.url);
    });

    it('should normalize whitespace in queries for cache key generation', () => {
      const query1 = 'SELECT    1   AS   result';
      const query2 = 'SELECT 1 AS result';
      const query3 = `SELECT
        1
        AS
        result`;

      const key1 = generateCacheKey(query1, 'JSON');
      const key2 = generateCacheKey(query2, 'JSON');
      const key3 = generateCacheKey(query3, 'JSON');

      // All should produce the same cache key after normalization
      expect(key1.url).toBe(key2.url);
      expect(key2.url).toBe(key3.url);
    });

    it('should handle case sensitivity in queries', () => {
      // SQL keywords are case insensitive, but string literals are not
      const key1 = generateCacheKey('SELECT 1', 'JSON');
      const key2 = generateCacheKey('select 1', 'JSON');

      // Should produce same key for case-insensitive SQL
      expect(key1.url).toBe(key2.url);
    });

    it('should preserve case sensitivity for string literals', () => {
      const key1 = generateCacheKey("SELECT 'Hello'", 'JSON');
      const key2 = generateCacheKey("SELECT 'hello'", 'JSON');

      // Different string literals should produce different keys
      expect(key1.url).not.toBe(key2.url);
    });
  });

  describe('Cache Hit', () => {
    it('should return cached response without re-executing query', async () => {
      const cachedResponse = new Response(JSON.stringify({
        meta: [{ name: 'result', type: 'UInt8' }],
        data: [{ result: 42 }],
        rows: 1,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Cache': 'HIT',
        },
      });

      mockCaches.default.match.mockResolvedValue(cachedResponse.clone());

      const request = createCacheableRequest('SELECT 42', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await queryCache.get(request, executor);

      // Should return the cached response
      expect(result.status).toBe(200);
      const body = await result.json();
      expect(body.data[0].result).toBe(42);

      // Executor should NOT be called on cache hit
      expect(executor).not.toHaveBeenCalled();

      // Cache match should have been called
      expect(mockCaches.default.match).toHaveBeenCalled();
    });

    it('should set X-Cache header to HIT on cache hit', async () => {
      const cachedResponse = new Response('{"data":[]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      mockCaches.default.match.mockResolvedValue(cachedResponse.clone());

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await queryCache.get(request, executor);

      expect(result.headers.get('X-Cache')).toBe('HIT');
    });

    it('should preserve original response headers from cache', async () => {
      const cachedResponse = new Response('{"data":[]}', {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-ClickHouse-Query-Id': 'cached-query-123',
          'X-ClickHouse-Format': 'JSON',
        },
      });
      mockCaches.default.match.mockResolvedValue(cachedResponse.clone());

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await queryCache.get(request, executor);

      expect(result.headers.get('Content-Type')).toBe('application/json; charset=UTF-8');
      expect(result.headers.get('X-ClickHouse-Query-Id')).toBe('cached-query-123');
      expect(result.headers.get('X-ClickHouse-Format')).toBe('JSON');
    });
  });

  describe('Cache Miss', () => {
    it('should execute query and store result in cache on miss', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await queryCache.get(request, executor);

      // Executor should be called on cache miss
      expect(executor).toHaveBeenCalled();

      // Result should be stored in cache
      expect(mockCaches.default.put).toHaveBeenCalled();

      // Response should be valid
      expect(result.status).toBe(200);
    });

    it('should set X-Cache header to MISS on cache miss', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await queryCache.get(request, executor);

      expect(result.headers.get('X-Cache')).toBe('MISS');
    });

    it('should clone response before storing in cache', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await queryCache.get(request, executor);

      // Should be able to read the response body (not consumed by cache.put)
      const body = await result.text();
      expect(body).toBeTruthy();
    });
  });

  describe('Cache-Control Headers', () => {
    it('should set default Cache-Control header on cached responses', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await queryCache.get(request, executor);

      const cacheControl = result.headers.get('Cache-Control');
      expect(cacheControl).toBeTruthy();
      expect(cacheControl).toContain('max-age=');
    });

    it('should respect custom TTL option', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);
      const customCache = new QueryCache(mockCaches as unknown as CacheStorage, {
        defaultTtl: 3600, // 1 hour
      });

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await customCache.get(request, executor);

      const cacheControl = result.headers.get('Cache-Control');
      expect(cacheControl).toContain('max-age=3600');
    });

    it('should set stale-while-revalidate directive', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);
      const cacheWithSwr = new QueryCache(mockCaches as unknown as CacheStorage, {
        defaultTtl: 60,
        staleWhileRevalidate: 120,
      });

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await cacheWithSwr.get(request, executor);

      const cacheControl = result.headers.get('Cache-Control');
      expect(cacheControl).toContain('stale-while-revalidate=120');
    });

    it('should include public directive for GET requests', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await queryCache.get(request, executor);

      const cacheControl = result.headers.get('Cache-Control');
      expect(cacheControl).toContain('public');
    });
  });

  describe('Stale-While-Revalidate Behavior', () => {
    it('should return stale response while revalidating in background', async () => {
      const staleResponse = new Response(JSON.stringify({
        data: [{ result: 'stale' }],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Age': '120', // Response is 120 seconds old
          'Cache-Control': 'max-age=60, stale-while-revalidate=120',
        },
      });
      mockCaches.default.match.mockResolvedValue(staleResponse.clone());

      const cacheWithSwr = new QueryCache(mockCaches as unknown as CacheStorage, {
        defaultTtl: 60,
        staleWhileRevalidate: 120,
      });

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await cacheWithSwr.get(request, executor);

      // Should return the stale response immediately
      const body = await result.json();
      expect(body.data[0].result).toBe('stale');
      expect(result.headers.get('X-Cache')).toBe('STALE');
    });

    it('should trigger background revalidation for stale responses', async () => {
      const staleResponse = new Response(JSON.stringify({
        data: [{ result: 'stale' }],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Age': '120',
          'Cache-Control': 'max-age=60, stale-while-revalidate=120',
        },
      });
      mockCaches.default.match.mockResolvedValue(staleResponse.clone());

      const cacheWithSwr = new QueryCache(mockCaches as unknown as CacheStorage, {
        defaultTtl: 60,
        staleWhileRevalidate: 120,
      });

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      await cacheWithSwr.get(request, executor);

      // Allow background revalidation to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Executor should have been called for background revalidation
      expect(executor).toHaveBeenCalled();
    });

    it('should not serve stale response beyond stale-while-revalidate window', async () => {
      const veryStaleResponse = new Response(JSON.stringify({
        data: [{ result: 'very-stale' }],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Age': '300', // Response is 300 seconds old
          'Cache-Control': 'max-age=60, stale-while-revalidate=120', // Only valid for 180s total
        },
      });
      mockCaches.default.match.mockResolvedValue(veryStaleResponse.clone());

      const cacheWithSwr = new QueryCache(mockCaches as unknown as CacheStorage, {
        defaultTtl: 60,
        staleWhileRevalidate: 120,
      });

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await cacheWithSwr.get(request, executor);

      // Should NOT return the stale response, should execute fresh
      expect(executor).toHaveBeenCalled();
      expect(result.headers.get('X-Cache')).toBe('MISS');
    });
  });

  describe('Cache Bypass', () => {
    it('should bypass cache with nocache=1 parameter', async () => {
      const cachedResponse = new Response('{"data":[]}', { status: 200 });
      mockCaches.default.match.mockResolvedValue(cachedResponse.clone());

      const request = createCacheableRequest('SELECT 1', {
        format: 'JSON',
        nocache: true,
      });
      const executor = createMockExecutor();

      await queryCache.get(request, executor);

      // Cache should not be checked
      expect(mockCaches.default.match).not.toHaveBeenCalled();

      // Executor should always be called
      expect(executor).toHaveBeenCalled();
    });

    it('should not store response in cache when nocache=1', async () => {
      const request = createCacheableRequest('SELECT 1', {
        format: 'JSON',
        nocache: true,
      });
      const executor = createMockExecutor();

      await queryCache.get(request, executor);

      // Cache should not be updated
      expect(mockCaches.default.put).not.toHaveBeenCalled();
    });

    it('should set X-Cache header to BYPASS when cache is bypassed', async () => {
      const request = createCacheableRequest('SELECT 1', {
        format: 'JSON',
        nocache: true,
      });
      const executor = createMockExecutor();

      const result = await queryCache.get(request, executor);

      expect(result.headers.get('X-Cache')).toBe('BYPASS');
    });

    it('should respect Cache-Control: no-cache header', async () => {
      const request = new Request('https://chdb.example.com/?query=SELECT+1&default_format=JSON', {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
      }) as CacheableRequest;

      const executor = createMockExecutor();

      await queryCache.get(request, executor);

      // Cache should be bypassed
      expect(mockCaches.default.match).not.toHaveBeenCalled();
      expect(executor).toHaveBeenCalled();
    });

    it('should respect Cache-Control: no-store header', async () => {
      const request = new Request('https://chdb.example.com/?query=SELECT+1&default_format=JSON', {
        method: 'GET',
        headers: { 'Cache-Control': 'no-store' },
      }) as CacheableRequest;

      const executor = createMockExecutor();

      await queryCache.get(request, executor);

      // Should not store in cache
      expect(mockCaches.default.put).not.toHaveBeenCalled();
    });
  });

  describe('Write Query Detection', () => {
    it('should detect INSERT queries as write queries', () => {
      expect(isWriteQuery('INSERT INTO table VALUES (1, 2, 3)')).toBe(true);
      expect(isWriteQuery('insert into table values (1)')).toBe(true);
      expect(isWriteQuery('INSERT INTO table SELECT * FROM other')).toBe(true);
    });

    it('should detect CREATE queries as write queries', () => {
      expect(isWriteQuery('CREATE TABLE foo (id UInt32)')).toBe(true);
      expect(isWriteQuery('create database mydb')).toBe(true);
      expect(isWriteQuery('CREATE VIEW myview AS SELECT 1')).toBe(true);
      expect(isWriteQuery('CREATE MATERIALIZED VIEW mv AS SELECT 1')).toBe(true);
    });

    it('should detect DROP queries as write queries', () => {
      expect(isWriteQuery('DROP TABLE foo')).toBe(true);
      expect(isWriteQuery('drop database mydb')).toBe(true);
      expect(isWriteQuery('DROP VIEW myview')).toBe(true);
    });

    it('should detect ALTER queries as write queries', () => {
      expect(isWriteQuery('ALTER TABLE foo ADD COLUMN bar UInt32')).toBe(true);
      expect(isWriteQuery('alter table foo drop column bar')).toBe(true);
    });

    it('should detect TRUNCATE queries as write queries', () => {
      expect(isWriteQuery('TRUNCATE TABLE foo')).toBe(true);
      expect(isWriteQuery('truncate table bar')).toBe(true);
    });

    it('should detect DELETE queries as write queries', () => {
      expect(isWriteQuery('DELETE FROM foo WHERE id = 1')).toBe(true);
      expect(isWriteQuery('delete from bar')).toBe(true);
    });

    it('should detect UPDATE queries as write queries', () => {
      expect(isWriteQuery('UPDATE foo SET bar = 1')).toBe(true);
      expect(isWriteQuery('update table set col = value')).toBe(true);
    });

    it('should NOT detect SELECT queries as write queries', () => {
      expect(isWriteQuery('SELECT 1')).toBe(false);
      expect(isWriteQuery('SELECT * FROM table')).toBe(false);
      expect(isWriteQuery('select count(*) from foo')).toBe(false);
    });

    it('should NOT detect SHOW queries as write queries', () => {
      expect(isWriteQuery('SHOW TABLES')).toBe(false);
      expect(isWriteQuery('SHOW DATABASES')).toBe(false);
      expect(isWriteQuery('show create table foo')).toBe(false);
    });

    it('should NOT detect DESCRIBE queries as write queries', () => {
      expect(isWriteQuery('DESCRIBE TABLE foo')).toBe(false);
      expect(isWriteQuery('describe foo')).toBe(false);
    });

    it('should NOT detect EXPLAIN queries as write queries', () => {
      expect(isWriteQuery('EXPLAIN SELECT 1')).toBe(false);
      expect(isWriteQuery('explain select * from foo')).toBe(false);
    });

    it('should handle queries with leading whitespace', () => {
      expect(isWriteQuery('  SELECT 1')).toBe(false);
      expect(isWriteQuery('\n\nINSERT INTO foo VALUES (1)')).toBe(true);
      expect(isWriteQuery('   DROP TABLE bar')).toBe(true);
    });

    it('should handle queries with comments', () => {
      expect(isWriteQuery('-- comment\nSELECT 1')).toBe(false);
      expect(isWriteQuery('/* comment */ INSERT INTO foo VALUES (1)')).toBe(true);
    });
  });

  describe('Cache Invalidation on Write Queries', () => {
    it('should not cache INSERT queries', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('INSERT INTO foo VALUES (1, 2, 3)', { format: 'JSON' });
      const executor = createMockExecutor();

      await queryCache.get(request, executor);

      // Should not attempt to cache
      expect(mockCaches.default.put).not.toHaveBeenCalled();
    });

    it('should not cache CREATE queries', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('CREATE TABLE bar (id UInt32)', { format: 'JSON' });
      const executor = createMockExecutor();

      await queryCache.get(request, executor);

      expect(mockCaches.default.put).not.toHaveBeenCalled();
    });

    it('should not cache DROP queries', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('DROP TABLE baz', { format: 'JSON' });
      const executor = createMockExecutor();

      await queryCache.get(request, executor);

      expect(mockCaches.default.put).not.toHaveBeenCalled();
    });

    it('should always execute write queries (never use cache)', async () => {
      const cachedResponse = new Response('{"data":[]}', { status: 200 });
      mockCaches.default.match.mockResolvedValue(cachedResponse.clone());

      const request = createCacheableRequest('INSERT INTO foo VALUES (1)', { format: 'JSON' });
      const executor = createMockExecutor();

      await queryCache.get(request, executor);

      // Executor should always be called for write queries
      expect(executor).toHaveBeenCalled();
    });

    it('should set X-Cache header to SKIP for write queries', async () => {
      const request = createCacheableRequest('INSERT INTO foo VALUES (1)', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await queryCache.get(request, executor);

      expect(result.headers.get('X-Cache')).toBe('SKIP');
    });
  });

  describe('Error Handling', () => {
    it('should not cache error responses', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('SELECT * FROM nonexistent_table', { format: 'JSON' });
      const executor = vi.fn().mockResolvedValue(
        new Response('Table not found', { status: 404 })
      );

      const result = await queryCache.get(request, executor);

      expect(result.status).toBe(404);
      expect(mockCaches.default.put).not.toHaveBeenCalled();
    });

    it('should not cache 500 error responses', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = vi.fn().mockResolvedValue(
        new Response('Internal error', { status: 500 })
      );

      await queryCache.get(request, executor);

      expect(mockCaches.default.put).not.toHaveBeenCalled();
    });

    it('should handle cache API errors gracefully', async () => {
      mockCaches.default.match.mockRejectedValue(new Error('Cache unavailable'));

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      // Should not throw, should fall back to executing query
      const result = await queryCache.get(request, executor);

      expect(result.status).toBe(200);
      expect(executor).toHaveBeenCalled();
    });

    it('should handle cache put errors gracefully', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);
      mockCaches.default.put.mockRejectedValue(new Error('Cache write failed'));

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      // Should not throw, should still return the response
      const result = await queryCache.get(request, executor);

      expect(result.status).toBe(200);
    });
  });

  describe('Cache Configuration', () => {
    it('should accept custom cache options', () => {
      const options: QueryCacheOptions = {
        defaultTtl: 300,
        staleWhileRevalidate: 600,
        maxCacheableBodySize: 1024 * 1024,
        cacheKeyPrefix: 'my-app',
      };

      const customCache = new QueryCache(mockCaches as unknown as CacheStorage, options);

      expect(customCache).toBeDefined();
    });

    it('should not cache responses exceeding maxCacheableBodySize', async () => {
      const largeCache = new QueryCache(mockCaches as unknown as CacheStorage, {
        maxCacheableBodySize: 100, // 100 bytes
      });

      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = vi.fn().mockResolvedValue(
        new Response('x'.repeat(200), { // 200 bytes - exceeds limit
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await largeCache.get(request, executor);

      expect(mockCaches.default.put).not.toHaveBeenCalled();
    });

    it('should use custom cache key prefix', () => {
      const customCache = new QueryCache(mockCaches as unknown as CacheStorage, {
        cacheKeyPrefix: 'my-custom-prefix',
      });

      const key = customCache.generateKey('SELECT 1', 'JSON');

      expect(key.url).toContain('my-custom-prefix');
    });
  });

  describe('Cache Statistics', () => {
    it('should track cache hit count', async () => {
      const cachedResponse = new Response('{}', { status: 200 });
      mockCaches.default.match.mockResolvedValue(cachedResponse.clone());

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      await queryCache.get(request, executor);
      await queryCache.get(request, executor);
      await queryCache.get(request, executor);

      const stats = queryCache.getStats();
      expect(stats.hits).toBe(3);
    });

    it('should track cache miss count', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      await queryCache.get(request, executor);
      await queryCache.get(request, executor);

      const stats = queryCache.getStats();
      expect(stats.misses).toBe(2);
    });

    it('should track cache bypass count', async () => {
      const request = createCacheableRequest('SELECT 1', {
        format: 'JSON',
        nocache: true,
      });
      const executor = createMockExecutor();

      await queryCache.get(request, executor);
      await queryCache.get(request, executor);

      const stats = queryCache.getStats();
      expect(stats.bypasses).toBe(2);
    });

    it('should calculate hit ratio', async () => {
      const cachedResponse = new Response('{}', { status: 200 });

      // 3 hits
      mockCaches.default.match.mockResolvedValue(cachedResponse.clone());
      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      await queryCache.get(request, executor);
      await queryCache.get(request, executor);
      await queryCache.get(request, executor);

      // 1 miss
      mockCaches.default.match.mockResolvedValue(undefined);
      await queryCache.get(request, executor);

      const stats = queryCache.getStats();
      expect(stats.hitRatio).toBeCloseTo(0.75, 2); // 3/4 = 0.75
    });

    it('should reset statistics', async () => {
      const cachedResponse = new Response('{}', { status: 200 });
      mockCaches.default.match.mockResolvedValue(cachedResponse.clone());

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      await queryCache.get(request, executor);

      queryCache.resetStats();

      const stats = queryCache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.bypasses).toBe(0);
    });
  });

  describe('Vary Header Handling', () => {
    it('should include Vary header for format-dependent responses', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await queryCache.get(request, executor);

      const vary = result.headers.get('Vary');
      expect(vary).toBeTruthy();
    });

    it('should vary on Accept header', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      const result = await queryCache.get(request, executor);

      const vary = result.headers.get('Vary');
      expect(vary).toContain('Accept');
    });
  });

  describe('POST Request Caching', () => {
    it('should not cache POST requests by default', async () => {
      const request = new Request('https://chdb.example.com/', {
        method: 'POST',
        body: 'SELECT 1',
        headers: { 'Content-Type': 'text/plain' },
      }) as CacheableRequest;

      const executor = createMockExecutor();

      await queryCache.get(request, executor);

      expect(mockCaches.default.match).not.toHaveBeenCalled();
      expect(mockCaches.default.put).not.toHaveBeenCalled();
    });

    it('should cache POST requests when explicitly enabled', async () => {
      const cacheWithPost = new QueryCache(mockCaches as unknown as CacheStorage, {
        cachePostRequests: true,
      });

      mockCaches.default.match.mockResolvedValue(undefined);

      const request = new Request('https://chdb.example.com/?default_format=JSON', {
        method: 'POST',
        body: 'SELECT 1',
        headers: { 'Content-Type': 'text/plain' },
      }) as CacheableRequest;

      const executor = createMockExecutor();

      await cacheWithPost.get(request, executor);

      expect(mockCaches.default.put).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty query string', async () => {
      const request = createCacheableRequest('', { format: 'JSON' });
      const executor = createMockExecutor();

      // Should not crash, may return error
      await expect(queryCache.get(request, executor)).resolves.toBeDefined();
    });

    it('should handle very long queries', async () => {
      const longQuery = 'SELECT ' + 'a, '.repeat(10000) + '1 AS result';
      const key = generateCacheKey(longQuery, 'JSON');

      // Cache key URL should not exceed reasonable length
      expect(key.url.length).toBeLessThan(8192); // Common URL limit
    });

    it('should handle queries with special characters', async () => {
      const query = "SELECT '\\n\\t\\r' AS special";
      const key = generateCacheKey(query, 'JSON');

      expect(key).toBeInstanceOf(Request);
    });

    it('should handle concurrent cache requests', async () => {
      mockCaches.default.match.mockResolvedValue(undefined);

      const request = createCacheableRequest('SELECT 1', { format: 'JSON' });
      const executor = createMockExecutor();

      // Fire multiple concurrent requests
      const promises = Array(10).fill(null).map(() =>
        queryCache.get(request, executor)
      );

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach(result => {
        expect(result.status).toBe(200);
      });
    });

    it('should handle unicode in queries', async () => {
      const query = "SELECT 'Hello, World!' AS greeting";
      const key = generateCacheKey(query, 'JSON');

      expect(key).toBeInstanceOf(Request);
    });
  });
});
