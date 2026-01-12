/**
 * Index Cache - DO-Local Caching for R2/Iceberg Indexes
 *
 * Unified caching layer that stores frequently-accessed indexes locally in DO storage
 * for sub-millisecond access, eliminating the 50-200ms R2 latency for repeated queries.
 *
 * Architecture:
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │  IndexCache                                                                  │
 * │  ┌────────────────────────────┐    ┌───────────────────────────────────────┐│
 * │  │  SQLiteStore               │    │  FsxStore                             ││
 * │  │  (Structured Data)         │    │  (Binary Data)                        ││
 * │  │  • Path statistics         │    │  • HNSW chunks                        ││
 * │  │  • Bloom filter metadata   │    │  • Bloom filter bits                  ││
 * │  │  • Min/max column stats    │    │  • GIN posting lists                  ││
 * │  │  • Partition manifests     │    │  • Serialized indexes                 ││
 * │  │  <1ms JSON access          │    │  <1ms binary access                   ││
 * │  └────────────────────────────┘    └───────────────────────────────────────┘│
 * │                                                                              │
 * │  Cache-Aside Pattern:                                                        │
 * │  1. Check cache → hit? return immediately (<1ms)                             │
 * │  2. Miss? → fetch from R2 (50-200ms) → store in cache → return               │
 * │  3. ETag-based invalidation for freshness                                    │
 * │  4. LRU eviction when storage limit approached                               │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * Cost Analysis:
 * - Cache hit: <1ms, $0.000001 (DO read)
 * - Cache miss: 50-200ms, $0.0004 (R2 read) + cache write
 * - 90% hit rate → 10x latency improvement, significant cost reduction
 *
 * @module db/compat/sql/clickhouse/cache/index-cache
 */

import { SQLiteStore, type IndexEntry, type IndexEntryType, type SQLiteStoreConfig, type StoreStats } from './sqlite-store.js'
import { FsxStore, type BinaryEntry, type BinaryIndexType, type FsxStoreConfig, type FsInterface, type FsxStoreStats } from './fsx-store.js'

// ============================================================================
// Types
// ============================================================================

/** R2 bucket interface for fetching indexes */
export interface R2Interface {
  /** Get object from R2 */
  get(key: string): Promise<R2Object | null>
  /** Get object with conditional fetch */
  get(key: string, options: { onlyIf: R2Conditional }): Promise<R2Object | null>
  /** Head request for metadata only */
  head(key: string): Promise<R2Object | null>
}

/** R2 object interface */
export interface R2Object {
  /** Object key */
  key: string
  /** ETag for cache validation */
  etag: string
  /** Size in bytes */
  size: number
  /** HTTP metadata */
  httpMetadata?: R2HTTPMetadata
  /** Custom metadata */
  customMetadata?: Record<string, string>
  /** Get body as ArrayBuffer */
  arrayBuffer(): Promise<ArrayBuffer>
  /** Get body as text */
  text(): Promise<string>
  /** Get body as JSON */
  json<T>(): Promise<T>
}

/** R2 conditional interface */
export interface R2Conditional {
  /** ETag must match */
  etagMatches?: string
  /** ETag must not match */
  etagDoesNotMatch?: string
}

/** R2 HTTP metadata */
export interface R2HTTPMetadata {
  contentType?: string
  contentLanguage?: string
  contentDisposition?: string
  contentEncoding?: string
  cacheControl?: string
  cacheExpiry?: Date
}

/** Cache entry with metadata */
export interface CacheEntry<T = unknown> {
  /** Entry key */
  key: string
  /** Entry data */
  data: T
  /** Whether this was a cache hit */
  cacheHit: boolean
  /** Access latency in ms */
  latencyMs: number
  /** ETag for validation */
  etag?: string
  /** Source R2 path */
  sourcePath?: string
}

/** Cache statistics */
export interface CacheStats {
  /** SQLite store stats */
  sqlite: StoreStats
  /** FSx store stats */
  fsx: FsxStoreStats
  /** Combined metrics */
  combined: {
    /** Total entries */
    totalEntries: number
    /** Total size in bytes */
    totalSizeBytes: number
    /** Cache hit count */
    hitCount: number
    /** Cache miss count */
    missCount: number
    /** Hit rate (0-1) */
    hitRate: number
    /** Average hit latency (ms) */
    avgHitLatencyMs: number
    /** Average miss latency (ms) */
    avgMissLatencyMs: number
  }
}

