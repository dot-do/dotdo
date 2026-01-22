/**
 * Query Cache Implementation using Cloudflare Cache API
 *
 * This module provides query result caching using Cloudflare's Cache API
 * instead of Workers KV. Cache API is FREE and supports responses up to
 * 512MB (5GB on enterprise zones).
 *
 * Key advantages of Cache API over KV:
 * - FREE (KV costs money)
 * - Supports up to 5GB on enterprise zones (vs 25MB per value for KV)
 * - Uses Request/Response objects natively
 * - Automatic TTL handling via Cache-Control headers
 *
 * Features:
 * - FNV-1a hash function for fast, well-distributed cache keys
 * - Query normalization for better cache hit rates
 * - Stale-while-revalidate support
 * - Comprehensive metrics tracking (hits, misses, bypasses, errors)
 * - Write query detection (INSERT, UPDATE, DELETE bypassed)
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/cache/
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Cache configuration options
 */
export interface CacheConfig {
  /** TTL in seconds for cached responses */
  ttlSeconds: number;
  /** Max size in bytes (up to 5GB on enterprise) */
  maxSize?: number;
  /** Custom Cache-Control header value */
  cacheControl?: string;
}

/**
 * Options for creating a QueryCacheHandler
 */
export interface QueryCacheHandlerOptions {
  /** Maximum response size in bytes that can be cached (default: 512MB) */
  maxSize?: number;
  /** Base URL for generating cache keys */
  baseUrl?: string;
  /** Default TTL in seconds (default: 300) */
  defaultTtl?: number;
}

/**
 * Supported output formats for cache key differentiation
 */
const COMMON_FORMATS = ['JSON', 'JSONCompact', 'JSONEachRow', 'CSV', 'CSVWithNames', 'TSV', 'TabSeparated', 'Parquet'];

/**
 * Cache interface matching Cloudflare's Cache API
 */
interface CacheInterface {
  match(request: Request | string, options?: CacheQueryOptions): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
  delete(request: Request | string, options?: CacheQueryOptions): Promise<boolean>;
}

interface CacheQueryOptions {
  ignoreMethod?: boolean;
  ignoreSearch?: boolean;
  ignoreVary?: boolean;
}

/**
 * Query cache handler using Cloudflare Cache API
 */
export interface QueryCacheHandler {
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
   * @param format - Output format (optional - invalidates all formats if not specified)
   */
  invalidate(query: string, format?: string): Promise<boolean>;

  /**
   * Generate cache key for a query
   * @param query - The SQL query string
   * @param format - Output format
   */
  getCacheKey(query: string, format: string): string;
}

const DEFAULT_TTL = 300;
const DEFAULT_CACHE_KEY_PREFIX = 'chdb-cache';

/**
 * Normalize SQL query for cache key generation
 * - Trim whitespace
 * - Normalize multiple spaces to single space
 * - Convert SQL keywords to uppercase for consistency
 * - Preserve case for string literals (values inside quotes)
 */
function normalizeQueryForCacheKey(query: string): string {
  // First, extract string literals to preserve their case
  const stringLiterals: string[] = [];
  let normalized = query.replace(/'([^'\\]|\\.)*'/g, (match) => {
    stringLiterals.push(match);
    return `__STRING_LITERAL_${stringLiterals.length - 1}__`;
  });

  // Trim and normalize whitespace
  normalized = normalized.trim().replace(/\s+/g, ' ');

  // Convert SQL keywords to uppercase (case insensitive)
  normalized = normalized.toUpperCase();

  // Restore string literals with their original case
  stringLiterals.forEach((literal, index) => {
    normalized = normalized.replace(`__STRING_LITERAL_${index}__`, literal);
  });

  return normalized;
}

/**
 * Simple query normalization (no string literal preservation)
 * Used for write query detection
 */
function normalizeQuery(query: string): string {
  // Strip comments first
  let normalized = query.trim();

  // Handle single-line comments at the start
  while (normalized.startsWith('--')) {
    const newlineIndex = normalized.indexOf('\n');
    if (newlineIndex === -1) {
      return '';
    }
    normalized = normalized.substring(newlineIndex + 1).trim();
  }

  // Handle multi-line comments at the start
  while (normalized.startsWith('/*')) {
    const endIndex = normalized.indexOf('*/');
    if (endIndex === -1) {
      return '';
    }
    normalized = normalized.substring(endIndex + 2).trim();
  }

  // Normalize whitespace and convert to uppercase
  return normalized.replace(/\s+/g, ' ').toUpperCase();
}

