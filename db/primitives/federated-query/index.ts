/**
 * FederatedQueryPlanner - Cross-source query execution
 *
 * Plans and executes queries across multiple heterogeneous data sources,
 * enabling unified access to distributed data.
 *
 * ## Use Cases
 * - **Trino/Presto Compatibility**: Drop-in federated SQL execution
 * - **Cross-DO Queries**: Query data spanning multiple Durable Objects
 * - **Data Virtualization**: Present unified view over R2, D1, KV, and external sources
 *
 * ## Key Components
 * - **Catalog**: Registry of available data sources, schemas, and statistics
 * - **SourceAdapter**: Pluggable interface for source-specific operations
 * - **PushdownOptimizer**: Pushes predicates, projections, and aggregations to source level
 * - **FederatedExecutor**: Coordinates distributed execution with streaming results
 *
 * ## Optimizations
 * - **Predicate Pushdown**: Push WHERE clauses to sources that support filtering
 * - **Join Reordering**: Cost-based join order optimization across sources
 * - **Parallel Scan**: Concurrent reads from multiple sources with backpressure
 *
 * @see dotdo-9n9wc
 * @module db/primitives/federated-query
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Column type in schema
 */
export type ColumnType = 'integer' | 'number' | 'string' | 'boolean' | 'timestamp' | 'json'

/**
 * Column definition
 */
export interface ColumnDef {
  type: ColumnType
  nullable?: boolean
  primaryKey?: boolean
}

/**
 * Table definition
 */
export interface TableDef {
  columns: Record<string, ColumnDef>
}

/**
 * Source schema with tables
 */
export interface SourceSchema {
  tables: Record<string, TableDef>
}

/**
 * Table statistics for cost estimation
 */
export interface TableStats {
  rowCount: number
  sizeBytes: number
  distinctCounts?: Record<string, number>
}

/**
 * Source-level statistics
 */
export interface SourceStatistics {
  tables: Record<string, TableStats>
}

/**
 * Data source configuration
 */
export interface DataSource {
  name: string
  type: 'sqlite' | 'postgres' | 'memory' | 'rest' | 'durable-object'
  config: Record<string, unknown>
}

/**
 * Query predicate
 */
export interface QueryPredicate {
  column: string
  op: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'NOT IN'
  value?: unknown
  ref?: string // Cross-source column reference
}

/**
 * Aggregation definition
 */
export interface Aggregation {
  function: 'count' | 'sum' | 'avg' | 'min' | 'max'
  column?: string
  alias: string
}

/**
 * Table reference in query
 */
export interface TableRef {
  source: string
  table: string
  alias?: string
}

/**
 * Join definition
 */
export interface JoinDef {
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'
  on: { left: string; right: string }
}

/**
 * Federated query definition
 */
export interface FederatedQuery {
  from: TableRef[]
  columns?: string[]
  predicates?: QueryPredicate[]
  groupBy?: string[]
  aggregations?: Aggregation[]
  orderBy?: { column: string; direction: 'ASC' | 'DESC' }[]
  limit?: number
  offset?: number
  join?: JoinDef | JoinDef[]
}

/**
 * Source adapter capabilities
 */
export interface PushdownCapabilities {
  predicatePushdown: boolean
  projectionPushdown: boolean
  limitPushdown: boolean
  aggregationPushdown: boolean
  joinPushdown: boolean
  supportedOperators?: string[]
}

/**
 * Source adapter query fragment
 */
export interface QueryFragment {
  table: string
  columns?: string[]
  predicates?: QueryPredicate[]
  groupBy?: string[]
  aggregations?: Aggregation[]
  limit?: number
  offset?: number
  rawSQL?: string
}

/**
 * Query execution result
 */
export interface QueryResult {
  rows: Record<string, unknown>[]
  columns?: string[]
  metadata?: Record<string, unknown>
}

/**
 * Source adapter interface
 */
