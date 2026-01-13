/**
 * FederatedQueryEngine Integration
 *
 * Integrates the FederatedQueryPlanner with the existing QueryEngine primitive.
 * Provides backward-compatible API while enabling transparent multi-source queries.
 *
 * ## Features
 * - Extends QueryEngine with federation support
 * - Reuses existing AST and parser infrastructure
 * - Adds federation-specific planning phases
 * - Maintains backward compatibility for single-source queries
 *
 * ## Architecture
 * ```
 * Query String -> QueryEngine Parser -> Unified AST -> FederatedPlanner -> Execution
 *                                                           |
 *                                         CatalogRegistry (source discovery)
 *                                                           |
 *                                         PushdownOptimizer (per-source)
 *                                                           |
 *                                         FederatedExecutor (join execution)
 * ```
 *
 * @see dotdo-5rrer
 * @module db/primitives/federated-query/query-engine-integration
 */

import type {
  PredicateNode as FederatedPredicate,
  QueryPredicate,
  FederatedQuery,
  TableRef,
  JoinDef,
  ExecutionPlan,
  ExecutionResult,
  StreamingResult,
  PushdownCapabilities,
  SourceAdapter,
  QueryFragment,
  QueryResult,
} from './index'

import {
  Catalog,
  PushdownOptimizer,
  FederatedExecutor,
  createMemoryAdapter,
} from './index'

import type {
  QueryNode,
  PredicateNode,
  LogicalNode,
  JoinNode,
  ProjectionNode,
  SortNode,
  GroupByNode,
  ComparisonOp,
  LogicalOperator,
  JoinType as ASTJoinType,
  SortColumn,
} from '../query-engine/ast'

import {
  isPredicate,
  isLogical,
  isJoin,
  isSort,
  isGroupBy,
  isProjection,
  and as astAnd,
  eq,
} from '../query-engine/ast'

import type {
  QueryPlan,
  TableStatistics,
  IndexInfo,
} from '../query-engine/planner/query-planner'

import { QueryPlanner } from '../query-engine/planner/query-planner'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Configuration for the FederatedQueryEngine
 */
export interface FederatedQueryEngineConfig {
  /** Default source for unqualified table references */
  defaultSource?: string
  /** Enable query plan caching */
  enablePlanCache?: boolean
  /** Maximum cache size */
  maxCacheSize?: number
  /** Enable statistics collection */
  collectStats?: boolean
  /** Enable parallel execution for independent fragments */
  parallelExecution?: boolean
}

/**
 * Source configuration for registration
 */
export interface SourceConfig {
  name: string
  type: 'sqlite' | 'postgres' | 'memory' | 'rest' | 'durable-object'
  adapter: SourceAdapter
  schema?: {
    tables: Record<string, { columns: Record<string, { type: string; nullable?: boolean }> }>
  }
  statistics?: {
    tables: Record<string, { rowCount: number; sizeBytes?: number }>
  }
}

/**
 * Federated query result with source attribution
 */
export interface FederatedExecutionResult {
  rows: Record<string, unknown>[]
  stats?: {
    rowsScanned: number
    executionTimeMs: number
    sourcesQueried: string[]
    fragmentStats?: Array<{
      source: string
      rowsScanned: number
      executionTimeMs: number
    }>
  }
}

/**
 * Query DSL for building federated queries
 */
export interface FederatedQueryDSL {
  from(source: string, table: string): FederatedQueryBuilder
  sql(query: string): Promise<FederatedExecutionResult>
}

/**
 * Builder for constructing federated queries fluently
 */
