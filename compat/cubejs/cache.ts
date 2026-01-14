/**
 * @dotdo/cubejs - Caching Layer
 *
 * Provides comprehensive caching for Cube.js with:
 * - Query result caching with TTL
 * - Pre-aggregation caching with partition support
 * - LRU-style eviction when at capacity
 * - Cache statistics (hits, misses, evictions)
 * - DO storage integration for persistence across restarts
 * - Schema change invalidation
 * - Pre-aggregation cache warming
 *
 * @example
 * ```typescript
 * import { QueryResultCache, PreAggregationCache, CubeCache } from '@dotdo/cubejs'
 *
 * // Query result caching
 * const queryCache = new QueryResultCache({ ttl: 60000, maxEntries: 500 })
 * await queryCache.set('query-key', { data: [], annotation: {} })
 * const cached = await queryCache.get('query-key')
 * console.log(queryCache.getStats()) // { hits: 1, misses: 0, ... }
 *
 * // Pre-aggregation caching
 * const preAggCache = new PreAggregationCache({ ttl: 3600000 })
 * preAggCache.registerPreAggregation('Orders', 'ordersDaily', {
 *   type: 'rollup',
 *   measureReferences: ['count', 'totalAmount'],
 *   dimensionReferences: ['status'],
 *   timeDimensionReference: 'createdAt',
 *   granularity: 'day',
 * })
 *
 * // Unified CubeCache with DO storage integration
 * const cache = new CubeCache({
 *   queryTtl: 60000,
 *   preAggTtl: 3600000,
 *   storage: hashStore, // Optional: persist to DO storage
 * })
 * ```
 */

import type { CubeQuery } from './query'
import type { PreAggregation, Granularity, CubeSchema } from './schema'
import { createHashStore, type HashStore } from '../../db/primitives/hash-store'

// =============================================================================
// Cache Types
// =============================================================================

/**
 * Cache entry with metadata
 */
interface CacheEntry<T = unknown[]> {
  data: T
  timestamp: number
  expiresAt: number
  /** Last access time for LRU eviction */
  lastAccess: number
}

/**
 * Registered pre-aggregation info
 */
interface RegisteredPreAggregation {
  cubeName: string
  name: string
  config: PreAggregation
}

/**
 * Cache options
 */
export interface PreAggregationCacheOptions {
  /**
   * Time-to-live in milliseconds
   * @default 3600000 (1 hour)
   */
  ttl?: number

  /**
   * Maximum number of entries to cache
   * @default 1000
   */
  maxEntries?: number
}

/**
 * Query result cache options
 */
export interface QueryResultCacheOptions {
  /**
   * Time-to-live in milliseconds
   * @default 60000 (1 minute)
   */
  ttl?: number

  /**
   * Maximum number of entries to cache
   * @default 500
   */
  maxEntries?: number

  /**
   * Whether to use LRU eviction (true) or FIFO (false)
   * @default true
   */
  lru?: boolean
}

/**
 * Cache statistics
 */
export interface CacheStatistics {
  /** Total cache hits */
  hits: number
  /** Total cache misses */
  misses: number
  /** Total entries in cache */
  entries: number
  /** Total evictions due to capacity */
  evictions: number
  /** Total expirations due to TTL */
  expirations: number
  /** Hit rate (0-1) */
  hitRate: number
}

// =============================================================================
// Query Result Cache
// =============================================================================

/**
 * Query result for caching
 */
export interface CachedQueryResult {
  data: unknown[]
  annotation: {
    measures: Record<string, { title: string; shortTitle: string; type: string }>
    dimensions: Record<string, { title: string; shortTitle: string; type: string }>
  }
  query?: CubeQuery
  lastRefreshTime?: string
  requestId?: string
}

/**
 * Cache for Cube.js query results
 *
 * Provides in-memory caching with:
 * - TTL-based expiration
 * - LRU eviction when at capacity
 * - Cache statistics tracking
 *
 * @example
 * ```typescript
 * const cache = new QueryResultCache({ ttl: 60000, maxEntries: 500 })
 *
 * // Generate cache key from query
 * const key = cache.generateKey(query)
 *
 * // Check cache first
 * const cached = await cache.get(key)
 * if (cached) {
 *   return cached
 * }
 *
 * // Execute query and cache result
 * const result = await executeQuery(query)
 * await cache.set(key, result)
 *
 * // Check statistics
 * const stats = cache.getStats()
 * console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`)
 * ```
 */
export class QueryResultCache {
  private cache = new Map<string, CacheEntry<CachedQueryResult>>()
  private ttl: number
  private maxEntries: number
  private useLru: boolean

  // Statistics
  private hits = 0
  private misses = 0
  private evictions = 0
  private expirations = 0

  constructor(options: QueryResultCacheOptions = {}) {
    this.ttl = options.ttl ?? 60000 // 1 minute default
    this.maxEntries = options.maxEntries ?? 500
    this.useLru = options.lru ?? true
  }

  // ===========================================================================
  // Basic Operations
  // ===========================================================================

  /**
   * Get a query result from the cache
   */
  async get(key: string): Promise<CachedQueryResult | undefined> {
    const entry = this.cache.get(key)

    if (!entry) {
      this.misses++
      return undefined
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.expirations++
      this.misses++
      return undefined
    }

    // Update last access time for LRU
    if (this.useLru) {
      entry.lastAccess = Date.now()
    }

    this.hits++
    return entry.data
  }

  /**
   * Set a query result in the cache
   */
  async set(key: string, result: CachedQueryResult, ttl?: number): Promise<void> {
    const now = Date.now()

    // Evict if at capacity
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evict()
    }

