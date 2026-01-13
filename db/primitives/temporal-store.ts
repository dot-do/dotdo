/**
 * TemporalStore - Time-aware key-value storage primitive
 *
 * Provides time-travel queries over a key-value store with optimizations for
 * production workloads:
 *
 * ## Features
 * - **put/get** - Store and retrieve values with timestamps
 * - **getAsOf** - Historical queries with LRU cache for hot keys (< 1ms for recent)
 * - **range** - Streaming range queries with backpressure support
 * - **snapshot** - Point-in-time snapshots with efficient restoration
 * - **prune/compact** - Retention-based cleanup for memory management
 *
 * ## Performance Characteristics
 * | Operation | Time Complexity | Target Latency |
 * |-----------|-----------------|----------------|
 * | put | O(log n) | < 5ms |
 * | get | O(1) | < 1ms |
 * | getAsOf (cached) | O(1) | < 1ms |
 * | getAsOf (uncached) | O(log n) | < 10ms |
 * | range | O(k + m) | streaming |
 * | snapshot | O(n) | < 100ms for 10K |
 *
 * ## Memory Optimizations
 * - LRU cache for recent getAsOf queries (configurable size)
 * - Streaming iterators prevent memory spikes on large ranges
 * - Batch operations for efficient bulk inserts
 *
 * @module db/primitives/temporal-store
 */

import { type MetricsCollector, noopMetrics, MetricNames } from './observability'
import { Duration, toMillis } from './utils/duration'

// Re-export Duration for backwards compatibility
export type { Duration } from './utils/duration'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Unique identifier for a snapshot.
 * Format: `snapshot-{counter}-{timestamp}`
 */
export type SnapshotId = string

/**
 * Metadata about a stored snapshot.
 */
export interface SnapshotInfo {
  /** Unique snapshot identifier */
  id: SnapshotId
  /** Maximum timestamp of all entries at snapshot time */
  timestamp: number
  /** When the snapshot was created (wall clock time) */
  createdAt: number
}

/**
 * Time range bounds for range queries.
 * Both bounds are inclusive. Omit a bound for unbounded queries.
 *
 * @example
 * // Last hour of data
 * { start: Date.now() - 3600000, end: Date.now() }
 *
 * @example
 * // All data before a timestamp
 * { end: someTimestamp }
 */
export interface TimeRange {
  /** Start of time range (inclusive). Omit for no lower bound. */
  start?: number
  /** End of time range (inclusive). Omit for no upper bound. */
  end?: number
}

/**
 * Options for put operations.
 */
export interface PutOptions {
  /**
   * Time-to-live in milliseconds.
   * The entry will be considered expired after `timestamp + ttl`.
   * Only effective when `enableTTL` is true in store options.
   */
  ttl?: number
}

/**
 * Retention policy for controlling memory usage through version pruning.
 *
 * Both constraints can be combined - entries must satisfy both to be retained.
 *
 * @example
 * // Keep last 10 versions, but no older than 7 days
 * { maxVersions: 10, maxAge: '7d' }
 */
export interface RetentionPolicy {
  /**
   * Keep only the last N versions per key.
   * Older versions are removed on prune().
   */
  maxVersions?: number
  /**
   * Keep versions newer than this duration.
   * Accepts milliseconds (number) or duration string ('7d', '24h', '30m').
   */
  maxAge?: Duration
}

/**
 * Configuration options for TemporalStore.
 */
export interface TemporalStoreOptions {
  /**
   * Enable TTL-based expiration.
   * When true, entries with TTL set via PutOptions will expire.
   * @default false
   */
  enableTTL?: boolean

  /**
   * Default retention policy for automatic pruning.
   * Applied when prune() is called without explicit policy.
   */
  retention?: RetentionPolicy

  /**
   * Metrics collector for observability.
   * Use TestMetricsCollector for testing or integrate with your metrics backend.
   * @default noopMetrics (zero overhead)
   */
  metrics?: MetricsCollector

  /**
   * Maximum size of the LRU cache for getAsOf queries.
   * Higher values improve hit rate but use more memory.
   * @default 1000
   */
  cacheSize?: number