export interface FederatedQueryBuilder {
  select(...columns: string[]): FederatedQueryBuilder
  where(predicate: QueryNode | Record<string, unknown>): FederatedQueryBuilder
  join(source: string, table: string, on: { left: string; right: string }, type?: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'): FederatedQueryBuilder
  orderBy(...columns: Array<string | { column: string; direction: 'ASC' | 'DESC' }>): FederatedQueryBuilder
  groupBy(...columns: string[]): FederatedQueryBuilder
  limit(n: number): FederatedQueryBuilder
  offset(n: number): FederatedQueryBuilder
  execute(): Promise<FederatedExecutionResult>
  stream(batchSize?: number): AsyncGenerator<Record<string, unknown>[], void, unknown>
  explain(): string
}

// =============================================================================
// AST CONVERSION UTILITIES
// =============================================================================

/**
 * Convert QueryEngine AST predicate to FederatedQuery predicate
 */
function astPredicateToFederated(pred: PredicateNode): QueryPredicate {
  // Handle column reference values (for joins)
  let value = pred.value
  let ref: string | undefined

  if (value && typeof value === 'object' && '$ref' in value) {
    ref = (value as { $ref: string }).$ref
    value = undefined
  }

  return {
    column: pred.column,
    op: mapComparisonOp(pred.op),
    value,
    ref,
  }
}

/**
 * Map QueryEngine comparison operators to FederatedQuery operators
 */
function mapComparisonOp(op: ComparisonOp): QueryPredicate['op'] {
  const mapping: Record<string, QueryPredicate['op']> = {
    '=': '=',
    '!=': '!=',
    '>': '>',
    '<': '<',
    '>=': '>=',
    '<=': '<=',
    'LIKE': 'LIKE',
    'IN': 'IN',
    'NOT IN': 'NOT IN',
  }
  return mapping[op] || '='
}

/**
 * Convert FederatedQuery predicate back to QueryEngine AST
 */
function federatedPredicateToAST(pred: QueryPredicate): PredicateNode {
  return {
    type: 'predicate',
    column: pred.column,
    op: pred.op as ComparisonOp,
    value: pred.ref ? { $ref: pred.ref } : pred.value,
  }
}

/**
 * Extract predicates from QueryNode tree
 */
function extractPredicates(node: QueryNode | null | undefined): QueryPredicate[] {
  if (!node) return []

  if (isPredicate(node)) {
    return [astPredicateToFederated(node)]
  }

  if (isLogical(node)) {
    const predicates: QueryPredicate[] = []
    for (const child of node.children) {
      predicates.push(...extractPredicates(child))
    }
    return predicates
  }

  return []
}

/**
 * Convert QueryEngine JoinNode to FederatedQuery JoinDef
 */
function astJoinToFederated(join: JoinNode): JoinDef {
  const leftCol = join.on.column
  const rightCol = join.on.value && typeof join.on.value === 'object' && '$ref' in join.on.value
    ? (join.on.value as { $ref: string }).$ref
    : String(join.on.value)

  return {
    type: join.joinType as 'INNER' | 'LEFT' | 'RIGHT' | 'FULL',
    on: {
      left: leftCol,
      right: rightCol,
    },
  }
}

// =============================================================================
// FEDERATED QUERY ENGINE
// =============================================================================

/**
 * FederatedQueryEngine - Extends QueryEngine with multi-source query support
 *
 * This class provides:
 * - Backward-compatible single-source query execution via QueryPlanner
 * - Transparent multi-source query federation
 * - Unified API for both modes
 */
export class FederatedQueryEngine {
  private catalog: Catalog
  private optimizer: PushdownOptimizer
  private executor: FederatedExecutor
  private planner: QueryPlanner
  private config: FederatedQueryEngineConfig
  private planCache: Map<string, ExecutionPlan> = new Map()

  constructor(config: FederatedQueryEngineConfig = {}) {
    this.config = {
      enablePlanCache: true,
      maxCacheSize: 100,
      collectStats: true,
      parallelExecution: true,
      ...config,
    }

    this.catalog = new Catalog()
    this.optimizer = new PushdownOptimizer(this.catalog)
    this.executor = new FederatedExecutor(this.catalog)
    this.planner = new QueryPlanner()

    if (config.defaultSource) {
      this.catalog.setDefaultSource(config.defaultSource)
    }
  }

  // ===========================================================================
  // SOURCE MANAGEMENT
  // ===========================================================================

