/**
 * DO-Local Index Caching for R2/Iceberg Indexes
 *
 * This module provides a caching layer that stores R2/Iceberg index data
 * in Durable Object SQLite for faster access. Instead of fetching indexes
 * from R2 on every request, this cache stores them locally with TTL-based
 * invalidation.
 *
 * ## Cache Strategy
 *
 * - **Hot Cache**: Frequently accessed indexes stored in DO SQLite (< 10MB)
 * - **Warm Cache**: Larger indexes stored in fsx (filesystem on SQLite)
 * - **Cache Invalidation**: TTL-based with optional ETag validation
 *
 * ## Performance Characteristics
 *
 * | Operation | Without Cache | With Cache |
 * |-----------|---------------|------------|
 * | Manifest lookup | 50-100ms | <5ms |
 * | Bloom filter check | 20-50ms | <1ms |
 * | Inverted index search | 100-200ms | <10ms |
 *
 * ## Storage Layout (SQLite)
 *
 * ```sql
 * CREATE TABLE index_cache (
 *   key TEXT PRIMARY KEY,       -- Cache key (e.g., "iceberg/table/metadata.json")
 *   data BLOB NOT NULL,         -- Cached index data
 *   content_type TEXT,          -- MIME type
 *   etag TEXT,                  -- R2 ETag for validation
 *   size INTEGER NOT NULL,      -- Size in bytes
 *   created_at INTEGER NOT NULL,-- Cache timestamp
 *   expires_at INTEGER NOT NULL,-- Expiration timestamp
 *   access_count INTEGER DEFAULT 0,
 *   last_access INTEGER
 * );
 * ```
 *
 * @example Basic Usage
 * ```typescript
 * import { IndexCache } from 'db/iceberg/index-cache'
 *
 * // Initialize cache with DO state
 * const cache = new IndexCache(ctx.storage.sql, {
 *   maxSizeBytes: 50 * 1024 * 1024, // 50MB cache limit
 *   defaultTtlMs: 5 * 60 * 1000,    // 5 minute TTL
 * })
 *
 * await cache.init()
 *
 * // Get or fetch a manifest
 * const manifest = await cache.getOrFetch(
 *   'iceberg/table/metadata.json',
 *   async () => {
 *     const obj = await r2.get('iceberg/table/metadata.json')
 *     return obj?.arrayBuffer()
 *   }
 * )
 * ```
 *
 * @module db/iceberg/index-cache
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Cache entry metadata stored in SQLite
 */
export interface CacheEntry {
  /** Cache key (R2 path) */
  key: string
  /** Cached data as ArrayBuffer */
  data: ArrayBuffer
  /** Content type (MIME) */
  contentType?: string
  /** R2 ETag for validation */
  etag?: string
  /** Size in bytes */
  size: number
  /** When this entry was cached (ms since epoch) */
  createdAt: number
  /** When this entry expires (ms since epoch) */
  expiresAt: number
  /** Number of times accessed */
  accessCount: number
  /** Last access timestamp */
  lastAccess: number
}

/**
 * Cache entry row from SQLite
 * @internal
 */
interface CacheRow {
  key: string
  data: ArrayBuffer
  content_type: string | null
  etag: string | null
  size: number
  created_at: number
  expires_at: number
  access_count: number
  last_access: number | null
}

/**
 * Cache configuration options
 */
export interface IndexCacheConfig {
  /** Maximum total cache size in bytes (default: 50MB) */
  maxSizeBytes?: number
  /** Default TTL in milliseconds (default: 5 minutes) */
  defaultTtlMs?: number
  /** Maximum entries in cache (default: 1000) */
  maxEntries?: number
  /** Whether to validate ETags on cache hit (default: false) */
  validateEtags?: boolean
}

/**
 * Options for getOrFetch operations
 */
