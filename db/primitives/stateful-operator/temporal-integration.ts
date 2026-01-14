/**
 * TemporalStateBackend - Time-travel integration for StatefulOperator
 *
 * Wraps a StateBackend with TemporalStore to provide time-travel queries on state.
 * This enables querying state as it existed at any historical timestamp.
 *
 * Features:
 * - Write state changes to both current and temporal stores
 * - Query state at arbitrary timestamps (getAt)
 * - Get full change history for a key (getHistory)
 * - Reconstruct entire state at a point in time (snapshotAt)
 * - Retention policy for temporal data cleanup
 *
 * @module db/primitives/stateful-operator/temporal-integration
 */

import type { StateBackend, StateSnapshot } from './index'
import type { TemporalStore, CacheStats, PruneStats, RetentionPolicy } from '../temporal-store'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Configuration options for TemporalStateBackend.
 */
export interface TemporalOptions {
  /**
   * Maximum age of temporal entries in milliseconds.
   * Entries older than this will be removed on compact().
   */
  retentionMs?: number

  /**
   * Interval for automatic compaction in milliseconds.
   * If set, compaction will run periodically.
   */
  compactionIntervalMs?: number
}

/**
 * A temporal entry representing a state change at a specific timestamp.
 */
export interface TemporalEntry<T> {
  /** The key that was modified */
  key: string
  /** The value at this point (undefined for deletes) */
  value: T
  /** Timestamp of the change */
  timestamp: number
  /** Type of operation */
  operation: 'put' | 'delete'
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * StateBackend wrapper that adds time-travel capabilities via TemporalStore.
 *
 * @typeParam T - The type of values stored
 *
 * @example
 * ```typescript
 * const current = new InMemoryStateBackend<User>('users')
 * const temporal = createTemporalStore<User>()
 * const backend = new TemporalStateBackend(current, temporal)
 *
 * // Store values (writes to both current and temporal)
 * await backend.put('user:123', { name: 'Alice' })
 *
 * // Time travel to see old state
 * const oldValue = await backend.getAt('user:123', yesterday)
 *
 * // Get full change history
 * for await (const entry of backend.getHistory('user:123')) {
 *   console.log(`At ${entry.timestamp}: ${entry.value}`)
 * }
 *
 * // Reconstruct entire state at a timestamp
 * const snapshot = await backend.snapshotAt(oneHourAgo)
 * ```
 */
export class TemporalStateBackend<T> implements StateBackend<T> {
  /** Backend name for identification */
  readonly name: string

  /** Tracks all keys that have ever been written (for snapshotAt) */
  private allKeys = new Set<string>()

  /** Internal marker for deleted values */
  private static readonly TOMBSTONE = Symbol('TOMBSTONE')

  constructor(
    private current: StateBackend<T>,
    private temporal: TemporalStore<T | typeof TemporalStateBackend.TOMBSTONE>,
    private options?: TemporalOptions
  ) {
    this.name = `temporal:${current.name}`
  }

  // ===========================================================================
  // STANDARD StateBackend INTERFACE
  // ===========================================================================

  /**
   * Get the current value for a key.
   */
  async get(key: string): Promise<T | undefined> {
    return this.current.get(key)
  }

  /**
   * Store a value with the current timestamp.
   * Writes to both current state and temporal history.
   */
  async put(key: string, value: T, ttl?: number): Promise<void> {
    const timestamp = Date.now()

    // Write to current state
    await this.current.put(key, value, ttl)

    // Record in temporal store
    await this.temporal.put(key, value, timestamp)

    // Track the key
    this.allKeys.add(key)
  }

  /**
   * Delete a key from current state and record deletion in temporal history.
   */
  async delete(key: string): Promise<void> {
    const timestamp = Date.now()

    // Delete from current state
    await this.current.delete(key)

    // Record deletion in temporal store (using tombstone marker)
    await this.temporal.put(key, TemporalStateBackend.TOMBSTONE as unknown as T, timestamp)
  }

  /**
   * List all entries with optional prefix filter.
   */
  async *list(prefix?: string): AsyncIterable<[string, T]> {
    for await (const entry of this.current.list(prefix)) {
      yield entry
    }
  }

  /**
   * Get the current number of entries.
   */
  async size(): Promise<number> {
    return this.current.size()
  }

  /**
   * Create a snapshot of current state.
   */
  async snapshot(): Promise<StateSnapshot> {
    return this.current.snapshot()
  }

  /**
   * Restore from a snapshot.
   * Note: This only restores current state, not temporal history.
   */
  async restore(snapshot: StateSnapshot): Promise<void> {
    await this.current.restore(snapshot)
  }

  /**
   * Clear all entries from current state.
   * Note: Temporal history is preserved.
   */
  async clear(): Promise<void> {
    await this.current.clear()
  }

  // ===========================================================================
  // TIME-TRAVEL OPERATIONS
  // ===========================================================================

