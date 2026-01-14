/**
 * CrossShardQuery - Query data across all shards via Iceberg tables
 *
 * This component enables global queries across all shards stored in Iceberg,
 * supporting filtering, ordering, pagination, and aggregations.
 *
 * Features:
 * - Global queries across all shards for Things and Events
 * - Filter by $type, namespace, and custom WHERE clauses
 * - ORDER BY, LIMIT, and OFFSET support
 * - Aggregations (COUNT, SUM, AVG, MIN, MAX) across shards
 * - Partition pruning for efficient queries
 * - Streaming results for large datasets
 * - Query caching for frequently executed queries
 *
 * @module objects/unified-storage/cross-shard-query
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Thing stored in Iceberg
 */
export interface Thing {
  $id: string
  $type: string
  $version: number
  $createdAt: number
  $updatedAt: number
  $ns: string // namespace (shard identifier)
  [key: string]: unknown
}

/**
 * Domain event stored in Iceberg
 */
export interface DomainEvent {
  type: 'thing.created' | 'thing.updated' | 'thing.deleted'
  entityId: string
  entityType: string
  payload: Record<string, unknown>
  ts: number
  version: number
  ns: string
  idempotencyKey: string
}

/**
 * Iceberg reader interface for querying Iceberg tables
 */
export interface IcebergReader {
  query<T = Record<string, unknown>>(options: {
    table: string
    columns?: string[]
    where?: Record<string, unknown>
    orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>
    limit?: number
    offset?: number
    partitionFilter?: Record<string, unknown>
  }): Promise<{
    rows: T[]
    stats: {
      partitionsScanned: number
      filesScanned: number
      bytesScanned: number
      rowsScanned: number
    }
  }>

  aggregate<T = Record<string, unknown>>(options: {
    table: string
    groupBy?: string[]
    aggregations: Array<{
      function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
      column?: string
      alias: string
    }>
    where?: Record<string, unknown>
    having?: Record<string, unknown>
    partitionFilter?: Record<string, unknown>
  }): Promise<{
    rows: T[]
    stats: {
      partitionsScanned: number
      filesScanned: number
      bytesScanned: number
      rowsScanned: number
    }
  }>

  stream<T = Record<string, unknown>>(options: {
    table: string
    batchSize?: number
    where?: Record<string, unknown>
    partitionFilter?: Record<string, unknown>
  }): AsyncIterable<T[]>
}

/**
 * Configuration for CrossShardQuery
 */
export interface CrossShardQueryConfig {
  /** Iceberg reader instance */
  iceberg: IcebergReader
  /** Query timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Enable query caching (default: false) */
  cacheEnabled?: boolean
  /** Cache TTL in milliseconds (default: 60000) */
  cacheTTL?: number
  /** Maximum cache entries (default: 100) */
  cacheMaxSize?: number
}

/**
 * Resolved configuration with defaults applied
 */
export interface ResolvedConfig {
  iceberg: IcebergReader
  timeout: number
  cacheEnabled: boolean
  cacheTTL: number
  cacheMaxSize: number
}

/**
 * Options for global queries
 */
export interface GlobalQueryOptions {
  /** Filter by $type */
  type?: string
  /** Filter by namespace (enables partition pruning) */
  namespace?: string
  /** WHERE clause conditions */
  where?: Record<string, unknown>
  /** ORDER BY specification */
  orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>
  /** Maximum rows to return */
  limit?: number
  /** Rows to skip */
  offset?: number
}

/**
 * Options for streaming queries
 */
export interface StreamQueryOptions extends GlobalQueryOptions {
  /** Batch size for streaming (default: 100) */
  batchSize?: number
}

/**
 * Query statistics
 */
export interface QueryStats {
  /** Number of shards queried */
  shardsQueried: number
  /** Total rows returned */
  totalRows: number
  /** Partitions scanned */
  partitionsScanned: number
  /** Files scanned */
  filesScanned: number
  /** Bytes scanned */
  bytesScanned: number
  /** Rows scanned */
  rowsScanned: number
  /** Number of partitions pruned */
  partitionsPruned: number
  /** Whether result came from cache */
  cacheHit: boolean
}

/**
 * Result of a global query
 */
export interface GlobalQueryResult<T = Thing> {
  /** Query results */
  rows: T[]
  /** Query statistics */
  stats: QueryStats
}

/**
 * Options for aggregation queries
 */
export interface AggregationOptions {
  /** WHERE clause conditions */
  where?: Record<string, unknown>
  /** GROUP BY columns */
  groupBy?: string[]
  /** Aggregation functions */
  aggregations: Array<{
    function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
    column?: string
    alias: string
  }>
  /** HAVING clause for filtering grouped results */
  having?: Record<string, unknown>
  /** Filter by namespace (enables partition pruning) */
  namespace?: string
}

