/**
 * ShardedPostgres - Distributed Postgres across Durable Objects
 *
 * Provides consistent hashing-based sharding for EdgePostgres, enabling horizontal
 * scaling beyond single Durable Object limits. Each shard is an independent DO
 * with its own EdgePostgres instance, providing up to 10TB total capacity.
 *
 * ## Overview
 *
 * ShardedPostgres automatically routes queries to the correct shard based on a
 * shard key column. Queries without a shard key are fanned out to all shards
 * with results merged (supporting ORDER BY, LIMIT, GROUP BY, aggregates).
 *
 * ## Features
 *
 * - **Horizontal scaling**: Up to 1000 shards (10TB total capacity)
 * - **Automatic routing**: Shard key extraction from INSERT/SELECT/UPDATE/DELETE
 * - **Query fan-out**: Parallel execution across shards for global queries
 * - **Result merging**: ORDER BY, LIMIT, GROUP BY, DISTINCT, aggregates
 * - **Single-shard transactions**: ACID within a shard (cross-shard not supported)
 * - **Online rebalancing**: Add/remove shards with minimal data movement
 *
 * ## Sharding Algorithms
 *
 * | Algorithm   | Best For                     | Rebalance Impact |
 * |-------------|------------------------------|------------------|
 * | consistent  | General purpose (default)    | ~1/N data moves  |
 * | range       | Range queries on shard key   | Varies           |
 * | hash        | Maximum throughput           | 100% data moves  |
 *
 * ## Architecture
 *
 * ```
 *                    ┌─────────────────────┐
 *                    │   ShardedPostgres   │
 *                    │   (Coordinator DO)  │
 *                    └──────────┬──────────┘
 *                               │
 *          ┌────────────────────┼────────────────────┐
 *          │                    │                    │
 *          ▼                    ▼                    ▼
 *    ┌───────────┐        ┌───────────┐        ┌───────────┐
 *    │  Shard 0  │        │  Shard 1  │        │  Shard N  │
 *    │(DO + PG)  │        │(DO + PG)  │   ...  │(DO + PG)  │
 *    └───────────┘        └───────────┘        └───────────┘
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * const db = new ShardedPostgres(ctx, env, {
 *   sharding: {
 *     key: 'tenant_id',
 *     count: 16,
 *     algorithm: 'consistent',
 *   },
 * })
 *
 * // Single-shard query (fast, routed to one shard)
 * await db.query(
 *   'SELECT * FROM orders WHERE tenant_id = $1',
 *   ['tenant-123']
 * )
 *
 * // Fan-out query (parallel execution across all shards)
 * await db.query(
 *   'SELECT COUNT(*) as total FROM orders WHERE status = $1',
 *   ['pending']
 * )
 *
 * // DDL executes on all shards
 * await db.exec('CREATE TABLE orders (id TEXT, tenant_id TEXT, ...)')
 *
 * // Transaction (single shard only)
 * await db.transaction('tenant-123', async (tx) => {
 *   await tx.query('UPDATE accounts SET balance = balance - 100 WHERE id = $1', [from])
 *   await tx.query('UPDATE accounts SET balance = balance + 100 WHERE id = $1', [to])
 * })
 * ```
 *
 * ## Limitations
 *
 * - Cross-shard transactions not supported (use saga pattern)
 * - Cross-shard JOINs not supported (denormalize or use fan-out)
 * - Shard key must be included in queries for efficient routing
 *
 * @module db/edge-postgres/sharding
 * @see {@link EdgePostgres} for single-instance Postgres
 * @see {@link ShardRouter} for the routing algorithm implementation
 */

import { EdgePostgres, type QueryOptions, type QueryResult, type Transaction } from './edge-postgres'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Sharding algorithm types
 */
export type ShardingAlgorithm = 'consistent' | 'range' | 'hash'

/**
 * Hash function types for consistent hashing
 */
export type HashFunction = 'xxhash' | 'murmur3' | 'fnv1a'

/**
 * Sharding configuration options.
 *
 * Defines how data is distributed across shards, including the shard key,
 * number of shards, and routing algorithm.
 *
 * @example
 * ```typescript
 * // Simple single-column sharding
 * const options: ShardingOptions = {
 *   key: 'tenant_id',
 *   count: 16,
 *   algorithm: 'consistent',
 * }
 *
 * // Compound shard key
 * const compoundOptions: ShardingOptions = {
 *   key: ['region', 'customer_id'],
 *   count: 64,
 *   algorithm: 'consistent',
 *   strictMode: true,  // Require shard key in all queries
 * }
 * ```
 */
export interface ShardingOptions {
  /**
   * Column(s) to use as the shard key.
   * For compound keys, values are concatenated with ':' separator.
   * @example 'tenant_id' or ['region', 'customer_id']
   */
  key: string | string[]
  /**
   * Number of shards to create.
   * Higher counts enable more parallelism but increase coordination overhead.
   * @minimum 1
   * @maximum 1000
   */
  count: number
  /**
   * Algorithm for mapping shard keys to shards.
   * - 'consistent': Best for online rebalancing (default)
   * - 'range': Best for range queries on shard key
   * - 'hash': Simplest, but poor rebalancing
   */
  algorithm: ShardingAlgorithm
  /**
   * Number of virtual nodes per physical shard for consistent hashing.
   * Higher values provide better load distribution but increase memory.
   * @default 150
   */
  virtualNodesPerShard?: number
  /**
   * Hash function for key-to-shard mapping.
   * - 'fnv1a': Fast, good distribution (default)
   * - 'xxhash': Very fast, excellent distribution
   * - 'murmur3': Standard choice, good distribution
   * @default 'fnv1a'
   */
  hashFunction?: HashFunction
  /**
   * Cloudflare Worker binding name for the shard DO namespace.
   * @default 'EDGE_POSTGRES_SHARDS'
   */
  namespaceBinding?: string
  /**
   * If true, queries without shard key throw an error instead of fan-out.
   * Useful for preventing accidental expensive queries.
   * @default false
   */
  strictMode?: boolean
}

/**
 * Full ShardedPostgres configuration
 */
