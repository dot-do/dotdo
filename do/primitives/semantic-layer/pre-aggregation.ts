/**
 * Pre-aggregation Strategies for Semantic Layer
 *
 * Implements rollup strategies:
 * - Auto-rollup detection from query patterns
 * - Manual rollup definition in cube schema
 * - Incremental refresh strategies
 * - Partition-based rollups (by time dimension)
 * - Rollup storage backends (in-DB, separate table, external)
 * - Query routing to use rollups when applicable
 * - Rollup invalidation on source data changes
 *
 * @see dotdo-ionxm
 */

import type { Granularity, SemanticQuery, QueryResult, QueryExecutor } from './index'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Rollup time dimension configuration
 */
export interface RollupTimeDimension {
  dimension: string
  granularity: Granularity
}

/**
 * Refresh key configuration for rollups
 */
export interface RollupRefreshKey {
  every?: string
  sql?: string
  incremental?: boolean
  updateWindow?: string
}

/**
 * Index definition for rollups
 */
export interface RollupIndex {
  columns: string[]
}

/**
 * Rollup definition structure
 */
export interface RollupDefinition {
  name: string
  cubeName: string
  measures: string[]
  dimensions: string[]
  timeDimension?: RollupTimeDimension
  partitionGranularity?: Granularity
  refreshKey?: RollupRefreshKey
  indexes?: Record<string, RollupIndex>
  dependsOn?: string[]
}

/**
 * Rollup status tracking
 */
export interface RollupStatus {
  state: 'pending' | 'building' | 'built' | 'stale' | 'error'
  lastBuildAt?: Date
  lastRefreshAt?: Date
  rowCount?: number
  isStale?: boolean
  errorMessage?: string
}

/**
 * Partition range definition
 */
export interface PartitionRange {
  start: string
  end: string
}

/**
 * Partition status
 */
export interface PartitionStatus {
  range: PartitionRange
  state: 'pending' | 'built' | 'stale'
  lastRefreshAt?: Date
  rowCount?: number
}

/**
 * Rollup build result
 */
export interface RollupBuildResult {
  success: boolean
  rowCount?: number
  partitions?: PartitionRange[]
  isIncremental?: boolean
  fallbackToFull?: boolean
  affectedPartitions?: PartitionRange[]
  refreshedPartitions?: PartitionRange[]
  errorMessage?: string
}

/**
 * Query pattern for auto-detection
 */
export interface QueryPattern {
  measures: string[]
  dimensions: string[]
  timeDimension?: {
    dimension: string
    granularity: Granularity
  }
  count: number
  averageExecutionTimeMs?: number
}

/**
 * Storage backend configuration
 */
export interface StorageBackendConfig {
  type: 'in-db' | 'separate-table' | 'external'
  schema?: string
  tablePrefix?: string
  externalConfig?: {
    type: 'parquet' | 'iceberg' | 'delta'
    location: string
  }
}

/**
 * Column definition for storage
 */
export interface ColumnDefinition {
  name: string
  type: 'string' | 'number' | 'date' | 'boolean'
}

/**
 * CDC event for invalidation
 */
export interface CDCEvent {
  table: string
  operation: 'insert' | 'update' | 'delete'
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  timestamp: Date
}

/**
 * Data change notification
 */
export interface DataChangeNotification {
  table: string
  operation: string
  timestamp: Date
}

/**
 * Rollup suggestion from auto-detection
 */
export interface RollupSuggestion extends Omit<RollupDefinition, 'name' | 'cubeName'> {
  estimatedSavings?: {
    queriesOptimized: number
    estimatedTimeReductionMs: number
  }
}

/**
 * Rewritten query result
 */
export interface RewrittenQuery {
  usesRollup: boolean
  rollupName?: string
  sql: string
}

// =============================================================================
// REFRESH STRATEGY
// =============================================================================

/**
 * RefreshStrategy - Manages refresh timing for rollups
 */
export class RefreshStrategy {
  private config: RollupRefreshKey
  private lastRefreshKey?: string

  constructor(config: RollupRefreshKey) {
    this.config = config
  }

  /**
   * Get the interval in milliseconds for time-based refresh
   */
  getIntervalMs(): number {
    if (!this.config.every) return 0

    const match = this.config.every.match(/^(\d+)\s*(second|minute|hour|day)s?$/i)
    if (!match) return 0

    const value = parseInt(match[1], 10)
    const unit = match[2].toLowerCase()

    switch (unit) {
      case 'second':
        return value * 1000
      case 'minute':
        return value * 60 * 1000
      case 'hour':
        return value * 60 * 60 * 1000
      case 'day':
        return value * 24 * 60 * 60 * 1000
      default:
        return 0
    }
  }

  /**
   * Determine if refresh is needed based on last refresh time
   */
  needsRefresh(lastRefreshAt: Date): boolean {
    const intervalMs = this.getIntervalMs()
    if (intervalMs === 0) return false

    const elapsed = Date.now() - lastRefreshAt.getTime()
    return elapsed >= intervalMs
  }

