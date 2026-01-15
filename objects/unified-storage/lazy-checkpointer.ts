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

import type { CheckpointerMetrics, MetricCheckpointTrigger } from './metrics'

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
  /** Add an entry (used for tracking modifications) */
  add?(key: string, type: string, data: unknown): void
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
  /** Metrics collector for observability */
  metrics?: CheckpointerMetrics
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

  // Metrics
  private metrics?: CheckpointerMetrics

  // Concurrency guard
  private checkpointInProgress = false
  private currentCheckpointPromise: Promise<CheckpointStats> | null = null

  // Version tracking for detecting writes during checkpoint
  private entryVersions = new Map<string, number>()
  private globalVersion = 0

  constructor(options: LazyCheckpointerOptions) {
    this.sql = options.sql
    this.config = {
      intervalMs: options.intervalMs ?? 10000,
      dirtyCountThreshold: options.dirtyCountThreshold ?? 100,
      memoryThresholdBytes: options.memoryThresholdBytes ?? 10 * 1024 * 1024, // 10MB
      columnarThreshold: options.columnarThreshold ?? 50,
    }
    this.onCheckpointCallback = options.onCheckpoint
    this.onErrorCallback = options.onError
    this.metrics = options.metrics

    // Wrap the dirty tracker to intercept add() calls for version tracking
    this.dirtyTracker = this.wrapDirtyTracker(options.dirtyTracker)
  }

  /**
   * Wrap the dirty tracker to intercept add() calls for version tracking
   */
  private wrapDirtyTracker(tracker: DirtyTracker): DirtyTracker {
    const self = this

    // If tracker has an add method, wrap it
    if (tracker.add) {
      const originalAdd = tracker.add.bind(tracker)
      tracker.add = function (key: string, type: string, data: unknown) {
        // Track the write version
        self.trackWrite(key)
        // Call original
        return originalAdd(key, type, data)
      }
    }

    return tracker
  }

  /**
   * Set metrics collector (can be set after construction)
   */
  setMetrics(metrics: CheckpointerMetrics): void {
    this.metrics = metrics
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
   * Check if a checkpoint is currently in progress
   *
   * This method is useful for:
   * - Avoiding duplicate checkpoint triggers during threshold-based checkpoints
   * - Coordinating external operations that need to wait for checkpoint completion
   * - Testing and debugging checkpoint behavior
   *
   * @returns `true` if a checkpoint is currently executing, `false` otherwise
   */
  isCheckpointInProgress(): boolean {
    return this.checkpointInProgress
  }

  /**
   * Wait for the current checkpoint to complete (if any)
   *
   * If a checkpoint is in progress, this method returns a promise that resolves
   * when the checkpoint completes (successfully or with an error). If no checkpoint
   * is in progress, it returns immediately.
   *
   * This is useful for ensuring all dirty data is persisted before:
   * - Shutting down the application
   * - Performing migrations
   * - Taking consistent snapshots
   *
   * @returns A promise that resolves when any in-progress checkpoint completes
   */
  async waitForCheckpoint(): Promise<void> {
    if (this.currentCheckpointPromise) {
      await this.currentCheckpointPromise.catch(() => {
        // Ignore errors - we just want to wait for completion
      })
    }
  }

  /**
   * Track a write to an entry by incrementing its version
   *
   * This method is called automatically when entries are modified through the
   * wrapped DirtyTracker. It enables safe concurrent operation detection during
   * checkpoints by tracking which entries have been modified.
   *
   * When a checkpoint runs, it snapshots the version of each entry. After the
   * checkpoint completes, only entries whose version hasn't changed are cleared
   * from the dirty set. Entries modified during the checkpoint remain dirty
   * for the next checkpoint cycle.
   *
   * @param key - The unique key of the entry being modified
   */
  trackWrite(key: string): void {
    this.globalVersion++
    this.entryVersions.set(key, this.globalVersion)
  }

  /**
   * Notify the checkpointer that data has become dirty.
   * This may trigger an immediate checkpoint if thresholds are exceeded.
   */
  notifyDirty(): void {
    // Skip if a checkpoint is already in progress
    if (this.checkpointInProgress) {
      return
    }

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
   *
   * Concurrency safety:
   * - If a checkpoint is already in progress, returns the existing promise
   * - Uses version tracking to detect writes during checkpoint
   * - Only clears dirty flags for entries unchanged since checkpoint start
   */
  checkpoint(trigger: CheckpointTrigger = 'manual'): Promise<CheckpointStats> {
    // If checkpoint is already in progress, return the existing promise
    // This serializes concurrent checkpoint calls
    if (this.checkpointInProgress && this.currentCheckpointPromise) {
      return this.currentCheckpointPromise
    }

    // Set the guard for the duration of the checkpoint
    this.checkpointInProgress = true

    // Execute checkpoint - the guard is cleared internally after critical section
    const promise = this.executeCheckpoint(trigger)

    // Store for concurrent call deduplication
    this.currentCheckpointPromise = promise

    // Clear stored promise when done (for gc and to allow new checkpoints)
    promise.finally(() => {
      this.currentCheckpointPromise = null
    })

    return promise
  }

  /**
   * Internal checkpoint execution (called by checkpoint() with guards)
   */
  private async executeCheckpoint(trigger: CheckpointTrigger): Promise<CheckpointStats> {
    const startTime = performance.now()

    // CRITICAL: Snapshot ALL current versions BEFORE calling getDirtyEntries()
    // This ensures any writes that occur during getDirtyEntries() will have higher versions
    const snapshotVersions = new Map<string, number>(this.entryVersions)

    // Also bump the global version so any writes during getDirtyEntries() get a new version
    const checkpointGeneration = this.globalVersion

    // Get dirty entries - writes may occur during this call via hooks
    const dirtyEntries = this.dirtyTracker.getDirtyEntries()

    // For entries that didn't have a version before checkpoint, they were
    // added during this checkpoint, so they shouldn't be cleaned
    // (snapshotVersions won't have them)

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
    let totalRowsWritten = 0
    const allKeys: string[] = []

    try {
      // Write each collection type
      for (const [type, entries] of entriesByType) {
        const { bytesWritten, rowsWritten } = this.writeCollection(type, entries)
        totalBytesWritten += bytesWritten
        totalRowsWritten += rowsWritten

        // Track keys
        for (const entry of entries) {
          allKeys.push(entry.key)
        }
      }

      // Only clear dirty flags for entries whose version hasn't changed since snapshot
      // This prevents clearing flags for entries modified during checkpoint
      const keysToClean: string[] = []
      for (const key of allKeys) {
        const snapshotVersion = snapshotVersions.get(key)
        const currentVersion = this.entryVersions.get(key)

        // Three cases:
        // 1. Both undefined: entry was never tracked, safe to clean
        // 2. Both defined and equal: entry unchanged during checkpoint, safe to clean
        // 3. Different versions: entry was modified during checkpoint, keep dirty
        if (snapshotVersion === currentVersion) {
          keysToClean.push(key)
        }
        // If version changed, entry was modified during checkpoint - leave it dirty
      }

      // Clear dirty flags only for unchanged entries
      if (keysToClean.length > 0) {
        this.dirtyTracker.clearDirty(keysToClean)
      }

      // Critical section complete - clear the guard
      // This allows timer-based checkpoints to proceed while we handle callbacks
      this.checkpointInProgress = false

      const durationMs = performance.now() - startTime

      const stats: CheckpointStats = {
        entityCount: dirtyEntries.size,
        bytesWritten: totalBytesWritten,
        durationMs,
        trigger,
      }

      // Update metrics
      this.metrics?.checkpointCount.inc()
      this.metrics?.checkpointLatency.observe(durationMs)
      this.metrics?.rowsWritten.inc(totalRowsWritten)
      this.metrics?.bytesWritten.inc(totalBytesWritten)

      // Track trigger type
      const metricTrigger = trigger as MetricCheckpointTrigger
      this.metrics?.triggerCounts[metricTrigger]?.inc()

      // Call the callback
      await this.onCheckpointCallback?.(stats)

      return stats
    } catch (error) {
      // Clear the guard on error
      this.checkpointInProgress = false
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
    // Skip if another checkpoint is already in progress
    // (we'll pick up the data on the next timer tick)
    if (this.checkpointInProgress) {
      return
    }

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
  ): { bytesWritten: number; rowsWritten: number } {
    let bytesWritten = 0
    let rowsWritten = 0

    if (entries.length < this.config.columnarThreshold) {
      // Columnar: write entire collection as single row
      bytesWritten = this.writeColumnar(type, entries)
      rowsWritten = 1
      this.columnarWrites++
      this.totalRowWrites++

      // Update metrics
      this.metrics?.columnarWrites.inc()
    } else {
      // Normalized: write each entry as individual row
      bytesWritten = this.writeNormalized(type, entries)
      rowsWritten = entries.length
      this.normalizedWrites += entries.length
      this.totalRowWrites += entries.length

      // Update metrics
      this.metrics?.normalizedWrites.inc(entries.length)
    }

    return { bytesWritten, rowsWritten }
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