  /**
   * Hot tier window in milliseconds.
   * Queries within this window from current time are cached more aggressively.
   * @default 3600000 (1 hour)
   */
  hotTierWindow?: number
}

/**
 * Statistics returned from prune/compact operations.
 */
export interface PruneStats {
  /** Total number of versions removed across all keys */
  versionsRemoved: number
  /** Number of keys that had at least one version removed */
  keysAffected: number
  /** Number of keys completely removed (all versions pruned) */
  keysRemoved: number
}

/**
 * Options for batch put operations.
 */
export interface BatchPutEntry<T> {
  /** Key to store the value under */
  key: string
  /** Value to store */
  value: T
  /** Timestamp for this entry */
  timestamp: number
  /** Optional TTL for this entry */
  ttl?: number
}

/**
 * Statistics about cache performance.
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number
  /** Number of cache misses */
  misses: number
  /** Current number of entries in cache */
  size: number
  /** Cache hit rate (0-1) */
  hitRate: number
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

/**
 * Internal representation of a versioned entry.
 * @internal
 */
interface VersionedEntry<T> {
  key: string
  value: T
  timestamp: number
  version: number
  expiresAt?: number
}

/**
 * Internal snapshot structure.
 * @internal
 */
interface Snapshot<T> {
  id: SnapshotId
  entries: Map<string, VersionedEntry<T>[]>
  createdAt: number
  timestamp: number
}

/**
 * Cache key format for getAsOf lookups.
 * @internal
 */
type CacheKey = string

// =============================================================================
// LRU CACHE IMPLEMENTATION
// =============================================================================

/**
 * Simple LRU (Least Recently Used) cache for getAsOf queries.
 * Uses Map's insertion order for O(1) operations.
 * @internal
 */
class LRUCache<V> {
  private cache: Map<CacheKey, V>
  private readonly maxSize: number

  /** Cache statistics */
  public hits = 0
  public misses = 0

  constructor(maxSize: number) {
    this.maxSize = maxSize
    this.cache = new Map()
  }

  /**
   * Get a value from the cache.
   * Moves the entry to the end (most recently used) if found.
   */
  get(key: CacheKey): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
      this.hits++
      return value
    }
    this.misses++
    return undefined
  }

  /**
   * Set a value in the cache.
   * Evicts oldest entry if cache is full.
   */
  set(key: CacheKey, value: V): void {
    // If key exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first entry)
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, value)
  }

  /**
   * Invalidate entries for a specific key (all timestamps).
   */
  invalidateKey(keyPrefix: string): void {
    for (const cacheKey of this.cache.keys()) {
      if (cacheKey.startsWith(keyPrefix + ':')) {
        this.cache.delete(cacheKey)
      }
    }
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get current cache size.
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
    }
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.hits = 0
    this.misses = 0
  }
}

// =============================================================================
// TEMPORAL STORE INTERFACE
// =============================================================================

/**
 * Time-aware key-value store with versioning and snapshots.
 *
 * @typeParam T - The type of values stored
 *
 * @example
 * ```typescript
 * const store = createTemporalStore<UserProfile>()
 *
 * // Store with timestamp
 * await store.put('user:123', { name: 'Alice', status: 'active' }, Date.now())
 *
 * // Later updates create new versions
 * await store.put('user:123', { name: 'Alice', status: 'premium' }, Date.now())
 *
 * // Time travel to see old state
 * const oldProfile = await store.getAsOf('user:123', oldTimestamp)
 *
 * // Create backup
 * const snapshotId = await store.snapshot()
 * ```
 */
export interface TemporalStore<T> {
  /**
   * Store a value with a timestamp.
   *
   * Creates a new version if the key already exists.
   * If a version with the same timestamp exists, it will be overwritten (last writer wins).
   *
   * @param key - Unique key for the value
   * @param value - Value to store
   * @param timestamp - Timestamp for this version (typically Date.now())
   * @param options - Optional TTL configuration
   *
   * @example
   * await store.put('user:123', { name: 'Alice' }, Date.now())
   * await store.put('user:123', { name: 'Alice Updated' }, Date.now(), { ttl: 3600000 })
   */
  put(key: string, value: T, timestamp: number, options?: PutOptions): Promise<void>

