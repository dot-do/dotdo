/**
 * Redis Key Commands
 * DEL, EXISTS, EXPIRE, TTL, KEYS, TYPE, RENAME, PERSIST, PEXPIRE, PTTL, FLUSHDB
 */

import type { RedisBackend, ExpireOptions } from '../types'

export class KeyCommands {
  constructor(private backend: RedisBackend) {}

  /**
   * DEL key [key ...]
   * Delete one or more keys
   */
  async del(keys: string[]): Promise<number> {
    let deleted = 0
    for (const key of keys) {
      const existed = await this.backend.delete(key)
      if (existed) deleted++
    }
    return deleted
  }

  /**
   * UNLINK key [key ...]
   * Delete keys asynchronously (same as DEL in this implementation)
   */
  async unlink(keys: string[]): Promise<number> {
    return this.del(keys)
  }

  /**
   * EXISTS key [key ...]
   * Determine if one or more keys exist
   * Returns the count of keys that exist
   */
  async exists(keys: string[]): Promise<number> {
    let count = 0
    for (const key of keys) {
      const entry = await this.backend.get(key)
      if (entry) count++
    }
    return count
  }

  /**
   * EXPIRE key seconds [NX|XX|GT|LT]
   * Set a key's time to live in seconds
   */
  async expire(key: string, seconds: number, options?: ExpireOptions): Promise<number> {
    return this.pexpire(key, seconds * 1000, options)
  }

  /**
   * EXPIREAT key timestamp [NX|XX|GT|LT]
   * Set the expiration for a key as a UNIX timestamp
   */
  async expireat(key: string, timestamp: number, options?: ExpireOptions): Promise<number> {
    return this.pexpireat(key, timestamp * 1000, options)
  }

  /**
   * PEXPIRE key milliseconds [NX|XX|GT|LT]
   * Set a key's time to live in milliseconds
   */
  async pexpire(key: string, milliseconds: number, options?: ExpireOptions): Promise<number> {
    const newExpiry = Date.now() + milliseconds
    return this.pexpireat(key, newExpiry, options)
  }

  /**
   * PEXPIREAT key milliseconds-timestamp [NX|XX|GT|LT]
   * Set the expiration for a key as a UNIX timestamp in milliseconds
   */
  async pexpireat(key: string, timestamp: number, options?: ExpireOptions): Promise<number> {
    const entry = await this.backend.get(key)
    if (!entry) return 0

    const currentExpiry = entry.expires_at

    // NX: Set expiry only when the key has no expiry
    if (options?.nx && currentExpiry !== null && currentExpiry !== undefined) {
      return 0
    }

    // XX: Set expiry only when the key has an existing expiry
    if (options?.xx && (currentExpiry === null || currentExpiry === undefined)) {
      return 0
    }

    // GT: Set expiry only when new expiry > current expiry
    if (options?.gt && currentExpiry !== null && currentExpiry !== undefined && timestamp <= currentExpiry) {
      return 0
    }

    // LT: Set expiry only when new expiry < current expiry (or no expiry)
    if (options?.lt && currentExpiry !== null && currentExpiry !== undefined && timestamp >= currentExpiry) {
      return 0
    }

    await this.backend.setExpiry(key, timestamp)
    return 1
  }

  /**
   * EXPIRETIME key
   * Get the absolute Unix timestamp at which the given key will expire
   */
  async expiretime(key: string): Promise<number> {
    const entry = await this.backend.get(key)
    if (!entry) return -2
    if (entry.expires_at === null || entry.expires_at === undefined) return -1
    return Math.floor(entry.expires_at / 1000)
  }

  /**
   * PEXPIRETIME key
   * Get the absolute Unix timestamp at which the given key will expire (milliseconds)
   */
  async pexpiretime(key: string): Promise<number> {
    const entry = await this.backend.get(key)
    if (!entry) return -2
    if (entry.expires_at === null || entry.expires_at === undefined) return -1
    return entry.expires_at
  }

  /**
   * TTL key
   * Get the time to live for a key in seconds
   */
  async ttl(key: string): Promise<number> {
    const pttl = await this.pttl(key)
    if (pttl < 0) return pttl
    return Math.ceil(pttl / 1000)
  }

  /**
   * PTTL key
   * Get the time to live for a key in milliseconds
   */
  async pttl(key: string): Promise<number> {
    const entry = await this.backend.get(key)
    if (!entry) return -2
    if (entry.expires_at === null || entry.expires_at === undefined) return -1
    const ttl = entry.expires_at - Date.now()
    return ttl > 0 ? ttl : -2
  }

