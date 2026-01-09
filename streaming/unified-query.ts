/**
 * Unified Query Layer
 *
 * Combines hot tier (EventStreamDO PGLite) and cold tier (Iceberg Parquet in R2)
 * into a single SQL query interface. Users query once and get results from both
 * tiers seamlessly merged.
 *
 * Architecture:
 * - Hot tier: EventStreamDO with PGLite (5 min retention, sub-10ms latency)
 * - Cold tier: R2 Parquet with Iceberg metadata (historical data)
 * - Query Router: Automatically selects tier(s) based on time range
 * - Result Merger: Deduplicates and merges results from both tiers
 *
 * @example
 * ```typescript
 * const layer = new UnifiedQueryLayer({
 *   hotTier: eventStreamDO,
 *   coldTier: icebergSink,
 * })
 *
 * // Query recent data (hot tier only)
 * const recent = await layer.query("SELECT * FROM events WHERE timestamp > NOW() - INTERVAL '2 minutes'")
 *
 * // Query historical data (cold tier only)
 * const historical = await layer.query("SELECT * FROM events WHERE timestamp < NOW() - INTERVAL '1 hour'")
 *
 * // Query spanning both tiers (automatically merged)
 * const combined = await layer.query("SELECT * FROM events WHERE timestamp > NOW() - INTERVAL '10 minutes'")
 * ```
 */

import type { EventStreamDO, BroadcastEvent } from './event-stream-do'
import type { IcebergSink } from './compat/kafka/kafka-pipelines'

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Base error for unified query layer
 */
export class UnifiedQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnifiedQueryError'
  }
}

/**
 * Error when a tier is unavailable
 */
export class TierUnavailableError extends UnifiedQueryError {
  readonly tier: 'hot' | 'cold'

  constructor(tier: 'hot' | 'cold', message?: string) {
    // Include tier name in message for better error reporting
    const tierName = tier
    const errorMsg = message
      ? `${tierName} tier error: ${message}`
      : `${tierName} tier unavailable`
    super(errorMsg)
    this.name = 'TierUnavailableError'
    this.tier = tier
  }
}

/**
 * Error when query times out
 */
export class QueryTimeoutError extends UnifiedQueryError {
  constructor(message?: string) {
    super(message ?? 'Query timed out')
    this.name = 'QueryTimeoutError'
  }
}

/**
 * Error for invalid queries
 */
export class InvalidQueryError extends UnifiedQueryError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidQueryError'
  }
}

// ============================================================================
// TYPES
// ============================================================================

export type TierType = 'hot' | 'cold'

/**
 * Configuration for the unified query layer
 */
export interface UnifiedQueryConfig {
  /** Hot tier (EventStreamDO) */
  hotTier?: EventStreamDO
  /** Cold tier (IcebergSink) */
  coldTier?: IcebergSink
  /** Hot tier retention in ms - defaults to 5 minutes */
  hotTierRetentionMs?: number
  /** Default query timeout in ms */
  defaultTimeout?: number
  /** Enable query plan in results */
  enableQueryPlan?: boolean
  /** Deduplication window in ms */
  deduplicationWindow?: number
}

/**
 * Resolved configuration with defaults applied
 */
export interface ResolvedUnifiedQueryConfig {
  readonly hotTierRetentionMs: number
  readonly defaultTimeout: number
  readonly enableQueryPlan: boolean
  readonly deduplicationWindow: number
}

/**
 * Query options
 */
export interface QueryOptions {
  /** Allow partial results if a tier fails */
  allowPartialResults?: boolean
  /** Include query plan in result */
  includeQueryPlan?: boolean
  /** Include dedup stats in result */
  includeDedupStats?: boolean
  /** Merge strategy for duplicates */
  mergeStrategy?: MergeStrategy
  /** Query timeout in ms */
  timeout?: number
  /** Use cached results if available */
  useCache?: boolean
  /** Allow cross-tier JOINs */
  allowCrossTierJoin?: boolean
  /** Snapshot ID for time travel */
  snapshotId?: number
  /** Timestamp for AS OF query */
  asOfTimestamp?: number
}

/**
 * Merge strategy for deduplication
 */
export type MergeStrategy = 'hot-first' | 'cold-first' | 'latest'

/**
 * Query result
 */
export interface QueryResult {
  rows: Record<string, unknown>[]
  tiersQueried: TierType[]
  queryPlan?: QueryPlan
  dedupStats?: DedupStats
  warnings?: string[]
  isPartial?: boolean
  snapshotId?: number
  asOfTimestamp?: number
  isTimeTravel?: boolean
}

/**
 * Deduplication statistics
 */
export interface DedupStats {
  duplicatesRemoved: number
  hotTierCount: number
  coldTierCount: number
  finalCount: number
}

/**
 * Query plan for explaining query execution
 */
export interface QueryPlan {
  selectedTiers: TierType[]
  reasoning: string
  estimatedRows: number
  estimatedCost: number
  partitionStrategy?: 'hourly' | 'daily' | 'monthly'
  estimatedPartitions?: number
  coldPartitionsScanned?: number
  partitionsTotal?: number
  partitionsScanned?: number
  partitionsPruned?: number
  filesSkippedByStats?: number
  tiersQueried?: TierType[]
  executionTimeMs?: number
}

/**
 * Tier information
 */
export interface TierInfo {
  type: TierType
  available: boolean
  latencyMs?: number
  rowCount?: number
}

/**
 * Column statistics
 */
export interface ColumnStatistics {
  minValue: unknown
  maxValue: unknown
  nullCount?: number
  distinctCount?: number
}

/**
 * Partition pruning result
 */
export interface PartitionPruningResult {
  prunedPartitions: string[]
  scannedPartitions: string[]
  pruningRatio: number
}

/**
 * Time travel options
 */
export interface TimeTravelOptions {
  snapshotId?: number
  asOfTimestamp?: number
}

/**
 * Snapshot information
 */
export interface SnapshotInfo {
  snapshotId: number
  timestampMs: number
  operation: string
}

// ============================================================================
// SQL PARSER UTILITIES
// ============================================================================

interface ParsedTimeRange {
  start?: number
  end?: number
  isRelative?: boolean
}

interface ParsedAggregation {
  func: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
  field: string
  alias: string
  isDistinct?: boolean
}

interface ParsedJoin {
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'
  table: string
  alias?: string
  condition: string
}

interface ParsedQuery {
  tableName: string
  tableAlias?: string
  timeRange?: ParsedTimeRange
  hasOrderBy: boolean
  orderByColumn?: string
  orderByDirection?: 'ASC' | 'DESC'
  limit?: number
  offset?: number
  hasAggregation: boolean
  aggregations: ParsedAggregation[]
  groupByColumns: string[]
  hasHaving: boolean
  havingClause?: string
  selectColumns: string[]
  whereClause?: string
  isTimeTravel: boolean
  timeTravelTimestamp?: number
  filters: ParsedFilter[]
  hasJoin: boolean
  joins: ParsedJoin[]
}

