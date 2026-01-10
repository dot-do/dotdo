/**
 * @dotdo/redis - Redis SDK compat
 *
 * Drop-in replacement for ioredis/node-redis backed by DO storage.
 * This in-memory implementation matches the Redis/ioredis Client API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://github.com/redis/ioredis
 * @see https://github.com/redis/node-redis
 */
import type {
  Redis as RedisInterface,
  RedisOptions,
  ExtendedRedisOptions,
  ClientStatus,
  RedisEvents,
  Pipeline as PipelineInterface,
  Multi as MultiInterface,
  SetOptions,
  ZAddOptions,
  ZRangeOptions,
  RedisKey,
  RedisValue,
  ScanResult,
} from './types'
import { RedisError, ReplyError, TransactionError } from './types'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert RedisKey to string
 */
function keyToString(key: RedisKey): string {
  if (Buffer.isBuffer(key)) {
    return key.toString()
  }
  return key as string
}

/**
 * Convert RedisValue to string
 */
function valueToString(value: RedisValue): string {
  if (Buffer.isBuffer(value)) {
    return value.toString()
  }
  return String(value)
}

/**
 * Simple glob pattern matching for KEYS command
 */
function matchPattern(pattern: string, key: string): boolean {
  // Convert glob to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
    .replace(/\*/g, '.*') // * matches any chars
    .replace(/\?/g, '.') // ? matches single char
  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(key)
}

// ============================================================================
// SORTED SET ENTRY
// ============================================================================

interface ZSetEntry {
  member: string
  score: number
}

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

// Shared storage for all clients (simulates shared Redis server)
const sharedStrings = new Map<string, string>()
const sharedHashes = new Map<string, Map<string, string>>()
const sharedLists = new Map<string, string[]>()
const sharedSets = new Map<string, Set<string>>()
const sharedZsets = new Map<string, ZSetEntry[]>()
const sharedExpiries = new Map<string, number>()
const sharedTypes = new Map<string, string>()

// Global version counter for optimistic locking (WATCH)
let globalVersion = 0
const keyVersions = new Map<string, number>()

class RedisStorage {
  // Reference to shared data stores
  private strings = sharedStrings
  private hashes = sharedHashes
  private lists = sharedLists
  private sets = sharedSets
  private zsets = sharedZsets

  // TTL tracking (expiry timestamp in ms)
  private expiries = sharedExpiries

  // Type tracking
  private types = sharedTypes

  // Key prefix
  private keyPrefix: string

  constructor(keyPrefix: string = '') {
    this.keyPrefix = keyPrefix
  }

  // Increment version for a key (for WATCH support)
  private bumpVersion(key: string): void {
    const prefixedKey = this.prefixKey(key)
    keyVersions.set(prefixedKey, ++globalVersion)
  }

  // Get current version of a key
  getVersion(key: string): number {
    return keyVersions.get(this.prefixKey(key)) ?? 0
  }

  // Apply key prefix
  private prefixKey(key: string): string {
    return this.keyPrefix + key
  }

  // Check and remove expired keys
  private checkExpiry(key: string): boolean {
    const prefixedKey = this.prefixKey(key)
    const expiry = this.expiries.get(prefixedKey)
    if (expiry && Date.now() > expiry) {
      this.deleteKey(key)
      return true
    }
    return false
  }

  // Get type of key
  getType(key: string): string {
    this.checkExpiry(key)
    return this.types.get(this.prefixKey(key)) ?? 'none'
  }

  // Check type matches expected
  private checkType(key: string, expected: string): void {
    const type = this.getType(key)
    if (type !== 'none' && type !== expected) {
      const err = new ReplyError(
        `WRONGTYPE Operation against a key holding the wrong kind of value`
      )
      err.command = expected.toUpperCase()
      throw err
    }
  }

  // Set type for key
  private setType(key: string, type: string): void {
    this.types.set(this.prefixKey(key), type)
  }

  // Delete a key
  deleteKey(key: string): boolean {
    const prefixedKey = this.prefixKey(key)
    const existed =
      this.strings.delete(prefixedKey) ||
      this.hashes.delete(prefixedKey) ||
      this.lists.delete(prefixedKey) ||
      this.sets.delete(prefixedKey) ||
      this.zsets.delete(prefixedKey)
    this.expiries.delete(prefixedKey)
    this.types.delete(prefixedKey)
    return existed
  }

  // Check if key exists
  exists(key: string): boolean {
    this.checkExpiry(key)
    return this.types.has(this.prefixKey(key))
  }

  // Get all keys matching pattern
  keys(pattern: string): string[] {
    const result: string[] = []
    const prefixLen = this.keyPrefix.length

    for (const key of this.types.keys()) {
      // Remove prefix for comparison
      const unprefixedKey = key.substring(prefixLen)
      if (!this.checkExpiry(unprefixedKey) && matchPattern(pattern, unprefixedKey)) {
        result.push(unprefixedKey)
      }
    }

    return result
  }

  // Set expiry
  setExpiry(key: string, expiryMs: number): boolean {
    if (!this.exists(key)) return false
    this.expiries.set(this.prefixKey(key), Date.now() + expiryMs)
    return true
  }

  // Set expiry at timestamp
  setExpiryAt(key: string, timestampMs: number): boolean {
    if (!this.exists(key)) return false
    this.expiries.set(this.prefixKey(key), timestampMs)
    return true
  }

  // Get TTL in ms
  getTTL(key: string): number {
    this.checkExpiry(key)
    const prefixedKey = this.prefixKey(key)
    if (!this.types.has(prefixedKey)) return -2
    const expiry = this.expiries.get(prefixedKey)
    if (!expiry) return -1
    return Math.max(0, expiry - Date.now())
  }

  // Remove expiry
  persist(key: string): boolean {
    const prefixedKey = this.prefixKey(key)
    return this.expiries.delete(prefixedKey)
  }

  // Rename key
  rename(oldKey: string, newKey: string): void {
    const type = this.getType(oldKey)
    if (type === 'none') {
      throw new ReplyError('ERR no such key')
    }

    const oldPrefixed = this.prefixKey(oldKey)
    const newPrefixed = this.prefixKey(newKey)

    // Delete new key if exists
    this.deleteKey(newKey)

    // Copy data
    switch (type) {
      case 'string':
        this.strings.set(newPrefixed, this.strings.get(oldPrefixed)!)
        this.strings.delete(oldPrefixed)
        break
      case 'hash':
        this.hashes.set(newPrefixed, this.hashes.get(oldPrefixed)!)
        this.hashes.delete(oldPrefixed)
        break
      case 'list':
        this.lists.set(newPrefixed, this.lists.get(oldPrefixed)!)
        this.lists.delete(oldPrefixed)
        break
      case 'set':
        this.sets.set(newPrefixed, this.sets.get(oldPrefixed)!)
        this.sets.delete(oldPrefixed)
        break
      case 'zset':
        this.zsets.set(newPrefixed, this.zsets.get(oldPrefixed)!)
        this.zsets.delete(oldPrefixed)
        break
    }

    // Copy expiry
    const expiry = this.expiries.get(oldPrefixed)
    if (expiry) {
      this.expiries.set(newPrefixed, expiry)
      this.expiries.delete(oldPrefixed)
    }

    // Copy type
    this.types.set(newPrefixed, type)
    this.types.delete(oldPrefixed)
  }

  // Copy key
  copy(src: string, dst: string, replace: boolean = false): boolean {
    const type = this.getType(src)
    if (type === 'none') return false

    if (this.exists(dst) && !replace) return false

    const srcPrefixed = this.prefixKey(src)
    const dstPrefixed = this.prefixKey(dst)

    // Delete dst if replace
    if (replace) {
      this.deleteKey(dst)
    }

    // Copy data
    switch (type) {
      case 'string':
        this.strings.set(dstPrefixed, this.strings.get(srcPrefixed)!)
        break
      case 'hash':
        this.hashes.set(dstPrefixed, new Map(this.hashes.get(srcPrefixed)!))
        break
      case 'list':
        this.lists.set(dstPrefixed, [...this.lists.get(srcPrefixed)!])
        break
      case 'set':
        this.sets.set(dstPrefixed, new Set(this.sets.get(srcPrefixed)!))
        break
      case 'zset':
        this.zsets.set(
          dstPrefixed,
          this.zsets.get(srcPrefixed)!.map((e) => ({ ...e }))
        )
        break
    }

    this.types.set(dstPrefixed, type)
    return true
  }

  // Flush all data
  flush(): void {
    this.strings.clear()
    this.hashes.clear()
    this.lists.clear()
    this.sets.clear()
    this.zsets.clear()
    this.expiries.clear()
    this.types.clear()
    keyVersions.clear()
  }

  // Get database size
  dbsize(): number {
    // Count non-expired keys
    let count = 0
    for (const key of this.types.keys()) {
      const unprefixedKey = key.substring(this.keyPrefix.length)
      if (!this.checkExpiry(unprefixedKey)) {
        count++
      }
    }
    return count
  }

  // ============================================================================
  // STRING OPERATIONS
  // ============================================================================

  getString(key: string): string | null {
    this.checkExpiry(key)
    this.checkType(key, 'string')
    return this.strings.get(this.prefixKey(key)) ?? null
  }

