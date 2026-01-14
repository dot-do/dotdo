/**
 * LazyCheckpointer - Persists dirty state to SQLite on various triggers
 *
 * Triggers:
 * - Timer-based (every N seconds)
 * - Threshold-based (dirty count or memory exceeds limit)
 * - Hibernation (before DO hibernates)
 * - Manual (explicit checkpoint call)
 *
 * Uses columnar storage for cost optimization - small collections stored
 * as single row, large collections as individual rows.
 *
 * @module unified-storage/lazy-checkpointer
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Dirty tracker interface for tracking modified entities
 */
export interface DirtyTracker {
  /** Get all dirty entries with their type and data */
  getDirtyEntries(): Map<string, { type: string; data: unknown; size: number }>
  /** Get count of dirty entries */
  getDirtyCount(): number
  /** Get total memory usage of dirty entries */
  getMemoryUsage(): number
  /** Clear dirty flags for specified keys */
  clearDirty(keys: string[]): void
  /** Clear all dirty entries */
  clear(): void
}

/**
 * Minimal SQL storage interface
 */
export interface SqlStorage {
  exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
}

/**
 * Checkpoint trigger type
 */
export type CheckpointTrigger = 'timer' | 'threshold' | 'hibernation' | 'manual' | 'count' | 'memory'

/**
 * Statistics from a checkpoint operation
 */
export interface CheckpointStats {
  /** Number of entities checkpointed */
  entityCount: number
  /** Total bytes written */
  bytesWritten: number
  /** Duration in milliseconds */
  durationMs: number
  /** What triggered this checkpoint */
  trigger: CheckpointTrigger
}

/**
 * Aggregated statistics for the checkpointer
 */
export interface LazyCheckpointerStats {
  /** Total row writes performed */
  totalRowWrites: number
  /** Writes using columnar format (1 row per collection) */
  columnarWrites: number
  /** Writes using normalized format (1 row per entity) */
  normalizedWrites: number
}

/**
 * Configuration for LazyCheckpointer
 */
export interface LazyCheckpointerConfig {
  /** Interval for timer-based checkpoints in ms */
  intervalMs: number
  /** Dirty count threshold for triggering checkpoint */
  dirtyCountThreshold: number
  /** Memory threshold in bytes for triggering checkpoint */
  memoryThresholdBytes: number
  /** Threshold for columnar vs normalized storage */
  columnarThreshold: number
}

/**
 * Options for LazyCheckpointer constructor
 */
export interface LazyCheckpointerOptions {
  /** SQL storage for persisting data */
  sql: SqlStorage
  /** Dirty tracker for tracking modified entities */
  dirtyTracker: DirtyTracker
  /** Interval for timer-based checkpoints in ms (default: 10000) */
  intervalMs?: number
  /** Dirty count threshold for triggering checkpoint (default: 100) */
  dirtyCountThreshold?: number
  /** Memory threshold in bytes for triggering checkpoint (default: 10MB) */
  memoryThresholdBytes?: number
  /** Threshold for columnar vs normalized storage (default: 50) */
  columnarThreshold?: number
  /** Callback when checkpoint completes */
  onCheckpoint?: (stats: CheckpointStats) => void | Promise<void>
  /** Callback when an error occurs */
  onError?: (error: Error) => void
}

// ============================================================================
// LazyCheckpointer Implementation
// ============================================================================

/**
 * LazyCheckpointer persists dirty state to SQLite on various triggers.
 *
 * @example
 * ```typescript
 * const checkpointer = new LazyCheckpointer({
 *   sql,
 *   dirtyTracker,
 *   intervalMs: 5000,
 *   dirtyCountThreshold: 50,
 * })
 *
 * checkpointer.start()
 *
 * // Later, before hibernation
 * await checkpointer.beforeHibernation()
 * ```
 */
export class LazyCheckpointer {
  private sql: SqlStorage
  private dirtyTracker: DirtyTracker
  private config: LazyCheckpointerConfig
  private onCheckpointCallback?: (stats: CheckpointStats) => void | Promise<void>
  private onErrorCallback?: (error: Error) => void

  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  // Statistics
  private totalRowWrites = 0
  private columnarWrites = 0
  private normalizedWrites = 0

  constructor(options: LazyCheckpointerOptions) {
    this.sql = options.sql
    this.dirtyTracker = options.dirtyTracker
    this.config = {
      intervalMs: options.intervalMs ?? 10000,
      dirtyCountThreshold: options.dirtyCountThreshold ?? 100,
      memoryThresholdBytes: options.memoryThresholdBytes ?? 10 * 1024 * 1024, // 10MB
      columnarThreshold: options.columnarThreshold ?? 50,
    }
    this.onCheckpointCallback = options.onCheckpoint
    this.onErrorCallback = options.onError
  }

  /**
   * Start the timer-based checkpoint loop
   */
  start(): void {
    if (this.running) return

    this.running = true
    this.timer = setInterval(() => {
      this.timerCheckpoint()
    }, this.config.intervalMs)
  }