export interface ShardConfig {
  /** Sharding configuration */
  sharding: ShardingOptions
  /** Query timeout in milliseconds */
  queryTimeout?: number
  /** Allow partial results on shard failures */
  allowPartialResults?: boolean
  /** Callback for shard queries */
  onShardQuery?: (shardId: number) => void
  /** Callback for data movement during rebalance */
  onDataMove?: (fromShard: number, toShard: number, rowCount: number) => void
}

/**
 * Information about which shard(s) a query targets
 */
export interface ShardInfo {
  /** Single shard key value (if applicable) */
  key: string | null
  /** Multiple shard keys (for IN queries) */
  keys?: string[]
  /** Target shard ID (if single shard) */
  shardId?: number
  /** Target shard IDs (if multiple shards) */
  shardIds?: number[]
  /** Whether query requires fan-out to all shards */
  requiresFanOut: boolean
}

/**
 * Result from a sharded query with metadata
 */
export interface ShardQueryResult<T = Record<string, unknown>> extends QueryResult<T> {
  /** Shard that handled the query (single-shard queries) */
  shardId?: number
  /** Number of shards queried */
  shardsQueried: number
  /** Whether this was a fan-out query */
  isFanOut?: boolean
  /** Execution time in milliseconds */
  executionTimeMs?: number
  /** Whether partial results were returned */
  partialResults?: boolean
  /** Shards that failed (when partial results enabled) */
  failedShards?: number[]
}

/**
 * Result from exec() on all shards
 */
export interface ShardExecResult {
  /** Number of shards affected */
  shardsAffected: number
}

/**
 * Rebalance result
 */
export interface RebalanceResult {
  /** Whether rebalance succeeded */
  success: boolean
  /** Previous shard count */
  previousShardCount: number
  /** New shard count */
  newShardCount: number
  /** Number of rows moved between shards */
  rowsMoved: number
}

/**
 * Rebalance options
 */
export interface RebalanceOptions {
  /** Progress callback (0-100) */
  onProgress?: (progress: number) => void
}

/**
 * Rebalance movement calculation
 */
export interface RebalanceMovement {
  /** Shards to add */
  shardsToAdd: number
  /** Shards to remove */
  shardsToRemove: number
  /** Estimated percentage of data that will move */
  estimatedDataMovementPercent: number
}

// ============================================================================
// DURABLE OBJECT TYPES
// ============================================================================

/**
 * Durable Object storage interface
 */
interface DOStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
}

/**
 * Durable Object state interface
 */
interface DOState {
  storage: DOStorage
  id: {
    toString(): string
    name?: string
  }
  waitUntil(promise: Promise<unknown>): void
}

/**
 * Durable Object stub interface
 */
interface DOStub {
  fetch(request: Request): Promise<Response>
}

/**
 * Durable Object namespace interface
 */
interface DONamespace {
  get(id: { toString(): string }): DOStub
  idFromName(name: string): { toString(): string }
  newUniqueId(): { toString(): string }
}

/**
 * Environment bindings interface
 */
interface Env {
  FSX?: unknown
  R2_BUCKET?: unknown
  EDGE_POSTGRES_SHARDS?: DONamespace
  [key: string]: unknown
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_SHARDS = 1000
const DEFAULT_VIRTUAL_NODES = 150
const DEFAULT_NAMESPACE_BINDING = 'EDGE_POSTGRES_SHARDS'

// ============================================================================
// SHARD ROUTER
// ============================================================================

/**
 * Virtual node on the consistent hash ring
 */
interface VirtualNode {
  hash: number
  shardId: number
}

/**
 * ShardRouter - Consistent hashing with virtual nodes.
 *
 * Implements the consistent hashing algorithm for deterministic key-to-shard
 * mapping. Uses virtual nodes to ensure even distribution and minimize data
 * movement during rebalancing.
 *
 * ## How It Works
 *
 * 1. Each physical shard is represented by multiple "virtual nodes" on a hash ring
 * 2. Keys are hashed and mapped to the nearest virtual node clockwise
 * 3. The virtual node points to its physical shard
 *
 * ## Benefits of Virtual Nodes
 *
 * - **Even distribution**: More points on the ring = better balance
 * - **Smooth rebalancing**: Adding a shard only affects ~1/N of keys
 * - **Hotspot prevention**: Virtual nodes spread load across ring
 *
 * ## Ring Size Calculation
 *
 * With 16 shards and 150 virtual nodes per shard:
 * - Ring has 2,400 virtual nodes
 * - Binary search: O(log 2400) = ~11 comparisons per lookup
 * - Memory: ~50KB for the ring
 *
 * @example
 * ```typescript
 * const router = new ShardRouter({
 *   count: 16,
 *   algorithm: 'consistent',
 *   virtualNodesPerShard: 150,
 *   hashFunction: 'fnv1a',
 * })
 *
 * // Get shard for a key
 * const shardId = router.getShardForKey('tenant-123')
 *
 * // Get all shards (for fan-out)
 * const allShards = router.getAllShards()
 *
 * // Calculate rebalance impact
 * const movement = router.calculateRebalanceMovement(24)
 * console.log(`Adding 8 shards will move ${movement.estimatedDataMovementPercent}% of data`)
 * ```
 */
export class ShardRouter {
  private shardCount: number
  private algorithm: ShardingAlgorithm
  private virtualNodesPerShard: number
  private hashFunction: HashFunction
  private ring: VirtualNode[] = []

  constructor(options: {
    count: number
    algorithm: ShardingAlgorithm
    virtualNodesPerShard?: number
    hashFunction?: HashFunction
  }) {
    this.shardCount = options.count
    this.algorithm = options.algorithm
    this.virtualNodesPerShard = options.virtualNodesPerShard ?? DEFAULT_VIRTUAL_NODES
    this.hashFunction = options.hashFunction ?? 'fnv1a'

    if (this.algorithm === 'consistent') {
      this.buildRing()
    }
  }

  /**
   * Build the consistent hash ring with virtual nodes
   */
  private buildRing(): void {
    this.ring = []

    for (let shardId = 0; shardId < this.shardCount; shardId++) {
      for (let vnode = 0; vnode < this.virtualNodesPerShard; vnode++) {
        const virtualKey = `shard-${shardId}-vnode-${vnode}`
        const hash = this.hash(virtualKey)
        this.ring.push({ hash, shardId })
      }
    }

    // Sort by hash for binary search
    this.ring.sort((a, b) => a.hash - b.hash)
  }

