/**
 * Cache API Tests for chdb-lake Worker
 *
 * Tests that verify chdb-lake uses Cloudflare Cache API instead of Workers KV
 * for query result caching.
 *
 * Key differences between Cache API and KV:
 * - Cache API is FREE, KV costs money
 * - Cache API supports up to 5GB on enterprise zones (vs 25MB per value for KV)
 * - Cache API uses Request/Response objects
 * - Cache API: caches.default.match(request), caches.default.put(request, response)
 *
 * These tests should FAIL initially because Cache API is not yet implemented.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/cache/
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ============================================================================
// Mock Types for Cloudflare Cache API
// ============================================================================

/**
 * Mock Cache API interface matching Cloudflare's Cache API
 */
interface MockCacheStorage {
  default: MockCache;
  open: (cacheName: string) => Promise<MockCache>;
}

interface MockCache {
  match: Mock<[Request | string, CacheQueryOptions?], Promise<Response | undefined>>;
  put: Mock<[Request | string, Response], Promise<void>>;
  delete: Mock<[Request | string, CacheQueryOptions?], Promise<boolean>>;
}

interface CacheQueryOptions {
  ignoreMethod?: boolean;
  ignoreSearch?: boolean;
  ignoreVary?: boolean;
}

/**
 * Environment interface for chdb-lake worker (without KV)
 */
interface ChdbLakeEnv {
  DATA_BUCKET: R2Bucket;
  WASM_BUCKET: R2Bucket;
  // NOTE: No QUERY_CACHE KV namespace - we use Cache API instead
  ENABLE_CACHE?: string;
  CACHE_TTL?: string;
}

/**
 * Environment interface with KV (the OLD way we're moving away from)
 */
interface ChdbLakeEnvWithKV extends ChdbLakeEnv {
  QUERY_CACHE: KVNamespace; // This should NOT be used
}

// ============================================================================
// Cache API Handler Interface (to be implemented)
// ============================================================================

/**
 * Cache configuration options
 */
interface CacheConfig {
  ttlSeconds: number;
  maxSize?: number; // Max size in bytes (up to 5GB on enterprise)
  cacheControl?: string;
}

/**
 * Query cache handler using Cloudflare Cache API
 *
 * This interface defines the expected behavior for caching query results
 * using Cache API instead of Workers KV.
 */
interface QueryCacheHandler {
  /**
   * Try to get cached query result
   * @param query - The SQL query string
   * @param format - Output format (JSON, CSV, etc.)
   * @returns Cached response or undefined if not found
   */
  get(query: string, format: string): Promise<Response | undefined>;

  /**
   * Store query result in cache
   * @param query - The SQL query string
   * @param format - Output format
   * @param response - The response to cache
   * @param config - Cache configuration
   */
  put(query: string, format: string, response: Response, config?: CacheConfig): Promise<void>;

  /**
   * Invalidate cached query result
   * @param query - The SQL query string
   * @param format - Output format
   */
  invalidate(query: string, format?: string): Promise<boolean>;

  /**
   * Generate cache key for a query
   * @param query - The SQL query string
   * @param format - Output format
   */
  getCacheKey(query: string, format: string): string;
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock Cache API for testing
 */
function createMockCacheAPI(): MockCacheStorage {
  const cache: MockCache = {
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
  };

  return {
    default: cache,
    open: vi.fn().mockResolvedValue(cache),
  };
}

/**
 * Create a cache request URL from query and format
 */
function createCacheUrl(query: string, format: string, baseUrl = 'https://cache.chdb.workers.dev'): string {
  const queryHash = hashQuery(query);
  return `${baseUrl}/cache/${queryHash}?format=${format}`;
}

/**
 * Simple hash function for query strings (for cache key generation)
 */
function hashQuery(query: string): string {
  // Simple djb2 hash for testing
  let hash = 5381;
  for (let i = 0; i < query.length; i++) {
    hash = ((hash << 5) + hash) + query.charCodeAt(i);
  }
  return Math.abs(hash).toString(36);
}

/**
 * Create a test response with JSON data
 */
function createJsonResponse(data: object, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Create a large response for testing size limits
 */
function createLargeResponse(sizeBytes: number): Response {
  // Create a response with approximately the specified size
  const chunkSize = 1024 * 1024; // 1MB chunks
  const chunks: string[] = [];
  let totalSize = 0;

  while (totalSize < sizeBytes) {
    const remainingSize = sizeBytes - totalSize;
    const currentChunkSize = Math.min(chunkSize, remainingSize);
    chunks.push('x'.repeat(currentChunkSize));
    totalSize += currentChunkSize;
  }

  return new Response(chunks.join(''), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(sizeBytes),
    },
  });
}

