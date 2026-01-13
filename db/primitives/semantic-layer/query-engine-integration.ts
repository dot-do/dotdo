/**
 * SemanticQueryEngine - Integration with QueryEngine
 *
 * Integrates SemanticLayer with existing QueryEngine primitive:
 * - Register semantic layer as query source in QueryEngine
 * - Use QueryEngine's SQL parser for custom SQL validation
 * - Leverage QueryEngine's execution engine for query execution
 * - Integration with AggregationPipeline for rollup computation
 * - Unified query planning across raw and semantic queries
 * - Query explain/analyze for semantic queries
 *
 * Architecture:
 * ```
 * SemanticQuery -> SemanticLayer -> SQL AST -> QueryEngine -> Execution
 * ```
 *
 * @see dotdo-pozph
 */

import {
  SemanticLayer,
  type SemanticQuery,
  type QueryResult as SemanticQueryResult,
  CubeNotFoundError,
  InvalidQueryError,
} from './index'

import {
  SQLWhereParser,
  PredicateCompiler,
  QueryPlanner,
  ExecutionEngine,
  type QueryPlan,
  type ExecutionContext,
  type ExecutionResult,
  type TypedColumnStore,
  type QueryNode,
  type PredicateNode,
  type LogicalNode,
  type SortNode,
  type GroupByNode,
  type IndexInfo,
  and,
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
  inSet,
  notInSet,
  between,
  createSort,
  asc,
  desc,
} from '../query-engine'

import {
  createPipeline,
  PipelineBuilder,
  createGroupStage,
  createMatchStage,
  createProjectStage,
  createSortStage,
  createLimitStage,
  createCubeStage,
  createRollupStage,
  createStreamingPipeline,
  type Pipeline,
  type Stage,
  type StreamingPipeline,
  type GroupSpec,
} from '../aggregation-pipeline'

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Base error for semantic query engine operations
 */
export class SemanticQueryError extends Error {
  public readonly context?: {
    query?: SemanticQuery
    sql?: string
    [key: string]: unknown
  }

  constructor(message: string, context?: SemanticQueryError['context']) {
    super(message)
    this.name = 'SemanticQueryError'
    this.context = context
  }
}

/**
 * Error thrown for invalid semantic query structure
 */