  setString(key: string, value: string, options?: SetOptions): string | null {
    this.checkType(key, 'string')
    const prefixedKey = this.prefixKey(key)
    const oldValue = this.strings.get(prefixedKey)

    // Handle NX/XX options
    if (options?.NX && this.exists(key)) return null
    if (options?.XX && !this.exists(key)) return null

    // Handle GET option
    const returnValue = options?.GET ? oldValue ?? null : 'OK'

    // Set value
    this.strings.set(prefixedKey, value)
    this.setType(key, 'string')
    this.bumpVersion(key)

    // Handle expiry options
    if (!options?.KEEPTTL) {
      this.expiries.delete(prefixedKey)
    }

    if (options?.EX) {
      this.setExpiry(key, options.EX * 1000)
    } else if (options?.PX) {
      this.setExpiry(key, options.PX)
    } else if (options?.EXAT) {
      this.setExpiryAt(key, options.EXAT * 1000)
    } else if (options?.PXAT) {
      this.setExpiryAt(key, options.PXAT)
    }

    return returnValue
  }

  incrString(key: string, amount: number = 1): number {
    this.checkType(key, 'string')
    const prefixedKey = this.prefixKey(key)
    const current = this.strings.get(prefixedKey) ?? '0'

    const num = parseInt(current, 10)
    if (isNaN(num)) {
      throw new ReplyError('ERR value is not an integer or out of range')
    }

    const newValue = num + amount
    this.strings.set(prefixedKey, String(newValue))
    this.setType(key, 'string')
    return newValue
  }

  incrFloatString(key: string, amount: number): string {
    this.checkType(key, 'string')
    const prefixedKey = this.prefixKey(key)
    const current = this.strings.get(prefixedKey) ?? '0'

    const num = parseFloat(current)
    if (isNaN(num)) {
      throw new ReplyError('ERR value is not a valid float')
    }

    const newValue = num + amount
    const result = newValue.toString()
    this.strings.set(prefixedKey, result)
    this.setType(key, 'string')
    return result
  }

  appendString(key: string, value: string): number {
    this.checkType(key, 'string')
    const prefixedKey = this.prefixKey(key)
    const current = this.strings.get(prefixedKey) ?? ''
    const newValue = current + value
    this.strings.set(prefixedKey, newValue)
    this.setType(key, 'string')
    return newValue.length
  }

  // ============================================================================
  // HASH OPERATIONS
  // ============================================================================

  hget(key: string, field: string): string | null {
    this.checkExpiry(key)
    this.checkType(key, 'hash')
    const hash = this.hashes.get(this.prefixKey(key))
    return hash?.get(field) ?? null
  }

  hset(key: string, fieldValues: Record<string, string>): number {
    this.checkType(key, 'hash')
    const prefixedKey = this.prefixKey(key)
    let hash = this.hashes.get(prefixedKey)
    if (!hash) {
      hash = new Map()
      this.hashes.set(prefixedKey, hash)
      this.setType(key, 'hash')
    }

    let added = 0
    for (const [field, value] of Object.entries(fieldValues)) {
      if (!hash.has(field)) added++
      hash.set(field, value)
    }
    return added
  }

  hgetall(key: string): Record<string, string> {
    this.checkExpiry(key)
    this.checkType(key, 'hash')
    const hash = this.hashes.get(this.prefixKey(key))
    if (!hash) return {}
    return Object.fromEntries(hash)
  }

  hdel(key: string, fields: string[]): number {
    this.checkType(key, 'hash')
    const hash = this.hashes.get(this.prefixKey(key))
    if (!hash) return 0

    let deleted = 0
    for (const field of fields) {
      if (hash.delete(field)) deleted++
    }
    return deleted
  }

  hexists(key: string, field: string): number {
    this.checkExpiry(key)
    this.checkType(key, 'hash')
    const hash = this.hashes.get(this.prefixKey(key))
    return hash?.has(field) ? 1 : 0
  }

  hkeys(key: string): string[] {
    this.checkExpiry(key)
    this.checkType(key, 'hash')
    const hash = this.hashes.get(this.prefixKey(key))
    return hash ? [...hash.keys()] : []
  }

  hvals(key: string): string[] {
    this.checkExpiry(key)
    this.checkType(key, 'hash')
    const hash = this.hashes.get(this.prefixKey(key))
    return hash ? [...hash.values()] : []
  }

  hlen(key: string): number {
    this.checkExpiry(key)
    this.checkType(key, 'hash')
    const hash = this.hashes.get(this.prefixKey(key))
    return hash?.size ?? 0
  }

  hincrby(key: string, field: string, amount: number): number {
    this.checkType(key, 'hash')
    const prefixedKey = this.prefixKey(key)
    let hash = this.hashes.get(prefixedKey)
    if (!hash) {
      hash = new Map()
      this.hashes.set(prefixedKey, hash)
      this.setType(key, 'hash')
    }

    const current = parseInt(hash.get(field) ?? '0', 10)
    if (isNaN(current)) {
      throw new ReplyError('ERR hash value is not an integer')
    }

    const newValue = current + amount
    hash.set(field, String(newValue))
    return newValue
  }

  hincrbyfloat(key: string, field: string, amount: number): string {
    this.checkType(key, 'hash')
    const prefixedKey = this.prefixKey(key)
    let hash = this.hashes.get(prefixedKey)
    if (!hash) {
      hash = new Map()
      this.hashes.set(prefixedKey, hash)
      this.setType(key, 'hash')
    }

    const current = parseFloat(hash.get(field) ?? '0')
    if (isNaN(current)) {
      throw new ReplyError('ERR hash value is not a float')
    }

    const newValue = current + amount
    const result = newValue.toString()
    hash.set(field, result)
    return result
  }

  hsetnx(key: string, field: string, value: string): number {
    this.checkType(key, 'hash')
    const prefixedKey = this.prefixKey(key)
    let hash = this.hashes.get(prefixedKey)
    if (!hash) {
      hash = new Map()
      this.hashes.set(prefixedKey, hash)
      this.setType(key, 'hash')
    }

    if (hash.has(field)) return 0
    hash.set(field, value)
    return 1
  }

  // ============================================================================
  // LIST OPERATIONS
  // ============================================================================

  lpush(key: string, values: string[]): number {
    this.checkType(key, 'list')
    const prefixedKey = this.prefixKey(key)
    let list = this.lists.get(prefixedKey)
    if (!list) {
      list = []
      this.lists.set(prefixedKey, list)
      this.setType(key, 'list')
    }

    // LPUSH adds to the head, last value ends up first
    for (const value of values) {
      list.unshift(value)
    }
    return list.length
  }

  rpush(key: string, values: string[]): number {
    this.checkType(key, 'list')
    const prefixedKey = this.prefixKey(key)
    let list = this.lists.get(prefixedKey)
    if (!list) {
      list = []
      this.lists.set(prefixedKey, list)
      this.setType(key, 'list')
    }

    list.push(...values)
    return list.length
  }

  lpop(key: string, count?: number): string | string[] | null {
    this.checkExpiry(key)
    this.checkType(key, 'list')
    const list = this.lists.get(this.prefixKey(key))
    if (!list || list.length === 0) return count !== undefined ? [] : null

    if (count !== undefined) {
      return list.splice(0, count)
    }
    return list.shift() ?? null
  }

  rpop(key: string, count?: number): string | string[] | null {
    this.checkExpiry(key)
    this.checkType(key, 'list')
    const list = this.lists.get(this.prefixKey(key))
    if (!list || list.length === 0) return count !== undefined ? [] : null

    if (count !== undefined) {
      return list.splice(-count).reverse()
    }
    return list.pop() ?? null
  }

  lrange(key: string, start: number, stop: number): string[] {
    this.checkExpiry(key)
    this.checkType(key, 'list')
    const list = this.lists.get(this.prefixKey(key)) ?? []

    // Handle negative indexes
    const len = list.length
    let startIdx = start < 0 ? len + start : start
    let stopIdx = stop < 0 ? len + stop : stop

    startIdx = Math.max(0, startIdx)
    stopIdx = Math.min(len - 1, stopIdx)

    if (startIdx > stopIdx) return []
    return list.slice(startIdx, stopIdx + 1)
  }

  llen(key: string): number {
    this.checkExpiry(key)
    this.checkType(key, 'list')
    return this.lists.get(this.prefixKey(key))?.length ?? 0
  }

  lindex(key: string, index: number): string | null {
    this.checkExpiry(key)
    this.checkType(key, 'list')
    const list = this.lists.get(this.prefixKey(key))
    if (!list) return null

    const idx = index < 0 ? list.length + index : index
    return list[idx] ?? null
  }

  lset(key: string, index: number, value: string): void {
    this.checkType(key, 'list')
    const list = this.lists.get(this.prefixKey(key))
    if (!list) {
      throw new ReplyError('ERR no such key')
    }

    const idx = index < 0 ? list.length + index : index
    if (idx < 0 || idx >= list.length) {
      throw new ReplyError('ERR index out of range')
    }

    list[idx] = value
  }

  lrem(key: string, count: number, value: string): number {
    this.checkType(key, 'list')
    const list = this.lists.get(this.prefixKey(key))
    if (!list) return 0

    let removed = 0
    const toRemove = Math.abs(count) || list.length

    if (count >= 0) {
      // Remove from head
      for (let i = 0; i < list.length && removed < toRemove; ) {
        if (list[i] === value) {
          list.splice(i, 1)
          removed++
        } else {
          i++
        }
      }
    } else {
      // Remove from tail
      for (let i = list.length - 1; i >= 0 && removed < toRemove; ) {
        if (list[i] === value) {
          list.splice(i, 1)
          removed++
        }
        i--
      }
    }

    return removed
  }

  ltrim(key: string, start: number, stop: number): void {
    this.checkType(key, 'list')
    const list = this.lists.get(this.prefixKey(key))
    if (!list) return

    const len = list.length
    let startIdx = start < 0 ? len + start : start
    let stopIdx = stop < 0 ? len + stop : stop

    startIdx = Math.max(0, startIdx)
    stopIdx = Math.min(len - 1, stopIdx)

    const newList = list.slice(startIdx, stopIdx + 1)
    this.lists.set(this.prefixKey(key), newList)
  }

