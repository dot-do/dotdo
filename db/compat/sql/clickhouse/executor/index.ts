/**
 * Distributed Query Executor
 *
 * Implements distributed query execution with Cap'n Web RPC protocol.
 *
 * Architecture:
 * - Coordinator: Parses SQL, builds query plan, dispatches to executors, merges results
 * - ExecutorWorker: Receives plan fragments, executes, streams chunks back
 * - QueryExecutor: Local query execution (simple SQL evaluation)
 */

import { parseSQL, type SelectQueryNode, type ExpressionNode, type ASTNode } from '../spikes/parser-wasm'
import {
  type QueryPlan,
  type Chunk,
  type QueryContext,
  type ColumnMeta,
  QuerySerializer,
  MockQueryExecutor as BaseExecutor,
  type QueryExecutorRPC,
} from '../spikes/rpc-protocol'

// ============================================================================
// TYPES
// ============================================================================

export interface QueryResult {
  success: boolean
  rows: Record<string, unknown>[]
  columns?: ColumnMeta[]
  stats?: QueryStats
  partial?: boolean
}

export interface QueryStats {
  executorsUsed: number
  rowsScanned: number
  bytesScanned: number
  executionTimeMs: number
  planningTimeMs: number
}

export interface ChunkWithProgress extends Chunk {
  progress?: number
}

export type ChunkStream = AsyncIterable<ChunkWithProgress>

export interface ExecutorConfig {
  executors?: number
  chunkSize?: number
  maxRetries?: number
  timeoutMs?: number
}

export interface ExecuteOptions {
  allowPartialResults?: boolean
  timeoutMs?: number
}

export interface ExplainResult {
  nodes: QueryPlanNode[]
  usesIndex: boolean
  indexType?: string
  estimatedRows?: number
  estimatedBytes?: number
}

export interface QueryPlanNode {
  id: string
  operation: string
  table?: string
  columns?: string[]
  children?: QueryPlanNode[]
}

// Re-export types from rpc-protocol
export { QueryPlan, Chunk, QueryContext, ColumnMeta }

// ============================================================================
// QUERY EXECUTOR (Local)
// ============================================================================

/**
 * Local query executor for simple SQL evaluation.
 * Used for expressions without table access or for testing.
 */
export class QueryExecutor {
  private tables: Map<string, Record<string, unknown>[]> = new Map()

  /**
   * Seed test data into a table.
   */
  async seedTestData(table: string, data: Record<string, unknown>[]): Promise<void> {
    this.tables.set(table, data)
  }

  /**
   * Execute a SQL query.
   */
  async execute(sql: string): Promise<QueryResult> {
    const ast = parseSQL(sql)

    if (ast.type !== 'SelectQuery') {
      throw new Error('Only SELECT queries are supported')
    }

    const selectAst = ast as SelectQueryNode

    // If no FROM clause, evaluate expressions directly
    if (!selectAst.from) {
      return this.evaluateExpressions(selectAst)
    }

    // Get table data
    const tableName = selectAst.from.table
    let data = this.tables.get(tableName) || []

    // Apply WHERE filter
    if (selectAst.where) {
      data = data.filter((row) => this.evaluateCondition(selectAst.where!, row))
    }

    // Check if we have aggregation
    const hasAggregation = selectAst.columns.some((col) => this.isAggregation(col))

    if (hasAggregation) {
      return this.executeAggregation(selectAst, data)
    }

    // Project columns
    const rows = data.map((row) => this.projectRow(selectAst.columns, row))

    return {
      success: true,
      rows,
    }
  }

  /**
   * Evaluate SELECT expressions without a table.
   */
  private evaluateExpressions(ast: SelectQueryNode): QueryResult {
    const row: Record<string, unknown> = {}

    for (const col of ast.columns) {
      const { name, value } = this.evaluateExpression(col, {})
      row[name] = value
    }

    return {
      success: true,
      rows: [row],
    }
  }

  /**
   * Execute aggregation query.
   */
  private executeAggregation(
    ast: SelectQueryNode,
    data: Record<string, unknown>[]
  ): QueryResult {
    const rows: Record<string, unknown>[] = []

    // Simple case: no GROUP BY, aggregate entire table
    const aggResults: Record<string, unknown> = {}

    for (const col of ast.columns) {
      const { name, value } = this.evaluateAggregation(col, data)
      aggResults[name] = value
    }

    rows.push(aggResults)

    return {
      success: true,
      rows,
    }
  }