    this.cache.set(key, {
      data: result,
      timestamp: now,
      expiresAt: now + (ttl ?? this.ttl),
      lastAccess: now,
    })
  }

  /**
   * Check if a key exists and is not expired
   */
  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key)
    if (!entry) return false

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.expirations++
      return false
    }

    return true
  }

  /**
   * Invalidate a cache entry
   */
  async invalidate(key: string): Promise<boolean> {
    return this.cache.delete(key)
  }

  /**
   * Invalidate entries matching a pattern (e.g., cube name)
   */
  async invalidatePattern(pattern: string): Promise<number> {
    let count = 0
    for (const key of Array.from(this.cache.keys())) {
      if (key.includes(pattern)) {
        this.cache.delete(key)
        count++
      }
    }
    return count
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.cache.clear()
  }

  // ===========================================================================
  // Key Generation
  // ===========================================================================

  /**
   * Generate a cache key from a query
   *
   * Creates a deterministic key based on query components
   */
  generateKey(query: CubeQuery, securityContext?: Record<string, unknown>): string {
    const parts: string[] = []

    // Add measures
    if (query.measures?.length) {
      parts.push(`m:${query.measures.sort().join(',')}`)
    }

    // Add dimensions
    if (query.dimensions?.length) {
      parts.push(`d:${query.dimensions.sort().join(',')}`)
    }

    // Add time dimensions
    if (query.timeDimensions?.length) {
      const td = query.timeDimensions
        .map((t) => {
          const range = Array.isArray(t.dateRange)
            ? t.dateRange.join('~')
            : t.dateRange || ''
          return `${t.dimension}|${t.granularity || ''}|${range}`
        })
        .join(';')
      parts.push(`t:${td}`)
    }

    // Add filters
    if (query.filters?.length) {
      const filters = JSON.stringify(query.filters)
      parts.push(`f:${filters}`)
    }

    // Add segments
    if (query.segments?.length) {
      parts.push(`s:${query.segments.sort().join(',')}`)
    }

    // Add order
    if (query.order) {
      parts.push(`o:${JSON.stringify(query.order)}`)
    }

    // Add limit/offset
    if (query.limit !== undefined) {
      parts.push(`l:${query.limit}`)
    }
    if (query.offset !== undefined) {
      parts.push(`off:${query.offset}`)
    }

    // Add timezone
    if (query.timezone) {
      parts.push(`tz:${query.timezone}`)
    }

    // Add security context hash for multi-tenancy
    if (securityContext) {
      const ctxHash = this.hashObject(securityContext)
      parts.push(`ctx:${ctxHash}`)
    }

    return parts.join('|')
  }

  /**
   * Simple hash for security context
   */
  private hashObject(obj: Record<string, unknown>): string {
    const str = JSON.stringify(obj)
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return hash.toString(36)
  }

  // ===========================================================================
  // Eviction
  // ===========================================================================

  /**
   * Evict an entry to make room for new ones
   */
  private evict(): void {
    if (this.useLru) {
      this.evictLru()
    } else {
      this.evictOldest()
    }
    this.evictions++
  }

  /**
   * Evict the least recently used entry
   */
  private evictLru(): void {
    let lruKey: string | undefined
    let lruTime = Infinity

    for (const [key, entry] of Array.from(this.cache)) {
      if (entry.lastAccess < lruTime) {
        lruTime = entry.lastAccess
        lruKey = key
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey)
    }
  }

  /**
   * Evict the oldest entry by creation time
   */
  private evictOldest(): void {
    let oldestKey: string | undefined
    let oldestTime = Infinity

    for (const [key, entry] of Array.from(this.cache)) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get cache statistics
   */
  getStats(): CacheStatistics {
    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
      evictions: this.evictions,
      expirations: this.expirations,
      hitRate: total > 0 ? this.hits / total : 0,
    }
  }

  /**
   * Reset statistics counters
   */
  resetStats(): void {
    this.hits = 0
    this.misses = 0
    this.evictions = 0
    this.expirations = 0
  }

  /**
   * Get the number of entries in the cache
   */
  get size(): number {
    return this.cache.size
  }
}

// =============================================================================
// Granularity Hierarchy
// =============================================================================

const GRANULARITY_ORDER: Granularity[] = [
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
]

const GRANULARITY_INDEX: Record<Granularity, number> = {
  second: 0,
  minute: 1,
  hour: 2,
  day: 3,
  week: 4,
  month: 5,
  quarter: 6,
  year: 7,
}

/**
 * Check if source granularity can be rolled up to target
 */
function canRollupGranularity(source: Granularity, target: Granularity): boolean {
  return GRANULARITY_INDEX[source] <= GRANULARITY_INDEX[target]
}

// =============================================================================
// Pre-aggregation Cache
// =============================================================================

/**
 * Cache for Cube.js pre-aggregations
 *
 * Provides caching for pre-aggregation results with:
 * - TTL-based expiration
 * - Partition support for time-based pre-aggregations
 * - Cache statistics tracking
 * - Pre-aggregation matching
 */
export class PreAggregationCache {
  private cache = new Map<string, CacheEntry>()
  private partitions = new Map<string, Map<string, CacheEntry>>()
  private preAggregations = new Map<string, RegisteredPreAggregation>()
  private ttl: number
  private maxEntries: number

  // Statistics
  private hits = 0
  private misses = 0
  private evictions = 0
  private expirations = 0

  constructor(options: PreAggregationCacheOptions = {}) {
    this.ttl = options.ttl ?? 3600000
    this.maxEntries = options.maxEntries ?? 1000
  }

  // ===========================================================================
  // Basic Cache Operations
  // ===========================================================================

  /**
   * Get a value from the cache
   */
  async get<T = unknown[]>(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key)
    if (!entry) {
      this.misses++
      return undefined
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.expirations++
      this.misses++
      return undefined
    }

