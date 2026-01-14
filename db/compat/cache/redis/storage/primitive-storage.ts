/**
 * Primitive-based Redis Storage Backend
 *
 * Uses unified primitives for enhanced functionality:
 * - TemporalStore: TTL management, versioning, and time-travel queries
 * - KeyedRouter: Consistent hashing for distributed routing
 *
 * This storage backend provides the same interface as the in-memory
 * RedisStorage but with support for persistence and distributed deployments.
 *
 * @module db/compat/cache/redis/storage/primitive-storage
 */

import {
  createTemporalStore,
  type TemporalStore,
  type PutOptions as TemporalPutOptions,
  createKeyedRouter,
  type KeyedRouter,
} from '../../../../primitives'
import type { SetOptions, ZAddOptions, ZRangeOptions } from '../types'
import { ReplyError } from '../types'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Redis data types
 */
export type RedisDataType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'none'

/**
 * Stored value wrapper with type information
 */
interface StoredValue {
  type: RedisDataType
  data: unknown
  createdAt: number
}

/**
 * Sorted set entry
 */
export interface ZSetEntry {
  member: string
  score: number
}

/**
 * Storage options for primitive-based backend
 */
export interface PrimitiveStorageOptions {
  /** Key prefix for all operations */
  keyPrefix?: string
  /** Number of partitions for distributed routing */
  partitionCount?: number
  /** Seed for consistent hashing */
  partitionSeed?: number
  /** Enable time-travel queries (historical reads) */
  enableTimeTravel?: boolean
  /** Maximum versions to retain per key */
  maxVersionsPerKey?: number
}

// =============================================================================
// PRIMITIVE STORAGE IMPLEMENTATION
// =============================================================================

/**
 * Redis-compatible storage backed by unified primitives
 */
export class PrimitiveStorage {
  // Core primitive stores
  private store: TemporalStore<StoredValue>
  private router: KeyedRouter<string>

  // Configuration
  private keyPrefix: string
  private enableTimeTravel: boolean

  // Version tracking for WATCH support
  private keyVersions = new Map<string, number>()
  private globalVersion = 0

  constructor(options: PrimitiveStorageOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? ''
    this.enableTimeTravel = options.enableTimeTravel ?? false

    // Create temporal store with TTL support
    this.store = createTemporalStore<StoredValue>({
      enableTTL: true,
      retention: options.maxVersionsPerKey
        ? { maxVersions: options.maxVersionsPerKey }
        : undefined,
    })

    // Create router for distributed deployments
    this.router = createKeyedRouter<string>({
      partitionCount: options.partitionCount ?? 1,
      seed: options.partitionSeed,
    })
  }

  // ===========================================================================
  // INTERNAL HELPERS
  // ===========================================================================

  /**
   * Apply key prefix
   */
  private prefixKey(key: string): string {
    return this.keyPrefix + key
  }

  /**
   * Remove key prefix
   */
  private unprefixKey(key: string): string {
    if (this.keyPrefix && key.startsWith(this.keyPrefix)) {
      return key.slice(this.keyPrefix.length)
    }
    return key
  }

  /**
   * Get partition for a key
   */
  getPartition(key: string): number {
    return this.router.route(this.prefixKey(key))
  }

  /**
   * Bump version for optimistic locking
   */
  private bumpVersion(key: string): void {
    const prefixedKey = this.prefixKey(key)
    this.keyVersions.set(prefixedKey, ++this.globalVersion)
  }

  /**
   * Get current version of a key
   */
  getVersion(key: string): number {
    return this.keyVersions.get(this.prefixKey(key)) ?? 0
  }

  /**
   * Get stored value with type checking
   */
  private async getStored(key: string): Promise<StoredValue | null> {
    const prefixedKey = this.prefixKey(key)
    return this.store.get(prefixedKey)
  }

  /**
   * Set stored value with optional TTL
   */
  private async setStored(
    key: string,
    type: RedisDataType,
    data: unknown,
    ttlMs?: number
  ): Promise<void> {
    const prefixedKey = this.prefixKey(key)
    const timestamp = Date.now()
    const value: StoredValue = { type, data, createdAt: timestamp }

    const options: TemporalPutOptions | undefined = ttlMs ? { ttl: ttlMs } : undefined
    await this.store.put(prefixedKey, value, timestamp, options)
    this.bumpVersion(key)
  }

