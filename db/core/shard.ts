/**
 * ShardManager - DO-level sharding for the compat layer
 *
 * Handles the 10GB per DO limit by distributing data across multiple DOs:
 * - Consistent hashing: Minimal key redistribution when adding shards
 * - Range sharding: Good for time-series or alphabetical data
 * - Simple hash: Uniform distribution, full redistribution on resize
 *
 * @example
 * ```typescript
 * const manager = new ShardManager(env.DO, {
 *   key: 'tenant_id',
 *   count: 16,
 *   algorithm: 'consistent',
 * })
 *
 * // Route to specific shard
 * const stub = await manager.getShardStub('tenant-123')
 * await stub.fetch('/query', { method: 'POST', body: sql })
 *
 * // Fan out to all shards
 * const results = await manager.queryAll('/query', { body: aggregateSql })
 * ```
 */
import type { ShardConfig } from './types'
import { DEFAULT_SHARD_CONFIG } from './types'

// ============================================================================
// HASHING ALGORITHMS
// ============================================================================

/**
 * FNV-1a hash function for consistent string hashing
 */
function fnv1a(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 16777619) >>> 0
  }
  return hash
}

// ============================================================================
// CACHED CONSISTENT HASH RING
// ============================================================================

/**
 * Cached hash ring for O(log n) lookups after initial build
 * Keyed by (count, virtualNodes) tuple
 */
interface CachedRing {
  hashes: Uint32Array // Sorted hash values
  shards: Uint8Array  // Corresponding shard indices (supports up to 256 shards)
}

/**
 * Ring cache keyed by "count-virtualNodes" string
 */
const ringCache = new Map<string, CachedRing>()

/**
 * Build and cache the consistent hash ring for given config
 * @internal
 */
function getOrBuildRing(count: number, virtualNodes: number): CachedRing {
  const cacheKey = `${count}-${virtualNodes}`

  let cached = ringCache.get(cacheKey)
  if (cached) {
    return cached
  }

  // Build ring of virtual nodes
  const totalNodes = count * virtualNodes
  const nodes: Array<{ hash: number; shard: number }> = []

  for (let shard = 0; shard < count; shard++) {
    for (let vn = 0; vn < virtualNodes; vn++) {
      const hash = fnv1a(`shard-${shard}-vn-${vn}`)
      nodes.push({ hash, shard })
    }
  }

  // Sort by hash value
  nodes.sort((a, b) => a.hash - b.hash)

  // Pack into typed arrays for memory efficiency and fast binary search
  const hashes = new Uint32Array(totalNodes)
  const shards = new Uint8Array(totalNodes)

  for (let i = 0; i < totalNodes; i++) {
    hashes[i] = nodes[i]!.hash
    shards[i] = nodes[i]!.shard
  }

  cached = { hashes, shards }
  ringCache.set(cacheKey, cached)

  return cached
}

/**
 * Binary search for the first hash >= target in sorted array
 * @returns Index of first element >= target, or array length if none found
 */
function binarySearchGe(hashes: Uint32Array, target: number): number {
  let lo = 0
  let hi = hashes.length

  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (hashes[mid]! < target) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }

  return lo
}

/**
 * Consistent hash using virtual nodes for better distribution
 * Minimizes key redistribution when shard count changes
 *
 * Uses cached ring for O(log n) lookup after first call.
 * Ring is built once per (count, virtualNodes) configuration.
 *
 * @param key - The key to hash
 * @param count - Number of shards
 * @param virtualNodes - Virtual nodes per shard (more = better distribution)
 * @returns Shard index [0, count)
 */
export function consistentHash(
  key: string,
  count: number,
  virtualNodes = 150
): number {
  const ring = getOrBuildRing(count, virtualNodes)
  const keyHash = fnv1a(key)

  // Binary search for first node with hash >= keyHash
  const idx = binarySearchGe(ring.hashes, keyHash)

  // Wrap around if keyHash is greater than all nodes
  if (idx >= ring.hashes.length) {
    return ring.shards[0]!
  }

  return ring.shards[idx]!
}

/**
 * Clear the ring cache (useful for testing or config changes)
 * @internal
 */
export function clearRingCache(): void {
  ringCache.clear()
}