  /**
   * Get the latest value for a key.
   *
   * Returns null if the key doesn't exist or if the latest version is expired (TTL).
   *
   * @param key - Key to look up
   * @returns Latest value or null
   *
   * @example
   * const user = await store.get('user:123')
   * if (user) {
   *   console.log(user.name)
   * }
   */
  get(key: string): Promise<T | null>

  /**
   * Get the value as it existed at a specific timestamp (time travel).
   *
   * Returns the most recent version at or before the given timestamp.
   * Uses LRU caching for frequently accessed timestamps.
   *
   * @param key - Key to look up
   * @param timestamp - Point in time to query
   * @returns Value at that time or null if no version exists
   *
   * @example
   * // What was the user's status yesterday?
   * const yesterday = Date.now() - 86400000
   * const oldUser = await store.getAsOf('user:123', yesterday)
   */
  getAsOf(key: string, timestamp: number): Promise<T | null>

  /**
   * Stream all values matching a prefix within a time range.
   *
   * Returns an async iterator that yields values lazily for memory efficiency.
   * Each key returns only its latest version within the time range.
   *
   * @param prefix - Key prefix to match (use '' for all keys)
   * @param timeRange - Optional time bounds
   * @returns Async iterator of values
   *
   * @example
   * // Stream all user data from the last hour
   * const iterator = store.range('user:', { start: Date.now() - 3600000 })
   * for await (const user of { [Symbol.asyncIterator]: () => iterator }) {
   *   console.log(user.name)
   * }
   */
  range(prefix: string, timeRange: TimeRange): AsyncIterator<T>

  /**
   * Create a point-in-time snapshot.
   *
   * Captures the current state of all entries for later restoration.
   * Snapshots are stored in memory and persist until the store is destroyed.
   *
   * @returns Unique snapshot identifier
   *
   * @example
   * const snapshotId = await store.snapshot()
   * // Make changes...
   * await store.restoreSnapshot(snapshotId) // Revert all changes
   */
  snapshot(): Promise<SnapshotId>

  /**
   * Restore the store to a previous snapshot state.
   *
   * Replaces all current entries with the snapshot's entries.
   * The snapshot remains available for future restorations.
   *
   * @param id - Snapshot ID from a previous snapshot() call
   * @throws Error if snapshot ID is not found
   *
   * @example
   * await store.restoreSnapshot(snapshotId)
   */
  restoreSnapshot(id: SnapshotId): Promise<void>

  /**
   * List all available snapshots.
   *
   * @returns Array of snapshot metadata
   */
  listSnapshots(): Promise<SnapshotInfo[]>

  /**
   * Remove old versions based on retention policy.
   *
   * Applies the provided policy or falls back to the default retention policy.
   * Does nothing if no policy is set (unlimited retention).
   *
   * @param policy - Optional policy override
   * @returns Statistics about what was pruned
   *
   * @example
   * // Keep only last 5 versions
   * const stats = await store.prune({ maxVersions: 5 })
   * console.log(`Removed ${stats.versionsRemoved} old versions`)
   */
  prune(policy?: RetentionPolicy): Promise<PruneStats>

  /**
   * Alias for prune() - compact old versions based on retention policy.
   * @see prune
   */
  compact(policy?: RetentionPolicy): Promise<PruneStats>

  /**
   * Get the current default retention policy.
   */
  getRetentionPolicy(): RetentionPolicy | undefined

  /**
   * Set the default retention policy.
   *
   * @param policy - New policy or undefined to disable
   */
  setRetentionPolicy(policy: RetentionPolicy | undefined): void

  /**
   * Store multiple values in a single operation.
   *
   * More efficient than individual puts for bulk inserts.
   * Entries are processed in order, so later entries for the same key/timestamp win.
   *
   * @param entries - Array of entries to store
   *
   * @example
   * await store.putBatch([
   *   { key: 'user:1', value: { name: 'Alice' }, timestamp: now },
   *   { key: 'user:2', value: { name: 'Bob' }, timestamp: now },
   * ])
   */
  putBatch(entries: BatchPutEntry<T>[]): Promise<void>