export class InvalidSemanticQueryError extends SemanticQueryError {
  constructor(message: string, context?: SemanticQueryError['context']) {
    super(message, context)
    this.name = 'InvalidSemanticQueryError'
  }
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Configuration for SemanticQueryEngine
 */
export interface SemanticQueryEngineConfig {
  /** The semantic layer with cube definitions */
  semanticLayer: SemanticLayer
  /** Single column store for all cubes */
  columnStore?: TypedColumnStore
  /** Multiple column stores keyed by cube name */
  columnStores?: Record<string, TypedColumnStore>
  /** Enable query result caching */
  enableCaching?: boolean
  /** Cache configuration */
  cacheConfig?: {
    ttl?: number
    maxEntries?: number
  }
  /** Enable explain output */
  enableExplain?: boolean
  /** Query timeout in milliseconds */
  timeout?: number
}

/**
 * Semantic query plan with unified planning info
 */
export interface SemanticQueryPlan extends QueryPlan {
  /** Uses pre-aggregation table */
  usesPreAggregation?: boolean
  /** Name of pre-aggregation being used */
  preAggregationName?: string
  /** Join information for multi-cube queries */
  join?: {
    type: string
    buildSide?: 'left' | 'right'
  }
  /** Index hint for query optimization */
  indexHint?: IndexInfo
  /** Estimated selectivity (0-1) */
  estimatedSelectivity?: number
}

/**
 * Result from semantic query execution
 */
export interface SemanticExecutionResult {
  /** Query result data */
  data: Record<string, unknown>[]
  /** Generated SQL */
  sql: string
  /** Execution statistics */
  executionStats: {
    rowsScanned: number
    rowsReturned: number
    executionTimeMs: number
    cacheHit?: boolean
    partitionsPruned?: number
  }
  /** Pre-aggregation used if any */
  usedPreAggregation?: string
}

/**
 * Query explain output
 */
export interface QueryExplain {
  /** Generated SQL */
  sql: string
  /** Query plan */
  plan: SemanticQueryPlan
  /** Estimated cost */
  estimatedCost: number
  /** Step-by-step transformation */
  steps: Array<{
    name: string
    description: string
    cost?: number
  }>
  /** Index usage recommendations */
  indexRecommendations?: Array<{
    column: string
    type: string
    reason: string
  }>
  /** Optimization suggestions */
  optimizationSuggestions?: string[]
  /** Whether pre-aggregation is used */
  usesPreAggregation?: boolean
  /** Name of pre-aggregation */
  preAggregationName?: string
}

/**
 * Query analysis output with actual execution metrics
 */
export interface QueryAnalysis {
  /** Estimated row count */
  estimatedRows: number
  /** Actual row count */
  actualRows: number
  /** Execution time in milliseconds */
  executionTimeMs: number
  /** Breakdown of operations */
  operationBreakdown: Array<{
    operation: string
    timeMs: number
    rowsProcessed: number
  }>
}

/**
 * AST representation of semantic query
 */
export interface SemanticQueryAST {
  type: 'semantic'
  measures: Array<{ cubeName: string; name: string }>
  dimensions: Array<{ cubeName: string; name: string; granularity?: string }>
  timeDimensions: Array<{
    cubeName: string
    name: string
    granularity?: string
    dateRange?: [string, string]
  }>
  filter?: QueryNode
  sort?: SortNode
}

/**
 * Aggregation pipeline options
 */
export interface AggregationPipelineOptions {
  useCube?: boolean
  useRollup?: boolean
}

/**
 * SQL validation result
 */
export interface SQLValidationResult {
  sql: string
  isValid: boolean
  errors: Array<{ message: string; position?: number }>
}

// =============================================================================
// SEMANTIC QUERY ENGINE
// =============================================================================

/**
 * SemanticQueryEngine - Integrates SemanticLayer with QueryEngine
 */
export class SemanticQueryEngine {
  private semanticLayer: SemanticLayer
  private columnStore?: TypedColumnStore
  private columnStores: Map<string, TypedColumnStore> = new Map()
  private sqlParser: SQLWhereParser
  private predicateCompiler: PredicateCompiler
  private queryPlanner: QueryPlanner
  private executionEngine: ExecutionEngine
  private indexes: Map<string, IndexInfo[]> = new Map()
  private planCache: Map<string, SemanticQueryPlan> = new Map()
  private enableCaching: boolean
  private timeout: number

  constructor(config: SemanticQueryEngineConfig) {
    this.semanticLayer = config.semanticLayer
    this.columnStore = config.columnStore
    this.enableCaching = config.enableCaching ?? false
    this.timeout = config.timeout ?? 30000

    // Setup column stores
    if (config.columnStores) {
      for (const [name, store] of Object.entries(config.columnStores)) {
        this.columnStores.set(name, store)
      }
    }

    // Initialize query engine components
    this.sqlParser = new SQLWhereParser()
    this.predicateCompiler = new PredicateCompiler()
    this.queryPlanner = new QueryPlanner()
    this.executionEngine = new ExecutionEngine()
  }

  /**
   * Get the semantic layer
   */
  getSemanticLayer(): SemanticLayer {
    return this.semanticLayer
  }

  /**
   * Get available query sources (cube names)
   */
  getQuerySources(): string[] {
    return this.semanticLayer.getCubes().map((c) => c.name)
  }

  /**
   * Register an index for query optimization
   */
  registerIndex(cubeName: string, index: IndexInfo): void {
    const indexes = this.indexes.get(cubeName) || []
    indexes.push(index)
    this.indexes.set(cubeName, indexes)

    // Also register with query planner
    this.queryPlanner.registerIndex(cubeName, index)
  }

