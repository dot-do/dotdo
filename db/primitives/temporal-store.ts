/**
 * TemporalStore - Time-aware key-value storage primitive
 *
 * Provides time-travel queries over a key-value store:
 * - put/get operations with timestamps
 * - getAsOf for historical queries
 * - range queries with time bounds
 * - snapshot creation and restoration
 */

import { type MetricsCollector, noopMetrics, MetricNames } from './observability'
import { Duration, toMillis } from './utils/duration'

// Re-export Duration for backwards compatibility
export type { Duration } from './utils/duration'

// Types
export type SnapshotId = string

export interface SnapshotInfo {
  id: SnapshotId
  timestamp: number
  createdAt: number
}

export interface TimeRange {
  start?: number
  end?: number
}

export interface PutOptions {
  ttl?: number
}

/**
 * Retention policy for controlling memory usage
 */
export interface RetentionPolicy {
  /** Keep only the last N versions per key */
  maxVersions?: number
  /** Keep versions newer than this duration */
  maxAge?: Duration
}

export interface TemporalStoreOptions {
  enableTTL?: boolean
  /** Retention policy for automatic pruning */
  retention?: RetentionPolicy
  /** Optional metrics collector for observability */
  metrics?: MetricsCollector
}

// Internal types
interface VersionedEntry<T> {
  key: string
  value: T
  timestamp: number
  version: number
  expiresAt?: number
}

interface Snapshot<T> {
  id: SnapshotId
  entries: Map<string, VersionedEntry<T>[]>
  createdAt: number
  timestamp: number
}

/**
 * Statistics about pruning operations
 */
export interface PruneStats {
  /** Number of versions removed */
  versionsRemoved: number
  /** Number of keys affected */
  keysAffected: number
  /** Number of keys completely removed (all versions pruned) */
  keysRemoved: number
}

/**
 * TemporalStore interface
 */
export interface TemporalStore<T> {
  put(key: string, value: T, timestamp: number, options?: PutOptions): Promise<void>
  get(key: string): Promise<T | null>
  getAsOf(key: string, timestamp: number): Promise<T | null>
  range(prefix: string, timeRange: TimeRange): AsyncIterator<T>
  snapshot(): Promise<SnapshotId>
  restoreSnapshot(id: SnapshotId): Promise<void>
  listSnapshots(): Promise<SnapshotInfo[]>
  /** Prune old versions based on retention policy */
  prune(policy?: RetentionPolicy): Promise<PruneStats>
  /** Alias for prune() - compact old versions based on retention policy */
  compact(policy?: RetentionPolicy): Promise<PruneStats>
  /** Get current retention policy */
  getRetentionPolicy(): RetentionPolicy | undefined
  /** Set retention policy */
  setRetentionPolicy(policy: RetentionPolicy | undefined): void
}

/**
 * In-memory implementation of TemporalStore
 */
class InMemoryTemporalStore<T> implements TemporalStore<T> {
  // Map of key -> array of versioned entries (sorted by timestamp)
  private entries: Map<string, VersionedEntry<T>[]> = new Map()
  private snapshots: Map<SnapshotId, Snapshot<T>> = new Map()
  private snapshotCounter = 0
  private enableTTL: boolean
  private retentionPolicy: RetentionPolicy | undefined
  private metrics: MetricsCollector