/**
 * FNV-1a 32-bit hash constants
 * FNV-1a is faster than djb2 and has better distribution for cache keys
 * @see https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function
 */
const FNV_PRIME = 0x01000193;
const FNV_OFFSET_BASIS = 0x811c9dc5;

/**
 * Generate a hash for the query string using FNV-1a algorithm
 *
 * FNV-1a advantages over djb2:
 * - Better avalanche characteristics (small input changes cause large hash changes)
 * - More uniform distribution across hash space
 * - Slightly faster due to XOR-then-multiply vs multiply-then-add
 *
 * @param str - Input string to hash
 * @returns Base36 encoded hash string
 */
function hashString(str: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // Multiply by FNV prime (using bitwise ops for 32-bit math)
    hash = Math.imul(hash, FNV_PRIME);
  }
  // Ensure unsigned 32-bit result
  return (hash >>> 0).toString(36);
}

/**
 * Create a QueryCacheHandler using Cloudflare Cache API
 *
 * @param cache - The cache instance (typically caches.default)
 * @param options - Optional configuration
 * @returns QueryCacheHandler instance
 */
export function createQueryCacheHandler(
  cache: CacheInterface,
  options?: QueryCacheHandlerOptions
): QueryCacheHandler {
  const baseUrl = options?.baseUrl || 'https://cache.chdb.workers.dev';
  const defaultTtl = options?.defaultTtl || 300;
  const maxSize = options?.maxSize || 512 * 1024 * 1024; // 512MB default

  /**
   * Generate cache key URL from query and format
   */
  function getCacheKey(query: string, format: string): string {
    const normalizedQuery = normalizeQueryForCacheKey(query);
    const queryHash = hashString(`${normalizedQuery}:${format.toUpperCase()}`);
    return `${baseUrl}/cache/${queryHash}?format=${encodeURIComponent(format)}`;
  }

  /**
   * Get cached response
   */
  async function get(query: string, format: string): Promise<Response | undefined> {
    try {
      const cacheKey = getCacheKey(query, format);
      const request = new Request(cacheKey, { method: 'GET' });
      const cached = await cache.match(request);
      return cached;
    } catch (error) {
      // Gracefully handle cache errors - return undefined to allow query execution
      console.error('[query-cache] Error in cache.match:', error);
      return undefined;
    }
  }

  /**
   * Store response in cache
   */
  async function put(
    query: string,
    format: string,
    response: Response,
    config?: CacheConfig
  ): Promise<void> {
    try {
      const ttl = config?.ttlSeconds ?? defaultTtl;

      // Don't cache if TTL is 0
      if (ttl === 0) {
        return;
      }

      // Don't cache error responses
      if (!response.ok) {
        return;
      }

      // Check size limit
      const contentLength = response.headers.get('Content-Length');
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        const effectiveMaxSize = config?.maxSize ?? maxSize;
        if (size > effectiveMaxSize) {
          return;
        }
      }

      const cacheKey = getCacheKey(query, format);
      const request = new Request(cacheKey, { method: 'GET' });

      // Clone the response and add cache headers
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', `max-age=${ttl}`);
      headers.set('X-Cache-Status', 'STORED');

      // Preserve Content-Length if present
      if (contentLength) {
        headers.set('Content-Length', contentLength);
      }

      const cachedResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });

      await cache.put(request, cachedResponse);
    } catch (error) {
      // Gracefully handle cache errors - don't throw
      console.error('[query-cache] Error in cache.put:', error);
    }
  }

  /**
   * Invalidate cached query result
   */
  async function invalidate(query: string, format?: string): Promise<boolean> {
    try {
      if (format) {
        // Invalidate specific format
        const cacheKey = getCacheKey(query, format);
        const request = new Request(cacheKey, { method: 'GET' });
        return await cache.delete(request);
      } else {
        // Invalidate all common formats
        let anyDeleted = false;
        for (const fmt of COMMON_FORMATS) {
          const cacheKey = getCacheKey(query, fmt);
          const request = new Request(cacheKey, { method: 'GET' });
          const deleted = await cache.delete(request);
          if (deleted) anyDeleted = true;
        }
        return anyDeleted;
      }
    } catch (error) {
      console.error('[query-cache] Error in cache.delete:', error);
      return false;
    }
  }

  return {
    get,
    put,
    invalidate,
    getCacheKey,
  };
}