  /**
   * Convert semantic query to QueryEngine AST
   */
  toQueryAST(query: SemanticQuery): SemanticQueryAST {
    const ast: SemanticQueryAST = {
      type: 'semantic',
      measures: [],
      dimensions: [],
      timeDimensions: [],
    }

    // Parse measures
    if (query.measures) {
      for (const ref of query.measures) {
        const [cubeName, name] = ref.split('.')
        ast.measures.push({ cubeName: cubeName!, name: name! })
      }
    }

    // Parse dimensions
    if (query.dimensions) {
      for (const ref of query.dimensions) {
        const [cubeName, name] = ref.split('.')
        ast.dimensions.push({ cubeName: cubeName!, name: name! })
      }
    }

    // Parse time dimensions
    if (query.timeDimensions) {
      for (const td of query.timeDimensions) {
        const [cubeName, name] = td.dimension.split('.')
        ast.timeDimensions.push({
          cubeName: cubeName!,
          name: name!,
          granularity: td.granularity,
          dateRange: td.dateRange,
        })
      }
    }

    // Convert filters to predicate nodes
    if (query.filters && query.filters.length > 0) {
      const predicates = query.filters.map((filter) => {
        const [cubeName, dimName] = filter.dimension.split('.')
        const cube = this.semanticLayer.getCube(cubeName!)
        const dimension = cube?.getDimension(dimName!)
        const column = dimension?.sql || dimName!

        return this.filterToPredicate(column, filter.operator, filter.values)
      })

      if (predicates.length === 1) {
        ast.filter = predicates[0]
      } else {
        ast.filter = and(...predicates)
      }
    }

    // Convert order to sort node
    if (query.order && query.order.length > 0) {
      const columns = query.order.map((o) => {
        const [_, name] = o.id.split('.')
        return o.desc ? desc(name!) : asc(name!)
      })
      ast.sort = createSort(...columns)
    }

    return ast
  }

  private filterToPredicate(
    column: string,
    operator: string,
    values: string[]
  ): PredicateNode {
    const val = values[0]

    switch (operator) {
      case 'equals':
        return eq(column, this.parseValue(val!))
      case 'notEquals':
        return neq(column, this.parseValue(val!))
      case 'gt':
        return gt(column, this.parseValue(val!))
      case 'gte':
        return gte(column, this.parseValue(val!))
      case 'lt':
        return lt(column, this.parseValue(val!))
      case 'lte':
        return lte(column, this.parseValue(val!))
      case 'in':
        return inSet(column, values.map((v) => this.parseValue(v)))
      case 'notIn':
        return notInSet(column, values.map((v) => this.parseValue(v)))
      case 'between':
        return between(column, this.parseValue(values[0]!), this.parseValue(values[1]!))
      default:
        return eq(column, val)
    }
  }

  private parseValue(val: string): unknown {
    // Try parsing as number
    const num = parseFloat(val)
    if (!isNaN(num)) {
      return num
    }
    // Return as string
    return val
  }

  /**
   * Validate a semantic query by checking generated SQL
   */
  async validateQuery(query: SemanticQuery): Promise<SQLValidationResult> {
    try {
      // Generate SQL from semantic query
      const result = await this.semanticLayer.query(query)
      const sql = result.sql

      // Try to parse the SQL
      try {
        this.sqlParser.parseSelect(sql)
        return { sql, isValid: true, errors: [] }
      } catch (e) {
        return {
          sql,
          isValid: false,
          errors: [{ message: (e as Error).message }],
        }
      }
    } catch (e) {
      return {
        sql: '',
        isValid: false,
        errors: [{ message: (e as Error).message }],
      }
    }
  }

  /**
   * Parse SQL string to semantic query
   */
  parseSQL(sql: string): SemanticQuery {
    const parsed = this.sqlParser.parseSelect(sql)
    const query: SemanticQuery = {
      measures: [],
      dimensions: [],
      filters: [],
    }

    // Extract measures from aggregations in projection
    // This is a simplified implementation
    if (parsed.projection) {
      // Look for SUM, COUNT, AVG, etc.
      for (const col of (parsed.projection as any).columns || []) {
        if (typeof col.source === 'string') {
          // Check if it matches a cube dimension or measure
          const cubes = this.semanticLayer.getCubes()
          for (const cube of cubes) {
            if (cube.getDimension(col.source)) {
              query.dimensions!.push(`${cube.name}.${col.source}`)
            }
            if (cube.getMeasure(col.source)) {
              query.measures!.push(`${cube.name}.${col.source}`)
            }
          }
        }
      }
    }

    // Extract filters from WHERE clause
    if (parsed.filter) {
      this.extractFilters(parsed.filter, query)
    }

    return query
  }

  private extractFilters(node: QueryNode, query: SemanticQuery): void {
    if (node.type === 'predicate') {
      const pred = node as PredicateNode
      const cubes = this.semanticLayer.getCubes()

      for (const cube of cubes) {
        if (cube.getDimension(pred.column)) {
          query.filters!.push({
            dimension: `${cube.name}.${pred.column}`,
            operator: this.opToOperator(pred.op),
            values: Array.isArray(pred.value)
              ? pred.value.map(String)
              : [String(pred.value)],
          })
          break
        }
      }
    } else if (node.type === 'logical') {
      const logical = node as LogicalNode
      for (const child of logical.children) {
        this.extractFilters(child, query)
      }
    }
  }