export interface SourceAdapter {
  capabilities(): PushdownCapabilities
  execute(query: QueryFragment): Promise<QueryResult>
  stream(query: QueryFragment & { batchSize?: number }): AsyncGenerator<Record<string, unknown>[], void, unknown>
  toSQL?(query: QueryFragment): string
}

/**
 * Pushdown result from optimizer
 */
export interface FragmentPushdown {
  source: string
  pushdown: QueryFragment & { table: string }
}

/**
 * Optimization result
 */
export interface PushdownResult {
  fragments: FragmentPushdown[]
  residualPredicates: QueryPredicate[]
  joinPredicates?: QueryPredicate[]
  postProjection?: string[]
  postAggregations?: Aggregation[]
  postLimit?: number
  join?: ExecutionJoin
}

/**
 * Execution plan join definition
 */
export interface ExecutionJoin {
  type: 'hash' | 'nested_loop' | 'merge'
  joinType?: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'
  buildSide?: string
  probeSide?: string
  outer?: string
  inner?: string
  on: { left: string; right: string }
}

/**
 * Execution plan fragment
 */
export interface ExecutionFragment {
  source: string
  pushdown: QueryFragment
}

/**
 * Streaming configuration
 */
export interface StreamingConfig {
  batchSize?: number
  maxMemoryMB?: number
}

/**
 * Execution plan
 */
export interface ExecutionPlan {
  fragments: ExecutionFragment[]
  residualPredicates?: QueryPredicate[]
  join?: ExecutionJoin
  streaming?: StreamingConfig
  parallel?: boolean
  collectStats?: boolean
}

/**
 * Fragment execution statistics
 */
export interface FragmentStats {
  source: string
  rowsScanned: number
  executionTimeMs: number
}

/**
 * Execution statistics
 */
export interface ExecutionStats {
  rowsScanned: number
  executionTimeMs: number
  fragmentStats?: FragmentStats[]
}

/**
 * Execution result with optional stats
 */
export interface ExecutionResult {
  rows: Record<string, unknown>[]
  stats?: ExecutionStats
}

/**
 * Streaming result batch
 */
export interface StreamingResult {
  rows: Record<string, unknown>[]
  batchIndex?: number
}

// =============================================================================
// CATALOG
// =============================================================================

/**
 * Catalog - Registry of data sources, schemas, and statistics
 */
export class Catalog {
  private sources = new Map<string, DataSource>()
  private schemas = new Map<string, SourceSchema>()
  private statistics = new Map<string, SourceStatistics>()
  private adapters = new Map<string, SourceAdapter>()
  private defaultSource: string | null = null

  /**
   * Register a data source
   */
  registerSource(source: DataSource): void {
    if (this.sources.has(source.name)) {
      throw new Error(`Source ${source.name} already registered`)
    }
    this.sources.set(source.name, source)
  }

  /**
   * Unregister a data source
   */
  unregisterSource(name: string): void {
    this.sources.delete(name)
    this.schemas.delete(name)
    this.statistics.delete(name)
    this.adapters.delete(name)
  }

  /**
   * Check if a source is registered
   */
  hasSource(name: string): boolean {
    return this.sources.has(name)
  }

  /**
   * Get a data source
   */
  getSource(name: string): DataSource | undefined {
    return this.sources.get(name)
  }

  /**
   * List all registered sources
   */
  listSources(): DataSource[] {
    return Array.from(this.sources.values())
  }

  /**
   * Register schema for a source
   */
  registerSchema(sourceName: string, schema: SourceSchema): void {
    this.schemas.set(sourceName, schema)
  }

  /**
   * Get schema for a source
   */
  getSchema(sourceName: string): SourceSchema | undefined {
    return this.schemas.get(sourceName)
  }

  /**
   * Register statistics for a source
   */
  registerStatistics(sourceName: string, stats: SourceStatistics): void {
    this.statistics.set(sourceName, stats)
  }

  /**
   * Get statistics for a source
   */
  getStatistics(sourceName: string): SourceStatistics | undefined {
    return this.statistics.get(sourceName)
  }