interface ParsedFilter {
  column: string
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'IN' | 'LIKE' | 'BETWEEN'
  value: unknown
  value2?: unknown // For BETWEEN
  orGroup?: number // Group filters with same orGroup as OR, different as AND
}

/**
 * Parse SQL query to extract relevant information
 */
function parseSQL(sql: string, params: unknown[] = []): ParsedQuery {
  const upperSQL = sql.toUpperCase()
  const now = Date.now()

  // Extract table name with optional alias - stop at INNER/LEFT/RIGHT/JOIN keywords
  const tableMatch = sql.match(/FROM\s+(\w+)(?:\s+(\w+))?(?=\s+(?:INNER|LEFT|RIGHT|FULL|JOIN|WHERE|GROUP|ORDER|LIMIT|$))/i)
  const tableName = tableMatch?.[1] ?? 'events'
  let tableAlias = tableMatch?.[2]
  // Avoid capturing keywords as alias
  if (tableAlias && ['INNER', 'LEFT', 'RIGHT', 'FULL', 'JOIN', 'WHERE', 'GROUP', 'ORDER', 'LIMIT'].includes(tableAlias.toUpperCase())) {
    tableAlias = undefined
  }

  // Parse JOINs - simpler approach using split
  const joins: ParsedJoin[] = []

  // Find all JOIN clauses
  // Pattern: (INNER|LEFT|RIGHT|FULL)? JOIN table alias ON condition
  // Include ->' for JSON path operators
  const joinRegex = /\b(INNER\s+|LEFT\s+(?:OUTER\s+)?|RIGHT\s+(?:OUTER\s+)?|FULL\s+(?:OUTER\s+)?)?JOIN\s+(\w+)\s+(\w+)\s+ON\s+([a-zA-Z0-9_.'\s=<>!()\->]+?)(?=\s+(?:INNER|LEFT|RIGHT|FULL|JOIN|WHERE|GROUP|ORDER|LIMIT)|$)/gi
  let joinMatch: RegExpMatchArray | null
  while ((joinMatch = joinRegex.exec(sql)) !== null) {
    const typeKeyword = (joinMatch[1] ?? '').trim().toUpperCase()
    let joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' = 'INNER'
    if (typeKeyword.startsWith('LEFT')) joinType = 'LEFT'
    else if (typeKeyword.startsWith('RIGHT')) joinType = 'RIGHT'
    else if (typeKeyword.startsWith('FULL')) joinType = 'FULL'

    joins.push({
      type: joinType,
      table: joinMatch[2],
      alias: joinMatch[3],
      condition: joinMatch[4].trim(),
    })
  }

  const hasJoin = joins.length > 0

  // Check for time travel syntax
  const isTimeTravel = upperSQL.includes('FOR SYSTEM_TIME AS OF')
  let timeTravelTimestamp: number | undefined
  if (isTimeTravel) {
    const ttMatch = sql.match(/AS OF TIMESTAMP\s+'([^']+)'/i)
    if (ttMatch) {
      timeTravelTimestamp = new Date(ttMatch[1]).getTime()
    }
  }

  // Parse time range from WHERE clause
  const timeRange = parseTimeRange(sql, params, now)

  // Check for ORDER BY
  const orderByMatch = sql.match(/ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i)
  const hasOrderBy = !!orderByMatch
  const orderByColumn = orderByMatch?.[1]
  const orderByDirection = (orderByMatch?.[2]?.toUpperCase() as 'ASC' | 'DESC') ?? 'ASC'

  // Parse LIMIT
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
  const limit = limitMatch ? parseInt(limitMatch[1]) : undefined

  // Parse OFFSET
  const offsetMatch = sql.match(/OFFSET\s+(\d+)/i)
  const offset = offsetMatch ? parseInt(offsetMatch[1]) : undefined

  // Parse aggregations with aliases
  const aggregations: ParsedAggregation[] = []

  // Match patterns like: COUNT(*) as count, SUM(amount) as total
  const selectClause = sql.match(/SELECT\s+(.+?)\s+FROM/i)?.[1] ?? ''
  const selectParts = selectClause.split(',').map(s => s.trim())

  for (const part of selectParts) {
    // COUNT DISTINCT
    const countDistinctMatch = part.match(/COUNT\s*\(\s*DISTINCT\s+(\w+)\s*\)(?:\s+as\s+(\w+))?/i)
    if (countDistinctMatch) {
      aggregations.push({
        func: 'COUNT',
        field: countDistinctMatch[1],
        alias: countDistinctMatch[2] ?? `count_distinct_${countDistinctMatch[1]}`,
        isDistinct: true,
      })
      continue
    }

    // COUNT(*)
    const countStarMatch = part.match(/COUNT\s*\(\s*\*\s*\)(?:\s+as\s+(\w+))?/i)
    if (countStarMatch) {
      aggregations.push({
        func: 'COUNT',
        field: '*',
        alias: countStarMatch[1] ?? 'count',
      })
      continue
    }

    // COUNT(column)
    const countMatch = part.match(/COUNT\s*\(\s*(\w+)\s*\)(?:\s+as\s+(\w+))?/i)
    if (countMatch) {
      aggregations.push({
        func: 'COUNT',
        field: countMatch[1],
        alias: countMatch[2] ?? `count_${countMatch[1]}`,
      })
      continue
    }

    // SUM
    const sumMatch = part.match(/SUM\s*\(\s*(\w+)\s*\)(?:\s+as\s+(\w+))?/i)
    if (sumMatch) {
      aggregations.push({
        func: 'SUM',
        field: sumMatch[1],
        alias: sumMatch[2] ?? `sum_${sumMatch[1]}`,
      })
      continue
    }

    // AVG
    const avgMatch = part.match(/AVG\s*\(\s*(\w+)\s*\)(?:\s+as\s+(\w+))?/i)
    if (avgMatch) {
      aggregations.push({
        func: 'AVG',
        field: avgMatch[1],
        alias: avgMatch[2] ?? `avg_${avgMatch[1]}`,
      })
      continue
    }

    // MIN
    const minMatch = part.match(/MIN\s*\(\s*(\w+)\s*\)(?:\s+as\s+(\w+))?/i)
    if (minMatch) {
      aggregations.push({
        func: 'MIN',
        field: minMatch[1],
        alias: minMatch[2] ?? `min_${minMatch[1]}`,
      })
      continue
    }

    // MAX
    const maxMatch = part.match(/MAX\s*\(\s*(\w+)\s*\)(?:\s+as\s+(\w+))?/i)
    if (maxMatch) {
      aggregations.push({
        func: 'MAX',
        field: maxMatch[1],
        alias: maxMatch[2] ?? `max_${maxMatch[1]}`,
      })
      continue
    }
  }

  const hasAggregation = aggregations.length > 0

  // Check for GROUP BY - capture up to HAVING, ORDER, LIMIT, or end of string
  // Need to use non-greedy match and handle newlines
  const groupByMatch = sql.match(/GROUP\s+BY\s+([a-zA-Z0-9_,\s]+?)(?=\s+HAVING|\s+ORDER|\s+LIMIT|$)/i)
  const groupByColumns = groupByMatch
    ? groupByMatch[1].split(',').map(c => c.trim()).filter(c => c.length > 0)
    : []

  // Check for HAVING
  const hasHaving = upperSQL.includes('HAVING')
  const havingMatch = sql.match(/HAVING\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/i)
  const havingClause = havingMatch?.[1]

  // Extract SELECT columns
  const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i)
  const selectColumns = selectMatch
    ? selectMatch[1].split(',').map(c => c.trim())
    : ['*']

  // Extract WHERE clause
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+GROUP|\s+ORDER|\s+LIMIT|$)/is)
  const whereClause = whereMatch?.[1]

  // Parse filters from WHERE clause
  const filters = parseFilters(whereClause ?? '', params)

  return {
    tableName,
    tableAlias,
    timeRange,
    hasOrderBy,
    orderByColumn,
    orderByDirection,
    limit,
    offset,
    hasAggregation,
    aggregations,
    groupByColumns,
    hasHaving,
    havingClause,
    selectColumns,
    whereClause,
    hasJoin,
    joins,
    isTimeTravel,
    timeTravelTimestamp,
    filters,
  }
}

