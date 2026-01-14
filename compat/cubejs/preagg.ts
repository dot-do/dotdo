/**
 * @dotdo/cubejs - Pre-aggregation Engine
 *
 * Provides pre-aggregation table creation, scheduled refresh, and query routing.
 * Pre-aggregations improve query performance by pre-computing aggregations.
 *
 * @example
 * ```typescript
 * import { PreAggregationEngine, cube } from '@dotdo/cubejs'
 *
 * const Orders = cube('Orders', {
 *   sql: 'SELECT * FROM orders',
 *   measures: { count: { type: 'count' } },
 *   dimensions: { status: { sql: 'status', type: 'string' } },
 *   preAggregations: {
 *     ordersDaily: {
 *       type: 'rollup',
 *       measureReferences: ['count'],
 *       dimensionReferences: ['status'],
 *       timeDimensionReference: 'createdAt',
 *       granularity: 'day',
 *       scheduledRefresh: true,
 *       refreshKey: { every: '1 hour' },
 *     },
 *   },
 * })
 *
 * const engine = new PreAggregationEngine({
 *   schemas: [Orders],
 *   executor: (sql) => db.query(sql),
 * })
 *
 * // Build pre-aggregation tables
 * await engine.buildAll()
 *
 * // Start scheduled refresh
 * engine.startScheduler()
 *
 * // Route queries to pre-aggregations
 * const result = await engine.executeQuery({
 *   measures: ['Orders.count'],
 *   dimensions: ['Orders.status'],
 * })
 * ```
 */

import type { CubeSchema, PreAggregation, Granularity, RefreshKey } from './schema'
import type { CubeQuery, TimeDimension } from './query'
import { PreAggregationError } from './errors'

// =============================================================================
// Types
// =============================================================================

/**
 * Pre-aggregation table metadata
 */
export interface PreAggregationTable {
  /**
   * Table name in the database
   */
  tableName: string

  /**
   * Cube name
   */
  cubeName: string

  /**
   * Pre-aggregation name
   */
  preAggName: string

  /**
   * Pre-aggregation configuration
   */
  config: PreAggregation

  /**
   * Last refresh timestamp
   */
  lastRefreshAt?: Date

  /**
   * Next scheduled refresh
   */
  nextRefreshAt?: Date

  /**
   * Whether the table is currently being built
   */
  isBuilding: boolean

  /**
   * Last build duration in milliseconds
   */
  lastBuildDuration?: number

  /**
   * Row count in the table
   */
  rowCount?: number

  /**
   * Partitions for partitioned pre-aggregations
   */
  partitions?: PreAggregationPartition[]
}

/**
 * Pre-aggregation partition
 */
export interface PreAggregationPartition {
  /**
   * Partition key (e.g., '2024-01' for monthly)
   */
  partitionKey: string

  /**
   * Partition table name
   */
  tableName: string

  /**
   * Last refresh timestamp
   */
  lastRefreshAt?: Date

  /**
   * Row count
   */
  rowCount?: number
}

/**
 * SQL executor function type
 */
export type SQLExecutor = (sql: string, params?: unknown[]) => Promise<unknown[]>

/**
 * Pre-aggregation engine options
 */
export interface PreAggregationEngineOptions {
  /**
   * Cube schemas to process
   */
  schemas: CubeSchema[]

  /**
   * SQL executor function
   */
  executor: SQLExecutor

  /**
   * Table name prefix
   * @default 'preagg_'
   */
  tablePrefix?: string

  /**
   * Schema/database for pre-aggregation tables
   */
  targetSchema?: string

  /**
   * Time zone for date calculations
   * @default 'UTC'
   */
  timezone?: string

  /**
   * Callback when a pre-aggregation is refreshed
   */
  onRefresh?: (table: PreAggregationTable) => void

  /**
   * Callback when a build fails
   */
  onError?: (error: Error, table: PreAggregationTable) => void

  /**
   * Maximum concurrent builds
   * @default 2
   */
  maxConcurrentBuilds?: number
}

/**
 * Refresh interval parsing result
 */
