/**
 * FSx Store for DO-Local Binary Index Caching
 *
 * Stores binary index files in DO storage via fsx for sub-ms access:
 * - HNSW vector index chunks
 * - GIN posting lists
 * - Bloom filter binary data
 * - Serialized index structures
 *
 * Architecture:
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  FsxStore (DO Storage via fsx)                                   │
 * │  ┌────────────────────────────┐  ┌─────────────────────────────┐│
 * │  │ /.cache/indexes/           │  │ metadata (in SQLite)        ││
 * │  │ ├── hnsw/                  │  │ • key → path mapping        ││
 * │  │ │   ├── chunk-0.bin        │  │ • size tracking             ││
 * │  │ │   └── chunk-1.bin        │  │ • access stats              ││
 * │  │ ├── bloom/                 │  │ • etag for invalidation     ││
 * │  │ │   └── email.bloom        │  │                             ││
 * │  │ └── gin/                   │  │                             ││
 * │  │     └── content.gin        │  │                             ││
 * │  └────────────────────────────┘  └─────────────────────────────┘│
 * │  <1ms access for hot data                                       │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * @module db/compat/sql/clickhouse/cache/fsx-store
 */

// ============================================================================
// Types
// ============================================================================

/** Types of binary index data */
export type BinaryIndexType =
  | 'hnsw_chunk' // HNSW vector index chunk
  | 'hnsw_header' // HNSW index header/metadata
  | 'gin_postings' // GIN inverted index posting lists
  | 'bloom_filter' // Serialized bloom filter
  | 'btree_node' // B-tree index node
  | 'parquet_footer' // Parquet file footer/metadata
  | 'custom' // Custom binary data

