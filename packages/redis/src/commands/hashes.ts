/**
 * Redis Hash Commands
 * HGET, HSET, HMGET, HGETALL, HDEL, HEXISTS, HLEN, HKEYS, HVALS, HINCRBY
 */

import type { RedisBackend } from '../types'

export class HashCommands {
  constructor(private backend: RedisBackend) {}

  private async getHash(key: string): Promise<Record<string, string>> {
    const entry = await this.backend.get(key)
    if (!entry) return {}
    if (entry.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }
    return entry.value as Record<string, string>
  }

  private async setHash(
    key: string,
    hash: Record<string, string>,
    expiresAt?: number
  ): Promise<void> {
    if (Object.keys(hash).length === 0) {
      await this.backend.delete(key)
    } else {
      await this.backend.set(key, 'hash', hash, expiresAt)
    }
  }

  /**
   * HGET key field
   * Get the value of a hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    const hash = await this.getHash(key)
    return hash[field] ?? null
  }

  /**
   * HSET key field value [field value ...]
   * Set the string value of a hash field
   * Returns the number of fields that were added (not updated)
   */
  async hset(key: string, fieldValues: [string, string][]): Promise<number> {
    const entry = await this.backend.get(key)
    let hash: Record<string, string> = {}

    if (entry) {
      if (entry.type !== 'hash') {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
      }
      hash = { ...(entry.value as Record<string, string>) }
    }

    let added = 0
    for (const [field, value] of fieldValues) {
      if (!(field in hash)) {
        added++
      }
      hash[field] = value
    }

    await this.setHash(key, hash, entry?.expires_at ?? undefined)
    return added
  }

  /**
   * HSETNX key field value
   * Set the value of a hash field, only if the field does not exist
   */
  async hsetnx(key: string, field: string, value: string): Promise<number> {
    const hash = await this.getHash(key)
    if (field in hash) {
      return 0
    }

    const newHash = { ...hash, [field]: value }
    const entry = await this.backend.get(key)
    await this.setHash(key, newHash, entry?.expires_at ?? undefined)
    return 1
  }

  /**
   * HMGET key field [field ...]
   * Get the values of all given hash fields
   */
  async hmget(key: string, fields: string[]): Promise<(string | null)[]> {
    const hash = await this.getHash(key)
    return fields.map((field) => hash[field] ?? null)
  }

  /**
   * HMSET key field value [field value ...]
   * Set multiple hash fields to multiple values
   */
  async hmset(key: string, fieldValues: [string, string][]): Promise<string> {
    await this.hset(key, fieldValues)
    return 'OK'
  }

  /**
   * HGETALL key
   * Get all fields and values in a hash
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    return this.getHash(key)
  }

  /**
   * HDEL key field [field ...]
   * Delete one or more hash fields
   */
  async hdel(key: string, fields: string[]): Promise<number> {
    const entry = await this.backend.get(key)
    if (!entry) return 0
    if (entry.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
    }

    const hash = { ...(entry.value as Record<string, string>) }
    let deleted = 0

    for (const field of fields) {
      if (field in hash) {
        delete hash[field]
        deleted++
      }
    }

    await this.setHash(key, hash, entry.expires_at ?? undefined)
    return deleted
  }

  /**
   * HEXISTS key field
   * Determine if a hash field exists
   */
  async hexists(key: string, field: string): Promise<number> {
    const hash = await this.getHash(key)
    return field in hash ? 1 : 0
  }

  /**
   * HLEN key
   * Get the number of fields in a hash
   */
  async hlen(key: string): Promise<number> {
    const hash = await this.getHash(key)
    return Object.keys(hash).length
  }

  /**
   * HKEYS key
   * Get all field names in a hash
   */
  async hkeys(key: string): Promise<string[]> {
    const hash = await this.getHash(key)
    return Object.keys(hash)
  }

  /**
   * HVALS key
   * Get all values in a hash
   */
  async hvals(key: string): Promise<string[]> {
    const hash = await this.getHash(key)
    return Object.values(hash)
  }

  /**
   * HINCRBY key field increment
   * Increment the integer value of a hash field by the given number
   */
  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const entry = await this.backend.get(key)
    let hash: Record<string, string> = {}

    if (entry) {
      if (entry.type !== 'hash') {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
      }
      hash = { ...(entry.value as Record<string, string>) }
    }

    let value = 0
    if (field in hash) {
      const parsed = parseInt(hash[field], 10)
      if (isNaN(parsed)) {
        throw new Error('ERR hash value is not an integer')
      }
      value = parsed
    }

    const newValue = value + increment
    hash[field] = String(newValue)
    await this.setHash(key, hash, entry?.expires_at ?? undefined)
    return newValue
  }

  /**
   * HINCRBYFLOAT key field increment
   * Increment the float value of a hash field by the given amount
   */
  async hincrbyfloat(key: string, field: string, increment: number): Promise<string> {
    const entry = await this.backend.get(key)
    let hash: Record<string, string> = {}

    if (entry) {
      if (entry.type !== 'hash') {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
      }
      hash = { ...(entry.value as Record<string, string>) }
    }

    let value = 0
    if (field in hash) {
      const parsed = parseFloat(hash[field])
      if (isNaN(parsed)) {
        throw new Error('ERR hash value is not a float')
      }
      value = parsed
    }

    const newValue = value + increment
    hash[field] = String(newValue)
    await this.setHash(key, hash, entry?.expires_at ?? undefined)
    return hash[field]
  }
}