interface ParsedInterval {
  value: number
  unit: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month'
}

/**
 * Query routing result
 */
export interface QueryRoutingResult {
  /**
   * Whether a pre-aggregation can be used
   */
  canUsePreAgg: boolean

  /**
   * The matched pre-aggregation table
   */
  preAggTable?: PreAggregationTable

  /**
   * Rewritten SQL for the pre-aggregation table
   */
  rewrittenSQL?: string

  /**
   * Original SQL if pre-aggregation cannot be used
   */
  originalSQL?: string

  /**
   * Reason if pre-aggregation cannot be used
   */
  reason?: string
}

// =============================================================================
// Granularity Helpers
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

/**
 * Get SQL date truncation function for a granularity
 */
function getDateTruncSQL(column: string, granularity: Granularity): string {
  switch (granularity) {
    case 'year':
      return `DATE_TRUNC('year', ${column})`
    case 'quarter':
      return `DATE_TRUNC('quarter', ${column})`
    case 'month':
      return `DATE_TRUNC('month', ${column})`
    case 'week':
      return `DATE_TRUNC('week', ${column})`
    case 'day':
      return `DATE_TRUNC('day', ${column})`
    case 'hour':
      return `DATE_TRUNC('hour', ${column})`
    case 'minute':
      return `DATE_TRUNC('minute', ${column})`
    case 'second':
      return `DATE_TRUNC('second', ${column})`
    default:
      return column
  }
}

// =============================================================================
// Pre-aggregation Engine
// =============================================================================

/**
 * Pre-aggregation engine for creating, refreshing, and routing queries
 */
export class PreAggregationEngine {
  private schemas: Map<string, CubeSchema>
  private tables: Map<string, PreAggregationTable>
  private executor: SQLExecutor
  private tablePrefix: string
  private targetSchema?: string
  private timezone: string
  private onRefresh?: (table: PreAggregationTable) => void
  private onError?: (error: Error, table: PreAggregationTable) => void
  private maxConcurrentBuilds: number
  private currentBuilds: number = 0
  private buildQueue: (() => Promise<void>)[] = []
  private schedulerInterval?: ReturnType<typeof setInterval>
  private isSchedulerRunning: boolean = false

  constructor(options: PreAggregationEngineOptions) {
    this.schemas = new Map()
    this.tables = new Map()
    this.executor = options.executor
    this.tablePrefix = options.tablePrefix ?? 'preagg_'
    this.targetSchema = options.targetSchema
    this.timezone = options.timezone ?? 'UTC'
    this.onRefresh = options.onRefresh
    this.onError = options.onError
    this.maxConcurrentBuilds = options.maxConcurrentBuilds ?? 2

    // Register schemas and discover pre-aggregations
    for (const schema of options.schemas) {
      this.registerSchema(schema)
    }
  }

  // ===========================================================================
  // Schema Registration
  // ===========================================================================

  /**
   * Register a cube schema and its pre-aggregations
   */
  registerSchema(schema: CubeSchema): void {
    this.schemas.set(schema.name, schema)

    if (schema.preAggregations) {
      for (const [name, config] of Object.entries(schema.preAggregations)) {
        const tableName = this.generateTableName(schema.name, name)
        const key = `${schema.name}.${name}`

        this.tables.set(key, {
          tableName,
          cubeName: schema.name,
          preAggName: name,
          config,
          isBuilding: false,
        })
      }
    }
  }

  /**
   * Generate a table name for a pre-aggregation
   */
  private generateTableName(cubeName: string, preAggName: string): string {
    const baseName = `${this.tablePrefix}${cubeName.toLowerCase()}_${preAggName.toLowerCase()}`
    return this.targetSchema ? `${this.targetSchema}.${baseName}` : baseName
  }

  // ===========================================================================
  // Table Creation
  // ===========================================================================