/** Configuration for IndexCache */
export interface IndexCacheConfig {
  /** SQLite store configuration */
  sqlite?: SQLiteStoreConfig
  /** FSx store configuration */
  fsx?: FsxStoreConfig
  /** Combined storage limit (default: 150MB) */
  maxTotalSizeBytes?: number
  /** Auto-refresh stale entries (default: true) */
  autoRefresh?: boolean
  /** Max age before considering entry stale (default: 1 hour) */
  maxAgeMs?: number
}

/** Options for get operation */
export interface GetOptions {
  /** Skip cache and force R2 fetch */
  skipCache?: boolean
  /** Force refresh even if cached */
  forceRefresh?: boolean
  /** Custom parser for response */
  parser?: (data: ArrayBuffer | string) => unknown
}

// ============================================================================
// IndexCache Class
// ============================================================================

/**
 * Unified index cache for DO-local storage
 *
 * Implements cache-aside pattern with:
 * - SQLiteStore for structured data (JSON, metadata)
 * - FsxStore for binary data (index chunks, bloom filters)
 * - ETag-based cache invalidation
 * - LRU eviction when approaching storage limits
 *
 * @example
 * ```typescript
 * // Initialize cache
 * const cache = new IndexCache(ctx.storage.sql, $.fs, r2Bucket, {
 *   maxTotalSizeBytes: 150 * 1024 * 1024, // 150MB
 * })
 * await cache.initialize()
 *
 * // Get index with automatic caching
 * const manifest = await cache.getJSON<PartitionManifest>(
 *   'indexes/users/manifest.json',
 *   'partition_manifest'
 * )
 * // First call: ~100ms (R2 fetch + cache write)
 * // Subsequent calls: <1ms (cache hit)
 *
 * // Get binary index chunk
 * const chunk = await cache.getBinary(
 *   'indexes/users/hnsw/chunk-0.bin',
 *   'hnsw_chunk'
 * )
 * ```
 */
export class IndexCache {
  private sqliteStore: SQLiteStore
  private fsxStore: FsxStore
  private r2: R2Interface
  private config: Required<IndexCacheConfig>
  private initialized = false

  // Metrics
  private hitCount = 0
  private missCount = 0
  private totalHitLatencyMs = 0
  private totalMissLatencyMs = 0

  constructor(
    sql: SqlStorage,
    fs: FsInterface,
    r2: R2Interface,
    config: IndexCacheConfig = {}
  ) {
    this.config = {
      sqlite: config.sqlite ?? {},
      fsx: config.fsx ?? {},
      maxTotalSizeBytes: config.maxTotalSizeBytes ?? 150 * 1024 * 1024, // 150MB
      autoRefresh: config.autoRefresh ?? true,
      maxAgeMs: config.maxAgeMs ?? 60 * 60 * 1000, // 1 hour
    }

    // Distribute storage between stores (40% SQLite, 60% FSx by default)
    const sqliteMax = Math.floor(this.config.maxTotalSizeBytes * 0.4)
    const fsxMax = Math.floor(this.config.maxTotalSizeBytes * 0.6)

    this.sqliteStore = new SQLiteStore(sql, {
      maxSizeBytes: config.sqlite?.maxSizeBytes ?? sqliteMax,
      ...config.sqlite,
    })

    this.fsxStore = new FsxStore(sql, fs, {
      maxSizeBytes: config.fsx?.maxSizeBytes ?? fsxMax,
      ...config.fsx,
    })

    this.r2 = r2
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the cache
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    await Promise.all([this.sqliteStore.initialize(), this.fsxStore.initialize()])

    this.initialized = true
  }

  // ===========================================================================
  // JSON Data (SQLite Store)
  // ===========================================================================

