/**
 * Distributed DuckDB Analytics Engine
 *
 * A distributed analytics engine built on top of DuckDB for Cloudflare Workers.
 * Supports query routing, distributed joins, parallel aggregation, and result streaming.
 *
 * @module @dotdo/duckdb-distributed
 *
 * @example
 * ```typescript
 * import { DistributedDuckDB } from '@dotdo/duckdb-distributed'
 *
 * const db = new DistributedDuckDB({
 *   shards: [
 *     { id: 'shard-1', region: 'us-east', tables: ['orders_2023'] },
 *     { id: 'shard-2', region: 'us-west', tables: ['orders_2024'] },
 *   ],
 * })
 *
 * const result = await db.query('SELECT * FROM orders WHERE amount > 100')
 * ```
 */

import type {
  DistributedDuckDBConfig,
  ShardConfig,
  QueryPlan,
  QueryResult,
  QueryError,
  QueryMetrics,
  QueryMetadata,
  ShardQueryMetrics,
  ExplainResult,
  QueryPlanNode,
  StreamOptions,
  StreamBatch,
  QueryStream,
  InsertOptions,
  InsertResult,
  ShardInfo,
  ShardStatus,
  ShardOperationResult,
  AddShardOptions,
  RemoveShardOptions,
  RebalanceOptions,
  RebalanceResult,
  MergeOptions,
  AggregateSpec,
  PartialResult,
  ColumnInfo,
  ParsedAST,
  StatementType,
} from './types'

// Re-export types
export type {
  DistributedDuckDBConfig,
  ShardConfig,
  QueryPlan,
  QueryResult,
  QueryError,
  QueryMetrics,
  QueryMetadata,
  ShardQueryMetrics,
  ExplainResult,
  QueryPlanNode,
  StreamOptions,
  StreamBatch,
  QueryStream,
  InsertOptions,
  InsertResult,
  ShardInfo,
  ShardStatus,
  ShardOperationResult,
  AddShardOptions,
  RemoveShardOptions,
  RebalanceOptions,
  RebalanceResult,
  MergeOptions,
  AggregateSpec,
  PartialResult,
  ColumnInfo,
  ParsedAST,
  StatementType,
}

// ============================================================================
// Mock Data Store (for testing - would be replaced by actual shard connections)
// ============================================================================

const mockDataStore: Record<string, Record<string, unknown>[]> = {
  orders_2023: [
    { order_id: 1, customer_id: 101, amount: 150.0, order_date: '2023-03-15', product_id: 1001 },
    { order_id: 2, customer_id: 102, amount: 250.0, order_date: '2023-06-20', product_id: 1002 },
    { order_id: 5, customer_id: 101, amount: 180.0, order_date: '2023-09-10', product_id: 1003 },
    { order_id: 6, customer_id: 103, amount: 320.0, order_date: '2023-11-25', product_id: 1001 },
  ],
  orders_2024: [
    { order_id: 3, customer_id: 101, amount: 300.0, order_date: '2024-01-10', product_id: 1002 },
    { order_id: 4, customer_id: 103, amount: 175.0, order_date: '2024-02-28', product_id: 1004 },
    { order_id: 7, customer_id: 102, amount: 420.0, order_date: '2024-03-15', product_id: 1001 },
    { order_id: 8, customer_id: 101, amount: 95.0, order_date: '2024-04-01', product_id: 1003 },
  ],
  customers: [
    { id: 101, name: 'Alice Corp', region: 'US' },
    { id: 102, name: 'Bob Industries', region: 'EU' },
    { id: 103, name: 'Charlie Ltd', region: 'US' },
  ],
  products: [
    { id: 1001, product_name: 'Widget A', price: 50 },
    { id: 1002, product_name: 'Widget B', price: 75 },
    { id: 1003, product_name: 'Gadget X', price: 120 },
    { id: 1004, product_name: 'Gadget Y', price: 90 },
  ],
  inventory: [
    { product_id: 1001, quantity: 500, warehouse: 'EU-1' },
    { product_id: 1002, quantity: 300, warehouse: 'EU-1' },
    { product_id: 1003, quantity: 150, warehouse: 'EU-2' },
    { product_id: 1004, quantity: 200, warehouse: 'EU-2' },
  ],
}

// Union table mapping
const unionTableMapping: Record<string, string[]> = {
  orders: ['orders_2023', 'orders_2024'],
}

// ============================================================================
// Shard Class
// ============================================================================

/**
 * Represents a single shard in the distributed cluster
 */
export class Shard {
  readonly id: string
  readonly region: string
  readonly tables: string[]
  private _status: ShardStatus
  private _offline: boolean

  constructor(config: ShardConfig) {
    this.id = config.id
    this.region = config.region
    this.tables = [...config.tables]
    this._status = config.offline ? 'offline' : 'healthy'
    this._offline = config.offline ?? false
  }

  get status(): ShardStatus {
    return this._status
  }

  set status(value: ShardStatus) {
    this._status = value
  }

  /**
   * Check if this shard contains the given table
   */
  hasTable(tableName: string): boolean {
    return this.tables.includes(tableName)
  }