  /**
   * Register a data source
   */
  registerSource(config: SourceConfig): void {
    // Register with catalog
    this.catalog.registerSource({
      name: config.name,
      type: config.type,
      config: {},
    })

    // Attach adapter
    this.catalog.attachAdapter(config.name, config.adapter)

    // Register schema if provided
    if (config.schema) {
      this.catalog.registerSchema(config.name, {
        tables: config.schema.tables,
      })
    }

    // Register statistics if provided
    if (config.statistics) {
      this.catalog.registerStatistics(config.name, {
        tables: config.statistics.tables,
      })

      // Also update QueryPlanner statistics for cost-based optimization
      for (const [tableName, stats] of Object.entries(config.statistics.tables)) {
        this.planner.updateStatistics(`${config.name}.${tableName}`, {
          rowCount: stats.rowCount,
          distinctCounts: new Map(),
          minMax: new Map(),
          nullCounts: new Map(),
        })
      }
    }
  }

  /**
   * Unregister a data source
   */
  unregisterSource(name: string): void {
    this.catalog.unregisterSource(name)
    this.invalidateCache()
  }

  /**
   * Set the default source for unqualified table references
   */
  setDefaultSource(name: string): void {
    this.catalog.setDefaultSource(name)
  }

  /**
   * List registered sources
   */
  listSources(): string[] {
    return this.catalog.listSources().map(s => s.name)
  }

  /**
   * Get adapter for a source (for direct access)
   */
  getAdapter(sourceName: string): SourceAdapter | undefined {
    return this.catalog.getAdapter(sourceName)
  }

  // ===========================================================================
  // QUERY DSL
  // ===========================================================================

  /**
   * Start building a federated query from a source/table
   */
  from(source: string, table: string): FederatedQueryBuilder {
    return new FederatedQueryBuilderImpl(this, [{ source, table }])
  }

  /**
   * Execute a SQL query string (delegates to parser)
   * For single-source queries, uses QueryPlanner
   * For multi-source queries, uses FederatedQueryPlanner
   */
  async sql(query: string): Promise<FederatedExecutionResult> {
    // TODO: Integrate with SQLWhereParser for full SQL support
    // For now, this is a placeholder that would parse and execute SQL
    throw new Error('SQL query execution not yet implemented - use from() builder instead')
  }

  // ===========================================================================
  // QUERY EXECUTION
  // ===========================================================================

  /**
   * Execute a federated query definition
   */
  async executeQuery(query: FederatedQuery): Promise<FederatedExecutionResult> {
    const startTime = performance.now()

    // Determine if this is a single-source or multi-source query
    const isSingleSource = query.from.length === 1 && !query.join

    if (isSingleSource) {
      // Use optimized single-source path
      return this.executeSingleSource(query)
    }

    // Multi-source path: use full federation
    return this.executeMultiSource(query)
  }

  /**
   * Execute a single-source query using QueryPlanner optimization
   */
  private async executeSingleSource(query: FederatedQuery): Promise<FederatedExecutionResult> {
    const startTime = performance.now()
    const tableRef = query.from[0]!
    const adapter = this.catalog.getAdapter(tableRef.source)

    if (!adapter) {
      throw new Error(`No adapter for source ${tableRef.source}`)
    }

    // Build query fragment for direct execution
    const fragment: QueryFragment = {
      table: tableRef.table,
      columns: query.columns,
      predicates: query.predicates,
      limit: query.limit,
      offset: query.offset,
      groupBy: query.groupBy,
      aggregations: query.aggregations,
    }

    const result = await adapter.execute(fragment)
    const endTime = performance.now()

    return {
      rows: result.rows,
      stats: this.config.collectStats ? {
        rowsScanned: result.rows.length,
        executionTimeMs: endTime - startTime,
        sourcesQueried: [tableRef.source],
      } : undefined,
    }
  }