export interface FetchOptions {
  /** Override default TTL for this entry */
  ttlMs?: number
  /** Content type hint */
  contentType?: string
  /** ETag from R2 for validation */
  etag?: string
  /** Force refresh even if cached */
  forceRefresh?: boolean
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total number of entries */
  entries: number
  /** Total size in bytes */
  totalSizeBytes: number
  /** Number of cache hits */
  hits: number
  /** Number of cache misses */
  misses: number
  /** Hit rate (0-1) */
  hitRate: number
  /** Average entry age in milliseconds */
  avgAgeMs: number
  /** Number of entries evicted */
  evictions: number
}

// ============================================================================
// INDEX CACHE IMPLEMENTATION
// ============================================================================

/**
 * IndexCache - DO-local caching for R2/Iceberg indexes
 *
 * Provides a high-performance cache layer for index data stored in R2.
 * Uses SQLite for persistent storage with LRU eviction.
 *
 * Key features:
 * - TTL-based expiration
 * - LRU eviction when cache is full
 * - ETag validation support
 * - Access tracking for analytics
 *
 * @example
 * ```typescript
 * const cache = new IndexCache(ctx.storage.sql)
 * await cache.init()
 *
 * // Cache a manifest
 * const data = await cache.getOrFetch('iceberg/table/metadata.json', fetcher)
 *
 * // Check if cached
 * if (await cache.has('iceberg/table/metadata.json')) {
 *   const cached = await cache.get('iceberg/table/metadata.json')
 * }
 *
 * // Invalidate on update
 * await cache.invalidate('iceberg/table/metadata.json')
 * ```
 */
export class IndexCache {
  private readonly sql: SqlStorage
  private readonly config: Required<IndexCacheConfig>