  private opToOperator(op: string): 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'between' {
    const mapping: Record<string, 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'between'> = {
      '=': 'equals',
      '!=': 'notEquals',
      '>': 'gt',
      '>=': 'gte',
      '<': 'lt',
      '<=': 'lte',
      'IN': 'in',
      'NOT IN': 'notIn',
      'BETWEEN': 'between',
    }
    return mapping[op] || 'equals'
  }

  /**
   * Execute a semantic query
   */
  async execute(query: SemanticQuery): Promise<SemanticExecutionResult> {
    const startTime = performance.now()

    // Validate query
    this.validateSemanticQuery(query)

    // Get the plan
    const plan = await this.plan(query)

    // Get column store
    const primaryCube = this.getPrimaryCube(query)
    const columnStore = this.getColumnStore(primaryCube)

    // Check bloom filter for equality filters
    if (query.filters) {
      for (const filter of query.filters) {
        if (filter.operator === 'equals') {
          const [cubeName, dimName] = filter.dimension.split('.')
          const cube = this.semanticLayer.getCube(cubeName!)
          const column = cube?.getDimension(dimName!)?.sql || dimName!

          const bloom = columnStore.bloomFilter?.(column)
          if (bloom && !bloom.mightContain(filter.values[0])) {
            // Bloom filter says definitely not present
            return {
              data: [],
              sql: '',
              executionStats: {
                rowsScanned: 0,
                rowsReturned: 0,
                executionTimeMs: performance.now() - startTime,
              },
            }
          }
        }
      }
    }

    // Check min/max for range filters
    if (query.filters) {
      for (const filter of query.filters) {
        if (['gt', 'gte', 'lt', 'lte'].includes(filter.operator)) {
          const [cubeName, dimName] = filter.dimension.split('.')
          const cube = this.semanticLayer.getCube(cubeName!)
          const column = cube?.getDimension(dimName!)?.sql || dimName!

          const minMax = columnStore.minMax?.(column)
          if (minMax) {
            const filterVal = parseFloat(filter.values[0]!)
            if (!isNaN(filterVal)) {
              if (filter.operator === 'gt' && minMax.max <= filterVal) {
                return {
                  data: [],
                  sql: '',
                  executionStats: {
                    rowsScanned: 0,
                    rowsReturned: 0,
                    executionTimeMs: performance.now() - startTime,
                  },
                }
              }
              if (filter.operator === 'gte' && minMax.max < filterVal) {
                return {
                  data: [],
                  sql: '',
                  executionStats: {
                    rowsScanned: 0,
                    rowsReturned: 0,
                    executionTimeMs: performance.now() - startTime,
                  },
                }
              }
            }
          }
        }
      }
    }

    // Generate SQL and execute
    const semanticResult = await this.semanticLayer.query(query)

    // Push down predicates to column store
    if (query.filters && columnStore.filter) {
      const ast = this.toQueryAST(query)
      if (ast.filter) {
        columnStore.filter(ast.filter as any)
      }
    }

    // Execute via query engine
    const ctx: ExecutionContext = {
      columnStore,
      parameters: new Map(),
      timeout: this.timeout,
    }

    const executionResult = await this.executionEngine.execute(plan, ctx)

    const endTime = performance.now()

    // Convert to data array
    const data = this.columnBatchToData(executionResult)

    return {
      data,
      sql: semanticResult.sql,
      executionStats: {
        rowsScanned: executionResult.stats?.rowsScanned ?? 0,
        rowsReturned: data.length,
        executionTimeMs: endTime - startTime,
      },
      usedPreAggregation: semanticResult.usedPreAggregation,
    }
  }

  private columnBatchToData(result: ExecutionResult): Record<string, unknown>[] {
    const data: Record<string, unknown>[] = []
    const columns = result.columns

    if (!columns || columns.size === 0) {
      return data
    }

    const colNames = Array.from(columns.keys())
    const rowCount = result.rowCount

    for (let i = 0; i < rowCount; i++) {
      const row: Record<string, unknown> = {}
      for (const colName of colNames) {
        const colData = columns.get(colName)
        row[colName] = colData?.[i]
      }
      data.push(row)
    }

    return data
  }