  /**
   * Check type and throw WRONGTYPE if mismatch
   * Tombstone entries (type 'none') are treated as non-existent
   */
  private checkType(stored: StoredValue | null, expected: RedisDataType): void {
    if (stored && stored.type !== 'none' && stored.type !== expected) {
      const err = new ReplyError(
        'WRONGTYPE Operation against a key holding the wrong kind of value'
      )
      err.command = expected.toUpperCase()
      throw err
    }
  }

  // ===========================================================================
  // TYPE OPERATIONS
  // ===========================================================================

  /**
   * Get key type (tombstone entries return 'none')
   */
  async getType(key: string): Promise<RedisDataType> {
    const stored = await this.getStored(key)
    if (!stored || stored.type === 'none') return 'none'
    return stored.type
  }

  /**
   * Check if key exists (tombstone entries don't count as existing)
   */
  async exists(key: string): Promise<boolean> {
    const stored = await this.getStored(key)
    return stored !== null && stored.type !== 'none'
  }

  /**
   * Delete a key
   */
  async deleteKey(key: string): Promise<boolean> {
    const stored = await this.getStored(key)
    if (!stored) return false

    // Set to null (tombstone) - temporal store handles cleanup
    await this.setStored(key, 'none', null)
    return true
  }

  /**
   * Flush all data
   */
  async flush(): Promise<void> {
    // Create a fresh store
    this.store = createTemporalStore<StoredValue>({ enableTTL: true })
    this.keyVersions.clear()
    this.globalVersion = 0
  }

  // ===========================================================================
  // STRING OPERATIONS
  // ===========================================================================

  /**
   * Get string value
   */
  async getString(key: string): Promise<string | null> {
    const stored = await this.getStored(key)
    if (!stored) return null
    this.checkType(stored, 'string')
    return stored.data as string
  }