/** Metadata for a cached binary file */
export interface BinaryEntry {
  /** Unique key for the entry */
  key: string
  /** Type of binary data */
  type: BinaryIndexType
  /** Path in fsx storage */
  path: string
  /** Size in bytes */
  sizeBytes: number
  /** Access count */
  accessCount: number
  /** Last access timestamp (ms) */
  lastAccessed: number
  /** Creation timestamp (ms) */
  createdAt: number
  /** ETag from R2 for cache invalidation */
  etag?: string
  /** Source R2 path */
  sourcePath?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/** Storage statistics for FsxStore */
export interface FsxStoreStats {
  /** Total entries */
  entryCount: number
  /** Total size in bytes */
  totalSizeBytes: number
  /** Entries by type */
  entriesByType: Record<BinaryIndexType, number>
  /** Size by type */
  sizeByType: Record<BinaryIndexType, number>
  /** Last eviction timestamp */
  lastEviction: number | null
  /** Last update timestamp */
  lastUpdated: number
}

/** Configuration for FsxStore */
export interface FsxStoreConfig {
  /** Maximum storage size in bytes (default: 100MB) */
  maxSizeBytes?: number
  /** Target size after eviction (default: 80% of max) */
  evictionTargetRatio?: number
  /** Minimum entries to keep (default: 5) */
  minEntries?: number
  /** Base path for cache files (default: /.cache/indexes) */
  basePath?: string
}

/** Simple filesystem interface for fsx operations */
export interface FsInterface {
  /** Read file contents */
  read(path: string): Promise<Uint8Array | string>
  /** Write file contents */
  write(path: string, data: Uint8Array | string): Promise<void>
  /** Delete a file */
  unlink(path: string): Promise<void>
  /** Check if file exists */
  exists(path: string): Promise<boolean>
  /** Create directory recursively */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  /** Get file stats */
  stat(path: string): Promise<{ size: number; mtime: Date }>
}

// ============================================================================
// Internal Types
// ============================================================================

interface BinaryEntryRow {
  key: string
  type: string
  path: string
  size_bytes: number
  access_count: number
  last_accessed: number
  created_at: number
  etag: string | null
  source_path: string | null
  metadata: string | null
  [k: string]: SqlStorageValue
}

interface FsxStoreStatsRow {
  total_size: number
  entry_count: number
  last_updated: number
  last_eviction: number | null
  [k: string]: SqlStorageValue
}

interface TypeStatsRow {
  type: string
  count: number
  total_size: number
  [k: string]: SqlStorageValue
}

// ============================================================================
// Schema
// ============================================================================

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS binary_entries (
    key TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    size_bytes INTEGER NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    etag TEXT,
    source_path TEXT,
    metadata TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_binary_type ON binary_entries(type);
  CREATE INDEX IF NOT EXISTS idx_binary_last_accessed ON binary_entries(last_accessed);
  CREATE INDEX IF NOT EXISTS idx_binary_source_path ON binary_entries(source_path);

  CREATE TABLE IF NOT EXISTS binary_stats (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    total_size INTEGER NOT NULL DEFAULT 0,
    entry_count INTEGER NOT NULL DEFAULT 0,
    last_updated INTEGER NOT NULL,
    last_eviction INTEGER
  );
`

// ============================================================================
// FsxStore Class
// ============================================================================

/**
 * Filesystem-backed store for binary index data
 *
 * Stores large binary files (HNSW chunks, bloom filters, etc.) in DO storage
 * via fsx with metadata tracked in SQLite for efficient management.
 *
 * @example
 * ```typescript
 * const store = new FsxStore(ctx.storage.sql, $.fs, {
 *   maxSizeBytes: 100 * 1024 * 1024, // 100MB
 * })
 * await store.initialize()
 *
 * // Store HNSW chunk
 * await store.set('hnsw:users:chunk-0', 'hnsw_chunk', chunkData, {
 *   etag: 'xyz789',
 *   sourcePath: 'indexes/users/hnsw/chunk-0.bin',
 *   metadata: { level: 0, nodeCount: 10000 }
 * })
 *
 * // Retrieve with sub-ms latency
 * const chunk = await store.get('hnsw:users:chunk-0')
 * ```
 */
export class FsxStore {
  private sql: SqlStorage
  private fs: FsInterface
  private config: Required<FsxStoreConfig>
  private initialized = false

  constructor(sql: SqlStorage, fs: FsInterface, config: FsxStoreConfig = {}) {
    this.sql = sql
    this.fs = fs
    this.config = {
      maxSizeBytes: config.maxSizeBytes ?? 100 * 1024 * 1024, // 100MB
      evictionTargetRatio: config.evictionTargetRatio ?? 0.8,
      minEntries: config.minEntries ?? 5,
      basePath: config.basePath ?? '/.cache/indexes',
    }
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the store schema and directories
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create schema
    await this.sql.exec(SCHEMA)

    // Initialize stats row if not exists
    const stats = this.sql.exec<FsxStoreStatsRow>('SELECT * FROM binary_stats WHERE id = 1').one()
    if (!stats) {
      await this.sql.exec('INSERT INTO binary_stats (id, total_size, entry_count, last_updated) VALUES (1, 0, 0, ?)', Date.now())
    }

    // Create base directory structure
    await this.fs.mkdir(this.config.basePath, { recursive: true })
    await this.fs.mkdir(`${this.config.basePath}/hnsw`, { recursive: true })
    await this.fs.mkdir(`${this.config.basePath}/bloom`, { recursive: true })
    await this.fs.mkdir(`${this.config.basePath}/gin`, { recursive: true })
    await this.fs.mkdir(`${this.config.basePath}/btree`, { recursive: true })
    await this.fs.mkdir(`${this.config.basePath}/custom`, { recursive: true })

    this.initialized = true
  }

  // ===========================================================================
  // Core Operations
  // ===========================================================================

  /**
   * Get binary data by key
   *
   * @param key - Entry key
   * @returns Binary data and metadata, or null if not found
   *
   * Time complexity: O(1) for metadata lookup + file read
   */
  async get(key: string): Promise<{ data: Uint8Array; entry: BinaryEntry } | null> {
    await this.initialize()

    const row = this.sql.exec<BinaryEntryRow>('SELECT * FROM binary_entries WHERE key = ?', key).one()

    if (!row) return null

    // Update access statistics
    const now = Date.now()
    this.sql.exec(
      'UPDATE binary_entries SET access_count = access_count + 1, last_accessed = ? WHERE key = ?',
      now,
      key
    )

    // Read binary data from fsx
    let data: Uint8Array
    try {
      const content = await this.fs.read(row.path)
      data = typeof content === 'string' ? new TextEncoder().encode(content) : content
    } catch {
      // File missing - clean up metadata
      await this.delete(key)
      return null
    }

    return {
      data,
      entry: this.rowToEntry(row),
    }
  }

  /**
   * Get only metadata without reading file
   *
   * @param key - Entry key
   * @returns Entry metadata or null
   */
  async getMetadata(key: string): Promise<BinaryEntry | null> {
    await this.initialize()

    const row = this.sql.exec<BinaryEntryRow>('SELECT * FROM binary_entries WHERE key = ?', key).one()

    if (!row) return null

    return this.rowToEntry(row)
  }

  /**
   * Set binary data
   *
   * @param key - Entry key
   * @param type - Entry type
   * @param data - Binary data
   * @param options - Additional options
   *
   * Time complexity: O(1) for metadata + file write
   */
  async set(
    key: string,
    type: BinaryIndexType,
    data: Uint8Array,
    options?: {
      etag?: string
      sourcePath?: string
      metadata?: Record<string, unknown>
    }
  ): Promise<void> {
    await this.initialize()

    const now = Date.now()
    const sizeBytes = data.length

    // Generate file path based on type
    const filePath = this.generatePath(key, type)

    // Check if entry exists
    const existing = this.sql
      .exec<{ size_bytes: number; path: string }>('SELECT size_bytes, path FROM binary_entries WHERE key = ?', key)
      .one()

    // Write binary data to fsx
    await this.fs.write(filePath, data)

    if (existing) {
      // Delete old file if path changed
      if (existing.path !== filePath) {
        try {
          await this.fs.unlink(existing.path)
        } catch {
          // Ignore - file may not exist
        }
      }

      // Update existing entry
      this.sql.exec(
        `UPDATE binary_entries
         SET type = ?, path = ?, size_bytes = ?, last_accessed = ?, etag = ?, source_path = ?, metadata = ?
         WHERE key = ?`,
        type,
        filePath,
        sizeBytes,
        now,
        options?.etag ?? null,
        options?.sourcePath ?? null,
        options?.metadata ? JSON.stringify(options.metadata) : null,
        key
      )

      // Update stats
      const sizeDiff = sizeBytes - existing.size_bytes
      this.sql.exec('UPDATE binary_stats SET total_size = total_size + ?, last_updated = ? WHERE id = 1', sizeDiff, now)
    } else {
      // Insert new entry
      this.sql.exec(
        `INSERT INTO binary_entries (key, type, path, size_bytes, access_count, last_accessed, created_at, etag, source_path, metadata)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        key,
        type,
        filePath,
        sizeBytes,
        now,
        now,
        options?.etag ?? null,
        options?.sourcePath ?? null,
        options?.metadata ? JSON.stringify(options.metadata) : null
      )

