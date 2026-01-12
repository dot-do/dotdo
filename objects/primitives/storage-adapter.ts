/**
 * DO Storage Adapter
 *
 * Adapts Durable Object storage to work with the unified primitives.
 * Provides a consistent interface for primitives to persist their state
 * using DO's built-in storage mechanisms.
 *
 * Key features:
 * - Namespaced key storage to avoid collisions
 * - Batch operations for efficiency
 * - Serialization/deserialization handling
 * - SQL storage support for complex queries
 */

/**
 * Storage interface that primitives use for persistence
 */
export interface PrimitiveStorage {
  /** Get a value by key */
  get<T>(key: string): Promise<T | undefined>
  /** Put a value by key */
  put<T>(key: string, value: T): Promise<void>
  /** Delete a value by key */
  delete(key: string): Promise<boolean>
  /** List values with optional prefix */
  list<T>(prefix?: string): Promise<Map<string, T>>
  /** Batch put multiple values */
  putMany<T>(entries: Array<{ key: string; value: T }>): Promise<void>
  /** Batch delete multiple keys */
  deleteMany(keys: string[]): Promise<void>
}

/**
 * Options for the storage adapter
 */
export interface DOStorageAdapterOptions {
  /** Namespace prefix for all keys (default: 'primitives') */
  namespace?: string
  /** Enable SQL storage for complex data (default: false) */
  useSql?: boolean
}

/**
 * Internal prefix for DO storage keys
 */
const DEFAULT_NAMESPACE = 'primitives'

/**
 * DO Storage Adapter implementation
 */
class DOStorageAdapterImpl implements PrimitiveStorage {
  private readonly storage: DurableObjectStorage
  private readonly namespace: string
  private readonly useSql: boolean

  constructor(storage: DurableObjectStorage, options?: DOStorageAdapterOptions) {
    this.storage = storage
    this.namespace = options?.namespace ?? DEFAULT_NAMESPACE
    this.useSql = options?.useSql ?? false
  }

  /**
   * Get the prefixed key for DO storage
   */
  private prefixKey(key: string): string {
    return `${this.namespace}:${key}`
  }

  /**
   * Remove prefix from key
   */
  private unprefixKey(prefixedKey: string): string {
    const prefix = `${this.namespace}:`
    return prefixedKey.startsWith(prefix) ? prefixedKey.slice(prefix.length) : prefixedKey
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.storage.get<T>(this.prefixKey(key))
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.storage.put(this.prefixKey(key), value)
  }

  async delete(key: string): Promise<boolean> {
    return this.storage.delete(this.prefixKey(key))
  }

  async list<T>(prefix?: string): Promise<Map<string, T>> {
    const fullPrefix = prefix ? this.prefixKey(prefix) : `${this.namespace}:`
    const entries = await this.storage.list<T>({ prefix: fullPrefix })

    // Convert to Map with unprefixed keys
    const result = new Map<string, T>()
    for (const [key, value] of entries) {
      result.set(this.unprefixKey(key), value)
    }
    return result
  }

  async putMany<T>(entries: Array<{ key: string; value: T }>): Promise<void> {
    if (entries.length === 0) return

    // Convert to object for batch put
    const batch: Record<string, T> = {}
    for (const { key, value } of entries) {
      batch[this.prefixKey(key)] = value
    }

    await this.storage.put(batch)
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    await this.storage.delete(keys.map((k) => this.prefixKey(k)))
  }
}

/**
 * Create a storage adapter for DO primitives
 *
 * @param storage - Durable Object storage instance
 * @param options - Adapter configuration options
 * @returns Storage adapter compatible with primitives
 */
export function createDOStorageAdapter(
  storage: DurableObjectStorage,
  options?: DOStorageAdapterOptions
): PrimitiveStorage {
  return new DOStorageAdapterImpl(storage, options)
}

/**
 * Specialized storage adapter for TemporalStore that persists versions
 */
export interface TemporalStorageAdapter<T> {
  /** Load all versions for a key */
  loadVersions(key: string): Promise<Array<{ value: T; timestamp: number; version: number }>>
  /** Save a new version */
  saveVersion(key: string, value: T, timestamp: number, version: number, expiresAt?: number): Promise<void>
  /** Delete versions older than timestamp */
  pruneVersions(key: string, olderThan: number): Promise<number>
  /** Load all snapshots */
  loadSnapshots(): Promise<Map<string, unknown>>
  /** Save a snapshot */
  saveSnapshot(id: string, snapshot: unknown): Promise<void>
  /** Delete a snapshot */
  deleteSnapshot(id: string): Promise<void>
}