  private validateSemanticQuery(query: SemanticQuery): void {
    // Check measures
    if (query.measures) {
      for (const ref of query.measures) {
        const [cubeName, measureName] = ref.split('.')
        const cube = this.semanticLayer.getCube(cubeName!)
        if (!cube) {
          throw new SemanticQueryError(`Cube '${cubeName}' not found`, { query })
        }
        if (!cube.getMeasure(measureName!)) {
          throw new InvalidSemanticQueryError(
            `Measure '${measureName}' not found in cube '${cubeName}'`,
            { query }
          )
        }
      }
    }

    // Check dimensions
    if (query.dimensions) {
      for (const ref of query.dimensions) {
        const [cubeName, dimName] = ref.split('.')
        const cube = this.semanticLayer.getCube(cubeName!)
        if (!cube) {
          throw new SemanticQueryError(`Cube '${cubeName}' not found`, { query })
        }
        if (!cube.getDimension(dimName!)) {
          throw new InvalidSemanticQueryError(
            `Dimension '${dimName}' not found in cube '${cubeName}'`,
            { query }
          )
        }
      }
    }

    // Check filters
    if (query.filters) {
      for (const filter of query.filters) {
        const [cubeName, dimName] = filter.dimension.split('.')
        const cube = this.semanticLayer.getCube(cubeName!)
        if (!cube) {
          throw new SemanticQueryError(`Cube '${cubeName}' not found`, { query })
        }
        if (!cube.getDimension(dimName!)) {
          throw new InvalidSemanticQueryError(
            `Dimension '${dimName}' not found in cube '${cubeName}' (used in filter)`,
            { query }
          )
        }
      }
    }
  }

  private getPrimaryCube(query: SemanticQuery): string {
    if (query.measures && query.measures.length > 0) {
      const [cubeName] = query.measures[0]!.split('.')
      return cubeName!
    }
    if (query.dimensions && query.dimensions.length > 0) {
      const [cubeName] = query.dimensions[0]!.split('.')
      return cubeName!
    }
    throw new SemanticQueryError('Query must have at least one measure or dimension')
  }

  private getColumnStore(cubeName: string): TypedColumnStore {
    const store = this.columnStores.get(cubeName) || this.columnStore
    if (!store) {
      throw new SemanticQueryError(`No column store for cube '${cubeName}'`)
    }
    return store
  }

  /**
   * Generate a query plan
   */
  async plan(query: SemanticQuery): Promise<SemanticQueryPlan> {
    // Check cache
    const cacheKey = JSON.stringify(query)
    if (this.enableCaching && this.planCache.has(cacheKey)) {
      return this.planCache.get(cacheKey)!
    }

    // Get primary cube
    const primaryCube = this.getPrimaryCube(query)
    const cube = this.semanticLayer.getCube(primaryCube)!

    // Convert to AST
    const ast = this.toQueryAST(query)

    // Check for pre-aggregation match
    let usesPreAggregation = false
    let preAggregationName: string | undefined

    if (cube.preAggregations.length > 0) {
      const queryMeasures = ast.measures.map((m) => m.name)
      const queryDimensions = ast.dimensions.map((d) => d.name)
      const timeDim = ast.timeDimensions[0]

      for (const preAgg of cube.preAggregations) {
        const measuresMatch = queryMeasures.every((m) =>
          preAgg.measures.includes(m)
        )
        const dimsMatch = queryDimensions.every((d) =>
          preAgg.dimensions.includes(d)
        )
        const timeMatch =
          !preAgg.timeDimension ||
          (timeDim?.name === preAgg.timeDimension &&
            timeDim?.granularity === preAgg.granularity)

        if (measuresMatch && dimsMatch && timeMatch) {
          usesPreAggregation = true
          preAggregationName = preAgg.name
          break
        }
      }
    }

    // Calculate estimated cost
    const estimatedRows = this.estimateRows(query)
    const estimatedCost = this.calculateCost(query, estimatedRows)
    const estimatedSelectivity = this.calculateSelectivity(query)

    // Find matching index
    let indexHint: IndexInfo | undefined
    const cubeIndexes = this.indexes.get(primaryCube) || []

    if (query.filters) {
      for (const filter of query.filters) {
        const [_, dimName] = filter.dimension.split('.')
        const dimension = cube.getDimension(dimName!)
        const column = dimension?.sql || dimName!

        for (const index of cubeIndexes) {
          if (index.columns.includes(column)) {
            // Prefer minmax for range queries, bloom for equality
            if (
              ['gt', 'gte', 'lt', 'lte'].includes(filter.operator) &&
              index.type === 'minmax'
            ) {
              indexHint = index
              break
            }
            if (filter.operator === 'equals' && index.type === 'bloom') {
              indexHint = index
              break
            }
          }
        }
      }
    }

    // Determine join info if multi-cube
    let join: SemanticQueryPlan['join']
    const cubeNames = this.getCubeNames(query)
    if (cubeNames.length > 1) {
      join = {
        type: 'hash_join',
        buildSide: 'right', // Build on smaller table (typically)
      }
    }

    // Create plan
    const plan: SemanticQueryPlan = {
      type: usesPreAggregation ? 'pre_agg_scan' : 'scan',
      source: primaryCube,
      estimatedRows,
      estimatedCost,
      usesPreAggregation,
      preAggregationName,
      indexHint,
      estimatedSelectivity,
      join,
    }

    // Cache the plan
    if (this.enableCaching) {
      this.planCache.set(cacheKey, plan)
    }

    return plan
  }

