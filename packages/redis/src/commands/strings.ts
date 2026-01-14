/**
 * Redis String Commands
 * GET, SET, MGET, MSET, INCR, DECR, APPEND, STRLEN
 */

import type { RedisBackend, SetOptions } from '../types'

export class StringCommands {
  constructor(private backend: RedisBackend) {}

  /**
   * GET key
   * Returns the value of key, or null if key does not exist
   */
  async get(key: string): Promise<string | null> {
    const entry = await this.backend.get(key)
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
  async set(key: string, value: string, options?: SetOptions): Promise<string | null> {
    const existing = await this.backend.get(key)

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

    await this.backend.set(key, 'string', value, ttl)

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
      await this.backend.set(key, 'string', value)
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
    const entry = await this.backend.get(key)

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
    await this.backend.set(key, 'string', String(newValue), entry?.expires_at ?? undefined)
    return newValue
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
    const entry = await this.backend.get(key)

    if (entry && entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const currentValue = entry ? (entry.value as string) : ''
    const newValue = currentValue + value
    await this.backend.set(key, 'string', newValue, entry?.expires_at ?? undefined)
    return newValue.length
  }

  /**
   * STRLEN key
   * Returns the length of the string value stored at key
   */
  async strlen(key: string): Promise<number> {
    const entry = await this.backend.get(key)
    if (!entry) return 0
    if (entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }
    return (entry.value as string).length
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
   * GETSET key value (deprecated, use SET with GET option)
   * Set the string value of a key and return its old value
   */
  async getset(key: string, value: string): Promise<string | null> {
    return this.set(key, value, { get: true })
  }
}
