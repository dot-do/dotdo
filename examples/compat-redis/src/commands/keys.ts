/**
 * Redis Key Commands
 * DEL, EXISTS, EXPIRE, TTL, KEYS, SCAN, TYPE, RENAME, PERSIST, PEXPIRE, PTTL
 */

import type { RedisStorage } from '../storage'

export class KeyCommands {
  constructor(private storage: RedisStorage) {}

  /**
   * DEL key [key ...]
   * Delete one or more keys
   */
  async del(keys: string[]): Promise<number> {
    let deleted = 0
    for (const key of keys) {
      const existed = await this.storage.delete(key)
      if (existed) deleted++
    }
    return deleted
  }

  /**
   * UNLINK key [key ...]
   * Delete keys asynchronously (same as DEL in DO context)
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
      const entry = await this.storage.get(key)
      if (entry) count++
    }
    return count
  }

  /**
   * EXPIRE key seconds [NX|XX|GT|LT]
   * Set a key's time to live in seconds
   */
  async expire(
    key: string,
    seconds: number,
    options?: { nx?: boolean; xx?: boolean; gt?: boolean; lt?: boolean }
  ): Promise<number> {
    return this.pexpire(key, seconds * 1000, options)
  }

  /**
   * EXPIREAT key timestamp [NX|XX|GT|LT]
   * Set the expiration for a key as a UNIX timestamp
   */
  async expireat(
    key: string,
    timestamp: number,
    options?: { nx?: boolean; xx?: boolean; gt?: boolean; lt?: boolean }
  ): Promise<number> {
    return this.pexpireat(key, timestamp * 1000, options)
  }

  /**
   * PEXPIRE key milliseconds [NX|XX|GT|LT]
   * Set a key's time to live in milliseconds
   */
  async pexpire(
    key: string,
    milliseconds: number,
    options?: { nx?: boolean; xx?: boolean; gt?: boolean; lt?: boolean }
  ): Promise<number> {
    const newExpiry = Date.now() + milliseconds
    return this.pexpireat(key, newExpiry, options)
  }

  /**
   * PEXPIREAT key milliseconds-timestamp [NX|XX|GT|LT]
   * Set the expiration for a key as a UNIX timestamp in milliseconds
   */
  async pexpireat(
    key: string,
    timestamp: number,
    options?: { nx?: boolean; xx?: boolean; gt?: boolean; lt?: boolean }
  ): Promise<number> {
    const entry = await this.storage.get(key)
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

    await this.storage.setExpiry(key, timestamp)
    return 1
  }

  /**
   * EXPIRETIME key
   * Get the absolute Unix timestamp at which the given key will expire
   */
  async expiretime(key: string): Promise<number> {
    const entry = await this.storage.get(key)
    if (!entry) return -2
    if (entry.expires_at === null || entry.expires_at === undefined) return -1
    return Math.floor(entry.expires_at / 1000)
  }

  /**
   * PEXPIRETIME key
   * Get the absolute Unix timestamp at which the given key will expire (milliseconds)
   */
  async pexpiretime(key: string): Promise<number> {
    const entry = await this.storage.get(key)
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
    const entry = await this.storage.get(key)
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
    const entry = await this.storage.get(key)
    if (!entry) return 0
    if (entry.expires_at === null || entry.expires_at === undefined) return 0

    await this.storage.setExpiry(key, undefined)
    return 1
  }