  private getCubeNames(query: SemanticQuery): string[] {
    const names = new Set<string>()

    if (query.measures) {
      for (const ref of query.measures) {
        const [cubeName] = ref.split('.')
        names.add(cubeName!)
      }
    }
    if (query.dimensions) {
      for (const ref of query.dimensions) {
        const [cubeName] = ref.split('.')
        names.add(cubeName!)
      }
    }
    if (query.timeDimensions) {
      for (const td of query.timeDimensions) {
        const [cubeName] = td.dimension.split('.')
        names.add(cubeName!)
      }
    }
    if (query.filters) {
      for (const filter of query.filters) {
        const [cubeName] = filter.dimension.split('.')
        names.add(cubeName!)
      }
    }

    return Array.from(names)
  }

  private estimateRows(query: SemanticQuery): number {
    // Base estimate
    let rows = 10000

    // Reduce by filter selectivity
    if (query.filters) {
      for (const filter of query.filters) {
        if (filter.operator === 'equals') {
          rows *= 0.1 // Assume 10% selectivity for equality
        } else if (['gt', 'gte', 'lt', 'lte'].includes(filter.operator)) {
          rows *= 0.3 // Assume 30% selectivity for range
        } else if (filter.operator === 'in') {
          rows *= 0.05 * filter.values.length // 5% per value
        }
      }
    }

    return Math.max(1, Math.floor(rows))
  }

  private calculateCost(query: SemanticQuery, estimatedRows: number): number {
    let cost = estimatedRows // Base scan cost

    // Add aggregation cost
    if (query.measures && query.measures.length > 0) {
      cost += estimatedRows * 0.1 * query.measures.length
    }

    // Add sort cost if ordering
    if (query.order && query.order.length > 0) {
      cost += estimatedRows * Math.log2(Math.max(2, estimatedRows)) * 0.1
    }

    // Add join cost for multi-cube queries
    const cubeNames = this.getCubeNames(query)
    if (cubeNames.length > 1) {
      cost *= cubeNames.length // Simple multiplier for joins
    }

    return Math.max(1, Math.floor(cost))
  }

  private calculateSelectivity(query: SemanticQuery): number {
    let selectivity = 1.0

    if (query.filters) {
      for (const filter of query.filters) {
        switch (filter.operator) {
          case 'equals':
            selectivity *= 0.1
            break
          case 'notEquals':
            selectivity *= 0.9
            break
          case 'gt':
          case 'gte':
          case 'lt':
          case 'lte':
            selectivity *= 0.3
            break
          case 'in':
            selectivity *= Math.min(0.5, 0.1 * filter.values.length)
            break
          case 'notIn':
            selectivity *= Math.max(0.5, 1 - 0.1 * filter.values.length)
            break
          case 'between':
            selectivity *= 0.2
            break
        }
      }
    }

    return Math.max(0.001, Math.min(1, selectivity))
  }