  /**
   * Attach an adapter to a source
   */
  attachAdapter(sourceName: string, adapter: SourceAdapter): void {
    this.adapters.set(sourceName, adapter)
  }

  /**
   * Get adapter for a source
   */
  getAdapter(sourceName: string): SourceAdapter | undefined {
    return this.adapters.get(sourceName)
  }

  /**
   * Set the default source for unqualified table references
   */
  setDefaultSource(sourceName: string): void {
    this.defaultSource = sourceName
  }

  /**
   * Discover schema from a source adapter
   */
  async discoverSchema(sourceName: string): Promise<SourceSchema> {
    const adapter = this.adapters.get(sourceName)
    if (!adapter) {
      throw new Error(`No adapter attached to source ${sourceName}`)
    }

    // Query the adapter for available tables
    const result = await adapter.execute({ table: '__tables__' })

    const schema: SourceSchema = { tables: {} }

    // Extract table names from the __tables__ result
    const tableNames: string[] = []
    for (const row of result.rows) {
      // The memory adapter returns { table_name: 'tableName', row_count: N }
      if (typeof row.table_name === 'string') {
        tableNames.push(row.table_name)
      }
    }

    // Query each table to discover its schema
    for (const tableName of tableNames) {
      const tableResult = await adapter.execute({ table: tableName, limit: 1 })
      if (tableResult.rows.length > 0) {
        const sampleRow = tableResult.rows[0]!
        const columns: Record<string, ColumnDef> = {}
        for (const [colName, value] of Object.entries(sampleRow)) {
          columns[colName] = {
            type: this.inferColumnType(value),
            nullable: true,
          }
        }
        schema.tables[tableName] = { columns }
      }
    }

    this.schemas.set(sourceName, schema)
    return schema
  }

  private inferColumnType(value: unknown): ColumnType {
    if (value === null || value === undefined) return 'string'
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'number'
    }
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'string') {
      // Check if it looks like a timestamp
      if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'timestamp'
      return 'string'
    }
    if (typeof value === 'object') return 'json'
    return 'string'
  }

  /**
   * Resolve a table reference to source and table name
   */
  resolveTable(tableRef: string): { source: string; table: string } {
    const parts = tableRef.split('.')
    if (parts.length === 2) {
      return { source: parts[0]!, table: parts[1]! }
    }

    const tableName = parts[0]!

    // Find which sources have this table
    const sourcesWithTable: string[] = []
    for (const [sourceName, schema] of this.schemas) {
      if (schema.tables[tableName]) {
        sourcesWithTable.push(sourceName)
      }
    }

    if (sourcesWithTable.length === 0) {
      if (this.defaultSource) {
        return { source: this.defaultSource, table: tableName }
      }
      throw new Error(`Table ${tableName} not found in any source`)
    }

    if (sourcesWithTable.length > 1) {
      throw new Error(`Ambiguous table reference: ${tableName} exists in multiple sources`)
    }

    return { source: sourcesWithTable[0]!, table: tableName }
  }
}

// =============================================================================
// SOURCE ADAPTERS
// =============================================================================

/**
 * Create a memory adapter from in-memory data
 */