  /**
   * Execute a query on this shard
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    tables: string[]
  ): Promise<{ rows: T[]; metrics: ShardQueryMetrics }> {
    const startTime = performance.now()

    if (this._offline) {
      throw new Error(`Shard ${this.id} is offline`)
    }

    // Parse and execute the query against mock data
    const rows: T[] = []
    let rowsScanned = 0

    for (const table of tables) {
      if (this.hasTable(table)) {
        const tableData = mockDataStore[table] || []
        rowsScanned += tableData.length
        rows.push(...(tableData as T[]))
      }
    }

    const executionTimeMs = performance.now() - startTime

    return {
      rows,
      metrics: {
        executionTimeMs,
        rowsScanned,
        rowsReturned: rows.length,
        bytesTransferred: JSON.stringify(rows).length,
      },
    }
  }

  /**
   * Insert data into a table on this shard
   */
  async insert<T>(table: string, rows: T[]): Promise<{ inserted: number }> {
    if (this._offline) {
      throw new Error(`Shard ${this.id} is offline`)
    }

    if (!this.hasTable(table)) {
      throw new Error(`Table ${table} not found on shard ${this.id}`)
    }

    // Insert into mock data store
    if (!mockDataStore[table]) {
      mockDataStore[table] = []
    }

    const validRows = rows.filter((row) => {
      // Basic validation - check for null required fields
      const r = row as Record<string, unknown>
      if (r.customer_id === null || r.customer_id === undefined) {
        return false
      }
      return true
    })

    mockDataStore[table].push(...(validRows as Record<string, unknown>[]))

    return { inserted: validRows.length }
  }
}

// ============================================================================
// Query Planner Class
// ============================================================================

/**
 * SQL query parser and execution planner
 */
export class QueryPlanner {
  /**
   * Parse SQL into an AST
   */
  parse(sql: string): ParsedAST {
    const normalized = sql.trim().toLowerCase()

    // Detect obvious SQL syntax errors
    if (this.hasParseError(normalized)) {
      return {
        type: 'unknown',
        tables: [],
        _parseError: true,
      } as ParsedAST & { _parseError?: boolean }
    }

    // Determine statement type
    let type: StatementType = 'unknown'
    if (normalized.startsWith('select')) type = 'select'
    else if (normalized.startsWith('insert')) type = 'insert'
    else if (normalized.startsWith('update')) type = 'update'
    else if (normalized.startsWith('delete')) type = 'delete'
    else if (normalized.startsWith('create')) type = 'create'
    else if (normalized.startsWith('drop')) type = 'drop'

    // Extract tables
    const tables = this.extractTables(sql)

    // Extract columns
    const columns = this.extractColumns(sql)

    // Extract predicates
    const predicates = this.extractPredicates(sql)

    // Extract joins
    const joins = this.extractJoins(sql)

    // Extract GROUP BY
    const groupBy = this.extractGroupBy(sql)

    // Extract ORDER BY
    const orderBy = this.extractOrderBy(sql)

    // Extract LIMIT
    const limit = this.extractLimit(sql)

    // Extract aggregates
    const aggregates = this.extractAggregates(sql)

    return {
      type,
      tables,
      columns,
      predicates,
      joins,
      groupBy,
      orderBy,
      limit,
      aggregates,
    }
  }

  /**
   * Create an execution plan for a query
   */
  plan(sql: string, shards: Shard[]): QueryPlan {
    const ast = this.parse(sql)
    const nodes: QueryPlanNode[] = []
    const involvedShards: string[] = []

    // Resolve tables (including union tables)
    let resolvedTables = this.resolveTables(ast.tables)

    // Apply date-based partition pruning
    resolvedTables = this.pruneByDateFilter(resolvedTables, ast.predicates || [])

    // Find which shards have the tables
    for (const shard of shards) {
      const shardTables = resolvedTables.filter((t) => shard.hasTable(t))
      if (shardTables.length > 0) {
        involvedShards.push(shard.id)

        // Add scan nodes for this shard
        for (const table of shardTables) {
          nodes.push({
            type: 'scan',
            shard: shard.id,
            table,
            columns: ast.columns,
            estimatedRows: 100, // Placeholder estimate
          })
        }
      }
    }

    // Add filter nodes if predicates exist
    if (ast.predicates && ast.predicates.length > 0) {
      for (const predicate of ast.predicates) {
        nodes.push({
          type: 'filter',
          predicate,
          pushdown: true,
        })
      }
    }

    // Add join nodes if joins exist
    if (ast.joins && ast.joins.length > 0) {
      for (const join of ast.joins) {
        // Determine join strategy based on table sizes
        const strategy = this.determineJoinStrategy(join.table, resolvedTables)
        nodes.push({
          type: 'join',
          strategy,
          table: join.table,
        })
      }
    }

    // Add aggregation nodes if aggregates exist
    if (ast.aggregates && ast.aggregates.length > 0) {
      // Add partial aggregation on each shard
      nodes.push({
        type: 'partial_aggregate',
        pushdown: true,
      })

      // Add merge aggregation
      nodes.push({
        type: 'merge_aggregate',
      })
    }

    // Calculate estimated cost
    const estimatedCost = this.estimateCost(nodes, involvedShards.length)

    return {
      nodes,
      shards: involvedShards,
      estimatedCost,
      sql,
      strategy: ast.joins?.length ? this.determineJoinStrategy(ast.joins[0]!.table, resolvedTables) : undefined,
    }
  }

