/**
 * Temporal Materialized View - AS OF Semantics for Point-in-Time View State
 *
 * Provides temporal query support for materialized views, enabling queries like:
 * ```sql
 * SELECT * FROM orders_summary AS OF TIMESTAMP '2024-01-01'
 * ```
 *
 * ## Features
 * - **AS OF queries**: Query view state at any historical timestamp
 * - **Versioned storage**: Store view state with timestamps after each refresh
 * - **Retention policies**: Control how long historical versions are kept
 * - **Compaction**: Remove old versions while preserving queryable history
 *
 * ## Usage
 * ```typescript
 * import { createTemporalMaterializedView } from 'dotdo/db/primitives/materialized-view'
 *
 * const view = createTemporalMaterializedView({
 *   name: 'sales_summary',
 *   compute: (records) => aggregateSales(records),
 *   retention: { maxVersions: 100, maxAge: '7d' }
 * })
 *
 * // Refresh with source data
 * view.refresh(salesRecords, Date.now())
 *
 * // Query current state
 * const current = view.query()
 *
 * // Query historical state (AS OF)
 * const historical = view.queryAsOf('2024-01-01')
 *
 * // Apply retention policy
 * view.compact()
 * ```
 *
 * @see dotdo-1u71j
 * @module db/primitives/materialized-view/temporal-materialized-view
 */

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Input type for timestamp values - supports multiple formats
 */
export type TimestampInput = number | Date | string

/**
 * Retention policy for controlling version history
 */
export interface RetentionPolicy {
  /**
   * Maximum number of versions to keep.
   * Older versions beyond this count are removed on compact().
   */
  maxVersions?: number
  /**
   * Maximum age of versions in milliseconds.
   * Versions older than this are removed on compact().
   */
  maxAge?: number
}

/**
 * Snapshot metadata for listing stored versions
 */
export interface ViewSnapshotInfo {
  /** Version number (sequential, 1-based) */
  version: number
  /** Timestamp when this version was created */
  timestamp: number
  /** Number of rows in the snapshot */
  rowCount: number
  /** When this snapshot was created (wall clock time) */
  createdAt: number
}

/**
 * Full snapshot data including the computed state
 */
export interface ViewSnapshot<T> {
  /** Version number */
  version: number
  /** Timestamp for this version */
  timestamp: number
  /** The computed view data */
  data: T[]
  /** Row count */
  rowCount: number
  /** Creation wall clock time */
  createdAt: number
}

/**
 * Statistics about compaction operations
 */
export interface CompactStats {
  /** Number of versions removed */
  versionsRemoved: number
  /** Memory freed (estimated bytes) */
  memoryFreed: number
}

/**
 * Statistics about the temporal materialized view
 */
export interface TemporalViewStats {
  /** View name */
  name: string
  /** Number of stored versions */
  versionCount: number
  /** Total number of refresh operations performed */
  totalRefreshes: number
  /** Timestamp of the last refresh (undefined if never refreshed) */
  lastRefreshTime?: number
  /** Estimated memory usage in bytes */
  estimatedMemoryBytes: number
  /** Current retention policy */
  retention?: RetentionPolicy
}

/**
 * Configuration for creating a temporal materialized view
 */
export interface TemporalMaterializedViewConfig<TInput, TOutput> {
  /** Unique name for this view */
  name: string
  /**
   * Compute function that transforms input records into output rows.
   * Called on each refresh() with the source data.
   */
  compute: (records: TInput[]) => TOutput[]
  /** Optional retention policy */
  retention?: RetentionPolicy
}

/**
 * Temporal Materialized View interface
 */
export interface TemporalMaterializedView<TInput, TOutput> {
  /**
   * Get the view name
   */
  getName(): string

  /**
   * Refresh the view with new source data.
   * Creates a new version with the computed state.
   *
   * @param records - Source data to compute the view from
   * @param timestamp - Timestamp for this version
   * @returns The computed view data
   */
  refresh(records: TInput[], timestamp: TimestampInput): TOutput[]

  /**
   * Query the current (latest) view state
   */
  query(): TOutput[]

  /**
   * Query the view state as it existed at a specific timestamp.
   * Returns the most recent version at or before the given timestamp.
   *
   * @param timestamp - Point in time to query (ms since epoch, Date, or ISO string)
   * @returns View data at that timestamp, or empty array if no version exists
   */
  queryAsOf(timestamp: TimestampInput): TOutput[]

  /**
   * Query all versions within a time range.
   *
   * @param start - Start of time range (inclusive)
   * @param end - End of time range (inclusive)
   * @returns Array of snapshots within the range
   */
  queryVersionsBetween(start: TimestampInput, end: TimestampInput): ViewSnapshot<TOutput>[]

  /**
   * List all stored snapshots with metadata
   */
  listSnapshots(): ViewSnapshotInfo[]

  /**
   * Get a specific snapshot by version number
   *
   * @param version - Version number (1-based)
   */
  getSnapshot(version: number): ViewSnapshot<TOutput> | undefined

