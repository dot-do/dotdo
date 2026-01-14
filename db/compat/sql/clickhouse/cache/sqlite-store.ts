/**
 * SQLite Store for DO-Local Index Caching
 *
 * Stores structured index data in DO SQLite for sub-ms access:
 * - Path statistics (row counts, size bounds)
 * - Bloom filter metadata
 * - Min/max column statistics
 * - Partition manifests
 *
 * Architecture:
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  SQLiteStore (DO SQLite)                                         │
 * │  ┌────────────────────────────┐  ┌─────────────────────────────┐│
 * │  │ index_entries              │  │ index_stats                 ││
 * │  │ • key (PRIMARY KEY)        │  │ • total_size                ││
 * │  │ • type (path_stats, bloom) │  │ • entry_count               ││
 * │  │ • data (JSON)              │  │ • last_updated              ││
 * │  │ • size_bytes               │  │ • last_eviction             ││
 * │  │ • access_count             │  │                             ││
 * │  │ • last_accessed            │  │                             ││
 * │  │ • etag                     │  │                             ││
 * │  └────────────────────────────┘  └─────────────────────────────┘│
 * │  <1ms access latency                                            │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * @module db/compat/sql/clickhouse/cache/sqlite-store
 */

// ============================================================================
// Types
// ============================================================================

/** Supported index entry types */
export type IndexEntryType =
  | 'path_stats' // Statistics for a specific path/partition
  | 'bloom_filter' // Bloom filter data for a column
  | 'minmax_stats' // Min/max statistics for column ranges
  | 'partition_manifest' // Iceberg partition manifest
  | 'column_index' // Column-level index metadata
  | 'custom' // User-defined index data

/** Index entry stored in SQLite */
export interface IndexEntry<T = unknown> {
  /** Unique key for the entry */
  key: string
  /** Type of index entry */
  type: IndexEntryType
  /** Entry data (stored as JSON) */
  data: T
  /** Size in bytes (for LRU eviction) */
  sizeBytes: number
  /** Access count (for LRU scoring) */
  accessCount: number
  /** Last access timestamp (ms) */
  lastAccessed: number
  /** Creation timestamp (ms) */
  createdAt: number
  /** ETag from R2 for cache invalidation */
  etag?: string
  /** Source R2 path */
  sourcePath?: string
}

/** Storage statistics */
export interface StoreStats {
  /** Total entries */
  entryCount: number
  /** Total size in bytes */
  totalSizeBytes: number
  /** Entries by type */
  entriesByType: Record<IndexEntryType, number>
  /** Last eviction timestamp */
  lastEviction: number | null
  /** Last update timestamp */
  lastUpdated: number
}

/** Configuration for SQLiteStore */
export interface SQLiteStoreConfig {
  /** Maximum storage size in bytes (default: 50MB) */
  maxSizeBytes?: number
  /** Target size after eviction (default: 80% of max) */
  evictionTargetRatio?: number
  /** Minimum entries to keep (default: 10) */
  minEntries?: number
}

// ============================================================================
// Internal Types
// ============================================================================

interface IndexEntryRow {
  key: string
  type: string
  data: string
  size_bytes: number
  access_count: number
  last_accessed: number
  created_at: number
  etag: string | null
  source_path: string | null
  [k: string]: SqlStorageValue
}

interface StoreStatsRow {
  total_size: number
  entry_count: number
  last_updated: number
  last_eviction: number | null
  [k: string]: SqlStorageValue
}

interface TypeCountRow {
  type: string
  count: number
  [k: string]: SqlStorageValue
}

