// In-Memory Storage Adapter for @dotdo/db
// Implements StorageAdapter using JavaScript Map

import type {
  StorageAdapter,
  StorageAdapterOptions,
  ListOptions,
  ListResult,
  TransactionOptions
} from '../storage'

/**
 * Stored entry with metadata
 */
interface StoredEntry<T = unknown> {
  value: T
  createdAt: number
  updatedAt: number
}

/**
 * In-memory storage adapter
 *
 * Uses a JavaScript Map for fast key-value storage. Ideal for testing
 * and development. Data is not persisted across process restarts.
 *
 * Thread-safe within a single JavaScript execution context.
 *
 * Transaction Semantics:
 * - Uses snapshot/restore for atomicity
 * - Supports nested transactions via nested snapshots
 * - Automatic rollback on error
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private store: Map<string, StoredEntry<unknown>>
  private namespace: string
  private transactionDepth = 0
  private snapshotStack: Map<string, StoredEntry<unknown>>[] = []

  constructor(options: StorageAdapterOptions = {}) {
    this.store = new Map()
    this.namespace = options.namespace || ''
  }

  /**
   * Apply namespace prefix to key
   */
  private prefixKey(key: string): string {
    return this.namespace ? `${this.namespace}:${key}` : key
  }

  /**
   * Remove namespace prefix from key
   */
  private unprefixKey(key: string): string {
    if (this.namespace && key.startsWith(`${this.namespace}:`)) {
      return key.slice(this.namespace.length + 1)
    }
    return key
  }

  /**
   * Check if a key matches the namespace
   */
  private matchesNamespace(key: string): boolean {
    if (!this.namespace) return true
    return key.startsWith(`${this.namespace}:`)
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const prefixedKey = this.prefixKey(key)
    const entry = this.store.get(prefixedKey)
    return entry?.value as T | undefined
  }

  async getMany<T = unknown>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>()

    for (const key of keys) {
      const prefixedKey = this.prefixKey(key)
      const entry = this.store.get(prefixedKey)
      if (entry !== undefined) {
        result.set(key, entry.value as T)
      }
    }

    return result
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    const prefixedKey = this.prefixKey(key)
    const now = Date.now()

    const existing = this.store.get(prefixedKey)
    this.store.set(prefixedKey, {
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    })
  }

  async putMany<T = unknown>(entries: Map<string, T>): Promise<void> {
    const now = Date.now()

    for (const [key, value] of entries) {
      const prefixedKey = this.prefixKey(key)
      const existing = this.store.get(prefixedKey)
      this.store.set(prefixedKey, {
        value,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      })
    }
  }

  async delete(key: string): Promise<void> {
    const prefixedKey = this.prefixKey(key)
    this.store.delete(prefixedKey)
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (const key of keys) {
      const prefixedKey = this.prefixKey(key)
      this.store.delete(prefixedKey)
    }
  }

  async list<T = unknown>(options: ListOptions = {}): Promise<ListResult<T>> {
    const { prefix, limit = 1000, cursor, includeValues = true } = options

    // Build effective prefix for filtering
    const effectivePrefix = this.namespace
      ? prefix
        ? `${this.namespace}:${prefix}`
        : `${this.namespace}:`
      : prefix || ''

    // Get all matching keys, sorted
    const allKeys = Array.from(this.store.keys())
      .filter((key) => {
        // Must match namespace
        if (!this.matchesNamespace(key)) return false
        // Must match prefix if specified
        if (effectivePrefix && !key.startsWith(effectivePrefix)) return false
        // Must be after cursor if specified
        if (cursor && key <= cursor) return false
        return true
      })
      .sort()

    // Apply pagination
    const hasMore = allKeys.length > limit
    const pageKeys = allKeys.slice(0, limit)

    // Build result entries
    const entries = new Map<string, T>()
    for (const key of pageKeys) {
      const unprefixedKey = this.unprefixKey(key)
      if (includeValues) {
        const entry = this.store.get(key)
        entries.set(unprefixedKey, entry?.value as T)
      } else {
        entries.set(unprefixedKey, undefined as T)
      }
    }

    // Next cursor is the last key returned (prefixed)
    const lastKey = pageKeys[pageKeys.length - 1]
    const nextCursor = hasMore && lastKey ? lastKey : undefined

    const resultObj: ListResult<T> = {
      entries,
      hasMore
    }

    if (nextCursor !== undefined) {
      resultObj.cursor = nextCursor
    }

    return resultObj
  }

  async transaction<T>(fn: () => Promise<T>, _options?: TransactionOptions): Promise<T> {
    // For in-memory storage, we provide atomicity by:
    // 1. Creating a snapshot before the operation
    // 2. Restoring on failure
    // Nested transactions are supported by pushing multiple snapshots onto a stack

    // Create deep copy of current state
    const snapshot = new Map<string, StoredEntry<unknown>>()
    for (const [key, entry] of this.store) {
      snapshot.set(key, {
        value: JSON.parse(JSON.stringify(entry.value)),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
      })
    }

    this.snapshotStack.push(snapshot)
    this.transactionDepth++

    try {
      const result = await fn()
      // Success - pop snapshot without restoring
      this.snapshotStack.pop()
      this.transactionDepth--
      return result
    } catch (error) {
      // Failure - restore from snapshot
      const restorePoint = this.snapshotStack.pop()
      if (restorePoint) {
        this.store = restorePoint
      }
      this.transactionDepth--
      throw error
    }
  }

  /**
   * Check if currently inside a transaction
   */
  inTransaction(): boolean {
    return this.transactionDepth > 0
  }

  /**
   * Check if the adapter supports nested transactions
   * Memory adapter supports nested transactions via snapshot stack
   */
  supportsNestedTransactions(): boolean {
    return true
  }

  async has(key: string): Promise<boolean> {
    const prefixedKey = this.prefixKey(key)
    return this.store.has(prefixedKey)
  }

  async clear(): Promise<void> {
    if (this.namespace) {
      // Only clear keys with our namespace prefix
      for (const key of this.store.keys()) {
        if (this.matchesNamespace(key)) {
          this.store.delete(key)
        }
      }
    } else {
      this.store.clear()
    }
  }

  async count(prefix?: string): Promise<number> {
    const effectivePrefix = this.namespace
      ? prefix
        ? `${this.namespace}:${prefix}`
        : `${this.namespace}:`
      : prefix || ''

    let count = 0
    for (const key of this.store.keys()) {
      if (!this.matchesNamespace(key)) continue
      if (effectivePrefix && !key.startsWith(effectivePrefix)) continue
      count++
    }

    return count
  }

  /**
   * Get the underlying Map for testing/debugging
   * Note: Returns the actual Map reference, not a copy
   */
  getStore(): Map<string, StoredEntry<unknown>> {
    return this.store
  }

  /**
   * Get all entries as a plain object (useful for debugging)
   */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of this.store) {
      if (this.matchesNamespace(key)) {
        result[this.unprefixKey(key)] = entry.value
      }
    }
    return result
  }

  /**
   * Set the underlying store (used for shared storage)
   * @internal
   */
  setStore(store: Map<string, StoredEntry<unknown>>): void {
    this.store = store
  }
}