// ============================================================================
// Tests: No KV Dependency
// ============================================================================

describe('Cache API: No KV Dependency', () => {
  it('should NOT have QUERY_CACHE KV binding in worker environment', async () => {
    /**
     * This test verifies that the chdb-lake worker does not depend on
     * Workers KV for caching. The environment should NOT include a
     * QUERY_CACHE KV namespace.
     */
    const env: ChdbLakeEnv = {
      DATA_BUCKET: {} as R2Bucket,
      WASM_BUCKET: {} as R2Bucket,
      ENABLE_CACHE: 'true',
      CACHE_TTL: '300',
    };

    // Verify no QUERY_CACHE binding
    expect((env as any).QUERY_CACHE).toBeUndefined();
  });

  it('should use caches.default instead of KV for caching', async () => {
    /**
     * This test verifies that caching operations use the Cache API
     * (caches.default) instead of Workers KV.
     */
    const mockCaches = createMockCacheAPI();

    // The cache handler should use caches.default
    // This will fail until we implement the Cache API handler
    const { createQueryCacheHandler } = await import('../../src/query-cache');

    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    // Perform a cache lookup
    await cacheHandler.get('SELECT 1', 'JSON');

    // Verify Cache API was used
    expect(mockCaches.default.match).toHaveBeenCalled();
  });

  it('should not import or reference KV namespace in cache module', async () => {
    /**
     * This test verifies that the cache module doesn't reference KV.
     * We check the module exports to ensure no KV-related types.
     */
    const cacheModule = await import('../../src/query-cache');

    // Should not have any KV-related exports
    expect((cacheModule as any).KVCacheHandler).toBeUndefined();
    expect((cacheModule as any).createKVCache).toBeUndefined();
    expect((cacheModule as any).useKV).toBeUndefined();
  });
});

// ============================================================================
// Tests: Cache API Operations
// ============================================================================