  /**
   * Evaluate an expression and return name/value.
   */
  private evaluateExpression(
    expr: ExpressionNode,
    row: Record<string, unknown>
  ): { name: string; value: unknown } {
    switch (expr.type) {
      case 'Literal':
        return { name: 'literal', value: expr.value }

      case 'Identifier':
        return { name: expr.name, value: row[expr.name] }

      case 'Alias':
        const inner = this.evaluateExpression(expr.expression, row)
        return { name: expr.alias, value: inner.value }

      case 'BinaryOp':
        return this.evaluateBinaryOp(expr, row)

      case 'FunctionCall':
        return this.evaluateFunctionCall(expr, row)

      case 'JSONPath':
        return this.evaluateJSONPath(expr, row)

      case 'Star':
        return { name: '*', value: row }

      default:
        throw new Error(`Unsupported expression type: ${(expr as any).type}`)
    }
  }

  /**
   * Evaluate a binary operation.
   */
  private evaluateBinaryOp(
    expr: { type: 'BinaryOp'; op: string; left: ExpressionNode; right: ExpressionNode },
    row: Record<string, unknown>
  ): { name: string; value: unknown } {
    const left = this.evaluateExpression(expr.left, row).value
    const right = this.evaluateExpression(expr.right, row).value

    let value: unknown

    switch (expr.op) {
      case '+':
        value = (left as number) + (right as number)
        break
      case '-':
        value = (left as number) - (right as number)
        break
      case '*':
        value = (left as number) * (right as number)
        break
      case '/':
        value = (left as number) / (right as number)
        break
      case '=':
        value = left === right
        break
      case '!=':
      case '<>':
        value = left !== right
        break
      case '<':
        value = (left as number) < (right as number)
        break
      case '>':
        value = (left as number) > (right as number)
        break
      case '<=':
        value = (left as number) <= (right as number)
        break
      case '>=':
        value = (left as number) >= (right as number)
        break
      case 'AND':
        value = left && right
        break
      case 'OR':
        value = left || right
        break
      default:
        throw new Error(`Unsupported operator: ${expr.op}`)
    }

    return { name: expr.op, value }
  }

  /**
   * Evaluate a function call.
   */
  private evaluateFunctionCall(
    expr: { type: 'FunctionCall'; name: string; args: ExpressionNode[] },
    row: Record<string, unknown>
  ): { name: string; value: unknown } {
    const args = expr.args.map((arg) => this.evaluateExpression(arg, row).value)

    // Handle special functions
    switch (expr.name.toUpperCase()) {
      case 'COUNT':
        // For single-row evaluation, count returns 1
        return { name: 'count(*)', value: 1 }
      case 'SUM':
        return { name: 'sum', value: args[0] }
      default:
        throw new Error(`Unsupported function: ${expr.name}`)
    }
  }

  /**
   * Evaluate JSON path access (->>, ->).
   */
  private evaluateJSONPath(
    expr: { type: 'JSONPath'; object: ExpressionNode; path: string; extractText: boolean },
    row: Record<string, unknown>
  ): { name: string; value: unknown } {
    const obj = this.evaluateExpression(expr.object, row).value as Record<string, unknown>

    // Parse path like '$.user.email'
    const pathStr = expr.path.replace(/^'|'$/g, '') // Remove quotes
    const parts = pathStr.replace(/^\$\.?/, '').split('.')

    let current: unknown = obj
    for (const part of parts) {
      if (current === null || current === undefined) break
      current = (current as Record<string, unknown>)[part]
    }

    // Convert to string if extractText is true
    const value = expr.extractText ? String(current) : current

    return { name: `${expr.path}`, value }
  }

  /**
   * Evaluate aggregation over data.
   */
  private evaluateAggregation(
    expr: ExpressionNode,
    data: Record<string, unknown>[]
  ): { name: string; value: unknown } {
    if (expr.type === 'Alias') {
      const inner = this.evaluateAggregation(expr.expression, data)
      return { name: expr.alias, value: inner.value }
    }

    if (expr.type === 'FunctionCall') {
      const fnName = expr.name.toUpperCase()

      switch (fnName) {
        case 'COUNT': {
          // count(*) or count(column)
          if (expr.args.length === 0 || expr.args[0].type === 'Star') {
            return { name: 'count(*)', value: data.length }
          }
          // Count non-null values
          const count = data.filter((row) => {
            const val = this.evaluateExpression(expr.args[0], row).value
            return val !== null && val !== undefined
          }).length
          return { name: `count(${expr.args[0]})`, value: count }
        }

        case 'SUM': {
          let sum = 0
          for (const row of data) {
            const val = this.evaluateExpression(expr.args[0], row).value
            if (typeof val === 'number') {
              sum += val
            } else if (typeof val === 'string') {
              sum += parseFloat(val) || 0
            }
          }
          return { name: 'sum', value: sum }
        }

        case 'AVG': {
          let sum = 0
          let count = 0
          for (const row of data) {
            const val = this.evaluateExpression(expr.args[0], row).value
            if (typeof val === 'number') {
              sum += val
              count++
            }
          }
          return { name: 'avg', value: count > 0 ? sum / count : 0 }
        }

        case 'MIN': {
          let min: number | null = null
          for (const row of data) {
            const val = this.evaluateExpression(expr.args[0], row).value as number
            if (min === null || val < min) min = val
          }
          return { name: 'min', value: min }
        }

        case 'MAX': {
          let max: number | null = null
          for (const row of data) {
            const val = this.evaluateExpression(expr.args[0], row).value as number
            if (max === null || val > max) max = val
          }
          return { name: 'max', value: max }
        }

        default:
          throw new Error(`Unsupported aggregation function: ${fnName}`)
      }
    }

    throw new Error(`Expected aggregation function, got ${expr.type}`)
  }