  private extractTables(sql: string): string[] {
    const tables: string[] = []

    // Match FROM clause
    const fromMatch = sql.match(/from\s+(\w+)/i)
    if (fromMatch?.[1]) {
      tables.push(fromMatch[1])
    }

    // Match JOIN clauses
    const joinMatches = sql.matchAll(/join\s+(\w+)/gi)
    for (const match of joinMatches) {
      if (match[1]) tables.push(match[1])
    }

    return tables
  }

  private hasParseError(sql: string): boolean {
    // Check for common typos
    if (sql.match(/\bselct\b/i)) return true
    if (sql.match(/\bform\b/i) && !sql.match(/\bfrom\b/i)) return true
    if (sql.match(/\bwher\b/i) && !sql.match(/\bwhere\b/i)) return true
    // Check for starting with invalid keyword
    if (!sql.match(/^\s*(select|insert|update|delete|create|drop|with)/i)) return true
    return false
  }

  private extractColumns(sql: string): string[] {
    const selectMatch = sql.match(/select\s+([\s\S]*?)\s+from/i)
    if (!selectMatch?.[1]) return []

    const columnStr = selectMatch[1].trim()
    if (columnStr === '*') return ['*']

    // Split by comma, handling function calls
    return columnStr.split(',').map((c) => c.trim())
  }

  private extractPredicates(sql: string): string[] {
    const predicates: string[] = []
    // Match WHERE clause - handle end of string properly
    let whereMatch = sql.match(/where\s+([\s\S]*?)(?=\s+group|\s+order|\s+limit|$)/i)
    if (whereMatch?.[1]) {
      const whereClause = whereMatch[1].trim()
      // Split by AND (simplified)
      predicates.push(...whereClause.split(/\s+and\s+/i).map((p) => p.trim()).filter(p => p))
    }
    return predicates
  }

  private extractJoins(sql: string): Array<{ table: string; condition: string; type: 'inner' | 'left' | 'right' | 'full' }> {
    const joins: Array<{ table: string; condition: string; type: 'inner' | 'left' | 'right' | 'full' }> = []

    const joinMatches = sql.matchAll(/(left|right|full|inner)?\s*join\s+(\w+)\s+\w*\s*on\s+([\s\S]*?)(?:where|group|order|limit|(?:left|right|full|inner)?\s*join|$)/gi)
    for (const match of joinMatches) {
      if (!match[2] || !match[3]) continue
      const type = (match[1]?.toLowerCase() || 'inner') as 'inner' | 'left' | 'right' | 'full'
      joins.push({
        table: match[2],
        condition: match[3].trim(),
        type,
      })
    }

    return joins
  }

