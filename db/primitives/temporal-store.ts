/**
 * TemporalStore - Time-aware key-value storage primitive
 *
 * Provides time-travel queries over a key-value store:
 * - put/get operations with timestamps
 * - getAsOf for historical queries
 * - range queries with time bounds
 * - snapshot creation and restoration
 */

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

export interface TemporalStoreOptions {
  enableTTL?: boolean
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

  constructor(options?: TemporalStoreOptions) {
    this.enableTTL = options?.enableTTL ?? false
  }

  async put(key: string, value: T, timestamp: number, options?: PutOptions): Promise<void> {
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
    const existingIdx = versions.findIndex(v => v.timestamp === timestamp)
    if (existingIdx !== -1) {
      // Replace existing entry with same timestamp (last writer wins)
      versions[existingIdx] = entry
    } else {
      // Insert maintaining sorted order by timestamp
      const insertIdx = versions.findIndex(v => v.timestamp > timestamp)
      if (insertIdx === -1) {
        versions.push(entry)
      } else {
        versions.splice(insertIdx, 0, entry)
      }
    }
  }

  async get(key: string): Promise<T | null> {
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
  }

  async getAsOf(key: string, timestamp: number): Promise<T | null> {
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
    const id = `snapshot-${++this.snapshotCounter}-${Date.now()}`
    const createdAt = Date.now()

    // Deep copy the entries
    const entriesCopy = new Map<string, VersionedEntry<T>[]>()
    for (const [key, versions] of this.entries) {
      entriesCopy.set(key, versions.map(v => ({ ...v })))
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
    return id
  }

  async restoreSnapshot(id: SnapshotId): Promise<void> {
    const snapshot = this.snapshots.get(id)
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${id}`)
    }

    // Restore entries from snapshot (deep copy)
    this.entries = new Map<string, VersionedEntry<T>[]>()
    for (const [key, versions] of snapshot.entries) {
      this.entries.set(key, versions.map(v => ({ ...v })))
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
}

/**
 * Factory function to create a TemporalStore instance
 */
export function createTemporalStore<T>(options?: TemporalStoreOptions): TemporalStore<T> {
  return new InMemoryTemporalStore<T>(options)
}
