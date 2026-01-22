/**
 * HTTP Query Handler with Cache API Support
 *
 * This module provides HTTP request handling for chdb-lake with integrated
 * Cache API support. It uses Cloudflare's Cache API instead of Workers KV
 * for caching query results.
 *
 * Features:
 * - Cache API integration (FREE, up to 512MB responses)
 * - Automatic cache key generation based on query and format
 * - Cache bypass support via Cache-Control headers
 * - Mutation query detection (no caching for INSERT, UPDATE, DELETE)
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/cache/
 */

import { createQueryCacheHandler, isWriteQuery } from './query-cache';

/**
 * Cache interface matching Cloudflare's Cache API
 */
interface CacheInterface {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
  delete(request: Request | string): Promise<boolean>;
}

/**
 * Environment interface for chdb-lake worker (without KV)
 */
export interface ChdbLakeEnv {
  DATA_BUCKET: R2Bucket;
  WASM_BUCKET: R2Bucket;
  // NOTE: No QUERY_CACHE KV namespace - we use Cache API instead
  ENABLE_CACHE?: string;
  CACHE_TTL?: string;
}

/**
 * Content types for output formats
 */
const FORMAT_CONTENT_TYPES: Record<string, string> = {
  JSON: 'application/json; charset=UTF-8',
  JSONCompact: 'application/json; charset=UTF-8',
  JSONEachRow: 'application/x-ndjson; charset=UTF-8',
  CSV: 'text/csv; charset=UTF-8',
  CSVWithNames: 'text/csv; charset=UTF-8',
  TSV: 'text/tab-separated-values; charset=UTF-8',
  TabSeparated: 'text/tab-separated-values; charset=UTF-8',
  Parquet: 'application/octet-stream',
};

/**
 * CORS headers for cross-origin requests
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-ClickHouse-Format, X-ClickHouse-User, Cache-Control',
};

/**
 * Execute a query via the WASM query executor
 * TODO: Integrate with real WASM executor
 */
async function executeQuery(_query: string, format: string): Promise<Response> {
  // Execute query via WASM (query param will be used by real impl)
  const result = {
    meta: [{ name: 'result', type: 'UInt8' }],
    data: [{ result: 1 }],
    rows: 1,
    statistics: {
      elapsed: 0.001,
      rows_read: 1,
      bytes_read: 1,
    },
  };

  const contentType = FORMAT_CONTENT_TYPES[format] || 'application/json; charset=UTF-8';

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'X-ClickHouse-Format': format,
      ...CORS_HEADERS,
    },
  });
}

/**
 * Check if caching should be bypassed for this request
 */
function shouldBypassCache(request: Request): boolean {
  const cacheControl = request.headers.get('Cache-Control');
  if (cacheControl) {
    const directives = cacheControl.toLowerCase().split(',').map(d => d.trim());
    if (directives.includes('no-cache') || directives.includes('no-store')) {
      return true;
    }
  }
  return false;
}

/**
 * Handle HTTP query with Cache API integration
 *
 * @param request - The incoming HTTP request
 * @param env - Worker environment bindings
 * @param cache - The cache instance (typically caches.default)
 * @returns Response with query results
 */
export async function handleHttpQueryWithCache(
  request: Request,
  env: ChdbLakeEnv,
  cache: CacheInterface
): Promise<Response> {
  const url = new URL(request.url);

  // Get query from URL params or body
  let query = url.searchParams.get('query') || '';

  if (request.method === 'POST' && !query) {
    query = await request.text();
  }

  if (!query || query.trim() === '') {
    return new Response('Missing query parameter', {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  // Determine output format
  const format =
    url.searchParams.get('default_format') ||
    request.headers.get('X-ClickHouse-Format') ||
    'JSON';

  // Check if caching is enabled
  const cacheEnabled = env.ENABLE_CACHE !== 'false';
  const cacheTtl = parseInt(env.CACHE_TTL || '300', 10);

  // Create cache handler
  const cacheHandler = createQueryCacheHandler(cache, {
    defaultTtl: cacheTtl,
  });

  // Check if we should bypass cache
  if (!cacheEnabled || shouldBypassCache(request)) {
    const response = await executeQuery(query, format);
    return response;
  }

  // Check if this is a mutation query (don't cache)
  if (isWriteQuery(query)) {
    const response = await executeQuery(query, format);
    return response;
  }

  // Try to get from cache
  const cachedResponse = await cacheHandler.get(query, format);
  if (cachedResponse) {
    // Return cached response with X-Cache: HIT header
    const headers = new Headers(cachedResponse.headers);
    headers.set('X-Cache', 'HIT');
    return new Response(cachedResponse.body, {
      status: cachedResponse.status,
      statusText: cachedResponse.statusText,
      headers,
    });
  }

  // Execute query
  const response = await executeQuery(query, format);

  // Cache the response (clone it first since we need to return it too)
  const responseToCache = response.clone();
  await cacheHandler.put(query, format, responseToCache, { ttlSeconds: cacheTtl });

  // Return response with X-Cache: MISS header
  const headers = new Headers(response.headers);
  headers.set('X-Cache', 'MISS');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Main request handler export
 */
export default {
  async fetch(request: Request, env: ChdbLakeEnv, _ctx: ExecutionContext): Promise<Response> {
    // Get the default cache
    const cache = caches.default;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    return handleHttpQueryWithCache(request, env, cache as unknown as CacheInterface);
  },
};