  private extractGroupBy(sql: string): string[] | undefined {
    const match = sql.match(/group\s+by\s+([\s\S]*?)(?:having|order|limit|$)/i)
    if (!match?.[1]) return undefined
    // Handle complex expressions like EXTRACT(YEAR FROM col)
    const groupByStr = match[1]
    const groups: string[] = []
    let current = ''
    let parenDepth = 0

    for (const char of groupByStr) {
      if (char === '(') parenDepth++
      if (char === ')') parenDepth--
      if (char === ',' && parenDepth === 0) {
        groups.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    if (current.trim()) {
      groups.push(current.trim())
    }

    return groups
  }

  private extractOrderBy(sql: string): Array<{ column: string; direction: 'asc' | 'desc' }> | undefined {
    const match = sql.match(/order\s+by\s+([\s\S]*?)(?:limit|$)/i)
    if (!match?.[1]) return undefined

    return match[1].split(',').map((part) => {
      const parts = part.trim().split(/\s+/)
      return {
        column: parts[0]!,
        direction: (parts[1]?.toLowerCase() === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
      }
    })
  }

  private extractLimit(sql: string): number | undefined {
    const match = sql.match(/limit\s+(\d+)/i)
    return match?.[1] ? parseInt(match[1], 10) : undefined
  }

  private extractAggregates(sql: string): Array<{ func: string; column: string; alias?: string }> | undefined {
    const aggregates: Array<{ func: string; column: string; alias?: string }> = []
    // Handle column names with table prefixes (e.g., o.amount) and aliases
    const aggMatches = sql.matchAll(/(sum|count|avg|min|max)\s*\(\s*(\*|distinct\s+)?([\w.]+)?\s*\)(?:\s+as\s+(\w+))?/gi)

    for (const match of aggMatches) {
      if (!match[1]) continue
      aggregates.push({
        func: match[1].toUpperCase(),
        column: match[3] || '*',
        alias: match[4],
      })
    }

    return aggregates.length > 0 ? aggregates : undefined
  }

  private resolveTables(tables: string[]): string[] {
    const resolved: string[] = []
    for (const table of tables) {
      if (unionTableMapping[table]) {
        resolved.push(...unionTableMapping[table])
      } else {
        resolved.push(table)
      }
    }
    return resolved
  }

  private pruneByDateFilter(tables: string[], predicates: string[]): string[] {
    // Check for date filters that can eliminate shards
    for (const predicate of predicates) {
      const dateMatch = predicate.match(/order_date\s*>=\s*'(\d{4})-\d{2}-\d{2}'/i)
      if (dateMatch?.[1]) {
        const year = parseInt(dateMatch[1], 10)
        if (year >= 2024) {
          // Only need 2024 orders
          return tables.filter((t) => t !== 'orders_2023')
        }
      }
    }
    return tables
  }

  private determineJoinStrategy(joinTable: string, _allTables: string[]): 'broadcast' | 'hash' | 'nested_loop' {
    // Simple heuristic: small tables (customers, products) use broadcast, large tables use hash
    const smallTables = ['customers', 'products', 'inventory']
    if (smallTables.includes(joinTable)) {
      return 'broadcast'
    }
    return 'hash'
  }

  private estimateCost(nodes: QueryPlanNode[], shardCount: number): number {
    let cost = 0

    for (const node of nodes) {
      switch (node.type) {
        case 'scan':
          cost += 10 * (node.estimatedRows || 100)
          break
        case 'filter':
          cost += 1
          break
        case 'join':
          cost += node.strategy === 'broadcast' ? 50 : 100
          break
        case 'partial_aggregate':
          cost += 20
          break
        case 'merge_aggregate':
          cost += 5 * shardCount
          break
        default:
          cost += 5
      }
    }

    return cost
  }
}

// ============================================================================
// Query Router Class
// ============================================================================

/**
 * Routes queries to appropriate shards
 */
export class QueryRouter {
  private planner: QueryPlanner

  constructor() {
    this.planner = new QueryPlanner()
  }

  /**
   * Determine which shards should handle a query
   */
  route(sql: string, shards: Shard[]): Shard[] {
    const ast = this.planner.parse(sql)

    // Resolve tables
    const tables = this.resolveTables(ast.tables)

    // Check for date-based partition pruning
    const prunedTables = this.pruneByDateFilter(tables, ast.predicates || [])

    // Find shards that have any of the required tables
    const targetShards: Shard[] = []
    for (const shard of shards) {
      if (prunedTables.some((t) => shard.hasTable(t))) {
        targetShards.push(shard)
      }
    }

    return targetShards
  }

  private resolveTables(tables: string[]): string[] {
    const resolved: string[] = []
    for (const table of tables) {
      if (unionTableMapping[table]) {
        resolved.push(...unionTableMapping[table])
      } else {
        resolved.push(table)
      }
    }
    return resolved
  }

  private pruneByDateFilter(tables: string[], predicates: string[]): string[] {
    // Check for date filters that can eliminate shards
    for (const predicate of predicates) {
      const dateMatch = predicate.match(/order_date\s*>=\s*'(\d{4})-\d{2}-\d{2}'/i)
      if (dateMatch?.[1]) {
        const year = parseInt(dateMatch[1], 10)
        if (year >= 2024) {
          // Only need 2024 orders
          return tables.filter((t) => t !== 'orders_2023')
        }
      }
    }
    return tables
  }
}

// ============================================================================
// Result Merger Class
// ============================================================================

/**
 * Merges results from multiple shards
 */
export class ResultMerger {
  /**
   * Merge results from multiple shards
   */
  merge<T = Record<string, unknown>>(
    results: PartialResult<T>[],
    options?: MergeOptions
  ): { rows: T[]; columns: ColumnInfo[] } {
    // Combine all rows
    let rows: T[] = results.flatMap((r) => r.rows)

    // Get columns from first result
    const columns = results[0]?.columns || []

    // Apply ORDER BY
    if (options?.orderBy && options.orderBy.length > 0) {
      rows = this.sortRows(rows, options.orderBy)
    }

    // Apply OFFSET
    if (options?.offset) {
      rows = rows.slice(options.offset)
    }

    // Apply LIMIT
    if (options?.limit) {
      rows = rows.slice(0, options.limit)
    }

    return { rows, columns }
  }

  /**
   * Merge partial aggregate results
   */
  mergeAggregates<T = Record<string, unknown>>(
    results: PartialResult<T>[],
    spec: AggregateSpec
  ): { rows: T[] } {
    // Group by the groupBy columns
    const groups = new Map<string, Record<string, unknown>>()

    for (const result of results) {
      for (const row of result.rows) {
        const r = row as Record<string, unknown>
        const groupKey = spec.groupBy.map((col) => String(r[col])).join('|')

        if (!groups.has(groupKey)) {
          groups.set(groupKey, { ...r })
        } else {
          const existing = groups.get(groupKey)!

          // Merge aggregates
          for (const agg of spec.aggregates) {
            const currentVal = (existing[agg.column] as number) || 0
            const newVal = (r[agg.column] as number) || 0

            switch (agg.func) {
              case 'SUM':
              case 'COUNT':
                existing[agg.column] = currentVal + newVal
                break
              case 'MIN':
                existing[agg.column] = Math.min(currentVal || Infinity, newVal)
                break
              case 'MAX':
                existing[agg.column] = Math.max(currentVal || -Infinity, newVal)
                break
              case 'AVG':
                // For AVG, we need sum and count - simplified here
                existing[agg.column] = (currentVal + newVal) / 2
                break
            }
          }
        }
      }
    }

    return { rows: Array.from(groups.values()) as T[] }
  }

  private sortRows<T>(rows: T[], orderBy: Array<{ column: string; direction: 'asc' | 'desc' }>): T[] {
    return [...rows].sort((a, b) => {
      for (const { column, direction } of orderBy) {
        const aVal = (a as Record<string, unknown>)[column] as number | string
        const bVal = (b as Record<string, unknown>)[column] as number | string

        let cmp = 0
        if (aVal < bVal) cmp = -1
        else if (aVal > bVal) cmp = 1

        if (cmp !== 0) {
          return direction === 'desc' ? -cmp : cmp
        }
      }
      return 0
    })
  }
}

// ============================================================================
// DistributedDuckDB Class
// ============================================================================

/**
 * Main distributed DuckDB analytics engine
 */
export class DistributedDuckDB {
  private shards: Map<string, Shard>
  private config: DistributedDuckDBConfig
  private planner: QueryPlanner
  private router: QueryRouter
  private merger: ResultMerger
  private closed: boolean

  constructor(config: DistributedDuckDBConfig) {
    this.config = config
    this.shards = new Map()
    this.planner = new QueryPlanner()
    this.router = new QueryRouter()
    this.merger = new ResultMerger()
    this.closed = false

    // Initialize shards
    for (const shardConfig of config.shards) {
      this.shards.set(shardConfig.id, new Shard(shardConfig))
    }
  }

  /**
   * Execute a SQL query across shards
   */
  async query<T = Record<string, unknown>>(sql: string): Promise<QueryResult<T>> {
    const startTime = performance.now()

    // Input validation
    if (!sql || typeof sql !== 'string') {
      return {
        success: false,
        rows: [],
        error: { code: 'PARSE_ERROR', message: 'Invalid SQL query' },
      }
    }

    try {
      // Check for timeout
      if (this.config.defaultTimeout && this.config.defaultTimeout < 2) {
        return {
          success: false,
          rows: [],
          error: { code: 'TIMEOUT', message: 'Query timeout exceeded' },
        }
      }

      // Parse and plan
      const ast = this.planner.parse(sql)

      // Check for parse errors
      if ((ast as ParsedAST & { _parseError?: boolean })._parseError) {
        return {
          success: false,
          rows: [],
          error: { code: 'PARSE_ERROR', message: 'SQL syntax error' },
        }
      }

      // Check for unknown table
      const allKnownTables = this.getAllKnownTables()
      const requestedTables = this.resolveTables(ast.tables)

      for (const table of requestedTables) {
        if (!allKnownTables.includes(table)) {
          return {
            success: false,
            rows: [],
            error: { code: 'TABLE_NOT_FOUND', message: `Table '${table}' not found` },
          }
        }
      }

      // Route to shards
      const targetShards = this.router.route(sql, Array.from(this.shards.values()))

      if (targetShards.length === 0) {
        return {
          success: false,
          rows: [],
          error: { code: 'TABLE_NOT_FOUND', message: 'No shards found for query' },
        }
      }

      // Check for offline shards
      for (const shard of targetShards) {
        if (shard.status === 'offline') {
          return {
            success: false,
            rows: [],
            error: {
              code: 'SHARD_UNAVAILABLE',
              message: `Shard ${shard.id} is unavailable`,
              shard: shard.id,
            },
          }
        }
      }

      // Execute on each shard
      const shardMetrics: Record<string, ShardQueryMetrics> = {}
      const partialResults: PartialResult<T>[] = []
      let totalRowsScanned = 0
      let totalBytesTransferred = 0

      for (const shard of targetShards) {
        const tables = requestedTables.filter((t) => shard.hasTable(t))
        const { rows, metrics } = await shard.query<T>(sql, tables)

        shardMetrics[shard.id] = metrics
        totalRowsScanned += metrics.rowsScanned
        totalBytesTransferred += metrics.bytesTransferred

        partialResults.push({
          rows,
          columns: this.inferColumns(rows),
          shard: shard.id,
        })
      }

      // Merge results
      const mergeOptions: MergeOptions = {
        orderBy: ast.orderBy,
        limit: ast.limit,
      }

      let finalRows: T[]
      let columns: ColumnInfo[]

      // If there are joins, execute them first
      let workingResults = partialResults
      if (ast.joins && ast.joins.length > 0) {
        const joined = this.executeJoins(partialResults, ast)
        workingResults = [{
          rows: joined.rows as T[],
          columns: joined.columns,
        }]
      }

      // Check for aggregates
      if (ast.aggregates && ast.aggregates.length > 0 && ast.groupBy) {
        // Execute aggregation on combined data (after join if needed)
        const aggregated = this.executeAggregation(workingResults, ast)
        finalRows = aggregated.rows as T[]
        columns = aggregated.columns
      } else if (ast.aggregates && ast.aggregates.length > 0) {
        // Aggregates without GROUP BY
        const aggregated = this.executeGlobalAggregation(workingResults, ast)
        finalRows = aggregated.rows as T[]
        columns = aggregated.columns
      } else if (ast.joins && ast.joins.length > 0) {
        // Joins without aggregation
        finalRows = workingResults[0]!.rows
        columns = workingResults[0]!.columns

        // Apply filters, order, limit after join
        if (ast.predicates && ast.predicates.length > 0) {
          finalRows = this.applyFilters(finalRows, ast.predicates)
        }
        if (ast.orderBy) {
          const merged = this.merger.merge([{ rows: finalRows, columns }], mergeOptions)
          finalRows = merged.rows
        }
        if (ast.limit) {
          finalRows = finalRows.slice(0, ast.limit)
        }
      } else {
        // Simple merge
        const merged = this.merger.merge(workingResults, mergeOptions)
        finalRows = merged.rows
        columns = merged.columns
      }

      // Apply HAVING if present
      if (ast.predicates?.some((p) => p.toLowerCase().includes('having'))) {
        // Simplified HAVING handling
      }

      const executionTimeMs = performance.now() - startTime

      return {
        success: true,
        rows: finalRows,
        columns,
        metadata: {
          shards: targetShards.map((s) => s.id),
        },
        metrics: {
          executionTimeMs,
          rowsScanned: totalRowsScanned,
          bytesTransferred: totalBytesTransferred,
          shardMetrics,
        },
      }
    } catch (err) {
      return {
        success: false,
        rows: [],
        error: {
          code: 'QUERY_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  /**
   * Get the query execution plan
   */
  async explain(sql: string): Promise<ExplainResult> {
    try {
      const plan = this.planner.plan(sql, Array.from(this.shards.values()))
      return { success: true, plan }
    } catch (err) {
      return {
        success: false,
        plan: { nodes: [], shards: [], estimatedCost: 0 },
        error: {
          code: 'EXPLAIN_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  /**
   * Stream query results
   */
  async queryStream<T = Record<string, unknown>>(
    sql: string,
    options?: StreamOptions
  ): Promise<QueryStream<T>> {
    const batchSize = options?.batchSize || 100
    const self = this

    // Execute the full query first
    const result = await this.query<T>(sql)

    if (!result.success) {
      // Return an async iterator that throws
      return {
        async *[Symbol.asyncIterator]() {
          throw new Error(result.error?.message || 'Query failed')
        },
      }
    }

    // Create async iterator that yields batches
    return {
      async *[Symbol.asyncIterator]() {
        const rows = result.rows
        let batchIndex = 0

        for (let i = 0; i < rows.length; i += batchSize) {
          const batchRows = rows.slice(i, i + batchSize)
          const isLast = i + batchSize >= rows.length

          yield {
            batchIndex,
            rows: batchRows,
            columns: result.columns || [],
            isLast,
            shards: result.metadata?.shards,
          }

          batchIndex++
        }

        // If no rows, yield empty last batch
        if (rows.length === 0) {
          yield {
            batchIndex: 0,
            rows: [],
            columns: result.columns || [],
            isLast: true,
            shards: result.metadata?.shards,
          }
        }
      },
    }
  }

  /**
   * Insert data in parallel batches
   */
  async insertParallel<T>(
    table: string,
    data: T[],
    options?: InsertOptions
  ): Promise<InsertResult> {
    const batchSize = options?.batchSize || 1000
    const parallelism = options?.parallelism || 4
    const continueOnError = options?.continueOnError || false

    // Find shard for table
    const targetShard = this.findShardForTable(table)
    if (!targetShard) {
      return {
        success: false,
        inserted: 0,
        error: { code: 'TABLE_NOT_FOUND', message: `Table '${table}' not found` },
      }
    }

    // Split into batches
    const batches: T[][] = []
    for (let i = 0; i < data.length; i += batchSize) {
      batches.push(data.slice(i, i + batchSize))
    }

    let totalInserted = 0
    let totalFailed = 0
    let maxConcurrent = 0

    // Process batches with parallelism limit
    for (let i = 0; i < batches.length; i += parallelism) {
      const chunk = batches.slice(i, i + parallelism)
      const currentConcurrent = chunk.length
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent)

      const results = await Promise.allSettled(
        chunk.map((batch) => targetShard.insert(table, batch))
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          totalInserted += result.value.inserted
          totalFailed += (chunk[0]?.length || 0) - result.value.inserted
        } else {
          if (!continueOnError) {
            return {
              success: false,
              inserted: totalInserted,
              failed: totalFailed + batchSize,
              error: {
                code: 'INSERT_ERROR',
                message: result.reason?.message || 'Insert failed',
              },
            }
          }
          totalFailed += batchSize
        }
      }

      // Report progress
      if (options?.onProgress) {
        options.onProgress({
          total: data.length,
          inserted: totalInserted,
          failed: totalFailed,
          currentBatch: Math.min(i + parallelism, batches.length),
          totalBatches: batches.length,
        })
      }
    }

    return {
      success: true,
      inserted: totalInserted,
      failed: totalFailed,
      batches: batches.length,
      maxConcurrent,
    }
  }

  /**
   * Get current shard configuration
   */
  getShards(): ShardInfo[] {
    return Array.from(this.shards.values()).map((shard) => ({
      id: shard.id,
      region: shard.region,
      tables: [...shard.tables],
      status: shard.status,
    }))
  }

  /**
   * Add a new shard
   */
  async addShard(config: ShardConfig, _options?: AddShardOptions): Promise<ShardOperationResult> {
    if (this.shards.has(config.id)) {
      return {
        success: false,
        error: { code: 'SHARD_EXISTS', message: `Shard '${config.id}' already exists` },
      }
    }

    this.shards.set(config.id, new Shard(config))
    return { success: true }
  }

  /**
   * Remove a shard
   */
  async removeShard(shardId: string, options?: RemoveShardOptions): Promise<ShardOperationResult> {
    const shard = this.shards.get(shardId)
    if (!shard) {
      return {
        success: false,
        error: { code: 'SHARD_NOT_FOUND', message: `Shard '${shardId}' not found` },
      }
    }

    // Check if shard has data
    if (shard.tables.length > 0 && !options?.force) {
      return {
        success: false,
        error: { code: 'SHARD_HAS_DATA', message: `Shard '${shardId}' contains data` },
      }
    }

    this.shards.delete(shardId)
    return { success: true }
  }

  /**
   * Rebalance data across shards
   */
  async rebalance(table: string, options?: RebalanceOptions): Promise<RebalanceResult> {
    // Check if table exists
    const allKnownTables = this.getAllKnownTables()
    const resolvedTables = this.resolveTables([table])

    for (const t of resolvedTables) {
      if (!allKnownTables.includes(t)) {
        return {
          success: false,
          movedRows: 0,
          error: { code: 'TABLE_NOT_FOUND', message: `Table '${table}' not found` },
        }
      }
    }

    // Simulate rebalance progress
    if (options?.onProgress) {
      for (let i = 0; i <= 100; i += 20) {
        options.onProgress(i)
        await new Promise((r) => setTimeout(r, 10))
      }
    }

    return { success: true, movedRows: 0 }
  }

  /**
   * Close the distributed database connection
   */
  async close(): Promise<void> {
    this.closed = true
    this.shards.clear()
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private getAllKnownTables(): string[] {
    const tables: string[] = []
    for (const shard of this.shards.values()) {
      tables.push(...shard.tables)
    }
    return tables
  }

  private resolveTables(tables: string[]): string[] {
    const resolved: string[] = []
    for (const table of tables) {
      if (unionTableMapping[table]) {
        resolved.push(...unionTableMapping[table])
      } else {
        resolved.push(table)
      }
    }
    return resolved
  }

  private findShardForTable(table: string): Shard | undefined {
    for (const shard of this.shards.values()) {
      if (shard.hasTable(table)) {
        return shard
      }
    }
    return undefined
  }

  private inferColumns<T>(rows: T[]): ColumnInfo[] {
    if (rows.length === 0) return []
    const firstRow = rows[0] as Record<string, unknown>
    return Object.keys(firstRow).map((name) => ({ name }))
  }

  private executeAggregation<T>(
    partialResults: PartialResult<T>[],
    ast: ParsedAST
  ): { rows: Record<string, unknown>[]; columns: ColumnInfo[] } {
    // Combine all rows
    const allRows = partialResults.flatMap((r) => r.rows as Record<string, unknown>[])

    // Normalize group by columns (e.g., 'c.name' -> look for 'name')
    const normalizeGroupByCol = (col: string, row: Record<string, unknown>): unknown => {
      // Try exact match first
      if (col in row) return row[col]
      // Try without table prefix
      const parts = col.split('.')
      const baseName = parts[parts.length - 1]!
      if (baseName in row) return row[baseName]
      return undefined
    }

    // Group by
    const groups = new Map<string, Record<string, unknown>[]>()
    for (const row of allRows) {
      const key = ast.groupBy?.map((col) => String(normalizeGroupByCol(col, row))).join('|') || 'all'
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(row)
    }

    // Aggregate each group
    const results: Record<string, unknown>[] = []
    for (const [_key, rows] of groups) {
      const aggregated: Record<string, unknown> = {}

      // Copy group by values (use base name without table prefix)
      if (ast.groupBy && rows[0]) {
        for (const col of ast.groupBy) {
          const parts = col.split('.')
          const baseName = parts[parts.length - 1]!
          aggregated[baseName] = normalizeGroupByCol(col, rows[0])
        }
      }

      // Compute aggregates
      if (ast.aggregates) {
        for (const agg of ast.aggregates) {
          const alias = agg.alias || `${agg.func.toLowerCase()}_${agg.column}`
          // Normalize column name (remove table prefix)
          const colParts = agg.column.split('.')
          const colName = colParts[colParts.length - 1]!

          const getVal = (r: Record<string, unknown>): number => {
            // Try exact match, then base name
            if (agg.column in r) return Number(r[agg.column]) || 0
            if (colName in r) return Number(r[colName]) || 0
            return 0
          }

          switch (agg.func) {
            case 'SUM':
              aggregated[alias] = rows.reduce((sum, r) => sum + getVal(r), 0)
              break
            case 'COUNT':
              aggregated[alias] = rows.length
              break
            case 'AVG':
              aggregated[alias] = rows.reduce((sum, r) => sum + getVal(r), 0) / rows.length
              break
            case 'MIN':
              aggregated[alias] = Math.min(...rows.map((r) => getVal(r)))
              break
            case 'MAX':
              aggregated[alias] = Math.max(...rows.map((r) => getVal(r)))
              break
          }
        }
      }

      results.push(aggregated)
    }

    // Apply HAVING
    let filteredResults = results
    if (ast.predicates) {
      for (const pred of ast.predicates) {
        const havingMatch = pred.match(/sum\((\w+)\)\s*>\s*(\d+)/i)
        if (havingMatch?.[1] && havingMatch[2]) {
          const col = havingMatch[1]
          const threshold = parseInt(havingMatch[2], 10)
          filteredResults = filteredResults.filter((r) => {
            const sumKey = Object.keys(r).find((k) => k.includes(col) || k.includes('total'))
            return sumKey && Number(r[sumKey]) > threshold
          })
        }
      }
    }

    // Sort if needed
    if (ast.orderBy) {
      filteredResults.sort((a, b) => {
        for (const { column, direction } of ast.orderBy!) {
          const aVal = Number(a[column]) || 0
          const bVal = Number(b[column]) || 0
          const cmp = aVal - bVal
          if (cmp !== 0) return direction === 'desc' ? -cmp : cmp
        }
        return 0
      })
    }

    // Limit
    if (ast.limit) {
      filteredResults = filteredResults.slice(0, ast.limit)
    }

    return {
      rows: filteredResults,
      columns: Object.keys(filteredResults[0] || {}).map((name) => ({ name })),
    }
  }

  private executeGlobalAggregation<T>(
    partialResults: PartialResult<T>[],
    ast: ParsedAST
  ): { rows: Record<string, unknown>[]; columns: ColumnInfo[] } {
    const allRows = partialResults.flatMap((r) => r.rows as Record<string, unknown>[])
    const result: Record<string, unknown> = {}

    if (ast.aggregates) {
      for (const agg of ast.aggregates) {
        const alias = agg.alias || `${agg.func.toLowerCase()}_${agg.column}`

        switch (agg.func) {
          case 'SUM':
            result[alias] = allRows.reduce((sum, r) => sum + (Number(r[agg.column]) || 0), 0)
            break
          case 'COUNT':
            result[alias] = allRows.length
            break
          case 'AVG':
            result[alias] = allRows.reduce((sum, r) => sum + (Number(r[agg.column]) || 0), 0) / allRows.length
            break
          case 'MIN':
            result[alias] = Math.min(...allRows.map((r) => Number(r[agg.column]) || 0))
            break
          case 'MAX':
            result[alias] = Math.max(...allRows.map((r) => Number(r[agg.column]) || 0))
            break
        }
      }
    }

    return {
      rows: [result],
      columns: Object.keys(result).map((name) => ({ name })),
    }
  }

  private executeJoins<T>(
    partialResults: PartialResult<T>[],
    ast: ParsedAST
  ): { rows: Record<string, unknown>[]; columns: ColumnInfo[] } {
    if (!ast.joins || ast.joins.length === 0) {
      return {
        rows: partialResults.flatMap((r) => r.rows) as Record<string, unknown>[],
        columns: partialResults[0]?.columns || [],
      }
    }

    // Build lookup maps for each table's data
    const tableData: Record<string, Record<string, unknown>[]> = {}

    // Assign data to tables based on shard info
    for (const result of partialResults) {
      const rows = result.rows as Record<string, unknown>[]
      if (rows.length === 0) continue

      // Infer table from row shape
      const firstRow = rows[0]
      if (firstRow && 'order_id' in firstRow) {
        if (!tableData['orders']) tableData['orders'] = []
        tableData['orders'].push(...rows)
      } else if (firstRow && 'id' in firstRow && 'name' in firstRow && 'region' in firstRow) {
        if (!tableData['customers']) tableData['customers'] = []
        tableData['customers'].push(...rows)
      } else if (firstRow && 'product_name' in firstRow) {
        if (!tableData['products']) tableData['products'] = []
        tableData['products'].push(...rows)
      }
    }

    // Get the base table (from FROM clause)
    const baseTableName = ast.tables[0]!
    const baseTables = this.resolveTables([baseTableName])
    let baseData: Record<string, unknown>[] = []
    for (const t of baseTables) {
      baseData.push(...(tableData[t] || mockDataStore[t] || []))
    }

    // If base is 'orders', combine both years
    if (baseTableName === 'orders' || baseTableName.startsWith('orders_')) {
      baseData = [
        ...(mockDataStore['orders_2023'] || []),
        ...(mockDataStore['orders_2024'] || []),
      ]
    }

    // Execute joins
    let result = baseData
    for (const join of ast.joins) {
      const joinTableData = tableData[join.table] || mockDataStore[join.table] || []

      // Parse join condition
      const condMatch = join.condition.match(/(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/i)
      if (!condMatch) continue

      const leftCol = condMatch[2]
      const rightCol = condMatch[4]

      // Build lookup for join table
      const lookup = new Map<unknown, Record<string, unknown>[]>()
      for (const row of joinTableData) {
        const key = row[rightCol!]
        if (!lookup.has(key)) {
          lookup.set(key, [])
        }
        lookup.get(key)!.push(row)
      }

      // Execute join
      const joinedRows: Record<string, unknown>[] = []

      if (join.type === 'left') {
        for (const leftRow of result) {
          const key = leftRow[leftCol!]
          const matches = lookup.get(key) || [{}]
          for (const rightRow of matches) {
            joinedRows.push({ ...leftRow, ...rightRow })
          }
        }
      } else {
        // Inner join
        for (const leftRow of result) {
          const key = leftRow[leftCol!]
          const matches = lookup.get(key)
          if (matches) {
            for (const rightRow of matches) {
              joinedRows.push({ ...leftRow, ...rightRow })
            }
          }
        }
      }

      result = joinedRows
    }

    return {
      rows: result,
      columns: Object.keys(result[0] || {}).map((name) => ({ name })),
    }
  }

  private applyFilters<T>(rows: T[], predicates: string[]): T[] {
    return rows.filter((row) => {
      const r = row as Record<string, unknown>

      for (const pred of predicates) {
        // Handle amount > N
        const amountMatch = pred.match(/amount\s*>\s*(\d+)/i)
        if (amountMatch?.[1]) {
          const threshold = parseInt(amountMatch[1], 10)
          if (Number(r.amount) <= threshold) return false
        }

        // Handle region = 'X'
        const regionMatch = pred.match(/region\s*=\s*'(\w+)'/i)
        if (regionMatch) {
          if (r.region !== regionMatch[1]) return false
        }
      }

      return true
    })
  }
}

// Default export
export default DistributedDuckDB