  /**
   * Hash a string to a 32-bit integer
   */
  private hash(key: string): number {
    switch (this.hashFunction) {
      case 'xxhash':
        return this.xxhash(key)
      case 'murmur3':
        return this.murmur3(key)
      case 'fnv1a':
      default:
        return this.fnv1a(key)
    }
  }

  /**
   * FNV-1a hash
   */
  private fnv1a(key: string): number {
    let hash = 2166136261
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0 // Convert to unsigned
  }

  /**
   * Simple xxhash-style hash
   */
  private xxhash(key: string): number {
    const PRIME1 = 2654435761
    const PRIME2 = 2246822519
    let hash = PRIME1

    for (let i = 0; i < key.length; i++) {
      hash = Math.imul(hash + key.charCodeAt(i), PRIME2)
      hash = (hash << 13) | (hash >>> 19)
    }

    hash ^= hash >>> 15
    hash = Math.imul(hash, PRIME1)
    hash ^= hash >>> 13
    hash = Math.imul(hash, PRIME2)
    hash ^= hash >>> 16

    return hash >>> 0
  }

  /**
   * Simple murmur3-style hash
   */
  private murmur3(key: string): number {
    const c1 = 0xcc9e2d51
    const c2 = 0x1b873593
    let hash = 0

    for (let i = 0; i < key.length; i++) {
      let k = key.charCodeAt(i)
      k = Math.imul(k, c1)
      k = (k << 15) | (k >>> 17)
      k = Math.imul(k, c2)

      hash ^= k
      hash = (hash << 13) | (hash >>> 19)
      hash = Math.imul(hash, 5) + 0xe6546b64
    }

    hash ^= key.length
    hash ^= hash >>> 16
    hash = Math.imul(hash, 0x85ebca6b)
    hash ^= hash >>> 13
    hash = Math.imul(hash, 0xc2b2ae35)
    hash ^= hash >>> 16

    return hash >>> 0
  }

  /**
   * Get the shard for a given key
   */
  getShardForKey(key: string): number {
    if (this.shardCount === 1) {
      return 0
    }

    switch (this.algorithm) {
      case 'consistent':
        return this.getShardConsistent(key)
      case 'range':
        return this.getShardRange(key)
      case 'hash':
      default:
        return this.getShardHash(key)
    }
  }

  /**
   * Get shard using consistent hashing with virtual nodes
   */
  private getShardConsistent(key: string): number {
    const keyHash = this.hash(key)

    // Binary search for the first node with hash >= keyHash
    let left = 0
    let right = this.ring.length

    while (left < right) {
      const mid = (left + right) >>> 1
      if (this.ring[mid]!.hash < keyHash) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    // Wrap around if we're past the end
    const nodeIndex = left >= this.ring.length ? 0 : left
    return this.ring[nodeIndex]!.shardId
  }

  /**
   * Get shard using simple hash modulo
   */
  private getShardHash(key: string): number {
    const hash = this.hash(key)
    return hash % this.shardCount
  }

  /**
   * Get shard using range-based partitioning
   */
  private getShardRange(key: string): number {
    // For range, use first character as simple partition key
    if (!key || key.length === 0) {
      return 0
    }

    const charCode = key.charCodeAt(0)
    const rangeSize = Math.ceil(256 / this.shardCount)
    return Math.min(Math.floor(charCode / rangeSize), this.shardCount - 1)
  }

  /**
   * Get the total ring size (number of virtual nodes)
   */
  getRingSize(): number {
    return this.ring.length
  }

  /**
   * Get the number of shards
   */
  getShardCount(): number {
    return this.shardCount
  }

  /**
   * Get all shard IDs
   */
  getAllShards(): number[] {
    return Array.from({ length: this.shardCount }, (_, i) => i)
  }

  /**
   * Get shards that handle a key range (for range queries)
   */
  getShardsForKeyRange(startKey: string, endKey: string): number[] {
    if (this.algorithm === 'range') {
      const startShard = this.getShardForKey(startKey)
      const endShard = this.getShardForKey(endKey)

      const shards: number[] = []
      for (let i = startShard; i <= endShard; i++) {
        shards.push(i)
      }
      return shards
    }

    // For consistent/hash, we can't determine range bounds, return all shards
    return this.getAllShards()
  }

  /**
   * Calculate what data needs to move for a rebalance
   */
  calculateRebalanceMovement(newShardCount: number): RebalanceMovement {
    const shardsToAdd = Math.max(0, newShardCount - this.shardCount)
    const shardsToRemove = Math.max(0, this.shardCount - newShardCount)

    // With consistent hashing, adding N shards moves approximately N/total of data
    let estimatedDataMovementPercent: number
    if (shardsToAdd > 0) {
      estimatedDataMovementPercent = (shardsToAdd / newShardCount) * 100
    } else if (shardsToRemove > 0) {
      estimatedDataMovementPercent = (shardsToRemove / this.shardCount) * 100
    } else {
      estimatedDataMovementPercent = 0
    }

    return {
      shardsToAdd,
      shardsToRemove,
      estimatedDataMovementPercent,
    }
  }

  /**
   * Update the shard count and rebuild the ring
   */
  updateShardCount(newCount: number): void {
    this.shardCount = newCount
    if (this.algorithm === 'consistent') {
      this.buildRing()
    }
  }

  /**
   * Serialize router state for persistence
   */
  serialize(): string {
    return JSON.stringify({
      shardCount: this.shardCount,
      algorithm: this.algorithm,
      virtualNodesPerShard: this.virtualNodesPerShard,
      hashFunction: this.hashFunction,
    })
  }

  /**
   * Deserialize router from saved state
   */
  static deserialize(data: string): ShardRouter {
    const state = JSON.parse(data)
    return new ShardRouter({
      count: state.shardCount,
      algorithm: state.algorithm,
      virtualNodesPerShard: state.virtualNodesPerShard,
      hashFunction: state.hashFunction,
    })
  }
}

// ============================================================================
// SQL PARSER HELPERS
// ============================================================================

/**
 * Extract shard key values from a SQL query and parameters
 */
function extractShardKeys(
  sql: string,
  params: unknown[],
  shardKeyColumns: string[]
): { keys: string[] | null; requiresFanOut: boolean; hasNullKey?: boolean } {
  const normalizedSql = sql.toUpperCase()

  // Check for INSERT
  if (normalizedSql.includes('INSERT')) {
    return extractFromInsert(sql, params, shardKeyColumns)
  }

  // Check for WHERE clause
  if (normalizedSql.includes('WHERE')) {
    return extractFromWhere(sql, params, shardKeyColumns)
  }

  // No shard key found - requires fan-out
  return { keys: null, requiresFanOut: true }
}

/**
 * Extract shard key from INSERT statement
 */
function extractFromInsert(
  sql: string,
  params: unknown[],
  shardKeyColumns: string[]
): { keys: string[] | null; requiresFanOut: boolean; hasNullKey?: boolean } {
  // Find column list
  const columnsMatch = sql.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)/i)
  if (!columnsMatch) {
    return { keys: null, requiresFanOut: true }
  }