export function createMemoryAdapter(
  data: Record<string, Record<string, unknown>[]>
): SourceAdapter {
  return {
    capabilities(): PushdownCapabilities {
      return {
        predicatePushdown: true,
        projectionPushdown: true,
        limitPushdown: true,
        aggregationPushdown: false,
        joinPushdown: false,
      }
    },

    async execute(query: QueryFragment): Promise<QueryResult> {
      // Handle special __tables__ query for schema discovery
      if (query.table === '__tables__') {
        const rows = Object.keys(data).map((name) => ({
          table_name: name,
          row_count: data[name]?.length ?? 0,
        }))
        return { rows }
      }

      let rows = [...(data[query.table] ?? [])]

      // Apply predicates
      if (query.predicates) {
        rows = rows.filter((row) =>
          query.predicates!.every((pred) => evaluatePredicate(row, pred))
        )
      }

      // Apply offset
      if (query.offset !== undefined) {
        rows = rows.slice(query.offset)
      }

      // Apply limit
      if (query.limit !== undefined) {
        rows = rows.slice(0, query.limit)
      }

      // Apply projection
      if (query.columns) {
        rows = rows.map((row) => {
          const projected: Record<string, unknown> = {}
          for (const col of query.columns!) {
            if (col in row) {
              projected[col] = row[col]
            }
          }
          return projected
        })
      }

      return { rows }
    },

    async *stream(
      query: QueryFragment & { batchSize?: number }
    ): AsyncGenerator<Record<string, unknown>[], void, unknown> {
      const batchSize = query.batchSize ?? 100
      const result = await this.execute(query)

      for (let i = 0; i < result.rows.length; i += batchSize) {
        yield result.rows.slice(i, i + batchSize)
      }
    },
  }
}

/**
 * Create an SQLite adapter
 */
export function createSQLiteAdapter(): SourceAdapter {
  const db: Map<string, Record<string, unknown>[]> = new Map()

  return {
    capabilities(): PushdownCapabilities {
      return {
        predicatePushdown: true,
        projectionPushdown: true,
        limitPushdown: true,
        aggregationPushdown: true,
        joinPushdown: true,
      }
    },

    async execute(query: QueryFragment): Promise<QueryResult> {
      // Handle raw SQL (for setup)
      if (query.rawSQL) {
        const sql = query.rawSQL.trim()

        // CREATE TABLE
        if (sql.toUpperCase().startsWith('CREATE TABLE')) {
          const match = sql.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/i)
          if (match) {
            db.set(match[1]!, [])
          }
          return { rows: [] }
        }

        // INSERT
        if (sql.toUpperCase().startsWith('INSERT INTO')) {
          // Normalize whitespace for easier parsing
          const normalizedSql = sql.replace(/\s+/g, ' ')
          const match = normalizedSql.match(
            /INSERT INTO\s+(\w+)\s+\(([^)]+)\)\s+VALUES\s+(.+)/i
          )
          if (match) {
            const tableName = match[1]!
            const columns = match[2]!.split(',').map((c) => c.trim())
            const valuesStr = match[3]!

            // Parse multiple value sets
            const valueMatches = valuesStr.matchAll(/\(([^)]+)\)/g)
            const table = db.get(tableName) || []

            for (const valueMatch of valueMatches) {
              const values = valueMatch[1]!.split(',').map((v) => {
                const trimmed = v.trim()
                if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
                  return trimmed.slice(1, -1)
                }
                const num = parseFloat(trimmed)
                return isNaN(num) ? trimmed : num
              })

              const row: Record<string, unknown> = {}
              columns.forEach((col, i) => {
                row[col] = values[i]
              })
              table.push(row)
            }

            db.set(tableName, table)
          }
          return { rows: [] }
        }

        return { rows: [] }
      }

      // Execute query against in-memory data
      let rows = [...(db.get(query.table) ?? [])]

      // Apply predicates
      if (query.predicates) {
        rows = rows.filter((row) =>
          query.predicates!.every((pred) => evaluatePredicate(row, pred))
        )
      }

      // Apply offset
      if (query.offset !== undefined) {
        rows = rows.slice(query.offset)
      }

      // Apply limit
      if (query.limit !== undefined) {
        rows = rows.slice(0, query.limit)
      }

      // Apply projection
      if (query.columns) {
        rows = rows.map((row) => {
          const projected: Record<string, unknown> = {}
          for (const col of query.columns!) {
            if (col in row) {
              projected[col] = row[col]
            }
          }
          return projected
        })
      }

      return { rows }
    },

    async *stream(
      query: QueryFragment & { batchSize?: number }
    ): AsyncGenerator<Record<string, unknown>[], void, unknown> {
      const batchSize = query.batchSize ?? 100
      const result = await this.execute(query)

      for (let i = 0; i < result.rows.length; i += batchSize) {
        yield result.rows.slice(i, i + batchSize)
      }
    },

    toSQL(query: QueryFragment): string {
      const parts: string[] = ['SELECT']

      // Columns
      if (query.columns && query.columns.length > 0) {
        parts.push(query.columns.join(', '))
      } else {
        parts.push('*')
      }

      // From
      parts.push('FROM', query.table)

      // Where
      if (query.predicates && query.predicates.length > 0) {
        const whereClauses = query.predicates.map((pred) => {
          const value =
            typeof pred.value === 'string' ? `'${pred.value}'` : pred.value
          return `${pred.column} ${pred.op} ${value}`
        })
        parts.push('WHERE', whereClauses.join(' AND '))
      }

      // Limit
      if (query.limit !== undefined) {
        parts.push('LIMIT', String(query.limit))
      }

      return parts.join(' ')
    },
  }
}