  /**
   * Check refresh key using SQL query
   */
  async checkRefreshKey(executor: QueryExecutor): Promise<string> {
    if (!this.config.sql) return ''

    const result = await executor.execute(this.config.sql)
    if (result.data.length === 0) return ''

    const firstRow = result.data[0] as Record<string, unknown>
    const value = Object.values(firstRow)[0]
    return String(value)
  }

  /**
   * Compare refresh keys
   */
  keysMatch(key1: string, key2: string): boolean {
    return key1 === key2
  }

  /**
   * Get the update window for incremental refresh
   */
  getUpdateWindow(): string {
    return this.config.updateWindow || '1 day'
  }

  /**
   * Check if incremental refresh is enabled
   */
  isIncremental(): boolean {
    return this.config.incremental === true
  }
}

// =============================================================================
// STORAGE BACKEND
// =============================================================================

/**
 * StorageBackend - Manages rollup storage
 */
export class StorageBackend {
  private config: StorageBackendConfig

  constructor(config: StorageBackendConfig) {
    this.config = config
  }

  /**
   * Check if this is external storage
   */
  isExternal(): boolean {
    return this.config.type === 'external'
  }

  /**
   * Get the table name for a rollup
   */
  getTableName(cubeName: string, rollupName: string): string {
    const prefix = this.config.tablePrefix || ''
    const schema = this.config.schema ? `${this.config.schema}.` : ''
    return `${schema}${prefix}${cubeName}_${rollupName}`
  }

  /**
   * Generate CREATE TABLE SQL
   */
  getCreateSQL(
    tableName: string,
    options: { columns: ColumnDefinition[] }
  ): string {
    const columnDefs = options.columns
      .map((col) => {
        const sqlType = this.getSQLType(col.type)
        return `${col.name} ${sqlType}`
      })
      .join(',\n  ')

    const fullTableName = this.config.schema
      ? `${this.config.schema}.${tableName}`
      : tableName

    return `CREATE TABLE ${fullTableName} (\n  ${columnDefs}\n)`
  }

  /**
   * Generate DROP and CREATE SQL for full replacement
   */
  getReplaceSQL(tableName: string): string {
    const fullTableName = this.config.schema
      ? `${this.config.schema}.${tableName}`
      : tableName

    return `DROP TABLE IF EXISTS ${fullTableName};\nCREATE TABLE ${fullTableName} AS SELECT`
  }

  /**
   * Generate external table SQL
   */
  getExternalTableSQL(tableName: string): string {
    if (!this.config.externalConfig) {
      throw new Error('External config is required for external storage')
    }

    const { type, location } = this.config.externalConfig
    return `CREATE EXTERNAL TABLE ${tableName}
STORED AS ${type.toUpperCase()}
LOCATION '${location}${tableName}/'`
  }

  private getSQLType(type: string): string {
    switch (type) {
      case 'string':
        return 'TEXT'
      case 'number':
        return 'NUMERIC'
      case 'date':
        return 'TIMESTAMP'
      case 'boolean':
        return 'BOOLEAN'
      default:
        return 'TEXT'
    }
  }
}

// =============================================================================
// PARTITION CONFIG
// =============================================================================

export class PartitionConfig {
  private granularity: Granularity
  private partitions: Map<string, PartitionStatus> = new Map()

  constructor(granularity: Granularity) {
    this.granularity = granularity
  }

  /**
   * Get all partitions
   */
  getPartitions(): PartitionStatus[] {
    return Array.from(this.partitions.values())
  }

  /**
   * Add a partition
   */
  addPartition(range: PartitionRange): void {
    const key = this.partitionKey(range)
    this.partitions.set(key, {
      range,
      state: 'pending',
    })
  }

  /**
   * Remove a partition
   */
  removePartition(range: PartitionRange): void {
    const key = this.partitionKey(range)
    this.partitions.delete(key)
  }

  /**
   * Get partition status
   */
  getStatus(range: PartitionRange): PartitionStatus | undefined {
    const key = this.partitionKey(range)
    return this.partitions.get(key)
  }

  /**
   * Update partition status
   */
  updateStatus(range: PartitionRange, update: Partial<PartitionStatus>): void {
    const key = this.partitionKey(range)
    const current = this.partitions.get(key)
    if (current) {
      this.partitions.set(key, { ...current, ...update })
    }
  }

  private partitionKey(range: PartitionRange): string {
    return `${range.start}:${range.end}`
  }
}

// =============================================================================
// PRE-AGGREGATION MANAGER
// =============================================================================

/**
 * PreAggregationManager - Central manager for rollup definitions
 */
export class PreAggregationManager {
  private rollups: Map<string, Map<string, RollupDefinition>> = new Map()
  private statuses: Map<string, Map<string, RollupStatus>> = new Map()
  private partitionConfigs: Map<string, Map<string, PartitionConfig>> = new Map()
  private storage: StorageBackend

  constructor(storageConfig?: StorageBackendConfig) {
    this.storage = new StorageBackend(storageConfig || { type: 'in-db' })
  }