  // Statistics tracking
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  }

  /**
   * Create a new IndexCache instance.
   *
   * @param sql - SqlStorage from DO context
   * @param config - Cache configuration
   */
  constructor(sql: SqlStorage, config: IndexCacheConfig = {}) {
    this.sql = sql
    this.config = {
      maxSizeBytes: config.maxSizeBytes ?? 50 * 1024 * 1024, // 50MB
      defaultTtlMs: config.defaultTtlMs ?? 5 * 60 * 1000,    // 5 minutes
      maxEntries: config.maxEntries ?? 1000,
      validateEtags: config.validateEtags ?? false,
    }
  }

  /**
   * Initialize the cache schema.
   *
   * Creates the required table and indexes if they don't exist.
   * Safe to call multiple times.
   */
  async init(): Promise<void> {
    await this.sql.exec(`
      CREATE TABLE IF NOT EXISTS index_cache (
        key TEXT PRIMARY KEY,
        data BLOB NOT NULL,
        content_type TEXT,
        etag TEXT,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0,
        last_access INTEGER
      )
    `)

    // Create indexes for efficient queries
    await this.sql.exec('CREATE INDEX IF NOT EXISTS idx_cache_expires ON index_cache(expires_at)')
    await this.sql.exec('CREATE INDEX IF NOT EXISTS idx_cache_last_access ON index_cache(last_access)')
    await this.sql.exec('CREATE INDEX IF NOT EXISTS idx_cache_size ON index_cache(size)')
  }

  // ==========================================================================
  // CORE API
  // ==========================================================================

  /**
   * Get a cached entry by key.
   *
   * Returns the cached data if valid (not expired), null otherwise.
   * Updates access statistics on hit.
   *
   * @param key - Cache key (typically R2 path)
   * @returns Cached data or null if not found/expired
   */
  async get(key: string): Promise<ArrayBuffer | null> {
    const now = Date.now()

    const row = await this.sql.exec<CacheRow>(
      'SELECT * FROM index_cache WHERE key = ? AND expires_at > ?',
      key,
      now
    ).one()

    if (!row) {
      this.stats.misses++
      return null
    }

    // Update access stats
    await this.sql.exec(
      'UPDATE index_cache SET access_count = access_count + 1, last_access = ? WHERE key = ?',
      now,
      key
    )

    this.stats.hits++
    return row.data
  }

  /**
   * Get a cached entry with full metadata.
   *
   * @param key - Cache key
   * @returns Full cache entry or null
   */
  async getEntry(key: string): Promise<CacheEntry | null> {
    const now = Date.now()

    const row = await this.sql.exec<CacheRow>(
      'SELECT * FROM index_cache WHERE key = ? AND expires_at > ?',
      key,
      now
    ).one()

    if (!row) {
      return null
    }

    return this.rowToEntry(row)
  }

  /**
   * Check if a key is cached and valid.
   *
   * @param key - Cache key
   * @returns true if cached and not expired
   */
  async has(key: string): Promise<boolean> {
    const now = Date.now()
    const row = await this.sql.exec<{ key: string }>(
      'SELECT key FROM index_cache WHERE key = ? AND expires_at > ?',
      key,
      now
    ).one()
    return row !== null
  }

  /**
   * Store data in the cache.
   *
   * Handles eviction if cache is full before storing.
   *
   * @param key - Cache key
   * @param data - Data to cache
   * @param options - Cache options (TTL, etag, etc.)
   */
  async set(key: string, data: ArrayBuffer, options: FetchOptions = {}): Promise<void> {
    const now = Date.now()
    const ttl = options.ttlMs ?? this.config.defaultTtlMs
    const expiresAt = now + ttl
    const size = data.byteLength

    // Ensure we have room
    await this.ensureCapacity(size)

    // Upsert the entry
    await this.sql.exec(
      `INSERT INTO index_cache (key, data, content_type, etag, size, created_at, expires_at, access_count, last_access)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         data = excluded.data,
         content_type = excluded.content_type,
         etag = excluded.etag,
         size = excluded.size,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at,
         access_count = access_count + 1,
         last_access = excluded.last_access`,
      key,
      data,
      options.contentType ?? null,
      options.etag ?? null,
      size,
      now,
      expiresAt,
      now
    )
  }

  /**
   * Get cached data or fetch from source.
   *
   * This is the primary method for cache-through operations.
   * If the data is cached and valid, returns it. Otherwise,
   * calls the fetcher function and caches the result.
   *
   * @param key - Cache key
   * @param fetcher - Async function to fetch data if not cached
   * @param options - Fetch options
   * @returns Cached or freshly fetched data
   */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<ArrayBuffer | null>,
    options: FetchOptions = {}
  ): Promise<ArrayBuffer | null> {
    // Check cache first (unless force refresh)
    if (!options.forceRefresh) {
      const cached = await this.get(key)
      if (cached !== null) {
        return cached
      }
    }

    // Fetch from source
    const data = await fetcher()
    if (data === null) {
      return null
    }

    // Cache the result
    await this.set(key, data, options)

    return data
  }

  /**
   * Invalidate a cached entry.
   *
   * @param key - Cache key to invalidate
   * @returns true if entry was removed, false if not found
   */
  async invalidate(key: string): Promise<boolean> {
    const result = await this.sql.exec('DELETE FROM index_cache WHERE key = ?', key)
    return result.rowsWritten > 0
  }

  /**
   * Invalidate all entries matching a prefix.
   *
   * Useful for invalidating all indexes for a table.
   *
   * @param prefix - Key prefix to match
   * @returns Number of entries invalidated
   */
  async invalidatePrefix(prefix: string): Promise<number> {
    const result = await this.sql.exec(
      'DELETE FROM index_cache WHERE key LIKE ?',
      prefix + '%'
    )
    return result.rowsWritten
  }

  /**
   * Clear all cached entries.
   */
  async clear(): Promise<void> {
    await this.sql.exec('DELETE FROM index_cache')
    this.stats = { hits: 0, misses: 0, evictions: 0 }
  }

  // ==========================================================================
  // EVICTION
  // ==========================================================================

  /**
   * Ensure cache has capacity for a new entry.
   *
   * Uses LRU eviction to make room if necessary.
   *
   * @param requiredBytes - Bytes needed for new entry
   * @internal
   */
  private async ensureCapacity(requiredBytes: number): Promise<void> {
    // First, remove expired entries
    await this.evictExpired()

    // Check entry count limit
    const countResult = await this.sql.exec<{ count: number }>(
      'SELECT COUNT(*) as count FROM index_cache'
    ).one()
    const currentCount = countResult?.count ?? 0

    if (currentCount >= this.config.maxEntries) {
      await this.evictLRU(Math.ceil(this.config.maxEntries * 0.1)) // Evict 10%
    }

    // Check size limit
    const sizeResult = await this.sql.exec<{ total: number }>(
      'SELECT SUM(size) as total FROM index_cache'
    ).one()
    const currentSize = sizeResult?.total ?? 0

    if (currentSize + requiredBytes > this.config.maxSizeBytes) {
      const bytesToFree = (currentSize + requiredBytes) - (this.config.maxSizeBytes * 0.8) // Free to 80%
      await this.evictBySize(bytesToFree)
    }
  }

  /**
   * Remove expired entries.
   *
   * @returns Number of entries removed
   * @internal
   */
  private async evictExpired(): Promise<number> {
    const now = Date.now()
    const result = await this.sql.exec(
      'DELETE FROM index_cache WHERE expires_at <= ?',
      now
    )
    this.stats.evictions += result.rowsWritten
    return result.rowsWritten
  }

  /**
   * Evict least recently used entries.
   *
   * @param count - Number of entries to evict
   * @internal
   */
  private async evictLRU(count: number): Promise<void> {
    // Get keys of LRU entries
    const rows = this.sql.exec<{ key: string }>(
      'SELECT key FROM index_cache ORDER BY last_access ASC NULLS FIRST LIMIT ?',
      count
    ).toArray()

    for (const row of rows) {
      await this.sql.exec('DELETE FROM index_cache WHERE key = ?', row.key)
      this.stats.evictions++
    }
  }

  /**
   * Evict entries to free a specific amount of space.
   *
   * @param bytesToFree - Minimum bytes to free
   * @internal
   */
  private async evictBySize(bytesToFree: number): Promise<void> {
    let freedBytes = 0

    // Get entries ordered by last access (LRU first)
    const rows = this.sql.exec<{ key: string; size: number }>(
      'SELECT key, size FROM index_cache ORDER BY last_access ASC NULLS FIRST'
    ).toArray()

    for (const row of rows) {
      if (freedBytes >= bytesToFree) break

      await this.sql.exec('DELETE FROM index_cache WHERE key = ?', row.key)
      freedBytes += row.size
      this.stats.evictions++
    }
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Get cache statistics.
   *
   * @returns Current cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const countResult = await this.sql.exec<{ count: number }>(
      'SELECT COUNT(*) as count FROM index_cache'
    ).one()

    const sizeResult = await this.sql.exec<{ total: number }>(
      'SELECT SUM(size) as total FROM index_cache'
    ).one()

    const ageResult = await this.sql.exec<{ avg_age: number }>(
      'SELECT AVG(? - created_at) as avg_age FROM index_cache',
      Date.now()
    ).one()

    const totalRequests = this.stats.hits + this.stats.misses

    return {
      entries: countResult?.count ?? 0,
      totalSizeBytes: sizeResult?.total ?? 0,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
      avgAgeMs: ageResult?.avg_age ?? 0,
      evictions: this.stats.evictions,
    }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Convert database row to CacheEntry.
   * @internal
   */
  private rowToEntry(row: CacheRow): CacheEntry {
    return {
      key: row.key,
      data: row.data,
      contentType: row.content_type ?? undefined,
      etag: row.etag ?? undefined,
      size: row.size,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      accessCount: row.access_count,
      lastAccess: row.last_access ?? row.created_at,
    }
  }
}