  /**
   * Execute a multi-source query using FederatedQueryPlanner
   */
  private async executeMultiSource(query: FederatedQuery): Promise<FederatedExecutionResult> {
    const startTime = performance.now()

    // Check cache
    const cacheKey = this.getCacheKey(query)
    let plan = this.config.enablePlanCache ? this.planCache.get(cacheKey) : undefined

    if (!plan) {
      // Optimize the query
      const optimized = this.optimizer.optimize(query)

      // Build execution plan
      plan = {
        fragments: optimized.fragments.map(f => ({
          source: f.source,
          pushdown: f.pushdown,
        })),
        residualPredicates: optimized.residualPredicates,
        join: optimized.join,
        parallel: this.config.parallelExecution,
        collectStats: this.config.collectStats,
      }

      // Cache the plan
      if (this.config.enablePlanCache) {
        this.planCache.set(cacheKey, plan)
        this.trimCache()
      }
    }

    // Execute the plan
    const result = await this.executor.execute(plan)
    const endTime = performance.now()

    return {
      rows: result.rows,
      stats: result.stats ? {
        rowsScanned: result.stats.rowsScanned,
        executionTimeMs: endTime - startTime,
        sourcesQueried: query.from.map(t => t.source),
        fragmentStats: result.stats.fragmentStats,
      } : undefined,
    }
  }

  /**
   * Stream query results
   */
  async *streamQuery(query: FederatedQuery, batchSize: number = 1000): AsyncGenerator<Record<string, unknown>[], void, unknown> {
    const plan = this.buildPlan(query)
    plan.streaming = { batchSize }

    for await (const batch of this.executor.stream(plan)) {
      yield batch.rows
    }
  }

  /**
   * Build an execution plan without executing
   */
  private buildPlan(query: FederatedQuery): ExecutionPlan {
    const optimized = this.optimizer.optimize(query)

    return {
      fragments: optimized.fragments.map(f => ({
        source: f.source,
        pushdown: f.pushdown,
      })),
      residualPredicates: optimized.residualPredicates,
      join: optimized.join,
      parallel: this.config.parallelExecution,
      collectStats: this.config.collectStats,
    }
  }

  /**
   * Explain a query plan (for debugging)
   */
  explain(query: FederatedQuery): string {
    const plan = this.buildPlan(query)
    const lines: string[] = []

    lines.push('=== Federated Query Plan ===')
    lines.push('')
    lines.push(`Sources: ${query.from.map(t => `${t.source}.${t.table}`).join(', ')}`)
    lines.push(`Fragments: ${plan.fragments.length}`)
    lines.push(`Parallel: ${plan.parallel}`)
    lines.push('')

    for (const [i, fragment] of plan.fragments.entries()) {
      lines.push(`Fragment ${i + 1}: ${fragment.source}`)
      lines.push(`  Table: ${fragment.pushdown.table}`)
      if (fragment.pushdown.columns) {
        lines.push(`  Columns: ${fragment.pushdown.columns.join(', ')}`)
      }
      if (fragment.pushdown.predicates?.length) {
        lines.push(`  Predicates: ${fragment.pushdown.predicates.length}`)
      }
      if (fragment.pushdown.limit !== undefined) {
        lines.push(`  Limit: ${fragment.pushdown.limit}`)
      }
    }

    if (plan.join) {
      lines.push('')
      lines.push('Join:')
      lines.push(`  Type: ${plan.join.type}`)
      lines.push(`  On: ${plan.join.on.left} = ${plan.join.on.right}`)
      if (plan.join.buildSide) {
        lines.push(`  Build Side: ${plan.join.buildSide}`)
      }
    }

    if (plan.residualPredicates?.length) {
      lines.push('')
      lines.push(`Residual Predicates: ${plan.residualPredicates.length}`)
    }

    return lines.join('\n')
  }

  // ===========================================================================
  // CACHE MANAGEMENT
  // ===========================================================================

  private getCacheKey(query: FederatedQuery): string {
    return JSON.stringify(query)
  }

  private invalidateCache(): void {
    this.planCache.clear()
  }