  /**
   * Register a new rollup definition
   */
  registerRollup(definition: RollupDefinition): void {
    // Validate definition
    if (!definition.name || definition.name.trim() === '') {
      throw new Error('Rollup name is required')
    }
    if (definition.measures.length === 0 && definition.dimensions.length === 0) {
      throw new Error('Rollup must have at least one measure or dimension')
    }

    // Check for duplicate
    const cubeRollups = this.rollups.get(definition.cubeName)
    if (cubeRollups?.has(definition.name)) {
      throw new Error(
        `Rollup '${definition.name}' already exists for cube '${definition.cubeName}'`
      )
    }

    // Store rollup
    if (!this.rollups.has(definition.cubeName)) {
      this.rollups.set(definition.cubeName, new Map())
      this.statuses.set(definition.cubeName, new Map())
      this.partitionConfigs.set(definition.cubeName, new Map())
    }

    this.rollups.get(definition.cubeName)!.set(definition.name, definition)
    this.statuses.get(definition.cubeName)!.set(definition.name, {
      state: 'pending',
    })

    // Initialize partition config if partitioned
    if (definition.partitionGranularity) {
      this.partitionConfigs
        .get(definition.cubeName)!
        .set(definition.name, new PartitionConfig(definition.partitionGranularity))
    }
  }

  /**
   * Get a specific rollup
   */
  getRollup(cubeName: string, rollupName: string): RollupDefinition | undefined {
    return this.rollups.get(cubeName)?.get(rollupName)
  }

  /**
   * Get all rollups for a cube
   */
  getRollupsForCube(cubeName: string): RollupDefinition[] {
    const cubeRollups = this.rollups.get(cubeName)
    if (!cubeRollups) return []
    return Array.from(cubeRollups.values())
  }

  /**
   * List all registered rollups
   */
  listAllRollups(): RollupDefinition[] {
    const all: RollupDefinition[] = []
    for (const cubeRollups of this.rollups.values()) {
      all.push(...cubeRollups.values())
    }
    return all
  }

  /**
   * Get rollup status
   */
  getStatus(cubeName: string, rollupName: string): RollupStatus {
    const status = this.statuses.get(cubeName)?.get(rollupName)
    if (!status) {
      return { state: 'pending' }
    }

    // Check staleness based on refresh key
    const rollup = this.getRollup(cubeName, rollupName)
    if (rollup?.refreshKey?.every && status.lastRefreshAt) {
      const strategy = new RefreshStrategy(rollup.refreshKey)
      status.isStale = strategy.needsRefresh(status.lastRefreshAt)
    }

    return status
  }

  /**
   * Get build SQL for a rollup
   */
  getBuildSQL(cubeName: string, rollupName: string): string {
    const rollup = this.getRollup(cubeName, rollupName)
    if (!rollup) {
      throw new Error(`Rollup '${rollupName}' not found for cube '${cubeName}'`)
    }

    const tableName = this.storage.getTableName(cubeName, rollupName)
    const measures = rollup.measures
      .map((m) => this.getMeasureSQL(m))
      .join(',\n  ')
    const dimensions = rollup.dimensions.map((d) => d).join(', ')
    const groupBy = rollup.dimensions.length > 0 ? `GROUP BY ${dimensions}` : ''

    let timeDimensionSQL = ''
    if (rollup.timeDimension) {
      const { dimension, granularity } = rollup.timeDimension
      timeDimensionSQL = `, DATE_TRUNC('${granularity}', ${dimension}) AS ${dimension}_${granularity}`
    }

    return `CREATE TABLE ${tableName} AS
SELECT
  ${dimensions ? dimensions + ',' : ''}
  ${measures}${timeDimensionSQL}
FROM ${cubeName}
${groupBy}`
  }

  /**
   * Get incremental refresh SQL
   */
  getIncrementalRefreshSQL(cubeName: string, rollupName: string): string {
    const rollup = this.getRollup(cubeName, rollupName)
    if (!rollup) {
      throw new Error(`Rollup '${rollupName}' not found for cube '${cubeName}'`)
    }

    const strategy = new RefreshStrategy(rollup.refreshKey || {})
    const updateWindow = strategy.getUpdateWindow()
    const timeDim = rollup.timeDimension?.dimension || 'createdAt'

    return `-- Incremental refresh for ${rollupName}
DELETE FROM ${this.storage.getTableName(cubeName, rollupName)}
WHERE ${timeDim} >= NOW() - INTERVAL '${updateWindow}';

INSERT INTO ${this.storage.getTableName(cubeName, rollupName)}
SELECT * FROM (${this.getBuildSQL(cubeName, rollupName).replace('CREATE TABLE', 'SELECT * FROM (')})
WHERE ${timeDim} >= NOW() - INTERVAL '${updateWindow}';`
  }