  constructor(options?: TemporalStoreOptions) {
    this.enableTTL = options?.enableTTL ?? false
    this.retentionPolicy = options?.retention
    this.metrics = options?.metrics ?? noopMetrics
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
      const existingIdx = versions.findIndex((v) => v.timestamp === timestamp)
      if (existingIdx !== -1) {
        // Replace existing entry with same timestamp (last writer wins)
        versions[existingIdx] = entry
      } else {
        // Insert maintaining sorted order by timestamp
        const insertIdx = versions.findIndex((v) => v.timestamp > timestamp)
        if (insertIdx === -1) {
          versions.push(entry)
        } else {
          versions.splice(insertIdx, 0, entry)
        }
      }

      // Record version count gauge
      this.metrics.recordGauge(MetricNames.TEMPORAL_STORE_VERSION_COUNT, versions.length, { key })
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
      const latest = versions[versions.length - 1]

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
      const versions = this.entries.get(key)
      if (!versions || versions.length === 0) {
        return null
      }

      // Find the most recent version at or before the given timestamp
      // Versions are sorted by timestamp, so we search from the end
      for (let i = versions.length - 1; i >= 0; i--) {
        if (versions[i].timestamp <= timestamp) {
          return versions[i].value
        }
      }

      return null
    } finally {
      this.metrics.recordLatency(MetricNames.TEMPORAL_STORE_GET_AS_OF_LATENCY, performance.now() - start)
    }
  }

  range(prefix: string, timeRange: TimeRange): AsyncIterator<T> {
    const self = this
    const { start, end } = timeRange
    const now = Date.now()

    // Collect matching keys
    const matchingKeys: string[] = []
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        matchingKeys.push(key)
      }
    }

    let index = 0

    return {
      async next(): Promise<IteratorResult<T>> {
        while (index < matchingKeys.length) {
          const key = matchingKeys[index++]
          const versions = self.entries.get(key)
          if (!versions || versions.length === 0) {
            continue
          }

          // Filter versions by time range and find the latest within range
          let latestInRange: VersionedEntry<T> | null = null

          for (let i = versions.length - 1; i >= 0; i--) {
            const v = versions[i]

            // Check time range
            if (start !== undefined && v.timestamp < start) {
              continue
            }
            if (end !== undefined && v.timestamp > end) {
              continue
            }

            // Check TTL expiration for current queries (no time range)
            if (self.enableTTL && v.expiresAt !== undefined && start === undefined && end === undefined) {
              if (now >= v.expiresAt) {
                continue
              }
            }

            // Take the first match from the end (latest)
            latestInRange = v
            break
          }

          if (latestInRange) {
            return { value: latestInRange.value, done: false }
          }
        }

        return { value: undefined as unknown as T, done: true }
      },
    }
  }

  async snapshot(): Promise<SnapshotId> {
    const start = performance.now()
    try {
      const id = `snapshot-${++this.snapshotCounter}-${Date.now()}`
      const createdAt = Date.now()

      // Deep copy the entries
      const entriesCopy = new Map<string, VersionedEntry<T>[]>()
      for (const [key, versions] of this.entries) {
        entriesCopy.set(key, versions.map((v) => ({ ...v })))
      }

      // Find the maximum timestamp across all entries
      let maxTimestamp = 0
      for (const versions of this.entries.values()) {
        for (const v of versions) {
          if (v.timestamp > maxTimestamp) {
            maxTimestamp = v.timestamp
          }
        }
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
        this.entries.set(key, versions.map((v) => ({ ...v })))
      }

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

  /**
   * Prune old versions based on retention policy
   * Uses provided policy or falls back to instance retention policy
   */
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

      for (const [key, versions] of this.entries) {
        const originalCount = versions.length
        let filteredVersions = versions

        // Apply maxAge filter
        if (effectivePolicy.maxAge !== undefined) {
          const maxAgeMs = toMillis(effectivePolicy.maxAge)
          const cutoffTimestamp = now - maxAgeMs
          filteredVersions = filteredVersions.filter((v) => v.timestamp >= cutoffTimestamp)
        }

        // Apply maxVersions limit (keep the most recent N)
        if (effectivePolicy.maxVersions !== undefined && filteredVersions.length > effectivePolicy.maxVersions) {
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
        }
      }

      // Remove keys with no remaining versions
      for (const key of keysToRemove) {
        this.entries.delete(key)
      }

      // Record pruning metrics
      if (stats.versionsRemoved > 0) {
        this.metrics.incrementCounter(MetricNames.TEMPORAL_STORE_VERSIONS_PRUNED, undefined, stats.versionsRemoved)
        this.metrics.recordGauge(MetricNames.TEMPORAL_STORE_KEY_COUNT, this.entries.size)
      }

      return stats
    } finally {
      this.metrics.recordLatency(MetricNames.TEMPORAL_STORE_PRUNE_LATENCY, performance.now() - start)
    }
  }

  /**
   * Alias for prune() - compact old versions based on retention policy
   */
  async compact(policy?: RetentionPolicy): Promise<PruneStats> {
    return this.prune(policy)
  }

  /**
   * Get the current retention policy
   */
  getRetentionPolicy(): RetentionPolicy | undefined {
    return this.retentionPolicy
  }

  /**
   * Set the retention policy
   */
  setRetentionPolicy(policy: RetentionPolicy | undefined): void {
    this.retentionPolicy = policy
  }
}

/**
 * Factory function to create a TemporalStore instance
 */
export function createTemporalStore<T>(options?: TemporalStoreOptions): TemporalStore<T> {
  return new InMemoryTemporalStore<T>(options)
}
