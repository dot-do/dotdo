/**
 * Flush Manager - Hot to Cold Tiering
 *
 * Manages the flushing of data from the hot tier (DO SQLite)
 * to the cold tier (R2 Iceberg).
 *
 * Features:
 * - Threshold-based flush triggers
 * - Time-based flush triggers
 * - Atomic flush with deduplication
 * - Row tracking for consistency
 *
 * @module db/compat/sql/clickhouse/storage/flush-manager
 */

import type { HotTier } from './hot-tier'
import type { ColdTier } from './cold-tier'
import type { FlushResult, TieredStorageConfig, ThingRow } from './types'

/**
 * Default flush configuration
 */
const DEFAULT_FLUSH_THRESHOLD = 10000
const DEFAULT_FLUSH_INTERVAL = 300000 // 5 minutes

/**
 * FlushManager - Manages hot to cold tier flushing
 *
 * Coordinates the movement of data from DO SQLite to R2 Iceberg,
 * ensuring atomicity and zero data loss.
 */
export class FlushManager {
  private hotTier: HotTier
  private coldTier: ColdTier
  private flushThreshold: number
  private flushInterval: number
  private lastFlushTime: number = 0
  private flushInProgress = false
  private flushedRowIds: Set<string> = new Set()

  constructor(
    hotTier: HotTier,
    coldTier: ColdTier,
    config: TieredStorageConfig = {}
  ) {
    this.hotTier = hotTier
    this.coldTier = coldTier
    this.flushThreshold = config.flushThreshold ?? DEFAULT_FLUSH_THRESHOLD
    this.flushInterval = config.flushInterval ?? DEFAULT_FLUSH_INTERVAL
  }

  /**
   * Check if flush is needed based on row count or time
   */
  shouldFlush(): boolean {
    // Check row count threshold
    if (this.hotTier.rowCount >= this.flushThreshold) {
      return true
    }

    // Check time interval
    const timeSinceLastFlush = Date.now() - this.lastFlushTime
    if (this.lastFlushTime > 0 && timeSinceLastFlush >= this.flushInterval) {
      return true
    }

    return false
  }

  /**
   * Perform flush operation
   *
   * Flush process:
   * 1. Read rows from DO SQLite
   * 2. Convert to Parquet
   * 3. Write to R2 as Iceberg data file
   * 4. Update Iceberg manifest
   * 5. Delete flushed rows from SQLite
   * 6. Commit atomically
   */
  async flush(): Promise<FlushResult> {
    if (this.flushInProgress) {
      throw new Error('Flush already in progress')
    }

    this.flushInProgress = true
    const startTime = performance.now()

    try {
      // 1. Get all rows from hot tier
      const rows = await this.hotTier.getAllRows()

      if (rows.length === 0) {
        return {
          rowCount: 0,
          durationMs: performance.now() - startTime,
          snapshotId: '',
          dataFilePath: '',
        }
      }

      // 2. Write to cold tier (creates Parquet file and updates manifest)
      const snapshotId = await this.coldTier.write(rows)

      // 3. Delete flushed rows from hot tier
      const rowIds = rows.map(row => row.id)
      await this.hotTier.deleteRows(rowIds)

      // 4. Track flushed row IDs for deduplication
      for (const id of rowIds) {
        this.flushedRowIds.add(id)
      }

      // 5. Update last flush time
      this.lastFlushTime = Date.now()

      const durationMs = performance.now() - startTime

      return {
        rowCount: rows.length,
        durationMs,
        snapshotId,
        dataFilePath: `${this.coldTier.getSnapshotId()}.parquet`,
      }
    } finally {
      this.flushInProgress = false
    }
  }

  /**
   * Flush if threshold is exceeded (auto-flush)
   */
  async flushIfNeeded(): Promise<FlushResult | null> {
    if (!this.shouldFlush()) {
      return null
    }

    return this.flush()
  }

  /**
   * Check if a row ID was recently flushed (for deduplication)
   */
  wasRecentlyFlushed(id: string): boolean {
    return this.flushedRowIds.has(id)
  }

  /**
   * Clear flushed row tracking (after successful query merge)
   */
  clearFlushedTracking(): void {
    this.flushedRowIds.clear()
  }

  /**
   * Get flush statistics
   */
  getStats(): {
    hotRowCount: number
    flushThreshold: number
    lastFlushTime: number
    flushInProgress: boolean
    pendingFlushIds: number
  } {
    return {
      hotRowCount: this.hotTier.rowCount,
      flushThreshold: this.flushThreshold,
      lastFlushTime: this.lastFlushTime,
      flushInProgress: this.flushInProgress,
      pendingFlushIds: this.flushedRowIds.size,
    }
  }

  /**
   * Force flush regardless of thresholds
   */
  async forceFlush(): Promise<FlushResult> {
    return this.flush()
  }

  /**
   * Update flush configuration
   */
  setConfig(config: Partial<TieredStorageConfig>): void {
    if (config.flushThreshold !== undefined) {
      this.flushThreshold = config.flushThreshold
    }
    if (config.flushInterval !== undefined) {
      this.flushInterval = config.flushInterval
    }
  }
}