/**
 * Create a temporal storage adapter
 */
export function createTemporalStorageAdapter<T>(
  storage: DurableObjectStorage,
  storeName: string
): TemporalStorageAdapter<T> {
  const prefix = `primitives:temporal:${storeName}:`

  return {
    async loadVersions(key: string) {
      const entries = await storage.list<{
        value: T
        timestamp: number
        version: number
        expiresAt?: number
      }>({ prefix: `${prefix}versions:${key}:` })

      const versions: Array<{ value: T; timestamp: number; version: number }> = []
      for (const [, entry] of entries) {
        versions.push({
          value: entry.value,
          timestamp: entry.timestamp,
          version: entry.version,
        })
      }

      // Sort by timestamp
      versions.sort((a, b) => a.timestamp - b.timestamp)
      return versions
    },

    async saveVersion(key: string, value: T, timestamp: number, version: number, expiresAt?: number) {
      await storage.put(`${prefix}versions:${key}:${version}`, {
        value,
        timestamp,
        version,
        expiresAt,
      })
    },

    async pruneVersions(key: string, olderThan: number) {
      const entries = await storage.list<{ timestamp: number }>({ prefix: `${prefix}versions:${key}:` })
      const keysToDelete: string[] = []

      for (const [storageKey, entry] of entries) {
        if (entry.timestamp < olderThan) {
          keysToDelete.push(storageKey)
        }
      }

      if (keysToDelete.length > 0) {
        await storage.delete(keysToDelete)
      }

      return keysToDelete.length
    },

    async loadSnapshots() {
      return storage.list({ prefix: `${prefix}snapshots:` })
    },

    async saveSnapshot(id: string, snapshot: unknown) {
      await storage.put(`${prefix}snapshots:${id}`, snapshot)
    },

    async deleteSnapshot(id: string) {
      await storage.delete(`${prefix}snapshots:${id}`)
    },
  }
}

/**
 * Specialized storage adapter for ExactlyOnceContext
 */
export interface ExactlyOnceStorageAdapter {
  /** Load processed event IDs */
  loadProcessedIds(): Promise<Map<string, { timestamp: number; result: unknown }>>
  /** Mark an event as processed */
  markProcessed(eventId: string, timestamp: number, result: unknown): Promise<void>
  /** Remove expired processed IDs */
  pruneExpired(olderThan: number): Promise<number>
  /** Load state */
  loadState(): Promise<Map<string, unknown>>
  /** Save state */
  saveState(state: Map<string, unknown>): Promise<void>
}

/**
 * Create an exactly-once storage adapter
 */
export function createExactlyOnceStorageAdapter(
  storage: DurableObjectStorage,
  contextName: string
): ExactlyOnceStorageAdapter {
  const prefix = `primitives:exactlyonce:${contextName}:`

  return {
    async loadProcessedIds() {
      const entries = await storage.list<{ timestamp: number; result: unknown }>({
        prefix: `${prefix}processed:`,
      })

      const result = new Map<string, { timestamp: number; result: unknown }>()
      for (const [key, value] of entries) {
        const eventId = key.slice(`${prefix}processed:`.length)
        result.set(eventId, value)
      }
      return result
    },

    async markProcessed(eventId: string, timestamp: number, result: unknown) {
      await storage.put(`${prefix}processed:${eventId}`, { timestamp, result })
    },

    async pruneExpired(olderThan: number) {
      const entries = await storage.list<{ timestamp: number }>({ prefix: `${prefix}processed:` })
      const keysToDelete: string[] = []

      for (const [key, value] of entries) {
        if (value.timestamp < olderThan) {
          keysToDelete.push(key)
        }
      }

      if (keysToDelete.length > 0) {
        await storage.delete(keysToDelete)
      }

      return keysToDelete.length
    },

    async loadState() {
      const state = await storage.get<Record<string, unknown>>(`${prefix}state`)
      return new Map(Object.entries(state ?? {}))
    },

    async saveState(state: Map<string, unknown>) {
      await storage.put(`${prefix}state`, Object.fromEntries(state))
    },
  }
}