  /**
   * Check if expression contains aggregation.
   */
  private isAggregation(expr: ExpressionNode): boolean {
    if (expr.type === 'Alias') {
      return this.isAggregation(expr.expression)
    }

    if (expr.type === 'FunctionCall') {
      const fnName = expr.name.toUpperCase()
      return ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT'].includes(fnName)
    }

    return false
  }

  /**
   * Evaluate a WHERE condition.
   */
  private evaluateCondition(expr: ExpressionNode, row: Record<string, unknown>): boolean {
    const result = this.evaluateExpression(expr, row)
    return Boolean(result.value)
  }

  /**
   * Project row to selected columns.
   */
  private projectRow(
    columns: ExpressionNode[],
    row: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const col of columns) {
      if (col.type === 'Star') {
        Object.assign(result, row)
      } else {
        const { name, value } = this.evaluateExpression(col, row)
        result[name] = value
      }
    }

    return result
  }
}

// ============================================================================
// COORDINATOR
// ============================================================================

/**
 * Coordinator for distributed query execution.
 * Parses SQL, builds query plan, dispatches to executors, merges results.
 */
export class Coordinator {
  private config: Required<ExecutorConfig>
  private executors: Map<string, ExecutorWorker> = new Map()
  private failedExecutors: Set<string> = new Set()
  private tables: Map<string, Record<string, unknown>[]> = new Map()
  private indices: Map<string, { column: string; type: string }> = new Map()
  private _lastQueryStats: QueryStats | null = null
  private _timeout: number | null = null

  constructor(config: ExecutorConfig = {}) {
    this.config = {
      executors: config.executors ?? 4,
      chunkSize: config.chunkSize ?? 1000,
      maxRetries: config.maxRetries ?? 3,
      timeoutMs: config.timeoutMs ?? 30000,
    }

    // Initialize executor workers
    for (let i = 0; i < this.config.executors; i++) {
      const id = `executor-${i}`
      this.executors.set(id, new ExecutorWorker())
    }
  }

  /**
   * Get stats from last query execution.
   */
  get lastQueryStats(): QueryStats {
    return this._lastQueryStats || {
      executorsUsed: 0,
      rowsScanned: 0,
      bytesScanned: 0,
      executionTimeMs: 0,
      planningTimeMs: 0,
    }
  }

  /**
   * Set execution timeout.
   */
  setTimeout(ms: number): void {
    this._timeout = ms
  }

  /**
   * Seed test data.
   */
  async seedTestData(table: string, data: Record<string, unknown>[]): Promise<void> {
    this.tables.set(table, data)

    // Distribute data across executors (round-robin by partition)
    const partitionSize = Math.ceil(data.length / this.config.executors)
    let partitionIndex = 0

    for (const [id, executor] of this.executors) {
      const start = partitionIndex * partitionSize
      const end = Math.min(start + partitionSize, data.length)
      const partition = data.slice(start, end)

      if (partition.length > 0) {
        await executor.seedTestData(partition)
      }

      partitionIndex++
    }
  }

  /**
   * Create an index on a column.
   */
  async createIndex(table: string, column: string, type: string): Promise<void> {
    this.indices.set(`${table}.${column}`, { column, type })
  }

  /**
   * Simulate executor failure.
   */
  simulateFailure(executorId: string): void {
    this.failedExecutors.add(executorId)
  }