  /**
   * Convert semantic query to aggregation pipeline
   */
  toAggregationPipeline(
    query: SemanticQuery,
    options?: AggregationPipelineOptions
  ): Pipeline<unknown, unknown> {
    const builder = new PipelineBuilder<unknown>()

    // Add match stage for filters
    if (query.filters && query.filters.length > 0) {
      const matchPredicate: Record<string, unknown> = {}
      for (const filter of query.filters) {
        const [_, dimName] = filter.dimension.split('.')
        matchPredicate[dimName!] = this.filterToMatchValue(filter)
      }
      builder.match(matchPredicate as any)
    }

    // Add group stage for aggregation
    if (query.measures && query.measures.length > 0) {
      const groupKey: Record<string, string> = {}
      const accumulators: Record<string, { type: string; field?: string }> = {}

      // Build group key from dimensions
      if (query.dimensions) {
        for (const dim of query.dimensions) {
          const [_, dimName] = dim.split('.')
          groupKey[dimName!] = `$${dimName}`
        }
      }

      // Build accumulators from measures
      for (const measure of query.measures) {
        const [cubeName, measureName] = measure.split('.')
        const cube = this.semanticLayer.getCube(cubeName!)
        const metric = cube?.getMeasure(measureName!)

        if (metric) {
          switch (metric.type) {
            case 'count':
              accumulators[measureName!] = { type: 'sum', field: '1' }
              break
            case 'sum':
              accumulators[measureName!] = { type: 'sum', field: `$${metric.sql}` }
              break
            case 'avg':
              accumulators[measureName!] = { type: 'avg', field: `$${metric.sql}` }
              break
            case 'min':
              accumulators[measureName!] = { type: 'min', field: `$${metric.sql}` }
              break
            case 'max':
              accumulators[measureName!] = { type: 'max', field: `$${metric.sql}` }
              break
          }
        }
      }

      builder.group<unknown>({
        _id: Object.keys(groupKey).length > 0 ? groupKey : null,
        ...accumulators,
      } as unknown as GroupSpec<unknown>)
    }

    // Add cube or rollup stage if requested
    if (options?.useCube && query.dimensions) {
      const pipeline = builder.build()
      const cubeStage = createCubeStage({
        dimensions: query.dimensions.map((d) => d.split('.')[1]!),
      })
      return pipeline.addStage(cubeStage as unknown as Stage<unknown, unknown>)
    }

    if (options?.useRollup && query.dimensions) {
      const pipeline = builder.build()
      const rollupStage = createRollupStage({
        dimensions: query.dimensions.map((d) => d.split('.')[1]!),
      })
      return pipeline.addStage(rollupStage as unknown as Stage<unknown, unknown>)
    }

    // Add sort if ordering
    if (query.order && query.order.length > 0) {
      const sortSpec: Record<string, 1 | -1> = {}
      for (const order of query.order) {
        const [_, name] = order.id.split('.')
        sortSpec[name!] = order.desc ? -1 : 1
      }
      builder.sort(sortSpec as any)
    }

    // Add limit
    if (query.limit) {
      builder.limit(query.limit)
    }

    return builder.build()
  }

  private filterToMatchValue(filter: {
    operator: string
    values: string[]
  }): unknown {
    const val = filter.values[0]

    switch (filter.operator) {
      case 'equals':
        return this.parseValue(val!)
      case 'notEquals':
        return { $ne: this.parseValue(val!) }
      case 'gt':
        return { $gt: this.parseValue(val!) }
      case 'gte':
        return { $gte: this.parseValue(val!) }
      case 'lt':
        return { $lt: this.parseValue(val!) }
      case 'lte':
        return { $lte: this.parseValue(val!) }
      case 'in':
        return { $in: filter.values.map((v) => this.parseValue(v)) }
      case 'notIn':
        return { $nin: filter.values.map((v) => this.parseValue(v)) }
      default:
        return this.parseValue(val!)
    }
  }

  /**
   * Convert semantic query to streaming pipeline
   */
  toStreamingPipeline(query: SemanticQuery): StreamingPipeline<unknown, unknown> {
    // Determine window config from time dimensions
    let windowConfig = { type: 'tumbling' as const, duration: 3600000 } // 1 hour default

    if (query.timeDimensions && query.timeDimensions[0]) {
      const td = query.timeDimensions[0]
      const granularityMs: Record<string, number> = {
        minute: 60000,
        hour: 3600000,
        day: 86400000,
        week: 604800000,
        month: 2592000000,
      }
      windowConfig.duration = granularityMs[td.granularity || 'hour'] || 3600000
    }

    // Create base pipeline
    const basePipeline = this.toAggregationPipeline(query)

    // Convert to streaming pipeline
    return createStreamingPipeline({
      basePipeline,
      windowConfig,
      allowLateData: true,
      lateDataWindow: windowConfig.duration,
    })
  }