/**
 * Range-based hash for ordered data
 * Good for time-series data or alphabetical partitioning
 *
 * @param key - The key (number or string)
 * @param count - Number of shards
 * @param min - Minimum value in range (for numeric keys)
 * @param max - Maximum value in range (for numeric keys)
 * @returns Shard index [0, count)
 */
export function rangeHash(
  key: string | number,
  count: number,
  min = 0,
  max = 1000
): number {
  let value: number

  if (typeof key === 'number') {
    value = key
  } else if (!isNaN(Number(key))) {
    value = Number(key)
  } else {
    // For strings, use first character as value (a=0, z=25, etc.)
    const char = key.toLowerCase().charCodeAt(0)
    value = char - 97 // 'a' = 0
    min = 0
    max = 25
  }

  // Clamp to range
  value = Math.max(min, Math.min(max, value))

  // Calculate shard - divide range evenly across shards
  const range = max - min
  if (range <= 0) return 0

  const shard = Math.floor(((value - min) / range) * count)

  return Math.min(shard, count - 1)
}

/**
 * Simple modulo hash for uniform distribution
 * Full redistribution when shard count changes
 *
 * @param key - The key to hash
 * @param count - Number of shards
 * @returns Shard index [0, count)
 */
export function simpleHash(key: string, count: number): number {
  return fnv1a(key) % count
}

// ============================================================================
// SHARD KEY EXTRACTION
// ============================================================================

/**
 * Extract shard key value from SQL statement
 *
 * Supports:
 * - WHERE tenant_id = 'value'
 * - WHERE tenant_id = ?
 * - WHERE tenant_id = :tenant_id
 * - INSERT INTO ... VALUES (..., 'value', ...)
 * - UPDATE ... WHERE tenant_id = 'value'
 *
 * @param sql - SQL statement
 * @param shardKey - Name of shard key column
 * @param params - Query parameters (array or object)
 * @returns Extracted key value or undefined
 */
export function extractShardKey(
  sql: string,
  shardKey: string,
  params?: unknown[] | Record<string, unknown>
): string | undefined {
  const upperSql = sql.toUpperCase()

  // Check for IN clause - means multiple shards
  const inPattern = new RegExp(`${shardKey}\\s+IN\\s*\\(`, 'i')
  if (inPattern.test(sql)) {
    return undefined
  }

  // Try WHERE clause: field = 'value' or field = value
  const wherePattern = new RegExp(
    `${shardKey}\\s*=\\s*(?:'([^']*)'|"([^"]*)"|(-?\\d+(?:\\.\\d+)?)|\\?)`,
    'i'
  )
  const whereMatch = sql.match(wherePattern)

  if (whereMatch) {
    // String in single quotes
    if (whereMatch[1] !== undefined) {
      return whereMatch[1]
    }
    // String in double quotes
    if (whereMatch[2] !== undefined) {
      return whereMatch[2]
    }
    // Numeric value
    if (whereMatch[3] !== undefined) {
      return whereMatch[3]
    }
    // Parameterized query with ?
    if (whereMatch[0].includes('?') && Array.isArray(params)) {
      // Find which parameter this is
      const questionMarks = sql.slice(0, whereMatch.index).match(/\?/g)
      const paramIndex = questionMarks ? questionMarks.length : 0
      if (params[paramIndex] !== undefined) {
        return String(params[paramIndex])
      }
    }
  }

  // Try named parameter: field = :field
  const namedPattern = new RegExp(`${shardKey}\\s*=\\s*:${shardKey}`, 'i')
  if (namedPattern.test(sql) && params && typeof params === 'object' && !Array.isArray(params)) {
    const value = params[shardKey]
    if (value !== undefined) {
      return String(value)
    }
  }

  // Try INSERT statement
  if (upperSql.startsWith('INSERT')) {
    // Extract column list
    const columnsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i)
    if (columnsMatch) {
      const columns = columnsMatch[1]!.split(',').map((c) => c.trim().toLowerCase())
      const keyIndex = columns.indexOf(shardKey.toLowerCase())

      if (keyIndex >= 0) {
        // Extract values list
        const valuesMatch = sql.match(/VALUES\s*\(([^)]+)\)/i)
        if (valuesMatch) {
          // Parse values (simple implementation)
          const values: string[] = []
          let current = ''
          let inString = false
          let stringChar = ''

          for (const char of valuesMatch[1]!) {
            if (!inString && (char === "'" || char === '"')) {
              inString = true
              stringChar = char
            } else if (inString && char === stringChar) {
              inString = false
            } else if (!inString && char === ',') {
              values.push(current.trim())
              current = ''
              continue
            }
            current += char
          }
          values.push(current.trim())

          if (values[keyIndex]) {
            // Remove quotes
            return values[keyIndex].replace(/^['"]|['"]$/g, '')
          }
        }
      }
    }
  }

  return undefined
}