/**
 * Evaluate a predicate against a row
 */
function evaluatePredicate(
  row: Record<string, unknown>,
  pred: QueryPredicate
): boolean {
  // Handle qualified column names (table.column)
  const colName = pred.column.includes('.')
    ? pred.column.split('.').pop()!
    : pred.column

  const rowValue = row[colName]
  const predValue = pred.value

  switch (pred.op) {
    case '=':
      return rowValue === predValue
    case '!=':
      return rowValue !== predValue
    case '>':
      return (rowValue as number) > (predValue as number)
    case '<':
      return (rowValue as number) < (predValue as number)
    case '>=':
      return (rowValue as number) >= (predValue as number)
    case '<=':
      return (rowValue as number) <= (predValue as number)
    case 'LIKE':
      if (typeof rowValue !== 'string' || typeof predValue !== 'string')
        return false
      const regex = new RegExp(
        predValue.replace(/%/g, '.*').replace(/_/g, '.'),
        'i'
      )
      return regex.test(rowValue)
    case 'IN':
      return Array.isArray(predValue) && predValue.includes(rowValue)
    case 'NOT IN':
      return Array.isArray(predValue) && !predValue.includes(rowValue)
    default:
      return true
  }
}

// =============================================================================
// PUSHDOWN OPTIMIZER
// =============================================================================

/**
 * PushdownOptimizer - Pushes predicates, projections, and aggregations to source level
 */
export class PushdownOptimizer {
  constructor(private catalog: Catalog) {}