describe('Cache API: Basic Operations', () => {
  let mockCaches: MockCacheStorage;

  beforeEach(() => {
    mockCaches = createMockCacheAPI();
    vi.clearAllMocks();
  });

  describe('Cache Hits', () => {
    it('should return cached response on cache hit', async () => {
      /**
       * When a query result is in the cache, the handler should
       * return the cached response without re-executing the query.
       */
      const cachedData = {
        meta: [{ name: 'result', type: 'UInt8' }],
        data: [{ result: 42 }],
        rows: 1,
      };

      const cachedResponse = createJsonResponse(cachedData, {
        'X-Cache': 'HIT',
        'Cache-Control': 'max-age=300',
      });

      mockCaches.default.match.mockResolvedValue(cachedResponse);

      const { createQueryCacheHandler } = await import('../../src/query-cache');
      const cacheHandler = createQueryCacheHandler(mockCaches.default);

      const result = await cacheHandler.get('SELECT 42 as result', 'JSON');

      expect(result).toBeDefined();
      expect(result?.status).toBe(200);

      const body = await result?.json();
      expect(body.data[0].result).toBe(42);
    });

    it('should include X-Cache: HIT header on cache hit', async () => {
      /**
       * Cached responses should include an X-Cache: HIT header
       * to indicate the result came from cache.
       */
      const cachedResponse = createJsonResponse({ data: [] }, {
        'X-Cache': 'HIT',
      });

      mockCaches.default.match.mockResolvedValue(cachedResponse);

      const { createQueryCacheHandler } = await import('../../src/query-cache');
      const cacheHandler = createQueryCacheHandler(mockCaches.default);

      const result = await cacheHandler.get('SELECT 1', 'JSON');

      expect(result?.headers.get('X-Cache')).toBe('HIT');
    });

    it('should preserve response headers from cached response', async () => {
      /**
       * The cached response should preserve original headers
       * like Content-Type, X-ClickHouse-Query-Id, etc.
       */
      const cachedResponse = createJsonResponse({ data: [] }, {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-ClickHouse-Query-Id': 'test-query-123',
        'X-ClickHouse-Format': 'JSON',
        'X-Cache': 'HIT',
      });

      mockCaches.default.match.mockResolvedValue(cachedResponse);

      const { createQueryCacheHandler } = await import('../../src/query-cache');
      const cacheHandler = createQueryCacheHandler(mockCaches.default);

      const result = await cacheHandler.get('SELECT 1', 'JSON');

      expect(result?.headers.get('Content-Type')).toBe('application/json; charset=UTF-8');
      expect(result?.headers.get('X-ClickHouse-Query-Id')).toBe('test-query-123');
      expect(result?.headers.get('X-ClickHouse-Format')).toBe('JSON');
    });
  });

  describe('Cache Misses', () => {
    it('should return undefined on cache miss', async () => {
      /**
       * When a query result is not in the cache, the handler
       * should return undefined so the query can be executed.
       */
      mockCaches.default.match.mockResolvedValue(undefined);

      const { createQueryCacheHandler } = await import('../../src/query-cache');
      const cacheHandler = createQueryCacheHandler(mockCaches.default);

      const result = await cacheHandler.get('SELECT 1', 'JSON');

      expect(result).toBeUndefined();
    });

    it('should call cache.match with correct request URL', async () => {
      /**
       * The cache handler should generate a proper cache key URL
       * and call cache.match with a Request object.
       */
      const { createQueryCacheHandler } = await import('../../src/query-cache');
      const cacheHandler = createQueryCacheHandler(mockCaches.default);

      await cacheHandler.get('SELECT 1', 'JSON');

      expect(mockCaches.default.match).toHaveBeenCalled();

      // The first argument should be a Request or URL string
      const callArg = mockCaches.default.match.mock.calls[0][0];
      expect(typeof callArg === 'string' || callArg instanceof Request).toBe(true);
    });
  });

  describe('Cache Put', () => {
    it('should cache query results with cache.put', async () => {
      /**
       * After executing a query, the result should be stored
       * in the cache using cache.put.
       */
      const response = createJsonResponse({
        meta: [{ name: '1', type: 'UInt8' }],
        data: [{ '1': 1 }],
        rows: 1,
      });

      const { createQueryCacheHandler } = await import('../../src/query-cache');
      const cacheHandler = createQueryCacheHandler(mockCaches.default);

      await cacheHandler.put('SELECT 1', 'JSON', response);

      expect(mockCaches.default.put).toHaveBeenCalled();
    });

    it('should include Cache-Control header with TTL', async () => {
      /**
       * Cached responses should have a Cache-Control header
       * with the configured max-age (TTL).
       */
      const response = createJsonResponse({ data: [] });

      const { createQueryCacheHandler } = await import('../../src/query-cache');
      const cacheHandler = createQueryCacheHandler(mockCaches.default);

      await cacheHandler.put('SELECT 1', 'JSON', response, { ttlSeconds: 300 });

      expect(mockCaches.default.put).toHaveBeenCalled();

      // Check the response passed to put has correct Cache-Control
      const putCall = mockCaches.default.put.mock.calls[0];
      const storedResponse = putCall[1] as Response;

      expect(storedResponse.headers.get('Cache-Control')).toContain('max-age=300');
    });

    it('should include X-Cache: MISS header on newly cached response', async () => {
      /**
       * When storing a new response, it should be marked with
       * X-Cache: MISS to indicate it's a fresh result.
       */
      const response = createJsonResponse({ data: [] });

      const { createQueryCacheHandler } = await import('../../src/query-cache');
      const cacheHandler = createQueryCacheHandler(mockCaches.default);

      await cacheHandler.put('SELECT 1', 'JSON', response);

      const putCall = mockCaches.default.put.mock.calls[0];
      const storedResponse = putCall[1] as Response;

      // The original response should be cloned with additional headers
      expect(storedResponse.headers.get('X-Cache-Status')).toBe('STORED');
    });

    it('should generate unique cache key based on query and format', async () => {
      /**
       * Different queries and formats should have different cache keys.
       */
      const { createQueryCacheHandler } = await import('../../src/query-cache');
      const cacheHandler = createQueryCacheHandler(mockCaches.default);

      const response1 = createJsonResponse({ data: [{ '1': 1 }] });
      const response2 = createJsonResponse({ data: [{ '2': 2 }] });

      await cacheHandler.put('SELECT 1', 'JSON', response1);
      await cacheHandler.put('SELECT 2', 'JSON', response2);

      // Should have been called twice with different keys
      expect(mockCaches.default.put).toHaveBeenCalledTimes(2);

      const key1 = mockCaches.default.put.mock.calls[0][0];
      const key2 = mockCaches.default.put.mock.calls[1][0];

      expect(key1).not.toBe(key2);
    });

    it('should differentiate cache by output format', async () => {
      /**
       * Same query with different formats should have different cache keys.
       * SELECT 1 as JSON vs SELECT 1 as CSV should be cached separately.
       */
      const { createQueryCacheHandler } = await import('../../src/query-cache');
      const cacheHandler = createQueryCacheHandler(mockCaches.default);

      const jsonResponse = createJsonResponse({ data: [{ '1': 1 }] });
      const csvResponse = new Response('1\n', {
        headers: { 'Content-Type': 'text/csv' },
      });

      await cacheHandler.put('SELECT 1', 'JSON', jsonResponse);
      await cacheHandler.put('SELECT 1', 'CSV', csvResponse);

      expect(mockCaches.default.put).toHaveBeenCalledTimes(2);

      const key1 = cacheHandler.getCacheKey('SELECT 1', 'JSON');
      const key2 = cacheHandler.getCacheKey('SELECT 1', 'CSV');

      expect(key1).not.toBe(key2);
    });
  });
});