  /**
   * Execute a SQL query.
   */
  async execute(sql: string, options: ExecuteOptions = {}): Promise<QueryResult> {
    const startTime = performance.now()

    // Parse SQL
    const ast = parseSQL(sql)
    if (ast.type !== 'SelectQuery') {
      throw new Error('Only SELECT queries are supported')
    }

    const planningTime = performance.now() - startTime

    // Get available executors
    const availableExecutors = Array.from(this.executors.entries())
      .filter(([id]) => !this.failedExecutors.has(id))

    if (availableExecutors.length === 0) {
      throw new Error('All executors failed, cannot execute query')
    }

    // Build query plan
    const plan = this.buildQueryPlan(ast)

    // Execute on available executors
    const executorResults: Chunk[][] = []
    const executorsUsed = new Set<string>()

    // Assign partitions to executors
    const partitions = this.getPartitions(ast)
    const partitionsPerExecutor = Math.ceil(partitions.length / availableExecutors.length)

    const timeout = this._timeout ?? options.timeoutMs ?? this.config.timeoutMs
    const startExec = performance.now()

    try {
      const promises = availableExecutors.map(async ([id, executor], index) => {
        const start = index * partitionsPerExecutor
        const end = Math.min(start + partitionsPerExecutor, partitions.length)
        const assignedPartitions = partitions.slice(start, end)

        if (assignedPartitions.length === 0) return []

        executorsUsed.add(id)

        const chunks: Chunk[] = []
        for await (const chunk of executor.execute(plan, assignedPartitions, {
          chunkSize: this.config.chunkSize,
        })) {
          chunks.push(chunk)

          // Check timeout
          if (performance.now() - startExec > timeout) {
            if (options.allowPartialResults) {
              break
            }
            throw new Error('Query timeout exceeded')
          }
        }

        return chunks
      })

      const results = await Promise.all(promises)
      for (const chunks of results) {
        if (chunks.length > 0) {
          executorResults.push(chunks)
        }
      }
    } catch (error) {
      if (options.allowPartialResults && executorResults.length > 0) {
        // Return partial results
        const rows = this.mergeResults(executorResults, ast)
        return {
          success: true,
          rows,
          partial: true,
          stats: {
            executorsUsed: executorsUsed.size,
            rowsScanned: rows.length,
            bytesScanned: 0,
            executionTimeMs: performance.now() - startTime,
            planningTimeMs: planningTime,
          },
        }
      }
      throw error
    }

    // Merge results
    const rows = this.mergeResults(executorResults, ast)

    // Update stats
    this._lastQueryStats = {
      executorsUsed: executorsUsed.size,
      rowsScanned: rows.length,
      bytesScanned: 0,
      executionTimeMs: performance.now() - startTime,
      planningTimeMs: planningTime,
    }

    return {
      success: true,
      rows,
      stats: this._lastQueryStats,
    }
  }

  /**
   * Execute a query and stream results.
   */
  async *executeStream(sql: string): ChunkStream {
    const ast = parseSQL(sql)
    if (ast.type !== 'SelectQuery') {
      throw new Error('Only SELECT queries are supported')
    }

    const plan = this.buildQueryPlan(ast)
    const partitions = this.getPartitions(ast)

    const availableExecutors = Array.from(this.executors.entries())
      .filter(([id]) => !this.failedExecutors.has(id))

    if (availableExecutors.length === 0) {
      throw new Error('All executors failed')
    }

    // Get limit from AST
    const limit = ast.limit?.value as number | undefined

    // Create async generators for each executor
    const generators: AsyncGenerator<Chunk>[] = []
    const partitionsPerExecutor = Math.ceil(partitions.length / availableExecutors.length)

    for (let i = 0; i < availableExecutors.length; i++) {
      const [, executor] = availableExecutors[i]
      const start = i * partitionsPerExecutor
      const end = Math.min(start + partitionsPerExecutor, partitions.length)
      const assignedPartitions = partitions.slice(start, end)

      if (assignedPartitions.length > 0) {
        generators.push(executor.execute(plan, assignedPartitions, {
          chunkSize: this.config.chunkSize,
        }))
      }
    }

    // Interleave results from all executors
    let totalRowsYielded = 0
    let completedGenerators = 0
    const activeGenerators = new Map(generators.map((g, i) => [i, g]))

    while (activeGenerators.size > 0) {
      for (const [index, gen] of activeGenerators) {
        const result = await gen.next()

        if (result.done) {
          activeGenerators.delete(index)
          completedGenerators++
          continue
        }

        const chunk = result.value

        // Calculate progress
        const progress = Math.round((completedGenerators / generators.length) * 100)

        // Apply limit
        if (limit !== undefined) {
          const remainingRows = limit - totalRowsYielded
          if (remainingRows <= 0) {
            // Close all generators
            for (const [, g] of activeGenerators) {
              await g.return(undefined)
            }
            activeGenerators.clear()
            break
          }

          if (chunk.rowCount > remainingRows) {
            // Truncate chunk
            for (const col of Object.keys(chunk.data)) {
              chunk.data[col] = chunk.data[col].slice(0, remainingRows)
            }
            chunk.rowCount = remainingRows
          }
        }

        totalRowsYielded += chunk.rowCount

        yield {
          ...chunk,
          progress,
        }
      }
    }

    // Yield final chunk with 100% progress
    yield {
      queryId: 'final',
      sequence: -1,
      data: {},
      rowCount: 0,
      isLast: true,
      progress: 100,
    }
  }