  /**
   * Generate CREATE TABLE SQL for a pre-aggregation
   */
  generateCreateTableSQL(cubeName: string, preAggName: string): string {
    const key = `${cubeName}.${preAggName}`
    const table = this.tables.get(key)
    if (!table) {
      throw new PreAggregationError(
        `Pre-aggregation not found: ${key}`,
        'not_found'
      )
    }

    const schema = this.schemas.get(cubeName)
    if (!schema) {
      throw new PreAggregationError(
        `Cube not found: ${cubeName}`,
        'cube_not_found'
      )
    }

    const { config } = table
    const columns: string[] = []
    const selectColumns: string[] = []

    // Add dimension columns
    if (config.dimensionReferences) {
      for (const dimRef of config.dimensionReferences) {
        const dim = schema.dimensions[dimRef]
        if (dim) {
          const columnType = this.dimensionTypeToSQL(dim.type)
          columns.push(`${dimRef} ${columnType}`)
          selectColumns.push(`${dim.sql} AS ${dimRef}`)
        }
      }
    }

    // Add time dimension column
    if (config.timeDimensionReference && config.granularity) {
      const timeDim = schema.dimensions[config.timeDimensionReference]
      if (timeDim) {
        columns.push(`${config.timeDimensionReference} TIMESTAMP`)
        const truncatedSQL = getDateTruncSQL(timeDim.sql, config.granularity)
        selectColumns.push(`${truncatedSQL} AS ${config.timeDimensionReference}`)
      }
    }

    // Add measure columns
    if (config.measureReferences) {
      for (const measureRef of config.measureReferences) {
        const measure = schema.measures[measureRef]
        if (measure) {
          columns.push(`${measureRef} NUMERIC`)
          selectColumns.push(this.measureToSelectSQL(measureRef, measure, schema))
        }
      }
    }

    // Build CREATE TABLE ... AS SELECT
    const groupByColumns = config.dimensionReferences?.length
      ? [...(config.dimensionReferences || [])]
      : []
    if (config.timeDimensionReference) {
      groupByColumns.push(config.timeDimensionReference)
    }

    const groupByClause = groupByColumns.length > 0
      ? `GROUP BY ${groupByColumns.map((_, i) => i + 1).join(', ')}`
      : ''

    const cubeSQL = schema.sqlTable || `(${schema.sql})`
    const alias = schema.sqlAlias || schema.name.toLowerCase()

    return `
CREATE TABLE ${table.tableName} AS
SELECT
  ${selectColumns.join(',\n  ')}
FROM ${cubeSQL} AS ${alias}
${groupByClause}
`.trim()
  }

  /**
   * Generate INSERT SQL for refreshing a pre-aggregation
   */
  generateRefreshSQL(
    cubeName: string,
    preAggName: string,
    dateRange?: [string, string]
  ): string {
    const key = `${cubeName}.${preAggName}`
    const table = this.tables.get(key)
    if (!table) {
      throw new PreAggregationError(
        `Pre-aggregation not found: ${key}`,
        'not_found'
      )
    }

    const schema = this.schemas.get(cubeName)
    if (!schema) {
      throw new PreAggregationError(
        `Cube not found: ${cubeName}`,
        'cube_not_found'
      )
    }

    const { config } = table
    const selectColumns: string[] = []

    // Add dimension columns
    if (config.dimensionReferences) {
      for (const dimRef of config.dimensionReferences) {
        const dim = schema.dimensions[dimRef]
        if (dim) {
          selectColumns.push(`${dim.sql} AS ${dimRef}`)
        }
      }
    }

    // Add time dimension column
    if (config.timeDimensionReference && config.granularity) {
      const timeDim = schema.dimensions[config.timeDimensionReference]
      if (timeDim) {
        const truncatedSQL = getDateTruncSQL(timeDim.sql, config.granularity)
        selectColumns.push(`${truncatedSQL} AS ${config.timeDimensionReference}`)
      }
    }

    // Add measure columns
    if (config.measureReferences) {
      for (const measureRef of config.measureReferences) {
        const measure = schema.measures[measureRef]
        if (measure) {
          selectColumns.push(this.measureToSelectSQL(measureRef, measure, schema))
        }
      }
    }

    // Build GROUP BY
    const groupByColumns = config.dimensionReferences?.length
      ? [...(config.dimensionReferences || [])]
      : []
    if (config.timeDimensionReference) {
      groupByColumns.push(config.timeDimensionReference)
    }

    const groupByClause = groupByColumns.length > 0
      ? `GROUP BY ${groupByColumns.map((_, i) => i + 1).join(', ')}`
      : ''

    // Build WHERE clause for incremental refresh
    let whereClause = ''
    if (dateRange && config.timeDimensionReference) {
      const timeDim = schema.dimensions[config.timeDimensionReference]
      if (timeDim) {
        whereClause = `WHERE ${timeDim.sql} >= '${dateRange[0]}' AND ${timeDim.sql} < '${dateRange[1]}'`
      }
    }

    const cubeSQL = schema.sqlTable || `(${schema.sql})`
    const alias = schema.sqlAlias || schema.name.toLowerCase()

    // For incremental, we delete old data and insert new
    const deleteSQL = dateRange && config.timeDimensionReference
      ? `DELETE FROM ${table.tableName} WHERE ${config.timeDimensionReference} >= '${dateRange[0]}' AND ${config.timeDimensionReference} < '${dateRange[1]}';\n`
      : `TRUNCATE TABLE ${table.tableName};\n`

    return `
${deleteSQL}
INSERT INTO ${table.tableName}
SELECT
  ${selectColumns.join(',\n  ')}
FROM ${cubeSQL} AS ${alias}
${whereClause}
${groupByClause}
`.trim()
  }