// ============================================================================
// Legacy exports for backwards compatibility with test suite
// ============================================================================

export interface QueryCacheOptions {
  /** Default TTL in seconds for cached responses */
  defaultTtl?: number;
  /** Stale-while-revalidate window in seconds */
  staleWhileRevalidate?: number;
  /** Maximum body size in bytes that can be cached */
  maxCacheableBodySize?: number;
  /** Prefix for cache keys */
  cacheKeyPrefix?: string;
  /** Whether to cache POST requests */
  cachePostRequests?: boolean;
}

/**
 * Comprehensive cache statistics interface
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Number of cache bypasses (due to no-cache, mutations, etc.) */
  bypasses: number;
  /** Cache hit ratio (0-1) */
  hitRatio: number;
  /** Number of stale cache hits (stale-while-revalidate) */
  staleHits: number;
  /** Number of cache store operations */
  stores: number;
  /** Number of cache invalidations */
  invalidations: number;
  /** Number of errors during cache operations */
  errors: number;
  /** Total bytes served from cache */
  bytesCached: number;
  /** Timestamp when stats collection started */
  startedAt: number;
  /** Uptime in milliseconds */
  uptimeMs: number;
}

export type CacheableRequest = Request;
export type QueryExecutor = (request: CacheableRequest) => Promise<Response>;

/**
 * Generate a cache key from SQL query and format
 *
 * @param query - The SQL query string
 * @param format - The output format (JSON, CSV, etc.)
 * @param prefix - Optional cache key prefix
 * @returns A Request object suitable for use as a cache key
 */
export function generateCacheKey(query: string, format: string, prefix: string = DEFAULT_CACHE_KEY_PREFIX): Request {
  const normalizedQuery = normalizeQueryForCacheKey(query);
  const hashInput = `${normalizedQuery}:${format.toUpperCase()}`;
  const hash = hashString(hashInput);

  // Create a Request object as cache key (required by Cloudflare Cache API)
  return new Request(`https://${prefix}/${hash}`, { method: 'GET' });
}

/**
 * Check if a query is a write query (INSERT, CREATE, DROP, etc.)
 *
 * @param query - The SQL query string
 * @returns true if the query modifies data
 */
export function isWriteQuery(query: string): boolean {
  const normalized = normalizeQuery(query);
  const writeKeywords = [
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'CREATE',
    'ALTER',
    'TRUNCATE',
    'RENAME',
  ];
  return writeKeywords.some((keyword) => normalized.startsWith(keyword));
}

/**
 * Parse Cache-Control header to extract max-age and stale-while-revalidate
 */
function parseCacheControl(header: string | null): { maxAge?: number; swr?: number } {
  if (!header) return {};

  const result: { maxAge?: number; swr?: number } = {};

  const maxAgeMatch = header.match(/max-age=(\d+)/);
  if (maxAgeMatch) {
    result.maxAge = parseInt(maxAgeMatch[1], 10);
  }

  const swrMatch = header.match(/stale-while-revalidate=(\d+)/);
  if (swrMatch) {
    result.swr = parseInt(swrMatch[1], 10);
  }

  return result;
}

/**
 * Check if a cached response is stale based on Age and Cache-Control headers
 */
function isResponseStale(response: Response): { isStale: boolean; isBeyondSwr: boolean } {
  const age = parseInt(response.headers.get('Age') || '0', 10);
  const cacheControl = response.headers.get('Cache-Control');
  const { maxAge, swr } = parseCacheControl(cacheControl);

  if (maxAge === undefined) {
    return { isStale: false, isBeyondSwr: false };
  }

  const isStale = age > maxAge;
  const totalValidWindow = maxAge + (swr || 0);
  const isBeyondSwr = age > totalValidWindow;

  return { isStale, isBeyondSwr };
}

/**
 * Internal stats tracking structure
 */
interface InternalCacheStats {
  hits: number;
  misses: number;
  bypasses: number;
  staleHits: number;
  stores: number;
  invalidations: number;
  errors: number;
  bytesCached: number;
  startedAt: number;
}

/**
 * Query Cache class for Cloudflare Cache API
 */
export class QueryCache {
  private readonly _cache: CacheInterface;
  private readonly _options: QueryCacheOptions;
  private _stats: InternalCacheStats;