  /**
   * Explain query plan.
   */
  async explain(sql: string): Promise<ExplainResult> {
    const ast = parseSQL(sql)
    if (ast.type !== 'SelectQuery') {
      throw new Error('Only SELECT queries are supported')
    }

    const plan = this.buildQueryPlan(ast)
    const nodes = this.planToNodes(plan)

    // Check for index usage
    let usesIndex = false
    let indexType: string | undefined

    if (ast.where) {
      const indexInfo = this.checkIndexUsage(ast.from?.table || '', ast.where)
      usesIndex = indexInfo.usesIndex
      indexType = indexInfo.indexType
    }

    // Check for aggregation optimization
    const hasGroupBy = this.hasGroupBy(ast)
    if (hasGroupBy) {
      // Insert partial/final aggregate nodes
      nodes.unshift(
        { id: 'partial_agg', operation: 'partial_aggregate' },
        { id: 'final_agg', operation: 'final_aggregate' }
      )
    }

    return {
      nodes,
      usesIndex,
      indexType,
    }
  }

  /**
   * Ping an executor to measure latency.
   */
  async ping(executorId: string): Promise<void> {
    const executor = this.executors.get(executorId)
    if (!executor) {
      throw new Error(`Unknown executor: ${executorId}`)
    }
    await executor.ping()
  }

  /**
   * Build query plan from AST.
   */
  private buildQueryPlan(ast: SelectQueryNode): QueryPlan {
    // Start with scan
    const columns = this.extractColumns(ast.columns)
    const table = ast.from?.table || 'things'

    let plan: QueryPlan = {
      id: crypto.randomUUID(),
      operation: 'scan',
      params: {
        type: 'scan',
        table,
        columns,
      },
    }

    // Add filter if WHERE clause
    if (ast.where) {
      plan = {
        id: crypto.randomUUID(),
        operation: 'filter',
        params: {
          type: 'filter',
          expression: this.expressionToString(ast.where),
        },
        children: [plan],
      }
    }

    // Add aggregation if needed
    if (this.hasAggregation(ast)) {
      const groupBy = this.extractGroupBy(ast)
      const aggregations = this.extractAggregations(ast)

      plan = {
        id: crypto.randomUUID(),
        operation: 'aggregate',
        params: {
          type: 'aggregate',
          groupBy,
          aggregations,
        },
        children: [plan],
      }
    }

    // Add order by if needed
    if (ast.orderBy) {
      plan = {
        id: crypto.randomUUID(),
        operation: 'sort',
        params: {
          type: 'sort',
          orderBy: ast.orderBy.map((o) => ({
            column: this.expressionToString(o.expression),
            direction: o.direction.toLowerCase() as 'asc' | 'desc',
          })),
        },
        children: [plan],
      }
    }

    // Add limit if needed
    if (ast.limit) {
      plan = {
        id: crypto.randomUUID(),
        operation: 'limit',
        params: {
          type: 'limit',
          limit: ast.limit.value as number,
        },
        children: [plan],
      }
    }

    return plan
  }

  /**
   * Extract column names from expressions.
   */
  private extractColumns(exprs: ExpressionNode[]): string[] {
    const columns: string[] = []

    for (const expr of exprs) {
      if (expr.type === 'Star') {
        columns.push('*')
      } else if (expr.type === 'Identifier') {
        columns.push(expr.name)
      } else if (expr.type === 'Alias') {
        if (expr.expression.type === 'Identifier') {
          columns.push(expr.expression.name)
        }
      }
    }

    return columns.length > 0 ? columns : ['*']
  }

  /**
   * Convert expression to string.
   */
  private expressionToString(expr: ExpressionNode): string {
    switch (expr.type) {
      case 'Literal':
        if (expr.dataType === 'string') {
          return `'${expr.value}'`
        }
        return String(expr.value)

      case 'Identifier':
        return expr.name

      case 'BinaryOp':
        return `${this.expressionToString(expr.left)} ${expr.op} ${this.expressionToString(expr.right)}`

      case 'FunctionCall':
        return `${expr.name}(${expr.args.map((a) => this.expressionToString(a)).join(', ')})`

      case 'JSONPath':
        return `${this.expressionToString(expr.object)}${expr.extractText ? '->>' : '->'}'${expr.path}'`

      case 'Alias':
        return this.expressionToString(expr.expression)

      case 'Star':
        return '*'

      default:
        return ''
    }
  }

  /**
   * Check if query has aggregation.
   */
  private hasAggregation(ast: SelectQueryNode): boolean {
    return ast.columns.some((col) => {
      if (col.type === 'Alias') {
        return this.isAggregationExpr(col.expression)
      }
      return this.isAggregationExpr(col)
    })
  }