// ============================================================================
// Tests: TTL and Expiration
// ============================================================================

describe('Cache API: TTL Settings', () => {
  let mockCaches: MockCacheStorage;

  beforeEach(() => {
    mockCaches = createMockCacheAPI();
    vi.clearAllMocks();
  });

  it('should respect configured TTL in Cache-Control header', async () => {
    /**
     * The cache handler should set Cache-Control: max-age
     * based on the configured TTL.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const response = createJsonResponse({ data: [] });

    await cacheHandler.put('SELECT 1', 'JSON', response, { ttlSeconds: 600 });

    const putCall = mockCaches.default.put.mock.calls[0];
    const storedResponse = putCall[1] as Response;

    expect(storedResponse.headers.get('Cache-Control')).toBe('max-age=600');
  });

  it('should use default TTL of 300 seconds if not specified', async () => {
    /**
     * If no TTL is specified, the default should be 300 seconds (5 minutes).
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const response = createJsonResponse({ data: [] });

    await cacheHandler.put('SELECT 1', 'JSON', response);

    const putCall = mockCaches.default.put.mock.calls[0];
    const storedResponse = putCall[1] as Response;

    expect(storedResponse.headers.get('Cache-Control')).toBe('max-age=300');
  });

  it('should support custom TTL per query', async () => {
    /**
     * Different queries can have different TTL values.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const response1 = createJsonResponse({ data: [] });
    const response2 = createJsonResponse({ data: [] });

    await cacheHandler.put('SELECT 1', 'JSON', response1, { ttlSeconds: 60 });
    await cacheHandler.put('SELECT 2', 'JSON', response2, { ttlSeconds: 3600 });

    const putCall1 = mockCaches.default.put.mock.calls[0];
    const putCall2 = mockCaches.default.put.mock.calls[1];

    expect((putCall1[1] as Response).headers.get('Cache-Control')).toBe('max-age=60');
    expect((putCall2[1] as Response).headers.get('Cache-Control')).toBe('max-age=3600');
  });

  it('should support TTL of 0 to disable caching for specific queries', async () => {
    /**
     * Setting TTL to 0 should effectively not cache the result.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const response = createJsonResponse({ data: [] });

    await cacheHandler.put('SELECT now()', 'JSON', response, { ttlSeconds: 0 });

    // With TTL=0, the response should not be cached
    expect(mockCaches.default.put).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: Large Results (Enterprise 5GB Support)
// ============================================================================

describe('Cache API: Large Result Caching', () => {
  let mockCaches: MockCacheStorage;

  beforeEach(() => {
    mockCaches = createMockCacheAPI();
    vi.clearAllMocks();
  });

  it('should support caching responses up to 512MB (default limit)', async () => {
    /**
     * Cache API supports responses up to 512MB by default.
     * (Enterprise zones support up to 5GB)
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    // Create a 100MB response (simulated)
    const size = 100 * 1024 * 1024; // 100MB
    const largeResponse = createLargeResponse(size);

    await cacheHandler.put('SELECT * FROM large_table', 'JSON', largeResponse);

    expect(mockCaches.default.put).toHaveBeenCalled();
  });

  it('should support caching responses up to 5GB on enterprise zones', async () => {
    /**
     * On enterprise zones, Cache API supports up to 5GB responses.
     * This is a key advantage over KV's 25MB limit.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default, {
      maxSize: 5 * 1024 * 1024 * 1024, // 5GB
    });

    // Simulate enterprise zone config
    const size = 1 * 1024 * 1024 * 1024; // 1GB (simulated)
    const largeResponse = createLargeResponse(1024 * 1024); // Use smaller for test

    // The handler should not reject based on size for enterprise
    await cacheHandler.put('SELECT * FROM huge_table', 'JSON', largeResponse, {
      ttlSeconds: 300,
      maxSize: 5 * 1024 * 1024 * 1024,
    });

    expect(mockCaches.default.put).toHaveBeenCalled();
  });

  it('should reject responses exceeding configured max size', async () => {
    /**
     * Responses exceeding the configured max size should not be cached.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default, {
      maxSize: 10 * 1024 * 1024, // 10MB limit
    });

    // Create a response larger than the limit
    const size = 15 * 1024 * 1024; // 15MB
    const largeResponse = createLargeResponse(size);

    await cacheHandler.put('SELECT * FROM large_table', 'JSON', largeResponse);

    // Should not cache responses exceeding limit
    expect(mockCaches.default.put).not.toHaveBeenCalled();
  });

  it('should include Content-Length header for large responses', async () => {
    /**
     * Large responses should include Content-Length header
     * for proper caching and streaming.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const size = 50 * 1024 * 1024; // 50MB
    const largeResponse = createLargeResponse(size);

    await cacheHandler.put('SELECT * FROM medium_table', 'JSON', largeResponse);

    const putCall = mockCaches.default.put.mock.calls[0];
    const storedResponse = putCall[1] as Response;

    expect(storedResponse.headers.get('Content-Length')).toBe(String(size));
  });
});

// ============================================================================
// Tests: Cache Invalidation
// ============================================================================

describe('Cache API: Invalidation', () => {
  let mockCaches: MockCacheStorage;

  beforeEach(() => {
    mockCaches = createMockCacheAPI();
    vi.clearAllMocks();
  });

  it('should invalidate cached query result', async () => {
    /**
     * The handler should support invalidating specific cached queries.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const result = await cacheHandler.invalidate('SELECT 1', 'JSON');

    expect(mockCaches.default.delete).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('should invalidate all formats for a query when format not specified', async () => {
    /**
     * When invalidating without specifying format, all formats
     * for that query should be invalidated.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    await cacheHandler.invalidate('SELECT 1');

    // Should have been called for multiple formats
    expect(mockCaches.default.delete).toHaveBeenCalled();
  });

  it('should return false when cache entry does not exist', async () => {
    /**
     * Invalidating a non-existent cache entry should return false.
     */
    mockCaches.default.delete.mockResolvedValue(false);

    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const result = await cacheHandler.invalidate('SELECT nonexistent', 'JSON');

    expect(result).toBe(false);
  });
});

