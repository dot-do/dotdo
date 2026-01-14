/**
 * @dotdo/auth - In-Memory Storage Backend
 *
 * Default storage backend using a Map for testing and development.
 *
 * @module
 */

import type { StorageBackend, StoragePutOptions } from './types'

/**
 * In-memory storage item with optional TTL
 */
interface StorageItem<T> {
  value: T
  expiresAt?: number
}

/**
 * Create an in-memory storage backend
 */
export function createInMemoryStorage(): StorageBackend {
  const store = new Map<string, StorageItem<unknown>>()

  /**
   * Clean up expired items
   */
  function cleanup() {
    const now = Date.now()
    for (const [key, item] of store.entries()) {
      if (item.expiresAt && item.expiresAt < now) {
        store.delete(key)
      }
    }
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      cleanup()
      const item = store.get(key) as StorageItem<T> | undefined
      if (!item) return null

      // Check TTL
      if (item.expiresAt && item.expiresAt < Date.now()) {
        store.delete(key)
        return null
      }

      return item.value
    },

    async put<T>(key: string, value: T, options?: StoragePutOptions): Promise<void> {
      const item: StorageItem<T> = { value }

      if (options?.ttl) {
        item.expiresAt = Date.now() + options.ttl
      }

      store.set(key, item)
    },

    async delete(key: string): Promise<void> {
      store.delete(key)
    },

    async list(prefix: string): Promise<string[]> {
      cleanup()
      const keys: string[] = []
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          keys.push(key)
        }
      }
      return keys
    },
  }
}

/**
 * Wrapper to add index support to storage
 */
export class IndexedStorage {
  private storage: StorageBackend

  constructor(storage: StorageBackend) {
    this.storage = storage
  }

  async get<T>(key: string): Promise<T | null> {
    return this.storage.get<T>(key)
  }

  async put<T>(key: string, value: T, options?: StoragePutOptions): Promise<void> {
    return this.storage.put(key, value, options)
  }

  async delete(key: string): Promise<void> {
    return this.storage.delete(key)
  }

  async list(prefix: string): Promise<string[]> {
    if (this.storage.list) {
      return this.storage.list(prefix)
    }
    return []
  }

  /**
   * Set an index value
   */
  async setIndex(indexName: string, indexValue: string, targetKey: string): Promise<void> {
    await this.storage.put(`index:${indexName}:${indexValue.toLowerCase()}`, targetKey)
  }

  /**
   * Get a value by index
   */
  async getByIndex<T>(indexName: string, indexValue: string): Promise<T | null> {
    const targetKey = await this.storage.get<string>(`index:${indexName}:${indexValue.toLowerCase()}`)
    if (!targetKey) return null
    return this.storage.get<T>(targetKey)
  }

  /**
   * Delete an index
   */
  async deleteIndex(indexName: string, indexValue: string): Promise<void> {
    await this.storage.delete(`index:${indexName}:${indexValue.toLowerCase()}`)
  }
}