  /**
   * Check if expression is aggregation.
   */
  private isAggregationExpr(expr: ExpressionNode): boolean {
    if (expr.type === 'FunctionCall') {
      const fnName = expr.name.toUpperCase()
      return ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].includes(fnName)
    }
    return false
  }

  /**
   * Check if query has GROUP BY (inferred from aggregation + non-agg columns).
   */
  private hasGroupBy(ast: SelectQueryNode): boolean {
    return this.hasAggregation(ast)
  }

  /**
   * Extract GROUP BY columns.
   */
  private extractGroupBy(ast: SelectQueryNode): string[] {
    const groupBy: string[] = []

    for (const col of ast.columns) {
      const expr = col.type === 'Alias' ? col.expression : col

      if (expr.type === 'Identifier' && !this.isAggregationExpr(expr)) {
        groupBy.push(expr.name)
      }
    }

    return groupBy
  }

  /**
   * Extract aggregations.
   */
  private extractAggregations(
    ast: SelectQueryNode
  ): Array<{ function: string; column?: string; alias: string }> {
    const aggregations: Array<{ function: string; column?: string; alias: string }> = []

    for (const col of ast.columns) {
      let expr = col
      let alias = ''

      if (col.type === 'Alias') {
        alias = col.alias
        expr = col.expression
      }

      if (expr.type === 'FunctionCall' && this.isAggregationExpr(expr)) {
        const fn = expr.name.toLowerCase() as 'count' | 'sum' | 'avg' | 'min' | 'max'
        const column = expr.args[0]?.type === 'Star' ? undefined : this.expressionToString(expr.args[0])

        aggregations.push({
          function: fn,
          column,
          alias: alias || `${fn}(${column || '*'})`,
        })
      }
    }

    return aggregations
  }

  /**
   * Get partitions for query.
   */
  private getPartitions(ast: SelectQueryNode): string[] {
    // Generate partition IDs based on table
    const table = ast.from?.table || 'things'
    const tableData = this.tables.get(table) || []
    const partitionCount = Math.min(this.config.executors, Math.ceil(tableData.length / 1000))

    return Array.from({ length: partitionCount }, (_, i) => `${table}-partition-${i}`)
  }

  /**
   * Merge results from multiple executors.
   */
  private mergeResults(
    executorResults: Chunk[][],
    ast: SelectQueryNode
  ): Record<string, unknown>[] {
    const allRows: Record<string, unknown>[] = []

    for (const chunks of executorResults) {
      for (const chunk of chunks) {
        if (chunk.rowCount === 0) continue

        for (let i = 0; i < chunk.rowCount; i++) {
          const row: Record<string, unknown> = {}
          for (const [col, values] of Object.entries(chunk.data)) {
            row[col] = values[i]
          }
          allRows.push(row)
        }
      }
    }

    // If aggregation, merge partial results
    if (this.hasAggregation(ast)) {
      return this.mergeAggregationResults(allRows, ast)
    }

    // Apply ORDER BY
    if (ast.orderBy) {
      allRows.sort((a, b) => {
        for (const orderElem of ast.orderBy!) {
          const col = this.expressionToString(orderElem.expression)
          const aVal = a[col]
          const bVal = b[col]
          const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
          if (cmp !== 0) {
            return orderElem.direction === 'DESC' ? -cmp : cmp
          }
        }
        return 0
      })
    }

    // Apply LIMIT
    if (ast.limit) {
      const limit = ast.limit.value as number
      return allRows.slice(0, limit)
    }

    return allRows
  }

  /**
   * Merge aggregation results (final aggregation).
   */
  private mergeAggregationResults(
    rows: Record<string, unknown>[],
    ast: SelectQueryNode
  ): Record<string, unknown>[] {
    const groupBy = this.extractGroupBy(ast)
    const aggregations = this.extractAggregations(ast)

    if (groupBy.length === 0) {
      // No GROUP BY, merge all rows into one
      const result: Record<string, unknown> = {}

      for (const agg of aggregations) {
        if (agg.function === 'count') {
          result[agg.alias] = rows.reduce((sum, r) => sum + (r[agg.alias] as number || 0), 0)
        } else if (agg.function === 'sum') {
          result[agg.alias] = rows.reduce((sum, r) => sum + (r[agg.alias] as number || 0), 0)
        } else if (agg.function === 'min') {
          result[agg.alias] = Math.min(...rows.map((r) => r[agg.alias] as number))
        } else if (agg.function === 'max') {
          result[agg.alias] = Math.max(...rows.map((r) => r[agg.alias] as number))
        }
      }

      return [result]
    }

    // Group by key
    const groups = new Map<string, Record<string, unknown>>()

    for (const row of rows) {
      const key = groupBy.map((col) => String(row[col])).join('|')

      if (!groups.has(key)) {
        const groupRow: Record<string, unknown> = {}
        for (const col of groupBy) {
          groupRow[col] = row[col]
        }
        for (const agg of aggregations) {
          groupRow[agg.alias] = 0
        }
        groups.set(key, groupRow)
      }

      const groupRow = groups.get(key)!
      for (const agg of aggregations) {
        if (agg.function === 'count' || agg.function === 'sum') {
          groupRow[agg.alias] = (groupRow[agg.alias] as number) + (row[agg.alias] as number || 0)
        }
      }
    }

    const result = Array.from(groups.values())

    // Apply ORDER BY
    if (ast.orderBy) {
      result.sort((a, b) => {
        for (const orderElem of ast.orderBy!) {
          const col = this.expressionToString(orderElem.expression)
          const aVal = a[col]
          const bVal = b[col]
          const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
          if (cmp !== 0) {
            return orderElem.direction === 'DESC' ? -cmp : cmp
          }
        }
        return 0
      })
    }

    return result
  }

  /**
   * Convert query plan to explain nodes.
   */
  private planToNodes(plan: QueryPlan): QueryPlanNode[] {
    const nodes: QueryPlanNode[] = []

    const addNode = (p: QueryPlan) => {
      nodes.push({
        id: p.id,
        operation: p.operation,
        table: p.params.type === 'scan' ? p.params.table : undefined,
        columns: p.params.type === 'scan' ? p.params.columns : undefined,
      })

      if (p.children) {
        for (const child of p.children) {
          addNode(child)
        }
      }
    }

    addNode(plan)
    return nodes
  }

  /**
   * Check if query can use an index.
   */
  private checkIndexUsage(
    table: string,
    where: ExpressionNode
  ): { usesIndex: boolean; indexType?: string } {
    if (where.type === 'BinaryOp' && where.op === '=') {
      // Check left side for column reference
      const colPath = this.extractColumnPath(where.left)
      if (colPath) {
        const indexKey = `${table}.${colPath}`
        const index = this.indices.get(indexKey)
        if (index) {
          return { usesIndex: true, indexType: index.type }
        }
      }
    }

    return { usesIndex: false }
  }

  /**
   * Extract column path from expression.
   */
  private extractColumnPath(expr: ExpressionNode): string | null {
    if (expr.type === 'Identifier') {
      return expr.name
    }

    if (expr.type === 'JSONPath') {
      const base = this.extractColumnPath(expr.object)
      if (base) {
        const path = expr.path.replace(/^'\$\.?|'$/g, '')
        return `${base}.${path}`
      }
    }

    return null
  }
}