  /**
   * Convert dimension type to SQL type
   */
  private dimensionTypeToSQL(type: string): string {
    switch (type) {
      case 'number':
        return 'NUMERIC'
      case 'string':
        return 'TEXT'
      case 'boolean':
        return 'BOOLEAN'
      case 'time':
        return 'TIMESTAMP'
      default:
        return 'TEXT'
    }
  }

  /**
   * Convert measure to SELECT SQL
   */
  private measureToSelectSQL(
    name: string,
    measure: { type: string; sql?: string },
    schema: CubeSchema
  ): string {
    const sql = measure.sql || '*'

    switch (measure.type) {
      case 'count':
        return measure.sql ? `COUNT(${sql}) AS ${name}` : `COUNT(*) AS ${name}`
      case 'countDistinct':
        return `COUNT(DISTINCT ${sql}) AS ${name}`
      case 'countDistinctApprox':
        return `COUNT(DISTINCT ${sql}) AS ${name}`
      case 'sum':
        return `SUM(${sql}) AS ${name}`
      case 'avg':
        return `AVG(${sql}) AS ${name}`
      case 'min':
        return `MIN(${sql}) AS ${name}`
      case 'max':
        return `MAX(${sql}) AS ${name}`
      case 'number':
        return `${sql} AS ${name}`
      default:
        return `${sql} AS ${name}`
    }
  }

  // ===========================================================================
  // Build Operations
  // ===========================================================================

  /**
   * Build all pre-aggregation tables
   */
  async buildAll(): Promise<void> {
    const buildPromises: Promise<void>[] = []

    for (const [key, table] of this.tables) {
      buildPromises.push(this.build(table.cubeName, table.preAggName))
    }

    await Promise.allSettled(buildPromises)
  }

  /**
   * Build a specific pre-aggregation table
   */
  async build(cubeName: string, preAggName: string): Promise<void> {
    const key = `${cubeName}.${preAggName}`
    const table = this.tables.get(key)
    if (!table) {
      throw new PreAggregationError(
        `Pre-aggregation not found: ${key}`,
        'not_found'
      )
    }

    // Queue if at capacity
    if (this.currentBuilds >= this.maxConcurrentBuilds) {
      return new Promise((resolve, reject) => {
        this.buildQueue.push(async () => {
          try {
            await this.executeBuild(table)
            resolve()
          } catch (error) {
            reject(error)
          }
        })
      })
    }

    await this.executeBuild(table)
  }