/**
 * Factory function to create an in-memory storage adapter
 */
export function createMemoryStorageAdapter(
  options?: StorageAdapterOptions
): MemoryStorageAdapter {
  return new MemoryStorageAdapter(options)
}

/**
 * Shared in-memory storage instances for testing
 * Allows multiple adapters to share the same underlying Map
 */
export class SharedMemoryStorage {
  private static instances = new Map<string, Map<string, StoredEntry<unknown>>>()

  /**
   * Get a shared storage instance by name
   */
  static get(name: string): Map<string, StoredEntry<unknown>> {
    let store = this.instances.get(name)
    if (!store) {
      store = new Map()
      this.instances.set(name, store)
    }
    return store
  }

  /**
   * Clear a shared storage instance
   */
  static clear(name: string): void {
    const store = this.instances.get(name)
    if (store) {
      store.clear()
    }
  }

  /**
   * Clear all shared storage instances
   */
  static clearAll(): void {
    for (const store of this.instances.values()) {
      store.clear()
    }
  }

  /**
   * Create an adapter backed by shared storage
   */
  static createAdapter(name: string, options?: StorageAdapterOptions): MemoryStorageAdapter {
    const adapter = new MemoryStorageAdapter(options)
    // Replace the internal store with shared storage
    adapter.setStore(this.get(name))
    return adapter
  }
}