  /**
   * Get JSON data with cache-aside pattern
   *
   * @param r2Path - Path in R2 bucket
   * @param type - Index entry type
   * @param options - Get options
   * @returns Cache entry with data and metadata
   */
  async getJSON<T = unknown>(
    r2Path: string,
    type: IndexEntryType,
    options?: GetOptions
  ): Promise<CacheEntry<T>> {
    await this.initialize()

    const startTime = performance.now()
    const cacheKey = `json:${r2Path}`

    // Check cache first (unless skipCache)
    if (!options?.skipCache && !options?.forceRefresh) {
      const cached = await this.sqliteStore.get<T>(cacheKey)

      if (cached) {
        // Check if needs refresh
        if (this.config.autoRefresh && cached.etag) {
          const isStale = await this.isStaleByEtag(r2Path, cached.etag)
          if (!isStale) {
            const latencyMs = performance.now() - startTime
            this.recordHit(latencyMs)

            return {
              key: cacheKey,
              data: cached.data,
              cacheHit: true,
              latencyMs,
              etag: cached.etag,
              sourcePath: r2Path,
            }
          }
          // Entry is stale, fall through to refresh
        } else {
          // No auto-refresh or no etag, use cached value
          const latencyMs = performance.now() - startTime
          this.recordHit(latencyMs)

          return {
            key: cacheKey,
            data: cached.data,
            cacheHit: true,
            latencyMs,
            etag: cached.etag,
            sourcePath: r2Path,
          }
        }
      }
    }

    // Cache miss - fetch from R2
    const r2Object = await this.r2.get(r2Path)

    if (!r2Object) {
      throw new Error(`Index not found in R2: ${r2Path}`)
    }

    // Parse data
    let data: T
    if (options?.parser) {
      const raw = await r2Object.text()
      data = options.parser(raw) as T
    } else {
      data = await r2Object.json<T>()
    }

    // Store in cache
    await this.sqliteStore.set(cacheKey, type, data, {
      etag: r2Object.etag,
      sourcePath: r2Path,
    })

    const latencyMs = performance.now() - startTime
    this.recordMiss(latencyMs)

    return {
      key: cacheKey,
      data,
      cacheHit: false,
      latencyMs,
      etag: r2Object.etag,
      sourcePath: r2Path,
    }
  }

  /**
   * Set JSON data directly (bypass R2)
   *
   * @param key - Cache key
   * @param type - Entry type
   * @param data - Data to cache
   * @param options - Optional etag and source path
   */
  async setJSON<T>(
    key: string,
    type: IndexEntryType,
    data: T,
    options?: { etag?: string; sourcePath?: string }
  ): Promise<void> {
    await this.initialize()
    await this.sqliteStore.set(key, type, data, options)
  }

  /**
   * Get JSON data from cache only (no R2 fallback)
   */
  async getJSONCached<T = unknown>(key: string): Promise<IndexEntry<T> | null> {
    await this.initialize()
    return this.sqliteStore.get<T>(key)
  }

  // ===========================================================================
  // Binary Data (FSx Store)
  // ===========================================================================

  /**
   * Get binary data with cache-aside pattern
   *
   * @param r2Path - Path in R2 bucket
   * @param type - Binary index type
   * @param options - Get options
   * @returns Cache entry with binary data
   */
  async getBinary(
    r2Path: string,
    type: BinaryIndexType,
    options?: GetOptions
  ): Promise<CacheEntry<Uint8Array>> {
    await this.initialize()

    const startTime = performance.now()
    const cacheKey = `bin:${r2Path}`

    // Check cache first
    if (!options?.skipCache && !options?.forceRefresh) {
      const cached = await this.fsxStore.get(cacheKey)

      if (cached) {
        // Check if needs refresh
        if (this.config.autoRefresh && cached.entry.etag) {
          const isStale = await this.isStaleByEtag(r2Path, cached.entry.etag)
          if (!isStale) {
            const latencyMs = performance.now() - startTime
            this.recordHit(latencyMs)

            return {
              key: cacheKey,
              data: cached.data,
              cacheHit: true,
              latencyMs,
              etag: cached.entry.etag,
              sourcePath: r2Path,
            }
          }
        } else {
          const latencyMs = performance.now() - startTime
          this.recordHit(latencyMs)

          return {
            key: cacheKey,
            data: cached.data,
            cacheHit: true,
            latencyMs,
            etag: cached.entry.etag,
            sourcePath: r2Path,
          }
        }
      }
    }

    // Cache miss - fetch from R2
    const r2Object = await this.r2.get(r2Path)

    if (!r2Object) {
      throw new Error(`Index not found in R2: ${r2Path}`)
    }

    const data = new Uint8Array(await r2Object.arrayBuffer())

    // Store in cache
    await this.fsxStore.set(cacheKey, type, data, {
      etag: r2Object.etag,
      sourcePath: r2Path,
    })

    const latencyMs = performance.now() - startTime
    this.recordMiss(latencyMs)

    return {
      key: cacheKey,
      data,
      cacheHit: false,
      latencyMs,
      etag: r2Object.etag,
      sourcePath: r2Path,
    }
  }