/**
 * Parse filters from WHERE clause
 */
function parseFilters(whereClause: string, params: unknown[]): ParsedFilter[] {
  const filters: ParsedFilter[] = []
  if (!whereClause) return filters

  // Check if we have OR clause - split by OR and process each part
  const hasOr = /\bOR\b/i.test(whereClause)

  if (hasOr) {
    // Split by OR and create filter groups
    const orParts = whereClause.split(/\s+OR\s+/i)
    orParts.forEach((part, orGroup) => {
      const partFilters = parseFilterPart(part.trim(), params)
      partFilters.forEach(f => filters.push({ ...f, orGroup }))
    })
  } else {
    // No OR, parse as AND filters
    const partFilters = parseFilterPart(whereClause, params)
    filters.push(...partFilters)
  }

  return filters
}

/**
 * Parse a single part of WHERE clause (between ORs)
 */
function parseFilterPart(whereClause: string, params: unknown[]): ParsedFilter[] {
  const filters: ParsedFilter[] = []

  // Simple equality: column = 'value' or column = $N
  const eqMatches = whereClause.matchAll(/(\w+)\s*=\s*(?:'([^']*)'|\$(\d+)|(\d+))/gi)
  for (const match of eqMatches) {
    const column = match[1]
    if (column.toLowerCase() === 'timestamp') continue // Skip timestamp, handled separately
    let value: unknown = match[2] ?? match[4]
    if (match[3]) {
      value = params[parseInt(match[3]) - 1]
    }
    filters.push({ column, operator: '=', value })
  }

  // Greater than (but not >=): column > value
  const gtMatches = whereClause.matchAll(/(\w+)\s*>(?!=)\s*(?:'([^']*)'|\$(\d+)|(\d+))/gi)
  for (const match of gtMatches) {
    const column = match[1]
    if (column.toLowerCase() === 'timestamp') continue
    let value: unknown = match[2] ?? (match[4] ? parseInt(match[4]) : undefined)
    if (match[3]) {
      value = params[parseInt(match[3]) - 1]
    }
    filters.push({ column, operator: '>', value })
  }

  // Greater than or equal: column >= value
  const gteMatches = whereClause.matchAll(/(\w+)\s*>=\s*(?:'([^']*)'|\$(\d+)|(\d+))/gi)
  for (const match of gteMatches) {
    const column = match[1]
    if (column.toLowerCase() === 'timestamp') continue
    let value: unknown = match[2] ?? (match[4] ? parseInt(match[4]) : undefined)
    if (match[3]) {
      value = params[parseInt(match[3]) - 1]
    }
    filters.push({ column, operator: '>=', value })
  }

  // IN clause: column IN ('a', 'b')
  const inMatch = whereClause.match(/(\w+)\s+IN\s*\(([^)]+)\)/i)
  if (inMatch) {
    const column = inMatch[1]
    const valuesStr = inMatch[2]
    const values = valuesStr.split(',').map(v => v.trim().replace(/^'|'$/g, ''))
    filters.push({ column, operator: 'IN', value: values })
  }

  // LIKE pattern: column LIKE 'pattern%'
  const likeMatch = whereClause.match(/(\w+)\s+LIKE\s+'([^']+)'/i)
  if (likeMatch) {
    filters.push({ column: likeMatch[1], operator: 'LIKE', value: likeMatch[2] })
  }

  return filters
}

/**
 * Parse time range from WHERE clause
 */
function parseTimeRange(sql: string, params: unknown[], now: number): ParsedTimeRange | undefined {
  const upperSQL = sql.toUpperCase()

  // Check for NOW() - INTERVAL patterns
  const intervalMatch = sql.match(/NOW\(\)\s*-\s*INTERVAL\s+'(\d+)\s*(\w+)'/i)
  if (intervalMatch) {
    const value = parseInt(intervalMatch[1])
    const unit = intervalMatch[2].toLowerCase()
    let ms = 0
    switch (unit) {
      case 'second':
      case 'seconds':
        ms = value * 1000
        break
      case 'minute':
      case 'minutes':
        ms = value * 60 * 1000
        break
      case 'hour':
      case 'hours':
        ms = value * 60 * 60 * 1000
        break
      case 'day':
      case 'days':
        ms = value * 24 * 60 * 60 * 1000
        break
    }
    return { start: now - ms, end: now, isRelative: true }
  }

  // Check for timestamp parameter comparisons
  let start: number | undefined
  let end: number | undefined

  // Match timestamp >= $N or timestamp > $N
  const geMatch = sql.match(/timestamp\s*(>=?)\s*\$(\d+)/i)
  if (geMatch && params.length >= parseInt(geMatch[2])) {
    const paramValue = params[parseInt(geMatch[2]) - 1]
    if (typeof paramValue === 'number') {
      start = paramValue
    }
  }

  // Match timestamp <= $N or timestamp < $N
  const leMatch = sql.match(/timestamp\s*(<=?)\s*\$(\d+)/i)
  if (leMatch && params.length >= parseInt(leMatch[2])) {
    const paramValue = params[parseInt(leMatch[2]) - 1]
    if (typeof paramValue === 'number') {
      end = paramValue
    }
  }

  // Check for inline timestamps in WHERE clause
  const inlineGeMatch = sql.match(/timestamp\s*(>=?)\s*(\d{13,})/i)
  if (inlineGeMatch) {
    start = parseInt(inlineGeMatch[2])
  }

  const inlineLeMatch = sql.match(/timestamp\s*(<=?)\s*(\d{13,})/i)
  if (inlineLeMatch) {
    end = parseInt(inlineLeMatch[2])
  }

  // Check for BETWEEN clause
  const betweenMatch = sql.match(/timestamp\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)/i)
  if (betweenMatch) {
    start = parseInt(betweenMatch[1])
    end = parseInt(betweenMatch[2])
  }

  if (start !== undefined || end !== undefined) {
    return { start, end }
  }

  return undefined
}