  /**
   * PERSIST key
   * Remove the expiration from a key
   */
  async persist(key: string): Promise<number> {
    const entry = await this.backend.get(key)
    if (!entry) return 0
    if (entry.expires_at === null || entry.expires_at === undefined) return 0

    await this.backend.setExpiry(key, undefined)
    return 1
  }

  /**
   * KEYS pattern
   * Find all keys matching the given pattern
   */
  async keys(pattern: string): Promise<string[]> {
    const allKeys = await this.backend.keys()

    if (pattern === '*') {
      return allKeys
    }

    // Convert Redis glob pattern to regex
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$'
    )

    return allKeys.filter((key) => regex.test(key))
  }

  /**
   * SCAN cursor [MATCH pattern] [COUNT count] [TYPE type]
   * Incrementally iterate the keys space
   */
  async scan(
    cursor: number,
    options?: { match?: string; count?: number; type?: string }
  ): Promise<[number, string[]]> {
    let allKeys = await this.backend.keys()
    const count = options?.count ?? 10

    // Filter by type if specified
    if (options?.type) {
      const filteredKeys: string[] = []
      for (const key of allKeys) {
        const entry = await this.backend.get(key)
        if (entry?.type === options.type) {
          filteredKeys.push(key)
        }
      }
      allKeys = filteredKeys
    }

    // Filter by pattern
    if (options?.match && options.match !== '*') {
      const regex = new RegExp(
        '^' +
          options.match
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.') +
          '$'
      )
      allKeys = allKeys.filter((key) => regex.test(key))
    }

    // Simple cursor-based pagination
    const start = cursor
    const end = Math.min(start + count, allKeys.length)
    const nextCursor = end >= allKeys.length ? 0 : end

    return [nextCursor, allKeys.slice(start, end)]
  }

  /**
   * TYPE key
   * Determine the type stored at key
   */
  async type(key: string): Promise<string> {
    const entry = await this.backend.get(key)
    if (!entry) return 'none'
    return entry.type
  }

  /**
   * RENAME key newkey
   * Rename a key
   */
  async rename(key: string, newKey: string): Promise<string> {
    const entry = await this.backend.get(key)
    if (!entry) {
      throw new Error('ERR no such key')
    }

    // Delete the new key if it exists
    await this.backend.delete(newKey)

    // Copy to new key
    await this.backend.set(newKey, entry.type, entry.value, entry.expires_at ?? undefined)

    // Delete old key
    await this.backend.delete(key)

    return 'OK'
  }

  /**
   * RENAMENX key newkey
   * Rename a key, only if the new key does not exist
   */
  async renamenx(key: string, newKey: string): Promise<number> {
    const entry = await this.backend.get(key)
    if (!entry) {
      throw new Error('ERR no such key')
    }

    const newExists = await this.backend.get(newKey)
    if (newExists) return 0

    await this.backend.set(newKey, entry.type, entry.value, entry.expires_at ?? undefined)
    await this.backend.delete(key)

    return 1
  }

  /**
   * COPY source destination [REPLACE]
   * Copy a key
   */
  async copy(source: string, destination: string, replace?: boolean): Promise<number> {
    const entry = await this.backend.get(source)
    if (!entry) return 0

    const destExists = await this.backend.get(destination)
    if (destExists && !replace) return 0

    await this.backend.set(destination, entry.type, entry.value, entry.expires_at ?? undefined)
    return 1
  }

  /**
   * RANDOMKEY
   * Return a random key from the keyspace
   */
  async randomkey(): Promise<string | null> {
    const allKeys = await this.backend.keys()
    if (allKeys.length === 0) return null
    const idx = Math.floor(Math.random() * allKeys.length)
    return allKeys[idx]
  }

  /**
   * DBSIZE
   * Return the number of keys in the database
   */
  async dbsize(): Promise<number> {
    const allKeys = await this.backend.keys()
    return allKeys.length
  }

  /**
   * FLUSHDB [ASYNC|SYNC]
   * Remove all keys from the current database
   */
  async flushdb(): Promise<string> {
    await this.backend.clear()
    return 'OK'
  }

  /**
   * FLUSHALL [ASYNC|SYNC]
   * Remove all keys from all databases (same as FLUSHDB in this implementation)
   */
  async flushall(): Promise<string> {
    return this.flushdb()
  }
}