  /**
   * Optimize a federated query by pushing down operations to sources
   */
  optimize(query: FederatedQuery): PushdownResult {
    const fragments: FragmentPushdown[] = []
    const residualPredicates: QueryPredicate[] = []
    const joinPredicates: QueryPredicate[] = []
    let postProjection: string[] | undefined
    let postAggregations: Aggregation[] | undefined
    let postLimit: number | undefined

    // Extract join predicates first (those with ref) - do this once before the loop
    const singleSourcePredicates: QueryPredicate[] = []
    if (query.predicates) {
      for (const pred of query.predicates) {
        if (pred.ref) {
          joinPredicates.push(pred)
        } else {
          singleSourcePredicates.push(pred)
        }
      }
    }

    // Process each table reference
    for (const tableRef of query.from) {
      const adapter = this.catalog.getAdapter(tableRef.source)
      if (!adapter) {
        throw new Error(`No adapter for source ${tableRef.source}`)
      }

      const caps = adapter.capabilities()
      const pushdown: QueryFragment & { table: string } = {
        table: tableRef.table,
      }

      // Analyze single-source predicates for this table
      const sourcePreds: QueryPredicate[] = []

      for (const pred of singleSourcePredicates) {
        // Check if predicate is for this source
        const predSource = this.getPredicateSource(pred, query.from)
        if (predSource !== tableRef.source) continue

        // Check if source supports this predicate
        if (caps.predicatePushdown) {
          if (
            caps.supportedOperators &&
            !caps.supportedOperators.includes(pred.op)
          ) {
            residualPredicates.push(pred)
          } else {
            sourcePreds.push(pred)
          }
        } else {
          residualPredicates.push(pred)
        }
      }

      if (sourcePreds.length > 0) {
        pushdown.predicates = sourcePreds
      }

      // Handle projection
      if (query.columns) {
        if (caps.projectionPushdown) {
          // Get columns for this source
          const sourceColumns = query.columns.filter((col) => {
            const parts = col.split('.')
            if (parts.length === 2) {
              return parts[0] === tableRef.table || parts[0] === tableRef.source
            }
            return true
          })

          // Also include columns needed for predicates
          const predColumns = (pushdown.predicates || [])
            .map((p) => p.column.split('.').pop()!)
            .filter((c) => !sourceColumns.includes(c))

          pushdown.columns = [...new Set([...sourceColumns, ...predColumns])]
        } else {
          postProjection = query.columns
        }
      }

      // Handle limit (only for single-source queries without joins)
      if (query.limit !== undefined && query.from.length === 1 && !query.join) {
        if (caps.limitPushdown) {
          pushdown.limit = query.limit
        } else {
          postLimit = query.limit
        }
      } else if (query.limit !== undefined) {
        postLimit = query.limit
      }

      // Handle aggregations
      if (query.aggregations && query.groupBy) {
        if (caps.aggregationPushdown) {
          pushdown.aggregations = query.aggregations
          pushdown.groupBy = query.groupBy
        } else {
          postAggregations = query.aggregations
        }
      }

      fragments.push({
        source: tableRef.source,
        pushdown,
      })
    }

    // Determine join execution strategy
    let join: ExecutionJoin | undefined
    if (query.join) {
      const joinDef = Array.isArray(query.join) ? query.join[0]! : query.join
      const stats = this.getJoinStats(query)

      join = {
        type: this.selectJoinStrategy(stats),
        joinType: joinDef.type,
        buildSide: stats.buildSide,
        probeSide: stats.probeSide,
        on: joinDef.on,
      }
    }

    return {
      fragments,
      residualPredicates,
      joinPredicates,
      postProjection,
      postAggregations,
      postLimit,
      join,
    }
  }

  private getPredicateSource(
    pred: QueryPredicate,
    tables: TableRef[]
  ): string | null {
    const parts = pred.column.split('.')
    if (parts.length === 2) {
      // Qualified column: table.column or source.column
      const qualifier = parts[0]!
      const tableRef = tables.find(
        (t) => t.table === qualifier || t.source === qualifier
      )
      return tableRef?.source ?? null
    }
    // Unqualified column - assume first table
    return tables[0]?.source ?? null
  }

  private getJoinStats(query: FederatedQuery): {
    buildSide: string
    probeSide: string
    buildRowCount: number
    probeRowCount: number
  } {
    const tables = query.from
    if (tables.length < 2) {
      return {
        buildSide: tables[0]?.source ?? '',
        probeSide: tables[0]?.source ?? '',
        buildRowCount: 0,
        probeRowCount: 0,
      }
    }

    // Get row counts from statistics
    let minRows = Infinity
    let minSource = tables[0]!.source
    let maxSource = tables[0]!.source

    for (const table of tables) {
      const stats = this.catalog.getStatistics(table.source)
      const tableStats = stats?.tables[table.table]
      const rowCount = tableStats?.rowCount ?? 10000

      if (rowCount < minRows) {
        minRows = rowCount
        minSource = table.source
      }
      if (rowCount >= minRows) {
        maxSource = table.source
      }
    }

    return {
      buildSide: minSource,
      probeSide: maxSource,
      buildRowCount: minRows,
      probeRowCount: 10000,
    }
  }

  private selectJoinStrategy(stats: {
    buildRowCount: number
    probeRowCount: number
  }): 'hash' | 'nested_loop' | 'merge' {
    // Use nested loop for very small build sides
    if (stats.buildRowCount < 100) {
      return 'nested_loop'
    }
    // Default to hash join
    return 'hash'
  }
}