  /**
   * Delete a specific snapshot by version number
   *
   * @param version - Version number to delete
   * @returns true if deleted, false if not found
   */
  deleteSnapshot(version: number): boolean

  /**
   * Apply retention policy and remove old versions.
   *
   * @returns Statistics about the compaction
   */
  compact(): CompactStats

  /**
   * Get the current retention policy
   */
  getRetentionPolicy(): RetentionPolicy | undefined

  /**
   * Set a new retention policy
   */
  setRetentionPolicy(policy: RetentionPolicy): void

  /**
   * Get statistics about the view
   */
  getStats(): TemporalViewStats

  /**
   * Clear all versions and reset the view
   */
  clear(): void
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

interface InternalSnapshot<T> {
  version: number
  timestamp: number
  data: T[]
  createdAt: number
}

// =============================================================================
// TIMESTAMP NORMALIZATION
// =============================================================================

/**
 * Convert various timestamp input formats to milliseconds since epoch
 */
function normalizeTimestamp(input: TimestampInput): number {
  if (typeof input === 'number') {
    return input
  }
  if (input instanceof Date) {
    return input.getTime()
  }
  if (typeof input === 'string') {
    const parsed = new Date(input).getTime()
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid timestamp string: ${input}`)
    }
    return parsed
  }
  throw new Error(`Invalid timestamp type: ${typeof input}`)
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

class TemporalMaterializedViewImpl<TInput, TOutput>
  implements TemporalMaterializedView<TInput, TOutput>
{
  private readonly viewName: string
  private readonly computeFn: (records: TInput[]) => TOutput[]
  private retentionPolicy: RetentionPolicy | undefined

  /** Stored snapshots sorted by timestamp */
  private snapshots: InternalSnapshot<TOutput>[] = []

  /** Next version number */
  private nextVersion = 1

  /** Total refresh count (doesn't reset on compact) */
  private totalRefreshCount = 0

  constructor(config: TemporalMaterializedViewConfig<TInput, TOutput>) {
    if (!config.name || config.name.trim() === '') {
      throw new Error('View name is required')
    }
    if (!config.compute || typeof config.compute !== 'function') {
      throw new Error('Compute function is required')
    }

    this.viewName = config.name
    this.computeFn = config.compute
    this.retentionPolicy = config.retention
  }

  getName(): string {
    return this.viewName
  }

  refresh(records: TInput[], timestamp: TimestampInput): TOutput[] {
    const ts = normalizeTimestamp(timestamp)
    const data = this.computeFn(records)

    // Check if there's an existing snapshot at this exact timestamp
    const existingIdx = this.snapshots.findIndex((s) => s.timestamp === ts)

    if (existingIdx >= 0) {
      // Replace existing snapshot at same timestamp
      this.snapshots[existingIdx] = {
        version: this.snapshots[existingIdx]!.version,
        timestamp: ts,
        data,
        createdAt: Date.now(),
      }
    } else {
      // Create new snapshot
      const snapshot: InternalSnapshot<TOutput> = {
        version: this.nextVersion++,
        timestamp: ts,
        data,
        createdAt: Date.now(),
      }

      // Insert in sorted order by timestamp
      const insertIdx = this.findInsertPosition(ts)
      this.snapshots.splice(insertIdx, 0, snapshot)
    }

    this.totalRefreshCount++
    return data
  }

  query(): TOutput[] {
    if (this.snapshots.length === 0) {
      return []
    }
    // Return the latest snapshot's data
    return this.snapshots[this.snapshots.length - 1]!.data
  }

  queryAsOf(timestamp: TimestampInput): TOutput[] {
    const ts = normalizeTimestamp(timestamp)

    if (this.snapshots.length === 0) {
      return []
    }

    // Binary search for the most recent version at or before timestamp
    const snapshot = this.findVersionAtOrBefore(ts)
    return snapshot?.data ?? []
  }

  queryVersionsBetween(start: TimestampInput, end: TimestampInput): ViewSnapshot<TOutput>[] {
    const startTs = normalizeTimestamp(start)
    const endTs = normalizeTimestamp(end)

    if (startTs > endTs) {
      throw new Error('Start timestamp must be before or equal to end timestamp')
    }

    const results: ViewSnapshot<TOutput>[] = []

    for (const snapshot of this.snapshots) {
      if (snapshot.timestamp >= startTs && snapshot.timestamp <= endTs) {
        results.push({
          version: snapshot.version,
          timestamp: snapshot.timestamp,
          data: snapshot.data,
          rowCount: snapshot.data.length,
          createdAt: snapshot.createdAt,
        })
      }
    }

    return results
  }

  listSnapshots(): ViewSnapshotInfo[] {
    return this.snapshots.map((s) => ({
      version: s.version,
      timestamp: s.timestamp,
      rowCount: s.data.length,
      createdAt: s.createdAt,
    }))
  }

  getSnapshot(version: number): ViewSnapshot<TOutput> | undefined {
    const snapshot = this.snapshots.find((s) => s.version === version)
    if (!snapshot) {
      return undefined
    }
    return {
      version: snapshot.version,
      timestamp: snapshot.timestamp,
      data: snapshot.data,
      rowCount: snapshot.data.length,
      createdAt: snapshot.createdAt,
    }
  }

  deleteSnapshot(version: number): boolean {
    const idx = this.snapshots.findIndex((s) => s.version === version)
    if (idx < 0) {
      return false
    }
    this.snapshots.splice(idx, 1)
    return true
  }

  compact(): CompactStats {
    if (!this.retentionPolicy) {
      return { versionsRemoved: 0, memoryFreed: 0 }
    }

    const now = Date.now()
    const originalCount = this.snapshots.length
    let memoryFreed = 0

    // Apply maxAge filter first
    if (this.retentionPolicy.maxAge !== undefined) {
      const cutoff = now - this.retentionPolicy.maxAge
      const toRemove = this.snapshots.filter((s) => s.timestamp < cutoff)
      memoryFreed += this.estimateSnapshotsMemory(toRemove)
      this.snapshots = this.snapshots.filter((s) => s.timestamp >= cutoff)
    }

    // Apply maxVersions limit (keep most recent)
    if (
      this.retentionPolicy.maxVersions !== undefined &&
      this.snapshots.length > this.retentionPolicy.maxVersions
    ) {
      const removeCount = this.snapshots.length - this.retentionPolicy.maxVersions
      const toRemove = this.snapshots.slice(0, removeCount)
      memoryFreed += this.estimateSnapshotsMemory(toRemove)
      this.snapshots = this.snapshots.slice(removeCount)
    }

    return {
      versionsRemoved: originalCount - this.snapshots.length,
      memoryFreed,
    }
  }

  getRetentionPolicy(): RetentionPolicy | undefined {
    return this.retentionPolicy
  }

  setRetentionPolicy(policy: RetentionPolicy): void {
    this.retentionPolicy = policy
  }

  getStats(): TemporalViewStats {
    const lastSnapshot = this.snapshots[this.snapshots.length - 1]
    return {
      name: this.viewName,
      versionCount: this.snapshots.length,
      totalRefreshes: this.totalRefreshCount,
      lastRefreshTime: lastSnapshot?.timestamp,
      estimatedMemoryBytes: this.estimateSnapshotsMemory(this.snapshots),
      retention: this.retentionPolicy,
    }
  }

  clear(): void {
    this.snapshots = []
    this.nextVersion = 1
    this.totalRefreshCount = 0
  }

  // ===========================================================================
  // PRIVATE HELPER METHODS
  // ===========================================================================

  /**
   * Find insertion position to maintain sorted order by timestamp
   */
  private findInsertPosition(timestamp: number): number {
    let left = 0
    let right = this.snapshots.length

    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (this.snapshots[mid]!.timestamp <= timestamp) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    return left
  }

  /**
   * Find the most recent snapshot at or before the given timestamp
   */
  private findVersionAtOrBefore(timestamp: number): InternalSnapshot<TOutput> | null {
    let left = 0
    let right = this.snapshots.length - 1
    let result: InternalSnapshot<TOutput> | null = null

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const snapshot = this.snapshots[mid]!

      if (snapshot.timestamp <= timestamp) {
        result = snapshot
        left = mid + 1 // Look for a later version that still satisfies the condition
      } else {
        right = mid - 1
      }
    }

    return result
  }

  /**
   * Estimate memory usage for snapshots
   */
  private estimateSnapshotsMemory(snapshots: InternalSnapshot<TOutput>[]): number {
    let bytes = 0
    for (const snapshot of snapshots) {
      // Base overhead per snapshot
      bytes += 64

      // Estimate data size
      try {
        bytes += JSON.stringify(snapshot.data).length * 2 // UTF-16
      } catch {
        bytes += snapshot.data.length * 100 // Fallback estimate
      }
    }
    return bytes
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new TemporalMaterializedView instance.
 *
 * @example
 * ```typescript
 * const view = createTemporalMaterializedView({
 *   name: 'orders_by_region',
 *   compute: (orders) => {
 *     const byRegion = new Map<string, { region: string, total: number }>()
 *     for (const order of orders) {
 *       const existing = byRegion.get(order.region) || { region: order.region, total: 0 }
 *       existing.total += order.amount
 *       byRegion.set(order.region, existing)
 *     }
 *     return Array.from(byRegion.values())
 *   },
 *   retention: { maxVersions: 100, maxAge: 7 * 24 * 60 * 60 * 1000 }
 * })
 *
 * // Refresh periodically
 * view.refresh(latestOrders, Date.now())
 *
 * // Query historical state
 * const lastWeek = view.queryAsOf(Date.now() - 7 * 24 * 60 * 60 * 1000)
 * ```
 */
export function createTemporalMaterializedView<TInput, TOutput>(
  config: TemporalMaterializedViewConfig<TInput, TOutput>
): TemporalMaterializedView<TInput, TOutput> {
  return new TemporalMaterializedViewImpl(config)
}