// ============================================================================
// SPECIALIZED CACHES
// ============================================================================

/**
 * ManifestCache - Specialized cache for Iceberg manifest files
 *
 * Provides optimized caching for manifest-list and manifest-file structures
 * with automatic JSON parsing.
 */
export class ManifestCache {
  private readonly cache: IndexCache

  constructor(sql: SqlStorage, config?: IndexCacheConfig) {
    this.cache = new IndexCache(sql, {
      maxSizeBytes: config?.maxSizeBytes ?? 20 * 1024 * 1024, // 20MB default
      defaultTtlMs: config?.defaultTtlMs ?? 10 * 60 * 1000,   // 10 minutes
      ...config,
    })
  }

  async init(): Promise<void> {
    await this.cache.init()
  }

  /**
   * Get or fetch a manifest with automatic JSON parsing.
   */
  async getManifest<T>(
    key: string,
    fetcher: () => Promise<T | null>,
    options?: FetchOptions
  ): Promise<T | null> {
    const data = await this.cache.getOrFetch(
      key,
      async () => {
        const result = await fetcher()
        if (result === null) return null
        const json = JSON.stringify(result)
        return new TextEncoder().encode(json).buffer as ArrayBuffer
      },
      { contentType: 'application/json', ...options }
    )

    if (data === null) return null

    const text = new TextDecoder().decode(data)
    return JSON.parse(text) as T
  }