// ============================================================================
// EXECUTOR WORKER
// ============================================================================

/**
 * Executor worker that receives and executes query plan fragments.
 */
export class ExecutorWorker {
  private data: Record<string, unknown>[] = []
  private serializer = new QuerySerializer()

  /**
   * Seed test data.
   */
  async seedTestData(data: Record<string, unknown>[]): Promise<void> {
    this.data = data
  }

  /**
   * Ping for latency measurement.
   */
  async ping(): Promise<void> {
    // No-op, just for measuring RPC latency
  }

  /**
   * Execute a query plan.
   */
  async *execute(
    plan: QueryPlan,
    partitions: string[],
    context?: { chunkSize?: number }
  ): AsyncGenerator<Chunk> {
    const chunkSize = context?.chunkSize ?? 1000
    const queryId = crypto.randomUUID()

    // Execute plan and get results
    const rows = this.executePlan(plan)

    // Stream results in chunks
    let sequence = 0
    const columns = this.getColumnsFromData(rows[0])

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunkRows = rows.slice(i, i + chunkSize)
      const data: Record<string, unknown[]> = {}

      // Convert rows to columnar format
      for (const col of Object.keys(chunkRows[0] || {})) {
        data[col] = chunkRows.map((r) => r[col])
      }

      yield {
        queryId,
        sequence: sequence++,
        columns: sequence === 1 ? columns : undefined,
        data,
        rowCount: chunkRows.length,
        isLast: i + chunkSize >= rows.length,
      }
    }