  /**
   * Get cache performance statistics.
   *
   * Useful for tuning cache size and monitoring hit rates.
   *
   * @returns Cache statistics
   */
  getCacheStats(): CacheStats

  /**
   * Clear the getAsOf cache.
   *
   * Call after bulk updates or when memory is constrained.
   */
  clearCache(): void
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * In-memory implementation of TemporalStore with LRU caching.
 * @internal
 */
class InMemoryTemporalStore<T> implements TemporalStore<T> {
  /** Map of key -> array of versioned entries (sorted by timestamp) */
  private entries: Map<string, VersionedEntry<T>[]> = new Map()

  /** Stored snapshots */
  private snapshots: Map<SnapshotId, Snapshot<T>> = new Map()

  /** Counter for generating snapshot IDs */
  private snapshotCounter = 0

  /** Whether TTL is enabled */
  private readonly enableTTL: boolean

  /** Default retention policy */
  private retentionPolicy: RetentionPolicy | undefined

  /** Metrics collector */
  private readonly metrics: MetricsCollector

  /** LRU cache for getAsOf queries */
  private readonly cache: LRUCache<T | null>

  /** Hot tier window in milliseconds */
  private readonly hotTierWindow: number

  constructor(options?: TemporalStoreOptions) {
    this.enableTTL = options?.enableTTL ?? false
    this.retentionPolicy = options?.retention
    this.metrics = options?.metrics ?? noopMetrics
    this.cache = new LRUCache<T | null>(options?.cacheSize ?? 1000)
    this.hotTierWindow = options?.hotTierWindow ?? 3600000 // 1 hour default
  }

  async put(key: string, value: T, timestamp: number, options?: PutOptions): Promise<void> {
    const start = performance.now()
    try {
      let versions = this.entries.get(key)
      if (!versions) {
        versions = []
        this.entries.set(key, versions)
      }

      const version = versions.length + 1
      const entry: VersionedEntry<T> = {
        key,
        value,
        timestamp,
        version,
      }

      // Handle TTL if enabled
      if (this.enableTTL && options?.ttl !== undefined) {
        entry.expiresAt = timestamp + options.ttl
      }

      // Check if there's an existing entry with the same timestamp
      const existingIdx = this.binarySearchByTimestamp(versions, timestamp)
      if (existingIdx >= 0 && versions[existingIdx]!.timestamp === timestamp) {
        // Replace existing entry with same timestamp (last writer wins)
        versions[existingIdx] = entry
      } else {
        // Insert maintaining sorted order by timestamp
        const insertIdx = this.findInsertPosition(versions, timestamp)
        versions.splice(insertIdx, 0, entry)
      }

      // Invalidate cache entries for this key
      this.cache.invalidateKey(key)

      // Record version count gauge
      this.metrics.recordGauge(MetricNames.TEMPORAL_STORE_VERSION_COUNT, versions.length, { key })
      this.metrics.recordGauge(MetricNames.TEMPORAL_STORE_KEY_COUNT, this.entries.size)
    } finally {
      this.metrics.recordLatency(MetricNames.TEMPORAL_STORE_PUT_LATENCY, performance.now() - start)
    }
  }