    // Update last access time
    entry.lastAccess = Date.now()
    this.hits++
    return entry.data as T
  }

  /**
   * Set a value in the cache
   */
  async set<T = unknown[]>(key: string, data: T, ttl?: number): Promise<void> {
    const now = Date.now()

    // Evict if at capacity
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictOldest()
      this.evictions++
    }

    this.cache.set(key, {
      data: data as unknown[],
      timestamp: now,
      expiresAt: now + (ttl ?? this.ttl),
      lastAccess: now,
    })
  }

  /**
   * Invalidate a cache entry
   */
  async invalidate(key: string): Promise<void> {
    this.cache.delete(key)
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.cache.clear()
    this.partitions.clear()
  }

  // ===========================================================================
  // Partition Operations
  // ===========================================================================

  /**
   * Get a partition from the cache
   */
  async getPartition<T = unknown[]>(
    preAggKey: string,
    partition: string
  ): Promise<T | undefined> {
    const partitionMap = this.partitions.get(preAggKey)
    if (!partitionMap) {
      this.misses++
      return undefined
    }

    const entry = partitionMap.get(partition)
    if (!entry) {
      this.misses++
      return undefined
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      partitionMap.delete(partition)
      this.expirations++
      this.misses++
      return undefined
    }

    // Update last access time
    entry.lastAccess = Date.now()
    this.hits++
    return entry.data as T
  }

  /**
   * Set a partition in the cache
   */
  async setPartition<T = unknown[]>(
    preAggKey: string,
    partition: string,
    data: T,
    ttl?: number
  ): Promise<void> {
    const now = Date.now()

    let partitionMap = this.partitions.get(preAggKey)
    if (!partitionMap) {
      partitionMap = new Map()
      this.partitions.set(preAggKey, partitionMap)
    }

    partitionMap.set(partition, {
      data: data as unknown[],
      timestamp: now,
      expiresAt: now + (ttl ?? this.ttl),
      lastAccess: now,
    })
  }

  /**
   * Invalidate a partition
   */
  async invalidatePartition(preAggKey: string, partition?: string): Promise<void> {
    if (partition === undefined) {
      this.partitions.delete(preAggKey)
    } else {
      const partitionMap = this.partitions.get(preAggKey)
      if (partitionMap) {
        partitionMap.delete(partition)
      }
    }
  }

  // ===========================================================================
  // Pre-aggregation Registration
  // ===========================================================================

  /**
   * Register a pre-aggregation for matching
   */
  registerPreAggregation(
    cubeName: string,
    name: string,
    config: PreAggregation
  ): void {
    const key = `${cubeName}.${name}`
    this.preAggregations.set(key, { cubeName, name, config })
  }

  /**
   * Unregister a pre-aggregation
   */
  unregisterPreAggregation(cubeName: string, name: string): void {
    const key = `${cubeName}.${name}`
    this.preAggregations.delete(key)
  }

  /**
   * Get registered pre-aggregation info
   */
  getPreAggregation(
    cubeName: string,
    name: string
  ): RegisteredPreAggregation | undefined {
    const key = `${cubeName}.${name}`
    return this.preAggregations.get(key)
  }

  // ===========================================================================
  // Pre-aggregation Matching
  // ===========================================================================

  /**
   * Check if a query can use a pre-aggregation
   */
  canUsePreAggregation(query: CubeQuery): boolean {
    const match = this.findMatchingPreAggregation(query)
    return match !== undefined
  }

  /**
   * Find a matching pre-aggregation for a query
   */
  findMatchingPreAggregation(
    query: CubeQuery
  ): RegisteredPreAggregation | undefined {
    const queryMeasures = new Set(query.measures || [])
    const queryDimensions = new Set(query.dimensions || [])
    const queryTimeDim = query.timeDimensions?.[0]

    for (const preAgg of Array.from(this.preAggregations.values())) {
      if (this.preAggregationMatchesQuery(preAgg, queryMeasures, queryDimensions, queryTimeDim)) {
        return preAgg
      }
    }

    return undefined
  }

  /**
   * Check if a specific pre-aggregation matches a query
   */
  private preAggregationMatchesQuery(
    preAgg: RegisteredPreAggregation,
    queryMeasures: Set<string>,
    queryDimensions: Set<string>,
    queryTimeDim?: { dimension: string; granularity?: Granularity | null }
  ): boolean {
    const { cubeName, config } = preAgg

    // Check measures
    if (queryMeasures.size > 0 && config.measureReferences) {
      const preAggMeasures = new Set(
        config.measureReferences.map((m) => `${cubeName}.${m}`)
      )

      for (const measure of Array.from(queryMeasures)) {
        if (!preAggMeasures.has(measure)) {
          return false
        }
      }
    } else if (queryMeasures.size > 0 && !config.measureReferences) {
      return false
    }

    // Check dimensions
    if (queryDimensions.size > 0 && config.dimensionReferences) {
      const preAggDimensions = new Set(
        config.dimensionReferences.map((d) => `${cubeName}.${d}`)
      )

      for (const dimension of Array.from(queryDimensions)) {
        if (!preAggDimensions.has(dimension)) {
          return false
        }
      }
    } else if (queryDimensions.size > 0 && !config.dimensionReferences) {
      // Query uses dimensions but pre-aggregation doesn't have them
      return false
    }

    // Check time dimension
    if (queryTimeDim && config.timeDimensionReference) {
      const preAggTimeDim = `${cubeName}.${config.timeDimensionReference}`

      if (queryTimeDim.dimension !== preAggTimeDim) {
        return false
      }

      // Check granularity compatibility
      if (
        queryTimeDim.granularity &&
        config.granularity &&
        !canRollupGranularity(config.granularity, queryTimeDim.granularity)
      ) {
        return false
      }
    } else if (queryTimeDim && !config.timeDimensionReference) {
      return false
    }

    return true
  }

  // ===========================================================================
  // Aggregation from Cache
  // ===========================================================================

  /**
   * Aggregate data from cached pre-aggregation
   */
  async aggregate(query: CubeQuery): Promise<unknown[] | undefined> {
    const preAgg = this.findMatchingPreAggregation(query)
    if (!preAgg) return undefined

    const { cubeName, name, config } = preAgg
    const preAggKey = `${cubeName}.${name}`

    // Get cached data
    const timeDim = query.timeDimensions?.[0]
    let data: unknown[] | undefined

    if (timeDim?.dateRange && config.partitionGranularity) {
      // Collect data from partitions
      data = await this.collectPartitionData(preAggKey, timeDim.dateRange, config)
    } else {
      // Try to get from main cache
      const cacheKey = this.buildCacheKey(preAggKey, query)
      data = await this.get(cacheKey)
    }

    if (!data) return undefined

    // Roll up if needed
    if (timeDim?.granularity && config.granularity) {
      if (GRANULARITY_INDEX[timeDim.granularity] > GRANULARITY_INDEX[config.granularity]) {
        data = this.rollupData(data, config, timeDim.granularity)
      }
    }

    return data
  }

  /**
   * Collect data from partitions
   */
  private async collectPartitionData(
    preAggKey: string,
    dateRange: string | [string, string],
    _config: PreAggregation
  ): Promise<unknown[]> {
    const partitionMap = this.partitions.get(preAggKey)
    if (!partitionMap) return []

    const data: unknown[] = []

    // Parse date range
    let startDate: Date
    let endDate: Date

    if (typeof dateRange === 'string') {
      // Relative date range like "last 7 days"
      const parsed = this.parseRelativeDateRange(dateRange)
      startDate = parsed.start
      endDate = parsed.end
    } else {
      startDate = new Date(dateRange[0])
      endDate = new Date(dateRange[1])
    }

    // Iterate partitions and collect matching data
    for (const [partition, entry] of Array.from(partitionMap)) {
      // Check expiration
      if (Date.now() > entry.expiresAt) continue

      // Check if partition overlaps with date range
      const partitionDate = new Date(partition)
      if (partitionDate >= startDate && partitionDate <= endDate) {
        const partitionData = entry.data as unknown[]
        data.push(...partitionData)
      }
    }

    return data
  }

  /**
   * Roll up data to a coarser granularity
   */
  private rollupData(
    data: unknown[],
    config: PreAggregation,
    targetGranularity: Granularity
  ): unknown[] {
    if (data.length === 0) return []

    // Group by dimension values and target granularity
    const groups = new Map<string, unknown[]>()

    for (const row of data) {
      const rowObj = row as Record<string, unknown>
      const key = this.buildGroupKey(rowObj, config, targetGranularity)
      const group = groups.get(key) || []
      group.push(row)
      groups.set(key, group)
    }

    // Aggregate each group
    const result: unknown[] = []

    for (const [_key, groupRows] of Array.from(groups)) {
      const aggregated = this.aggregateGroup(groupRows, config)
      result.push(aggregated)
    }

    return result
  }

  /**
   * Build a group key for rollup
   */
  private buildGroupKey(
    row: Record<string, unknown>,
    config: PreAggregation,
    _targetGranularity: Granularity
  ): string {
    const keyParts: string[] = []

    // Add dimension values
    if (config.dimensionReferences) {
      for (const dim of config.dimensionReferences) {
        keyParts.push(String(row[dim] ?? 'null'))
      }
    }

    // Add truncated time dimension
    if (config.timeDimensionReference) {
      const timeValue = row[config.timeDimensionReference]
      if (timeValue) {
        // Truncate to target granularity
        const date = new Date(String(timeValue))
        keyParts.push(this.truncateToGranularity(date, _targetGranularity))
      }
    }

    return keyParts.join('|')
  }

  /**
   * Truncate a date to a granularity
   */
  private truncateToGranularity(date: Date, granularity: Granularity): string {
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    const day = date.getUTCDate()
    const hour = date.getUTCHours()
    const minute = date.getUTCMinutes()

    switch (granularity) {
      case 'year':
        return `${year}`
      case 'quarter':
        return `${year}-Q${Math.floor(month / 3) + 1}`
      case 'month':
        return `${year}-${String(month + 1).padStart(2, '0')}`
      case 'week':
        // ISO week
        const firstDayOfYear = new Date(Date.UTC(year, 0, 1))
        const daysSinceStart = Math.floor(
          (date.getTime() - firstDayOfYear.getTime()) / (24 * 60 * 60 * 1000)
        )
        const week = Math.ceil((daysSinceStart + firstDayOfYear.getUTCDay() + 1) / 7)
        return `${year}-W${String(week).padStart(2, '0')}`
      case 'day':
        return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      case 'hour':
        return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}`
      case 'minute':
        return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      case 'second':
        return date.toISOString()
      default:
        return date.toISOString()
    }
  }

  /**
   * Aggregate a group of rows
   */
  private aggregateGroup(
    rows: unknown[],
    config: PreAggregation
  ): Record<string, unknown> {
    if (rows.length === 0) return {}

    const result: Record<string, unknown> = {}
    const firstRow = rows[0] as Record<string, unknown>

    // Copy dimension values from first row
    if (config.dimensionReferences) {
      for (const dim of config.dimensionReferences) {
        result[dim] = firstRow[dim]
      }
    }

    // Copy time dimension from first row
    if (config.timeDimensionReference) {
      result[config.timeDimensionReference] = firstRow[config.timeDimensionReference]
    }

    // Aggregate measures
    if (config.measureReferences) {
      for (const measure of config.measureReferences) {
        const values = rows
          .map((r) => (r as Record<string, unknown>)[measure])
          .filter((v) => v !== null && v !== undefined)

        // Sum by default (most pre-aggregations use additive measures)
        result[measure] = values.reduce((a: number, b) => a + (b as number), 0)
      }
    }

    return result
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Build a cache key for a query
   */
  private buildCacheKey(preAggKey: string, query: CubeQuery): string {
    const parts = [preAggKey]

    if (query.timeDimensions?.[0]?.dateRange) {
      const dateRange = query.timeDimensions[0].dateRange
      if (typeof dateRange === 'string') {
        parts.push(dateRange)
      } else {
        parts.push(dateRange.join('.'))
      }
    }

    if (query.timeDimensions?.[0]?.granularity) {
      parts.push(query.timeDimensions[0].granularity)
    }

    return parts.join('.')
  }

  /**
   * Parse a relative date range string
   */
  private parseRelativeDateRange(
    rangeStr: string
  ): { start: Date; end: Date } {
    const now = new Date()
    const match = rangeStr.match(/last\s+(\d+)\s+(day|week|month|year)s?/i)

    if (match) {
      const amount = parseInt(match[1], 10)
      const unit = match[2].toLowerCase()
      const start = new Date(now)

      switch (unit) {
        case 'day':
          start.setDate(start.getDate() - amount)
          break
        case 'week':
          start.setDate(start.getDate() - amount * 7)
          break
        case 'month':
          start.setMonth(start.getMonth() - amount)
          break
        case 'year':
          start.setFullYear(start.getFullYear() - amount)
          break
      }

      return { start, end: now }
    }

    // Default to last 30 days
    const start = new Date(now)
    start.setDate(start.getDate() - 30)
    return { start, end: now }
  }

  /**
   * Evict the oldest cache entry
   */
  private evictOldest(): void {
    let oldestKey: string | undefined
    let oldestTimestamp = Infinity

    for (const [key, entry] of Array.from(this.cache)) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStatistics & {
    partitions: number
    preAggregations: number
  } {
    let totalPartitions = 0
    for (const partitionMap of Array.from(this.partitions.values())) {
      totalPartitions += partitionMap.size
    }

    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
      evictions: this.evictions,
      expirations: this.expirations,
      hitRate: total > 0 ? this.hits / total : 0,
      partitions: totalPartitions,
      preAggregations: this.preAggregations.size,
    }
  }

  /**
   * Reset statistics counters
   */
  resetStats(): void {
    this.hits = 0
    this.misses = 0
    this.evictions = 0
    this.expirations = 0
  }
}

// =============================================================================
// CubeCache - Unified Cache with DO Storage Integration
// =============================================================================

/**
 * Cache policy for query-specific settings
 */
export interface CachePolicy {
  /**
   * TTL in milliseconds for this query pattern
   */
  ttl: number

  /**
   * Priority for cache eviction (higher = keep longer)
   */
  priority?: number

  /**
   * Whether to persist to DO storage
   */
  persist?: boolean
}

/**
 * Refresh schedule for pre-aggregation warming
 */
export interface RefreshSchedule {
  /**
   * Pre-aggregation key (cubeName.preAggName)
   */
  preAggKey: string

  /**
   * Cron expression or interval in milliseconds
   */
  interval: number | string

  /**
   * Last refresh timestamp
   */
  lastRefresh?: number

  /**
   * Next scheduled refresh timestamp
   */
  nextRefresh?: number

  /**
   * Whether the schedule is active
   */
  active: boolean
}

/**
 * Options for CubeCache
 */
export interface CubeCacheOptions {
  /**
   * Default TTL for query results in milliseconds
   * @default 60000 (1 minute)
   */
  queryTtl?: number

  /**
   * Default TTL for pre-aggregations in milliseconds
   * @default 3600000 (1 hour)
   */
  preAggTtl?: number

  /**
   * Maximum entries in query cache
   * @default 500
   */
  maxQueryEntries?: number

  /**
   * Maximum entries in pre-aggregation cache
   * @default 1000
   */
  maxPreAggEntries?: number

  /**
   * HashStore for DO storage persistence
   * If not provided, uses in-memory storage only
   */
  storage?: HashStore<string>

  /**
   * Storage key prefix for namespacing
   * @default 'cubecache'
   */
  storagePrefix?: string

  /**
   * Whether to enable LRU eviction
   * @default true
   */
  lru?: boolean

  /**
   * Callback for cache warming
   */
  onWarm?: (preAggKey: string, query: CubeQuery) => Promise<unknown[]>
}

/**
 * Extended cache statistics for CubeCache
 */
export interface CubeCacheStatistics extends CacheStatistics {
  /** Number of pre-aggregation partitions */
  partitions: number
  /** Number of registered pre-aggregations */
  preAggregations: number
  /** Number of schema versions tracked */
  schemaVersions: number
  /** Number of active refresh schedules */
  activeSchedules: number
  /** Storage synchronization status */
  storageSynced: boolean
}

/**
 * Unified cache for Cube.js with DO storage integration
 *
 * Features:
 * - In-memory LRU cache with TTL
 * - Cache key generation from query + context
 * - Cache invalidation on schema changes
 * - Pre-aggregation cache warming
 * - DO storage persistence via HashStore
 * - Cache policies for query-specific settings
 * - Pre-aggregation refresh scheduling
 *
 * @example
 * ```typescript
 * const cache = new CubeCache({
 *   queryTtl: 60000,
 *   preAggTtl: 3600000,
 *   storage: hashStore,
 * })
 *
 * // Register schema for invalidation tracking
 * cache.registerSchema(ordersSchema)
 *
 * // Set cache policy for specific queries
 * cache.setPolicy('Orders.*', { ttl: 120000, persist: true })
 *
 * // Schedule pre-aggregation warming
 * cache.scheduleRefresh('Orders.ordersDaily', { interval: 3600000 })
 *
 * // Use with queries
 * const key = cache.generateQueryKey(query, securityContext)
 * const cached = await cache.getQuery(key)
 * if (!cached) {
 *   const result = await executeQuery(query)
 *   await cache.setQuery(key, result)
 * }
 * ```
 */
export class CubeCache {
  private queryCache: QueryResultCache
  private preAggCache: PreAggregationCache
  private storage?: HashStore<string>
  private storagePrefix: string
  private schemaVersions = new Map<string, string>()
  private policies = new Map<string, CachePolicy>()
  private refreshSchedules = new Map<string, RefreshSchedule>()
  private warmingCallback?: (preAggKey: string, query: CubeQuery) => Promise<unknown[]>
  private refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private storageSynced = false

  constructor(options: CubeCacheOptions = {}) {
    this.queryCache = new QueryResultCache({
      ttl: options.queryTtl ?? 60000,
      maxEntries: options.maxQueryEntries ?? 500,
      lru: options.lru ?? true,
    })

    this.preAggCache = new PreAggregationCache({
      ttl: options.preAggTtl ?? 3600000,
      maxEntries: options.maxPreAggEntries ?? 1000,
    })

    this.storage = options.storage
    this.storagePrefix = options.storagePrefix ?? 'cubecache'
    this.warmingCallback = options.onWarm
  }

  // ===========================================================================
  // Query Cache Operations
  // ===========================================================================

  /**
   * Get a query result from the cache
   */
  async getQuery(key: string): Promise<CachedQueryResult | undefined> {
    // Try memory cache first
    let result = await this.queryCache.get(key)

    // If not in memory but storage available, try storage
    if (!result && this.storage) {
      const stored = await this.storage.hget(this.getStorageKey('queries'), key)
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as { data: CachedQueryResult; expiresAt: number }
          if (Date.now() < parsed.expiresAt) {
            result = parsed.data
            // Restore to memory cache
            await this.queryCache.set(key, result)
          } else {
            // Expired, clean up storage
            await this.storage.hdel(this.getStorageKey('queries'), key)
          }
        } catch {
          // Invalid stored data, ignore
        }
      }
    }

    return result
  }

  /**
   * Set a query result in the cache
   */
  async setQuery(
    key: string,
    result: CachedQueryResult,
    options?: { ttl?: number; persist?: boolean }
  ): Promise<void> {
    // Find matching policy
    const policy = this.findMatchingPolicy(key)
    const ttl = options?.ttl ?? policy?.ttl
    const persist = options?.persist ?? policy?.persist ?? false

    await this.queryCache.set(key, result, ttl)

    // Persist to storage if enabled
    if (persist && this.storage) {
      const expiresAt = Date.now() + (ttl ?? 60000)
      await this.storage.hset(
        this.getStorageKey('queries'),
        key,
        JSON.stringify({ data: result, expiresAt }),
        { ttl: ttl ?? 60000 }
      )
    }
  }

  /**
   * Generate a cache key from a query and security context
   */
  generateQueryKey(query: CubeQuery, securityContext?: Record<string, unknown>): string {
    return this.queryCache.generateKey(query, securityContext)
  }

  /**
   * Invalidate query cache entries matching a pattern
   */
  async invalidateQueries(pattern: string): Promise<number> {
    const count = await this.queryCache.invalidatePattern(pattern)

    // Also invalidate in storage
    if (this.storage) {
      const keys = await this.storage.hkeys(this.getStorageKey('queries'))
      for (const key of keys) {
        if (key.includes(pattern)) {
          await this.storage.hdel(this.getStorageKey('queries'), key)
        }
      }
    }

    return count
  }

  // ===========================================================================
  // Pre-aggregation Cache Operations
  // ===========================================================================

  /**
   * Get pre-aggregation data from the cache
   */
  async getPreAgg<T = unknown[]>(key: string): Promise<T | undefined> {
    let result = await this.preAggCache.get<T>(key)

    if (!result && this.storage) {
      const stored = await this.storage.hget(this.getStorageKey('preaggs'), key)
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as { data: T; expiresAt: number }
          if (Date.now() < parsed.expiresAt) {
            result = parsed.data
            await this.preAggCache.set(key, result)
          } else {
            await this.storage.hdel(this.getStorageKey('preaggs'), key)
          }
        } catch {
          // Invalid stored data
        }
      }
    }

    return result
  }

  /**
   * Set pre-aggregation data in the cache
   */
  async setPreAgg<T = unknown[]>(
    key: string,
    data: T,
    options?: { ttl?: number; persist?: boolean }
  ): Promise<void> {
    const ttl = options?.ttl ?? 3600000
    const persist = options?.persist ?? true

    await this.preAggCache.set(key, data, ttl)

    if (persist && this.storage) {
      const expiresAt = Date.now() + ttl
      await this.storage.hset(
        this.getStorageKey('preaggs'),
        key,
        JSON.stringify({ data, expiresAt }),
        { ttl }
      )
    }
  }

  /**
   * Register a pre-aggregation for matching
   */
  registerPreAggregation(
    cubeName: string,
    name: string,
    config: PreAggregation
  ): void {
    this.preAggCache.registerPreAggregation(cubeName, name, config)
  }

  /**
   * Check if a query can use a pre-aggregation
   */
  canUsePreAggregation(query: CubeQuery): boolean {
    return this.preAggCache.canUsePreAggregation(query)
  }

  /**
   * Find matching pre-aggregation for a query
   */
  findMatchingPreAggregation(query: CubeQuery) {
    return this.preAggCache.findMatchingPreAggregation(query)
  }

  /**
   * Aggregate data from cached pre-aggregation
   */
  async aggregate(query: CubeQuery): Promise<unknown[] | undefined> {
    return this.preAggCache.aggregate(query)
  }

  // ===========================================================================
  // Partition Operations
  // ===========================================================================

  /**
   * Get a partition from the cache
   */
  async getPartition<T = unknown[]>(
    preAggKey: string,
    partition: string
  ): Promise<T | undefined> {
    let result = await this.preAggCache.getPartition<T>(preAggKey, partition)

    if (!result && this.storage) {
      const storageKey = `${preAggKey}:${partition}`
      const stored = await this.storage.hget(this.getStorageKey('partitions'), storageKey)
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as { data: T; expiresAt: number }
          if (Date.now() < parsed.expiresAt) {
            result = parsed.data
            await this.preAggCache.setPartition(preAggKey, partition, result)
          } else {
            await this.storage.hdel(this.getStorageKey('partitions'), storageKey)
          }
        } catch {
          // Invalid stored data
        }
      }
    }

    return result
  }

  /**
   * Set a partition in the cache
   */
  async setPartition<T = unknown[]>(
    preAggKey: string,
    partition: string,
    data: T,
    options?: { ttl?: number; persist?: boolean }
  ): Promise<void> {
    const ttl = options?.ttl ?? 3600000
    const persist = options?.persist ?? true

    await this.preAggCache.setPartition(preAggKey, partition, data, ttl)

    if (persist && this.storage) {
      const storageKey = `${preAggKey}:${partition}`
      const expiresAt = Date.now() + ttl
      await this.storage.hset(
        this.getStorageKey('partitions'),
        storageKey,
        JSON.stringify({ data, expiresAt }),
        { ttl }
      )
    }
  }

  // ===========================================================================
  // Schema Change Invalidation
  // ===========================================================================

  /**
   * Register a schema for change tracking
   *
   * When a schema changes (detected by version hash), all related
   * cache entries are automatically invalidated.
   */
  registerSchema(schema: CubeSchema): void {
    const version = this.computeSchemaVersion(schema)
    const existingVersion = this.schemaVersions.get(schema.name)

    if (existingVersion && existingVersion !== version) {
      // Schema changed, invalidate all cache for this cube
      this.invalidateCubeCache(schema.name)
    }

    this.schemaVersions.set(schema.name, version)

    // Register pre-aggregations if present
    if (schema.preAggregations) {
      for (const [name, config] of Object.entries(schema.preAggregations)) {
        this.registerPreAggregation(schema.name, name, config)
      }
    }
  }

  /**
   * Notify that a schema has changed
   *
   * This invalidates all cache entries related to the cube.
   */
  async onSchemaChange(cubeName: string, newSchema?: CubeSchema): Promise<void> {
    // Invalidate all cache for this cube
    await this.invalidateCubeCache(cubeName)

    // Update schema version if new schema provided
    if (newSchema) {
      const version = this.computeSchemaVersion(newSchema)
      this.schemaVersions.set(cubeName, version)

      // Re-register pre-aggregations
      if (newSchema.preAggregations) {
        for (const [name, config] of Object.entries(newSchema.preAggregations)) {
          this.registerPreAggregation(cubeName, name, config)
        }
      }
    } else {
      this.schemaVersions.delete(cubeName)
    }
  }

  /**
   * Compute a version hash for a schema
   */
  private computeSchemaVersion(schema: CubeSchema): string {
    const significant = {
      sql: schema.sql,
      measures: schema.measures,
      dimensions: schema.dimensions,
      joins: schema.joins,
      preAggregations: schema.preAggregations,
    }
    const str = JSON.stringify(significant)
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return hash.toString(36)
  }

  /**
   * Invalidate all cache entries for a cube
   */
  private async invalidateCubeCache(cubeName: string): Promise<void> {
    // Invalidate query cache
    await this.invalidateQueries(cubeName)

    // Invalidate pre-aggregation cache
    await this.preAggCache.invalidatePartition(cubeName)

    // Invalidate in storage
    if (this.storage) {
      // Clean up storage entries for this cube
      const queryKeys = await this.storage.hkeys(this.getStorageKey('queries'))
      for (const key of queryKeys) {
        if (key.includes(cubeName)) {
          await this.storage.hdel(this.getStorageKey('queries'), key)
        }
      }

      const preAggKeys = await this.storage.hkeys(this.getStorageKey('preaggs'))
      for (const key of preAggKeys) {
        if (key.startsWith(cubeName)) {
          await this.storage.hdel(this.getStorageKey('preaggs'), key)
        }
      }

      const partitionKeys = await this.storage.hkeys(this.getStorageKey('partitions'))
      for (const key of partitionKeys) {
        if (key.startsWith(cubeName)) {
          await this.storage.hdel(this.getStorageKey('partitions'), key)
        }
      }
    }
  }

  // ===========================================================================
  // Cache Policies
  // ===========================================================================

  /**
   * Set a cache policy for queries matching a pattern
   *
   * @param pattern - Glob-like pattern (e.g., 'Orders.*', '*.count')
   * @param policy - Cache policy to apply
   */
  setPolicy(pattern: string, policy: CachePolicy): void {
    this.policies.set(pattern, policy)
  }

  /**
   * Remove a cache policy
   */
  removePolicy(pattern: string): boolean {
    return this.policies.delete(pattern)
  }

  /**
   * Get all registered policies
   */
  getPolicies(): Map<string, CachePolicy> {
    return new Map(this.policies)
  }

  /**
   * Find the first matching policy for a cache key
   */
  private findMatchingPolicy(key: string): CachePolicy | undefined {
    for (const [pattern, policy] of Array.from(this.policies)) {
      if (this.matchPattern(key, pattern)) {
        return policy
      }
    }
    return undefined
  }

  /**
   * Match a key against a glob-like pattern
   */
  private matchPattern(key: string, pattern: string): boolean {
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    return new RegExp(`^${regex}$`).test(key)
  }

  // ===========================================================================
  // Pre-aggregation Refresh Scheduling
  // ===========================================================================

  /**
   * Schedule automatic refresh for a pre-aggregation
   *
   * @param preAggKey - Pre-aggregation key (cubeName.preAggName)
   * @param options - Refresh schedule options
   */
  scheduleRefresh(
    preAggKey: string,
    options: { interval: number | string; query?: CubeQuery }
  ): void {
    // Stop existing schedule if any
    this.stopRefresh(preAggKey)

    const interval = typeof options.interval === 'number'
      ? options.interval
      : this.parseCronInterval(options.interval)

    const schedule: RefreshSchedule = {
      preAggKey,
      interval,
      lastRefresh: undefined,
      nextRefresh: Date.now() + interval,
      active: true,
    }

    this.refreshSchedules.set(preAggKey, schedule)

    // Start the refresh timer
    this.startRefreshTimer(preAggKey, interval, options.query)
  }

  /**
   * Stop refresh schedule for a pre-aggregation
   */
  stopRefresh(preAggKey: string): boolean {
    const timer = this.refreshTimers.get(preAggKey)
    if (timer) {
      clearTimeout(timer)
      this.refreshTimers.delete(preAggKey)
    }

    const schedule = this.refreshSchedules.get(preAggKey)
    if (schedule) {
      schedule.active = false
      this.refreshSchedules.delete(preAggKey)
      return true
    }
    return false
  }

  /**
   * Get all active refresh schedules
   */
  getRefreshSchedules(): Map<string, RefreshSchedule> {
    return new Map(this.refreshSchedules)
  }

  /**
   * Manually trigger a cache warming for a pre-aggregation
   */
  async warmCache(preAggKey: string, query?: CubeQuery): Promise<boolean> {
    if (!this.warmingCallback) {
      return false
    }

    try {
      const warmQuery = query ?? this.buildWarmQuery(preAggKey)
      if (!warmQuery) return false

      const data = await this.warmingCallback(preAggKey, warmQuery)
      await this.setPreAgg(preAggKey, data, { persist: true })

      // Update schedule
      const schedule = this.refreshSchedules.get(preAggKey)
      if (schedule) {
        schedule.lastRefresh = Date.now()
        schedule.nextRefresh = Date.now() + (
          typeof schedule.interval === 'number'
            ? schedule.interval
            : this.parseCronInterval(schedule.interval as string)
        )
      }

      return true
    } catch {
      return false
    }
  }

  /**
   * Start the refresh timer for a pre-aggregation
   */
  private startRefreshTimer(
    preAggKey: string,
    interval: number,
    query?: CubeQuery
  ): void {
    const timer = setTimeout(async () => {
      await this.warmCache(preAggKey, query)

      // Reschedule if still active
      const schedule = this.refreshSchedules.get(preAggKey)
      if (schedule?.active) {
        this.startRefreshTimer(preAggKey, interval, query)
      }
    }, interval)

    this.refreshTimers.set(preAggKey, timer)
  }

  /**
   * Parse a cron-like interval string to milliseconds
   */
  private parseCronInterval(cronStr: string): number {
    const match = cronStr.match(/(\d+)\s*(s|m|h|d)/i)
    if (!match) return 3600000 // Default 1 hour

    const amount = parseInt(match[1], 10)
    const unit = match[2].toLowerCase()

    switch (unit) {
      case 's': return amount * 1000
      case 'm': return amount * 60 * 1000
      case 'h': return amount * 60 * 60 * 1000
      case 'd': return amount * 24 * 60 * 60 * 1000
      default: return 3600000
    }
  }

  /**
   * Build a warming query for a pre-aggregation
   */
  private buildWarmQuery(preAggKey: string): CubeQuery | undefined {
    const [cubeName, preAggName] = preAggKey.split('.')
    const preAgg = this.preAggCache.getPreAggregation(cubeName, preAggName)
    if (!preAgg) return undefined

    const { config } = preAgg

    const query: CubeQuery = {}

    if (config.measureReferences) {
      query.measures = config.measureReferences.map(m => `${cubeName}.${m}`)
    }

    if (config.dimensionReferences) {
      query.dimensions = config.dimensionReferences.map(d => `${cubeName}.${d}`)
    }

    if (config.timeDimensionReference && config.granularity) {
      query.timeDimensions = [{
        dimension: `${cubeName}.${config.timeDimensionReference}`,
        granularity: config.granularity,
        dateRange: 'last 30 days',
      }]
    }

    return query
  }

  // ===========================================================================
  // Storage Operations
  // ===========================================================================

  /**
   * Sync cache to storage (for persistence)
   */
  async syncToStorage(): Promise<void> {
    if (!this.storage) return

    // Save schema versions
    await this.storage.hmset(
      this.getStorageKey('meta'),
      Object.fromEntries(
        Array.from(this.schemaVersions).map(([k, v]) => [`schema:${k}`, v])
      )
    )

    // Save policies
    await this.storage.hmset(
      this.getStorageKey('meta'),
      Object.fromEntries(
        Array.from(this.policies).map(([k, v]) => [`policy:${k}`, JSON.stringify(v)])
      )
    )

    // Save schedules
    await this.storage.hmset(
      this.getStorageKey('meta'),
      Object.fromEntries(
        Array.from(this.refreshSchedules).map(([k, v]) => [`schedule:${k}`, JSON.stringify(v)])
      )
    )

    this.storageSynced = true
  }

  /**
   * Restore cache from storage
   */
  async restoreFromStorage(): Promise<void> {
    if (!this.storage) return

    const meta = await this.storage.hgetall(this.getStorageKey('meta'))

    for (const [key, value] of Object.entries(meta)) {
      if (key.startsWith('schema:')) {
        this.schemaVersions.set(key.slice(7), value)
      } else if (key.startsWith('policy:')) {
        try {
          this.policies.set(key.slice(7), JSON.parse(value))
        } catch {
          // Invalid policy data
        }
      } else if (key.startsWith('schedule:')) {
        try {
          const schedule = JSON.parse(value) as RefreshSchedule
          if (schedule.active) {
            this.refreshSchedules.set(key.slice(9), schedule)
            // Restart timer
            const interval = typeof schedule.interval === 'number'
              ? schedule.interval
              : this.parseCronInterval(schedule.interval as string)
            this.startRefreshTimer(schedule.preAggKey, interval)
          }
        } catch {
          // Invalid schedule data
        }
      }
    }

    this.storageSynced = true
  }

  /**
   * Get the storage key with prefix
   */
  private getStorageKey(suffix: string): string {
    return `${this.storagePrefix}:${suffix}`
  }

  // ===========================================================================
  // Statistics and Lifecycle
  // ===========================================================================

  /**
   * Get comprehensive cache statistics
   */
  getStats(): CubeCacheStatistics {
    const queryStats = this.queryCache.getStats()
    const preAggStats = this.preAggCache.getStats()

    return {
      hits: queryStats.hits + preAggStats.hits,
      misses: queryStats.misses + preAggStats.misses,
      entries: queryStats.entries + preAggStats.entries,
      evictions: queryStats.evictions + preAggStats.evictions,
      expirations: queryStats.expirations + preAggStats.expirations,
      hitRate: (queryStats.hits + preAggStats.hits) /
        Math.max(1, queryStats.hits + queryStats.misses + preAggStats.hits + preAggStats.misses),
      partitions: preAggStats.partitions,
      preAggregations: preAggStats.preAggregations,
      schemaVersions: this.schemaVersions.size,
      activeSchedules: this.refreshSchedules.size,
      storageSynced: this.storageSynced,
    }
  }

  /**
   * Reset all statistics
   */
  resetStats(): void {
    this.queryCache.resetStats()
    this.preAggCache.resetStats()
  }

  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    await this.queryCache.clear()
    await this.preAggCache.clear()

    if (this.storage) {
      await this.storage.del(
        this.getStorageKey('queries'),
        this.getStorageKey('preaggs'),
        this.getStorageKey('partitions'),
        this.getStorageKey('meta')
      )
    }

    this.storageSynced = false
  }

  /**
   * Stop all refresh timers (call before disposing)
   */
  dispose(): void {
    for (const [key] of Array.from(this.refreshTimers)) {
      this.stopRefresh(key)
    }
  }

  /**
   * Get underlying query cache (for direct access)
   */
  getQueryCache(): QueryResultCache {
    return this.queryCache
  }

  /**
   * Get underlying pre-aggregation cache (for direct access)
   */
  getPreAggCache(): PreAggregationCache {
    return this.preAggCache
  }
}