    // If no rows, yield empty final chunk
    if (rows.length === 0) {
      yield {
        queryId,
        sequence: 0,
        data: {},
        rowCount: 0,
        isLast: true,
      }
    }
  }

  /**
   * Create RPC request object.
   */
  createRPCRequest(params: {
    queryId: string
    plan: QueryPlan
    partitions: string[]
  }): { method: string; params: typeof params } {
    return {
      method: 'execute',
      params,
    }
  }

  /**
   * Execute plan and return rows.
   */
  private executePlan(plan: QueryPlan): Record<string, unknown>[] {
    let rows = this.data

    // Execute children first
    if (plan.children) {
      for (const child of plan.children) {
        rows = this.executePlan({ ...child, children: child.children })
      }
    }

    // Execute this node
    switch (plan.operation) {
      case 'scan':
        return this.executeScan(plan, rows)

      case 'filter':
        return this.executeFilter(plan, rows)

      case 'aggregate':
        return this.executeAggregate(plan, rows)

      case 'sort':
        return this.executeSort(plan, rows)

      case 'limit':
        return this.executeLimit(plan, rows)

      default:
        return rows
    }
  }

  /**
   * Execute scan operation.
   */
  private executeScan(plan: QueryPlan, rows: Record<string, unknown>[]): Record<string, unknown>[] {
    if (plan.params.type !== 'scan') return rows

    const columns = plan.params.columns

    if (columns.includes('*')) {
      return rows
    }

    // Project only requested columns
    return rows.map((row) => {
      const result: Record<string, unknown> = {}
      for (const col of columns) {
        result[col] = row[col]
      }
      return result
    })
  }

  /**
   * Execute filter operation.
   */
  private executeFilter(
    plan: QueryPlan,
    rows: Record<string, unknown>[]
  ): Record<string, unknown>[] {
    if (plan.params.type !== 'filter') return rows

    const expression = plan.params.expression

    return rows.filter((row) => this.evaluateFilterExpression(expression, row))
  }

  /**
   * Evaluate filter expression.
   */
  private evaluateFilterExpression(expr: string, row: Record<string, unknown>): boolean {
    // Simple expression parser for common patterns
    // Format: column = 'value' or column = value

    const match = expr.match(/^\$?(\w+)\s*=\s*'([^']*)'$/)
    if (match) {
      const [, column, value] = match
      return row[`$${column}`] === value || row[column] === value
    }

    const numMatch = expr.match(/^\$?(\w+)\s*=\s*(\d+)$/)
    if (numMatch) {
      const [, column, value] = numMatch
      return row[`$${column}`] === parseInt(value) || row[column] === parseInt(value)
    }

    return true
  }

  /**
   * Execute aggregate operation.
   */
  private executeAggregate(
    plan: QueryPlan,
    rows: Record<string, unknown>[]
  ): Record<string, unknown>[] {
    if (plan.params.type !== 'aggregate') return rows

    const { groupBy, aggregations } = plan.params

    if (groupBy.length === 0) {
      // No group by, aggregate all rows
      const result: Record<string, unknown> = {}

      for (const agg of aggregations) {
        if (agg.function === 'count') {
          result[agg.alias] = rows.length
        } else if (agg.function === 'sum' && agg.column) {
          result[agg.alias] = rows.reduce((sum, r) => sum + (r[agg.column!] as number || 0), 0)
        }
      }

      return [result]
    }

    // Group by
    const groups = new Map<string, Record<string, unknown>[]>()

    for (const row of rows) {
      const key = groupBy.map((col) => String(row[col])).join('|')
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(row)
    }

    const results: Record<string, unknown>[] = []

    for (const [key, groupRows] of groups) {
      const keyParts = key.split('|')
      const result: Record<string, unknown> = {}

      for (let i = 0; i < groupBy.length; i++) {
        result[groupBy[i]] = groupRows[0][groupBy[i]]
      }

      for (const agg of aggregations) {
        if (agg.function === 'count') {
          result[agg.alias] = groupRows.length
        } else if (agg.function === 'sum' && agg.column) {
          result[agg.alias] = groupRows.reduce((sum, r) => sum + (r[agg.column!] as number || 0), 0)
        }
      }

      results.push(result)
    }

    return results
  }

  /**
   * Execute sort operation.
   */
  private executeSort(
    plan: QueryPlan,
    rows: Record<string, unknown>[]
  ): Record<string, unknown>[] {
    if (plan.params.type !== 'sort') return rows

    const orderBy = plan.params.orderBy

    return [...rows].sort((a, b) => {
      for (const order of orderBy) {
        const aVal = a[order.column]
        const bVal = b[order.column]
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
        if (cmp !== 0) {
          return order.direction === 'desc' ? -cmp : cmp
        }
      }
      return 0
    })
  }

  /**
   * Execute limit operation.
   */
  private executeLimit(
    plan: QueryPlan,
    rows: Record<string, unknown>[]
  ): Record<string, unknown>[] {
    if (plan.params.type !== 'limit') return rows

    const limit = plan.params.limit
    const offset = plan.params.offset || 0

    return rows.slice(offset, offset + limit)
  }

  /**
   * Get column metadata from row.
   */
  private getColumnsFromData(row: Record<string, unknown> | undefined): ColumnMeta[] {
    if (!row) return []

    return Object.entries(row).map(([name, value]) => ({
      name,
      type: this.inferType(value),
      nullable: value === null,
    }))
  }

  /**
   * Infer column type from value.
   */
  private inferType(value: unknown): ColumnMeta['type'] {
    if (value === null || value === undefined) return 'string'
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'int64' : 'float64'
    }
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'string') return 'string'
    if (value instanceof Date) return 'datetime'
    return 'json'
  }
}