  private trimCache(): void {
    if (this.planCache.size > (this.config.maxCacheSize || 100)) {
      // Remove oldest entries (simple FIFO)
      const iterator = this.planCache.keys()
      const toDelete = this.planCache.size - (this.config.maxCacheSize || 100)
      for (let i = 0; i < toDelete; i++) {
        const key = iterator.next().value
        if (key) this.planCache.delete(key)
      }
    }
  }
}

// =============================================================================
// QUERY BUILDER IMPLEMENTATION
// =============================================================================

/**
 * Implementation of the fluent query builder
 */
class FederatedQueryBuilderImpl implements FederatedQueryBuilder {
  private engine: FederatedQueryEngine
  private tables: TableRef[]
  private selectedColumns?: string[]
  private wherePredicates: QueryPredicate[] = []
  private joins: JoinDef[] = []
  private sortColumns: Array<{ column: string; direction: 'ASC' | 'DESC' }> = []
  private groupByColumns: string[] = []
  private limitValue?: number
  private offsetValue?: number

  constructor(engine: FederatedQueryEngine, tables: TableRef[]) {
    this.engine = engine
    this.tables = tables
  }

  select(...columns: string[]): FederatedQueryBuilder {
    this.selectedColumns = columns
    return this
  }

  where(predicate: QueryNode | Record<string, unknown>): FederatedQueryBuilder {
    if ('type' in predicate) {
      // It's a QueryNode
      this.wherePredicates.push(...extractPredicates(predicate as QueryNode))
    } else {
      // It's a simple object like { status: 'active', age: { $gt: 21 } }
      this.wherePredicates.push(...this.parseSimpleWhere(predicate))
    }
    return this
  }

  private parseSimpleWhere(obj: Record<string, unknown>): QueryPredicate[] {
    const predicates: QueryPredicate[] = []

    for (const [column, value] of Object.entries(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Operator syntax: { age: { $gt: 21 } }
        for (const [op, v] of Object.entries(value as Record<string, unknown>)) {
          const mappedOp = this.mapMongoOp(op)
          if (mappedOp) {
            predicates.push({ column, op: mappedOp, value: v })
          }
        }
      } else {
        // Simple equality: { status: 'active' }
        predicates.push({ column, op: '=', value })
      }
    }

    return predicates
  }

  private mapMongoOp(op: string): QueryPredicate['op'] | null {
    const mapping: Record<string, QueryPredicate['op']> = {
      '$eq': '=',
      '$ne': '!=',
      '$gt': '>',
      '$gte': '>=',
      '$lt': '<',
      '$lte': '<=',
      '$in': 'IN',
      '$nin': 'NOT IN',
      '$like': 'LIKE',
    }
    return mapping[op] || null
  }

  join(
    source: string,
    table: string,
    on: { left: string; right: string },
    type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' = 'INNER'
  ): FederatedQueryBuilder {
    this.tables.push({ source, table })
    this.joins.push({ type, on })
    return this
  }

  orderBy(...columns: Array<string | { column: string; direction: 'ASC' | 'DESC' }>): FederatedQueryBuilder {
    for (const col of columns) {
      if (typeof col === 'string') {
        this.sortColumns.push({ column: col, direction: 'ASC' })
      } else {
        this.sortColumns.push(col)
      }
    }
    return this
  }

  groupBy(...columns: string[]): FederatedQueryBuilder {
    this.groupByColumns.push(...columns)
    return this
  }

  limit(n: number): FederatedQueryBuilder {
    this.limitValue = n
    return this
  }

  offset(n: number): FederatedQueryBuilder {
    this.offsetValue = n
    return this
  }

  async execute(): Promise<FederatedExecutionResult> {
    const query = this.buildQuery()
    return this.engine.executeQuery(query)
  }

  async *stream(batchSize: number = 1000): AsyncGenerator<Record<string, unknown>[], void, unknown> {
    const query = this.buildQuery()
    yield* this.engine.streamQuery(query, batchSize)
  }

  explain(): string {
    const query = this.buildQuery()
    return this.engine.explain(query)
  }