  /**
   * Set binary data directly (bypass R2)
   */
  async setBinary(
    key: string,
    type: BinaryIndexType,
    data: Uint8Array,
    options?: { etag?: string; sourcePath?: string; metadata?: Record<string, unknown> }
  ): Promise<void> {
    await this.initialize()
    await this.fsxStore.set(key, type, data, options)
  }

  /**
   * Get binary data from cache only (no R2 fallback)
   */
  async getBinaryCached(key: string): Promise<{ data: Uint8Array; entry: BinaryEntry } | null> {
    await this.initialize()
    return this.fsxStore.get(key)
  }

  // ===========================================================================
  // Prefetching
  // ===========================================================================

  /**
   * Prefetch multiple indexes into cache
   *
   * @param items - Array of items to prefetch
   * @returns Results for each item
   */
  async prefetch(
    items: Array<{
      r2Path: string
      type: IndexEntryType | BinaryIndexType
      isBinary: boolean
    }>
  ): Promise<Array<{ r2Path: string; success: boolean; error?: string }>> {
    await this.initialize()

    const results = await Promise.allSettled(
      items.map(async (item) => {
        if (item.isBinary) {
          await this.getBinary(item.r2Path, item.type as BinaryIndexType)
        } else {
          await this.getJSON(item.r2Path, item.type as IndexEntryType)
        }
        return item.r2Path
      })
    )

    return results.map((result, i) => ({
      r2Path: items[i]!.r2Path,
      success: result.status === 'fulfilled',
      error: result.status === 'rejected' ? String(result.reason) : undefined,
    }))
  }

  // ===========================================================================
  // Cache Invalidation
  // ===========================================================================

  /**
   * Check if entry is stale using ETag
   */
  private async isStaleByEtag(r2Path: string, cachedEtag: string): Promise<boolean> {
    try {
      const head = await this.r2.head(r2Path)
      if (!head) return true
      return head.etag !== cachedEtag
    } catch {
      // On error, assume not stale to avoid unnecessary fetches
      return false
    }
  }

  /**
   * Invalidate a specific cache entry
   */
  async invalidate(key: string): Promise<boolean> {
    await this.initialize()

    if (key.startsWith('json:')) {
      return this.sqliteStore.delete(key)
    } else if (key.startsWith('bin:')) {
      return this.fsxStore.delete(key)
    }

    // Try both stores
    const jsonDeleted = await this.sqliteStore.delete(key)
    const binDeleted = await this.fsxStore.delete(key)
    return jsonDeleted || binDeleted
  }

  /**
   * Invalidate all entries from a source path
   */
  async invalidateBySource(sourcePath: string): Promise<number> {
    await this.initialize()

    const jsonCount = await this.sqliteStore.invalidateBySource(sourcePath)
    const binCount = await this.fsxStore.invalidateBySource(sourcePath)

    return jsonCount + binCount
  }

  /**
   * Invalidate entries matching a path pattern
   */
  async invalidateByPattern(pattern: string): Promise<number> {
    await this.initialize()

    // Get all matching entries from SQLite
    const jsonEntries = await this.sqliteStore.getBySourcePath(pattern)
    let count = 0

    for (const entry of jsonEntries) {
      if (await this.sqliteStore.delete(entry.key)) {
        count++
      }
    }

    // Get all matching entries from FSx
    const binEntries = await this.fsxStore.getBySourcePath(pattern)

    for (const entry of binEntries) {
      if (await this.fsxStore.delete(entry.key)) {
        count++
      }
    }

    return count
  }

  // ===========================================================================
  // Eviction
  // ===========================================================================

