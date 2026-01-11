/**
 * Redis String Commands
 * GET, SET, MGET, MSET, INCR, DECR, APPEND, GETSET, SETNX, SETEX, STRLEN
 */

import type { RedisStorage } from '../storage'

export class StringCommands {
  constructor(private storage: RedisStorage) {}

  /**
   * GET key
   * Returns the value of key, or null if key does not exist
   */
  async get(key: string): Promise<string | null> {
    const entry = await this.storage.get(key)
    if (!entry) return null
    if (entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }
    return entry.value as string
  }

  /**
   * SET key value [EX seconds] [PX milliseconds] [NX|XX] [GET]
   * Set key to hold the string value
   */
  async set(
    key: string,
    value: string,
    options?: {
      ex?: number // Seconds
      px?: number // Milliseconds
      nx?: boolean // Only set if not exists
      xx?: boolean // Only set if exists
      get?: boolean // Return old value
    }
  ): Promise<string | null> {
    const existing = await this.storage.get(key)

    // Handle NX/XX conditions
    if (options?.nx && existing) {
      return null
    }
    if (options?.xx && !existing) {
      return null
    }

    // Calculate TTL
    let ttl: number | undefined
    if (options?.ex) {
      ttl = Date.now() + options.ex * 1000
    } else if (options?.px) {
      ttl = Date.now() + options.px
    }

    const oldValue = existing?.type === 'string' ? (existing.value as string) : null

    await this.storage.set(key, 'string', value, ttl)

    if (options?.get) {
      return oldValue
    }

    return 'OK'
  }

  /**
   * MGET key [key ...]
   * Returns the values of all specified keys
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    const results: (string | null)[] = []
    for (const key of keys) {
      try {
        results.push(await this.get(key))
      } catch {
        results.push(null)
      }
    }
    return results
  }

  /**
   * MSET key value [key value ...]
   * Sets the given keys to their respective values
   */
  async mset(pairs: [string, string][]): Promise<string> {
    for (const [key, value] of pairs) {
      await this.storage.set(key, 'string', value)
    }
    return 'OK'
  }

  /**
   * INCR key
   * Increments the number stored at key by one
   */
  async incr(key: string): Promise<number> {
    return this.incrby(key, 1)
  }

  /**
   * INCRBY key increment
   * Increments the number stored at key by increment
   */
  async incrby(key: string, increment: number): Promise<number> {
    const entry = await this.storage.get(key)

    if (entry && entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    let value = 0
    if (entry) {
      const parsed = parseInt(entry.value as string, 10)
      if (isNaN(parsed)) {
        throw new Error('ERR value is not an integer or out of range')
      }
      value = parsed
    }

    const newValue = value + increment
    await this.storage.set(key, 'string', String(newValue), entry?.expires_at ?? undefined)
    return newValue
  }

  /**
   * INCRBYFLOAT key increment
   * Increment the float value of a key by the given amount
   */
  async incrbyfloat(key: string, increment: number): Promise<string> {
    const entry = await this.storage.get(key)

    if (entry && entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    let value = 0
    if (entry) {
      const parsed = parseFloat(entry.value as string)
      if (isNaN(parsed)) {
        throw new Error('ERR value is not a valid float')
      }
      value = parsed
    }

    const newValue = value + increment
    const result = newValue.toString()
    await this.storage.set(key, 'string', result, entry?.expires_at ?? undefined)
    return result
  }

  /**
   * DECR key
   * Decrements the number stored at key by one
   */
  async decr(key: string): Promise<number> {
    return this.incrby(key, -1)
  }

  /**
   * DECRBY key decrement
   * Decrements the number stored at key by decrement
   */
  async decrby(key: string, decrement: number): Promise<number> {
    return this.incrby(key, -decrement)
  }

  /**
   * APPEND key value
   * Appends a value to a key
   */
  async append(key: string, value: string): Promise<number> {
    const entry = await this.storage.get(key)

    if (entry && entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const currentValue = entry ? (entry.value as string) : ''
    const newValue = currentValue + value
    await this.storage.set(key, 'string', newValue, entry?.expires_at ?? undefined)
    return newValue.length
  }

  /**
   * STRLEN key
   * Returns the length of the string value stored at key
   */
  async strlen(key: string): Promise<number> {
    const entry = await this.storage.get(key)
    if (!entry) return 0
    if (entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }
    return (entry.value as string).length
  }

  /**
   * GETSET key value (deprecated, use SET with GET option)
   * Set the string value of a key and return its old value
   */
  async getset(key: string, value: string): Promise<string | null> {
    return this.set(key, value, { get: true })
  }

  /**
   * SETNX key value
   * Set the value of a key, only if the key does not exist
   */
  async setnx(key: string, value: string): Promise<number> {
    const result = await this.set(key, value, { nx: true })
    return result === 'OK' ? 1 : 0
  }

  /**
   * SETEX key seconds value
   * Set the value and expiration of a key
   */
  async setex(key: string, seconds: number, value: string): Promise<string> {
    return (await this.set(key, value, { ex: seconds })) ?? 'OK'
  }

  /**
   * PSETEX key milliseconds value
   * Set the value and expiration in milliseconds of a key
   */
  async psetex(key: string, milliseconds: number, value: string): Promise<string> {
    return (await this.set(key, value, { px: milliseconds })) ?? 'OK'
  }

  /**
   * GETRANGE key start end
   * Get a substring of the string stored at a key
   */
  async getrange(key: string, start: number, end: number): Promise<string> {
    const value = await this.get(key)
    if (!value) return ''

    // Handle negative indices
    const len = value.length
    let s = start < 0 ? Math.max(0, len + start) : start
    let e = end < 0 ? len + end : end

    // Clamp to valid range
    s = Math.max(0, Math.min(s, len - 1))
    e = Math.max(0, Math.min(e, len - 1))

    if (s > e) return ''
    return value.slice(s, e + 1)
  }

  /**
   * SETRANGE key offset value
   * Overwrite part of a string at key starting at the specified offset
   */
  async setrange(key: string, offset: number, value: string): Promise<number> {
    const entry = await this.storage.get(key)

    if (entry && entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    let current = entry ? (entry.value as string) : ''

    // Pad with null bytes if offset is beyond current length
    if (offset > current.length) {
      current = current.padEnd(offset, '\x00')
    }

    const newValue = current.slice(0, offset) + value + current.slice(offset + value.length)
    await this.storage.set(key, 'string', newValue, entry?.expires_at ?? undefined)
    return newValue.length
  }
}