  /**
   * Set string value with options
   */
  async setString(key: string, value: string, options?: SetOptions): Promise<string | null> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'string')

    // Handle NX/XX options
    if (options?.NX && stored) return null
    if (options?.XX && !stored) return null

    // Handle GET option
    const returnValue = options?.GET ? (stored?.data as string ?? null) : 'OK'

    // Calculate TTL
    let ttlMs: number | undefined
    if (options?.EX) {
      ttlMs = options.EX * 1000
    } else if (options?.PX) {
      ttlMs = options.PX
    } else if (options?.EXAT) {
      ttlMs = options.EXAT * 1000 - Date.now()
    } else if (options?.PXAT) {
      ttlMs = options.PXAT - Date.now()
    }

    await this.setStored(key, 'string', value, ttlMs)
    return returnValue
  }

  /**
   * Increment string as integer
   */
  async incrString(key: string, amount: number = 1): Promise<number> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'string')

    const current = stored ? parseInt(stored.data as string, 10) : 0
    if (isNaN(current)) {
      throw new ReplyError('ERR value is not an integer or out of range')
    }

    const newValue = current + amount
    await this.setStored(key, 'string', String(newValue))
    return newValue
  }

  /**
   * Increment string as float
   */
  async incrFloatString(key: string, amount: number): Promise<string> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'string')

    const current = stored ? parseFloat(stored.data as string) : 0
    if (isNaN(current)) {
      throw new ReplyError('ERR value is not a valid float')
    }

    const newValue = current + amount
    const result = newValue.toString()
    await this.setStored(key, 'string', result)
    return result
  }

  /**
   * Append to string
   */
  async appendString(key: string, value: string): Promise<number> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'string')

    const current = stored ? (stored.data as string) : ''
    const newValue = current + value
    await this.setStored(key, 'string', newValue)
    return newValue.length
  }

  // ===========================================================================
  // HASH OPERATIONS
  // ===========================================================================

  /**
   * Get hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    const stored = await this.getStored(key)
    if (!stored) return null
    this.checkType(stored, 'hash')

    const hash = stored.data as Map<string, string>
    return hash.get(field) ?? null
  }

  /**
   * Set hash fields
   */
  async hset(key: string, fieldValues: Record<string, string>): Promise<number> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'hash')

    const hash = stored ? new Map(stored.data as Map<string, string>) : new Map<string, string>()
    let added = 0

    for (const [field, value] of Object.entries(fieldValues)) {
      if (!hash.has(field)) added++
      hash.set(field, value)
    }

    await this.setStored(key, 'hash', hash)
    return added
  }

  /**
   * Get all hash fields
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    const stored = await this.getStored(key)
    if (!stored) return {}
    this.checkType(stored, 'hash')

    const hash = stored.data as Map<string, string>
    return Object.fromEntries(hash)
  }

  /**
   * Delete hash fields
   */
  async hdel(key: string, fields: string[]): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return 0
    this.checkType(stored, 'hash')

    const hash = new Map(stored.data as Map<string, string>)
    let deleted = 0

    for (const field of fields) {
      if (hash.delete(field)) deleted++
    }

    await this.setStored(key, 'hash', hash)
    return deleted
  }

  /**
   * Check if hash field exists
   */
  async hexists(key: string, field: string): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return 0
    this.checkType(stored, 'hash')

    const hash = stored.data as Map<string, string>
    return hash.has(field) ? 1 : 0
  }

  /**
   * Get hash field count
   */
  async hlen(key: string): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return 0
    this.checkType(stored, 'hash')

    const hash = stored.data as Map<string, string>
    return hash.size
  }

  /**
   * Get all hash field names
   */
  async hkeys(key: string): Promise<string[]> {
    const stored = await this.getStored(key)
    if (!stored) return []
    this.checkType(stored, 'hash')

    const hash = stored.data as Map<string, string>
    return [...hash.keys()]
  }

  /**
   * Get all hash values
   */
  async hvals(key: string): Promise<string[]> {
    const stored = await this.getStored(key)
    if (!stored) return []
    this.checkType(stored, 'hash')

    const hash = stored.data as Map<string, string>
    return [...hash.values()]
  }

  /**
   * Increment hash field by integer
   */
  async hincrby(key: string, field: string, amount: number): Promise<number> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'hash')

    const hash = stored ? new Map(stored.data as Map<string, string>) : new Map<string, string>()
    const current = parseInt(hash.get(field) ?? '0', 10)

    if (isNaN(current)) {
      throw new ReplyError('ERR hash value is not an integer')
    }

    const newValue = current + amount
    hash.set(field, String(newValue))
    await this.setStored(key, 'hash', hash)
    return newValue
  }

  /**
   * Increment hash field by float
   */
  async hincrbyfloat(key: string, field: string, amount: number): Promise<string> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'hash')

    const hash = stored ? new Map(stored.data as Map<string, string>) : new Map<string, string>()
    const current = parseFloat(hash.get(field) ?? '0')

    if (isNaN(current)) {
      throw new ReplyError('ERR hash value is not a float')
    }

    const newValue = current + amount
    const result = newValue.toString()
    hash.set(field, result)
    await this.setStored(key, 'hash', hash)
    return result
  }

  /**
   * Set hash field if not exists
   */
  async hsetnx(key: string, field: string, value: string): Promise<number> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'hash')

    const hash = stored ? new Map(stored.data as Map<string, string>) : new Map<string, string>()
    if (hash.has(field)) return 0

    hash.set(field, value)
    await this.setStored(key, 'hash', hash)
    return 1
  }

  // ===========================================================================
  // LIST OPERATIONS
  // ===========================================================================

  /**
   * Push to head of list
   */
  async lpush(key: string, values: string[]): Promise<number> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'list')

    const list = stored ? [...(stored.data as string[])] : []
    for (const value of values) {
      list.unshift(value)
    }

    await this.setStored(key, 'list', list)
    return list.length
  }

  /**
   * Push to tail of list
   */
  async rpush(key: string, values: string[]): Promise<number> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'list')

    const list = stored ? [...(stored.data as string[])] : []
    list.push(...values)

    await this.setStored(key, 'list', list)
    return list.length
  }

  /**
   * Pop from head of list
   */
  async lpop(key: string, count?: number): Promise<string | string[] | null> {
    const stored = await this.getStored(key)
    if (!stored) return count !== undefined ? [] : null
    this.checkType(stored, 'list')

    const list = [...(stored.data as string[])]
    if (list.length === 0) return count !== undefined ? [] : null

    let result: string | string[]
    if (count !== undefined) {
      result = list.splice(0, count)
    } else {
      result = list.shift()!
    }

    await this.setStored(key, 'list', list)
    return result
  }

  /**
   * Pop from tail of list
   */
  async rpop(key: string, count?: number): Promise<string | string[] | null> {
    const stored = await this.getStored(key)
    if (!stored) return count !== undefined ? [] : null
    this.checkType(stored, 'list')

    const list = [...(stored.data as string[])]
    if (list.length === 0) return count !== undefined ? [] : null

    let result: string | string[]
    if (count !== undefined) {
      result = list.splice(-count).reverse()
    } else {
      result = list.pop()!
    }

    await this.setStored(key, 'list', list)
    return result
  }

  /**
   * Get range of list elements
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const stored = await this.getStored(key)
    if (!stored) return []
    this.checkType(stored, 'list')

    const list = stored.data as string[]
    const len = list.length

    let startIdx = start < 0 ? len + start : start
    let stopIdx = stop < 0 ? len + stop : stop

    startIdx = Math.max(0, startIdx)
    stopIdx = Math.min(len - 1, stopIdx)

    if (startIdx > stopIdx) return []
    return list.slice(startIdx, stopIdx + 1)
  }

  /**
   * Get list length
   */
  async llen(key: string): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return 0
    this.checkType(stored, 'list')

    return (stored.data as string[]).length
  }

  /**
   * Get element at index
   */
  async lindex(key: string, index: number): Promise<string | null> {
    const stored = await this.getStored(key)
    if (!stored) return null
    this.checkType(stored, 'list')

    const list = stored.data as string[]
    const idx = index < 0 ? list.length + index : index
    return list[idx] ?? null
  }

  /**
   * Set element at index
   */
  async lset(key: string, index: number, value: string): Promise<void> {
    const stored = await this.getStored(key)
    if (!stored) {
      throw new ReplyError('ERR no such key')
    }
    this.checkType(stored, 'list')

    const list = [...(stored.data as string[])]
    const idx = index < 0 ? list.length + index : index

    if (idx < 0 || idx >= list.length) {
      throw new ReplyError('ERR index out of range')
    }

    list[idx] = value
    await this.setStored(key, 'list', list)
  }

  /**
   * Remove elements by value
   */
  async lrem(key: string, count: number, value: string): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return 0
    this.checkType(stored, 'list')

    const list = [...(stored.data as string[])]
    let removed = 0
    const toRemove = Math.abs(count) || list.length

    if (count >= 0) {
      for (let i = 0; i < list.length && removed < toRemove; ) {
        if (list[i] === value) {
          list.splice(i, 1)
          removed++
        } else {
          i++
        }
      }
    } else {
      for (let i = list.length - 1; i >= 0 && removed < toRemove; ) {
        if (list[i] === value) {
          list.splice(i, 1)
          removed++
        }
        i--
      }
    }

    await this.setStored(key, 'list', list)
    return removed
  }

  /**
   * Trim list to range
   */
  async ltrim(key: string, start: number, stop: number): Promise<void> {
    const stored = await this.getStored(key)
    if (!stored) return
    this.checkType(stored, 'list')

    const list = stored.data as string[]
    const len = list.length

    let startIdx = start < 0 ? len + start : start
    let stopIdx = stop < 0 ? len + stop : stop

    startIdx = Math.max(0, startIdx)
    stopIdx = Math.min(len - 1, stopIdx)

    const newList = list.slice(startIdx, stopIdx + 1)
    await this.setStored(key, 'list', newList)
  }

  /**
   * Insert element before/after pivot
   */
  async linsert(
    key: string,
    position: 'BEFORE' | 'AFTER',
    pivot: string,
    value: string
  ): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return 0
    this.checkType(stored, 'list')

    const list = [...(stored.data as string[])]
    const idx = list.indexOf(pivot)
    if (idx === -1) return -1

    const insertIdx = position === 'BEFORE' ? idx : idx + 1
    list.splice(insertIdx, 0, value)
    await this.setStored(key, 'list', list)
    return list.length
  }

  /**
   * Find index of element
   */
  async lpos(key: string, value: string): Promise<number | null> {
    const stored = await this.getStored(key)
    if (!stored) return null
    this.checkType(stored, 'list')

    const list = stored.data as string[]
    const idx = list.indexOf(value)
    return idx === -1 ? null : idx
  }

  // ===========================================================================
  // SET OPERATIONS
  // ===========================================================================

  /**
   * Add members to set
   */
  async sadd(key: string, members: string[]): Promise<number> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'set')

    const set = stored ? new Set(stored.data as Set<string>) : new Set<string>()
    let added = 0

    for (const member of members) {
      if (!set.has(member)) {
        set.add(member)
        added++
      }
    }

    await this.setStored(key, 'set', set)
    return added
  }

  /**
   * Remove members from set
   */
  async srem(key: string, members: string[]): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return 0
    this.checkType(stored, 'set')

    const set = new Set(stored.data as Set<string>)
    let removed = 0

    for (const member of members) {
      if (set.delete(member)) removed++
    }

    await this.setStored(key, 'set', set)
    return removed
  }

  /**
   * Get all members
   */
  async smembers(key: string): Promise<string[]> {
    const stored = await this.getStored(key)
    if (!stored) return []
    this.checkType(stored, 'set')

    return [...(stored.data as Set<string>)]
  }

  /**
   * Check if member exists
   */
  async sismember(key: string, member: string): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return 0
    this.checkType(stored, 'set')

    const set = stored.data as Set<string>
    return set.has(member) ? 1 : 0
  }

  /**
   * Check multiple members
   */
  async smismember(key: string, members: string[]): Promise<number[]> {
    const stored = await this.getStored(key)
    if (!stored) return members.map(() => 0)
    this.checkType(stored, 'set')

    const set = stored.data as Set<string>
    return members.map((m) => (set.has(m) ? 1 : 0))
  }

  /**
   * Get set cardinality
   */
  async scard(key: string): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return 0
    this.checkType(stored, 'set')

    return (stored.data as Set<string>).size
  }

  /**
   * Intersection of sets
   */
  async sinter(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return []

    const sets: Set<string>[] = []
    for (const key of keys) {
      const stored = await this.getStored(key)
      if (stored) this.checkType(stored, 'set')
      sets.push(stored ? (stored.data as Set<string>) : new Set<string>())
    }

    const result = new Set([...sets[0]!])
    for (let i = 1; i < sets.length; i++) {
      for (const member of result) {
        if (!sets[i]!.has(member)) {
          result.delete(member)
        }
      }
    }
    return [...result]
  }

  /**
   * Union of sets
   */
  async sunion(keys: string[]): Promise<string[]> {
    const result = new Set<string>()

    for (const key of keys) {
      const stored = await this.getStored(key)
      if (stored) {
        this.checkType(stored, 'set')
        for (const member of stored.data as Set<string>) {
          result.add(member)
        }
      }
    }

    return [...result]
  }

  /**
   * Difference of sets
   */
  async sdiff(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return []

    const firstStored = await this.getStored(keys[0]!)
    if (firstStored) this.checkType(firstStored, 'set')
    const result = new Set(firstStored ? [...(firstStored.data as Set<string>)] : [])

    for (let i = 1; i < keys.length; i++) {
      const stored = await this.getStored(keys[i]!)
      if (stored) {
        this.checkType(stored, 'set')
        for (const member of stored.data as Set<string>) {
          result.delete(member)
        }
      }
    }

    return [...result]
  }

  /**
   * Get random member(s)
   */
  async srandmember(key: string, count?: number): Promise<string | string[] | null> {
    const stored = await this.getStored(key)
    if (!stored) return count !== undefined ? [] : null
    this.checkType(stored, 'set')

    const set = stored.data as Set<string>
    if (set.size === 0) return count !== undefined ? [] : null

    const members = [...set]
    if (count === undefined) {
      return members[Math.floor(Math.random() * members.length)]!
    }

    const result: string[] = []
    const allowDuplicates = count < 0
    const absCount = Math.abs(count)

    if (allowDuplicates) {
      for (let i = 0; i < absCount; i++) {
        result.push(members[Math.floor(Math.random() * members.length)]!)
      }
    } else {
      const shuffled = [...members].sort(() => Math.random() - 0.5)
      return shuffled.slice(0, Math.min(absCount, members.length))
    }

    return result
  }

  /**
   * Pop random member(s)
   */
  async spop(key: string, count?: number): Promise<string | string[] | null> {
    const stored = await this.getStored(key)
    if (!stored) return count !== undefined ? [] : null
    this.checkType(stored, 'set')

    const set = new Set(stored.data as Set<string>)
    if (set.size === 0) return count !== undefined ? [] : null

    const members = [...set]
    if (count === undefined) {
      const idx = Math.floor(Math.random() * members.length)
      const member = members[idx]!
      set.delete(member)
      await this.setStored(key, 'set', set)
      return member
    }

    const result: string[] = []
    const shuffled = [...members].sort(() => Math.random() - 0.5)
    for (let i = 0; i < Math.min(count, shuffled.length); i++) {
      result.push(shuffled[i]!)
      set.delete(shuffled[i]!)
    }

    await this.setStored(key, 'set', set)
    return result
  }

  /**
   * Move member between sets
   */
  async smove(src: string, dst: string, member: string): Promise<number> {
    const srcStored = await this.getStored(src)
    if (!srcStored) return 0
    this.checkType(srcStored, 'set')

    const srcSet = new Set(srcStored.data as Set<string>)
    if (!srcSet.has(member)) return 0

    srcSet.delete(member)
    await this.setStored(src, 'set', srcSet)

    const dstStored = await this.getStored(dst)
    if (dstStored) this.checkType(dstStored, 'set')
    const dstSet = dstStored ? new Set(dstStored.data as Set<string>) : new Set<string>()
    dstSet.add(member)
    await this.setStored(dst, 'set', dstSet)

    return 1
  }

  // ===========================================================================
  // SORTED SET OPERATIONS
  // ===========================================================================

  /**
   * Add members with scores
   */
  async zadd(key: string, entries: ZSetEntry[], options?: ZAddOptions): Promise<number | string> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'zset')

    const zset = stored ? [...(stored.data as ZSetEntry[])] : []
    let added = 0
    let changed = 0

    for (const entry of entries) {
      const existingIdx = zset.findIndex((e) => e.member === entry.member)

      if (existingIdx === -1) {
        if (!options?.XX) {
          zset.push({ ...entry })
          added++
          changed++
        }
      } else {
        if (!options?.NX) {
          const existing = zset[existingIdx]!
          let shouldUpdate = true

          if (options?.GT && entry.score <= existing.score) shouldUpdate = false
          if (options?.LT && entry.score >= existing.score) shouldUpdate = false

          if (shouldUpdate && existing.score !== entry.score) {
            existing.score = entry.score
            changed++
          }
        }
      }
    }

    // Sort by score, then by member lexicographically
    zset.sort((a, b) => a.score - b.score || a.member.localeCompare(b.member))
    await this.setStored(key, 'zset', zset)

    if (options?.INCR && entries.length === 1) {
      const entry = zset.find((e) => e.member === entries[0]!.member)
      return entry ? String(entry.score) : ''
    }

    return options?.CH ? changed : added
  }

  /**
   * Remove members
   */
  async zrem(key: string, members: string[]): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return 0
    this.checkType(stored, 'zset')

    const zset = stored.data as ZSetEntry[]
    let removed = 0

    const newZset = zset.filter((e) => {
      if (members.includes(e.member)) {
        removed++
        return false
      }
      return true
    })

    await this.setStored(key, 'zset', newZset)
    return removed
  }

  /**
   * Get range by index
   */
  async zrange(key: string, start: number, stop: number, options?: ZRangeOptions): Promise<string[]> {
    const stored = await this.getStored(key)
    if (!stored) return []
    this.checkType(stored, 'zset')

    let entries = [...(stored.data as ZSetEntry[])]
    if (options?.REV) {
      entries.reverse()
    }

    const len = entries.length
    let startIdx = start < 0 ? len + start : start
    let stopIdx = stop < 0 ? len + stop : stop

    startIdx = Math.max(0, startIdx)
    stopIdx = Math.min(len - 1, stopIdx)

    if (startIdx > stopIdx) return []
    const slice = entries.slice(startIdx, stopIdx + 1)

    if (options?.WITHSCORES) {
      const result: string[] = []
      for (const entry of slice) {
        result.push(entry.member, String(entry.score))
      }
      return result
    }

    return slice.map((e) => e.member)
  }

  /**
   * Get reversed range
   */
  async zrevrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]> {
    return this.zrange(key, start, stop, { REV: true, WITHSCORES: withScores })
  }

  /**
   * Get score of member
   */
  async zscore(key: string, member: string): Promise<string | null> {
    const stored = await this.getStored(key)
    if (!stored) return null
    this.checkType(stored, 'zset')

    const zset = stored.data as ZSetEntry[]
    const entry = zset.find((e) => e.member === member)
    return entry ? String(entry.score) : null
  }

  /**
   * Get rank of member
   */
  async zrank(key: string, member: string): Promise<number | null> {
    const stored = await this.getStored(key)
    if (!stored) return null
    this.checkType(stored, 'zset')

    const zset = stored.data as ZSetEntry[]
    const idx = zset.findIndex((e) => e.member === member)
    return idx === -1 ? null : idx
  }

  /**
   * Get reverse rank of member
   */
  async zrevrank(key: string, member: string): Promise<number | null> {
    const stored = await this.getStored(key)
    if (!stored) return null
    this.checkType(stored, 'zset')

    const zset = stored.data as ZSetEntry[]
    const idx = zset.findIndex((e) => e.member === member)
    return idx === -1 ? null : zset.length - 1 - idx
  }

  /**
   * Get cardinality
   */
  async zcard(key: string): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return 0
    this.checkType(stored, 'zset')

    return (stored.data as ZSetEntry[]).length
  }

  /**
   * Count members in score range
   */
  async zcount(key: string, min: number | string, max: number | string): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return 0
    this.checkType(stored, 'zset')

    const zset = stored.data as ZSetEntry[]
    const minScore = min === '-inf' ? -Infinity : Number(min)
    const maxScore = max === '+inf' ? Infinity : Number(max)

    return zset.filter((e) => e.score >= minScore && e.score <= maxScore).length
  }

  /**
   * Increment score
   */
  async zincrby(key: string, increment: number, member: string): Promise<string> {
    const stored = await this.getStored(key)
    if (stored) this.checkType(stored, 'zset')

    const zset = stored ? [...(stored.data as ZSetEntry[])] : []
    const existingIdx = zset.findIndex((e) => e.member === member)
    let newScore: number

    if (existingIdx === -1) {
      newScore = increment
      zset.push({ member, score: newScore })
    } else {
      newScore = zset[existingIdx]!.score + increment
      zset[existingIdx]!.score = newScore
    }

    zset.sort((a, b) => a.score - b.score || a.member.localeCompare(b.member))
    await this.setStored(key, 'zset', zset)
    return String(newScore)
  }

  /**
   * Get range by score
   */
  async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    options?: { WITHSCORES?: boolean; LIMIT?: { offset: number; count: number } }
  ): Promise<string[]> {
    const stored = await this.getStored(key)
    if (!stored) return []
    this.checkType(stored, 'zset')

    const zset = stored.data as ZSetEntry[]
    const minScore = min === '-inf' ? -Infinity : Number(min)
    const maxScore = max === '+inf' ? Infinity : Number(max)

    let entries = zset.filter((e) => e.score >= minScore && e.score <= maxScore)

    if (options?.LIMIT) {
      entries = entries.slice(options.LIMIT.offset, options.LIMIT.offset + options.LIMIT.count)
    }

    if (options?.WITHSCORES) {
      const result: string[] = []
      for (const entry of entries) {
        result.push(entry.member, String(entry.score))
      }
      return result
    }

    return entries.map((e) => e.member)
  }

  /**
   * Get reversed range by score
   */
  async zrevrangebyscore(
    key: string,
    max: number | string,
    min: number | string,
    options?: { WITHSCORES?: boolean; LIMIT?: { offset: number; count: number } }
  ): Promise<string[]> {
    const stored = await this.getStored(key)
    if (!stored) return []
    this.checkType(stored, 'zset')

    const zset = stored.data as ZSetEntry[]
    const minScore = min === '-inf' ? -Infinity : Number(min)
    const maxScore = max === '+inf' ? Infinity : Number(max)

    let entries = zset
      .filter((e) => e.score >= minScore && e.score <= maxScore)
      .sort((a, b) => b.score - a.score || b.member.localeCompare(a.member))

    if (options?.LIMIT) {
      entries = entries.slice(options.LIMIT.offset, options.LIMIT.offset + options.LIMIT.count)
    }

    if (options?.WITHSCORES) {
      const result: string[] = []
      for (const entry of entries) {
        result.push(entry.member, String(entry.score))
      }
      return result
    }

    return entries.map((e) => e.member)
  }

  /**
   * Pop minimum score members
   */
  async zpopmin(key: string, count: number = 1): Promise<string[]> {
    const stored = await this.getStored(key)
    if (!stored) return []
    this.checkType(stored, 'zset')

    const zset = [...(stored.data as ZSetEntry[])]
    if (zset.length === 0) return []

    const popped = zset.splice(0, count)
    await this.setStored(key, 'zset', zset)

    const result: string[] = []
    for (const entry of popped) {
      result.push(entry.member, String(entry.score))
    }
    return result
  }

  /**
   * Pop maximum score members
   */
  async zpopmax(key: string, count: number = 1): Promise<string[]> {
    const stored = await this.getStored(key)
    if (!stored) return []
    this.checkType(stored, 'zset')

    const zset = [...(stored.data as ZSetEntry[])]
    if (zset.length === 0) return []

    const popped = zset.splice(-count).reverse()
    await this.setStored(key, 'zset', zset)

    const result: string[] = []
    for (const entry of popped) {
      result.push(entry.member, String(entry.score))
    }
    return result
  }

  // ===========================================================================
  // KEY OPERATIONS
  // ===========================================================================

  /**
   * Get all keys matching pattern
   */
  async keys(pattern: string): Promise<string[]> {
    // Note: This is a simplified implementation
    // Full pattern matching would require scanning the temporal store
    // For now, return empty array - real implementation would use a secondary index
    console.warn('keys() pattern matching not fully implemented in primitive storage')
    return []
  }

  /**
   * Set expiry
   */
  async setExpiry(key: string, expiryMs: number): Promise<boolean> {
    const stored = await this.getStored(key)
    if (!stored) return false

    // Re-store with new TTL
    await this.setStored(key, stored.type, stored.data, expiryMs)
    return true
  }

  /**
   * Set expiry at timestamp
   */
  async setExpiryAt(key: string, timestampMs: number): Promise<boolean> {
    const stored = await this.getStored(key)
    if (!stored) return false

    const ttlMs = timestampMs - Date.now()
    if (ttlMs <= 0) {
      await this.deleteKey(key)
      return true
    }

    await this.setStored(key, stored.type, stored.data, ttlMs)
    return true
  }

  /**
   * Get TTL in milliseconds
   * Note: TTL tracking requires additional implementation in TemporalStore
   * For now returns -1 (no expiry) or -2 (key doesn't exist)
   */
  async getTTL(key: string): Promise<number> {
    const stored = await this.getStored(key)
    if (!stored) return -2
    // TemporalStore handles TTL internally but doesn't expose remaining TTL
    // Would need to track expiry timestamps separately
    return -1
  }

  /**
   * Remove expiry
   */
  async persist(key: string): Promise<boolean> {
    const stored = await this.getStored(key)
    if (!stored) return false

    // Re-store without TTL
    await this.setStored(key, stored.type, stored.data)
    return true
  }

  /**
   * Rename key
   */
  async rename(oldKey: string, newKey: string): Promise<void> {
    const stored = await this.getStored(oldKey)
    if (!stored) {
      throw new ReplyError('ERR no such key')
    }

    await this.deleteKey(newKey)
    await this.setStored(newKey, stored.type, stored.data)
    await this.deleteKey(oldKey)
  }

  /**
   * Copy key
   */
  async copy(src: string, dst: string, replace: boolean = false): Promise<boolean> {
    const stored = await this.getStored(src)
    if (!stored) return false

    const dstExists = await this.exists(dst)
    if (dstExists && !replace) return false

    if (replace) {
      await this.deleteKey(dst)
    }

    // Deep copy data
    let dataCopy: unknown
    switch (stored.type) {
      case 'hash':
        dataCopy = new Map(stored.data as Map<string, string>)
        break
      case 'set':
        dataCopy = new Set(stored.data as Set<string>)
        break
      case 'list':
        dataCopy = [...(stored.data as string[])]
        break
      case 'zset':
        dataCopy = (stored.data as ZSetEntry[]).map((e) => ({ ...e }))
        break
      default:
        dataCopy = stored.data
    }

    await this.setStored(dst, stored.type, dataCopy)
    return true
  }

  // ===========================================================================
  // TIME-TRAVEL OPERATIONS (Enabled via TemporalStore)
  // ===========================================================================

  /**
   * Get value at a specific point in time
   */
  async getAsOf(key: string, timestamp: number): Promise<StoredValue | null> {
    if (!this.enableTimeTravel) {
      throw new Error('Time-travel queries not enabled')
    }

    const prefixedKey = this.prefixKey(key)
    return this.store.getAsOf(prefixedKey, timestamp)
  }

  /**
   * Create a snapshot of current state
   */
  async createSnapshot(): Promise<string> {
    return this.store.snapshot()
  }

  /**
   * Restore from a snapshot
   */
  async restoreSnapshot(snapshotId: string): Promise<void> {
    await this.store.restoreSnapshot(snapshotId)
  }

  /**
   * List available snapshots
   */
  async listSnapshots(): Promise<Array<{ id: string; timestamp: number; createdAt: number }>> {
    return this.store.listSnapshots()
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a primitive-backed Redis storage instance
 */
export function createPrimitiveStorage(options?: PrimitiveStorageOptions): PrimitiveStorage {
  return new PrimitiveStorage(options)
}
