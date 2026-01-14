/**
 * TieredStorage - Unified DO SQLite + R2 Iceberg Storage
 *
 * Main entry point for tiered storage providing:
 * - DO SQLite hot tier for low-latency writes
 * - R2 Iceberg cold tier for cost-effective archival
 * - Automatic flushing from hot to cold
 * - Unified query across both tiers
 * - Deduplication during queries
 * - Time travel via Iceberg snapshots
 *
 * @module db/compat/sql/clickhouse/storage/tiered-storage
 */

import { HotTier } from './hot-tier'
import { ColdTier } from './cold-tier'
import { FlushManager } from './flush-manager'
import type {
  DurableObjectStateLike,
  R2BucketLike,
  TieredStorageConfig,
  QueryOptions,
  QueryResult,
  ThingRow,
  InsertOptions,
  FlushResult,
} from './types'

/**
 * TieredStorage - Main tiered storage class
 *
 * Provides a unified interface for storage across hot and cold tiers,
 * with automatic tiering and cross-tier queries.
 *
 * @example Basic usage
 * ```typescript
 * const storage = new TieredStorage(doState, env.R2)
 *
 * // Insert data (goes to hot tier)
 * await storage.insert('things', {
 *   id: 'event-1',
 *   type: 'click',
 *   data: { x: 100, y: 200 },
 *   created_at: Date.now(),
 *   updated_at: Date.now()
 * })
 *
 * // Query across both tiers
 * const result = await storage.query('SELECT * FROM things WHERE type = "click"')
 * ```
 *
 * @example Time travel query
 * ```typescript
 * const snapshot = await storage.getSnapshotId()
 *
 * // Write more data
 * await storage.insert('things', { ... })
 *
 * // Query at old snapshot
 * const result = await storage.query(
 *   'SELECT count(*) FROM things',
 *   { snapshotId: snapshot }
 * )
 * ```
 */
export class TieredStorage {
  private hotTier: HotTier
  private coldTier: ColdTier
  private flushManager: FlushManager
  private config: TieredStorageConfig
  private initialized = false

  constructor(
    doState: DurableObjectStateLike,
    env: { R2?: R2BucketLike },
    config: TieredStorageConfig = {}
  ) {
    this.config = {
      flushThreshold: config.flushThreshold ?? 10000,
      flushInterval: config.flushInterval ?? 300000,
      namespace: config.namespace ?? doState.id.toString(),
      autoFlush: config.autoFlush ?? true,
    }

    // Initialize hot tier with DO SQLite
    this.hotTier = new HotTier(doState.storage.sql)

    // Initialize cold tier with R2 (if available)
    if (env.R2) {
      this.coldTier = new ColdTier(env.R2, this.config.namespace)
    } else {
      // Create a mock cold tier for testing without R2
      this.coldTier = new ColdTier(this.createMockBucket(), this.config.namespace)
    }

    // Initialize flush manager
    this.flushManager = new FlushManager(this.hotTier, this.coldTier, this.config)
  }

  /**
   * Initialize storage (call before first use)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    await this.hotTier.initialize()
    await this.coldTier.initialize()
    this.initialized = true
  }

  /**
   * Insert a row into the hot tier
   */
  async insert(table: string, row: ThingRow, options?: InsertOptions): Promise<void> {
    await this.initialize()

    await this.hotTier.insert(row)

    // Auto-flush if enabled and threshold exceeded
    if (this.config.autoFlush && !options?.skipFlushCheck) {
      await this.flushManager.flushIfNeeded()
    }
  }

  /**
   * Insert multiple rows in a batch
   */
  async insertBatch(table: string, rows: ThingRow[]): Promise<void> {
    await this.initialize()

    await this.hotTier.insertBatch(rows)

    // Auto-flush if needed
    if (this.config.autoFlush) {
      await this.flushManager.flushIfNeeded()
    }
  }

  /**
   * Query across both tiers with deduplication
   */
  async query(sql: string, options?: QueryOptions): Promise<QueryResult> {
    await this.initialize()

    const startTime = performance.now()

    // Time travel queries go to cold tier only
    if (options?.snapshotId) {
      return this.coldTier.query(sql, options)
    }

    // Query both tiers
    const [hotResult, coldResult] = await Promise.all([
      this.hotTier.query(sql, options),
      this.coldTier.query(sql, options),
    ])

    // Merge and deduplicate results
    const merged = this.mergeResults(hotResult.rows, coldResult.rows)

    return {
      rows: merged,
      source: hotResult.rows.length > 0 && coldResult.rows.length > 0 ? 'both' : (hotResult.rows.length > 0 ? 'hot' : 'cold'),
      durationMs: performance.now() - startTime,
      count: merged.length,
    }
  }