  async putBatch(entries: BatchPutEntry<T>[]): Promise<void> {
    const start = performance.now()
    try {
      // Group entries by key for efficient processing
      const byKey = new Map<string, BatchPutEntry<T>[]>()
      for (const entry of entries) {
        const existing = byKey.get(entry.key)
        if (existing) {
          existing.push(entry)
        } else {
          byKey.set(entry.key, [entry])
        }
      }

      // Process each key's entries
      for (const [key, keyEntries] of byKey) {
        let versions = this.entries.get(key)
        if (!versions) {
          versions = []
          this.entries.set(key, versions)
        }

        // Sort entries by timestamp for efficient insertion
        keyEntries.sort((a, b) => a.timestamp - b.timestamp)

        for (const entry of keyEntries) {
          const version = versions.length + 1
          const versionedEntry: VersionedEntry<T> = {
            key,
            value: entry.value,
            timestamp: entry.timestamp,
            version,
          }

          if (this.enableTTL && entry.ttl !== undefined) {
            versionedEntry.expiresAt = entry.timestamp + entry.ttl
          }

          // Check for existing entry with same timestamp
          const existingIdx = this.binarySearchByTimestamp(versions, entry.timestamp)
          if (existingIdx >= 0 && versions[existingIdx]!.timestamp === entry.timestamp) {
            versions[existingIdx] = versionedEntry
          } else {
            const insertIdx = this.findInsertPosition(versions, entry.timestamp)
            versions.splice(insertIdx, 0, versionedEntry)
          }
        }

        // Invalidate cache for this key
        this.cache.invalidateKey(key)
      }

      // Record metrics
      this.metrics.recordGauge(MetricNames.TEMPORAL_STORE_KEY_COUNT, this.entries.size)
    } finally {
      this.metrics.recordLatency(MetricNames.TEMPORAL_STORE_PUT_LATENCY, performance.now() - start)
    }
  }

  async get(key: string): Promise<T | null> {
    const start = performance.now()
    try {
      const versions = this.entries.get(key)
      if (!versions || versions.length === 0) {
        return null
      }

      // Get the latest version
      const latest = versions[versions.length - 1]!

      // Check TTL expiration
      if (this.enableTTL && latest.expiresAt !== undefined) {
        if (Date.now() >= latest.expiresAt) {
          return null
        }
      }

      return latest.value
    } finally {
      this.metrics.recordLatency(MetricNames.TEMPORAL_STORE_GET_LATENCY, performance.now() - start)
    }
  }

  async getAsOf(key: string, timestamp: number): Promise<T | null> {
    const start = performance.now()
    try {
      // Check cache first
      const cacheKey = `${key}:${timestamp}`
      const cached = this.cache.get(cacheKey)
      if (cached !== undefined) {
        this.metrics.incrementCounter('temporal_store.cache.hit')
        return cached
      }
      this.metrics.incrementCounter('temporal_store.cache.miss')

      const versions = this.entries.get(key)
      if (!versions || versions.length === 0) {
        // Cache null result too (negative caching)
        this.cache.set(cacheKey, null)
        return null
      }

      // Binary search for the version at or before timestamp
      const result = this.findVersionAtOrBefore(versions, timestamp)

      // Cache the result (including null)
      // Only cache if within hot tier window for better cache efficiency
      const isHotTier = Date.now() - timestamp <= this.hotTierWindow
      if (isHotTier || result !== null) {
        this.cache.set(cacheKey, result)
      }

      return result
    } finally {
      this.metrics.recordLatency(MetricNames.TEMPORAL_STORE_GET_AS_OF_LATENCY, performance.now() - start)
    }
  }

  range(prefix: string, timeRange: TimeRange): AsyncIterator<T> {
    const self = this
    const { start: rangeStart, end: rangeEnd } = timeRange
    const now = Date.now()

    // Collect matching keys lazily using generator
    const matchingKeys: string[] = []
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        matchingKeys.push(key)
      }
    }

    let index = 0
    const rangeStart_ts = performance.now()