  constructor(caches: CacheStorage | { default: CacheInterface }, options?: QueryCacheOptions) {
    this._cache = (caches as { default: CacheInterface }).default;
    this._options = options || {};
    this._stats = this._createEmptyStats();
  }

  /**
   * Create empty stats structure
   */
  private _createEmptyStats(): InternalCacheStats {
    return {
      hits: 0,
      misses: 0,
      bypasses: 0,
      staleHits: 0,
      stores: 0,
      invalidations: 0,
      errors: 0,
      bytesCached: 0,
      startedAt: Date.now(),
    };
  }

  /**
   * Get a response from cache or execute the query
   */
  async get(request: CacheableRequest, executor: QueryExecutor): Promise<Response> {
    const url = new URL(request.url);
    const query = url.searchParams.get('query') || '';
    const format = url.searchParams.get('default_format') || 'JSON';

    // Check for POST requests
    if (request.method === 'POST') {
      if (!this._options.cachePostRequests) {
        const response = await executor(request);
        return this.addHeaders(response, 'BYPASS');
      }
    }

    // Check for write queries - never cache
    if (isWriteQuery(query)) {
      const response = await executor(request);
      return this.addHeaders(response, 'SKIP');
    }

    // Check for cache bypass conditions
    const { bypass, noStore } = this.shouldBypassCache(request);
    if (bypass) {
      this._stats.bypasses++;
      const response = await executor(request);
      return this.addHeaders(response, 'BYPASS');
    }

    // Generate cache key
    const cacheKey = this.generateKey(query, format);

    // Try to get from cache
    let cachedResponse: Response | undefined;
    try {
      cachedResponse = await this._cache.match(cacheKey);
    } catch (error) {
      // Cache error, fall through to execute
      this._stats.errors++;
      this._stats.misses++;
      const response = await executor(request);
      return this.addHeaders(response, 'MISS');
    }

    if (cachedResponse) {
      // Track bytes served from cache
      const contentLength = cachedResponse.headers.get('Content-Length');
      if (contentLength) {
        this._stats.bytesCached += parseInt(contentLength, 10);
      }

      // Check if response is stale (for stale-while-revalidate)
      const { isStale, isBeyondSwr } = isResponseStale(cachedResponse);

      if (isBeyondSwr) {
        // Response is too stale, execute fresh query
        this._stats.misses++;
        const response = await executor(request);
        await this.storeInCache(cacheKey, response.clone(), noStore, query);
        return this.addHeaders(response, 'MISS');
      }

      if (isStale && this._options.staleWhileRevalidate) {
        // Return stale response, revalidate in background
        this._stats.staleHits++;
        this._stats.hits++;
        this.revalidateInBackground(cacheKey, request, executor, noStore);
        return this.addHeaders(cachedResponse, 'STALE');
      }

      // Fresh cache hit
      this._stats.hits++;
      return this.addHeaders(cachedResponse, 'HIT');
    }

    // Cache miss - execute query and store in cache
    this._stats.misses++;
    const response = await executor(request);

    // Store in cache (if appropriate)
    await this.storeInCache(cacheKey, response.clone(), noStore, query);

    return this.addHeaders(response, 'MISS');
  }

  /**
   * Check if request should bypass cache
   */
  private shouldBypassCache(request: CacheableRequest): { bypass: boolean; noStore: boolean } {
    const url = new URL(request.url);

    // Check for nocache parameter
    if (url.searchParams.get('nocache') === '1') {
      return { bypass: true, noStore: true };
    }

    // Check for Cache-Control headers
    const cacheControl = request.headers.get('Cache-Control');
    if (cacheControl) {
      if (cacheControl.includes('no-cache')) {
        return { bypass: true, noStore: false };
      }
      if (cacheControl.includes('no-store')) {
        return { bypass: false, noStore: true };
      }
    }

    return { bypass: false, noStore: false };
  }