  /**
   * Get explain output for a semantic query
   */
  async explain(query: SemanticQuery): Promise<QueryExplain> {
    const plan = await this.plan(query)
    const sqlResult = await this.semanticLayer.query(query)

    const steps: QueryExplain['steps'] = [
      { name: 'semantic_parse', description: 'Parse semantic query structure' },
      { name: 'ast_conversion', description: 'Convert to query AST' },
      { name: 'sql_generation', description: 'Generate SQL from semantic definition' },
    ]

    if (plan.usesPreAggregation) {
      steps.push({
        name: 'pre_aggregation_match',
        description: `Using pre-aggregation: ${plan.preAggregationName}`,
      })
    }

    if (plan.indexHint) {
      steps.push({
        name: 'index_selection',
        description: `Using index: ${plan.indexHint.name} (${plan.indexHint.type})`,
      })
    }

    if (plan.join) {
      steps.push({
        name: 'join_planning',
        description: `Join type: ${plan.join.type}, build side: ${plan.join.buildSide}`,
      })
    }

    steps.push({
      name: 'filter_pushdown',
      description: 'Push predicates to column store',
    })

    steps.push({
      name: 'execution',
      description: 'Execute query plan',
      cost: plan.estimatedCost,
    })

    // Index recommendations
    const indexRecommendations: QueryExplain['indexRecommendations'] = []
    if (query.filters && !plan.indexHint) {
      for (const filter of query.filters) {
        const [_, dimName] = filter.dimension.split('.')
        if (filter.operator === 'equals') {
          indexRecommendations.push({
            column: dimName!,
            type: 'bloom',
            reason: 'Equality filter without bloom filter index',
          })
        } else if (['gt', 'gte', 'lt', 'lte'].includes(filter.operator)) {
          indexRecommendations.push({
            column: dimName!,
            type: 'minmax',
            reason: 'Range filter without min/max index',
          })
        }
      }
    }

    // Optimization suggestions
    const optimizationSuggestions: string[] = []
    if (!plan.usesPreAggregation && query.timeDimensions?.length) {
      optimizationSuggestions.push(
        'Consider creating a pre-aggregation for this time-based query'
      )
    }
    if (this.getCubeNames(query).length > 2) {
      optimizationSuggestions.push(
        'Multi-cube query with >2 cubes may benefit from denormalization'
      )
    }

    return {
      sql: sqlResult.sql,
      plan,
      estimatedCost: plan.estimatedCost,
      steps,
      indexRecommendations,
      optimizationSuggestions,
      usesPreAggregation: plan.usesPreAggregation,
      preAggregationName: plan.preAggregationName,
    }
  }

  /**
   * Analyze actual query execution
   */
  async analyze(query: SemanticQuery): Promise<QueryAnalysis> {
    const plan = await this.plan(query)
    const startTime = performance.now()
    const result = await this.execute(query)
    const endTime = performance.now()

    const operationBreakdown: QueryAnalysis['operationBreakdown'] = [
      {
        operation: 'scan',
        timeMs: (endTime - startTime) * 0.4,
        rowsProcessed: result.executionStats.rowsScanned,
      },
      {
        operation: 'filter',
        timeMs: (endTime - startTime) * 0.2,
        rowsProcessed: result.executionStats.rowsScanned,
      },
      {
        operation: 'aggregate',
        timeMs: (endTime - startTime) * 0.3,
        rowsProcessed: result.data.length,
      },
      {
        operation: 'project',
        timeMs: (endTime - startTime) * 0.1,
        rowsProcessed: result.data.length,
      },
    ]

    return {
      estimatedRows: plan.estimatedRows,
      actualRows: result.data.length,
      executionTimeMs: endTime - startTime,
      operationBreakdown,
    }
  }

  /**
   * Execute raw SQL query
   */
  async executeSQL(sql: string): Promise<SemanticExecutionResult> {
    const semanticQuery = this.parseSQL(sql)
    return this.execute(semanticQuery)
  }

  /**
   * Plan raw SQL query
   */
  async planSQL(sql: string): Promise<SemanticQueryPlan> {
    const semanticQuery = this.parseSQL(sql)
    return this.plan(semanticQuery)
  }
}
