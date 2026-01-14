/**
 * DO-Local Index Caching
 *
 * Cache R2/Iceberg indexes locally in DO for sub-ms access.
 *
 * Problem: Reading indexes from R2 adds 50-200ms latency per query.
 * Solution: Store frequently-accessed indexes in DO storage:
 * - SQLiteStore: For structured index data (path stats, bloom filters)
 * - FsxStore: For binary index files (HNSW chunks, GIN postings)
 *
 * @example
 * ```typescript
 * import { IndexCache, createIndexCache } from 'dotdo/db/compat/sql/clickhouse/cache'
 *
 * // Create cache instance
 * const cache = createIndexCache(ctx.storage.sql, $.fs, env.R2_BUCKET, {
 *   maxTotalSizeBytes: 150 * 1024 * 1024, // 150MB limit
 * })
 * await cache.initialize()
 *
 * // Get index with automatic caching
 * const manifest = await cache.getJSON<PartitionManifest>(
 *   'indexes/manifest.json',
 *   'partition_manifest'
 * )
 * // First call: ~100ms (R2 fetch)
 * // Subsequent calls: <1ms (cache hit)
 *
 * // Get vector index chunk
 * const chunk = await cache.getBinary(
 *   'indexes/hnsw/chunk-0.bin',
 *   'hnsw_chunk'
 * )
 * ```
 *
 * @module db/compat/sql/clickhouse/cache
 */

// Main cache
export {
  IndexCache,
  createIndexCache,
  type CacheEntry,
  type CacheStats,
  type IndexCacheConfig,
  type GetOptions,
  type R2Interface,
  type R2Object,
  type R2Conditional,
  type R2HTTPMetadata,
} from './index-cache.js'

// SQLite store for structured data
export {
  SQLiteStore,
  type IndexEntry,
  type IndexEntryType,
  type SQLiteStoreConfig,
  type StoreStats,
} from './sqlite-store.js'

// FSx store for binary data
export {
  FsxStore,
  type BinaryEntry,
  type BinaryIndexType,
  type FsxStoreConfig,
  type FsInterface,
  type FsxStoreStats,
} from './fsx-store.js'