  /**
   * Trigger eviction on both stores
   */
  async evict(): Promise<{ sqlite: number; fsx: number }> {
    await this.initialize()

    const sqliteEvicted = await this.sqliteStore.evict()
    const fsxEvicted = await this.fsxStore.evict()

    return {
      sqlite: sqliteEvicted,
      fsx: fsxEvicted,
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<{ sqlite: number; fsx: number }> {
    await this.initialize()

    const sqliteCleared = await this.sqliteStore.clear()
    const fsxCleared = await this.fsxStore.clear()

    // Reset metrics
    this.hitCount = 0
    this.missCount = 0
    this.totalHitLatencyMs = 0
    this.totalMissLatencyMs = 0

    return {
      sqlite: sqliteCleared,
      fsx: fsxCleared,
    }
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get comprehensive cache statistics
   */
  async getStats(): Promise<CacheStats> {
    await this.initialize()

    const sqliteStats = await this.sqliteStore.getStats()
    const fsxStats = await this.fsxStore.getStats()

    const totalRequests = this.hitCount + this.missCount

    return {
      sqlite: sqliteStats,
      fsx: fsxStats,
      combined: {
        totalEntries: sqliteStats.entryCount + fsxStats.entryCount,
        totalSizeBytes: sqliteStats.totalSizeBytes + fsxStats.totalSizeBytes,
        hitCount: this.hitCount,
        missCount: this.missCount,
        hitRate: totalRequests > 0 ? this.hitCount / totalRequests : 0,
        avgHitLatencyMs: this.hitCount > 0 ? this.totalHitLatencyMs / this.hitCount : 0,
        avgMissLatencyMs: this.missCount > 0 ? this.totalMissLatencyMs / this.missCount : 0,
      },
    }
  }

  /**
   * Get current utilization (0-1)
   */
  async getUtilization(): Promise<{
    sqlite: number
    fsx: number
    combined: number
  }> {
    await this.initialize()

    const sqliteUtil = await this.sqliteStore.getUtilization()
    const fsxUtil = await this.fsxStore.getUtilization()

    const sqliteStats = await this.sqliteStore.getStats()
    const fsxStats = await this.fsxStore.getStats()

    const totalSize = sqliteStats.totalSizeBytes + fsxStats.totalSizeBytes
    const combinedUtil = totalSize / this.config.maxTotalSizeBytes

    return {
      sqlite: sqliteUtil,
      fsx: fsxUtil,
      combined: combinedUtil,
    }
  }

  // ===========================================================================
  // Metrics Helpers
  // ===========================================================================

  private recordHit(latencyMs: number): void {
    this.hitCount++
    this.totalHitLatencyMs += latencyMs
  }

  private recordMiss(latencyMs: number): void {
    this.missCount++
    this.totalMissLatencyMs += latencyMs
  }

  /**
   * Reset metrics counters
   */
  resetMetrics(): void {
    this.hitCount = 0
    this.missCount = 0
    this.totalHitLatencyMs = 0
    this.totalMissLatencyMs = 0
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an IndexCache instance with default configuration
 *
 * @example
 * ```typescript
 * // In a Durable Object
 * class MyDO extends DurableObject {
 *   private cache: IndexCache
 *
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     super(ctx, env)
 *     this.cache = createIndexCache(ctx.storage.sql, $.fs, env.INDEXES_BUCKET)
 *   }
 *
 *   async query(sql: string) {
 *     // Get cached partition manifest
 *     const manifest = await this.cache.getJSON<PartitionManifest>(
 *       'indexes/partitions.json',
 *       'partition_manifest'
 *     )
 *     // ... use manifest for query optimization
 *   }
 * }
 * ```
 */
export function createIndexCache(
  sql: SqlStorage,
  fs: FsInterface,
  r2: R2Interface,
  config?: IndexCacheConfig
): IndexCache {
  return new IndexCache(sql, fs, r2, config)
}

// ============================================================================
// Re-exports
// ============================================================================

export { SQLiteStore, type IndexEntry, type IndexEntryType, type SQLiteStoreConfig, type StoreStats }
export { FsxStore, type BinaryEntry, type BinaryIndexType, type FsxStoreConfig, type FsInterface, type FsxStoreStats }