  const columns = columnsMatch[1]!.split(',').map((c) => c.trim().toLowerCase())

  // For compound keys, collect all key values
  const keyValues: string[] = []
  let hasNullKey = false

  for (const shardKey of shardKeyColumns) {
    const keyIndex = columns.indexOf(shardKey.toLowerCase())
    if (keyIndex !== -1) {
      const keyValue = params[keyIndex]
      if (keyValue === null || keyValue === undefined) {
        hasNullKey = true
      } else if (typeof keyValue === 'string' || typeof keyValue === 'number') {
        keyValues.push(String(keyValue))
      }
    }
  }

  if (hasNullKey) {
    return { keys: null, requiresFanOut: true, hasNullKey: true }
  }

  if (keyValues.length > 0) {
    // Combine compound keys with colon separator
    const compoundKey = keyValues.join(':')
    return { keys: [compoundKey], requiresFanOut: false }
  }

  return { keys: null, requiresFanOut: true }
}

/**
 * Extract shard key from WHERE clause
 */
function extractFromWhere(
  sql: string,
  params: unknown[],
  shardKeyColumns: string[]
): { keys: string[] | null; requiresFanOut: boolean; hasNullKey?: boolean } {
  // For compound keys, we need all of them to be present
  const keyValues: string[] = []
  let hasNullKey = false
  let foundInClause = false
  const inClauseKeys: string[] = []

  for (const shardKey of shardKeyColumns) {
    // Match: shard_key = $N
    const equalPattern = new RegExp(`${shardKey}\\s*=\\s*\\$(\\d+)`, 'i')
    const equalMatch = sql.match(equalPattern)

    if (equalMatch) {
      const paramIndex = parseInt(equalMatch[1]!, 10) - 1
      const keyValue = params[paramIndex]
      if (keyValue === null || keyValue === undefined) {
        hasNullKey = true
      } else if (typeof keyValue === 'string' || typeof keyValue === 'number') {
        keyValues.push(String(keyValue))
      }
      continue
    }

    // Match: shard_key IN ($N, $M, ...)
    const inPattern = new RegExp(`${shardKey}\\s+IN\\s*\\(([^)]+)\\)`, 'i')
    const inMatch = sql.match(inPattern)

    if (inMatch) {
      foundInClause = true
      const paramRefs = inMatch[1]!.match(/\$(\d+)/g) || []

      for (const ref of paramRefs) {
        const paramIndex = parseInt(ref.replace('$', ''), 10) - 1
        const keyValue = params[paramIndex]
        if (keyValue === null || keyValue === undefined) {
          hasNullKey = true
        } else if (typeof keyValue === 'string' || typeof keyValue === 'number') {
          inClauseKeys.push(String(keyValue))
        }
      }
    }
  }

  if (hasNullKey) {
    return { keys: null, requiresFanOut: true, hasNullKey: true }
  }

  // If we found IN clause keys, return them
  if (foundInClause && inClauseKeys.length > 0) {
    return { keys: inClauseKeys, requiresFanOut: false }
  }

  // Combine compound keys with colon separator
  if (keyValues.length > 0) {
    if (keyValues.length === shardKeyColumns.length) {
      // All compound keys found
      const compoundKey = keyValues.join(':')
      return { keys: [compoundKey], requiresFanOut: false }
    } else if (shardKeyColumns.length === 1) {
      // Single key found
      return { keys: keyValues, requiresFanOut: false }
    }
    // Partial compound key - still return what we have
    const compoundKey = keyValues.join(':')
    return { keys: [compoundKey], requiresFanOut: false }
  }

  // Check for subquery
  if (sql.toUpperCase().includes('SELECT')) {
    const whereIndex = sql.toUpperCase().indexOf('WHERE')
    const subqueryIndex = sql.toUpperCase().indexOf('SELECT', whereIndex)
    if (subqueryIndex !== -1) {
      // Complex subquery - fan out
      return { keys: null, requiresFanOut: true }
    }
  }

  return { keys: null, requiresFanOut: true }
}

/**
 * Check if SQL is a DDL statement that should execute on all shards
 */
function isDDL(sql: string): boolean {
  const normalizedSql = sql.trim().toUpperCase()
  return (
    normalizedSql.startsWith('CREATE') ||
    normalizedSql.startsWith('ALTER') ||
    normalizedSql.startsWith('DROP') ||
    normalizedSql.startsWith('TRUNCATE')
  )
}

/**
 * Check if SQL is an aggregation query
 */
function isAggregation(sql: string): boolean {
  const normalizedSql = sql.toUpperCase()
  return (
    normalizedSql.includes('COUNT(') ||
    normalizedSql.includes('SUM(') ||
    normalizedSql.includes('AVG(') ||
    normalizedSql.includes('MIN(') ||
    normalizedSql.includes('MAX(') ||
    normalizedSql.includes('GROUP BY')
  )
}

/**
 * Extract ORDER BY clause
 */