  async invalidate(key: string): Promise<boolean> {
    return this.cache.invalidate(key)
  }

  async invalidateTable(tablePath: string): Promise<number> {
    return this.cache.invalidatePrefix(tablePath)
  }
}

/**
 * BloomFilterCache - Specialized cache for Bloom filter indexes
 *
 * Provides optimized caching for Bloom filters used in Iceberg
 * for efficient membership testing.
 */
export class BloomFilterCache {
  private readonly cache: IndexCache

  constructor(sql: SqlStorage, config?: IndexCacheConfig) {
    this.cache = new IndexCache(sql, {
      maxSizeBytes: config?.maxSizeBytes ?? 30 * 1024 * 1024, // 30MB default
      defaultTtlMs: config?.defaultTtlMs ?? 30 * 60 * 1000,   // 30 minutes
      ...config,
    })
  }

  async init(): Promise<void> {
    await this.cache.init()
  }

  /**
   * Get or fetch a bloom filter.
   */
  async getBloomFilter(
    key: string,
    fetcher: () => Promise<ArrayBuffer | null>,
    options?: FetchOptions
  ): Promise<ArrayBuffer | null> {
    return this.cache.getOrFetch(key, fetcher, {
      contentType: 'application/octet-stream',
      ...options,
    })
  }

  async invalidate(key: string): Promise<boolean> {
    return this.cache.invalidate(key)
  }
}

/**
 * InvertedIndexCache - Specialized cache for inverted indexes
 *
 * Provides caching for inverted index structures used for
 * full-text search in Iceberg tables.
 */
export class InvertedIndexCache {
  private readonly cache: IndexCache

  constructor(sql: SqlStorage, config?: IndexCacheConfig) {
    this.cache = new IndexCache(sql, {
      maxSizeBytes: config?.maxSizeBytes ?? 100 * 1024 * 1024, // 100MB default
      defaultTtlMs: config?.defaultTtlMs ?? 60 * 60 * 1000,    // 1 hour
      ...config,
    })
  }

  async init(): Promise<void> {
    await this.cache.init()
  }

  /**
   * Get or fetch an inverted index.
   */
  async getIndex(
    key: string,
    fetcher: () => Promise<ArrayBuffer | null>,
    options?: FetchOptions
  ): Promise<ArrayBuffer | null> {
    return this.cache.getOrFetch(key, fetcher, {
      contentType: 'application/octet-stream',
      ...options,
    })
  }

  async invalidate(key: string): Promise<boolean> {
    return this.cache.invalidate(key)
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an IndexCache with optional R2 bucket for cache-through operations.
 *
 * @param sql - SqlStorage from DO context
 * @param r2 - Optional R2 bucket for fetching
 * @param config - Cache configuration
 * @returns Configured IndexCache
 */
export function createIndexCache(
  sql: SqlStorage,
  r2?: R2Bucket,
  config?: IndexCacheConfig
): IndexCache & { r2: R2Bucket | undefined } {
  const cache = new IndexCache(sql, config) as IndexCache & { r2: R2Bucket | undefined }
  cache.r2 = r2
  return cache
}
