/**
 * Tiered Storage Interface
 *
 * Abstraction for hot (SQLite) and cold (R2/Iceberg) storage tiers.
 * The pipeline handler writes to this interface which manages tiering.
 *
 * @see dotdo-8c2e2 - Tiered Storage Layer Implementation
 * @see dotdo-w93m9 - Pipeline Handler Implementation
 */

/**
 * Query result from tiered storage
 */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
  rowsRead: number
  bytesRead: number
}

/**
 * Storage configuration
 */
export interface TieredStorageConfig {
  /** Max rows in hot tier before flush */
  hotTierRowLimit?: number
  /** Max age in ms before flush */
  flushIntervalMs?: number
  /** Enable deduplication during flush */
  deduplicate?: boolean
}

/**
 * Tiered storage interface for pipeline writes
 */
export interface TieredStorage {
  /**
   * Insert records into hot tier
   */
  insert(records: Record<string, unknown>[]): Promise<void>

  /**
   * Query across all tiers
   */
  query<T = Record<string, unknown>>(
    sql: string,
    options?: QueryOptions
  ): Promise<QueryResult<T>>

  /**
   * Get all tracked JSON paths
   */
  getTrackedPaths(): Promise<string[]>

  /**
   * Track new paths discovered during ingestion
   */
  trackPaths(paths: string[]): Promise<void>

  /**
   * Flush hot tier to cold tier
   */
  flush(): Promise<FlushResult>

  /**
   * Get storage statistics
   */
  getStats(): Promise<StorageStats>

  /**
   * Simulate failure for testing (test-only)
   */
  simulateFailure?(count: number): void
}

/**
 * Query options
 */
export interface QueryOptions {
  /** Snapshot ID for time travel queries */
  snapshotId?: string
  /** Query only hot tier */
  hotOnly?: boolean
  /** Query only cold tier */
  coldOnly?: boolean
}

/**
 * Flush operation result
 */
export interface FlushResult {
  rowsFlushed: number
  filesWritten: number
  bytesWritten: number
  elapsedMs: number
}

/**
 * Storage statistics
 */
export interface StorageStats {
  hotTierRows: number
  coldTierRows: number
  totalRows: number
  hotTierBytes: number
  coldTierBytes: number
  trackedPaths: number
  lastFlushTime?: number
}

/**
 * In-memory implementation of TieredStorage for testing
 */
export class InMemoryTieredStorage implements TieredStorage {
  private rows: Record<string, unknown>[] = []
  private paths = new Set<string>()
  private failureCount = 0

  async insert(records: Record<string, unknown>[]): Promise<void> {
    if (this.failureCount > 0) {
      this.failureCount--
      throw new Error('Simulated storage failure')
    }
    this.rows.push(...records)
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    _options?: QueryOptions
  ): Promise<QueryResult<T>> {
    // Simple query implementation - extract table and column info
    const countMatch = sql.match(/SELECT\s+count\(\*\)\s+(?:as\s+\w+\s+)?FROM\s+(\w+)/i)
    if (countMatch) {
      return {
        rows: [{ count: this.rows.length } as unknown as T],
        rowsRead: this.rows.length,
        bytesRead: 0,
      }
    }

    const embeddingMatch = sql.match(/SELECT\s+embedding\s+FROM/i)
    if (embeddingMatch && this.rows.length > 0) {
      const row = this.rows[0] as Record<string, unknown>
      return {
        rows: [{ embedding: row.embedding } as unknown as T],
        rowsRead: 1,
        bytesRead: 0,
      }
    }

    return {
      rows: this.rows as unknown as T[],
      rowsRead: this.rows.length,
      bytesRead: JSON.stringify(this.rows).length,
    }
  }

  async getTrackedPaths(): Promise<string[]> {
    return [...this.paths]
  }

  async trackPaths(newPaths: string[]): Promise<void> {
    for (const path of newPaths) {
      this.paths.add(path)
    }
  }

  async flush(): Promise<FlushResult> {
    const rowsFlushed = this.rows.length
    const bytes = JSON.stringify(this.rows).length
    this.rows = []
    return {
      rowsFlushed,
      filesWritten: rowsFlushed > 0 ? 1 : 0,
      bytesWritten: bytes,
      elapsedMs: 1,
    }
  }

  async getStats(): Promise<StorageStats> {
    return {
      hotTierRows: this.rows.length,
      coldTierRows: 0,
      totalRows: this.rows.length,
      hotTierBytes: JSON.stringify(this.rows).length,
      coldTierBytes: 0,
      trackedPaths: this.paths.size,
    }
  }

  simulateFailure(count: number): void {
    this.failureCount = count
  }

  // Test helper to reset state
  reset(): void {
    this.rows = []
    this.paths.clear()
    this.failureCount = 0
  }
}