  /**
   * Execute a build operation
   */
  private async executeBuild(table: PreAggregationTable): Promise<void> {
    if (table.isBuilding) return

    table.isBuilding = true
    this.currentBuilds++

    const startTime = Date.now()

    try {
      // Drop existing table
      await this.executor(`DROP TABLE IF EXISTS ${table.tableName}`)

      // Create new table
      const createSQL = this.generateCreateTableSQL(table.cubeName, table.preAggName)
      await this.executor(createSQL)

      // Get row count
      const countResult = await this.executor(
        `SELECT COUNT(*) as count FROM ${table.tableName}`
      ) as Array<{ count: number }>
      table.rowCount = countResult[0]?.count || 0

      // Update metadata
      table.lastRefreshAt = new Date()
      table.lastBuildDuration = Date.now() - startTime
      table.nextRefreshAt = this.calculateNextRefresh(table.config.refreshKey)

      this.onRefresh?.(table)
    } catch (error) {
      this.onError?.(error as Error, table)
      throw error
    } finally {
      table.isBuilding = false
      this.currentBuilds--

      // Process queue
      if (this.buildQueue.length > 0) {
        const nextBuild = this.buildQueue.shift()!
        nextBuild()
      }
    }
  }

  /**
   * Refresh a pre-aggregation (incremental if supported)
   */
  async refresh(
    cubeName: string,
    preAggName: string,
    options?: { dateRange?: [string, string] }
  ): Promise<void> {
    const key = `${cubeName}.${preAggName}`
    const table = this.tables.get(key)
    if (!table) {
      throw new PreAggregationError(
        `Pre-aggregation not found: ${key}`,
        'not_found'
      )
    }

    if (table.isBuilding) return

    table.isBuilding = true
    const startTime = Date.now()

    try {
      const refreshSQL = this.generateRefreshSQL(
        cubeName,
        preAggName,
        options?.dateRange
      )

      // Execute refresh (may be multiple statements)
      const statements = refreshSQL.split(';').filter((s) => s.trim())
      for (const stmt of statements) {
        await this.executor(stmt.trim())
      }

      // Update metadata
      const countResult = await this.executor(
        `SELECT COUNT(*) as count FROM ${table.tableName}`
      ) as Array<{ count: number }>
      table.rowCount = countResult[0]?.count || 0

      table.lastRefreshAt = new Date()
      table.lastBuildDuration = Date.now() - startTime
      table.nextRefreshAt = this.calculateNextRefresh(table.config.refreshKey)

      this.onRefresh?.(table)
    } catch (error) {
      this.onError?.(error as Error, table)
      throw error
    } finally {
      table.isBuilding = false
    }
  }

  // ===========================================================================
  // Scheduled Refresh
  // ===========================================================================

  /**
   * Start the refresh scheduler
   */
  startScheduler(intervalMs: number = 60000): void {
    if (this.isSchedulerRunning) return

    this.isSchedulerRunning = true
    this.schedulerInterval = setInterval(() => {
      this.checkAndRefresh()
    }, intervalMs)

    // Run immediately
    this.checkAndRefresh()
  }