  /**
   * Stop the timer-based checkpoint loop
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.running = false
  }

  /**
   * Check if the checkpointer is running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Notify the checkpointer that data has become dirty.
   * This may trigger an immediate checkpoint if thresholds are exceeded.
   */
  notifyDirty(): void {
    const dirtyCount = this.dirtyTracker.getDirtyCount()
    const memoryUsage = this.dirtyTracker.getMemoryUsage()

    // Check dirty count threshold
    if (this.config.dirtyCountThreshold > 0 && dirtyCount >= this.config.dirtyCountThreshold) {
      this.checkpoint('count').catch((error) => {
        this.onErrorCallback?.(error as Error)
      })
      return
    }

    // Check memory threshold
    if (this.config.memoryThresholdBytes > 0 && memoryUsage >= this.config.memoryThresholdBytes) {
      this.checkpoint('memory').catch((error) => {
        this.onErrorCallback?.(error as Error)
      })
      return
    }
  }

  /**
   * Perform a checkpoint - persist all dirty entries to SQLite
   */
  async checkpoint(trigger: CheckpointTrigger = 'manual'): Promise<CheckpointStats> {
    const startTime = Date.now()
    const dirtyEntries = this.dirtyTracker.getDirtyEntries()

    if (dirtyEntries.size === 0) {
      return {
        entityCount: 0,
        bytesWritten: 0,
        durationMs: 0,
        trigger,
      }
    }

    // Group entries by type
    const entriesByType = new Map<string, Array<{ key: string; data: unknown; size: number }>>()

    for (const [key, entry] of dirtyEntries) {
      const existing = entriesByType.get(entry.type) ?? []
      existing.push({ key, data: entry.data, size: entry.size })
      entriesByType.set(entry.type, existing)
    }

    let totalBytesWritten = 0
    const keysToClean: string[] = []

    try {
      // Write each collection type
      for (const [type, entries] of entriesByType) {
        const bytesWritten = this.writeCollection(type, entries)
        totalBytesWritten += bytesWritten

        // Track keys for cleanup
        for (const entry of entries) {
          keysToClean.push(entry.key)
        }
      }

      // Clear dirty flags only after successful write
      this.dirtyTracker.clearDirty(keysToClean)

      const stats: CheckpointStats = {
        entityCount: dirtyEntries.size,
        bytesWritten: totalBytesWritten,
        durationMs: Date.now() - startTime,
        trigger,
      }

      // Call the callback
      await this.onCheckpointCallback?.(stats)

      return stats
    } catch (error) {
      // On error, call error callback and rethrow
      this.onErrorCallback?.(error as Error)
      throw error
    }
  }

  /**
   * Called before DO hibernation - flush all dirty state
   */
  async beforeHibernation(): Promise<void> {
    await this.checkpoint('hibernation')
  }

  /**
   * Destroy the checkpointer - flush and stop
   */
  async destroy(): Promise<void> {
    // Flush any remaining dirty data
    try {
      await this.checkpoint('manual')
    } catch {
      // Ignore errors during destroy
    }
    this.stop()
  }

  /**
   * Get the current configuration
   */
  getConfig(): LazyCheckpointerConfig {
    return { ...this.config }
  }

  /**
   * Get aggregated statistics
   */
  getStats(): LazyCheckpointerStats {
    return {
      totalRowWrites: this.totalRowWrites,
      columnarWrites: this.columnarWrites,
      normalizedWrites: this.normalizedWrites,
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Timer-triggered checkpoint
   */
  private timerCheckpoint(): void {
    // Only checkpoint if there are dirty entries
    if (this.dirtyTracker.getDirtyCount() === 0) {
      return
    }

    this.checkpoint('timer').catch((error) => {
      this.onErrorCallback?.(error as Error)
    })
  }

  /**
   * Write a collection of entries to SQLite
   * Uses columnar for small collections, normalized for large
   */
  private writeCollection(
    type: string,
    entries: Array<{ key: string; data: unknown; size: number }>
  ): number {
    let bytesWritten = 0

    if (entries.length < this.config.columnarThreshold) {
      // Columnar: write entire collection as single row
      bytesWritten = this.writeColumnar(type, entries)
      this.columnarWrites++
      this.totalRowWrites++
    } else {
      // Normalized: write each entry as individual row
      bytesWritten = this.writeNormalized(type, entries)
      this.normalizedWrites += entries.length
      this.totalRowWrites += entries.length
    }

    return bytesWritten
  }

  /**
   * Write collection as single columnar row
   */
  private writeColumnar(
    type: string,
    entries: Array<{ key: string; data: unknown; size: number }>
  ): number {
    // Build columnar data structure
    const columnarData: Record<string, unknown> = {}
    let totalSize = 0

    for (const entry of entries) {
      columnarData[entry.key] = entry.data
      totalSize += entry.size
    }

    const jsonData = JSON.stringify(columnarData)

    // Write as single row
    this.sql.exec(
      `INSERT INTO columnar_store (type, data, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(type) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      type,
      jsonData
    )

    return jsonData.length
  }

  /**
   * Write collection as individual normalized rows
   */
  private writeNormalized(
    type: string,
    entries: Array<{ key: string; data: unknown; size: number }>
  ): number {
    let totalSize = 0

    for (const entry of entries) {
      const jsonData = JSON.stringify(entry.data)
      totalSize += jsonData.length

      // Extract ID from key (format: "type:id")
      const id = entry.key.split(':')[1] ?? entry.key

      this.sql.exec(
        `INSERT INTO normalized_store (type, id, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(type, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        type,
        id,
        jsonData
      )
    }

    return totalSize
  }
}