// =============================================================================
// FEDERATED EXECUTOR
// =============================================================================

/**
 * FederatedExecutor - Coordinates distributed execution with streaming results
 */
export class FederatedExecutor {
  constructor(private catalog: Catalog) {}

  /**
   * Execute a federated query plan
   */
  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    const startTime = performance.now()
    const fragmentStats: FragmentStats[] = []
    let totalRowsScanned = 0

    // Execute fragments
    let fragmentResults: Record<string, unknown>[][] = []

    if (plan.parallel && plan.fragments.length > 1) {
      // Execute fragments in parallel
      fragmentResults = await Promise.all(
        plan.fragments.map(async (fragment) => {
          const adapter = this.catalog.getAdapter(fragment.source)
          if (!adapter) {
            throw new Error(`No adapter for source ${fragment.source}`)
          }

          const fragStart = performance.now()
          try {
            const result = await adapter.execute(fragment.pushdown)
            const fragEnd = performance.now()

            if (plan.collectStats) {
              fragmentStats.push({
                source: fragment.source,
                rowsScanned: result.rows.length,
                executionTimeMs: fragEnd - fragStart,
              })
            }

            totalRowsScanned += result.rows.length
            return result.rows
          } catch (error) {
            const err = error as Error
            throw new Error(`${fragment.source}: ${err.message}`)
          }
        })
      )
    } else {
      // Execute fragments sequentially
      for (const fragment of plan.fragments) {
        const adapter = this.catalog.getAdapter(fragment.source)
        if (!adapter) {
          throw new Error(`No adapter for source ${fragment.source}`)
        }

        const fragStart = performance.now()
        try {
          const result = await adapter.execute(fragment.pushdown)
          const fragEnd = performance.now()

          if (plan.collectStats) {
            fragmentStats.push({
              source: fragment.source,
              rowsScanned: result.rows.length,
              executionTimeMs: fragEnd - fragStart,
            })
          }

          totalRowsScanned += result.rows.length
          fragmentResults.push(result.rows)
        } catch (error) {
          const err = error as Error
          throw new Error(`${fragment.source}: ${err.message}`)
        }
      }
    }

    // Join results if needed
    let rows: Record<string, unknown>[]

    if (plan.join && fragmentResults.length >= 2) {
      rows = this.executeJoin(
        fragmentResults[0]!,
        fragmentResults[1]!,
        plan.join
      )
    } else if (fragmentResults.length === 1) {
      rows = fragmentResults[0]!
    } else {
      // No join specified but multiple fragments - concatenate
      rows = fragmentResults.flat()
    }

    // Apply residual predicates
    if (plan.residualPredicates && plan.residualPredicates.length > 0) {
      rows = rows.filter((row) =>
        plan.residualPredicates!.every((pred) => evaluatePredicate(row, pred))
      )
    }

    const endTime = performance.now()

    const result: ExecutionResult = { rows }

    if (plan.collectStats) {
      result.stats = {
        rowsScanned: totalRowsScanned,
        executionTimeMs: endTime - startTime,
        fragmentStats,
      }
    }