  /**
   * Stop the refresh scheduler
   */
  stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval)
      this.schedulerInterval = undefined
    }
    this.isSchedulerRunning = false
  }

  /**
   * Check all pre-aggregations and refresh if needed
   */
  private async checkAndRefresh(): Promise<void> {
    const now = new Date()

    for (const [key, table] of this.tables) {
      // Skip if not scheduled for refresh
      if (!table.config.scheduledRefresh) continue

      // Skip if already building
      if (table.isBuilding) continue

      // Check if refresh is needed
      const needsRefresh = this.needsRefresh(table, now)
      if (needsRefresh) {
        try {
          await this.refresh(table.cubeName, table.preAggName)
        } catch (error) {
          // Error already handled via callback
        }
      }
    }
  }

  /**
   * Check if a pre-aggregation needs refresh
   */
  private needsRefresh(table: PreAggregationTable, now: Date): boolean {
    // Never refreshed
    if (!table.lastRefreshAt) return true

    // Check next scheduled refresh
    if (table.nextRefreshAt && now >= table.nextRefreshAt) return true

    // Check refresh key
    const refreshKey = table.config.refreshKey
    if (refreshKey?.every) {
      const interval = this.parseInterval(refreshKey.every)
      if (interval) {
        const nextRefresh = new Date(table.lastRefreshAt.getTime())
        this.addInterval(nextRefresh, interval)
        if (now >= nextRefresh) return true
      }
    }

    return false
  }

  /**
   * Calculate next refresh time
   */
  private calculateNextRefresh(refreshKey?: RefreshKey): Date | undefined {
    if (!refreshKey?.every) return undefined

    const interval = this.parseInterval(refreshKey.every)
    if (!interval) return undefined

    const next = new Date()
    this.addInterval(next, interval)
    return next
  }

  /**
   * Parse interval string (e.g., '1 hour', '30 minutes')
   */
  private parseInterval(intervalStr: string): ParsedInterval | undefined {
    const match = intervalStr.match(/^(\d+)\s*(second|minute|hour|day|week|month)s?$/i)
    if (!match) return undefined

    return {
      value: parseInt(match[1], 10),
      unit: match[2].toLowerCase() as ParsedInterval['unit'],
    }
  }

  /**
   * Add interval to date
   */
  private addInterval(date: Date, interval: ParsedInterval): void {
    switch (interval.unit) {
      case 'second':
        date.setSeconds(date.getSeconds() + interval.value)
        break
      case 'minute':
        date.setMinutes(date.getMinutes() + interval.value)
        break
      case 'hour':
        date.setHours(date.getHours() + interval.value)
        break
      case 'day':
        date.setDate(date.getDate() + interval.value)
        break
      case 'week':
        date.setDate(date.getDate() + interval.value * 7)
        break
      case 'month':
        date.setMonth(date.getMonth() + interval.value)
        break
    }
  }

  // ===========================================================================
  // Query Routing
  // ===========================================================================

  /**
   * Route a query to use a pre-aggregation if possible
   */
  routeQuery(query: CubeQuery): QueryRoutingResult {
    const matchingPreAgg = this.findMatchingPreAggregation(query)

    if (!matchingPreAgg) {
      return {
        canUsePreAgg: false,
        reason: 'No matching pre-aggregation found',
      }
    }

    // Check if pre-aggregation is stale
    if (matchingPreAgg.config.refreshKey && matchingPreAgg.lastRefreshAt) {
      const now = new Date()
      if (matchingPreAgg.nextRefreshAt && now > matchingPreAgg.nextRefreshAt) {
        // Pre-agg is stale but we can still use it
        // The scheduler will refresh it
      }
    }

    // Generate rewritten SQL
    const rewrittenSQL = this.generatePreAggQuery(matchingPreAgg, query)

    return {
      canUsePreAgg: true,
      preAggTable: matchingPreAgg,
      rewrittenSQL,
    }
  }

  /**
   * Find a matching pre-aggregation for a query
   */
  findMatchingPreAggregation(query: CubeQuery): PreAggregationTable | undefined {
    const queryMeasures = new Set(query.measures || [])
    const queryDimensions = new Set(query.dimensions || [])
    const queryTimeDim = query.timeDimensions?.[0]

    // Score pre-aggregations by match quality
    let bestMatch: PreAggregationTable | undefined
    let bestScore = -1

    for (const table of this.tables.values()) {
      const score = this.scorePreAggregation(
        table,
        queryMeasures,
        queryDimensions,
        queryTimeDim
      )

      if (score > bestScore) {
        bestScore = score
        bestMatch = table
      }
    }

    return bestScore > 0 ? bestMatch : undefined
  }

  /**
   * Score a pre-aggregation for a query (0 = no match, higher = better)
   */
  private scorePreAggregation(
    table: PreAggregationTable,
    queryMeasures: Set<string>,
    queryDimensions: Set<string>,
    queryTimeDim?: TimeDimension
  ): number {
    const { cubeName, config } = table
    let score = 0

    // Check measures
    if (queryMeasures.size > 0) {
      if (!config.measureReferences) return 0

      const preAggMeasures = new Set(
        config.measureReferences.map((m) => `${cubeName}.${m}`)
      )

      for (const measure of queryMeasures) {
        if (!preAggMeasures.has(measure)) return 0
      }

      score += queryMeasures.size
    }

    // Check dimensions
    if (queryDimensions.size > 0) {
      if (!config.dimensionReferences) return 0

      const preAggDimensions = new Set(
        config.dimensionReferences.map((d) => `${cubeName}.${d}`)
      )

      for (const dimension of queryDimensions) {
        if (!preAggDimensions.has(dimension)) return 0
      }

      score += queryDimensions.size
    }

    // Check time dimension
    if (queryTimeDim) {
      if (!config.timeDimensionReference) return 0

      const preAggTimeDim = `${cubeName}.${config.timeDimensionReference}`
      if (queryTimeDim.dimension !== preAggTimeDim) return 0

      // Check granularity compatibility
      if (
        queryTimeDim.granularity &&
        config.granularity &&
        !canRollupGranularity(config.granularity, queryTimeDim.granularity)
      ) {
        return 0
      }

      score += 2

      // Bonus for exact granularity match
      if (queryTimeDim.granularity === config.granularity) {
        score += 1
      }
    }

    return score
  }

  /**
   * Generate SQL query against pre-aggregation table
   */
  generatePreAggQuery(table: PreAggregationTable, query: CubeQuery): string {
    const { cubeName, config } = table
    const selectColumns: string[] = []
    const groupByColumns: string[] = []

    // Add dimension columns
    if (query.dimensions) {
      for (const dim of query.dimensions) {
        const [, dimName] = dim.split('.')
        selectColumns.push(`${dimName} AS "${dim}"`)
        groupByColumns.push(dimName)
      }
    }

    // Add time dimension
    const timeDim = query.timeDimensions?.[0]
    if (timeDim && config.timeDimensionReference) {
      const dimName = config.timeDimensionReference
      const queryGranularity = timeDim.granularity

      if (queryGranularity && config.granularity) {
        if (queryGranularity === config.granularity) {
          // Exact match
          selectColumns.push(`${dimName} AS "${timeDim.dimension}.${queryGranularity}"`)
          groupByColumns.push(dimName)
        } else if (canRollupGranularity(config.granularity, queryGranularity)) {
          // Need to rollup
          const truncatedSQL = getDateTruncSQL(dimName, queryGranularity)
          selectColumns.push(`${truncatedSQL} AS "${timeDim.dimension}.${queryGranularity}"`)
          groupByColumns.push(truncatedSQL)
        }
      }
    }

    // Add measure columns with aggregation
    if (query.measures) {
      for (const measure of query.measures) {
        const [, measureName] = measure.split('.')
        const measureDef = this.schemas.get(cubeName)?.measures[measureName]

        // For pre-aggregated data, we re-aggregate
        let aggSQL: string
        switch (measureDef?.type) {
          case 'count':
          case 'sum':
            aggSQL = `SUM(${measureName})`
            break
          case 'avg':
            // Can't simply re-aggregate avg, need sum/count
            aggSQL = `AVG(${measureName})`
            break
          case 'min':
            aggSQL = `MIN(${measureName})`
            break
          case 'max':
            aggSQL = `MAX(${measureName})`
            break
          default:
            aggSQL = measureName
        }

        selectColumns.push(`${aggSQL} AS "${measure}"`)
      }
    }

    // Build WHERE clause for time filter
    let whereClause = ''
    if (timeDim?.dateRange && config.timeDimensionReference) {
      const dimName = config.timeDimensionReference
      if (typeof timeDim.dateRange === 'string') {
        // Relative date range
        whereClause = this.buildRelativeDateFilter(dimName, timeDim.dateRange)
      } else {
        whereClause = `WHERE ${dimName} >= '${timeDim.dateRange[0]}' AND ${dimName} <= '${timeDim.dateRange[1]}'`
      }
    }

    // Build GROUP BY
    const groupByClause = groupByColumns.length > 0
      ? `GROUP BY ${groupByColumns.join(', ')}`
      : ''

    // Build ORDER BY
    let orderByClause = ''
    if (query.order) {
      const orderParts: string[] = []
      for (const [member, direction] of Object.entries(query.order)) {
        orderParts.push(`"${member}" ${direction.toUpperCase()}`)
      }
      if (orderParts.length > 0) {
        orderByClause = `ORDER BY ${orderParts.join(', ')}`
      }
    }

    // Build LIMIT/OFFSET
    let limitClause = ''
    if (query.limit !== undefined) {
      limitClause = `LIMIT ${query.limit}`
    }
    if (query.offset !== undefined) {
      limitClause += ` OFFSET ${query.offset}`
    }

    return `
SELECT
  ${selectColumns.join(',\n  ')}
FROM ${table.tableName}
${whereClause}
${groupByClause}
${orderByClause}
${limitClause}
`.trim()
  }

  /**
   * Build relative date filter SQL
   */
  private buildRelativeDateFilter(column: string, rangeStr: string): string {
    const match = rangeStr.match(/last\s+(\d+)\s+(day|week|month|year)s?/i)

    if (match) {
      const amount = parseInt(match[1], 10)
      const unit = match[2].toLowerCase()
      return `WHERE ${column} >= NOW() - INTERVAL '${amount} ${unit}' AND ${column} <= NOW()`
    }

    if (rangeStr.toLowerCase() === 'today') {
      return `WHERE DATE(${column}) = CURRENT_DATE`
    }

    if (rangeStr.toLowerCase() === 'this week') {
      return `WHERE ${column} >= DATE_TRUNC('week', NOW()) AND ${column} <= NOW()`
    }

    if (rangeStr.toLowerCase() === 'this month') {
      return `WHERE ${column} >= DATE_TRUNC('month', NOW()) AND ${column} <= NOW()`
    }

    // Default
    return `WHERE ${column} >= NOW() - INTERVAL '30 day'`
  }

  /**
   * Execute a query, routing to pre-aggregation if possible
   */
  async executeQuery(query: CubeQuery): Promise<{
    data: unknown[]
    usedPreAggregation?: PreAggregationTable
  }> {
    const routing = this.routeQuery(query)

    if (routing.canUsePreAgg && routing.rewrittenSQL) {
      const data = await this.executor(routing.rewrittenSQL)
      return {
        data,
        usedPreAggregation: routing.preAggTable,
      }
    }

    // Fall back to direct query - caller should handle this
    return {
      data: [],
    }
  }

  // ===========================================================================
  // Status and Metadata
  // ===========================================================================

  /**
   * Get all pre-aggregation tables
   */
  getTables(): PreAggregationTable[] {
    return Array.from(this.tables.values())
  }

  /**
   * Get a specific pre-aggregation table
   */
  getTable(cubeName: string, preAggName: string): PreAggregationTable | undefined {
    return this.tables.get(`${cubeName}.${preAggName}`)
  }

  /**
   * Get pre-aggregation status
   */
  getStatus(): {
    total: number
    built: number
    stale: number
    building: number
    scheduled: number
  } {
    let built = 0
    let stale = 0
    let building = 0
    let scheduled = 0

    const now = new Date()

    for (const table of this.tables.values()) {
      if (table.isBuilding) {
        building++
      } else if (table.lastRefreshAt) {
        built++
        if (table.nextRefreshAt && now > table.nextRefreshAt) {
          stale++
        }
      }

      if (table.config.scheduledRefresh) {
        scheduled++
      }
    }

    return {
      total: this.tables.size,
      built,
      stale,
      building,
      scheduled,
    }
  }

  /**
   * Check if scheduler is running
   */
  isSchedulerActive(): boolean {
    return this.isSchedulerRunning
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a pre-aggregation engine
 */
export function createPreAggregationEngine(
  options: PreAggregationEngineOptions
): PreAggregationEngine {
  return new PreAggregationEngine(options)
}
