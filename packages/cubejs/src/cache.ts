/**
 * @dotdo/cubejs - Pre-aggregation Cache
 *
 * Provides caching for Cube.js pre-aggregations with:
 * - TTL-based expiration
 * - Partition support
 * - Aggregation rollup from cached data
 * - Pre-aggregation matching
 *
 * @example
 * ```typescript
 * import { PreAggregationCache } from '@dotdo/cubejs'
 *
 * const cache = new PreAggregationCache({ ttl: 3600000 })
 *
 * // Register pre-aggregations
 * cache.registerPreAggregation('Orders', 'ordersDaily', {
 *   type: 'rollup',
 *   measureReferences: ['count', 'totalAmount'],
 *   dimensionReferences: ['status'],
 *   timeDimensionReference: 'createdAt',
 *   granularity: 'day',
 * })
 *
 * // Check if query can use pre-aggregation
 * const canUse = cache.canUsePreAggregation({
 *   measures: ['Orders.count'],
 *   dimensions: ['Orders.status'],
 * })
 * ```
 */

import type { CubeQuery } from './query'
import type { PreAggregation, Granularity } from './schema'

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
 */
export class PreAggregationCache {
  private cache = new Map<string, CacheEntry>()
  private partitions = new Map<string, Map<string, CacheEntry>>()
  private preAggregations = new Map<string, RegisteredPreAggregation>()
  private ttl: number
  private maxEntries: number

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
    if (!entry) return undefined

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }

    return entry.data as T
  }

  /**
   * Set a value in the cache
   */
  async set<T = unknown[]>(key: string, data: T, ttl?: number): Promise<void> {
    const now = Date.now()

    // Evict if at capacity
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest()
    }

    this.cache.set(key, {
      data: data as unknown[],
      timestamp: now,
      expiresAt: now + (ttl ?? this.ttl),
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
    if (!partitionMap) return undefined

    const entry = partitionMap.get(partition)
    if (!entry) return undefined

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      partitionMap.delete(partition)
      return undefined
    }

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
  getStats(): {
    entries: number
    partitions: number
    preAggregations: number
  } {
    let totalPartitions = 0
    for (const partitionMap of Array.from(this.partitions.values())) {
      totalPartitions += partitionMap.size
    }

    return {
      entries: this.cache.size,
      partitions: totalPartitions,
      preAggregations: this.preAggregations.size,
    }
  }
}