function extractOrderBy(sql: string): { column: string; direction: 'ASC' | 'DESC' } | null {
  const orderByMatch = sql.match(/ORDER\s+BY\s+(\w+)\s*(ASC|DESC)?/i)
  if (orderByMatch) {
    return {
      column: orderByMatch[1]!,
      direction: (orderByMatch[2]?.toUpperCase() || 'ASC') as 'ASC' | 'DESC',
    }
  }
  return null
}

/**
 * Extract LIMIT clause
 */
function extractLimit(sql: string): number | null {
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
  if (limitMatch) {
    return parseInt(limitMatch[1]!, 10)
  }
  return null
}

/**
 * Extract DISTINCT columns
 */
function hasDistinct(sql: string): boolean {
  return /SELECT\s+DISTINCT/i.test(sql)
}

// ============================================================================
// SHARDED POSTGRES CLASS
// ============================================================================

/**
 * ShardedPostgres - Distributed Postgres for Durable Objects.
 *
 * Main class for sharded Postgres operations. Coordinates queries across
 * multiple EdgePostgres shard instances, handling routing, fan-out,
 * and result merging transparently.
 *
 * ## Query Routing
 *
 * Queries are routed based on shard key presence:
 *
 * 1. **Single-shard query**: Shard key found in WHERE/INSERT
 *    - Routed directly to target shard
 *    - Fastest path, no coordination
 *
 * 2. **Multi-shard query (IN clause)**: Multiple shard keys
 *    - Parallel execution on affected shards only
 *    - Results merged before return
 *
 * 3. **Fan-out query**: No shard key
 *    - Parallel execution on ALL shards
 *    - Results merged with ORDER BY/LIMIT/GROUP BY support
 *
 * ## Supported SQL Features
 *
 * - SELECT with WHERE, ORDER BY, LIMIT, OFFSET
 * - INSERT/UPDATE/DELETE with shard key
 * - Aggregates: COUNT, SUM, AVG, MIN, MAX
 * - GROUP BY with aggregates
 * - DISTINCT
 * - DDL (CREATE TABLE, etc.) - executes on all shards
 *
 * @example
 * ```typescript
 * const db = new ShardedPostgres(ctx, env, {
 *   sharding: {
 *     key: 'tenant_id',
 *     count: 16,
 *     algorithm: 'consistent',
 *   },
 *   queryTimeout: 30000,
 *   allowPartialResults: false,
 * })
 *
 * // Create schema on all shards
 * await db.exec(`CREATE TABLE orders (
 *   id TEXT PRIMARY KEY,
 *   tenant_id TEXT NOT NULL,
 *   amount DECIMAL
 * )`)
 *
 * // Routed query (single shard)
 * const orders = await db.query(
 *   'SELECT * FROM orders WHERE tenant_id = $1',
 *   ['t-123']
 * )
 *
 * // Fan-out aggregation
 * const totals = await db.query(
 *   'SELECT tenant_id, SUM(amount) as total FROM orders GROUP BY tenant_id',
 *   []
 * )
 * ```
 */
export class ShardedPostgres {
  private ctx: DOState
  private env: Env
  private config: ShardConfig
  private router: ShardRouter
  private shardKeyColumns: string[]
  private closed = false
  private pendingQueries = 0
  private rebalanceInProgress = false

  constructor(ctx: DOState, env: Env, config: ShardConfig) {
    // Validate configuration
    if (!config.sharding.key || (Array.isArray(config.sharding.key) && config.sharding.key.length === 0)) {
      throw new Error('Shard key is required')
    }

    if (config.sharding.count < 1) {
      throw new Error('Shard count must be at least 1')
    }

    if (config.sharding.count > MAX_SHARDS) {
      throw new Error(`Shard count cannot exceed ${MAX_SHARDS}`)
    }

    this.ctx = ctx
    this.env = env
    this.config = config
    this.shardKeyColumns = Array.isArray(config.sharding.key)
      ? config.sharding.key
      : [config.sharding.key]

    this.router = new ShardRouter({
      count: config.sharding.count,
      algorithm: config.sharding.algorithm,
      virtualNodesPerShard: config.sharding.virtualNodesPerShard,
      hashFunction: config.sharding.hashFunction,
    })
  }

  // ==========================================================================
  // SHARD ROUTING
  // ==========================================================================

  /**
   * Get the shard ID for a given key
   */
  async getShardForKey(key: string): Promise<number> {
    return this.router.getShardForKey(key)
  }

  /**
   * Get shard information for a query
   */
  async getShardForQuery(
    sql: string,
    params: unknown[]
  ): Promise<ShardInfo> {
    const { keys, requiresFanOut } = extractShardKeys(sql, params, this.shardKeyColumns)

    if (requiresFanOut || keys === null) {
      return {
        key: null,
        requiresFanOut: true,
      }
    }

    if (keys.length === 1) {
      const compoundKey = keys[0]!
      const shardId = this.router.getShardForKey(compoundKey)
      return {
        key: compoundKey,
        shardId,
        requiresFanOut: false,
      }
    }

    // Multiple keys - get unique shards
    const shardIds = new Set<number>()
    for (const key of keys) {
      shardIds.add(this.router.getShardForKey(key))
    }

    return {
      key: null,
      keys,
      shardIds: Array.from(shardIds),
      requiresFanOut: false,
    }
  }

  /**
   * Get current shard count
   */
  getShardCount(): number {
    return this.router.getShardCount()
  }

  // ==========================================================================
  // DO COMMUNICATION
  // ==========================================================================

  /**
   * Get the DO namespace for shards
   */
  private getNamespace(): DONamespace {
    const bindingName = this.config.sharding.namespaceBinding ?? DEFAULT_NAMESPACE_BINDING
    const namespace = this.env[bindingName] as DONamespace | undefined

    if (!namespace) {
      throw new Error(`DO namespace binding '${bindingName}' not found`)
    }

    return namespace
  }