/**
 * Result of an aggregation query
 */
export interface AggregationResult<T = Record<string, unknown>> {
  /** Aggregation results */
  rows: T[]
  /** Query statistics */
  stats: QueryStats
}

// ============================================================================
// CACHE IMPLEMENTATION
// ============================================================================

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

class QueryCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private readonly maxSize: number
  private readonly ttl: number

  constructor(maxSize: number, ttl: number) {
    this.maxSize = maxSize
    this.ttl = ttl
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      const keysToDelete = Array.from(this.cache.keys()).slice(0, Math.floor(this.maxSize / 4))
      for (const k of keysToDelete) {
        this.cache.delete(k)
      }
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttl,
    })
  }

  clear(): void {
    this.cache.clear()
  }
}

// ============================================================================
// CROSS SHARD QUERY IMPLEMENTATION
// ============================================================================

/**
 * CrossShardQuery - Query data across all shards via Iceberg
 *
 * @example
 * ```typescript
 * const query = new CrossShardQuery({
 *   iceberg: icebergReader,
 *   cacheEnabled: true,
 * })
 *
 * // Query all customers
 * const customers = await query.queryThings({ type: 'Customer' })
 *
 * // Aggregate orders by status
 * const orderStats = await query.aggregateThings({
 *   where: { $type: 'Order' },
 *   groupBy: ['status'],
 *   aggregations: [
 *     { function: 'COUNT', alias: 'count' },
 *     { function: 'SUM', column: 'amount', alias: 'total' },
 *   ],
 * })
 * ```
 */
export class CrossShardQuery {
  readonly config: ResolvedConfig
  private readonly iceberg: IcebergReader
  private readonly thingsCache: QueryCache<GlobalQueryResult<Thing>> | null
  private readonly aggregateCache: QueryCache<AggregationResult> | null

  constructor(config: CrossShardQueryConfig) {
    this.config = {
      iceberg: config.iceberg,
      timeout: config.timeout ?? 30_000,
      cacheEnabled: config.cacheEnabled ?? false,
      cacheTTL: config.cacheTTL ?? 60_000,
      cacheMaxSize: config.cacheMaxSize ?? 100,
    }
    this.iceberg = config.iceberg

    // Initialize caches if enabled
    if (this.config.cacheEnabled) {
      this.thingsCache = new QueryCache(this.config.cacheMaxSize, this.config.cacheTTL)
      this.aggregateCache = new QueryCache(this.config.cacheMaxSize, this.config.cacheTTL)
    } else {
      this.thingsCache = null
      this.aggregateCache = null
    }
  }

  /**
   * Query Things across all shards
   */
  async queryThings(options: GlobalQueryOptions = {}): Promise<GlobalQueryResult<Thing>> {
    const cacheKey = this.config.cacheEnabled ? this.buildCacheKey('things', options) : null

    // Check cache
    if (cacheKey && this.thingsCache) {
      const cached = this.thingsCache.get(cacheKey)
      if (cached) {
        return {
          ...cached,
          stats: { ...cached.stats, cacheHit: true },
        }
      }
    }

    // Build query options
    const queryOptions = this.buildQueryOptions('do_things', options)

    // Execute with timeout
    const result = await this.executeWithTimeout(
      () => this.iceberg.query<Thing>(queryOptions),
      this.config.timeout
    )

    // Apply namespace prefix filtering (post-processing for prefix match semantics)
    let filteredRows = result.rows
    if (options.namespace) {
      filteredRows = filteredRows.filter((row) => row.$ns.startsWith(options.namespace!))
    }

    const queryResult: GlobalQueryResult<Thing> = {
      rows: filteredRows,
      stats: {
        shardsQueried: result.stats.partitionsScanned || 1,
        totalRows: filteredRows.length,
        partitionsScanned: result.stats.partitionsScanned,
        filesScanned: result.stats.filesScanned,
        bytesScanned: result.stats.bytesScanned,
        rowsScanned: result.stats.rowsScanned,
        partitionsPruned: options.namespace ? 1 : 0,
        cacheHit: false,
      },
    }

    // Store in cache
    if (cacheKey && this.thingsCache) {
      this.thingsCache.set(cacheKey, queryResult)
    }

    return queryResult
  }