  /**
   * Query hot tier only
   */
  async queryHotTier(sql: string, options?: QueryOptions): Promise<QueryResult> {
    await this.initialize()
    return this.hotTier.query(sql, options)
  }

  /**
   * Query cold tier only
   */
  async queryColdTier(sql: string, options?: QueryOptions): Promise<QueryResult> {
    await this.initialize()
    return this.coldTier.query(sql, options)
  }

  /**
   * Force flush from hot to cold tier
   */
  async flush(): Promise<FlushResult> {
    await this.initialize()
    return this.flushManager.forceFlush()
  }

  /**
   * Get current snapshot ID
   */
  async getSnapshotId(): Promise<string | null> {
    await this.initialize()
    return this.coldTier.getSnapshotId()
  }

  /**
   * Get row count from hot tier
   */
  getHotRowCount(): number {
    return this.hotTier.rowCount
  }

  /**
   * Get row count from cold tier
   */
  async getColdRowCount(): Promise<number> {
    await this.initialize()
    return this.coldTier.getRowCount()
  }

  /**
   * List data files in cold tier
   */
  async listDataFiles(): Promise<{ path: string; partition: string }[]> {
    await this.initialize()
    const files = await this.coldTier.listDataFiles()
    return files.map(f => ({ path: f.path, partition: f.partition }))
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    hotRowCount: number
    coldRowCount: number
    flushThreshold: number
    autoFlush: boolean
    lastSnapshotId: string | null
  }> {
    await this.initialize()

    return {
      hotRowCount: this.hotTier.rowCount,
      coldRowCount: await this.coldTier.getRowCount(),
      flushThreshold: this.config.flushThreshold!,
      autoFlush: this.config.autoFlush!,
      lastSnapshotId: this.coldTier.getSnapshotId(),
    }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<TieredStorageConfig>): void {
    if (config.flushThreshold !== undefined) {
      this.config.flushThreshold = config.flushThreshold
    }
    if (config.flushInterval !== undefined) {
      this.config.flushInterval = config.flushInterval
    }
    if (config.autoFlush !== undefined) {
      this.config.autoFlush = config.autoFlush
    }

    this.flushManager.setConfig(config)
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Merge results from hot and cold tiers with deduplication
   *
   * Hot tier data takes precedence (more recent)
   */
  private mergeResults(
    hotRows: Record<string, unknown>[],
    coldRows: Record<string, unknown>[]
  ): Record<string, unknown>[] {
    // Create a map of hot tier row IDs for deduplication
    const hotIds = new Set(hotRows.map(row => row.id as string))

    // Filter cold rows to exclude duplicates
    const uniqueColdRows = coldRows.filter(row => !hotIds.has(row.id as string))

    // Combine: cold (older) + hot (newer)
    return [...uniqueColdRows, ...hotRows]
  }

  /**
   * Create a mock R2 bucket for testing
   */
  private createMockBucket(): R2BucketLike {
    const storage = new Map<string, ArrayBuffer | string>()

    return {
      async put(key: string, body: ArrayBuffer | string): Promise<unknown> {
        storage.set(key, body)
        return {}
      },
      async get(key: string) {
        const value = storage.get(key)
        if (!value) return null

        return {
          key,
          async json() {
            if (typeof value === 'string') {
              return JSON.parse(value)
            }
            const text = new TextDecoder().decode(value)
            return JSON.parse(text)
          },
          async text() {
            if (typeof value === 'string') return value
            return new TextDecoder().decode(value)
          },
          async arrayBuffer() {
            if (typeof value === 'string') {
              return new TextEncoder().encode(value).buffer
            }
            return value
          },
        }
      },
      async list(options?: { prefix?: string }) {
        const prefix = options?.prefix ?? ''
        const objects = [...storage.keys()]
          .filter(key => key.startsWith(prefix))
          .map(key => ({ key }))

        return { objects, truncated: false }
      },
      async delete(key: string) {
        storage.delete(key)
      },
    }
  }
}

// Re-export component classes for direct access if needed
export { HotTier } from './hot-tier'
export { ColdTier } from './cold-tier'
export { FlushManager } from './flush-manager'
export * from './types'