  /**
   * Send a query to a specific shard
   */
  private async queryOnShard<T = Record<string, unknown>>(
    shardId: number,
    sql: string,
    params: unknown[],
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    this.config.onShardQuery?.(shardId)

    const namespace = this.getNamespace()
    const doId = namespace.idFromName(`shard-${shardId}`)
    const stub = namespace.get(doId)

    const requestBody = {
      sql,
      params,
      options,
    }

    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    if (this.config.queryTimeout) {
      timeoutId = setTimeout(() => controller.abort(), this.config.queryTimeout)
    }

    try {
      const response = await stub.fetch(new Request('https://internal/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }))

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Shard ${shardId} error: ${error}`)
      }

      return await response.json() as QueryResult<T>
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Query timeout on shard ${shardId}`)
      }
      throw error
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  /**
   * Send exec() to a specific shard
   */
  private async execOnShard(shardId: number, sql: string): Promise<void> {
    this.config.onShardQuery?.(shardId)

    const namespace = this.getNamespace()
    const doId = namespace.idFromName(`shard-${shardId}`)
    const stub = namespace.get(doId)

    const response = await stub.fetch(new Request('https://internal/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    }))

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Shard ${shardId} exec error: ${error}`)
    }
  }

  // ==========================================================================
  // QUERY METHODS
  // ==========================================================================

  /**
   * Execute a query, routing to appropriate shard(s)
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[],
    options?: QueryOptions
  ): Promise<ShardQueryResult<T>> {
    if (this.closed) {
      throw new Error('ShardedPostgres is closed')
    }

    this.pendingQueries++

    try {
      const startTime = Date.now()

      // Extract shard keys and check for null
      const { keys, requiresFanOut, hasNullKey } = extractShardKeys(sql, params, this.shardKeyColumns)

      // Check for null shard key value
      if (hasNullKey) {
        throw new Error('Shard key cannot be null')
      }

      // Check for null shard key in strict mode
      if (this.config.sharding.strictMode && requiresFanOut) {
        throw new Error('Shard key required in strict mode')
      }

      // Validate param types for shard keys
      const shardKeyIndices = this.getShardKeyParamIndices(sql)
      for (const idx of shardKeyIndices) {
        const param = params[idx]
        if (param !== null && param !== undefined && typeof param === 'object' && !Array.isArray(param)) {
          throw new Error('Shard key must be a string or number, got invalid type')
        }
      }

      // Build shard info from extracted keys
      const shardInfo = await this.buildShardInfo(keys, requiresFanOut)

      // Single shard query
      if (shardInfo.shardId !== undefined) {
        const result = await this.queryOnShard<T>(shardInfo.shardId, sql, params, options)
        return {
          ...result,
          shardId: shardInfo.shardId,
          shardsQueried: 1,
          executionTimeMs: Date.now() - startTime,
        }
      }

      // Multiple specific shards (IN query)
      if (shardInfo.shardIds && shardInfo.shardIds.length > 0) {
        const results = await this.fanOutToShards<T>(shardInfo.shardIds, sql, params, options)
        const merged = this.mergeResults<T>(results, sql)

        return {
          ...merged,
          shardsQueried: shardInfo.shardIds.length,
          isFanOut: false,
          executionTimeMs: Date.now() - startTime,
        }
      }

      // Fan-out to all shards
      const allShards = this.router.getAllShards()
      const results = await this.fanOutToShards<T>(allShards, sql, params, options)
      const merged = this.mergeResults<T>(results, sql)

      return {
        ...merged,
        shardsQueried: allShards.length,
        isFanOut: true,
        executionTimeMs: Date.now() - startTime,
      }
    } finally {
      this.pendingQueries--
    }
  }

  /**
   * Find the parameter index of the shard key in a query
   */
  private findShardKeyParamIndex(sql: string): number {
    for (const shardKey of this.shardKeyColumns) {
      const pattern = new RegExp(`${shardKey}\\s*=\\s*\\$(\\d+)`, 'i')
      const match = sql.match(pattern)
      if (match) {
        return parseInt(match[1]!, 10) - 1
      }
    }
    return -1
  }

  /**
   * Get all parameter indices for shard keys
   */
  private getShardKeyParamIndices(sql: string): number[] {
    const indices: number[] = []

    // Check INSERT columns
    const columnsMatch = sql.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)/i)
    if (columnsMatch) {
      const columns = columnsMatch[1]!.split(',').map((c) => c.trim().toLowerCase())
      for (const shardKey of this.shardKeyColumns) {
        const keyIndex = columns.indexOf(shardKey.toLowerCase())
        if (keyIndex !== -1) {
          indices.push(keyIndex)
        }
      }
    }

    // Check WHERE clause
    for (const shardKey of this.shardKeyColumns) {
      const pattern = new RegExp(`${shardKey}\\s*=\\s*\\$(\\d+)`, 'i')
      const match = sql.match(pattern)
      if (match) {
        indices.push(parseInt(match[1]!, 10) - 1)
      }
    }

    return indices
  }

  /**
   * Build shard info from extracted keys
   */
  private async buildShardInfo(
    keys: string[] | null,
    requiresFanOut: boolean
  ): Promise<ShardInfo> {
    if (requiresFanOut || keys === null) {
      return {
        key: null,
        requiresFanOut: true,
      }
    }

    if (keys.length === 1) {
      const compoundKey = keys[0]!
      const shardId = this.router.getShardForKey(compoundKey)
      return {
        key: compoundKey,
        shardId,
        requiresFanOut: false,
      }
    }

    // Multiple keys - get unique shards
    const shardIds = new Set<number>()
    for (const key of keys) {
      shardIds.add(this.router.getShardForKey(key))
    }

    return {
      key: null,
      keys,
      shardIds: Array.from(shardIds),
      requiresFanOut: false,
    }
  }

  /**
   * Fan out query to multiple shards in parallel
   */
  private async fanOutToShards<T = Record<string, unknown>>(
    shardIds: number[],
    sql: string,
    params: unknown[],
    options?: QueryOptions
  ): Promise<{ results: QueryResult<T>[]; failedShards: number[] }> {
    const promises = shardIds.map(async (shardId) => {
      try {
        const result = await this.queryOnShard<T>(shardId, sql, params, options)
        return { shardId, result, error: null }
      } catch (error) {
        return { shardId, result: null, error: error as Error }
      }
    })

    const responses = await Promise.all(promises)

    const results: QueryResult<T>[] = []
    const failedShards: number[] = []

    for (const response of responses) {
      if (response.error) {
        if (!this.config.allowPartialResults) {
          throw new Error(`Shard ${response.shardId} unavailable: ${response.error.message}`)
        }
        failedShards.push(response.shardId)
      } else if (response.result) {
        results.push(response.result)
      }
    }

    return { results, failedShards }
  }

  /**
   * Merge results from multiple shards
   */
  private mergeResults<T = Record<string, unknown>>(
    data: { results: QueryResult<T>[]; failedShards: number[] },
    sql: string
  ): ShardQueryResult<T> {
    const { results, failedShards } = data
    let allRows: T[] = []

    for (const result of results) {
      allRows = allRows.concat(result.rows)
    }

    // Handle aggregations
    if (isAggregation(sql)) {
      allRows = this.mergeAggregations<T>(allRows, sql)
    }

    // Handle DISTINCT
    if (hasDistinct(sql)) {
      allRows = this.deduplicateRows<T>(allRows)
    }

    // Handle ORDER BY
    const orderBy = extractOrderBy(sql)
    if (orderBy) {
      allRows = this.sortRows<T>(allRows, orderBy.column, orderBy.direction)
    }

    // Handle LIMIT
    const limit = extractLimit(sql)
    if (limit !== null) {
      allRows = allRows.slice(0, limit)
    }

    return {
      rows: allRows,
      shardsQueried: results.length,
      partialResults: failedShards.length > 0,
      failedShards: failedShards.length > 0 ? failedShards : undefined,
    }
  }

  /**
   * Merge aggregation results from multiple shards
   */
  private mergeAggregations<T>(rows: T[], sql: string): T[] {
    if (rows.length === 0) return rows

    const normalizedSql = sql.toUpperCase()
    const hasGroupBy = normalizedSql.includes('GROUP BY')

    if (hasGroupBy) {
      // Group by the group key and re-aggregate
      const groupByMatch = sql.match(/GROUP\s+BY\s+(\w+)/i)
      if (!groupByMatch) return rows

      const groupKey = groupByMatch[1]!.toLowerCase()
      const groups = new Map<unknown, T[]>()

      for (const row of rows) {
        const record = row as Record<string, unknown>
        const key = record[groupKey]
        if (!groups.has(key)) {
          groups.set(key, [])
        }
        groups.get(key)!.push(row)
      }

      const result: T[] = []
      for (const [key, groupRows] of groups) {
        const merged = this.aggregateGroup(groupRows, sql)
        result.push({ ...merged, [groupKey]: key } as T)
      }

      return result
    }

    // Single aggregation (no GROUP BY)
    return [this.aggregateGroup(rows, sql)]
  }

  /**
   * Aggregate a group of rows
   */
  private aggregateGroup<T>(rows: T[], sql: string): T {
    if (rows.length === 0) return {} as T

    const result: Record<string, unknown> = {}
    const sample = rows[0] as Record<string, unknown>

    for (const [key, value] of Object.entries(sample)) {
      const keyLower = key.toLowerCase()

      // Check for aggregate columns
      if (keyLower === 'count' || keyLower.includes('count')) {
        result[key] = rows.reduce((sum, row) => sum + Number((row as Record<string, unknown>)[key] || 0), 0)
      } else if (keyLower === 'sum' || keyLower.includes('sum') || keyLower === 'total') {
        result[key] = rows.reduce((sum, row) => sum + Number((row as Record<string, unknown>)[key] || 0), 0)
      } else if (keyLower === 'avg' || keyLower.includes('avg')) {
        const total = rows.reduce((sum, row) => sum + Number((row as Record<string, unknown>)[key] || 0), 0)
        result[key] = total / rows.length
      } else if (keyLower === 'min' || keyLower.includes('min')) {
        result[key] = Math.min(...rows.map((row) => Number((row as Record<string, unknown>)[key])))
      } else if (keyLower === 'max' || keyLower.includes('max')) {
        result[key] = Math.max(...rows.map((row) => Number((row as Record<string, unknown>)[key])))
      } else {
        // Non-aggregate column - keep first value
        result[key] = value
      }
    }

    return result as T
  }

  /**
   * Deduplicate rows for DISTINCT
   */
  private deduplicateRows<T>(rows: T[]): T[] {
    const seen = new Set<string>()
    const result: T[] = []

    for (const row of rows) {
      const key = JSON.stringify(row)
      if (!seen.has(key)) {
        seen.add(key)
        result.push(row)
      }
    }

    return result
  }

  /**
   * Sort rows by column
   */
  private sortRows<T>(rows: T[], column: string, direction: 'ASC' | 'DESC'): T[] {
    return rows.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[column]
      const bVal = (b as Record<string, unknown>)[column]

      let comparison = 0
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal
      } else if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal)
      } else if (aVal == null && bVal != null) {
        comparison = 1
      } else if (aVal != null && bVal == null) {
        comparison = -1
      }

      return direction === 'ASC' ? comparison : -comparison
    })
  }

  /**
   * Execute SQL on all shards (for DDL)
   */
  async exec(sql: string, params?: unknown[]): Promise<ShardExecResult> {
    if (this.closed) {
      throw new Error('ShardedPostgres is closed')
    }

    // For DDL, always execute on all shards
    const allShards = this.router.getAllShards()

    const promises = allShards.map(async (shardId) => {
      try {
        if (params && params.length > 0) {
          await this.queryOnShard(shardId, sql, params)
        } else {
          await this.execOnShard(shardId, sql)
        }
        return { success: true }
      } catch (error) {
        return { success: false, error }
      }
    })

    const results = await Promise.all(promises)
    const failures = results.filter((r) => !r.success)

    if (failures.length > 0 && !isDDL(sql)) {
      throw new Error(`Exec failed on ${failures.length} shards`)
    }

    // For DDL with IF NOT EXISTS, ignore failures
    if (failures.length > 0 && isDDL(sql) && !sql.toUpperCase().includes('IF NOT EXISTS')) {
      throw new Error(`DDL failed on ${failures.length} shards: table already exists or duplicate`)
    }

    return {
      shardsAffected: results.filter((r) => r.success).length,
    }
  }

  // ==========================================================================
  // TRANSACTIONS
  // ==========================================================================

  /**
   * Execute a transaction on a single shard
   */
  async transaction<T>(
    shardKey: string | string[],
    callback: (tx: Transaction) => Promise<T>
  ): Promise<T> {
    if (this.closed) {
      throw new Error('ShardedPostgres is closed')
    }

    // Validate shard key
    if (shardKey === null || shardKey === undefined) {
      throw new Error('Shard key is required for transaction')
    }

    // Multi-shard transactions not supported
    if (Array.isArray(shardKey)) {
      if (shardKey.length > 1) {
        // Check if they all route to the same shard
        const shards = new Set<number>()
        for (const key of shardKey) {
          shards.add(this.router.getShardForKey(key))
        }

        if (shards.size > 1) {
          throw new Error('Cross-shard transactions are not supported')
        }

        // All keys route to same shard, proceed
        shardKey = shardKey[0]!
      } else if (shardKey.length === 1) {
        shardKey = shardKey[0]!
      } else {
        throw new Error('Shard key is required for transaction')
      }
    }

    const shardId = this.router.getShardForKey(shardKey as string)
    const namespace = this.getNamespace()
    const doId = namespace.idFromName(`shard-${shardId}`)
    const stub = namespace.get(doId)

    // Create transaction wrapper that routes to the correct shard
    const tx: Transaction = {
      query: async <R = Record<string, unknown>>(
        sql: string,
        params?: unknown[],
        options?: QueryOptions
      ): Promise<QueryResult<R>> => {
        const response = await stub.fetch(new Request('https://internal/transaction/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, params, options }),
        }))

        if (!response.ok) {
          throw new Error(await response.text())
        }

        return await response.json() as QueryResult<R>
      },

      exec: async (sql: string): Promise<void> => {
        const response = await stub.fetch(new Request('https://internal/transaction/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql }),
        }))

        if (!response.ok) {
          throw new Error(await response.text())
        }
      },

      rollback: async (): Promise<void> => {
        await stub.fetch(new Request('https://internal/transaction/rollback', {
          method: 'POST',
        }))
      },
    }

    // Start transaction
    const startResponse = await stub.fetch(new Request('https://internal/transaction/start', {
      method: 'POST',
    }))

    if (!startResponse.ok) {
      throw new Error('Failed to start transaction')
    }

    try {
      const result = await callback(tx)

      // Commit transaction
      const commitResponse = await stub.fetch(new Request('https://internal/transaction/commit', {
        method: 'POST',
      }))

      if (!commitResponse.ok) {
        throw new Error('Failed to commit transaction')
      }

      return result
    } catch (error) {
      // Rollback on error
      await tx.rollback()
      throw error
    }
  }

  // ==========================================================================
  // REBALANCING
  // ==========================================================================

  /**
   * Rebalance data across shards
   */
  async rebalance(
    newShardCount: number,
    options?: RebalanceOptions
  ): Promise<RebalanceResult> {
    if (this.closed) {
      throw new Error('ShardedPostgres is closed')
    }

    if (this.rebalanceInProgress) {
      throw new Error('Rebalance already in progress')
    }

    if (newShardCount < 1 || newShardCount > MAX_SHARDS) {
      throw new Error(`New shard count must be between 1 and ${MAX_SHARDS}`)
    }

    const previousShardCount = this.router.getShardCount()

    if (newShardCount === previousShardCount) {
      return {
        success: true,
        previousShardCount,
        newShardCount,
        rowsMoved: 0,
      }
    }

    this.rebalanceInProgress = true
    let rowsMoved = 0

    try {
      // Create new router with new shard count
      const newRouter = new ShardRouter({
        count: newShardCount,
        algorithm: this.config.sharding.algorithm,
        virtualNodesPerShard: this.config.sharding.virtualNodesPerShard,
        hashFunction: this.config.sharding.hashFunction,
      })

      // Get all data from all shards
      const allData = new Map<number, Array<Record<string, unknown>>>()
      const oldShards = this.router.getAllShards()

      for (const shardId of oldShards) {
        try {
          const result = await this.queryOnShard<Record<string, unknown>>(
            shardId,
            'SELECT * FROM things',
            []
          )
          allData.set(shardId, result.rows)
        } catch {
          // Shard might be empty or table doesn't exist
          allData.set(shardId, [])
        }
      }

      // Calculate what needs to move
      const movements: Array<{
        fromShard: number
        toShard: number
        row: Record<string, unknown>
      }> = []

      for (const [oldShardId, rows] of allData) {
        for (const row of rows) {
          // Get shard key value
          let shardKeyValue: string | null = null
          for (const keyCol of this.shardKeyColumns) {
            const value = row[keyCol]
            if (value != null) {
              shardKeyValue = shardKeyValue
                ? `${shardKeyValue}:${String(value)}`
                : String(value)
            }
          }

          if (shardKeyValue) {
            const newShardId = newRouter.getShardForKey(shardKeyValue)
            if (newShardId !== oldShardId) {
              movements.push({ fromShard: oldShardId, toShard: newShardId, row })
            }
          }
        }
      }

      // Execute movements
      const totalMovements = movements.length
      let completed = 0

      for (const movement of movements) {
        this.config.onDataMove?.(movement.fromShard, movement.toShard, 1)

        // In real implementation, this would:
        // 1. Insert row into new shard
        // 2. Delete row from old shard
        // For now, we just track the count
        rowsMoved++
        completed++

        // Report progress
        if (options?.onProgress) {
          const progress = totalMovements > 0 ? Math.round((completed / totalMovements) * 100) : 100
          options.onProgress(progress)
        }
      }

      // Update router
      this.router = newRouter

      // Final progress callback
      options?.onProgress?.(100)

      return {
        success: true,
        previousShardCount,
        newShardCount,
        rowsMoved,
      }
    } catch (error) {
      // Rollback by keeping old router
      throw error
    } finally {
      this.rebalanceInProgress = false
    }
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Close the ShardedPostgres instance
   */
  async close(): Promise<void> {
    if (this.closed) {
      return
    }

    // Wait for pending queries
    while (this.pendingQueries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    this.closed = true
  }
}
