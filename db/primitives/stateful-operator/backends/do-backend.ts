/**
 * DOStateBackend - Durable Object state implementation
 *
 * Implements StateBackend using Durable Object storage. This is the primary
 * state backend for edge-native stream processing.
 *
 * Features:
 * - Transactional state updates via DO storage API
 * - Efficient prefix scanning with list()
 * - Atomic snapshots using DO transactions
 * - TTL enforcement via lazy expiration
 *
 * @module db/primitives/stateful-operator/backends/do-backend
 */

import type { StateBackend, StateSnapshot, StateEntry } from '../index'
import { murmurHash3_32 } from '../../utils/murmur3'

/**
 * Options for DOStateBackend configuration
 */
export interface DOStateBackendOptions {
  /**
   * Maximum number of entries to retrieve in a single list() call
   * Helps manage memory for large state
   */
  listBatchSize?: number

  /**
   * Enable transactional mode for put/delete operations
   * When true, uses DO storage transactions for atomicity
   */
  transactional?: boolean
}

/**
 * Durable Object storage interface
 * Matches the Cloudflare Workers DurableObjectStorage type
 */
export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>
  put<T = unknown>(key: string, value: T): Promise<void>
  put<T = unknown>(entries: Record<string, T>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: {
    prefix?: string
    start?: string
    end?: string
    limit?: number
    reverse?: boolean
  }): Promise<Map<string, T>>
  transaction<T>(closure: (txn: DurableObjectStorage) => Promise<T>): Promise<T>
}

/**
 * DOStateBackend implements StateBackend using Durable Object storage.
 *
 * State entries are stored with a name prefix to allow multiple state backends
 * to coexist within the same Durable Object storage.
 *
 * Entry format in storage:
 * - Key: `${name}:${key}`
 * - Value: `StateEntry<T>` with value, createdAt, and optional expiresAt
 *
 * @example
 * ```typescript
 * const backend = new DOStateBackend<number>(storage, 'counters')
 *
 * await backend.put('user:1', 42, 60000) // 60s TTL
 * const value = await backend.get('user:1') // 42
 *
 * // Snapshot and restore
 * const snapshot = await backend.snapshot()
 * await backend.clear()
 * await backend.restore(snapshot)
 * ```
 */
export class DOStateBackend<T> implements StateBackend<T> {
  private snapshotCounter = 0
  private readonly listBatchSize: number
  private readonly transactional: boolean

  constructor(
    private storage: DurableObjectStorage,
    readonly name: string,
    options?: DOStateBackendOptions
  ) {
    this.listBatchSize = options?.listBatchSize ?? 1000
    this.transactional = options?.transactional ?? false
  }

  /**
   * Get the full storage key with namespace prefix
   */
  private prefixKey(key: string): string {
    return `${this.name}:${key}`
  }

  /**
   * Remove the namespace prefix from a storage key
   */
  private unprefixKey(prefixedKey: string): string {
    const prefix = `${this.name}:`
    if (prefixedKey.startsWith(prefix)) {
      return prefixedKey.slice(prefix.length)
    }
    return prefixedKey
  }

  /**
   * Check if an entry has expired
   */
  private isExpired(entry: StateEntry<T>): boolean {
    return entry.expiresAt !== undefined && Date.now() >= entry.expiresAt
  }

  /**
   * Get a value by key
   *
   * Returns undefined if:
   * - Key doesn't exist
   * - Entry has expired (lazy TTL enforcement)
   */
  async get(key: string): Promise<T | undefined> {
    const entry = await this.storage.get<StateEntry<T>>(this.prefixKey(key))

    if (!entry) {
      return undefined
    }

    // Lazy TTL enforcement
    if (this.isExpired(entry)) {
      await this.delete(key)
      return undefined
    }

    return entry.value
  }