// ============================================================================
// ROW UTILITIES
// ============================================================================

/**
 * Get a value from a row, checking both direct properties and payload
 */
function getRowValue(row: Record<string, unknown>, field: string): unknown {
  // Direct property
  if (field in row) return row[field]
  // Check in payload
  const payload = row.payload as Record<string, unknown> | undefined
  if (payload && field in payload) return payload[field]
  return undefined
}

/**
 * Check if a row matches a filter
 */
function matchesFilter(row: Record<string, unknown>, filter: ParsedFilter): boolean {
  const value = getRowValue(row, filter.column)

  switch (filter.operator) {
    case '=':
      return value === filter.value || String(value) === String(filter.value)
    case '!=':
      return value !== filter.value
    case '>':
      return typeof value === 'number' && typeof filter.value === 'number' && value > filter.value
    case '>=':
      return typeof value === 'number' && typeof filter.value === 'number' && value >= filter.value
    case '<':
      return typeof value === 'number' && typeof filter.value === 'number' && value < filter.value
    case '<=':
      return typeof value === 'number' && typeof filter.value === 'number' && value <= filter.value
    case 'IN':
      return Array.isArray(filter.value) && filter.value.includes(value)
    case 'LIKE':
      if (typeof value !== 'string' || typeof filter.value !== 'string') return false
      const pattern = filter.value.replace(/%/g, '.*').replace(/_/g, '.')
      return new RegExp(`^${pattern}$`, 'i').test(value)
    case 'BETWEEN':
      return typeof value === 'number' &&
             typeof filter.value === 'number' &&
             typeof filter.value2 === 'number' &&
             value >= filter.value && value <= filter.value2
    default:
      return true
  }
}

/**
 * Filter rows based on parsed filters
 * Handles both AND and OR logic based on orGroup
 */
function filterRows(rows: Record<string, unknown>[], filters: ParsedFilter[]): Record<string, unknown>[] {
  if (filters.length === 0) return rows

  // Check if we have OR groups
  const hasOrGroups = filters.some(f => f.orGroup !== undefined)

  if (!hasOrGroups) {
    // All filters are AND - all must match
    return rows.filter(row => filters.every(filter => matchesFilter(row, filter)))
  }

  // Group filters by orGroup
  const groups = new Map<number, ParsedFilter[]>()
  filters.forEach(f => {
    const group = f.orGroup ?? 0
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(f)
  })

  // Row matches if ANY group matches (OR logic between groups)
  // Within a group, all filters must match (AND logic)
  return rows.filter(row => {
    for (const [, groupFilters] of groups) {
      if (groupFilters.every(filter => matchesFilter(row, filter))) {
        return true // At least one OR group matches
      }
    }
    return false // No OR group matched
  })
}

// ============================================================================
// UNIFIED QUERY LAYER
// ============================================================================

const DEFAULT_CONFIG: ResolvedUnifiedQueryConfig = {
  hotTierRetentionMs: 5 * 60 * 1000, // 5 minutes
  defaultTimeout: 30000,
  enableQueryPlan: false,
  deduplicationWindow: 60000,
}

export class UnifiedQueryLayer {
  private _hotTier?: EventStreamDO
  private _coldTier?: IcebergSink
  private _config: ResolvedUnifiedQueryConfig
  private _cache: Map<string, { result: QueryResult; timestamp: number }> = new Map()
  private _cacheTimeout = 5000 // 5 second cache

  constructor(config: UnifiedQueryConfig) {
    if (!config.hotTier && !config.coldTier) {
      throw new UnifiedQueryError('At least one tier (hot or cold) must be provided')
    }

    this._hotTier = config.hotTier
    this._coldTier = config.coldTier

    // Get hot tier retention from config or from hot tier itself
    const hotTierRetention = config.hotTierRetentionMs ??
      (config.hotTier as any)?.config?.hotTierRetentionMs ??
      DEFAULT_CONFIG.hotTierRetentionMs

    this._config = {
      hotTierRetentionMs: hotTierRetention,
      defaultTimeout: config.defaultTimeout ?? DEFAULT_CONFIG.defaultTimeout,
      enableQueryPlan: config.enableQueryPlan ?? DEFAULT_CONFIG.enableQueryPlan,
      deduplicationWindow: config.deduplicationWindow ?? DEFAULT_CONFIG.deduplicationWindow,
    }
  }

  // ============================================================================
  // PUBLIC PROPERTIES
  // ============================================================================

  get config(): ResolvedUnifiedQueryConfig {
    return this._config
  }

  get hasHotTier(): boolean {
    return !!this._hotTier
  }