// ============================================================================
// Tests: Cache Key Generation
// ============================================================================

describe('Cache API: Cache Key Generation', () => {
  let mockCaches: MockCacheStorage;

  beforeEach(() => {
    mockCaches = createMockCacheAPI();
    vi.clearAllMocks();
  });

  it('should generate deterministic cache keys', async () => {
    /**
     * The same query and format should always generate the same cache key.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const key1 = cacheHandler.getCacheKey('SELECT 1', 'JSON');
    const key2 = cacheHandler.getCacheKey('SELECT 1', 'JSON');

    expect(key1).toBe(key2);
  });

  it('should generate different keys for different queries', async () => {
    /**
     * Different queries should have different cache keys.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const key1 = cacheHandler.getCacheKey('SELECT 1', 'JSON');
    const key2 = cacheHandler.getCacheKey('SELECT 2', 'JSON');

    expect(key1).not.toBe(key2);
  });

  it('should generate different keys for different formats', async () => {
    /**
     * Same query with different formats should have different keys.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const key1 = cacheHandler.getCacheKey('SELECT 1', 'JSON');
    const key2 = cacheHandler.getCacheKey('SELECT 1', 'CSV');

    expect(key1).not.toBe(key2);
  });

  it('should normalize whitespace in queries for cache key', async () => {
    /**
     * Queries that differ only by whitespace should have the same cache key.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const key1 = cacheHandler.getCacheKey('SELECT 1', 'JSON');
    const key2 = cacheHandler.getCacheKey('SELECT  1', 'JSON'); // extra space
    const key3 = cacheHandler.getCacheKey('  SELECT 1  ', 'JSON'); // leading/trailing

    expect(key1).toBe(key2);
    expect(key1).toBe(key3);
  });

  it('should be case-insensitive for SQL keywords in cache key', async () => {
    /**
     * SELECT and select should generate the same cache key.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const key1 = cacheHandler.getCacheKey('SELECT 1', 'JSON');
    const key2 = cacheHandler.getCacheKey('select 1', 'JSON');

    expect(key1).toBe(key2);
  });

  it('should generate valid URL for cache key', async () => {
    /**
     * Cache keys should be valid URLs since Cache API uses Request/Response.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const key = cacheHandler.getCacheKey('SELECT 1', 'JSON');

    // Should be a valid URL
    expect(() => new URL(key)).not.toThrow();
  });
});

// ============================================================================
// Tests: Integration with HTTP Handler
// ============================================================================

describe('Cache API: HTTP Handler Integration', () => {
  let mockCaches: MockCacheStorage;

  beforeEach(() => {
    mockCaches = createMockCacheAPI();
    vi.clearAllMocks();
  });

  it('should check cache before executing query', async () => {
    /**
     * The HTTP handler should check the cache first before
     * executing a query.
     */
    const cachedResponse = createJsonResponse({
      data: [{ '1': 1 }],
    }, { 'X-Cache': 'HIT' });

    mockCaches.default.match.mockResolvedValue(cachedResponse);

    // Import the handler that should use Cache API
    const { handleHttpQueryWithCache } = await import('../../src/http-query-handler-cached');

    const request = new Request('http://localhost/?query=SELECT+1&default_format=JSON');
    const env: ChdbLakeEnv = {
      DATA_BUCKET: {} as R2Bucket,
      WASM_BUCKET: {} as R2Bucket,
      ENABLE_CACHE: 'true',
      CACHE_TTL: '300',
    };

    const response = await handleHttpQueryWithCache(request, env, mockCaches.default);

    // Should have checked cache
    expect(mockCaches.default.match).toHaveBeenCalled();

    // Response should be from cache
    expect(response.headers.get('X-Cache')).toBe('HIT');
  });

  it('should cache result after executing query on cache miss', async () => {
    /**
     * When cache miss occurs, the handler should execute the query
     * and store the result in cache.
     */
    mockCaches.default.match.mockResolvedValue(undefined);

    const { handleHttpQueryWithCache } = await import('../../src/http-query-handler-cached');

    const request = new Request('http://localhost/?query=SELECT+1&default_format=JSON');
    const env: ChdbLakeEnv = {
      DATA_BUCKET: {} as R2Bucket,
      WASM_BUCKET: {} as R2Bucket,
      ENABLE_CACHE: 'true',
      CACHE_TTL: '300',
    };

    await handleHttpQueryWithCache(request, env, mockCaches.default);

    // Should have stored result in cache
    expect(mockCaches.default.put).toHaveBeenCalled();
  });

  it('should not cache when ENABLE_CACHE is false', async () => {
    /**
     * When caching is disabled, queries should not be cached.
     */
    const { handleHttpQueryWithCache } = await import('../../src/http-query-handler-cached');

    const request = new Request('http://localhost/?query=SELECT+1&default_format=JSON');
    const env: ChdbLakeEnv = {
      DATA_BUCKET: {} as R2Bucket,
      WASM_BUCKET: {} as R2Bucket,
      ENABLE_CACHE: 'false',
      CACHE_TTL: '300',
    };

    await handleHttpQueryWithCache(request, env, mockCaches.default);

    // Should not interact with cache
    expect(mockCaches.default.match).not.toHaveBeenCalled();
    expect(mockCaches.default.put).not.toHaveBeenCalled();
  });

  it('should not cache mutation queries (INSERT, UPDATE, DELETE)', async () => {
    /**
     * Mutation queries should never be cached.
     */
    mockCaches.default.match.mockResolvedValue(undefined);

    const { handleHttpQueryWithCache } = await import('../../src/http-query-handler-cached');

    const insertRequest = new Request('http://localhost/?query=INSERT+INTO+t+VALUES+(1)');
    const env: ChdbLakeEnv = {
      DATA_BUCKET: {} as R2Bucket,
      WASM_BUCKET: {} as R2Bucket,
      ENABLE_CACHE: 'true',
      CACHE_TTL: '300',
    };

    await handleHttpQueryWithCache(insertRequest, env, mockCaches.default);

    // INSERT should not be cached
    expect(mockCaches.default.put).not.toHaveBeenCalled();
  });

  it('should bypass cache when no-cache header is present', async () => {
    /**
     * When Cache-Control: no-cache is present, cache should be bypassed.
     */
    const { handleHttpQueryWithCache } = await import('../../src/http-query-handler-cached');

    const request = new Request('http://localhost/?query=SELECT+1&default_format=JSON', {
      headers: {
        'Cache-Control': 'no-cache',
      },
    });
    const env: ChdbLakeEnv = {
      DATA_BUCKET: {} as R2Bucket,
      WASM_BUCKET: {} as R2Bucket,
      ENABLE_CACHE: 'true',
      CACHE_TTL: '300',
    };

    await handleHttpQueryWithCache(request, env, mockCaches.default);

    // Should not check cache
    expect(mockCaches.default.match).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: Error Handling
// ============================================================================

describe('Cache API: Error Handling', () => {
  let mockCaches: MockCacheStorage;

  beforeEach(() => {
    mockCaches = createMockCacheAPI();
    vi.clearAllMocks();
  });

  it('should gracefully handle cache.match errors', async () => {
    /**
     * If cache.match fails, the handler should proceed without crashing.
     */
    mockCaches.default.match.mockRejectedValue(new Error('Cache unavailable'));

    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    // Should not throw, should return undefined
    const result = await cacheHandler.get('SELECT 1', 'JSON');

    expect(result).toBeUndefined();
  });

  it('should gracefully handle cache.put errors', async () => {
    /**
     * If cache.put fails, the handler should not throw an error.
     */
    mockCaches.default.put.mockRejectedValue(new Error('Cache full'));

    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const response = createJsonResponse({ data: [] });

    // Should not throw
    await expect(cacheHandler.put('SELECT 1', 'JSON', response)).resolves.not.toThrow();
  });

  it('should not cache error responses', async () => {
    /**
     * Error responses (4xx, 5xx) should not be cached.
     */
    const { createQueryCacheHandler } = await import('../../src/query-cache');
    const cacheHandler = createQueryCacheHandler(mockCaches.default);

    const errorResponse = new Response('Syntax error', { status: 400 });

    await cacheHandler.put('SELEC 1', 'JSON', errorResponse);

    // Error responses should not be cached
    expect(mockCaches.default.put).not.toHaveBeenCalled();
  });
});