      // Update stats
      this.sql.exec(
        'UPDATE binary_stats SET total_size = total_size + ?, entry_count = entry_count + 1, last_updated = ? WHERE id = 1',
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
      .exec<{ size_bytes: number; path: string }>('SELECT size_bytes, path FROM binary_entries WHERE key = ?', key)
      .one()

    if (!existing) return false

    // Delete file
    try {
      await this.fs.unlink(existing.path)
    } catch {
      // Ignore - file may not exist
    }

    // Delete metadata
    this.sql.exec('DELETE FROM binary_entries WHERE key = ?', key)

    // Update stats
    this.sql.exec(
      'UPDATE binary_stats SET total_size = total_size - ?, entry_count = entry_count - 1, last_updated = ? WHERE id = 1',
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
    const row = this.sql.exec<{ key: string }>('SELECT key FROM binary_entries WHERE key = ?', key).one()
    return row !== null
  }

  /**
   * Get entries by type
   *
   * @param type - Entry type
   * @param limit - Maximum entries to return
   * @returns Array of entries (metadata only)
   */
  async getByType(type: BinaryIndexType, limit = 100): Promise<BinaryEntry[]> {
    await this.initialize()

    const rows = this.sql
      .exec<BinaryEntryRow>(
        'SELECT * FROM binary_entries WHERE type = ? ORDER BY last_accessed DESC LIMIT ?',
        type,
        limit
      )
      .toArray()

    return rows.map((row) => this.rowToEntry(row))
  }

  /**
   * Get entries by source path prefix
   *
   * @param pathPrefix - R2 path prefix
   * @returns Array of entries (metadata only)
   */
  async getBySourcePath(pathPrefix: string): Promise<BinaryEntry[]> {
    await this.initialize()

    const rows = this.sql
      .exec<BinaryEntryRow>(
        'SELECT * FROM binary_entries WHERE source_path LIKE ? ORDER BY last_accessed DESC',
        pathPrefix + '%'
      )
      .toArray()

    return rows.map((row) => this.rowToEntry(row))
  }

  // ===========================================================================
  // ETag-based Invalidation
  // ===========================================================================

  /**
   * Check if an entry needs refresh based on ETag
   *
   * @param key - Entry key
   * @param currentEtag - Current ETag from R2
   * @returns true if entry is stale
   */
  async isStale(key: string, currentEtag: string): Promise<boolean> {
    await this.initialize()

    const row = this.sql.exec<{ etag: string | null }>('SELECT etag FROM binary_entries WHERE key = ?', key).one()

    if (!row) return true
    if (!row.etag) return true

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

    const toDelete = this.sql
      .exec<BinaryEntryRow>('SELECT * FROM binary_entries WHERE source_path = ?', sourcePath)
      .toArray()

    if (toDelete.length === 0) return 0

    let totalSize = 0

    for (const row of toDelete) {
      try {
        await this.fs.unlink(row.path)
      } catch {
        // Ignore
      }
      totalSize += row.size_bytes
    }

    this.sql.exec('DELETE FROM binary_entries WHERE source_path = ?', sourcePath)

    // Update stats
    this.sql.exec(
      'UPDATE binary_stats SET total_size = total_size - ?, entry_count = entry_count - ?, last_updated = ? WHERE id = 1',
      totalSize,
      toDelete.length,
      Date.now()
    )

    return toDelete.length
  }

  // ===========================================================================
  // LRU Eviction
  // ===========================================================================

  /**
   * Check if eviction is needed and perform if so
   */
  private async maybeEvict(): Promise<void> {
    const stats = this.sql.exec<FsxStoreStatsRow>('SELECT * FROM binary_stats WHERE id = 1').one()

    if (!stats || stats.total_size <= this.config.maxSizeBytes) return

    await this.evict()
  }

  /**
   * Evict entries until under target size
   *
   * Uses weighted LRU considering access count
   *
   * @returns Number of entries evicted
   */
  async evict(): Promise<number> {
    await this.initialize()

    const stats = this.sql.exec<FsxStoreStatsRow>('SELECT * FROM binary_stats WHERE id = 1').one()
    if (!stats) return 0

    const targetSize = Math.floor(this.config.maxSizeBytes * this.config.evictionTargetRatio)

    if (stats.total_size <= targetSize) return 0

    // Get candidates ordered by LRU score
    const candidates = this.sql
      .exec<BinaryEntryRow & { score: number }>(
        `SELECT *, (last_accessed + (access_count * 60000)) as score
         FROM binary_entries
         ORDER BY score ASC`
      )
      .toArray()

    let evictedCount = 0
    let evictedSize = 0
    const targetEvictSize = stats.total_size - targetSize

    for (const candidate of candidates) {
      if (stats.entry_count - evictedCount <= this.config.minEntries) break
      if (evictedSize >= targetEvictSize) break

      // Delete file
      try {
        await this.fs.unlink(candidate.path)
      } catch {
        // Ignore
      }

      this.sql.exec('DELETE FROM binary_entries WHERE key = ?', candidate.key)
      evictedCount++
      evictedSize += candidate.size_bytes
    }

    // Update stats
    const now = Date.now()
    this.sql.exec(
      'UPDATE binary_stats SET total_size = total_size - ?, entry_count = entry_count - ?, last_updated = ?, last_eviction = ? WHERE id = 1',
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

    const entries = this.sql.exec<BinaryEntryRow>('SELECT * FROM binary_entries').toArray()

    for (const entry of entries) {
      try {
        await this.fs.unlink(entry.path)
      } catch {
        // Ignore
      }
    }

    this.sql.exec('DELETE FROM binary_entries')
    this.sql.exec('UPDATE binary_stats SET total_size = 0, entry_count = 0, last_updated = ? WHERE id = 1', Date.now())

    return entries.length
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get store statistics
   */
  async getStats(): Promise<FsxStoreStats> {
    await this.initialize()

    const stats = this.sql.exec<FsxStoreStatsRow>('SELECT * FROM binary_stats WHERE id = 1').one()

    const typeStats = this.sql
      .exec<TypeStatsRow>('SELECT type, COUNT(*) as count, SUM(size_bytes) as total_size FROM binary_entries GROUP BY type')
      .toArray()

    const entriesByType: Record<string, number> = {}
    const sizeByType: Record<string, number> = {}

    for (const row of typeStats) {
      entriesByType[row.type] = row.count
      sizeByType[row.type] = row.total_size ?? 0
    }

    return {
      entryCount: stats?.entry_count ?? 0,
      totalSizeBytes: stats?.total_size ?? 0,
      entriesByType: entriesByType as Record<BinaryIndexType, number>,
      sizeByType: sizeByType as Record<BinaryIndexType, number>,
      lastEviction: stats?.last_eviction ?? null,
      lastUpdated: stats?.last_updated ?? Date.now(),
    }
  }

  /**
   * Get current size as percentage of max
   */
  async getUtilization(): Promise<number> {
    await this.initialize()

    const stats = this.sql.exec<{ total_size: number }>('SELECT total_size FROM binary_stats WHERE id = 1').one()

    return (stats?.total_size ?? 0) / this.config.maxSizeBytes
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Generate file path for a key and type
   */
  private generatePath(key: string, type: BinaryIndexType): string {
    // Sanitize key for filesystem
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_')
    const hash = this.simpleHash(key)

    const typeDir = this.getTypeDirectory(type)
    return `${this.config.basePath}/${typeDir}/${safeKey}-${hash}.bin`
  }

  /**
   * Get directory for a type
   */
  private getTypeDirectory(type: BinaryIndexType): string {
    switch (type) {
      case 'hnsw_chunk':
      case 'hnsw_header':
        return 'hnsw'
      case 'gin_postings':
        return 'gin'
      case 'bloom_filter':
        return 'bloom'
      case 'btree_node':
        return 'btree'
      default:
        return 'custom'
    }
  }

  /**
   * Simple hash for key uniqueness
   */
  private simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36).substring(0, 8)
  }

  private rowToEntry(row: BinaryEntryRow): BinaryEntry {
    return {
      key: row.key,
      type: row.type as BinaryIndexType,
      path: row.path,
      sizeBytes: row.size_bytes,
      accessCount: row.access_count,
      lastAccessed: row.last_accessed,
      createdAt: row.created_at,
      etag: row.etag ?? undefined,
      sourcePath: row.source_path ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }
  }
}
