/**
 * In-Memory Backend for @dotdo/redis
 * Uses native Maps for O(1) operations
 */

import type { RedisBackend, RedisType, RedisValueType, StorageEntry } from '../types'

export class MemoryBackend implements RedisBackend {
  private store: Map<string, StorageEntry> = new Map()

  /**
   * Get a key's entry, checking expiration
   */
  async get(key: string): Promise<StorageEntry | null> {
    const entry = this.store.get(key)
    if (!entry) return null

    // Check expiration
    if (entry.expires_at !== null && entry.expires_at <= Date.now()) {
      this.store.delete(key)
      return null
    }

    return entry
  }

  /**
   * Set a key's value
   */
  async set(
    key: string,
    type: RedisType,
    value: RedisValueType,
    expiresAt?: number
  ): Promise<void> {
    const now = Date.now()
    const existing = this.store.get(key)

    this.store.set(key, {
      key,
      type,
      value: this.cloneValue(type, value),
      expires_at: expiresAt ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    })
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<boolean> {
    return this.store.delete(key)
  }

  /**
   * Set expiration on a key
   */
  async setExpiry(key: string, expiresAt: number | undefined): Promise<boolean> {
    const entry = this.store.get(key)
    if (!entry) return false

    entry.expires_at = expiresAt ?? null
    entry.updated_at = Date.now()
    return true
  }

  /**
   * Get all keys (cleaning expired ones first)
   */
  async keys(): Promise<string[]> {
    const now = Date.now()
    const result: string[] = []

    for (const [key, entry] of this.store) {
      if (entry.expires_at !== null && entry.expires_at <= now) {
        this.store.delete(key)
      } else {
        result.push(key)
      }
    }

    return result
  }

  /**
   * Clear all keys
   */
  async clear(): Promise<void> {
    this.store.clear()
  }

  /**
   * Deep clone value to prevent reference issues
   */
  private cloneValue(type: RedisType, value: RedisValueType): RedisValueType {
    switch (type) {
      case 'string':
        return value
      case 'list':
      case 'set':
        return [...(value as string[])]
      case 'hash':
        return { ...(value as Record<string, string>) }
      case 'zset':
        return (value as Array<{ member: string; score: number }>).map(v => ({ ...v }))
      default:
        return value
    }
  }
}