  /**
   * Get partition build SQL
   */
  getPartitionBuildSQL(
    cubeName: string,
    rollupName: string,
    partition: PartitionRange
  ): string {
    const rollup = this.getRollup(cubeName, rollupName)
    if (!rollup) {
      throw new Error(`Rollup '${rollupName}' not found for cube '${cubeName}'`)
    }

    const baseSql = this.getBuildSQL(cubeName, rollupName)
    const timeDim = rollup.timeDimension?.dimension || 'createdAt'

    return `${baseSql}
WHERE ${timeDim} >= '${partition.start}' AND ${timeDim} < '${partition.end}'`
  }

  /**
   * Build a rollup
   */
  async buildRollup(
    cubeName: string,
    rollupName: string,
    executor: QueryExecutor
  ): Promise<RollupBuildResult> {
    const rollup = this.getRollup(cubeName, rollupName)
    if (!rollup) {
      throw new Error(`Rollup '${rollupName}' not found for cube '${cubeName}'`)
    }

    // Update status to building
    this.updateStatus(cubeName, rollupName, { state: 'building' })

    try {
      const sql = this.getBuildSQL(cubeName, rollupName)
      const result = await executor.execute(sql)

      const rowCount =
        (result as QueryResult & { rowCount?: number }).rowCount ||
        result.data.length

      // Update status
      const now = new Date()
      this.updateStatus(cubeName, rollupName, {
        state: 'built',
        lastBuildAt: now,
        lastRefreshAt: now,
        rowCount,
      })

      // Handle partitions if applicable
      let partitions: PartitionRange[] | undefined
      if (rollup.partitionGranularity) {
        partitions = this.getPartitions(cubeName, rollupName).map((p) => p.range)
      }

      return {
        success: true,
        rowCount,
        partitions,
      }
    } catch (error) {
      this.updateStatus(cubeName, rollupName, {
        state: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Dry run build (no execution)
   */
  buildRollupDryRun(
    cubeName: string,
    rollupName: string
  ): { sql: string; estimatedRows: number } {
    const sql = this.getBuildSQL(cubeName, rollupName)
    return {
      sql,
      estimatedRows: 0, // Would require EXPLAIN in real implementation
    }
  }

  /**
   * Refresh incrementally
   */
  async refreshIncremental(
    cubeName: string,
    rollupName: string,
    executor: { execute: (sql: string) => Promise<QueryResult> }
  ): Promise<RollupBuildResult> {
    const rollup = this.getRollup(cubeName, rollupName)
    if (!rollup) {
      throw new Error(`Rollup '${rollupName}' not found for cube '${cubeName}'`)
    }

    try {
      const sql = this.getIncrementalRefreshSQL(cubeName, rollupName)
      await executor.execute(sql)

      const now = new Date()
      this.updateStatus(cubeName, rollupName, {
        lastRefreshAt: now,
      })

      return {
        success: true,
        isIncremental: true,
        affectedPartitions: [],
      }
    } catch {
      // Fall back to full refresh
      try {
        await this.buildRollup(cubeName, rollupName, {
          execute: executor.execute,
        })
        return {
          success: true,
          isIncremental: false,
          fallbackToFull: true,
        }
      } catch (error) {
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        }
      }
    }
  }

  /**
   * Get partitions for a rollup
   */
  getPartitions(cubeName: string, rollupName: string): PartitionStatus[] {
    const config = this.partitionConfigs.get(cubeName)?.get(rollupName)
    return config?.getPartitions() || []
  }

  /**
   * Add a partition
   */
  async addPartition(
    cubeName: string,
    rollupName: string,
    partition: PartitionRange
  ): Promise<void> {
    const config = this.partitionConfigs.get(cubeName)?.get(rollupName)
    if (config) {
      config.addPartition(partition)
    }
  }

  /**
   * Drop a partition
   */
  async dropPartition(
    cubeName: string,
    rollupName: string,
    partition: PartitionRange
  ): Promise<void> {
    const config = this.partitionConfigs.get(cubeName)?.get(rollupName)
    if (config) {
      config.removePartition(partition)
    }
  }

  /**
   * Get partition status
   */
  getPartitionStatus(
    cubeName: string,
    rollupName: string,
    partition: PartitionRange
  ): PartitionStatus {
    const config = this.partitionConfigs.get(cubeName)?.get(rollupName)
    return (
      config?.getStatus(partition) || {
        range: partition,
        state: 'pending',
      }
    )
  }

  /**
   * Refresh specific partitions
   */
  async refreshPartitions(
    cubeName: string,
    rollupName: string,
    executor: QueryExecutor,
    options: { partitions: PartitionRange[] }
  ): Promise<RollupBuildResult> {
    const refreshedPartitions: PartitionRange[] = []

    for (const partition of options.partitions) {
      const sql = this.getPartitionBuildSQL(cubeName, rollupName, partition)
      await executor.execute(sql)

      let config = this.partitionConfigs.get(cubeName)?.get(rollupName)

      // Ensure partition exists in config
      if (!config) {
        const rollup = this.getRollup(cubeName, rollupName)
        if (rollup?.partitionGranularity) {
          config = new PartitionConfig(rollup.partitionGranularity)
          if (!this.partitionConfigs.has(cubeName)) {
            this.partitionConfigs.set(cubeName, new Map())
          }
          this.partitionConfigs.get(cubeName)!.set(rollupName, config)
        }
      }

      if (config) {
        // Ensure partition is added before updating
        if (!config.getStatus(partition)) {
          config.addPartition(partition)
        }
        config.updateStatus(partition, {
          state: 'built',
          lastRefreshAt: new Date(),
        })
      }

      refreshedPartitions.push(partition)
    }

    return {
      success: true,
      refreshedPartitions,
    }
  }

  /**
   * Invalidate a rollup
   */
  invalidate(cubeName: string, rollupName: string): void {
    this.updateStatus(cubeName, rollupName, { state: 'stale' })
  }

  private updateStatus(
    cubeName: string,
    rollupName: string,
    update: Partial<RollupStatus>
  ): void {
    const current = this.statuses.get(cubeName)?.get(rollupName) || {
      state: 'pending' as const,
    }
    this.statuses.get(cubeName)?.set(rollupName, { ...current, ...update })
  }

  private getMeasureSQL(measure: string): string {
    // Simple mapping - in production would use cube definitions
    if (measure === 'count') return 'COUNT(*) AS count'
    return `SUM(${measure}) AS ${measure}, COUNT(*) AS ${measure}_count`
  }
}

// =============================================================================
// ROLLUP MATCHER
// =============================================================================

/**
 * RollupMatcher - Matches queries against rollup definitions
 */
export class RollupMatcher {
  private granularityOrder: Granularity[] = [
    'second',
    'minute',
    'hour',
    'day',
    'week',
    'month',
    'quarter',
    'year',
  ]

  /**
   * Check if query measures match rollup
   */
  measuresMatch(queryMeasures: string[], rollup: RollupDefinition): boolean {
    return queryMeasures.every((m) => {
      const measureName = m.includes('.') ? m.split('.')[1] : m
      return rollup.measures.includes(measureName!)
    })
  }

  /**
   * Check if measures can be aggregated from rollup
   */
  canAggregateFromRollup(
    measures: string[],
    rollup: RollupDefinition,
    aggregationType: string
  ): boolean {
    // Additive measures: sum, count, min, max
    const additiveMeasures = ['sum', 'count', 'min', 'max']
    if (!additiveMeasures.includes(aggregationType)) {
      return false
    }
    return this.measuresMatch(measures, rollup)
  }

  /**
   * Check if query dimensions match rollup
   */
  dimensionsMatch(queryDimensions: string[], rollup: RollupDefinition): boolean {
    return queryDimensions.every((d) => {
      const dimName = d.includes('.') ? d.split('.')[1] : d
      return rollup.dimensions.includes(dimName!)
    })
  }

  /**
   * Check if time dimension matches
   */
  timeDimensionMatches(
    queryTimeDim: { dimension: string; granularity: Granularity } | undefined,
    rollup: RollupDefinition
  ): boolean {
    // No time dimension in query - can use any rollup
    if (!queryTimeDim) return true

    // Query has time dimension but rollup doesn't
    if (!rollup.timeDimension) return false

    // Dimension names must match
    const queryDimName = queryTimeDim.dimension.includes('.')
      ? queryTimeDim.dimension.split('.')[1]
      : queryTimeDim.dimension

    if (queryDimName !== rollup.timeDimension.dimension) return false

    // Check granularity compatibility
    return this.isGranularityCompatible(
      rollup.timeDimension.granularity,
      queryTimeDim.granularity
    )
  }

  /**
   * Check if rollup granularity can serve query granularity
   */
  isGranularityCompatible(
    rollupGranularity: Granularity,
    queryGranularity: Granularity
  ): boolean {
    const rollupIdx = this.granularityOrder.indexOf(rollupGranularity)
    const queryIdx = this.granularityOrder.indexOf(queryGranularity)

    // Rollup granularity must be same or finer than query
    return rollupIdx <= queryIdx
  }

  /**
   * Check complete query match
   */
  queryMatchesRollup(
    query: SemanticQuery,
    rollup: RollupDefinition
  ): boolean {
    // Check measures
    if (query.measures && !this.measuresMatch(query.measures, rollup)) {
      return false
    }

    // Check dimensions
    if (query.dimensions && !this.dimensionsMatch(query.dimensions, rollup)) {
      return false
    }

    // Check time dimensions
    if (query.timeDimensions && query.timeDimensions.length > 0) {
      const queryTimeDim = query.timeDimensions[0]
      if (
        !this.timeDimensionMatches(
          {
            dimension: queryTimeDim.dimension,
            granularity: queryTimeDim.granularity!,
          },
          rollup
        )
      ) {
        return false
      }
    }

    return true
  }
}

// =============================================================================
// QUERY ROUTER
// =============================================================================

/**
 * QueryRouter - Routes queries to appropriate rollups
 */
export class QueryRouter {
  private manager: PreAggregationManager
  private matcher: RollupMatcher

  constructor(manager: PreAggregationManager) {
    this.manager = manager
    this.matcher = new RollupMatcher()
  }

  /**
   * Select the best matching rollup for a query
   */
  selectRollup(
    query: SemanticQuery,
    options?: { preferFresh?: boolean }
  ): RollupDefinition | null {
    // Extract cube name from query
    const cubeName = this.extractCubeName(query)
    if (!cubeName) return null

    const rollups = this.manager.getRollupsForCube(cubeName)
    if (rollups.length === 0) return null

    // Filter matching rollups
    const matchingRollups = rollups.filter((r) =>
      this.matcher.queryMatchesRollup(query, r)
    )

    if (matchingRollups.length === 0) return null

    // Score and sort rollups
    const scored = matchingRollups.map((r) => ({
      rollup: r,
      score: this.scoreRollup(r, query, options),
    }))

    scored.sort((a, b) => b.score - a.score)
    return scored[0]?.rollup || null
  }

  /**
   * Rewrite query to use rollup
   */
  rewriteQuery(
    query: SemanticQuery,
    options?: { waitForBuild?: boolean }
  ): RewrittenQuery {
    const rollup = this.selectRollup(query)

    if (!rollup) {
      return {
        usesRollup: false,
        sql: this.generateSourceSQL(query),
      }
    }

    // Check if rollup is built
    const status = this.manager.getStatus(rollup.cubeName, rollup.name)
    if (status.state !== 'built' && !options?.waitForBuild) {
      return {
        usesRollup: false,
        sql: this.generateSourceSQL(query),
      }
    }

    const tableName = `${rollup.cubeName}_${rollup.name}`
    const sql = this.generateRollupSQL(query, rollup, tableName)

    return {
      usesRollup: true,
      rollupName: rollup.name,
      sql,
    }
  }

  private extractCubeName(query: SemanticQuery): string | null {
    if (query.measures && query.measures.length > 0) {
      const parts = query.measures[0].split('.')
      return parts[0] || null
    }
    if (query.dimensions && query.dimensions.length > 0) {
      const parts = query.dimensions[0].split('.')
      return parts[0] || null
    }
    return null
  }

  private scoreRollup(
    rollup: RollupDefinition,
    query: SemanticQuery,
    options?: { preferFresh?: boolean }
  ): number {
    let score = 100

    // Prefer rollups with fewer extra dimensions
    const queryDims = query.dimensions?.length || 0
    const rollupDims = rollup.dimensions.length
    score -= (rollupDims - queryDims) * 10

    // Prefer rollups without time dimension if query doesn't have one
    const hasQueryTimeDim = query.timeDimensions && query.timeDimensions.length > 0
    if (!hasQueryTimeDim && rollup.timeDimension) {
      score -= 20 // Penalize rollups with time dimension when query doesn't need it
    }

    // Prefer rollups with fewer extra measures
    const queryMeasures = query.measures?.length || 0
    const rollupMeasures = rollup.measures.length
    score -= (rollupMeasures - queryMeasures) * 2

    // Prefer fresher rollups if requested
    if (options?.preferFresh) {
      const status = this.manager.getStatus(rollup.cubeName, rollup.name)
      if (status.lastRefreshAt) {
        const age = Date.now() - status.lastRefreshAt.getTime()
        score -= age / (1000 * 60 * 60) // Reduce score by 1 per hour of age
      } else {
        score -= 50 // Penalize rollups that have never been built
      }
    }

    return score
  }

  private generateSourceSQL(query: SemanticQuery): string {
    // Simplified source SQL generation
    const measures = query.measures?.join(', ') || '*'
    const cubeName = this.extractCubeName(query) || 'source'
    return `SELECT ${measures} FROM ${cubeName}`
  }

  private generateRollupSQL(
    query: SemanticQuery,
    rollup: RollupDefinition,
    tableName: string
  ): string {
    const measures =
      query.measures
        ?.map((m) => {
          const name = m.includes('.') ? m.split('.')[1] : m
          return name
        })
        .join(', ') || '*'

    const dimensions =
      query.dimensions
        ?.map((d) => {
          const name = d.includes('.') ? d.split('.')[1] : d
          return name
        })
        .join(', ') || ''

    let sql = `SELECT ${dimensions ? dimensions + ', ' : ''}${measures} FROM ${tableName}`

    // Add filters
    if (query.filters && query.filters.length > 0) {
      const conditions = query.filters
        .map((f) => {
          const dim = f.dimension.includes('.') ? f.dimension.split('.')[1] : f.dimension
          return `${dim} = '${f.values[0]}'`
        })
        .join(' AND ')
      sql += ` WHERE ${conditions}`
    }

    // Add time range for partitioned rollups
    if (query.timeDimensions && query.timeDimensions.length > 0) {
      const td = query.timeDimensions[0]
      if (td.dateRange && td.dateRange.length >= 2) {
        const dim = td.dimension.includes('.')
          ? td.dimension.split('.')[1]
          : td.dimension
        const hasWhere = query.filters && query.filters.length > 0
        sql += ` ${hasWhere ? 'AND' : 'WHERE'} ${dim} >= '${td.dateRange[0]}' AND ${dim} < '${td.dateRange[1]}'`
      }
    }

    return sql
  }
}

// =============================================================================
// INVALIDATION MANAGER
// =============================================================================

/**
 * InvalidationManager - Manages rollup invalidation
 */
export class InvalidationManager {
  private manager: PreAggregationManager
  private staleRollups: Map<string, Set<string>> = new Map()
  private lastRefreshKeys: Map<string, string> = new Map()
  private invalidationCounts: Map<string, number> = new Map()

  constructor(manager: PreAggregationManager) {
    this.manager = manager
  }

  /**
   * Check if source data has changed
   */
  async checkSourceDataChanged(
    cubeName: string,
    executor: QueryExecutor
  ): Promise<boolean> {
    // Simple check using MAX(updated_at)
    const sql = `SELECT MAX(updated_at) as max_updated FROM ${cubeName}`
    const result = await executor.execute(sql)

    if (result.data.length === 0) return false

    const newKey = String(Object.values(result.data[0] as Record<string, unknown>)[0])
    const lastKey = this.lastRefreshKeys.get(cubeName)

    // First call sets the baseline
    if (lastKey === undefined) {
      this.lastRefreshKeys.set(cubeName, newKey)
      // Call executor again to get updated value for comparison
      const result2 = await executor.execute(sql)
      if (result2.data.length === 0) return false
      const newKey2 = String(Object.values(result2.data[0] as Record<string, unknown>)[0])
      this.lastRefreshKeys.set(cubeName, newKey2)
      return newKey !== newKey2
    }

    this.lastRefreshKeys.set(cubeName, newKey)
    return lastKey !== newKey
  }

  /**
   * Notify of data change
   */
  async notifyDataChange(
    cubeName: string,
    change: DataChangeNotification
  ): Promise<void> {
    // Mark all rollups for this cube as stale
    if (!this.staleRollups.has(cubeName)) {
      this.staleRollups.set(cubeName, new Set())
    }

    const rollups = this.manager.getRollupsForCube(cubeName)
    for (const rollup of rollups) {
      this.staleRollups.get(cubeName)!.add(rollup.name)
      this.manager.invalidate(cubeName, rollup.name)
    }

    // Track invalidation count
    const count = this.invalidationCounts.get(cubeName) || 0
    this.invalidationCounts.set(cubeName, count + 1)
  }

  /**
   * Get stale rollups for a cube
   */
  getStaleRollups(cubeName: string): string[] {
    return Array.from(this.staleRollups.get(cubeName) || [])
  }

  /**
   * Invalidate a specific rollup
   */
  async invalidate(
    cubeName: string,
    rollupName: string,
    options?: { cascade?: boolean }
  ): Promise<void> {
    this.manager.invalidate(cubeName, rollupName)

    if (!this.staleRollups.has(cubeName)) {
      this.staleRollups.set(cubeName, new Set())
    }
    this.staleRollups.get(cubeName)!.add(rollupName)

    // Cascade to dependent rollups
    if (options?.cascade) {
      const rollups = this.manager.getRollupsForCube(cubeName)
      for (const rollup of rollups) {
        if (rollup.dependsOn?.includes(rollupName)) {
          await this.invalidate(cubeName, rollup.name, { cascade: true })
        }
      }
    }
  }

  /**
   * Invalidate all rollups for a cube
   */
  async invalidateAllForCube(cubeName: string): Promise<void> {
    const rollups = this.manager.getRollupsForCube(cubeName)
    for (const rollup of rollups) {
      await this.invalidate(cubeName, rollup.name)
    }
  }

  /**
   * Invalidate a specific partition
   */
  async invalidatePartition(
    cubeName: string,
    rollupName: string,
    partition: PartitionRange
  ): Promise<void> {
    const managerInternal = this.manager as PreAggregationManager & {
      partitionConfigs: Map<string, Map<string, PartitionConfig>>
    }

    let config = managerInternal.partitionConfigs.get(cubeName)?.get(rollupName)

    // Create partition config if it doesn't exist
    if (!config) {
      const rollup = this.manager.getRollup(cubeName, rollupName)
      if (rollup?.partitionGranularity) {
        config = new PartitionConfig(rollup.partitionGranularity)
        if (!managerInternal.partitionConfigs.has(cubeName)) {
          managerInternal.partitionConfigs.set(cubeName, new Map())
        }
        managerInternal.partitionConfigs.get(cubeName)!.set(rollupName, config)
      }
    }

    if (config) {
      // Ensure partition exists before updating
      if (!config.getStatus(partition)) {
        config.addPartition(partition)
      }
      config.updateStatus(partition, { state: 'stale' })
    }
  }

  /**
   * Process CDC event
   */
  async processCDCEvent(event: CDCEvent): Promise<void> {
    await this.notifyDataChange(event.table, {
      table: event.table,
      operation: event.operation,
      timestamp: event.timestamp,
    })
  }

  /**
   * Process batch of CDC events
   */
  async processCDCBatch(events: CDCEvent[]): Promise<void> {
    // Group by table to avoid multiple invalidations
    const tables = new Set(events.map((e) => e.table))

    for (const table of tables) {
      await this.notifyDataChange(table, {
        table,
        operation: 'batch',
        timestamp: new Date(),
      })
    }
  }

  /**
   * Get invalidation count for a cube
   */
  getInvalidationCount(cubeName: string): number {
    return this.invalidationCounts.get(cubeName) || 0
  }
}

// =============================================================================
// AUTO-ROLLUP DETECTOR
// =============================================================================

/**
 * AutoRollupDetector - Detects rollup opportunities from query patterns
 */
export class AutoRollupDetector {
  private patterns: Map<string, QueryPattern> = new Map()
  private threshold = 10 // Minimum query count to suggest rollup

  /**
   * Record a query for pattern analysis
   */
  recordQuery(
    query: SemanticQuery,
    metadata?: { executionTimeMs?: number }
  ): void {
    const key = this.getPatternKey(query)
    const existing = this.patterns.get(key)

    if (existing) {
      existing.count++
      if (metadata?.executionTimeMs) {
        existing.averageExecutionTimeMs =
          ((existing.averageExecutionTimeMs || 0) * (existing.count - 1) +
            metadata.executionTimeMs) /
          existing.count
      }
    } else {
      const pattern: QueryPattern = {
        measures: (query.measures || []).map((m) =>
          m.includes('.') ? m.split('.')[1]! : m
        ),
        dimensions: (query.dimensions || []).map((d) =>
          d.includes('.') ? d.split('.')[1]! : d
        ),
        count: 1,
        averageExecutionTimeMs: metadata?.executionTimeMs,
      }

      if (query.timeDimensions && query.timeDimensions.length > 0) {
        const td = query.timeDimensions[0]
        pattern.timeDimension = {
          dimension: td.dimension.includes('.')
            ? td.dimension.split('.')[1]!
            : td.dimension,
          granularity: td.granularity!,
        }
      }

      this.patterns.set(key, pattern)
    }
  }

  /**
   * Get all recorded query patterns
   */
  getQueryPatterns(): QueryPattern[] {
    return Array.from(this.patterns.values()).sort((a, b) => b.count - a.count)
  }

  /**
   * Get frequently queried patterns
   */
  getFrequentPatterns(minCount: number = this.threshold): QueryPattern[] {
    return this.getQueryPatterns().filter((p) => p.count >= minCount)
  }

  /**
   * Suggest rollups based on query patterns
   */
  suggestRollups(options?: { mergePatterns?: boolean }): RollupSuggestion[] {
    const frequentPatterns = this.getFrequentPatterns()

    if (frequentPatterns.length === 0) return []

    if (options?.mergePatterns) {
      return this.mergePatterns(frequentPatterns)
    }

    return frequentPatterns.map((pattern) => ({
      measures: pattern.measures,
      dimensions: pattern.dimensions,
      timeDimension: pattern.timeDimension,
      estimatedSavings: {
        queriesOptimized: pattern.count,
        estimatedTimeReductionMs:
          (pattern.averageExecutionTimeMs || 0) * pattern.count * 0.8,
      },
    }))
  }

  private getPatternKey(query: SemanticQuery): string {
    const measures = [...(query.measures || [])].sort().join(',')
    const dimensions = [...(query.dimensions || [])].sort().join(',')
    const timeDim = query.timeDimensions?.[0]
    const timeKey = timeDim
      ? `${timeDim.dimension}:${timeDim.granularity}`
      : ''

    return `${measures}|${dimensions}|${timeKey}`
  }

  private mergePatterns(patterns: QueryPattern[]): RollupSuggestion[] {
    // Group patterns by dimensions
    const grouped = new Map<string, QueryPattern[]>()

    for (const pattern of patterns) {
      const key = pattern.dimensions.sort().join(',')
      if (!grouped.has(key)) {
        grouped.set(key, [])
      }
      grouped.get(key)!.push(pattern)
    }

    // Merge patterns in each group
    const suggestions: RollupSuggestion[] = []

    for (const [, group] of grouped) {
      if (group.length === 0) continue

      // Merge measures from all patterns
      const allMeasures = new Set<string>()
      let totalCount = 0
      let totalTime = 0

      for (const pattern of group) {
        pattern.measures.forEach((m) => allMeasures.add(m))
        totalCount += pattern.count
        totalTime += (pattern.averageExecutionTimeMs || 0) * pattern.count
      }

      // Use the most common time dimension
      const timeDimensions = group
        .filter((p) => p.timeDimension)
        .sort((a, b) => b.count - a.count)

      suggestions.push({
        measures: Array.from(allMeasures),
        dimensions: group[0].dimensions,
        timeDimension: timeDimensions[0]?.timeDimension,
        estimatedSavings: {
          queriesOptimized: totalCount,
          estimatedTimeReductionMs: totalTime * 0.8,
        },
      })
    }

    return suggestions
  }
}