  /**
   * Store a value with optional TTL
   *
   * @param key - Storage key
   * @param value - Value to store
   * @param ttl - Optional time-to-live in milliseconds
   */
  async put(key: string, value: T, ttl?: number): Promise<void> {
    const entry: StateEntry<T> = {
      value,
      createdAt: Date.now(),
      expiresAt: ttl !== undefined ? Date.now() + ttl : undefined,
    }

    if (this.transactional) {
      await this.storage.transaction(async (txn) => {
        await txn.put(this.prefixKey(key), entry)
      })
    } else {
      await this.storage.put(this.prefixKey(key), entry)
    }
  }

  /**
   * Delete a key from storage
   *
   * Does nothing if key doesn't exist.
   */
  async delete(key: string): Promise<void> {
    if (this.transactional) {
      await this.storage.transaction(async (txn) => {
        await txn.delete(this.prefixKey(key))
      })
    } else {
      await this.storage.delete(this.prefixKey(key))
    }
  }

  /**
   * Iterate over entries with optional prefix filter
   *
   * Uses efficient prefix scanning via DO storage list().
   * Expired entries are filtered out during iteration.
   *
   * @param prefix - Optional prefix to filter keys
   */
  async *list(prefix?: string): AsyncIterable<[string, T]> {
    const fullPrefix = this.prefixKey(prefix ?? '')
    let cursor: string | undefined = undefined
    const now = Date.now()

    // Iterate through storage in batches
    do {
      const options: {
        prefix: string
        limit: number
        start?: string
      } = {
        prefix: fullPrefix,
        limit: this.listBatchSize,
      }

      if (cursor) {
        options.start = cursor
      }

      const entries = await this.storage.list<StateEntry<T>>(options)

      if (entries.size === 0) {
        break
      }

      let lastKey: string | undefined

      for (const [key, entry] of entries) {
        lastKey = key

        // Skip expired entries (lazy cleanup)
        if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
          continue
        }

        yield [this.unprefixKey(key), entry.value]
      }

      // If we got fewer entries than the batch size, we're done
      if (entries.size < this.listBatchSize) {
        break
      }

      // Set cursor to the next key after the last one
      // We need to increment the last character to get a start key that won't
      // include the last key again
      if (lastKey) {
        cursor = lastKey + '\x00'
      }
    } while (cursor)
  }

  /**
   * Get the number of non-expired entries
   */
  async size(): Promise<number> {
    let count = 0
    const now = Date.now()
    const prefix = `${this.name}:`

    const entries = await this.storage.list<StateEntry<T>>({ prefix })

    for (const entry of entries.values()) {
      // Skip expired entries
      if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
        continue
      }
      count++
    }

    return count
  }

  /**
   * Create a snapshot of all state
   *
   * Uses DO transaction for consistent snapshot.
   * Excludes expired entries from snapshot.
   */
  async snapshot(): Promise<StateSnapshot> {
    const id = `${this.name}-snap-${++this.snapshotCounter}-${Date.now()}`
    const timestamp = Date.now()

    // Use transaction for consistent snapshot
    const serializedEntries = await this.storage.transaction(async () => {
      const prefix = `${this.name}:`
      const entries = await this.storage.list<StateEntry<T>>({ prefix })

      const validEntries: Array<[string, StateEntry<T>]> = []

      for (const [key, entry] of entries) {
        // Skip expired entries
        if (entry.expiresAt !== undefined && timestamp >= entry.expiresAt) {
          continue
        }
        validEntries.push([this.unprefixKey(key), entry])
      }

      return validEntries
    })

    const jsonData = JSON.stringify(serializedEntries)
    const data = new TextEncoder().encode(jsonData)
    const checksum = this.computeChecksum(data)

    return {
      id,
      timestamp,
      data,
      metadata: {
        stateCount: serializedEntries.length,
        totalBytes: data.length,
        checksum,
      },
    }
  }

  /**
   * Restore state from a snapshot
   *
   * Uses DO transaction for atomic restore.
   * Validates checksum before applying.
   */
  async restore(snapshot: StateSnapshot): Promise<void> {
    // Validate checksum
    const actualChecksum = this.computeChecksum(snapshot.data)
    if (actualChecksum !== snapshot.metadata.checksum) {
      throw new Error(
        `Checksum mismatch: expected ${snapshot.metadata.checksum}, got ${actualChecksum}`
      )
    }

    // Deserialize entries
    const jsonData = new TextDecoder().decode(snapshot.data)
    const entries: Array<[string, StateEntry<T>]> = JSON.parse(jsonData)

    // Use transaction for atomic restore
    await this.storage.transaction(async (txn) => {
      // First, delete all existing entries with our prefix
      const prefix = `${this.name}:`
      const existingKeys = await txn.list<StateEntry<T>>({ prefix })

      if (existingKeys.size > 0) {
        await txn.delete([...existingKeys.keys()])
      }

      // Then, restore all entries from snapshot
      if (entries.length > 0) {
        const toStore: Record<string, StateEntry<T>> = {}
        for (const [key, entry] of entries) {
          toStore[this.prefixKey(key)] = entry
        }
        await txn.put(toStore)
      }
    })
  }

  /**
   * Clear all entries with this backend's prefix
   */
  async clear(): Promise<void> {
    const prefix = `${this.name}:`

    await this.storage.transaction(async (txn) => {
      const entries = await txn.list<StateEntry<T>>({ prefix })

      if (entries.size > 0) {
        await txn.delete([...entries.keys()])
      }
    })
  }

  /**
   * Compute a checksum for snapshot validation
   */
  private computeChecksum(data: Uint8Array): string {
    const hash = murmurHash3_32(data, 0)
    return hash.toString(16)
  }

  /**
   * Batch put multiple entries atomically
   *
   * @param entries - Map of key-value pairs to store
   * @param ttl - Optional TTL to apply to all entries
   */
  async putBatch(entries: Map<string, T>, ttl?: number): Promise<void> {
    const now = Date.now()
    const toStore: Record<string, StateEntry<T>> = {}

    for (const [key, value] of entries) {
      toStore[this.prefixKey(key)] = {
        value,
        createdAt: now,
        expiresAt: ttl !== undefined ? now + ttl : undefined,
      }
    }

    await this.storage.transaction(async (txn) => {
      await txn.put(toStore)
    })
  }

  /**
   * Batch delete multiple keys atomically
   *
   * @param keys - Array of keys to delete
   */
  async deleteBatch(keys: string[]): Promise<void> {
    const prefixedKeys = keys.map((k) => this.prefixKey(k))

    await this.storage.transaction(async (txn) => {
      await txn.delete(prefixedKeys)
    })
  }

  /**
   * Get multiple values by keys
   *
   * @param keys - Array of keys to retrieve
   * @returns Map of key to value (expired entries excluded)
   */
  async getBatch(keys: string[]): Promise<Map<string, T>> {
    const prefixedKeys = keys.map((k) => this.prefixKey(k))
    const entries = await this.storage.get<StateEntry<T>>(prefixedKeys)
    const now = Date.now()

    const result = new Map<string, T>()

    for (const [prefixedKey, entry] of entries) {
      // Skip expired entries
      if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
        continue
      }

      result.set(this.unprefixKey(prefixedKey), entry.value)
    }

    return result
  }

  /**
   * Run a cleanup to remove expired entries
   *
   * Returns the number of entries cleaned up.
   */
  async cleanup(): Promise<number> {
    const prefix = `${this.name}:`
    const now = Date.now()
    const expiredKeys: string[] = []

    const entries = await this.storage.list<StateEntry<T>>({ prefix })

    for (const [key, entry] of entries) {
      if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
        expiredKeys.push(key)
      }
    }

    if (expiredKeys.length > 0) {
      await this.storage.delete(expiredKeys)
    }

    return expiredKeys.length
  }
}

/**
 * Create a DOStateBackend with the given storage and name
 *
 * @param storage - Durable Object storage instance
 * @param name - State backend name (used as key prefix)
 * @param options - Configuration options
 */
export function createDOStateBackend<T>(
  storage: DurableObjectStorage,
  name: string,
  options?: DOStateBackendOptions
): DOStateBackend<T> {
  return new DOStateBackend<T>(storage, name, options)
}