// ============================================================================
// SHARD MANAGER CLASS
// ============================================================================

/**
 * Result from a sharded query
 */
export interface ShardQueryResult<T = unknown> {
  shard: number
  data?: T
  error?: Error
}

/**
 * ShardManager - Manages and routes requests to appropriate DO shards
 */
export class ShardManager {
  private namespace: DurableObjectNamespace
  private _config: ShardConfig

  constructor(
    namespace: DurableObjectNamespace,
    config?: Partial<ShardConfig>
  ) {
    this.namespace = namespace
    this._config = {
      ...DEFAULT_SHARD_CONFIG,
      ...config,
    }
  }

  /**
   * Get the shard configuration
   */
  get config(): ShardConfig {
    return this._config
  }

  /**
   * Get the number of shards
   */
  get shardCount(): number {
    return this._config.count
  }

  /**
   * Get the shard key field name
   */
  get shardKey(): string {
    return this._config.key
  }

  /**
   * Get shard index for a key value
   */
  getShardId(keyValue: string): number {
    switch (this._config.algorithm) {
      case 'consistent':
        return consistentHash(keyValue, this._config.count)
      case 'range':
        return rangeHash(keyValue, this._config.count)
      case 'hash':
        return simpleHash(keyValue, this._config.count)
      default:
        return consistentHash(keyValue, this._config.count)
    }
  }

  /**
   * Get shard name for an index
   */
  private getShardName(shardId: number): string {
    return `shard-${shardId}`
  }

  /**
   * Get DO stub for a shard key value
   *
   * @param keyValue - The shard key value (e.g., tenant ID)
   * @returns DO stub for the appropriate shard
   */
  async getShardStub(keyValue: string): Promise<DurableObjectStub> {
    const shardId = this.getShardId(keyValue)
    const shardName = this.getShardName(shardId)
    const id = this.namespace.idFromName(shardName)
    return this.namespace.get(id)
  }

  /**
   * Get DO stub by extracting shard key from SQL
   *
   * @param sql - SQL statement
   * @param params - Query parameters
   * @returns DO stub or undefined if no shard key found
   */
  async getShardStubForSql(
    sql: string,
    params?: unknown[] | Record<string, unknown>
  ): Promise<DurableObjectStub | undefined> {
    const keyValue = extractShardKey(sql, this._config.key, params)
    if (!keyValue) {
      return undefined
    }
    return this.getShardStub(keyValue)
  }

  /**
   * Fan out a query to all shards
   *
   * @param path - Request path
   * @param init - Fetch init options
   * @returns Array of results from each shard
   */
  async queryAll<T = unknown>(
    path: string,
    init?: RequestInit
  ): Promise<ShardQueryResult<T>[]> {
    const promises: Promise<ShardQueryResult<T>>[] = []

    for (let shardId = 0; shardId < this._config.count; shardId++) {
      const shardName = this.getShardName(shardId)
      const id = this.namespace.idFromName(shardName)
      const stub = this.namespace.get(id)

      const promise = stub
        .fetch(`http://shard${path}`, init)
        .then(async (response) => {
          const data = await response.json() as T
          return { shard: shardId, data }
        })
        .catch((error) => ({
          shard: shardId,
          error: error instanceof Error ? error : new Error(String(error)),
        }))

      promises.push(promise)
    }

    return Promise.all(promises)
  }

  /**
   * Get all shard stubs
   */
  getAllShardStubs(): DurableObjectStub[] {
    const stubs: DurableObjectStub[] = []
    for (let shardId = 0; shardId < this._config.count; shardId++) {
      const shardName = this.getShardName(shardId)
      const id = this.namespace.idFromName(shardName)
      stubs.push(this.namespace.get(id))
    }
    return stubs
  }
}