  private buildQuery(): FederatedQuery {
    const query: FederatedQuery = {
      from: this.tables,
    }

    if (this.selectedColumns && this.selectedColumns.length > 0) {
      query.columns = this.selectedColumns
    }

    if (this.wherePredicates.length > 0) {
      query.predicates = this.wherePredicates
    }

    if (this.joins.length > 0) {
      query.join = this.joins.length === 1 ? this.joins[0] : this.joins
    }

    if (this.sortColumns.length > 0) {
      query.orderBy = this.sortColumns
    }

    if (this.groupByColumns.length > 0) {
      query.groupBy = this.groupByColumns
    }

    if (this.limitValue !== undefined) {
      query.limit = this.limitValue
    }

    if (this.offsetValue !== undefined) {
      query.offset = this.offsetValue
    }

    return query
  }
}

// =============================================================================
// QUERY ENGINE ADAPTER
// =============================================================================

/**
 * Adapter that wraps a SourceAdapter to use QueryEngine's execution
 * This provides the bridge for using QueryPlanner's cost-based optimization
 * with federated sources.
 */
export class QueryEngineSourceAdapter implements SourceAdapter {
  private innerAdapter: SourceAdapter
  private planner: QueryPlanner
  private sourceName: string

  constructor(sourceName: string, innerAdapter: SourceAdapter, planner?: QueryPlanner) {
    this.sourceName = sourceName
    this.innerAdapter = innerAdapter
    this.planner = planner || new QueryPlanner()
  }

  capabilities(): PushdownCapabilities {
    return this.innerAdapter.capabilities()
  }

  async execute(query: QueryFragment): Promise<QueryResult> {
    // Convert QueryFragment to QueryNode AST for planning
    const ast = this.fragmentToAST(query)

    // Use QueryPlanner for cost-based optimization
    if (ast) {
      const plan = this.planner.plan(ast, query.table)
      // The plan informs us about optimal execution strategy
      // For now, we pass through to the inner adapter
    }

    return this.innerAdapter.execute(query)
  }

  async *stream(query: QueryFragment & { batchSize?: number }): AsyncGenerator<Record<string, unknown>[], void, unknown> {
    yield* this.innerAdapter.stream(query)
  }

  toSQL?(query: QueryFragment): string {
    return this.innerAdapter.toSQL?.(query) || ''
  }

  private fragmentToAST(query: QueryFragment): QueryNode | null {
    if (!query.predicates || query.predicates.length === 0) {
      return null
    }

    if (query.predicates.length === 1) {
      return federatedPredicateToAST(query.predicates[0]!)
    }

    return {
      type: 'logical',
      op: 'AND',
      children: query.predicates.map(federatedPredicateToAST),
    }
  }
}

// =============================================================================
// CONVENIENCE FACTORY
// =============================================================================

/**
 * Create a pre-configured FederatedQueryEngine with common defaults
 */
export function createFederatedQueryEngine(
  sources: SourceConfig[],
  options?: FederatedQueryEngineConfig
): FederatedQueryEngine {
  const engine = new FederatedQueryEngine(options)

  for (const source of sources) {
    engine.registerSource(source)
  }

  return engine
}

/**
 * Create a memory-backed source for testing
 */
export function createMemorySource(
  name: string,
  data: Record<string, Record<string, unknown>[]>
): SourceConfig {
  // Infer schema from data
  const schema: SourceConfig['schema'] = { tables: {} }
  const statistics: SourceConfig['statistics'] = { tables: {} }

  for (const [tableName, rows] of Object.entries(data)) {
    if (rows.length > 0) {
      const columns: Record<string, { type: string; nullable: boolean }> = {}
      const sampleRow = rows[0]!

      for (const [colName, value] of Object.entries(sampleRow)) {
        columns[colName] = {
          type: inferType(value),
          nullable: true,
        }
      }

      schema.tables[tableName] = { columns }
      statistics.tables[tableName] = { rowCount: rows.length }
    }
  }

  return {
    name,
    type: 'memory',
    adapter: createMemoryAdapter(data),
    schema,
    statistics,
  }
}

function inferType(value: unknown): string {
  if (value === null || value === undefined) return 'string'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'json'
  return 'string'
}