  linsert(key: string, position: 'BEFORE' | 'AFTER', pivot: string, value: string): number {
    this.checkType(key, 'list')
    const list = this.lists.get(this.prefixKey(key))
    if (!list) return 0

    const idx = list.indexOf(pivot)
    if (idx === -1) return -1

    const insertIdx = position === 'BEFORE' ? idx : idx + 1
    list.splice(insertIdx, 0, value)
    return list.length
  }

  lpos(key: string, value: string): number | null {
    this.checkExpiry(key)
    this.checkType(key, 'list')
    const list = this.lists.get(this.prefixKey(key))
    if (!list) return null

    const idx = list.indexOf(value)
    return idx === -1 ? null : idx
  }

  // ============================================================================
  // SET OPERATIONS
  // ============================================================================

  sadd(key: string, members: string[]): number {
    this.checkType(key, 'set')
    const prefixedKey = this.prefixKey(key)
    let set = this.sets.get(prefixedKey)
    if (!set) {
      set = new Set()
      this.sets.set(prefixedKey, set)
      this.setType(key, 'set')
    }

    let added = 0
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member)
        added++
      }
    }
    return added
  }

  srem(key: string, members: string[]): number {
    this.checkType(key, 'set')
    const set = this.sets.get(this.prefixKey(key))
    if (!set) return 0

    let removed = 0
    for (const member of members) {
      if (set.delete(member)) removed++
    }
    return removed
  }

  smembers(key: string): string[] {
    this.checkExpiry(key)
    this.checkType(key, 'set')
    const set = this.sets.get(this.prefixKey(key))
    return set ? [...set] : []
  }

  sismember(key: string, member: string): number {
    this.checkExpiry(key)
    this.checkType(key, 'set')
    const set = this.sets.get(this.prefixKey(key))
    return set?.has(member) ? 1 : 0
  }

  smismember(key: string, members: string[]): number[] {
    this.checkExpiry(key)
    this.checkType(key, 'set')
    const set = this.sets.get(this.prefixKey(key))
    return members.map((m) => (set?.has(m) ? 1 : 0))
  }

  scard(key: string): number {
    this.checkExpiry(key)
    this.checkType(key, 'set')
    return this.sets.get(this.prefixKey(key))?.size ?? 0
  }

  sinter(keys: string[]): string[] {
    if (keys.length === 0) return []

    const sets = keys.map((k) => {
      this.checkExpiry(k)
      this.checkType(k, 'set')
      return this.sets.get(this.prefixKey(k)) ?? new Set<string>()
    })

    const result = new Set([...sets[0]])
    for (let i = 1; i < sets.length; i++) {
      for (const member of result) {
        if (!sets[i].has(member)) {
          result.delete(member)
        }
      }
    }
    return [...result]
  }

  sunion(keys: string[]): string[] {
    const result = new Set<string>()
    for (const k of keys) {
      this.checkExpiry(k)
      this.checkType(k, 'set')
      const set = this.sets.get(this.prefixKey(k))
      if (set) {
        for (const member of set) {
          result.add(member)
        }
      }
    }
    return [...result]
  }

  sdiff(keys: string[]): string[] {
    if (keys.length === 0) return []

    this.checkExpiry(keys[0])
    this.checkType(keys[0], 'set')
    const firstSet = this.sets.get(this.prefixKey(keys[0])) ?? new Set<string>()
    const result = new Set([...firstSet])

    for (let i = 1; i < keys.length; i++) {
      this.checkExpiry(keys[i])
      this.checkType(keys[i], 'set')
      const set = this.sets.get(this.prefixKey(keys[i]))
      if (set) {
        for (const member of set) {
          result.delete(member)
        }
      }
    }
    return [...result]
  }

  srandmember(key: string, count?: number): string | string[] | null {
    this.checkExpiry(key)
    this.checkType(key, 'set')
    const set = this.sets.get(this.prefixKey(key))
    if (!set || set.size === 0) {
      return count !== undefined ? [] : null
    }

    const members = [...set]
    if (count === undefined) {
      return members[Math.floor(Math.random() * members.length)]
    }

    const result: string[] = []
    const allowDuplicates = count < 0
    const absCount = Math.abs(count)

    if (allowDuplicates) {
      for (let i = 0; i < absCount; i++) {
        result.push(members[Math.floor(Math.random() * members.length)])
      }
    } else {
      const shuffled = [...members].sort(() => Math.random() - 0.5)
      return shuffled.slice(0, Math.min(absCount, members.length))
    }
    return result
  }

  spop(key: string, count?: number): string | string[] | null {
    this.checkType(key, 'set')
    const set = this.sets.get(this.prefixKey(key))
    if (!set || set.size === 0) {
      return count !== undefined ? [] : null
    }

    const members = [...set]
    if (count === undefined) {
      const idx = Math.floor(Math.random() * members.length)
      const member = members[idx]
      set.delete(member)
      return member
    }

    const result: string[] = []
    const shuffled = [...members].sort(() => Math.random() - 0.5)
    for (let i = 0; i < Math.min(count, shuffled.length); i++) {
      result.push(shuffled[i])
      set.delete(shuffled[i])
    }
    return result
  }

  smove(src: string, dst: string, member: string): number {
    this.checkType(src, 'set')
    this.checkType(dst, 'set')

    const srcSet = this.sets.get(this.prefixKey(src))
    if (!srcSet || !srcSet.has(member)) return 0

    srcSet.delete(member)

    let dstSet = this.sets.get(this.prefixKey(dst))
    if (!dstSet) {
      dstSet = new Set()
      this.sets.set(this.prefixKey(dst), dstSet)
      this.setType(dst, 'set')
    }
    dstSet.add(member)
    return 1
  }

  // ============================================================================
  // SORTED SET OPERATIONS
  // ============================================================================

  zadd(key: string, entries: ZSetEntry[], options?: ZAddOptions): number | string {
    this.checkType(key, 'zset')
    const prefixedKey = this.prefixKey(key)
    let zset = this.zsets.get(prefixedKey)
    if (!zset) {
      zset = []
      this.zsets.set(prefixedKey, zset)
      this.setType(key, 'zset')
    }

    let added = 0
    let changed = 0

    for (const entry of entries) {
      const existingIdx = zset.findIndex((e) => e.member === entry.member)

      if (existingIdx === -1) {
        // New member
        if (!options?.XX) {
          zset.push({ ...entry })
          added++
          changed++
        }
      } else {
        // Existing member
        if (!options?.NX) {
          const existing = zset[existingIdx]
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

    if (options?.INCR && entries.length === 1) {
      const entry = zset.find((e) => e.member === entries[0].member)
      return entry ? String(entry.score) : ''
    }

    return options?.CH ? changed : added
  }

  zrem(key: string, members: string[]): number {
    this.checkType(key, 'zset')
    const zset = this.zsets.get(this.prefixKey(key))
    if (!zset) return 0

    let removed = 0
    for (const member of members) {
      const idx = zset.findIndex((e) => e.member === member)
      if (idx !== -1) {
        zset.splice(idx, 1)
        removed++
      }
    }
    return removed
  }

  zrange(key: string, start: number, stop: number, options?: ZRangeOptions): string[] {
    this.checkExpiry(key)
    this.checkType(key, 'zset')
    const zset = this.zsets.get(this.prefixKey(key)) ?? []

    let entries = [...zset]
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

  zrevrange(key: string, start: number, stop: number, withScores?: boolean): string[] {
    return this.zrange(key, start, stop, { REV: true, WITHSCORES: withScores })
  }

  zscore(key: string, member: string): string | null {
    this.checkExpiry(key)
    this.checkType(key, 'zset')
    const zset = this.zsets.get(this.prefixKey(key))
    if (!zset) return null

    const entry = zset.find((e) => e.member === member)
    return entry ? String(entry.score) : null
  }

  zrank(key: string, member: string): number | null {
    this.checkExpiry(key)
    this.checkType(key, 'zset')
    const zset = this.zsets.get(this.prefixKey(key))
    if (!zset) return null

    const idx = zset.findIndex((e) => e.member === member)
    return idx === -1 ? null : idx
  }

  zrevrank(key: string, member: string): number | null {
    this.checkExpiry(key)
    this.checkType(key, 'zset')
    const zset = this.zsets.get(this.prefixKey(key))
    if (!zset) return null

    const idx = zset.findIndex((e) => e.member === member)
    return idx === -1 ? null : zset.length - 1 - idx
  }

  zcard(key: string): number {
    this.checkExpiry(key)
    this.checkType(key, 'zset')
    return this.zsets.get(this.prefixKey(key))?.length ?? 0
  }

  zcount(key: string, min: number | string, max: number | string): number {
    this.checkExpiry(key)
    this.checkType(key, 'zset')
    const zset = this.zsets.get(this.prefixKey(key)) ?? []

    const minScore = min === '-inf' ? -Infinity : Number(min)
    const maxScore = max === '+inf' ? Infinity : Number(max)

    return zset.filter((e) => e.score >= minScore && e.score <= maxScore).length
  }

  zincrby(key: string, increment: number, member: string): string {
    this.checkType(key, 'zset')
    const prefixedKey = this.prefixKey(key)
    let zset = this.zsets.get(prefixedKey)
    if (!zset) {
      zset = []
      this.zsets.set(prefixedKey, zset)
      this.setType(key, 'zset')
    }

    const existingIdx = zset.findIndex((e) => e.member === member)
    let newScore: number

    if (existingIdx === -1) {
      newScore = increment
      zset.push({ member, score: newScore })
    } else {
      newScore = zset[existingIdx].score + increment
      zset[existingIdx].score = newScore
    }

    zset.sort((a, b) => a.score - b.score || a.member.localeCompare(b.member))
    return String(newScore)
  }

  zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    options?: { WITHSCORES?: boolean; LIMIT?: { offset: number; count: number } }
  ): string[] {
    this.checkExpiry(key)
    this.checkType(key, 'zset')
    const zset = this.zsets.get(this.prefixKey(key)) ?? []

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

  zrevrangebyscore(
    key: string,
    max: number | string,
    min: number | string,
    options?: { WITHSCORES?: boolean; LIMIT?: { offset: number; count: number } }
  ): string[] {
    this.checkExpiry(key)
    this.checkType(key, 'zset')
    const zset = this.zsets.get(this.prefixKey(key)) ?? []

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

  zpopmin(key: string, count: number = 1): string[] {
    this.checkType(key, 'zset')
    const zset = this.zsets.get(this.prefixKey(key))
    if (!zset || zset.length === 0) return []

    const popped = zset.splice(0, count)
    const result: string[] = []
    for (const entry of popped) {
      result.push(entry.member, String(entry.score))
    }
    return result
  }

  zpopmax(key: string, count: number = 1): string[] {
    this.checkType(key, 'zset')
    const zset = this.zsets.get(this.prefixKey(key))
    if (!zset || zset.length === 0) return []

    const popped = zset.splice(-count).reverse()
    const result: string[] = []
    for (const entry of popped) {
      result.push(entry.member, String(entry.score))
    }
    return result
  }
}

// ============================================================================
// PIPELINE IMPLEMENTATION
// ============================================================================

interface QueuedCommand {
  method: string
  args: unknown[]
}

class RedisPipeline implements PipelineInterface {
  protected queue: QueuedCommand[] = []
  protected client: Redis

  constructor(client: Redis) {
    this.client = client
  }

  // String commands
  get(key: RedisKey): this {
    this.queue.push({ method: 'get', args: [key] })
    return this
  }

  set(key: RedisKey, value: RedisValue, options?: SetOptions): this {
    this.queue.push({ method: 'set', args: [key, value, options] })
    return this
  }

  mget(...keys: RedisKey[]): this {
    this.queue.push({ method: 'mget', args: keys })
    return this
  }

  mset(...keyValues: (RedisKey | RedisValue)[]): this {
    this.queue.push({ method: 'mset', args: keyValues })
    return this
  }

  incr(key: RedisKey): this {
    this.queue.push({ method: 'incr', args: [key] })
    return this
  }

  decr(key: RedisKey): this {
    this.queue.push({ method: 'decr', args: [key] })
    return this
  }

  incrby(key: RedisKey, increment: number): this {
    this.queue.push({ method: 'incrby', args: [key, increment] })
    return this
  }

  decrby(key: RedisKey, decrement: number): this {
    this.queue.push({ method: 'decrby', args: [key, decrement] })
    return this
  }

  incrbyfloat(key: RedisKey, increment: number): this {
    this.queue.push({ method: 'incrbyfloat', args: [key, increment] })
    return this
  }

  append(key: RedisKey, value: RedisValue): this {
    this.queue.push({ method: 'append', args: [key, value] })
    return this
  }

  strlen(key: RedisKey): this {
    this.queue.push({ method: 'strlen', args: [key] })
    return this
  }

  getrange(key: RedisKey, start: number, end: number): this {
    this.queue.push({ method: 'getrange', args: [key, start, end] })
    return this
  }

  setrange(key: RedisKey, offset: number, value: RedisValue): this {
    this.queue.push({ method: 'setrange', args: [key, offset, value] })
    return this
  }

  setnx(key: RedisKey, value: RedisValue): this {
    this.queue.push({ method: 'setnx', args: [key, value] })
    return this
  }

  setex(key: RedisKey, seconds: number, value: RedisValue): this {
    this.queue.push({ method: 'setex', args: [key, seconds, value] })
    return this
  }

  psetex(key: RedisKey, milliseconds: number, value: RedisValue): this {
    this.queue.push({ method: 'psetex', args: [key, milliseconds, value] })
    return this
  }

  getset(key: RedisKey, value: RedisValue): this {
    this.queue.push({ method: 'getset', args: [key, value] })
    return this
  }

  getdel(key: RedisKey): this {
    this.queue.push({ method: 'getdel', args: [key] })
    return this
  }

  // Hash commands
  hget(key: RedisKey, field: string): this {
    this.queue.push({ method: 'hget', args: [key, field] })
    return this
  }

  hset(key: RedisKey, fieldOrValues: string | Record<string, RedisValue>, value?: RedisValue): this {
    if (typeof fieldOrValues === 'string') {
      this.queue.push({ method: 'hset', args: [key, fieldOrValues, value] })
    } else {
      this.queue.push({ method: 'hset', args: [key, fieldOrValues] })
    }
    return this
  }

  hmget(key: RedisKey, ...fields: string[]): this {
    this.queue.push({ method: 'hmget', args: [key, ...fields] })
    return this
  }

  hmset(key: RedisKey, fieldValues: Record<string, RedisValue>): this {
    this.queue.push({ method: 'hmset', args: [key, fieldValues] })
    return this
  }

  hgetall(key: RedisKey): this {
    this.queue.push({ method: 'hgetall', args: [key] })
    return this
  }

  hdel(key: RedisKey, ...fields: string[]): this {
    this.queue.push({ method: 'hdel', args: [key, ...fields] })
    return this
  }

  hexists(key: RedisKey, field: string): this {
    this.queue.push({ method: 'hexists', args: [key, field] })
    return this
  }

  hkeys(key: RedisKey): this {
    this.queue.push({ method: 'hkeys', args: [key] })
    return this
  }

  hvals(key: RedisKey): this {
    this.queue.push({ method: 'hvals', args: [key] })
    return this
  }

  hlen(key: RedisKey): this {
    this.queue.push({ method: 'hlen', args: [key] })
    return this
  }

  hincrby(key: RedisKey, field: string, increment: number): this {
    this.queue.push({ method: 'hincrby', args: [key, field, increment] })
    return this
  }

  hincrbyfloat(key: RedisKey, field: string, increment: number): this {
    this.queue.push({ method: 'hincrbyfloat', args: [key, field, increment] })
    return this
  }

  hsetnx(key: RedisKey, field: string, value: RedisValue): this {
    this.queue.push({ method: 'hsetnx', args: [key, field, value] })
    return this
  }

  // List commands
  lpush(key: RedisKey, ...values: RedisValue[]): this {
    this.queue.push({ method: 'lpush', args: [key, ...values] })
    return this
  }

  rpush(key: RedisKey, ...values: RedisValue[]): this {
    this.queue.push({ method: 'rpush', args: [key, ...values] })
    return this
  }

  lpop(key: RedisKey, count?: number): this {
    this.queue.push({ method: 'lpop', args: count !== undefined ? [key, count] : [key] })
    return this
  }

  rpop(key: RedisKey, count?: number): this {
    this.queue.push({ method: 'rpop', args: count !== undefined ? [key, count] : [key] })
    return this
  }

  lrange(key: RedisKey, start: number, stop: number): this {
    this.queue.push({ method: 'lrange', args: [key, start, stop] })
    return this
  }

  llen(key: RedisKey): this {
    this.queue.push({ method: 'llen', args: [key] })
    return this
  }

  lindex(key: RedisKey, index: number): this {
    this.queue.push({ method: 'lindex', args: [key, index] })
    return this
  }

  lset(key: RedisKey, index: number, value: RedisValue): this {
    this.queue.push({ method: 'lset', args: [key, index, value] })
    return this
  }

  lrem(key: RedisKey, count: number, value: RedisValue): this {
    this.queue.push({ method: 'lrem', args: [key, count, value] })
    return this
  }

  ltrim(key: RedisKey, start: number, stop: number): this {
    this.queue.push({ method: 'ltrim', args: [key, start, stop] })
    return this
  }

  linsert(key: RedisKey, position: 'BEFORE' | 'AFTER', pivot: RedisValue, value: RedisValue): this {
    this.queue.push({ method: 'linsert', args: [key, position, pivot, value] })
    return this
  }

  lpos(key: RedisKey, value: RedisValue): this {
    this.queue.push({ method: 'lpos', args: [key, value] })
    return this
  }

  // Set commands
  sadd(key: RedisKey, ...members: RedisValue[]): this {
    this.queue.push({ method: 'sadd', args: [key, ...members] })
    return this
  }

  srem(key: RedisKey, ...members: RedisValue[]): this {
    this.queue.push({ method: 'srem', args: [key, ...members] })
    return this
  }

  smembers(key: RedisKey): this {
    this.queue.push({ method: 'smembers', args: [key] })
    return this
  }

  sismember(key: RedisKey, member: RedisValue): this {
    this.queue.push({ method: 'sismember', args: [key, member] })
    return this
  }

  smismember(key: RedisKey, ...members: RedisValue[]): this {
    this.queue.push({ method: 'smismember', args: [key, ...members] })
    return this
  }

  scard(key: RedisKey): this {
    this.queue.push({ method: 'scard', args: [key] })
    return this
  }

  sinter(...keys: RedisKey[]): this {
    this.queue.push({ method: 'sinter', args: keys })
    return this
  }

  sunion(...keys: RedisKey[]): this {
    this.queue.push({ method: 'sunion', args: keys })
    return this
  }

  sdiff(...keys: RedisKey[]): this {
    this.queue.push({ method: 'sdiff', args: keys })
    return this
  }

  sinterstore(destination: RedisKey, ...keys: RedisKey[]): this {
    this.queue.push({ method: 'sinterstore', args: [destination, ...keys] })
    return this
  }

  sunionstore(destination: RedisKey, ...keys: RedisKey[]): this {
    this.queue.push({ method: 'sunionstore', args: [destination, ...keys] })
    return this
  }

  sdiffstore(destination: RedisKey, ...keys: RedisKey[]): this {
    this.queue.push({ method: 'sdiffstore', args: [destination, ...keys] })
    return this
  }

  srandmember(key: RedisKey, count?: number): this {
    this.queue.push({ method: 'srandmember', args: count !== undefined ? [key, count] : [key] })
    return this
  }

  spop(key: RedisKey, count?: number): this {
    this.queue.push({ method: 'spop', args: count !== undefined ? [key, count] : [key] })
    return this
  }

  smove(source: RedisKey, destination: RedisKey, member: RedisValue): this {
    this.queue.push({ method: 'smove', args: [source, destination, member] })
    return this
  }

  // Sorted set commands
  zadd(key: RedisKey, ...args: unknown[]): this {
    this.queue.push({ method: 'zadd', args: [key, ...args] })
    return this
  }

  zrem(key: RedisKey, ...members: RedisValue[]): this {
    this.queue.push({ method: 'zrem', args: [key, ...members] })
    return this
  }

  zrange(key: RedisKey, start: number | string, stop: number | string, options?: ZRangeOptions): this {
    this.queue.push({ method: 'zrange', args: [key, start, stop, options] })
    return this
  }

  zrevrange(key: RedisKey, start: number, stop: number, withScores?: 'WITHSCORES'): this {
    this.queue.push({ method: 'zrevrange', args: [key, start, stop, withScores] })
    return this
  }

  zscore(key: RedisKey, member: RedisValue): this {
    this.queue.push({ method: 'zscore', args: [key, member] })
    return this
  }

  zrank(key: RedisKey, member: RedisValue): this {
    this.queue.push({ method: 'zrank', args: [key, member] })
    return this
  }

  zrevrank(key: RedisKey, member: RedisValue): this {
    this.queue.push({ method: 'zrevrank', args: [key, member] })
    return this
  }

  zcard(key: RedisKey): this {
    this.queue.push({ method: 'zcard', args: [key] })
    return this
  }

  zcount(key: RedisKey, min: number | string, max: number | string): this {
    this.queue.push({ method: 'zcount', args: [key, min, max] })
    return this
  }

  zincrby(key: RedisKey, increment: number, member: RedisValue): this {
    this.queue.push({ method: 'zincrby', args: [key, increment, member] })
    return this
  }

  zrangebyscore(
    key: RedisKey,
    min: number | string,
    max: number | string,
    options?: { WITHSCORES?: boolean; LIMIT?: { offset: number; count: number } }
  ): this {
    this.queue.push({ method: 'zrangebyscore', args: [key, min, max, options] })
    return this
  }

  zrevrangebyscore(
    key: RedisKey,
    max: number | string,
    min: number | string,
    options?: { WITHSCORES?: boolean; LIMIT?: { offset: number; count: number } }
  ): this {
    this.queue.push({ method: 'zrevrangebyscore', args: [key, max, min, options] })
    return this
  }

  zlexcount(key: RedisKey, min: string, max: string): this {
    this.queue.push({ method: 'zlexcount', args: [key, min, max] })
    return this
  }

  zpopmin(key: RedisKey, count?: number): this {
    this.queue.push({ method: 'zpopmin', args: count !== undefined ? [key, count] : [key] })
    return this
  }

  zpopmax(key: RedisKey, count?: number): this {
    this.queue.push({ method: 'zpopmax', args: count !== undefined ? [key, count] : [key] })
    return this
  }

  // Key commands
  del(...keys: RedisKey[]): this {
    this.queue.push({ method: 'del', args: keys })
    return this
  }

  exists(...keys: RedisKey[]): this {
    this.queue.push({ method: 'exists', args: keys })
    return this
  }

  expire(key: RedisKey, seconds: number): this {
    this.queue.push({ method: 'expire', args: [key, seconds] })
    return this
  }

  expireat(key: RedisKey, timestamp: number): this {
    this.queue.push({ method: 'expireat', args: [key, timestamp] })
    return this
  }

  pexpire(key: RedisKey, milliseconds: number): this {
    this.queue.push({ method: 'pexpire', args: [key, milliseconds] })
    return this
  }

  pexpireat(key: RedisKey, timestamp: number): this {
    this.queue.push({ method: 'pexpireat', args: [key, timestamp] })
    return this
  }

  ttl(key: RedisKey): this {
    this.queue.push({ method: 'ttl', args: [key] })
    return this
  }

  pttl(key: RedisKey): this {
    this.queue.push({ method: 'pttl', args: [key] })
    return this
  }

  persist(key: RedisKey): this {
    this.queue.push({ method: 'persist', args: [key] })
    return this
  }

  keys(pattern: string): this {
    this.queue.push({ method: 'keys', args: [pattern] })
    return this
  }

  type(key: RedisKey): this {
    this.queue.push({ method: 'type', args: [key] })
    return this
  }

  rename(key: RedisKey, newKey: RedisKey): this {
    this.queue.push({ method: 'rename', args: [key, newKey] })
    return this
  }

  renamenx(key: RedisKey, newKey: RedisKey): this {
    this.queue.push({ method: 'renamenx', args: [key, newKey] })
    return this
  }

  randomkey(): this {
    this.queue.push({ method: 'randomkey', args: [] })
    return this
  }

  scan(cursor: string | number, options?: { MATCH?: string; COUNT?: number; TYPE?: string }): this {
    this.queue.push({ method: 'scan', args: [cursor, options] })
    return this
  }

  unlink(...keys: RedisKey[]): this {
    this.queue.push({ method: 'unlink', args: keys })
    return this
  }

  copy(source: RedisKey, destination: RedisKey, options?: { REPLACE?: boolean }): this {
    this.queue.push({ method: 'copy', args: [source, destination, options] })
    return this
  }

  // Pub/Sub
  publish(channel: string, message: string): this {
    this.queue.push({ method: 'publish', args: [channel, message] })
    return this
  }

  // Server commands
  ping(message?: string): this {
    this.queue.push({ method: 'ping', args: message ? [message] : [] })
    return this
  }

  echo(message: string): this {
    this.queue.push({ method: 'echo', args: [message] })
    return this
  }

  dbsize(): this {
    this.queue.push({ method: 'dbsize', args: [] })
    return this
  }

  flushdb(mode?: 'ASYNC' | 'SYNC'): this {
    this.queue.push({ method: 'flushdb', args: mode ? [mode] : [] })
    return this
  }

  flushall(mode?: 'ASYNC' | 'SYNC'): this {
    this.queue.push({ method: 'flushall', args: mode ? [mode] : [] })
    return this
  }

  time(): this {
    this.queue.push({ method: 'time', args: [] })
    return this
  }

  info(section?: string): this {
    this.queue.push({ method: 'info', args: section ? [section] : [] })
    return this
  }

  async exec(): Promise<[Error | null, unknown][] | null> {
    const results: [Error | null, unknown][] = []

    for (const cmd of this.queue) {
      try {
        const method = (this.client as unknown as Record<string, Function>)[cmd.method]
        const result = await method.apply(this.client, cmd.args)
        results.push([null, result])
      } catch (err) {
        results.push([err as Error, null])
      }
    }

    this.queue = []
    return results
  }
}

// ============================================================================
// MULTI (TRANSACTION) IMPLEMENTATION
// ============================================================================

class RedisMulti extends RedisPipeline implements MultiInterface {
  private watchedVersions: Map<string, number>
  private aborted = false

  constructor(client: Redis, watchedVersions: Map<string, number>) {
    super(client)
    // Versions are already captured at watch() time and passed in
    this.watchedVersions = watchedVersions
  }

  markAborted(): void {
    this.aborted = true
  }

  async exec(): Promise<[Error | null, unknown][] | null> {
    // Check if any watched keys changed (using version comparison)
    for (const [key, oldVersion] of this.watchedVersions) {
      const currentVersion = this.client['storage'].getVersion(key)
      if (currentVersion !== oldVersion) {
        this.queue = []
        return null
      }
    }

    if (this.aborted) {
      this.queue = []
      return null
    }

    return super.exec()
  }

  async discard(): Promise<'OK'> {
    this.queue = []
    return 'OK'
  }
}

// ============================================================================
// REDIS CLIENT IMPLEMENTATION
// ============================================================================

class Redis implements RedisInterface {
  private storage: RedisStorage
  private _status: ClientStatus = 'ready'
  private _options: RedisOptions
  private eventListeners = new Map<string, Set<Function>>()
  private watchedKeysVersions = new Map<string, number>()

  // Pub/Sub
  private subscriptions = new Set<string>()
  private patternSubscriptions = new Set<string>()
  private static pubSubChannels = new Map<string, Set<Redis>>()
  private static patternChannels = new Map<string, Set<Redis>>()

  /** Reset all static state - ONLY for testing */
  static _resetTestState(): void {
    Redis.pubSubChannels.clear()
    Redis.patternChannels.clear()
  }

  constructor(options?: RedisOptions)
  constructor(port: number, host?: string, options?: RedisOptions)
  constructor(url: string, options?: RedisOptions)
  constructor(
    portOrUrlOrOptions?: number | string | RedisOptions,
    hostOrOptions?: string | RedisOptions,
    options?: RedisOptions
  ) {
    if (typeof portOrUrlOrOptions === 'number') {
      // new Redis(port, host?, options?)
      this._options = {
        port: portOrUrlOrOptions,
        host: typeof hostOrOptions === 'string' ? hostOrOptions : 'localhost',
        ...(typeof hostOrOptions === 'object' ? hostOrOptions : options),
      }
    } else if (typeof portOrUrlOrOptions === 'string') {
      // new Redis(url, options?)
      this._options = {
        url: portOrUrlOrOptions,
        ...(hostOrOptions as RedisOptions),
      }
    } else {
      // new Redis(options?)
      this._options = portOrUrlOrOptions ?? {}
    }

    this.storage = new RedisStorage(this._options.keyPrefix)

    if (this._options.lazyConnect) {
      this._status = 'wait'
    } else {
      this._status = 'ready'
      this.emit('ready')
    }
  }

  get status(): ClientStatus {
    return this._status
  }

  get options(): RedisOptions {
    return this._options
  }

  // ============================================================================
  // STRING COMMANDS
  // ============================================================================

  async get(key: RedisKey): Promise<string | null> {
    return this.storage.getString(keyToString(key))
  }

  async set(
    key: RedisKey,
    value: RedisValue,
    optionsOrToken?: SetOptions | 'EX' | 'PX' | 'NX' | 'XX',
    tokenValue?: number | 'NX' | 'XX'
  ): Promise<'OK' | string | null> {
    let options: SetOptions | undefined

    // Handle token-style arguments
    if (typeof optionsOrToken === 'string') {
      options = {}
      switch (optionsOrToken) {
        case 'EX':
          options.EX = tokenValue as number
          break
        case 'PX':
          options.PX = tokenValue as number
          break
        case 'NX':
          options.NX = true
          break
        case 'XX':
          options.XX = true
          break
      }
    } else {
      options = optionsOrToken
    }

    const result = this.storage.setString(keyToString(key), valueToString(value), options)

    // Notify watchers of key change
    this.notifyWatchers(keyToString(key))

    return result
  }

  async mget(...keys: RedisKey[]): Promise<(string | null)[]> {
    return keys.map((k) => this.storage.getString(keyToString(k)))
  }

  async mset(...args: (RedisKey | RedisValue)[] | [Record<string, RedisValue>]): Promise<'OK'> {
    if (args.length === 1 && typeof args[0] === 'object' && !Buffer.isBuffer(args[0])) {
      // Object form
      const obj = args[0] as Record<string, RedisValue>
      for (const [key, value] of Object.entries(obj)) {
        this.storage.setString(key, valueToString(value))
      }
    } else {
      // Key-value pairs
      for (let i = 0; i < args.length; i += 2) {
        this.storage.setString(keyToString(args[i] as RedisKey), valueToString(args[i + 1] as RedisValue))
      }
    }
    return 'OK'
  }

  async incr(key: RedisKey): Promise<number> {
    const result = this.storage.incrString(keyToString(key), 1)
    this.notifyWatchers(keyToString(key))
    return result
  }

  async decr(key: RedisKey): Promise<number> {
    const result = this.storage.incrString(keyToString(key), -1)
    this.notifyWatchers(keyToString(key))
    return result
  }

  async incrby(key: RedisKey, increment: number): Promise<number> {
    const result = this.storage.incrString(keyToString(key), increment)
    this.notifyWatchers(keyToString(key))
    return result
  }

  async decrby(key: RedisKey, decrement: number): Promise<number> {
    const result = this.storage.incrString(keyToString(key), -decrement)
    this.notifyWatchers(keyToString(key))
    return result
  }

  async incrbyfloat(key: RedisKey, increment: number): Promise<string> {
    const result = this.storage.incrFloatString(keyToString(key), increment)
    this.notifyWatchers(keyToString(key))
    return result
  }

  async append(key: RedisKey, value: RedisValue): Promise<number> {
    const result = this.storage.appendString(keyToString(key), valueToString(value))
    this.notifyWatchers(keyToString(key))
    return result
  }

  async strlen(key: RedisKey): Promise<number> {
    const value = this.storage.getString(keyToString(key))
    return value?.length ?? 0
  }

  async getrange(key: RedisKey, start: number, end: number): Promise<string> {
    const value = this.storage.getString(keyToString(key)) ?? ''
    const len = value.length

    let startIdx = start < 0 ? len + start : start
    let endIdx = end < 0 ? len + end : end

    startIdx = Math.max(0, startIdx)
    endIdx = Math.min(len - 1, endIdx)

    if (startIdx > endIdx) return ''
    return value.substring(startIdx, endIdx + 1)
  }

  async setrange(key: RedisKey, offset: number, value: RedisValue): Promise<number> {
    const keyStr = keyToString(key)
    let current = this.storage.getString(keyStr) ?? ''

    // Pad with null bytes if needed
    while (current.length < offset) {
      current += '\x00'
    }

    const valueStr = valueToString(value)
    const newValue = current.substring(0, offset) + valueStr + current.substring(offset + valueStr.length)
    this.storage.setString(keyStr, newValue)
    this.notifyWatchers(keyStr)
    return newValue.length
  }

  async setnx(key: RedisKey, value: RedisValue): Promise<number> {
    const result = this.storage.setString(keyToString(key), valueToString(value), { NX: true })
    return result === 'OK' ? 1 : 0
  }

  async setex(key: RedisKey, seconds: number, value: RedisValue): Promise<'OK'> {
    this.storage.setString(keyToString(key), valueToString(value), { EX: seconds })
    return 'OK'
  }

  async psetex(key: RedisKey, milliseconds: number, value: RedisValue): Promise<'OK'> {
    this.storage.setString(keyToString(key), valueToString(value), { PX: milliseconds })
    return 'OK'
  }

  async getset(key: RedisKey, value: RedisValue): Promise<string | null> {
    const keyStr = keyToString(key)
    const oldValue = this.storage.getString(keyStr)
    this.storage.setString(keyStr, valueToString(value))
    this.notifyWatchers(keyStr)
    return oldValue
  }

  async getdel(key: RedisKey): Promise<string | null> {
    const keyStr = keyToString(key)
    const value = this.storage.getString(keyStr)
    this.storage.deleteKey(keyStr)
    this.notifyWatchers(keyStr)
    return value
  }

  // ============================================================================
  // HASH COMMANDS
  // ============================================================================

  async hget(key: RedisKey, field: string): Promise<string | null> {
    return this.storage.hget(keyToString(key), field)
  }

  async hset(
    key: RedisKey,
    fieldOrValues: string | Record<string, RedisValue>,
    value?: RedisValue
  ): Promise<number> {
    const keyStr = keyToString(key)
    if (typeof fieldOrValues === 'string') {
      return this.storage.hset(keyStr, { [fieldOrValues]: valueToString(value!) })
    }
    const stringValues: Record<string, string> = {}
    for (const [k, v] of Object.entries(fieldOrValues)) {
      stringValues[k] = valueToString(v)
    }
    return this.storage.hset(keyStr, stringValues)
  }

  async hmget(key: RedisKey, ...fields: string[]): Promise<(string | null)[]> {
    return fields.map((f) => this.storage.hget(keyToString(key), f))
  }

  async hmset(
    key: RedisKey,
    fieldValuesOrField: Record<string, RedisValue> | string,
    ...rest: (string | RedisValue)[]
  ): Promise<'OK'> {
    const keyStr = keyToString(key)
    if (typeof fieldValuesOrField === 'object') {
      const stringValues: Record<string, string> = {}
      for (const [k, v] of Object.entries(fieldValuesOrField)) {
        stringValues[k] = valueToString(v)
      }
      this.storage.hset(keyStr, stringValues)
    } else {
      // Alternating field, value, field, value...
      const stringValues: Record<string, string> = { [fieldValuesOrField]: valueToString(rest[0] as RedisValue) }
      for (let i = 1; i < rest.length; i += 2) {
        stringValues[rest[i] as string] = valueToString(rest[i + 1] as RedisValue)
      }
      this.storage.hset(keyStr, stringValues)
    }
    return 'OK'
  }

  async hgetall(key: RedisKey): Promise<Record<string, string>> {
    return this.storage.hgetall(keyToString(key))
  }

  async hdel(key: RedisKey, ...fields: string[]): Promise<number> {
    return this.storage.hdel(keyToString(key), fields)
  }

  async hexists(key: RedisKey, field: string): Promise<number> {
    return this.storage.hexists(keyToString(key), field)
  }

  async hkeys(key: RedisKey): Promise<string[]> {
    return this.storage.hkeys(keyToString(key))
  }

  async hvals(key: RedisKey): Promise<string[]> {
    return this.storage.hvals(keyToString(key))
  }

  async hlen(key: RedisKey): Promise<number> {
    return this.storage.hlen(keyToString(key))
  }

  async hincrby(key: RedisKey, field: string, increment: number): Promise<number> {
    return this.storage.hincrby(keyToString(key), field, increment)
  }

  async hincrbyfloat(key: RedisKey, field: string, increment: number): Promise<string> {
    return this.storage.hincrbyfloat(keyToString(key), field, increment)
  }

  async hsetnx(key: RedisKey, field: string, value: RedisValue): Promise<number> {
    return this.storage.hsetnx(keyToString(key), field, valueToString(value))
  }

  // ============================================================================
  // LIST COMMANDS
  // ============================================================================

  async lpush(key: RedisKey, ...values: RedisValue[]): Promise<number> {
    return this.storage.lpush(keyToString(key), values.map(valueToString))
  }

  async rpush(key: RedisKey, ...values: RedisValue[]): Promise<number> {
    return this.storage.rpush(keyToString(key), values.map(valueToString))
  }

  lpop(key: RedisKey): Promise<string | null>
  lpop(key: RedisKey, count: number): Promise<string | string[] | null>
  async lpop(key: RedisKey, count?: number): Promise<string | string[] | null> {
    return this.storage.lpop(keyToString(key), count)
  }

  rpop(key: RedisKey): Promise<string | null>
  rpop(key: RedisKey, count: number): Promise<string | string[] | null>
  async rpop(key: RedisKey, count?: number): Promise<string | string[] | null> {
    return this.storage.rpop(keyToString(key), count)
  }

  async lrange(key: RedisKey, start: number, stop: number): Promise<string[]> {
    return this.storage.lrange(keyToString(key), start, stop)
  }

  async llen(key: RedisKey): Promise<number> {
    return this.storage.llen(keyToString(key))
  }

  async lindex(key: RedisKey, index: number): Promise<string | null> {
    return this.storage.lindex(keyToString(key), index)
  }

  async lset(key: RedisKey, index: number, value: RedisValue): Promise<'OK'> {
    this.storage.lset(keyToString(key), index, valueToString(value))
    return 'OK'
  }

  async lrem(key: RedisKey, count: number, value: RedisValue): Promise<number> {
    return this.storage.lrem(keyToString(key), count, valueToString(value))
  }

  async ltrim(key: RedisKey, start: number, stop: number): Promise<'OK'> {
    this.storage.ltrim(keyToString(key), start, stop)
    return 'OK'
  }

  async linsert(
    key: RedisKey,
    position: 'BEFORE' | 'AFTER',
    pivot: RedisValue,
    value: RedisValue
  ): Promise<number> {
    return this.storage.linsert(keyToString(key), position, valueToString(pivot), valueToString(value))
  }

  async lpos(key: RedisKey, value: RedisValue): Promise<number | null> {
    return this.storage.lpos(keyToString(key), valueToString(value))
  }

  // ============================================================================
  // SET COMMANDS
  // ============================================================================

  async sadd(key: RedisKey, ...members: RedisValue[]): Promise<number> {
    return this.storage.sadd(keyToString(key), members.map(valueToString))
  }

  async srem(key: RedisKey, ...members: RedisValue[]): Promise<number> {
    return this.storage.srem(keyToString(key), members.map(valueToString))
  }

  async smembers(key: RedisKey): Promise<string[]> {
    return this.storage.smembers(keyToString(key))
  }

  async sismember(key: RedisKey, member: RedisValue): Promise<number> {
    return this.storage.sismember(keyToString(key), valueToString(member))
  }

  async smismember(key: RedisKey, ...members: RedisValue[]): Promise<number[]> {
    return this.storage.smismember(keyToString(key), members.map(valueToString))
  }

  async scard(key: RedisKey): Promise<number> {
    return this.storage.scard(keyToString(key))
  }

  async sinter(...keys: RedisKey[]): Promise<string[]> {
    return this.storage.sinter(keys.map(keyToString))
  }

  async sunion(...keys: RedisKey[]): Promise<string[]> {
    return this.storage.sunion(keys.map(keyToString))
  }

  async sdiff(...keys: RedisKey[]): Promise<string[]> {
    return this.storage.sdiff(keys.map(keyToString))
  }

  async sinterstore(destination: RedisKey, ...keys: RedisKey[]): Promise<number> {
    const result = this.storage.sinter(keys.map(keyToString))
    this.storage.sadd(keyToString(destination), result)
    return result.length
  }

  async sunionstore(destination: RedisKey, ...keys: RedisKey[]): Promise<number> {
    const result = this.storage.sunion(keys.map(keyToString))
    // Clear destination first
    this.storage.deleteKey(keyToString(destination))
    this.storage.sadd(keyToString(destination), result)
    return result.length
  }

  async sdiffstore(destination: RedisKey, ...keys: RedisKey[]): Promise<number> {
    const result = this.storage.sdiff(keys.map(keyToString))
    this.storage.deleteKey(keyToString(destination))
    this.storage.sadd(keyToString(destination), result)
    return result.length
  }

  srandmember(key: RedisKey): Promise<string | null>
  srandmember(key: RedisKey, count: number): Promise<string | string[] | null>
  async srandmember(key: RedisKey, count?: number): Promise<string | string[] | null> {
    return this.storage.srandmember(keyToString(key), count)
  }

  spop(key: RedisKey): Promise<string | null>
  spop(key: RedisKey, count: number): Promise<string | string[] | null>
  async spop(key: RedisKey, count?: number): Promise<string | string[] | null> {
    return this.storage.spop(keyToString(key), count)
  }

  async smove(source: RedisKey, destination: RedisKey, member: RedisValue): Promise<number> {
    return this.storage.smove(keyToString(source), keyToString(destination), valueToString(member))
  }

  // ============================================================================
  // SORTED SET COMMANDS
  // ============================================================================

  async zadd(key: RedisKey, ...args: unknown[]): Promise<number | string> {
    const keyStr = keyToString(key)
    let options: ZAddOptions | undefined
    let scoreMembers: (number | RedisValue)[] = []

    // Parse arguments
    let i = 0
    if (typeof args[0] === 'object' && args[0] !== null && !Buffer.isBuffer(args[0])) {
      // First arg is options
      options = args[0] as ZAddOptions
      i = 1
    }

    // Rest are score, member pairs
    while (i < args.length) {
      scoreMembers.push(args[i] as number, args[i + 1] as RedisValue)
      i += 2
    }

    // Convert to entries
    const entries: ZSetEntry[] = []
    for (let j = 0; j < scoreMembers.length; j += 2) {
      entries.push({
        score: scoreMembers[j] as number,
        member: valueToString(scoreMembers[j + 1] as RedisValue),
      })
    }

    return this.storage.zadd(keyStr, entries, options)
  }

  async zrem(key: RedisKey, ...members: RedisValue[]): Promise<number> {
    return this.storage.zrem(keyToString(key), members.map(valueToString))
  }

  async zrange(
    key: RedisKey,
    start: number | string,
    stop: number | string,
    optionsOrWithScores?: ZRangeOptions | 'WITHSCORES'
  ): Promise<string[]> {
    const options: ZRangeOptions | undefined =
      optionsOrWithScores === 'WITHSCORES' ? { WITHSCORES: true } : (optionsOrWithScores as ZRangeOptions)

    return this.storage.zrange(keyToString(key), Number(start), Number(stop), options)
  }

  async zrevrange(key: RedisKey, start: number, stop: number, withScores?: 'WITHSCORES'): Promise<string[]> {
    return this.storage.zrevrange(keyToString(key), start, stop, !!withScores)
  }

  async zscore(key: RedisKey, member: RedisValue): Promise<string | null> {
    return this.storage.zscore(keyToString(key), valueToString(member))
  }

  async zrank(key: RedisKey, member: RedisValue): Promise<number | null> {
    return this.storage.zrank(keyToString(key), valueToString(member))
  }

  async zrevrank(key: RedisKey, member: RedisValue): Promise<number | null> {
    return this.storage.zrevrank(keyToString(key), valueToString(member))
  }

  async zcard(key: RedisKey): Promise<number> {
    return this.storage.zcard(keyToString(key))
  }

  async zcount(key: RedisKey, min: number | string, max: number | string): Promise<number> {
    return this.storage.zcount(keyToString(key), min, max)
  }

  async zincrby(key: RedisKey, increment: number, member: RedisValue): Promise<string> {
    return this.storage.zincrby(keyToString(key), increment, valueToString(member))
  }

  async zrangebyscore(
    key: RedisKey,
    min: number | string,
    max: number | string,
    ...args: unknown[]
  ): Promise<string[]> {
    let options: { WITHSCORES?: boolean; LIMIT?: { offset: number; count: number } } | undefined

    // Parse optional args
    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'WITHSCORES') {
        options = options ?? {}
        options.WITHSCORES = true
      } else if (args[i] === 'LIMIT') {
        options = options ?? {}
        options.LIMIT = { offset: args[i + 1] as number, count: args[i + 2] as number }
        i += 2
      }
    }

    return this.storage.zrangebyscore(keyToString(key), min, max, options)
  }

  async zrevrangebyscore(
    key: RedisKey,
    max: number | string,
    min: number | string,
    ...args: unknown[]
  ): Promise<string[]> {
    let options: { WITHSCORES?: boolean; LIMIT?: { offset: number; count: number } } | undefined

    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'WITHSCORES') {
        options = options ?? {}
        options.WITHSCORES = true
      } else if (args[i] === 'LIMIT') {
        options = options ?? {}
        options.LIMIT = { offset: args[i + 1] as number, count: args[i + 2] as number }
        i += 2
      }
    }

    return this.storage.zrevrangebyscore(keyToString(key), max, min, options)
  }

  async zlexcount(key: RedisKey, min: string, max: string): Promise<number> {
    // Simplified - count all members
    return this.storage.zcard(keyToString(key))
  }

  async zpopmin(key: RedisKey, count?: number): Promise<string[]> {
    return this.storage.zpopmin(keyToString(key), count)
  }

  async zpopmax(key: RedisKey, count?: number): Promise<string[]> {
    return this.storage.zpopmax(keyToString(key), count)
  }

  // ============================================================================
  // KEY COMMANDS
  // ============================================================================

  async del(...keys: RedisKey[]): Promise<number> {
    let deleted = 0
    for (const key of keys) {
      if (this.storage.deleteKey(keyToString(key))) deleted++
    }
    return deleted
  }

  async exists(...keys: RedisKey[]): Promise<number> {
    let count = 0
    for (const key of keys) {
      if (this.storage.exists(keyToString(key))) count++
    }
    return count
  }

  async expire(key: RedisKey, seconds: number): Promise<number> {
    return this.storage.setExpiry(keyToString(key), seconds * 1000) ? 1 : 0
  }

  async expireat(key: RedisKey, timestamp: number): Promise<number> {
    return this.storage.setExpiryAt(keyToString(key), timestamp * 1000) ? 1 : 0
  }

  async pexpire(key: RedisKey, milliseconds: number): Promise<number> {
    return this.storage.setExpiry(keyToString(key), milliseconds) ? 1 : 0
  }

  async pexpireat(key: RedisKey, timestamp: number): Promise<number> {
    return this.storage.setExpiryAt(keyToString(key), timestamp) ? 1 : 0
  }

  async ttl(key: RedisKey): Promise<number> {
    const ms = this.storage.getTTL(keyToString(key))
    if (ms === -1 || ms === -2) return ms
    return Math.ceil(ms / 1000)
  }

  async pttl(key: RedisKey): Promise<number> {
    return this.storage.getTTL(keyToString(key))
  }

  async persist(key: RedisKey): Promise<number> {
    return this.storage.persist(keyToString(key)) ? 1 : 0
  }

  async keys(pattern: string): Promise<string[]> {
    return this.storage.keys(pattern)
  }

  async type(key: RedisKey): Promise<string> {
    return this.storage.getType(keyToString(key))
  }

  async rename(key: RedisKey, newKey: RedisKey): Promise<'OK'> {
    this.storage.rename(keyToString(key), keyToString(newKey))
    return 'OK'
  }

  async renamenx(key: RedisKey, newKey: RedisKey): Promise<number> {
    if (this.storage.exists(keyToString(newKey))) return 0
    this.storage.rename(keyToString(key), keyToString(newKey))
    return 1
  }

  async randomkey(): Promise<string | null> {
    const allKeys = this.storage.keys('*')
    if (allKeys.length === 0) return null
    return allKeys[Math.floor(Math.random() * allKeys.length)]
  }

  async scan(
    cursor: string | number,
    options?: { MATCH?: string; COUNT?: number; TYPE?: string }
  ): Promise<ScanResult> {
    const pattern = options?.MATCH ?? '*'
    const count = options?.COUNT ?? 10
    const typeFilter = options?.TYPE

    let allKeys = this.storage.keys(pattern)
    if (typeFilter) {
      allKeys = allKeys.filter((k) => this.storage.getType(k) === typeFilter)
    }

    const startIdx = Number(cursor)
    const endIdx = Math.min(startIdx + count, allKeys.length)
    const keys = allKeys.slice(startIdx, endIdx)
    const nextCursor = endIdx >= allKeys.length ? '0' : String(endIdx)

    return [nextCursor, keys]
  }

  async unlink(...keys: RedisKey[]): Promise<number> {
    return this.del(...keys)
  }

  async copy(source: RedisKey, destination: RedisKey, options?: { REPLACE?: boolean }): Promise<number> {
    return this.storage.copy(keyToString(source), keyToString(destination), options?.REPLACE) ? 1 : 0
  }

  // ============================================================================
  // PUB/SUB COMMANDS
  // ============================================================================

  async publish(channel: string, message: string): Promise<number> {
    let count = 0

    // Direct subscriptions
    const subs = Redis.pubSubChannels.get(channel)
    if (subs) {
      for (const sub of subs) {
        sub.emit('message', channel, message)
        count++
      }
    }

    // Pattern subscriptions
    for (const [pattern, patternSubs] of Redis.patternChannels) {
      if (matchPattern(pattern, channel)) {
        for (const sub of patternSubs) {
          sub.emit('pmessage', pattern, channel, message)
          count++
        }
      }
    }

    return count
  }

  async subscribe(...channels: string[]): Promise<void> {
    for (const channel of channels) {
      this.subscriptions.add(channel)
      let subs = Redis.pubSubChannels.get(channel)
      if (!subs) {
        subs = new Set()
        Redis.pubSubChannels.set(channel, subs)
      }
      subs.add(this)
      this.emit('subscribe', channel, this.subscriptions.size)
    }
  }

  async unsubscribe(...channels: string[]): Promise<void> {
    const toUnsub = channels.length > 0 ? channels : [...this.subscriptions]
    for (const channel of toUnsub) {
      this.subscriptions.delete(channel)
      const subs = Redis.pubSubChannels.get(channel)
      if (subs) {
        subs.delete(this)
        if (subs.size === 0) {
          Redis.pubSubChannels.delete(channel)
        }
      }
      this.emit('unsubscribe', channel, this.subscriptions.size)
    }
  }

  async psubscribe(...patterns: string[]): Promise<void> {
    for (const pattern of patterns) {
      this.patternSubscriptions.add(pattern)
      let subs = Redis.patternChannels.get(pattern)
      if (!subs) {
        subs = new Set()
        Redis.patternChannels.set(pattern, subs)
      }
      subs.add(this)
      this.emit('psubscribe', pattern, this.patternSubscriptions.size)
    }
  }

  async punsubscribe(...patterns: string[]): Promise<void> {
    const toUnsub = patterns.length > 0 ? patterns : [...this.patternSubscriptions]
    for (const pattern of toUnsub) {
      this.patternSubscriptions.delete(pattern)
      const subs = Redis.patternChannels.get(pattern)
      if (subs) {
        subs.delete(this)
        if (subs.size === 0) {
          Redis.patternChannels.delete(pattern)
        }
      }
      this.emit('punsubscribe', pattern, this.patternSubscriptions.size)
    }
  }

  duplicate(): Redis {
    return new Redis(this._options)
  }

  // ============================================================================
  // TRANSACTION COMMANDS
  // ============================================================================

  async watch(...keys: RedisKey[]): Promise<'OK'> {
    for (const key of keys) {
      const keyStr = keyToString(key)
      // Capture version at the time watch is called
      this.watchedKeysVersions.set(keyStr, this.storage.getVersion(keyStr))
    }
    return 'OK'
  }

  async unwatch(): Promise<'OK'> {
    this.watchedKeysVersions.clear()
    return 'OK'
  }

  multi(): MultiInterface {
    const multi = new RedisMulti(this, new Map(this.watchedKeysVersions))
    this.watchedKeysVersions.clear()
    return multi
  }

  pipeline(): PipelineInterface {
    return new RedisPipeline(this)
  }

  private notifyWatchers(key: string): void {
    // Notify any multi transactions watching this key
    // This is handled by storing values at multi creation time
  }

  // ============================================================================
  // SERVER COMMANDS
  // ============================================================================

  async ping(message?: string): Promise<string> {
    return message ?? 'PONG'
  }

  async echo(message: string): Promise<string> {
    return message
  }

  async dbsize(): Promise<number> {
    return this.storage.dbsize()
  }

  async flushdb(_mode?: 'ASYNC' | 'SYNC'): Promise<'OK'> {
    this.storage.flush()
    return 'OK'
  }

  async flushall(_mode?: 'ASYNC' | 'SYNC'): Promise<'OK'> {
    this.storage.flush()
    return 'OK'
  }

  async time(): Promise<[string, string]> {
    const now = Date.now()
    const seconds = Math.floor(now / 1000)
    const microseconds = (now % 1000) * 1000
    return [String(seconds), String(microseconds)]
  }

  async info(_section?: string): Promise<string> {
    return `# Server
redis_version:7.0.0
redis_mode:standalone
os:dotdo

# Clients
connected_clients:1

# Memory
used_memory:${this.storage.dbsize() * 100}

# Stats
total_connections_received:1
total_commands_processed:0

# Keyspace
db0:keys=${this.storage.dbsize()},expires=0
`
  }

  async select(_db: number): Promise<'OK'> {
    // Single database in this implementation
    return 'OK'
  }

  // ============================================================================
  // CONNECTION COMMANDS
  // ============================================================================

  async connect(): Promise<void> {
    if (this._status !== 'wait') return
    this._status = 'connect'
    this.emit('connect')
    this._status = 'ready'
    this.emit('ready')
  }

  async quit(): Promise<'OK'> {
    this._status = 'end'
    this.emit('end')
    await this.unsubscribe()
    await this.punsubscribe()
    return 'OK'
  }

  disconnect(): void {
    this._status = 'end'
    this.emit('end')
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  on<E extends keyof RedisEvents>(event: E, listener: RedisEvents[E]): this {
    let listeners = this.eventListeners.get(event)
    if (!listeners) {
      listeners = new Set()
      this.eventListeners.set(event, listeners)
    }
    listeners.add(listener as Function)
    return this
  }

  once<E extends keyof RedisEvents>(event: E, listener: RedisEvents[E]): this {
    const wrapper = (...args: unknown[]) => {
      this.off(event, wrapper as RedisEvents[E])
      ;(listener as Function)(...args)
    }
    return this.on(event, wrapper as RedisEvents[E])
  }

  off<E extends keyof RedisEvents>(event: E, listener: RedisEvents[E]): this {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.delete(listener as Function)
    }
    return this
  }

  removeAllListeners(event?: keyof RedisEvents): this {
    if (event) {
      this.eventListeners.delete(event)
    } else {
      this.eventListeners.clear()
    }
    return this
  }

  private emit(event: string, ...args: unknown[]): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(...args)
        } catch (e) {
          // Ignore listener errors
        }
      }
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Create a new Redis client
 */
export function createClient(options?: RedisOptions | ExtendedRedisOptions): Redis {
  return new Redis(options)
}

// Export the Redis class for direct instantiation
export { Redis }