  /**
   * Query Events across all shards
   */
  async queryEvents(options: GlobalQueryOptions = {}): Promise<GlobalQueryResult<DomainEvent>> {
    const queryOptions = this.buildQueryOptions('do_events', options)

    const result = await this.executeWithTimeout(
      () => this.iceberg.query<DomainEvent>(queryOptions),
      this.config.timeout
    )

    return {
      rows: result.rows,
      stats: {
        shardsQueried: result.stats.partitionsScanned || 1,
        totalRows: result.rows.length,
        partitionsScanned: result.stats.partitionsScanned,
        filesScanned: result.stats.filesScanned,
        bytesScanned: result.stats.bytesScanned,
        rowsScanned: result.stats.rowsScanned,
        partitionsPruned: options.namespace ? 1 : 0,
        cacheHit: false,
      },
    }
  }

  /**
   * Aggregate Things across all shards
   */
  async aggregateThings(options: AggregationOptions): Promise<AggregationResult> {
    const cacheKey = this.config.cacheEnabled ? this.buildCacheKey('aggregate', options) : null

    // Check cache
    if (cacheKey && this.aggregateCache) {
      const cached = this.aggregateCache.get(cacheKey)
      if (cached) {
        return {
          ...cached,
          stats: { ...cached.stats, cacheHit: true },
        }
      }
    }

    // Build aggregation options
    const aggregateOptions = this.buildAggregateOptions('do_things', options)

    const result = await this.executeWithTimeout(
      () => this.iceberg.aggregate(aggregateOptions),
      this.config.timeout
    )

    const aggregateResult: AggregationResult = {
      rows: result.rows,
      stats: {
        shardsQueried: result.stats.partitionsScanned || 1,
        totalRows: result.rows.length,
        partitionsScanned: result.stats.partitionsScanned,
        filesScanned: result.stats.filesScanned,
        bytesScanned: result.stats.bytesScanned,
        rowsScanned: result.stats.rowsScanned,
        partitionsPruned: options.namespace ? 1 : 0,
        cacheHit: false,
      },
    }

    // Store in cache
    if (cacheKey && this.aggregateCache) {
      this.aggregateCache.set(cacheKey, aggregateResult)
    }

    return aggregateResult
  }

  /**
   * Stream Things across all shards
   */
  async *streamThings(options: StreamQueryOptions = {}): AsyncGenerator<Thing[]> {
    const streamOptions = {
      table: 'do_things',
      batchSize: options.batchSize ?? 100,
      where: this.buildWhereClause(options),
      partitionFilter: options.namespace ? { $ns: options.namespace } : undefined,
    }

    const stream = this.iceberg.stream<Thing>(streamOptions)
    for await (const batch of stream) {
      yield batch
    }
  }

  /**
   * Stream Events across all shards
   */
  async *streamEvents(options: StreamQueryOptions = {}): AsyncGenerator<DomainEvent[]> {
    const streamOptions = {
      table: 'do_events',
      batchSize: options.batchSize ?? 100,
      where: this.buildWhereClause(options),
      partitionFilter: options.namespace ? { ns: options.namespace } : undefined,
    }

    const stream = this.iceberg.stream<DomainEvent>(streamOptions)
    for await (const batch of stream) {
      yield batch
    }
  }

  /**
   * Clear the query cache
   */
  clearCache(): void {
    this.thingsCache?.clear()
    this.aggregateCache?.clear()
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private buildQueryOptions(table: string, options: GlobalQueryOptions) {
    // Note: namespace filtering is done via post-processing with prefix match semantics
    // partitionFilter is passed as a hint for partition pruning optimization
    // but actual filtering happens after query results are returned
    return {
      table,
      where: this.buildWhereClause(options),
      orderBy: options.orderBy,
      limit: options.limit,
      offset: Math.max(0, options.offset ?? 0), // Normalize invalid offset
      partitionFilter: options.namespace ? { $ns: options.namespace } : undefined,
    }
  }

  private buildAggregateOptions(table: string, options: AggregationOptions) {
    return {
      table,
      groupBy: options.groupBy,
      aggregations: options.aggregations,
      where: options.where,
      having: options.having,
      partitionFilter: options.namespace ? { $ns: options.namespace } : undefined,
    }
  }

  private buildWhereClause(options: GlobalQueryOptions): Record<string, unknown> | undefined {
    const where: Record<string, unknown> = {}

    if (options.type) {
      where.$type = options.type
    }

    if (options.where) {
      Object.assign(where, options.where)
    }

    return Object.keys(where).length > 0 ? where : undefined
  }

  private buildCacheKey(prefix: string, options: unknown): string {
    return `${prefix}:${JSON.stringify(options)}`
  }

  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Query timed out')), timeout)
      }),
    ])
  }
}