  /**
   * KEYS pattern
   * Find all keys matching the given pattern
   */
  async keys(pattern: string): Promise<string[]> {
    const allKeys = await this.storage.keys()

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
    let allKeys = await this.storage.keys()
    const count = options?.count ?? 10

    // Filter by type if specified
    if (options?.type) {
      const filteredKeys: string[] = []
      for (const key of allKeys) {
        const entry = await this.storage.get(key)
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
    const entry = await this.storage.get(key)
    if (!entry) return 'none'
    return entry.type
  }

  /**
   * RENAME key newkey
   * Rename a key
   */
  async rename(key: string, newKey: string): Promise<string> {
    const entry = await this.storage.get(key)
    if (!entry) {
      throw new Error('ERR no such key')
    }

    // Delete the new key if it exists
    await this.storage.delete(newKey)

    // Copy to new key
    await this.storage.set(newKey, entry.type, entry.value, entry.expires_at ?? undefined)

    // Delete old key
    await this.storage.delete(key)

    return 'OK'
  }

  /**
   * RENAMENX key newkey
   * Rename a key, only if the new key does not exist
   */
  async renamenx(key: string, newKey: string): Promise<number> {
    const entry = await this.storage.get(key)
    if (!entry) {
      throw new Error('ERR no such key')
    }

    const newExists = await this.storage.get(newKey)
    if (newExists) return 0

    await this.storage.set(newKey, entry.type, entry.value, entry.expires_at ?? undefined)
    await this.storage.delete(key)

    return 1
  }

  /**
   * COPY source destination [DB destination-db] [REPLACE]
   * Copy a key
   */
  async copy(source: string, destination: string, replace?: boolean): Promise<number> {
    const entry = await this.storage.get(source)
    if (!entry) return 0

    const destExists = await this.storage.get(destination)
    if (destExists && !replace) return 0

    await this.storage.set(destination, entry.type, entry.value, entry.expires_at ?? undefined)
    return 1
  }

  /**
   * DUMP key
   * Return a serialized version of the value (simplified JSON version)
   */
  async dump(key: string): Promise<string | null> {
    const entry = await this.storage.get(key)
    if (!entry) return null
    return JSON.stringify({ type: entry.type, value: entry.value })
  }

  /**
   * RESTORE key ttl serialized-value [REPLACE]
   * Create a key from serialized value
   */
  async restore(key: string, ttl: number, serialized: string, replace?: boolean): Promise<string> {
    const existing = await this.storage.get(key)
    if (existing && !replace) {
      throw new Error('BUSYKEY Target key name already exists')
    }

    const data = JSON.parse(serialized)
    const expiresAt = ttl > 0 ? Date.now() + ttl : undefined
    await this.storage.set(key, data.type, data.value, expiresAt)
    return 'OK'
  }

  /**
   * TOUCH key [key ...]
   * Alters the last access time of a key(s)
   * Returns the number of keys that exist
   */
  async touch(keys: string[]): Promise<number> {
    return this.exists(keys) // In our implementation, just check existence
  }

  /**
   * OBJECT ENCODING key
   * Return the internal encoding for a value
   */
  async objectEncoding(key: string): Promise<string | null> {
    const entry = await this.storage.get(key)
    if (!entry) return null

    switch (entry.type) {
      case 'string':
        const val = entry.value as string
        if (/^-?\d+$/.test(val) && parseInt(val, 10) >= -2147483648 && parseInt(val, 10) <= 2147483647) {
          return 'int'
        }
        return val.length <= 44 ? 'embstr' : 'raw'
      case 'list':
        return 'listpack'
      case 'set':
        return 'listpack'
      case 'hash':
        return 'listpack'
      case 'zset':
        return 'listpack'
      default:
        return null
    }
  }

  /**
   * RANDOMKEY
   * Return a random key from the keyspace
   */
  async randomkey(): Promise<string | null> {
    const allKeys = await this.storage.keys()
    if (allKeys.length === 0) return null
    const idx = Math.floor(Math.random() * allKeys.length)
    return allKeys[idx]
  }

  /**
   * DBSIZE
   * Return the number of keys in the database
   */
  async dbsize(): Promise<number> {
    const allKeys = await this.storage.keys()
    return allKeys.length
  }

  /**
   * FLUSHDB [ASYNC|SYNC]
   * Remove all keys from the current database
   */
  async flushdb(): Promise<string> {
    await this.storage.clear()
    return 'OK'
  }

  /**
   * FLUSHALL [ASYNC|SYNC]
   * Remove all keys from all databases (same as FLUSHDB in DO context)
   */
  async flushall(): Promise<string> {
    return this.flushdb()
  }
}