// ============================================================================
// Schema
// ============================================================================

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS index_entries (
    key TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    etag TEXT,
    source_path TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_entries_type ON index_entries(type);
  CREATE INDEX IF NOT EXISTS idx_entries_last_accessed ON index_entries(last_accessed);
  CREATE INDEX IF NOT EXISTS idx_entries_source_path ON index_entries(source_path);

  CREATE TABLE IF NOT EXISTS index_stats (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    total_size INTEGER NOT NULL DEFAULT 0,
    entry_count INTEGER NOT NULL DEFAULT 0,
    last_updated INTEGER NOT NULL,
    last_eviction INTEGER
  );
`

// ============================================================================
// SQLiteStore Class
// ============================================================================

/**
 * SQLite-backed store for structured index data
 *
 * Provides sub-millisecond access to cached index data with:
 * - Automatic LRU eviction when storage limit is reached
 * - ETag-based cache invalidation
 * - Access count tracking for intelligent eviction
 *
 * @example
 * ```typescript
 * const store = new SQLiteStore(ctx.storage.sql, {
 *   maxSizeBytes: 50 * 1024 * 1024, // 50MB
 * })
 * await store.initialize()
 *
 * // Store path statistics
 * await store.set('path:users/2024-01', 'path_stats', {
 *   rowCount: 1000000,
 *   minDate: '2024-01-01',
 *   maxDate: '2024-01-31',
 * }, { etag: 'abc123', sourcePath: 'indexes/users/manifest.json' })
 *
 * // Retrieve with sub-ms latency
 * const stats = await store.get('path:users/2024-01')
 * ```
 */
export class SQLiteStore {
  private sql: SqlStorage
  private config: Required<SQLiteStoreConfig>
  private initialized = false

  constructor(sql: SqlStorage, config: SQLiteStoreConfig = {}) {
    this.sql = sql
    this.config = {
      maxSizeBytes: config.maxSizeBytes ?? 50 * 1024 * 1024, // 50MB
      evictionTargetRatio: config.evictionTargetRatio ?? 0.8,
      minEntries: config.minEntries ?? 10,
    }
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the store schema
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    await this.sql.exec(SCHEMA)

    // Initialize stats row if not exists
    const stats = this.sql.exec<StoreStatsRow>('SELECT * FROM index_stats WHERE id = 1').one()
    if (!stats) {
      await this.sql.exec(
        'INSERT INTO index_stats (id, total_size, entry_count, last_updated) VALUES (1, 0, 0, ?)',
        Date.now()
      )
    }

    this.initialized = true
  }

  // ===========================================================================
  // Core Operations
  // ===========================================================================

  /**
   * Get an entry by key
   *
   * @param key - Entry key
   * @returns Entry data or null if not found
   *
   * Time complexity: O(1) - Direct primary key lookup
   */
  async get<T = unknown>(key: string): Promise<IndexEntry<T> | null> {
    await this.initialize()

    const row = this.sql.exec<IndexEntryRow>('SELECT * FROM index_entries WHERE key = ?', key).one()

    if (!row) return null

    // Update access statistics
    const now = Date.now()
    this.sql.exec(
      'UPDATE index_entries SET access_count = access_count + 1, last_accessed = ? WHERE key = ?',
      now,
      key
    )

    return this.rowToEntry<T>(row)
  }

  /**
   * Set an entry
   *
   * @param key - Entry key
   * @param type - Entry type
   * @param data - Entry data
   * @param options - Additional options (etag, sourcePath)
   *
   * Time complexity: O(1) amortized (may trigger eviction)
   */
  async set<T>(
    key: string,
    type: IndexEntryType,
    data: T,
    options?: { etag?: string; sourcePath?: string }
  ): Promise<void> {
    await this.initialize()

    const now = Date.now()
    const jsonData = JSON.stringify(data)
    const sizeBytes = new TextEncoder().encode(jsonData).length

    // Check if entry exists
    const existing = this.sql
      .exec<{ size_bytes: number }>('SELECT size_bytes FROM index_entries WHERE key = ?', key)
      .one()

    if (existing) {
      // Update existing entry
      this.sql.exec(
        `UPDATE index_entries
         SET type = ?, data = ?, size_bytes = ?, last_accessed = ?, etag = ?, source_path = ?
         WHERE key = ?`,
        type,
        jsonData,
        sizeBytes,
        now,
        options?.etag ?? null,
        options?.sourcePath ?? null,
        key
      )

      // Update stats
      const sizeDiff = sizeBytes - existing.size_bytes
      this.sql.exec(
        'UPDATE index_stats SET total_size = total_size + ?, last_updated = ? WHERE id = 1',
        sizeDiff,
        now
      )
    } else {
      // Insert new entry
      this.sql.exec(
        `INSERT INTO index_entries (key, type, data, size_bytes, access_count, last_accessed, created_at, etag, source_path)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        key,
        type,
        jsonData,
        sizeBytes,
        now,
        now,
        options?.etag ?? null,
        options?.sourcePath ?? null
      )

      // Update stats
      this.sql.exec(
        'UPDATE index_stats SET total_size = total_size + ?, entry_count = entry_count + 1, last_updated = ? WHERE id = 1',
        sizeBytes,
        now
      )
    }

    // Check if eviction is needed
    await this.maybeEvict()
  }

  /**
   * Delete an entry by key
   *
   * @param key - Entry key
   * @returns true if entry was deleted
   */
  async delete(key: string): Promise<boolean> {
    await this.initialize()

    const existing = this.sql
      .exec<{ size_bytes: number }>('SELECT size_bytes FROM index_entries WHERE key = ?', key)
      .one()

    if (!existing) return false

    this.sql.exec('DELETE FROM index_entries WHERE key = ?', key)

    // Update stats
    this.sql.exec(
      'UPDATE index_stats SET total_size = total_size - ?, entry_count = entry_count - 1, last_updated = ? WHERE id = 1',
      existing.size_bytes,
      Date.now()
    )

    return true
  }

  /**
   * Check if an entry exists
   *
   * @param key - Entry key
   * @returns true if entry exists
   */
  async has(key: string): Promise<boolean> {
    await this.initialize()
    const row = this.sql.exec<{ key: string }>('SELECT key FROM index_entries WHERE key = ?', key).one()
    return row !== null
  }

  /**
   * Get multiple entries by keys
   *
   * @param keys - Entry keys
   * @returns Map of key to entry (missing keys omitted)
   */
  async getMany<T = unknown>(keys: string[]): Promise<Map<string, IndexEntry<T>>> {
    await this.initialize()

    if (keys.length === 0) return new Map()

    const placeholders = keys.map(() => '?').join(',')
    const rows = this.sql
      .exec<IndexEntryRow>(`SELECT * FROM index_entries WHERE key IN (${placeholders})`, ...keys)
      .toArray()

    const result = new Map<string, IndexEntry<T>>()
    const now = Date.now()

    for (const row of rows) {
      result.set(row.key, this.rowToEntry<T>(row))

      // Update access statistics
      this.sql.exec(
        'UPDATE index_entries SET access_count = access_count + 1, last_accessed = ? WHERE key = ?',
        now,
        row.key
      )
    }

    return result
  }

  /**
   * Get entries by type
   *
   * @param type - Entry type
   * @param limit - Maximum entries to return
   * @returns Array of entries
   */
  async getByType<T = unknown>(type: IndexEntryType, limit = 100): Promise<IndexEntry<T>[]> {
    await this.initialize()

    const rows = this.sql
      .exec<IndexEntryRow>(
        'SELECT * FROM index_entries WHERE type = ? ORDER BY last_accessed DESC LIMIT ?',
        type,
        limit
      )
      .toArray()

    return rows.map((row) => this.rowToEntry<T>(row))
  }

  /**
   * Get entries by source path prefix
   *
   * @param pathPrefix - R2 path prefix
   * @returns Array of entries
   */
  async getBySourcePath<T = unknown>(pathPrefix: string): Promise<IndexEntry<T>[]> {
    await this.initialize()

    const rows = this.sql
      .exec<IndexEntryRow>(
        'SELECT * FROM index_entries WHERE source_path LIKE ? ORDER BY last_accessed DESC',
        pathPrefix + '%'
      )
      .toArray()

    return rows.map((row) => this.rowToEntry<T>(row))
  }

  // ===========================================================================
  // ETag-based Invalidation
  // ===========================================================================

  /**
   * Check if an entry needs refresh based on ETag
   *
   * @param key - Entry key
   * @param currentEtag - Current ETag from R2
   * @returns true if entry is stale (ETags don't match)
   */
  async isStale(key: string, currentEtag: string): Promise<boolean> {
    await this.initialize()

    const row = this.sql.exec<{ etag: string | null }>('SELECT etag FROM index_entries WHERE key = ?', key).one()

    if (!row) return true // Missing entries are considered stale
    if (!row.etag) return true // Entries without ETags are always stale

    return row.etag !== currentEtag
  }

  /**
   * Invalidate all entries from a specific source path
   *
   * @param sourcePath - R2 path to invalidate
   * @returns Number of entries invalidated
   */
  async invalidateBySource(sourcePath: string): Promise<number> {
    await this.initialize()

    // Get total size of entries to delete
    const toDelete = this.sql
      .exec<{ total_size: number; count: number }>(
        'SELECT SUM(size_bytes) as total_size, COUNT(*) as count FROM index_entries WHERE source_path = ?',
        sourcePath
      )
      .one()

    if (!toDelete || toDelete.count === 0) return 0

    this.sql.exec('DELETE FROM index_entries WHERE source_path = ?', sourcePath)

    // Update stats
    this.sql.exec(
      'UPDATE index_stats SET total_size = total_size - ?, entry_count = entry_count - ?, last_updated = ? WHERE id = 1',
      toDelete.total_size ?? 0,
      toDelete.count,
      Date.now()
    )

    return toDelete.count
  }

  // ===========================================================================
  // LRU Eviction
  // ===========================================================================

  /**
   * Check if eviction is needed and perform if so
   */
  private async maybeEvict(): Promise<void> {
    const stats = this.sql.exec<StoreStatsRow>('SELECT * FROM index_stats WHERE id = 1').one()

    if (!stats || stats.total_size <= this.config.maxSizeBytes) return

    await this.evict()
  }

  /**
   * Evict entries until under target size
   *
   * Uses a weighted LRU algorithm that considers:
   * - Last access time (primary factor)
   * - Access count (secondary factor - frequently accessed entries stay longer)
   *
   * @returns Number of entries evicted
   */
  async evict(): Promise<number> {
    await this.initialize()

    const stats = this.sql.exec<StoreStatsRow>('SELECT * FROM index_stats WHERE id = 1').one()
    if (!stats) return 0

    const targetSize = Math.floor(this.config.maxSizeBytes * this.config.evictionTargetRatio)

    if (stats.total_size <= targetSize) return 0

    // Calculate LRU score: lower is better candidate for eviction
    // Score = last_accessed + (access_count * 60000) -- each access adds 1 minute to effective age
    const candidates = this.sql
      .exec<IndexEntryRow & { score: number }>(
        `SELECT *, (last_accessed + (access_count * 60000)) as score
         FROM index_entries
         ORDER BY score ASC`
      )
      .toArray()

    let evictedCount = 0
    let evictedSize = 0
    const targetEvictSize = stats.total_size - targetSize

    for (const candidate of candidates) {
      // Don't evict below minimum entries
      if (stats.entry_count - evictedCount <= this.config.minEntries) break

      // Stop if we've evicted enough
      if (evictedSize >= targetEvictSize) break

      this.sql.exec('DELETE FROM index_entries WHERE key = ?', candidate.key)
      evictedCount++
      evictedSize += candidate.size_bytes
    }

    // Update stats
    const now = Date.now()
    this.sql.exec(
      'UPDATE index_stats SET total_size = total_size - ?, entry_count = entry_count - ?, last_updated = ?, last_eviction = ? WHERE id = 1',
      evictedSize,
      evictedCount,
      now,
      now
    )

    return evictedCount
  }

  /**
   * Clear all entries
   *
   * @returns Number of entries cleared
   */
  async clear(): Promise<number> {
    await this.initialize()

    const stats = this.sql.exec<StoreStatsRow>('SELECT * FROM index_stats WHERE id = 1').one()
    const count = stats?.entry_count ?? 0

    this.sql.exec('DELETE FROM index_entries')
    this.sql.exec('UPDATE index_stats SET total_size = 0, entry_count = 0, last_updated = ? WHERE id = 1', Date.now())

    return count
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get store statistics
   */
  async getStats(): Promise<StoreStats> {
    await this.initialize()

    const stats = this.sql.exec<StoreStatsRow>('SELECT * FROM index_stats WHERE id = 1').one()

    const typeCounts = this.sql
      .exec<TypeCountRow>('SELECT type, COUNT(*) as count FROM index_entries GROUP BY type')
      .toArray()

    const entriesByType: Record<string, number> = {}
    for (const row of typeCounts) {
      entriesByType[row.type] = row.count
    }

    return {
      entryCount: stats?.entry_count ?? 0,
      totalSizeBytes: stats?.total_size ?? 0,
      entriesByType: entriesByType as Record<IndexEntryType, number>,
      lastEviction: stats?.last_eviction ?? null,
      lastUpdated: stats?.last_updated ?? Date.now(),
    }
  }

  /**
   * Get current size as percentage of max
   */
  async getUtilization(): Promise<number> {
    await this.initialize()

    const stats = this.sql.exec<{ total_size: number }>('SELECT total_size FROM index_stats WHERE id = 1').one()

    return (stats?.total_size ?? 0) / this.config.maxSizeBytes
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private rowToEntry<T>(row: IndexEntryRow): IndexEntry<T> {
    return {
      key: row.key,
      type: row.type as IndexEntryType,
      data: JSON.parse(row.data) as T,
      sizeBytes: row.size_bytes,
      accessCount: row.access_count,
      lastAccessed: row.last_accessed,
      createdAt: row.created_at,
      etag: row.etag ?? undefined,
      sourcePath: row.source_path ?? undefined,
    }
  }
}