    return {
      async next(): Promise<IteratorResult<T>> {
        while (index < matchingKeys.length) {
          const key = matchingKeys[index++]!
          const versions = self.entries.get(key)
          if (!versions || versions.length === 0) {
            continue
          }

          // Find the latest version within the time range using binary search
          const latestInRange = self.findLatestInRange(versions, rangeStart, rangeEnd, now)

          if (latestInRange !== null) {
            return { value: latestInRange, done: false }
          }
        }

        // Record total range query time when exhausted
        self.metrics.recordLatency('temporal_store.range.latency', performance.now() - rangeStart_ts)
        return { value: undefined as unknown as T, done: true }
      },
    }
  }

  async snapshot(): Promise<SnapshotId> {
    const start = performance.now()
    try {
      const id = `snapshot-${++this.snapshotCounter}-${Date.now()}`
      const createdAt = Date.now()

      // Deep copy the entries using efficient iteration
      const entriesCopy = new Map<string, VersionedEntry<T>[]>()
      let maxTimestamp = 0

      for (const [key, versions] of this.entries) {
        const versionsCopy: VersionedEntry<T>[] = new Array(versions.length)
        for (let i = 0; i < versions.length; i++) {
          const v = versions[i]!
          versionsCopy[i] = { ...v }
          if (v.timestamp > maxTimestamp) {
            maxTimestamp = v.timestamp
          }
        }
        entriesCopy.set(key, versionsCopy)
      }

      const snapshot: Snapshot<T> = {
        id,
        entries: entriesCopy,
        createdAt,
        timestamp: maxTimestamp,
      }

      this.snapshots.set(id, snapshot)
      this.metrics.recordGauge(MetricNames.TEMPORAL_STORE_SNAPSHOT_COUNT, this.snapshots.size)
      return id
    } finally {
      this.metrics.recordLatency(MetricNames.TEMPORAL_STORE_SNAPSHOT_LATENCY, performance.now() - start)
    }
  }

  async restoreSnapshot(id: SnapshotId): Promise<void> {
    const start = performance.now()
    try {
      const snapshot = this.snapshots.get(id)
      if (!snapshot) {
        throw new Error(`Snapshot not found: ${id}`)
      }

      // Restore entries from snapshot (deep copy)
      this.entries = new Map<string, VersionedEntry<T>[]>()
      for (const [key, versions] of snapshot.entries) {
        const versionsCopy: VersionedEntry<T>[] = new Array(versions.length)
        for (let i = 0; i < versions.length; i++) {
          versionsCopy[i] = { ...versions[i]! }
        }
        this.entries.set(key, versionsCopy)
      }

      // Clear cache after restore (state has changed)
      this.cache.clear()

      // Update key count gauge after restore
      this.metrics.recordGauge(MetricNames.TEMPORAL_STORE_KEY_COUNT, this.entries.size)
    } finally {
      this.metrics.recordLatency(MetricNames.TEMPORAL_STORE_RESTORE_LATENCY, performance.now() - start)
    }
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const result: SnapshotInfo[] = []
    for (const snapshot of this.snapshots.values()) {
      result.push({
        id: snapshot.id,
        timestamp: snapshot.timestamp,
        createdAt: snapshot.createdAt,
      })
    }
    return result
  }

  async prune(policy?: RetentionPolicy): Promise<PruneStats> {
    const start = performance.now()
    try {
      const effectivePolicy = policy ?? this.retentionPolicy

      // If no policy is set, do nothing (backwards compatible - unlimited retention)
      if (!effectivePolicy) {
        return { versionsRemoved: 0, keysAffected: 0, keysRemoved: 0 }
      }

      const now = Date.now()
      const stats: PruneStats = { versionsRemoved: 0, keysAffected: 0, keysRemoved: 0 }
      const keysToRemove: string[] = []

      // Calculate maxAge cutoff once
      const maxAgeCutoff =
        effectivePolicy.maxAge !== undefined ? now - toMillis(effectivePolicy.maxAge) : undefined

      for (const [key, versions] of this.entries) {
        const originalCount = versions.length
        let filteredVersions = versions

        // Apply maxAge filter
        if (maxAgeCutoff !== undefined) {
          filteredVersions = filteredVersions.filter((v) => v.timestamp >= maxAgeCutoff)
        }

        // Apply maxVersions limit (keep the most recent N)
        if (
          effectivePolicy.maxVersions !== undefined &&
          filteredVersions.length > effectivePolicy.maxVersions
        ) {
          // Versions are sorted by timestamp, so slice from the end
          filteredVersions = filteredVersions.slice(-effectivePolicy.maxVersions)
        }

        const removedCount = originalCount - filteredVersions.length
        if (removedCount > 0) {
          stats.versionsRemoved += removedCount
          stats.keysAffected++

          if (filteredVersions.length === 0) {
            keysToRemove.push(key)
            stats.keysRemoved++
          } else {
            this.entries.set(key, filteredVersions)
          }

          // Invalidate cache for pruned keys
          this.cache.invalidateKey(key)
        }
      }

      // Remove keys with no remaining versions
      for (const key of keysToRemove) {
        this.entries.delete(key)
      }

      // Record pruning metrics
      if (stats.versionsRemoved > 0) {
        this.metrics.incrementCounter(
          MetricNames.TEMPORAL_STORE_VERSIONS_PRUNED,
          undefined,
          stats.versionsRemoved
        )
        this.metrics.recordGauge(MetricNames.TEMPORAL_STORE_KEY_COUNT, this.entries.size)
      }

      return stats
    } finally {
      this.metrics.recordLatency(MetricNames.TEMPORAL_STORE_PRUNE_LATENCY, performance.now() - start)
    }
  }

  async compact(policy?: RetentionPolicy): Promise<PruneStats> {
    return this.prune(policy)
  }

  getRetentionPolicy(): RetentionPolicy | undefined {
    return this.retentionPolicy
  }

  setRetentionPolicy(policy: RetentionPolicy | undefined): void {
    this.retentionPolicy = policy
  }

  getCacheStats(): CacheStats {
    return this.cache.getStats()
  }

  clearCache(): void {
    this.cache.clear()
  }

  // ===========================================================================
  // PRIVATE HELPER METHODS
  // ===========================================================================

  /**
   * Binary search to find an entry with exact timestamp match.
   * Returns index if found, -1 otherwise.
   */
  private binarySearchByTimestamp(versions: VersionedEntry<T>[], timestamp: number): number {
    let left = 0
    let right = versions.length - 1

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const midTs = versions[mid]!.timestamp

      if (midTs === timestamp) {
        return mid
      } else if (midTs < timestamp) {
        left = mid + 1
      } else {
        right = mid - 1
      }
    }

    return -1
  }

  /**
   * Find the insertion position for a new entry with given timestamp.
   * Returns the index where the entry should be inserted to maintain sorted order.
   */
  private findInsertPosition(versions: VersionedEntry<T>[], timestamp: number): number {
    let left = 0
    let right = versions.length

    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (versions[mid]!.timestamp <= timestamp) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    return left
  }

  /**
   * Find the most recent version at or before the given timestamp using binary search.
   * Returns null if no such version exists.
   */
  private findVersionAtOrBefore(versions: VersionedEntry<T>[], timestamp: number): T | null {
    let left = 0
    let right = versions.length - 1
    let result: T | null = null

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const midTs = versions[mid]!.timestamp

      if (midTs <= timestamp) {
        result = versions[mid]!.value
        left = mid + 1 // Look for a later version that still satisfies the condition
      } else {
        right = mid - 1
      }
    }

    return result
  }

  /**
   * Find the latest version within a time range.
   * Handles TTL expiration for unbounded queries.
   */
  private findLatestInRange(
    versions: VersionedEntry<T>[],
    rangeStart: number | undefined,
    rangeEnd: number | undefined,
    now: number
  ): T | null {
    // Start from the end and work backwards for latest
    for (let i = versions.length - 1; i >= 0; i--) {
      const v = versions[i]!

      // Check time range
      if (rangeStart !== undefined && v.timestamp < rangeStart) {
        continue
      }
      if (rangeEnd !== undefined && v.timestamp > rangeEnd) {
        continue
      }

      // Check TTL expiration for current queries (no time range)
      if (
        this.enableTTL &&
        v.expiresAt !== undefined &&
        rangeStart === undefined &&
        rangeEnd === undefined
      ) {
        if (now >= v.expiresAt) {
          continue
        }
      }

      return v.value
    }

    return null
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new TemporalStore instance.
 *
 * @typeParam T - The type of values to store
 * @param options - Configuration options
 * @returns A new TemporalStore instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const store = createTemporalStore<UserProfile>()
 *
 * // With caching configuration
 * const store = createTemporalStore<SensorReading>({
 *   cacheSize: 5000,
 *   hotTierWindow: 86400000, // 24 hours
 * })
 *
 * // With metrics and retention
 * const store = createTemporalStore<LogEntry>({
 *   metrics: myMetricsCollector,
 *   retention: { maxVersions: 100, maxAge: '7d' },
 * })
 * ```
 */
export function createTemporalStore<T>(options?: TemporalStoreOptions): TemporalStore<T> {
  return new InMemoryTemporalStore<T>(options)
}