    return result
  }

  /**
   * Stream execution results
   */
  async *stream(plan: ExecutionPlan): AsyncGenerator<StreamingResult, void, unknown> {
    const batchSize = plan.streaming?.batchSize ?? 1000

    // For simple single-source plans, stream directly
    if (plan.fragments.length === 1 && !plan.join) {
      const fragment = plan.fragments[0]!
      const adapter = this.catalog.getAdapter(fragment.source)
      if (!adapter) {
        throw new Error(`No adapter for source ${fragment.source}`)
      }

      let batchIndex = 0
      for await (const batch of adapter.stream({
        ...fragment.pushdown,
        batchSize,
      })) {
        let rows = batch

        // Apply residual predicates
        if (plan.residualPredicates && plan.residualPredicates.length > 0) {
          rows = rows.filter((row) =>
            plan.residualPredicates!.every((pred) =>
              evaluatePredicate(row, pred)
            )
          )
        }

        yield { rows, batchIndex: batchIndex++ }
      }
    } else {
      // For complex plans, execute and batch the results
      const result = await this.execute(plan)

      for (let i = 0; i < result.rows.length; i += batchSize) {
        yield {
          rows: result.rows.slice(i, i + batchSize),
          batchIndex: Math.floor(i / batchSize),
        }
      }
    }
  }

  private executeJoin(
    left: Record<string, unknown>[],
    right: Record<string, unknown>[],
    join: ExecutionJoin
  ): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = []

    // Extract join key parts
    const leftKey = join.on.left.split('.').pop()!
    const rightKey = join.on.right.split('.').pop()!

    if (join.type === 'hash') {
      // Build hash table on build side
      const buildRows = join.buildSide === join.on.left.split('.')[0]
        ? left
        : right
      const probeRows = join.buildSide === join.on.left.split('.')[0]
        ? right
        : left
      const buildKey = join.buildSide === join.on.left.split('.')[0]
        ? leftKey
        : rightKey
      const probeKey = join.buildSide === join.on.left.split('.')[0]
        ? rightKey
        : leftKey

      // Build hash table
      const hashTable = new Map<unknown, Record<string, unknown>[]>()
      for (const row of buildRows) {
        const key = row[buildKey]
        if (!hashTable.has(key)) {
          hashTable.set(key, [])
        }
        hashTable.get(key)!.push(row)
      }

      // Probe
      for (const probeRow of probeRows) {
        const key = probeRow[probeKey]
        const matches = hashTable.get(key)

        if (matches) {
          for (const matchRow of matches) {
            results.push({ ...probeRow, ...matchRow })
          }
        } else if (join.joinType === 'LEFT') {
          // Left outer join - include non-matching rows with nulls
          const nullRow: Record<string, unknown> = {}
          for (const key of Object.keys(buildRows[0] || {})) {
            nullRow[key] = null
          }
          results.push({ ...probeRow, ...nullRow })
        }
      }
    } else if (join.type === 'nested_loop') {
      // Nested loop join
      const outer = join.outer === join.on.left.split('.')[0] ? left : right
      const inner = join.outer === join.on.left.split('.')[0] ? right : left
      const outerKey = join.outer === join.on.left.split('.')[0]
        ? leftKey
        : rightKey
      const innerKey = join.outer === join.on.left.split('.')[0]
        ? rightKey
        : leftKey

      for (const outerRow of outer) {
        for (const innerRow of inner) {
          if (outerRow[outerKey] === innerRow[innerKey]) {
            results.push({ ...outerRow, ...innerRow })
          }
        }
      }
    } else {
      // Default to simple nested loop
      for (const leftRow of left) {
        for (const rightRow of right) {
          if (leftRow[leftKey] === rightRow[rightKey]) {
            results.push({ ...leftRow, ...rightRow })
          }
        }
      }
    }

    return results
  }
}

// =============================================================================
// CROSS-SOURCE JOIN EXPORTS
// =============================================================================

export {
  CrossSourceJoin,
  createCrossSourceJoin,
  executeCrossSourceJoin,
  streamCrossSourceJoin,
  executeSemiJoin,
  executeAntiJoin,
  executeCrossJoin,
  executeSortMergeJoin,
  DataTypeConverter,
  type CrossSourceJoinConfig,
  type CrossSourceJoinResult,
  type CrossSourceJoinStats,
  type CrossSourceTableRef,
  type CrossSourceJoinKey,
  type ColumnSpec,
  type TypeConversionRule,
  type StreamingOptions,
  type ExtendedJoinType,
  type SemiJoinConfig,
  type AntiJoinConfig,
  type CrossJoinConfig,
  type SortMergeJoinConfig,
} from './cross-source-join'
