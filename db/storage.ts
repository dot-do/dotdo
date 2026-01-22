// Storage Adapter Interface for @dotdo/db
// Provides an abstraction layer for different storage backends

import type { JsonValue, StorableData } from './types'

/**
 * Options for listing keys from storage
 */
export interface ListOptions {
  /** Prefix to filter keys by */
  prefix?: string
  /** Maximum number of results to return */
  limit?: number
  /** Cursor for pagination (opaque string from previous list call) */
  cursor?: string
  /** Whether to return values along with keys */
  includeValues?: boolean
}

/**
 * Result of a list operation
 */
export interface ListResult<T = unknown> {
  /** Map of key to value (values present only if includeValues was true) */
  entries: Map<string, T>
  /** Cursor for fetching next page, undefined if no more results */
  cursor?: string
  /** Whether there are more results available */
  hasMore: boolean
}

/**
 * Storage Adapter Interface
 *
 * Provides a key-value storage abstraction that can be backed by different
 * storage engines (SQLite, in-memory, etc.). All operations are async to
 * support both sync and async backends uniformly.
 *
 * This interface is designed to match the patterns used by Cloudflare Workers
 * KV and Durable Objects storage while remaining generic enough for other backends.
 */
export interface StorageAdapter {
  /**
   * Get a value by key
   * @param key The key to retrieve
   * @returns The value or undefined if not found
   */
  get<T = unknown>(key: string): Promise<T | undefined>

  /**
   * Get multiple values by keys
   * @param keys Array of keys to retrieve
   * @returns Map of key to value (missing keys not included)
   */
  getMany<T = unknown>(keys: string[]): Promise<Map<string, T>>

  /**
   * Store a value at a key
   * @param key The key to store at
   * @param value The value to store
   */
  put<T = unknown>(key: string, value: T): Promise<void>

  /**
   * Store multiple key-value pairs
   * @param entries Map of key to value
   */
  putMany<T = unknown>(entries: Map<string, T>): Promise<void>

  /**
   * Delete a key
   * @param key The key to delete
   */
  delete(key: string): Promise<void>

  /**
   * Delete multiple keys
   * @param keys Array of keys to delete
   */
  deleteMany(keys: string[]): Promise<void>

  /**
   * List keys with optional filtering and pagination
   * @param options List options
   * @returns List result with entries and pagination info
   */
  list<T = unknown>(options?: ListOptions): Promise<ListResult<T>>

  /**
   * Execute a function within a transaction
   * All operations within the function are atomic - they either all succeed
   * or all fail. Not all backends may support true transactions; they should
   * document their behavior.
   *
   * @param fn The function to execute within the transaction
   * @returns The result of the function
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>

  /**
   * Check if a key exists without fetching its value
   * @param key The key to check
   * @returns true if the key exists
   */
  has(key: string): Promise<boolean>

  /**
   * Clear all data from storage
   * Use with caution - this removes all stored data
   */
  clear(): Promise<void>

  /**
   * Get the number of keys in storage
   * @param prefix Optional prefix to count keys matching
   */
  count(prefix?: string): Promise<number>
}

/**
 * Options for creating a storage adapter
 */
export interface StorageAdapterOptions {
  /** Optional namespace/prefix for all keys */
  namespace?: string
}

/**
 * Extended options for SQL-based storage adapters
 */
export interface SqlStorageAdapterOptions extends StorageAdapterOptions {
  /** Table name to use for key-value storage */
  tableName?: string
}

/**
 * Factory function type for creating storage adapters
 */
export type StorageAdapterFactory<T extends StorageAdapterOptions = StorageAdapterOptions> =
  (options?: T) => StorageAdapter

/**
 * Typed storage adapter that preserves value types
 * Useful for domain-specific storage (e.g., Things, Events, Relationships)
 */
export interface TypedStorageAdapter<T extends StorableData> {
  get(key: string): Promise<T | undefined>
  getMany(keys: string[]): Promise<Map<string, T>>
  put(key: string, value: T): Promise<void>
  putMany(entries: Map<string, T>): Promise<void>
  delete(key: string): Promise<void>
  deleteMany(keys: string[]): Promise<void>
  list(options?: ListOptions): Promise<ListResult<T>>
  transaction<R>(fn: () => Promise<R>): Promise<R>
  has(key: string): Promise<boolean>
  clear(): Promise<void>
  count(prefix?: string): Promise<number>
}

/**
 * Create a typed wrapper around a generic storage adapter
 */
export function createTypedStorage<T extends StorableData>(
  adapter: StorageAdapter
): TypedStorageAdapter<T> {
  return {
    get: (key) => adapter.get<T>(key),
    getMany: (keys) => adapter.getMany<T>(keys),
    put: (key, value) => adapter.put<T>(key, value),
    putMany: (entries) => adapter.putMany<T>(entries),
    delete: (key) => adapter.delete(key),
    deleteMany: (keys) => adapter.deleteMany(keys),
    list: (options) => adapter.list<T>(options),
    transaction: (fn) => adapter.transaction(fn),
    has: (key) => adapter.has(key),
    clear: () => adapter.clear(),
    count: (prefix) => adapter.count(prefix)
  }
}