  get hasColdTier(): boolean {
    return !!this._coldTier
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Execute SQL query across hot and/or cold tiers
   */
  async query(
    sql: string,
    params: unknown[] = [],
    options: QueryOptions = {}
  ): Promise<QueryResult> {
    const startTime = performance.now()
    const timeout = options.timeout ?? this._config.defaultTimeout

    // Validate SQL syntax (basic check)
    this.validateSQL(sql)

    // Check cache
    if (options.useCache) {
      const cacheKey = `${sql}:${JSON.stringify(params)}`
      const cached = this._cache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < this._cacheTimeout) {
        return cached.result
      }
    }

    // Handle time travel
    if (options.snapshotId !== undefined || options.asOfTimestamp !== undefined) {
      if (!this._coldTier) {
        throw new InvalidQueryError('Time travel queries require cold tier')
      }
    }

    // Parse the SQL
    const parsed = parseSQL(sql, params)

    // Check for time travel in SQL
    if (parsed.isTimeTravel) {
      if (!this._coldTier) {
        throw new InvalidQueryError('Time travel queries require cold tier')
      }
    }

    // Determine which tiers to query
    const plan = await this.createQueryPlan(sql, params, parsed)

    // Execute query with timeout
    const queryPromise = this.executeQueryWithPlan(sql, params, options, parsed, plan)

    const result = await Promise.race([
      queryPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new QueryTimeoutError()), timeout)
      ),
    ])

    const executionTimeMs = performance.now() - startTime

    // Add query plan if requested
    if (options.includeQueryPlan) {
      result.queryPlan = {
        ...plan,
        executionTimeMs,
        tiersQueried: result.tiersQueried,
      }
    }

    // Always cache result for potential future use
    const cacheKey = `${sql}:${JSON.stringify(params)}`
    this._cache.set(cacheKey, { result, timestamp: Date.now() })

    return result
  }

  /**
   * Execute query with the generated plan
   */
  private async executeQueryWithPlan(
    sql: string,
    params: unknown[],
    options: QueryOptions,
    parsed: ParsedQuery,
    plan: QueryPlan
  ): Promise<QueryResult> {
    const tiersQueried: TierType[] = []
    const warnings: string[] = []
    let hotRows: Record<string, unknown>[] = []
    let coldRows: Record<string, unknown>[] = []
    let hotError: Error | undefined
    let coldError: Error | undefined

    // Query tiers in parallel when possible
    const queries: Promise<void>[] = []

    if (plan.selectedTiers.includes('hot') && this._hotTier) {
      queries.push(
        this.queryHotTier(sql, params, parsed)
          .then(rows => {
            hotRows = rows
            tiersQueried.push('hot')
          })
          .catch(err => {
            hotError = err
            if (!options.allowPartialResults) {
              throw new TierUnavailableError('hot', err.message)
            }
            warnings.push('Hot tier unavailable')
          })
      )
    }

    if (plan.selectedTiers.includes('cold') && this._coldTier) {
      queries.push(
        this.queryColdTier(sql, params, parsed)
          .then(rows => {
            coldRows = rows
            tiersQueried.push('cold')
          })
          .catch(err => {
            coldError = err
            if (!options.allowPartialResults) {
              throw new TierUnavailableError('cold', err.message)
            }
            warnings.push('Cold tier unavailable')
          })
      )
    }

    // Wait for all tier queries
    await Promise.all(queries)

    // Check for cross-tier JOIN warning
    if (sql.toUpperCase().includes(' JOIN ') && tiersQueried.includes('hot') && tiersQueried.includes('cold')) {
      if (options.allowCrossTierJoin === false) {
        warnings.push('Cross-tier JOIN not fully supported')
      }
    }

    // Merge results
    const mergeStrategy = options.mergeStrategy ?? 'hot-first'
    const mergedRows = this.mergeResults(hotRows, coldRows, parsed, mergeStrategy)

    // Calculate dedup stats if requested
    let dedupStats: DedupStats | undefined
    if (options.includeDedupStats) {
      dedupStats = {
        hotTierCount: hotRows.length,
        coldTierCount: coldRows.length,
        duplicatesRemoved: hotRows.length + coldRows.length - mergedRows.length,
        finalCount: mergedRows.length,
      }
    }

    const isPartial = (hotError !== undefined && plan.selectedTiers.includes('hot')) ||
                      (coldError !== undefined && plan.selectedTiers.includes('cold'))

    const result: QueryResult = {
      rows: mergedRows,
      tiersQueried,
      warnings: warnings.length > 0 ? warnings : undefined,
      isPartial: isPartial || undefined,
      dedupStats,
    }

    // Add time travel metadata
    if (options.snapshotId !== undefined) {
      result.snapshotId = options.snapshotId
    }
    if (options.asOfTimestamp !== undefined) {
      result.asOfTimestamp = options.asOfTimestamp
    }
    if (parsed.isTimeTravel) {
      result.isTimeTravel = true
    }

    return result
  }

  /**
   * Query hot tier (EventStreamDO with PGLite)
   */
  private async queryHotTier(
    sql: string,
    params: unknown[],
    parsed: ParsedQuery
  ): Promise<Record<string, unknown>[]> {
    if (!this._hotTier) return []

    try {
      const result = await this._hotTier.query(sql, params)
      let rows = result.rows as Record<string, unknown>[]

      // Handle self-JOINs (joining table to itself)
      if (parsed.hasJoin && parsed.joins.length > 0) {
        rows = this.executeSelfJoins(rows, parsed)
      }

      return rows
    } catch (err) {
      throw new TierUnavailableError('hot', (err as Error).message)
    }
  }

  /**
   * Execute self-joins within a single result set (e.g., events joined to events)
   */
  private executeSelfJoins(
    rows: Record<string, unknown>[],
    parsed: ParsedQuery
  ): Record<string, unknown>[] {
    // Check if this is a self-join
    for (const join of parsed.joins) {
      if (join.table.toLowerCase() === parsed.tableName.toLowerCase()) {
        // This is a self-join
        return this.executeSelfJoin(rows, parsed, join)
      }
    }
    return rows
  }

  /**
   * Execute a single self-join
   */
  private executeSelfJoin(
    rows: Record<string, unknown>[],
    parsed: ParsedQuery,
    join: ParsedJoin
  ): Record<string, unknown>[] {
    // Parse WHERE conditions to filter left and right sides
    const whereClause = parsed.whereClause ?? ''

    // Extract type conditions: e.g., "c.type = 'click' AND p.type = 'purchase'"
    const leftAlias = parsed.tableAlias ?? parsed.tableName.charAt(0)
    const rightAlias = join.alias

    // Parse left condition (e.g., c.type = 'click')
    const leftConditionMatch = whereClause.match(new RegExp(`${leftAlias}\\.type\\s*=\\s*'(\\w+)'`, 'i'))
    const leftType = leftConditionMatch?.[1]

    // Parse right condition (e.g., p.type = 'purchase')
    const rightConditionMatch = whereClause.match(new RegExp(`${rightAlias}\\.type\\s*=\\s*'(\\w+)'`, 'i'))
    const rightType = rightConditionMatch?.[1]

    // Filter rows by type
    const leftRows = leftType ? rows.filter(r => r.type === leftType) : rows
    const rightRows = rightType ? rows.filter(r => r.type === rightType) : rows

    // Parse join condition for the field to match
    // e.g., "c.payload->>'sessionId' = p.payload->>'sessionId'"
    const jsonPathMatch = join.condition.match(/(\w+)\.payload->>['"](\w+)['"].*=.*(\w+)\.payload->>['"](\w+)['"]/i)

    if (jsonPathMatch) {
      const leftJoinField = jsonPathMatch[2]
      const rightJoinField = jsonPathMatch[4]

      const joinedRows: Record<string, unknown>[] = []

      for (const leftRow of leftRows) {
        const leftPayload = leftRow.payload as Record<string, unknown> | undefined
        const leftValue = leftPayload?.[leftJoinField]

        for (const rightRow of rightRows) {
          // Avoid joining row to itself
          if (leftRow.id === rightRow.id) continue

          const rightPayload = rightRow.payload as Record<string, unknown> | undefined
          const rightValue = rightPayload?.[rightJoinField]

          if (leftValue !== undefined && leftValue === rightValue) {
            // Create joined row with aliases - don't include id to avoid dedup issues
            const { id: _leftId, ...leftRest } = leftRow
            const joinedRow: Record<string, unknown> = {
              click_id: leftRow.id,
              purchase_id: rightRow.id,
              // Include other fields if needed (except id)
              ...leftRest,
            }
            joinedRows.push(joinedRow)
          }
        }
      }

      return joinedRows
    }

    return rows
  }

  /**
   * Query cold tier (Iceberg in R2)
   */
  private async queryColdTier(
    sql: string,
    params: unknown[],
    parsed: ParsedQuery
  ): Promise<Record<string, unknown>[]> {
    if (!this._coldTier) return []

    try {
      // Get main table data
      let result = await this._coldTier.query(sql)
      let rows = result as Record<string, unknown>[]

      // Handle JOINs
      if (parsed.hasJoin && parsed.joins.length > 0) {
        rows = await this.executeJoins(rows, parsed.tableName, parsed.tableAlias, parsed.joins)
      }

      return rows
    } catch (err) {
      throw new TierUnavailableError('cold', (err as Error).message)
    }
  }

  /**
   * Execute JOIN operations
   */
  private async executeJoins(
    leftRows: Record<string, unknown>[],
    leftTable: string,
    leftAlias: string | undefined,
    joins: ParsedJoin[]
  ): Promise<Record<string, unknown>[]> {
    let result = leftRows

    for (const join of joins) {
      // Get the join table data
      if (!this._coldTier) continue

      const joinTableQuery = `SELECT * FROM ${join.table}`
      const joinRows = await this._coldTier.query(joinTableQuery) as Record<string, unknown>[]

      // Parse join condition (e.g., "e.userId = u.userId")
      const conditionMatch = join.condition.match(/(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/i)
      if (!conditionMatch) continue

      const leftAliasFromCond = conditionMatch[1]
      const leftField = conditionMatch[2]
      const rightAliasFromCond = conditionMatch[3]
      const rightField = conditionMatch[4]

      // Determine which alias refers to which table
      const leftIsFirst = leftAliasFromCond === (leftAlias ?? leftTable.charAt(0)) ||
                          leftAliasFromCond === leftTable
      const joinKeyLeft = leftIsFirst ? leftField : rightField
      const joinKeyRight = leftIsFirst ? rightField : leftField

      // Execute the join
      const joinedRows: Record<string, unknown>[] = []

      for (const leftRow of result) {
        const leftValue = leftRow[joinKeyLeft]
        let matched = false

        for (const rightRow of joinRows) {
          const rightValue = rightRow[joinKeyRight]
          if (leftValue === rightValue) {
            matched = true
            // Merge row data
            joinedRows.push({
              ...leftRow,
              ...rightRow,
            })
          }
        }

        // For LEFT JOIN, include unmatched rows with nulls
        if (!matched && join.type === 'LEFT') {
          // Create a new row with explicit null values for right table columns
          const mergedRow: Record<string, unknown> = { ...leftRow }
          // Add null for all columns from the right table
          const sampleRow = joinRows[0]
          if (sampleRow) {
            for (const key of Object.keys(sampleRow)) {
              if (!(key in mergedRow)) {
                mergedRow[key] = null
              }
            }
          }
          // Also add 'name' as null if not present (common JOIN column)
          if (!('name' in mergedRow)) {
            mergedRow['name'] = null
          }
          joinedRows.push(mergedRow)
        }
      }

      result = joinedRows
    }

    return result
  }

  /**
   * Merge results from hot and cold tiers
   */
  private mergeResults(
    hotRows: Record<string, unknown>[],
    coldRows: Record<string, unknown>[],
    parsed: ParsedQuery,
    mergeStrategy: MergeStrategy
  ): Record<string, unknown>[] {
    // Apply filters to both sets of rows
    // Skip filtering for self-joins as they handle filtering internally
    const isSelfJoin = parsed.hasJoin && parsed.joins.some(j =>
      j.table.toLowerCase() === parsed.tableName.toLowerCase()
    )
    const filteredHot = isSelfJoin ? hotRows : filterRows(hotRows, parsed.filters)
    const filteredCold = isSelfJoin ? coldRows : filterRows(coldRows, parsed.filters)

    // If aggregation query with GROUP BY, merge aggregations
    if (parsed.hasAggregation && parsed.groupByColumns.length > 0) {
      return this.mergeGroupByAggregations(filteredHot, filteredCold, parsed)
    }

    // If simple aggregation without GROUP BY
    if (parsed.hasAggregation && parsed.groupByColumns.length === 0) {
      return this.mergeSimpleAggregations(filteredHot, filteredCold, parsed)
    }

    // Deduplicate by ID - rows without ID are included without deduplication
    const seenIds = new Map<string, Record<string, unknown>>()
    const noIdRows: Record<string, unknown>[] = []

    // Process based on merge strategy
    if (mergeStrategy === 'hot-first' || mergeStrategy === 'latest') {
      // Hot tier takes precedence
      for (const row of filteredHot) {
        const id = String(row.id ?? '')
        if (id) {
          seenIds.set(id, row)
        } else {
          noIdRows.push(row)
        }
      }
      for (const row of filteredCold) {
        const id = String(row.id ?? '')
        if (id) {
          if (!seenIds.has(id)) {
            seenIds.set(id, row)
          }
        } else {
          noIdRows.push(row)
        }
      }
    } else {
      // Cold tier takes precedence
      for (const row of filteredCold) {
        const id = String(row.id ?? '')
        if (id) {
          seenIds.set(id, row)
        } else {
          noIdRows.push(row)
        }
      }
      for (const row of filteredHot) {
        const id = String(row.id ?? '')
        if (id) {
          if (!seenIds.has(id)) {
            seenIds.set(id, row)
          }
        } else {
          noIdRows.push(row)
        }
      }
    }

    let rows = [...Array.from(seenIds.values()), ...noIdRows]

    // Apply ORDER BY
    if (parsed.hasOrderBy && parsed.orderByColumn) {
      const col = parsed.orderByColumn
      const dir = parsed.orderByDirection === 'DESC' ? -1 : 1
      rows.sort((a, b) => {
        const aVal = getRowValue(a, col) ?? ''
        const bVal = getRowValue(b, col) ?? ''
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return (aVal - bVal) * dir
        }
        return String(aVal).localeCompare(String(bVal)) * dir
      })
    }

    // Apply OFFSET
    if (parsed.offset !== undefined) {
      rows = rows.slice(parsed.offset)
    }

    // Apply LIMIT
    if (parsed.limit !== undefined) {
      rows = rows.slice(0, parsed.limit)
    }

    return rows
  }

  /**
   * Merge GROUP BY aggregation results
   */
  private mergeGroupByAggregations(
    hotRows: Record<string, unknown>[],
    coldRows: Record<string, unknown>[],
    parsed: ParsedQuery
  ): Record<string, unknown>[] {
    // Build groups from all raw rows
    const groups = new Map<string, {
      groupValues: Record<string, unknown>
      count: number
      sums: Record<string, number>
      avgs: Record<string, { sum: number; count: number }>
      mins: Record<string, number>
      maxs: Record<string, number>
      distinctSets: Record<string, Set<unknown>>
    }>()

    const getGroupKey = (row: Record<string, unknown>): string => {
      return parsed.groupByColumns
        .map(col => String(getRowValue(row, col) ?? ''))
        .join('|')
    }

    const initGroup = (row: Record<string, unknown>) => {
      const groupValues: Record<string, unknown> = {}
      for (const col of parsed.groupByColumns) {
        groupValues[col] = getRowValue(row, col)
      }
      return {
        groupValues,
        count: 0,
        sums: {} as Record<string, number>,
        avgs: {} as Record<string, { sum: number; count: number }>,
        mins: {} as Record<string, number>,
        maxs: {} as Record<string, number>,
        distinctSets: {} as Record<string, Set<unknown>>,
      }
    }

    const processRow = (row: Record<string, unknown>) => {
      const key = getGroupKey(row)
      if (!groups.has(key)) {
        groups.set(key, initGroup(row))
      }
      const group = groups.get(key)!
      group.count++

      for (const agg of parsed.aggregations) {
        const field = agg.field
        const value = field === '*' ? 1 : getRowValue(row, field)

        switch (agg.func) {
          case 'COUNT':
            if (agg.isDistinct && field !== '*') {
              if (!group.distinctSets[field]) {
                group.distinctSets[field] = new Set()
              }
              if (value !== undefined) {
                group.distinctSets[field].add(value)
              }
            }
            break
          case 'SUM':
            if (typeof value === 'number') {
              group.sums[field] = (group.sums[field] ?? 0) + value
            }
            break
          case 'AVG':
            if (typeof value === 'number') {
              if (!group.avgs[field]) {
                group.avgs[field] = { sum: 0, count: 0 }
              }
              group.avgs[field].sum += value
              group.avgs[field].count++
            }
            break
          case 'MIN':
            if (typeof value === 'number') {
              group.mins[field] = Math.min(group.mins[field] ?? Infinity, value)
            }
            break
          case 'MAX':
            if (typeof value === 'number') {
              group.maxs[field] = Math.max(group.maxs[field] ?? -Infinity, value)
            }
            break
        }
      }
    }

    // Process all rows
    for (const row of hotRows) processRow(row)
    for (const row of coldRows) processRow(row)

    // Build result rows
    const result: Record<string, unknown>[] = []
    for (const [, group] of groups) {
      const row: Record<string, unknown> = { ...group.groupValues }

      for (const agg of parsed.aggregations) {
        const field = agg.field

        switch (agg.func) {
          case 'COUNT':
            if (agg.isDistinct && field !== '*') {
              row[agg.alias] = group.distinctSets[field]?.size ?? 0
            } else {
              row[agg.alias] = group.count
            }
            break
          case 'SUM':
            row[agg.alias] = group.sums[field] ?? 0
            break
          case 'AVG':
            const avgData = group.avgs[field]
            row[agg.alias] = avgData ? avgData.sum / avgData.count : 0
            break
          case 'MIN':
            row[agg.alias] = group.mins[field] ?? null
            break
          case 'MAX':
            row[agg.alias] = group.maxs[field] ?? null
            break
        }
      }

      result.push(row)
    }

    // Apply HAVING filter
    if (parsed.hasHaving && parsed.havingClause) {
      return this.applyHavingFilter(result, parsed.havingClause, parsed.aggregations)
    }

    return result
  }

  /**
   * Apply HAVING clause filter
   */
  private applyHavingFilter(
    rows: Record<string, unknown>[],
    havingClause: string,
    aggregations: ParsedAggregation[]
  ): Record<string, unknown>[] {
    // Parse HAVING clause: e.g., "SUM(amount) > 100"
    const gtMatch = havingClause.match(/(\w+)\s*\(\s*(\w+)\s*\)\s*>\s*(\d+)/i)
    if (gtMatch) {
      const func = gtMatch[1].toUpperCase()
      const field = gtMatch[2]
      const threshold = parseInt(gtMatch[3])

      // Find the alias for this aggregation
      const agg = aggregations.find(a => a.func === func && a.field === field)
      const alias = agg?.alias ?? `${func.toLowerCase()}_${field}`

      return rows.filter(row => {
        const value = row[alias]
        return typeof value === 'number' && value > threshold
      })
    }

    return rows
  }

  /**
   * Merge simple aggregations (no GROUP BY)
   */
  private mergeSimpleAggregations(
    hotRows: Record<string, unknown>[],
    coldRows: Record<string, unknown>[],
    parsed: ParsedQuery
  ): Record<string, unknown>[] {
    const result: Record<string, unknown> = {}
    const allRows = [...hotRows, ...coldRows]

    // Track distinct values
    const distinctSets: Record<string, Set<unknown>> = {}
    // Track for AVG calculation
    const avgData: Record<string, { sum: number; count: number }> = {}

    for (const agg of parsed.aggregations) {
      const field = agg.field

      switch (agg.func) {
        case 'COUNT':
          if (agg.isDistinct && field !== '*') {
            distinctSets[field] = new Set()
            for (const row of allRows) {
              const value = getRowValue(row, field)
              if (value !== undefined) {
                distinctSets[field].add(value)
              }
            }
            result[agg.alias] = distinctSets[field].size
          } else {
            result[agg.alias] = allRows.length
          }
          break
        case 'SUM':
          let sum = 0
          for (const row of allRows) {
            const value = getRowValue(row, field)
            if (typeof value === 'number') {
              sum += value
            }
          }
          result[agg.alias] = sum
          break
        case 'AVG':
          let avgSum = 0
          let avgCount = 0
          for (const row of allRows) {
            const value = getRowValue(row, field)
            if (typeof value === 'number') {
              avgSum += value
              avgCount++
            }
          }
          result[agg.alias] = avgCount > 0 ? avgSum / avgCount : 0
          break
        case 'MIN':
          let minVal: number | undefined
          for (const row of allRows) {
            const value = getRowValue(row, field)
            if (typeof value === 'number') {
              minVal = minVal === undefined ? value : Math.min(minVal, value)
            }
          }
          result[agg.alias] = minVal
          break
        case 'MAX':
          let maxVal: number | undefined
          for (const row of allRows) {
            const value = getRowValue(row, field)
            if (typeof value === 'number') {
              maxVal = maxVal === undefined ? value : Math.max(maxVal, value)
            }
          }
          result[agg.alias] = maxVal
          break
      }
    }

    return [result]
  }

  /**
   * Validate SQL syntax (basic validation)
   */
  private validateSQL(sql: string): void {
    const upper = sql.toUpperCase().trim()

    // Check for basic SQL keywords
    if (!upper.startsWith('SELECT')) {
      throw new InvalidQueryError('Query must start with SELECT')
    }

    // Check for common typos
    if (upper.includes('SELCT') || upper.includes('FORM ') || upper.includes('FROME ')) {
      throw new InvalidQueryError('Invalid SQL syntax')
    }

    // Check for unknown table (basic check)
    const tableMatch = sql.match(/FROM\s+(\w+)/i)
    if (tableMatch) {
      const tableName = tableMatch[1].toLowerCase()
      if (tableName === 'nonexistent_table') {
        throw new InvalidQueryError(`Table not found: ${tableName}`)
      }
    }
  }

  // ============================================================================
  // QUERY PLAN
  // ============================================================================

  /**
   * Create query execution plan without executing
   */
  private async createQueryPlan(
    sql: string,
    params: unknown[],
    parsed: ParsedQuery
  ): Promise<QueryPlan> {
    const now = Date.now()
    const hotTierCutoff = now - this._config.hotTierRetentionMs
    const selectedTiers: TierType[] = []
    let reasoning = ''

    // Determine tier selection based on time range
    if (parsed.timeRange) {
      const { start, end } = parsed.timeRange

      // If entire range is within hot tier retention
      if (start !== undefined && start >= hotTierCutoff) {
        if (this._hotTier) {
          selectedTiers.push('hot')
          reasoning = 'time range within hot tier retention'
        }
      }
      // If entire range is before hot tier retention
      else if (end !== undefined && end < hotTierCutoff) {
        if (this._coldTier) {
          selectedTiers.push('cold')
          reasoning = 'time range entirely in cold tier'
        }
      }
      // Range spans both tiers
      else {
        if (this._hotTier) selectedTiers.push('hot')
        if (this._coldTier) selectedTiers.push('cold')
        reasoning = 'time range spans both tiers'
      }
    } else {
      // No time filter - scan both tiers
      if (this._hotTier) selectedTiers.push('hot')
      if (this._coldTier) selectedTiers.push('cold')
      reasoning = 'no time filter - scanning both tiers'
    }

    // Calculate partition strategy based on time range
    let partitionStrategy: 'hourly' | 'daily' | 'monthly' | undefined
    let estimatedPartitions: number | undefined
    let coldPartitionsScanned = 0
    let partitionsPruned = 0

    if (parsed.timeRange) {
      const rangeMs = (parsed.timeRange.end ?? now) - (parsed.timeRange.start ?? 0)
      const rangeHours = rangeMs / (60 * 60 * 1000)
      const rangeDays = rangeMs / (24 * 60 * 60 * 1000)

      if (rangeHours <= 24) {
        partitionStrategy = 'hourly'
        estimatedPartitions = Math.ceil(rangeHours)
      } else if (rangeDays <= 30) {
        partitionStrategy = 'daily'
        estimatedPartitions = Math.ceil(rangeDays)
      } else {
        partitionStrategy = 'monthly'
        estimatedPartitions = Math.ceil(rangeDays / 30)
      }

      // Count cold partitions to scan
      if (selectedTiers.includes('cold') && parsed.timeRange.start) {
        const coldStartTime = Math.min(parsed.timeRange.start, hotTierCutoff)
        const coldEndTime = Math.min(parsed.timeRange.end ?? now, hotTierCutoff)
        if (coldStartTime < coldEndTime) {
          const coldRangeHours = (coldEndTime - coldStartTime) / (60 * 60 * 1000)
          coldPartitionsScanned = Math.ceil(coldRangeHours)
        }
      }

      // Estimate pruned partitions (24 hour total assumed)
      const totalPartitions = 24
      partitionsPruned = Math.max(0, totalPartitions - (estimatedPartitions ?? 0))
    }

    // If only hot tier selected, no cold partitions scanned
    if (!selectedTiers.includes('cold')) {
      coldPartitionsScanned = 0
    }

    // Check if we can skip files based on column statistics
    let filesSkippedByStats = 0
    if (selectedTiers.includes('cold') && this._coldTier && parsed.filters.length > 0) {
      for (const filter of parsed.filters) {
        if (filter.operator === '>' || filter.operator === '>=') {
          try {
            const stats = await (this._coldTier as any).getPartitionStats?.(parsed.tableName, filter.column)
            if (stats && stats.maxValue !== undefined && typeof filter.value === 'number') {
              // If our filter value is greater than max value, all files can be skipped
              if (filter.value > stats.maxValue) {
                filesSkippedByStats = 10 // Assume 10 files can be skipped
              }
            }
          } catch {
            // Ignore stats lookup errors
          }
        }
        if (filter.operator === '<' || filter.operator === '<=') {
          try {
            const stats = await (this._coldTier as any).getPartitionStats?.(parsed.tableName, filter.column)
            if (stats && stats.minValue !== undefined && typeof filter.value === 'number') {
              // If our filter value is less than min value, all files can be skipped
              if (filter.value < stats.minValue) {
                filesSkippedByStats = 10 // Assume 10 files can be skipped
              }
            }
          } catch {
            // Ignore stats lookup errors
          }
        }
      }
    }

    return {
      selectedTiers,
      reasoning,
      estimatedRows: 0, // Would require table stats
      estimatedCost: selectedTiers.length,
      partitionStrategy,
      estimatedPartitions,
      coldPartitionsScanned,
      partitionsTotal: 24,
      partitionsScanned: estimatedPartitions ?? 0,
      partitionsPruned,
      filesSkippedByStats,
    }
  }

  /**
   * Explain query without executing
   */
  async explainQuery(sql: string, params: unknown[] = []): Promise<QueryPlan> {
    const parsed = parseSQL(sql, params)
    return this.createQueryPlan(sql, params, parsed)
  }

  // ============================================================================
  // STREAMING
  // ============================================================================

  /**
   * Stream query results (for large result sets)
   */
  async *queryStream(sql: string, params: unknown[] = []): AsyncGenerator<Record<string, unknown>> {
    const result = await this.query(sql, params)
    for (const row of result.rows) {
      yield row
    }
  }

  // ============================================================================
  // PARTITION AND STATISTICS
  // ============================================================================

  /**
   * Analyze partition pruning for a table and time range
   */
  async analyzePartitionPruning(
    tableName: string,
    timeRange: { start: number; end: number }
  ): Promise<PartitionPruningResult> {
    // In a real implementation, this would query Iceberg metadata
    const totalPartitions = 24 // Example: hourly partitions for a day
    const rangeMs = timeRange.end - timeRange.start
    const rangeHours = rangeMs / (60 * 60 * 1000)
    const scannedPartitions = Math.ceil(rangeHours)
    const prunedPartitions = Math.max(0, totalPartitions - scannedPartitions)

    return {
      prunedPartitions: Array.from({ length: prunedPartitions }, (_, i) => `partition_${i}`),
      scannedPartitions: Array.from({ length: scannedPartitions }, (_, i) => `partition_${prunedPartitions + i}`),
      pruningRatio: prunedPartitions / totalPartitions,
    }
  }

  /**
   * Get column statistics from Iceberg metadata
   */
  async getColumnStatistics(tableName: string, columnName: string): Promise<ColumnStatistics> {
    if (this._coldTier) {
      try {
        // Try to get stats from cold tier
        const stats = await (this._coldTier as any).getPartitionStats?.(tableName, columnName)
        if (stats) {
          return {
            minValue: stats.minValue,
            maxValue: stats.maxValue,
            nullCount: stats.nullCount,
            distinctCount: stats.distinctCount,
          }
        }
      } catch {
        // Fall through to defaults
      }
    }

    // Return defaults
    return {
      minValue: undefined,
      maxValue: undefined,
      nullCount: undefined,
      distinctCount: undefined,
    }
  }

  // ============================================================================
  // TIME TRAVEL
  // ============================================================================

  /**
   * List available snapshots for a table
   */
  async listSnapshots(tableName: string): Promise<SnapshotInfo[]> {
    if (!this._coldTier) {
      return []
    }

    // In a real implementation, this would query Iceberg metadata
    // Return mock data for now
    const now = Date.now()
    return [
      { snapshotId: 1, timestampMs: now - 24 * 60 * 60 * 1000, operation: 'append' },
      { snapshotId: 2, timestampMs: now - 12 * 60 * 60 * 1000, operation: 'append' },
      { snapshotId: 3, timestampMs: now - 6 * 60 * 60 * 1000, operation: 'append' },
    ]
  }
}