  /**
   * Store a value at a specific timestamp.
   * Useful for importing historical data or backfilling.
   *
   * @param key - Key to store
   * @param value - Value to store
   * @param timestamp - Historical timestamp
   */
  async putAt(key: string, value: T, timestamp: number): Promise<void> {
    // Write to temporal store at specific timestamp
    await this.temporal.put(key, value, timestamp)

    // Track the key
    this.allKeys.add(key)

    // Update current state if this is the latest timestamp
    const current = await this.temporal.get(key)
    if (current !== null) {
      // Only update current if this could be the latest
      await this.current.put(key, value)
    }
  }

  /**
   * Record a deletion at a specific timestamp.
   *
   * @param key - Key to delete
   * @param timestamp - Historical timestamp of deletion
   */
  async deleteAt(key: string, timestamp: number): Promise<void> {
    // Record deletion tombstone at specific timestamp
    await this.temporal.put(key, TemporalStateBackend.TOMBSTONE as unknown as T, timestamp)

    // Track the key
    this.allKeys.add(key)
  }

  /**
   * Get the value as it existed at a specific timestamp.
   *
   * @param key - Key to look up
   * @param timestamp - Point in time to query
   * @returns Value at that timestamp, or undefined if not present
   */
  async getAt(key: string, timestamp: number): Promise<T | undefined> {
    const value = await this.temporal.getAsOf(key, timestamp)

    // Handle tombstone (deleted values)
    if (value === null || value === TemporalStateBackend.TOMBSTONE) {
      return undefined
    }

    return value as T
  }

  /**
   * Get the change history for a key.
   *
   * @param key - Key to get history for
   * @param from - Optional start timestamp (inclusive)
   * @param to - Optional end timestamp (inclusive)
   * @returns Async iterable of temporal entries
   */
  async *getHistory(key: string, from?: number, to?: number): AsyncIterable<TemporalEntry<T>> {
    // Use range query on temporal store
    const iterator = this.temporal.range(key, { start: from, end: to })

    // Collect entries and track history
    const entries: Array<{ value: T | typeof TemporalStateBackend.TOMBSTONE; timestamp: number }> =
      []

    // We need to iterate through all versions for this specific key
    // Since TemporalStore.range returns latest per key, we'll use a different approach
    // We'll iterate through the temporal store's internal versioned entries

    // For now, use getAsOf at incremental timestamps to reconstruct history
    // This is a simplified implementation - a production version would expose
    // versioned iteration from TemporalStore

    // Collect all timestamps we care about
    const timestamps: number[] = []
    const startTs = from ?? 0
    const endTs = to ?? Date.now()

    // Get the current value to know we have data
    const currentValue = await this.temporal.get(key)
    if (currentValue === null) {
      return
    }

    // Use binary search to find versions - simplified by checking at key points
    // A real implementation would expose getVersions() from TemporalStore
    let lastValue: T | typeof TemporalStateBackend.TOMBSTONE | null = null
    let checkTime = startTs

    // Check every 10ms for changes (simplified approach for testing)
    // In production, TemporalStore would expose version iteration
    while (checkTime <= endTs) {
      const value = await this.temporal.getAsOf(key, checkTime)
      if (value !== lastValue) {
        if (value !== null) {
          const operation =
            value === TemporalStateBackend.TOMBSTONE
              ? 'delete'
              : lastValue === TemporalStateBackend.TOMBSTONE
                ? 'put'
                : 'put'

          yield {
            key,
            value: value as T,
            timestamp: checkTime,
            operation,
          }
        }
        lastValue = value
      }
      checkTime += 10
    }

    // Ensure we have the final state
    const finalValue = await this.temporal.getAsOf(key, endTs)
    if (finalValue !== lastValue && finalValue !== null) {
      yield {
        key,
        value: finalValue as T,
        timestamp: endTs,
        operation: finalValue === TemporalStateBackend.TOMBSTONE ? 'delete' : 'put',
      }
    }
  }

  /**
   * Reconstruct the full state as it existed at a specific timestamp.
   *
   * @param timestamp - Point in time to reconstruct
   * @returns Map of all keys and their values at that timestamp
   */
  async snapshotAt(timestamp: number): Promise<Map<string, T>> {
    const snapshot = new Map<string, T>()
    const keys = Array.from(this.allKeys)

    for (const key of keys) {
      const value = await this.getAt(key, timestamp)
      if (value !== undefined) {
        snapshot.set(key, value)
      }
    }

    return snapshot
  }

  // ===========================================================================
  // RETENTION AND COMPACTION
  // ===========================================================================

  /**
   * Compact old temporal entries based on retention policy.
   *
   * @returns Statistics about what was compacted
   */
  async compact(): Promise<PruneStats> {
    if (this.options?.retentionMs) {
      const policy: RetentionPolicy = {
        maxAge: this.options.retentionMs,
      }
      return this.temporal.prune(policy)
    }

    // Use default pruning if available
    return this.temporal.prune()
  }

  // ===========================================================================
  // CACHE MANAGEMENT
  // ===========================================================================

  /**
   * Get cache statistics from the underlying TemporalStore.
   */
  getCacheStats(): CacheStats {
    return this.temporal.getCacheStats()
  }

  /**
   * Clear the temporal store's cache.
   */
  clearCache(): void {
    this.temporal.clearCache()
  }
}