  /**
   * Store a response in cache
   */
  private async storeInCache(
    cacheKey: Request,
    response: Response,
    noStore: boolean,
    _query: string
  ): Promise<void> {
    // Don't store error responses
    if (!response.ok) {
      return;
    }

    // Don't store if noStore flag is set
    if (noStore) {
      return;
    }

    // Check body size if configured
    if (this._options.maxCacheableBodySize !== undefined) {
      const contentLength = response.headers.get('Content-Length');
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > this._options.maxCacheableBodySize) {
          return;
        }
      } else {
        // Check body size by cloning
        const cloned = response.clone();
        const body = await cloned.text();
        if (body.length > this._options.maxCacheableBodySize) {
          return;
        }
      }
    }

    // Build Cache-Control header
    const ttl = this._options.defaultTtl || DEFAULT_TTL;
    let cacheControl = `public, max-age=${ttl}`;
    if (this._options.staleWhileRevalidate) {
      cacheControl += `, stale-while-revalidate=${this._options.staleWhileRevalidate}`;
    }

    // Clone response with cache headers
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', cacheControl);
    headers.set('Vary', 'Accept');

    const cachedResponse = new Response(response.clone().body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

    try {
      await this._cache.put(cacheKey, cachedResponse);
      this._stats.stores++;
    } catch {
      // Track cache write errors
      this._stats.errors++;
    }
  }

  /**
   * Revalidate a cache entry in the background
   */
  private revalidateInBackground(
    cacheKey: Request,
    request: CacheableRequest,
    executor: QueryExecutor,
    noStore: boolean
  ): void {
    // Use setTimeout for background revalidation
    setTimeout(async () => {
      try {
        const response = await executor(request);
        if (response.ok) {
          await this.storeInCache(cacheKey, response, noStore, '');
        }
      } catch {
        // Track background revalidation errors
        this._stats.errors++;
      }
    }, 0);
  }

  /**
   * Add cache-related headers to a response
   */
  private addHeaders(
    response: Response,
    cacheStatus: 'HIT' | 'MISS' | 'BYPASS' | 'SKIP' | 'STALE'
  ): Response {
    const headers = new Headers(response.headers);
    headers.set('X-Cache', cacheStatus);

    // Add Cache-Control and Vary for responses that will be returned
    if (cacheStatus === 'MISS' || cacheStatus === 'BYPASS') {
      const ttl = this._options.defaultTtl || DEFAULT_TTL;
      let cacheControl = `public, max-age=${ttl}`;
      if (this._options.staleWhileRevalidate) {
        cacheControl += `, stale-while-revalidate=${this._options.staleWhileRevalidate}`;
      }
      headers.set('Cache-Control', cacheControl);
      headers.set('Vary', 'Accept');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  /**
   * Generate a cache key for the given query and format
   */
  generateKey(query: string, format: string): Request {
    const prefix = this._options.cacheKeyPrefix || DEFAULT_CACHE_KEY_PREFIX;
    return generateCacheKey(query, format, prefix);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this._stats.hits + this._stats.misses;
    const hitRatio = total > 0 ? this._stats.hits / total : 0;
    const now = Date.now();
    return {
      hits: this._stats.hits,
      misses: this._stats.misses,
      bypasses: this._stats.bypasses,
      hitRatio,
      staleHits: this._stats.staleHits,
      stores: this._stats.stores,
      invalidations: this._stats.invalidations,
      errors: this._stats.errors,
      bytesCached: this._stats.bytesCached,
      startedAt: this._stats.startedAt,
      uptimeMs: now - this._stats.startedAt,
    };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this._stats = this._createEmptyStats();
  }

  /**
   * Invalidate a cache entry
   */
  async invalidate(query: string, format: string): Promise<boolean> {
    try {
      const cacheKey = this.generateKey(query, format);
      const deleted = await this._cache.delete(cacheKey);
      if (deleted) {
        this._stats.invalidations++;
      }
      return deleted;
    } catch {
      this._stats.errors++;
      return false;
    }
  }
}

// ============================================================================
// Production Features: Logging, Cache Warming, Metrics, Eviction
// ============================================================================

/**
 * Log levels for structured logging
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

/**
 * Logger interface for cache operations
 */
export interface CacheLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

/**
 * Create a no-op logger that discards all messages
 */
export function createNoOpLogger(): CacheLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

/**
 * Create a console logger with the specified minimum level
 *
 * @param minLevel - Minimum log level to output (default: 'warn')
 * @returns CacheLogger instance
 */
export function createConsoleLogger(minLevel: LogLevel = 'warn'): CacheLogger {
  const minPriority = LOG_LEVEL_PRIORITY[minLevel];

  const shouldLog = (level: LogLevel): boolean => {
    return LOG_LEVEL_PRIORITY[level] >= minPriority;
  };

  const formatMessage = (level: LogLevel, message: string, context?: Record<string, unknown>): string => {
    const timestamp = new Date().toISOString();
    const contextStr = context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
    return `[query-cache][${level.toUpperCase()}][${timestamp}] ${message}${contextStr}`;
  };

  return {
    debug: (message, context) => {
      if (shouldLog('debug')) console.debug(formatMessage('debug', message, context));
    },
    info: (message, context) => {
      if (shouldLog('info')) console.info(formatMessage('info', message, context));
    },
    warn: (message, context) => {
      if (shouldLog('warn')) console.warn(formatMessage('warn', message, context));
    },
    error: (message, error, context) => {
      if (shouldLog('error')) {
        const fullContext = error ? { ...context, errorMessage: error.message, errorStack: error.stack } : context;
        console.error(formatMessage('error', message, fullContext));
      }
    },
  };
}

// ============================================================================
// Cache Warming
// ============================================================================

/**
 * Cache warming configuration for a query
 */
export interface WarmCacheEntry {
  /** The SQL query to warm */
  query: string;
  /** Output format */
  format: string;
  /** TTL in seconds */
  ttlSeconds?: number;
  /** Refresh interval in seconds (how often to re-warm) */
  refreshInterval?: number;
}

/**
 * Result of a cache warming operation
 */
export interface WarmResult {
  query: string;
  format: string;
  success: boolean;
  error?: string;
  duration: number;
  bytesWritten?: number;
}

/**
 * Status of cache warming
 */
export interface WarmingStatus {
  isRunning: boolean;
  lastWarmTime?: number;
  entriesWarmed: number;
  entriesFailed: number;
  autoRefreshEnabled: boolean;
}

/**
 * Cache warmer for pre-populating cache with common queries
 */
export interface CacheWarmer {
  warmAll(): Promise<WarmResult[]>;
  warmQuery(entry: WarmCacheEntry): Promise<WarmResult>;
  startAutoRefresh(): void;
  stopAutoRefresh(): void;
  getStatus(): WarmingStatus;
}

/**
 * Create a cache warmer for pre-populating common queries
 *
 * @param cacheHandler - QueryCacheHandler instance
 * @param entries - Queries to warm
 * @param queryExecutor - Function to execute a query and return response
 * @param logger - Optional logger
 */
export function createCacheWarmer(
  cacheHandler: QueryCacheHandler,
  entries: WarmCacheEntry[],
  queryExecutor: (query: string, format: string) => Promise<Response>,
  logger?: CacheLogger
): CacheWarmer {
  const log = logger || createNoOpLogger();
  let refreshIntervals: ReturnType<typeof setInterval>[] = [];
  let status: WarmingStatus = {
    isRunning: false,
    entriesWarmed: 0,
    entriesFailed: 0,
    autoRefreshEnabled: false,
  };

  async function warmQuery(entry: WarmCacheEntry): Promise<WarmResult> {
    const startTime = Date.now();
    try {
      log.debug('Warming cache entry', { query: entry.query.substring(0, 100), format: entry.format });

      const response = await queryExecutor(entry.query, entry.format);

      if (!response.ok) {
        const errorMsg = `Query returned status ${response.status}`;
        log.warn('Cache warming failed: query error', { query: entry.query.substring(0, 100), status: response.status });
        return {
          query: entry.query,
          format: entry.format,
          success: false,
          error: errorMsg,
          duration: Date.now() - startTime,
        };
      }

      // Clone response for caching
      const clonedResponse = response.clone();
      const body = await response.text();
      const bytesWritten = new TextEncoder().encode(body).length;

      // Create a new response with the body for caching
      const cacheResponse = new Response(body, {
        status: clonedResponse.status,
        statusText: clonedResponse.statusText,
        headers: clonedResponse.headers,
      });

      await cacheHandler.put(entry.query, entry.format, cacheResponse, {
        ttlSeconds: entry.ttlSeconds || DEFAULT_TTL,
      });

      log.info('Cache entry warmed successfully', {
        query: entry.query.substring(0, 100),
        format: entry.format,
        bytesWritten,
        duration: Date.now() - startTime,
      });

      return {
        query: entry.query,
        format: entry.format,
        success: true,
        duration: Date.now() - startTime,
        bytesWritten,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      log.error('Cache warming failed', err instanceof Error ? err : new Error(errorMessage), {
        query: entry.query.substring(0, 100),
        format: entry.format,
      });

      return {
        query: entry.query,
        format: entry.format,
        success: false,
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    }
  }

  async function warmAll(): Promise<WarmResult[]> {
    status.isRunning = true;
    status.entriesWarmed = 0;
    status.entriesFailed = 0;

    log.info('Starting cache warming', { entryCount: entries.length });

    const results: WarmResult[] = [];
    for (const entry of entries) {
      const result = await warmQuery(entry);
      results.push(result);
      if (result.success) {
        status.entriesWarmed++;
      } else {
        status.entriesFailed++;
      }
    }

    status.isRunning = false;
    status.lastWarmTime = Date.now();

    log.info('Cache warming completed', {
      warmed: status.entriesWarmed,
      failed: status.entriesFailed,
      total: entries.length,
    });

    return results;
  }

  function startAutoRefresh(): void {
    stopAutoRefresh();
    status.autoRefreshEnabled = true;
    log.info('Starting auto-refresh for cache warming');

    for (const entry of entries) {
      if (entry.refreshInterval && entry.refreshInterval > 0) {
        const interval = setInterval(() => warmQuery(entry), entry.refreshInterval * 1000);
        refreshIntervals.push(interval);
      }
    }
  }

  function stopAutoRefresh(): void {
    for (const interval of refreshIntervals) {
      clearInterval(interval);
    }
    refreshIntervals = [];
    status.autoRefreshEnabled = false;
    log.info('Stopped auto-refresh for cache warming');
  }

  function getStatus(): WarmingStatus {
    return { ...status };
  }

  return { warmAll, warmQuery, startAutoRefresh, stopAutoRefresh, getStatus };
}

// ============================================================================
// Extended Metrics
// ============================================================================

/**
 * Extended metrics for production monitoring
 */
export interface CacheMetrics {
  hits: number;
  misses: number;
  bypasses: number;
  staleHits: number;
  hitRatio: number;
  totalOperations: number;
  avgHitTime: number;
  avgMissTime: number;
  errors: number;
  bytesServedFromCache: number;
  bytesWrittenToCache: number;
  lastReset: number;
}

/**
 * Extended metrics collector for production monitoring
 */
export interface MetricsCollector {
  recordHit(responseTime: number, bytes?: number): void;
  recordMiss(responseTime: number): void;
  recordBypass(): void;
  recordStaleHit(responseTime: number, bytes?: number): void;
  recordWrite(bytes: number): void;
  recordError(errorType: string): void;
  getMetrics(): CacheMetrics;
  reset(): void;
  toPrometheus(prefix?: string): string;
}

/**
 * Create a metrics collector for tracking cache performance
 */
export function createMetricsCollector(): MetricsCollector {
  let metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    bypasses: 0,
    staleHits: 0,
    hitRatio: 0,
    totalOperations: 0,
    avgHitTime: 0,
    avgMissTime: 0,
    errors: 0,
    bytesServedFromCache: 0,
    bytesWrittenToCache: 0,
    lastReset: Date.now(),
  };

  let totalHitTime = 0;
  let totalMissTime = 0;

  function updateHitRatio(): void {
    const total = metrics.hits + metrics.misses;
    metrics.hitRatio = total > 0 ? metrics.hits / total : 0;
    metrics.totalOperations = metrics.hits + metrics.misses + metrics.bypasses;
  }

  return {
    recordHit(responseTime: number, bytes?: number): void {
      metrics.hits++;
      totalHitTime += responseTime;
      metrics.avgHitTime = totalHitTime / metrics.hits;
      if (bytes) metrics.bytesServedFromCache += bytes;
      updateHitRatio();
    },

    recordMiss(responseTime: number): void {
      metrics.misses++;
      totalMissTime += responseTime;
      metrics.avgMissTime = totalMissTime / metrics.misses;
      updateHitRatio();
    },

    recordBypass(): void {
      metrics.bypasses++;
      updateHitRatio();
    },

    recordStaleHit(responseTime: number, bytes?: number): void {
      metrics.staleHits++;
      metrics.hits++;
      totalHitTime += responseTime;
      metrics.avgHitTime = totalHitTime / metrics.hits;
      if (bytes) metrics.bytesServedFromCache += bytes;
      updateHitRatio();
    },

    recordWrite(bytes: number): void {
      metrics.bytesWrittenToCache += bytes;
    },

    recordError(_errorType: string): void {
      metrics.errors++;
    },

    getMetrics(): CacheMetrics {
      return { ...metrics };
    },

    reset(): void {
      metrics = {
        hits: 0,
        misses: 0,
        bypasses: 0,
        staleHits: 0,
        hitRatio: 0,
        totalOperations: 0,
        avgHitTime: 0,
        avgMissTime: 0,
        errors: 0,
        bytesServedFromCache: 0,
        bytesWrittenToCache: 0,
        lastReset: Date.now(),
      };
      totalHitTime = 0;
      totalMissTime = 0;
    },

    toPrometheus(prefix: string = 'chdb_cache'): string {
      return [
        `# HELP ${prefix}_hits_total Total number of cache hits`,
        `# TYPE ${prefix}_hits_total counter`,
        `${prefix}_hits_total ${metrics.hits}`,
        `# HELP ${prefix}_misses_total Total number of cache misses`,
        `# TYPE ${prefix}_misses_total counter`,
        `${prefix}_misses_total ${metrics.misses}`,
        `# HELP ${prefix}_bypasses_total Total number of cache bypasses`,
        `# TYPE ${prefix}_bypasses_total counter`,
        `${prefix}_bypasses_total ${metrics.bypasses}`,
        `# HELP ${prefix}_hit_ratio Cache hit ratio`,
        `# TYPE ${prefix}_hit_ratio gauge`,
        `${prefix}_hit_ratio ${metrics.hitRatio.toFixed(4)}`,
        `# HELP ${prefix}_errors_total Total number of cache errors`,
        `# TYPE ${prefix}_errors_total counter`,
        `${prefix}_errors_total ${metrics.errors}`,
        `# HELP ${prefix}_bytes_served_total Total bytes served from cache`,
        `# TYPE ${prefix}_bytes_served_total counter`,
        `${prefix}_bytes_served_total ${metrics.bytesServedFromCache}`,
        `# HELP ${prefix}_avg_hit_time_ms Average response time for cache hits`,
        `# TYPE ${prefix}_avg_hit_time_ms gauge`,
        `${prefix}_avg_hit_time_ms ${metrics.avgHitTime.toFixed(2)}`,
      ].join('\n');
    },
  };
}

// ============================================================================
// Cache Eviction Strategy
// ============================================================================

/**
 * Eviction hint for cache entries
 */
export interface EvictionHint {
  suggestedTtl: number;
  priority: 'low' | 'medium' | 'high';
  reason: string;
}

/**
 * Analyze a query and return eviction hints
 *
 * Since Cloudflare Cache API handles actual eviction, this provides
 * hints for setting appropriate TTLs based on query patterns.
 *
 * @param query - SQL query to analyze
 * @param options - Analysis options
 */
export function getEvictionHint(
  query: string,
  options?: { baselineTtl?: number; maxTtl?: number }
): EvictionHint {
  const baselineTtl = options?.baselineTtl || DEFAULT_TTL;
  const maxTtl = options?.maxTtl || 3600;
  const normalized = normalizeQuery(query);

  // System tables - short TTL
  if (normalized.includes('SYSTEM.') || normalized.includes('INFORMATION_SCHEMA')) {
    return {
      suggestedTtl: Math.min(60, baselineTtl),
      priority: 'low',
      reason: 'System table query - data changes frequently',
    };
  }

  // Aggregation queries - cache longer
  if (normalized.includes('GROUP BY') || normalized.includes('DISTINCT') ||
      normalized.includes('SUM(') || normalized.includes('COUNT(') ||
      normalized.includes('AVG(') || normalized.includes('MAX(') ||
      normalized.includes('MIN(')) {
    return {
      suggestedTtl: Math.min(maxTtl, baselineTtl * 2),
      priority: 'high',
      reason: 'Aggregation query - expensive to compute',
    };
  }

  // Time-dependent queries - very short TTL
  if (normalized.includes('NOW()') || normalized.includes('CURRENT_DATE') ||
      normalized.includes('CURRENT_TIMESTAMP') || normalized.includes('TODAY()')) {
    return {
      suggestedTtl: Math.min(30, baselineTtl),
      priority: 'low',
      reason: 'Time-dependent query - results change frequently',
    };
  }

  // JOIN queries - moderately expensive
  if (normalized.includes(' JOIN ')) {
    return {
      suggestedTtl: Math.min(maxTtl, Math.floor(baselineTtl * 1.5)),
      priority: 'medium',
      reason: 'JOIN query - moderately expensive',
    };
  }

  // Default
  return {
    suggestedTtl: baselineTtl,
    priority: 'medium',
    reason: 'Standard query',
  };
}
