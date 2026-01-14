/**
 * Query Execution Pipeline - Pull-Based Iterator Model
 *
 * Implements a Volcano-style execution engine with:
 * - Logical to Physical plan transformation
 * - Pull-based iterator operators with lazy evaluation
 * - Operator fusion for common patterns
 * - Memory-aware execution with backpressure
 *
 * @see dotdo-5qu4s
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * A row in the query result - maps column names to values
 */
export type Row = Record<string, unknown>

/**
 * Predicate for filtering rows
 */
export interface SimplePredicate {
  type: 'predicate'
  column: string
  op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'IN' | 'LIKE'
  value: unknown
}

/**
 * Logical predicate combining multiple predicates
 */
export interface LogicalPredicate {
  type: 'logical'
  op: 'AND' | 'OR' | 'NOT'
  children: PredicateExpr[]
}

export type PredicateExpr = SimplePredicate | LogicalPredicate

/**
 * Sort specification
 */
export interface SortSpec {
  column: string
  direction: 'ASC' | 'DESC'
}

/**
 * Aggregation specification
 */
export interface AggregationSpec {
  function: 'sum' | 'avg' | 'count' | 'min' | 'max'
  column?: string
  alias: string
}

/**
 * Column projection - can be string or computed
 */
export type ColumnProjection =
  | string
  | { column: string; alias: string }
  | { compute: (row: Row) => unknown; alias: string }
  | { expression: { op: string; left: string; right: string }; alias: string }

/**
 * Join condition
 */
export interface JoinCondition {
  leftColumn: string
  rightColumn: string
}

// =============================================================================
// Data Source
// =============================================================================

export interface DataSource {
  name: string
  rows: Row[]
  getIterator: () => Iterator<Row>
}

// =============================================================================
// Memory Management
// =============================================================================

export interface MemoryBudget {
  maxBytes: number
}

/**
 * Tracks memory usage during query execution
 */
export class MemoryTracker {
  private _currentBytes = 0
  private _peakBytes = 0
  private readonly maxBytes: number

  constructor(budget: MemoryBudget) {
    this.maxBytes = budget.maxBytes
  }

  get currentBytes(): number {
    return this._currentBytes
  }

  get peakBytes(): number {
    return this._peakBytes
  }

  /**
   * Allocate memory - throws if limit exceeded
   */
  allocate(bytes: number): void {
    if (this._currentBytes + bytes > this.maxBytes) {
      throw new Error(`Memory limit exceeded: requested ${bytes} bytes, current ${this._currentBytes}, max ${this.maxBytes}`)
    }
    this._currentBytes += bytes
    if (this._currentBytes > this._peakBytes) {
      this._peakBytes = this._currentBytes
    }
  }

  /**
   * Deallocate memory
   */
  deallocate(bytes: number): void {
    this._currentBytes = Math.max(0, this._currentBytes - bytes)
  }

  /**
   * Try to reserve memory without throwing
   * Actually commits the reservation if successful
   */
  tryReserve(bytes: number): boolean {
    if (this._currentBytes + bytes <= this.maxBytes) {
      this._currentBytes += bytes
      if (this._currentBytes > this._peakBytes) {
        this._peakBytes = this._currentBytes
      }
      return true
    }
    return false
  }
}

// =============================================================================
// Pipeline Context
// =============================================================================

export interface PipelineContext {
  dataSources: Map<string, DataSource>
  memoryTracker: MemoryTracker
}

// =============================================================================
// Logical Plan Nodes
// =============================================================================

export type LogicalPlan =
  | LogicalScan
  | LogicalFilter
  | LogicalProject
  | LogicalJoin
  | LogicalAggregate
  | LogicalSort
  | LogicalLimit

/**
 * Logical table scan
 */
export class LogicalScan {
  readonly type = 'scan' as const
  constructor(
    public readonly tableName: string,
    public readonly columns?: string[]
  ) {}
}

/**
 * Logical filter operation
 */
export class LogicalFilter {
  readonly type = 'filter' as const
  constructor(
    public readonly input: LogicalPlan,
    public readonly predicate: PredicateExpr
  ) {}
}

/**
 * Logical projection
 */
export class LogicalProject {
  readonly type = 'project' as const
  constructor(
    public readonly input: LogicalPlan,
    public readonly columns: ColumnProjection[]
  ) {}
}

/**
 * Logical join
 */
export class LogicalJoin {
  readonly type = 'join' as const
  constructor(
    public readonly left: LogicalPlan,
    public readonly right: LogicalPlan,
    public readonly joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'CROSS',
    public readonly condition: JoinCondition
  ) {}
}

/**
 * Logical aggregation
 */
export class LogicalAggregate {
  readonly type = 'aggregate' as const
  constructor(
    public readonly input: LogicalPlan,
    public readonly groupBy: string[],
    public readonly aggregations: AggregationSpec[]
  ) {}
}

/**
 * Logical sort
 */
export class LogicalSort {
  readonly type = 'sort' as const
  constructor(
    public readonly input: LogicalPlan,
    public readonly orderBy: SortSpec[]
  ) {}
}

/**
 * Logical limit with offset
 */
export class LogicalLimit {
  readonly type = 'limit' as const
  constructor(
    public readonly input: LogicalPlan,
    public readonly limit: number,
    public readonly offset: number = 0
  ) {}
}

// =============================================================================
// Physical Plan Nodes
// =============================================================================

export type PhysicalPlan =
  | PhysicalScan
  | PhysicalFilter
  | PhysicalProject
  | PhysicalHashJoin
  | PhysicalNestedLoopJoin
  | PhysicalHashAggregate
  | PhysicalStreamAggregate
  | PhysicalSort
  | PhysicalLimit

/**
 * Physical table scan
 */
export class PhysicalScan {
  readonly type = 'scan' as const
  constructor(
    public readonly tableName: string,
    public readonly columns?: string[]
  ) {}
}

/**
 * Physical filter
 */
export class PhysicalFilter {
  readonly type = 'filter' as const
  constructor(
    public readonly input: PhysicalPlan,
    public readonly predicate: PredicateExpr
  ) {}
}

/**
 * Physical projection
 */
export class PhysicalProject {
  readonly type = 'project' as const
  constructor(
    public readonly input: PhysicalPlan,
    public readonly columns: ColumnProjection[]
  ) {}
}

/**
 * Physical hash join - builds hash table from one side
 */
export class PhysicalHashJoin {
  readonly type = 'hash_join' as const
  constructor(
    public readonly left: PhysicalPlan,
    public readonly right: PhysicalPlan,
    public readonly leftColumn: string,
    public readonly rightColumn: string,
    public readonly joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'CROSS',
    public readonly buildSide: 'left' | 'right'
  ) {}
}

/**
 * Physical nested loop join - for small inputs or cross joins
 */
export class PhysicalNestedLoopJoin {
  readonly type = 'nested_loop' as const
  constructor(
    public readonly left: PhysicalPlan,
    public readonly right: PhysicalPlan,
    public readonly leftColumn: string,
    public readonly rightColumn: string,
    public readonly joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'CROSS'
  ) {}
}

/**
 * Physical hash aggregate
 */
export class PhysicalHashAggregate {
  readonly type = 'hash_aggregate' as const
  constructor(
    public readonly input: PhysicalPlan,
    public readonly groupBy: string[],
    public readonly aggregations: AggregationSpec[]
  ) {}
}

/**
 * Physical stream aggregate - for sorted input
 */
export class PhysicalStreamAggregate {
  readonly type = 'stream_aggregate' as const
  constructor(
    public readonly input: PhysicalPlan,
    public readonly groupBy: string[],
    public readonly aggregations: AggregationSpec[]
  ) {}
}

/**
 * Physical sort
 */
export class PhysicalSort {
  readonly type = 'sort' as const
  constructor(
    public readonly input: PhysicalPlan,
    public readonly orderBy: SortSpec[]
  ) {}
}

/**
 * Physical limit
 */
export class PhysicalLimit {
  readonly type = 'limit' as const
  constructor(
    public readonly input: PhysicalPlan,
    public readonly limit: number,
    public readonly offset: number = 0
  ) {}
}

// =============================================================================
// Logical to Physical Plan Transformation
// =============================================================================

interface TableStats {
  rowCount: number
  sortedBy: string | null
}

/**
 * Transforms logical plans to physical plans with cost-based decisions
 */
export class LogicalToPhysicalPlanner {
  private tableStats = new Map<string, TableStats>()

  setTableStats(table: string, stats: TableStats): void {
    this.tableStats.set(table, stats)
  }

  transform(logical: LogicalPlan): PhysicalPlan {
    switch (logical.type) {
      case 'scan':
        return new PhysicalScan(logical.tableName, logical.columns)

      case 'filter':
        return new PhysicalFilter(this.transform(logical.input), logical.predicate)

      case 'project':
        return new PhysicalProject(this.transform(logical.input), logical.columns)

      case 'join':
        return this.transformJoin(logical)

      case 'aggregate':
        return this.transformAggregate(logical)

      case 'sort':
        return new PhysicalSort(this.transform(logical.input), logical.orderBy)

      case 'limit':
        return new PhysicalLimit(this.transform(logical.input), logical.limit, logical.offset)

      default:
        throw new Error(`Unknown logical plan type: ${(logical as any).type}`)
    }
  }

  private transformJoin(join: LogicalJoin): PhysicalHashJoin | PhysicalNestedLoopJoin {
    const leftPhysical = this.transform(join.left)
    const rightPhysical = this.transform(join.right)

    const leftStats = this.getEstimatedRowCount(join.left)
    const rightStats = this.getEstimatedRowCount(join.right)

    // Use nested loop for very small inputs or cross joins
    if (leftStats < 100 || rightStats < 100) {
      if (join.joinType === 'CROSS' || leftStats * rightStats < 10000) {
        return new PhysicalNestedLoopJoin(
          leftPhysical,
          rightPhysical,
          join.condition.leftColumn,
          join.condition.rightColumn,
          join.joinType
        )
      }
    }

    // Use hash join - smaller table as build side
    const buildSide: 'left' | 'right' = leftStats <= rightStats ? 'left' : 'right'

    return new PhysicalHashJoin(
      leftPhysical,
      rightPhysical,
      join.condition.leftColumn,
      join.condition.rightColumn,
      join.joinType,
      buildSide
    )
  }

  private transformAggregate(agg: LogicalAggregate): PhysicalHashAggregate | PhysicalStreamAggregate {
    const inputPhysical = this.transform(agg.input)

    // Check if input is sorted by group by columns
    const inputSortedBy = this.getInputSortedBy(agg.input)
    const groupByMatch = agg.groupBy.length > 0 && agg.groupBy[0] === inputSortedBy

    if (groupByMatch) {
      return new PhysicalStreamAggregate(inputPhysical, agg.groupBy, agg.aggregations)
    }

    return new PhysicalHashAggregate(inputPhysical, agg.groupBy, agg.aggregations)
  }

  private getEstimatedRowCount(plan: LogicalPlan): number {
    if (plan.type === 'scan') {
      const stats = this.tableStats.get(plan.tableName)
      return stats?.rowCount ?? 1000
    }
    // Default estimate
    return 1000
  }

  private getInputSortedBy(plan: LogicalPlan): string | null {
    if (plan.type === 'scan') {
      const stats = this.tableStats.get(plan.tableName)
      return stats?.sortedBy ?? null
    }
    if (plan.type === 'sort' && plan.orderBy.length > 0) {
      return plan.orderBy[0]!.column
    }
    return null
  }
}

// =============================================================================
// Pull-Based Iterator Operators (Volcano Model)
// =============================================================================

/**
 * Base interface for all operators
 */
export interface Operator {
  open(ctx: PipelineContext): void
  next(): Row | null
  close(): void
}

/**
 * Scan operator - iterates through a data source
 */
export class ScanOperator implements Operator {
  private iterator: Iterator<Row> | null = null
  private columns: string[] | undefined

  constructor(
    private readonly tableName: string,
    columns?: string[]
  ) {
    this.columns = columns
  }

  open(ctx: PipelineContext): void {
    const source = ctx.dataSources.get(this.tableName)
    if (!source) {
      throw new Error(`Data source not found: ${this.tableName}`)
    }
    this.iterator = source.getIterator()
  }

  next(): Row | null {
    if (!this.iterator) return null

    const result = this.iterator.next()
    if (result.done) return null

    // Apply column projection if specified
    if (this.columns) {
      const projected: Row = {}
      for (const col of this.columns) {
        projected[col] = result.value[col]
      }
      return projected
    }

    return result.value
  }

  close(): void {
    this.iterator = null
  }
}

/**
 * Filter operator - filters rows based on a predicate function
 */
export class FilterOperator implements Operator {
  constructor(
    private readonly input: Operator,
    private readonly predicate: (row: Row) => boolean
  ) {}

  open(ctx: PipelineContext): void {
    this.input.open(ctx)
  }

  next(): Row | null {
    let row: Row | null
    while ((row = this.input.next()) !== null) {
      if (this.predicate(row)) {
        return row
      }
    }
    return null
  }

  close(): void {
    this.input.close()
  }
}

/**
 * Project operator - projects/transforms columns
 */
export class ProjectOperator implements Operator {
  constructor(
    private readonly input: Operator,
    private readonly columns: ColumnProjection[]
  ) {}

  open(ctx: PipelineContext): void {
    this.input.open(ctx)
  }

  next(): Row | null {
    const row = this.input.next()
    if (row === null) return null

    const projected: Row = {}
    for (const col of this.columns) {
      if (typeof col === 'string') {
        projected[col] = row[col]
      } else if ('alias' in col && 'column' in col) {
        projected[col.alias] = row[col.column]
      } else if ('compute' in col) {
        projected[col.alias] = col.compute(row)
      }
    }
    return projected
  }

  close(): void {
    this.input.close()
  }
}

/**
 * Hash Join operator - builds hash table then probes
 */
export class HashJoinOperator implements Operator {
  private hashTable: Map<unknown, Row[]> = new Map()
  private currentProbeRow: Row | null = null
  private currentMatches: Row[] = []
  private matchIndex = 0
  private ctx: PipelineContext | null = null
  private probeIteratorStarted = false

  constructor(
    private readonly left: Operator,
    private readonly right: Operator,
    private readonly leftColumn: string,
    private readonly rightColumn: string,
    private readonly joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'CROSS'
  ) {}

  open(ctx: PipelineContext): void {
    this.ctx = ctx
    this.hashTable.clear()
    this.currentMatches = []
    this.matchIndex = 0
    this.probeIteratorStarted = false

    // Build phase - hash the right side
    this.right.open(ctx)
    let buildRow: Row | null
    while ((buildRow = this.right.next()) !== null) {
      const key = buildRow[this.rightColumn]
      const existing = this.hashTable.get(key) || []
      existing.push(buildRow)
      this.hashTable.set(key, existing)
    }
    this.right.close()

    // Open probe side
    this.left.open(ctx)
  }

  next(): Row | null {
    while (true) {
      // Return remaining matches from current probe
      if (this.matchIndex < this.currentMatches.length) {
        const buildRow = this.currentMatches[this.matchIndex++]!
        return this.mergeRows(this.currentProbeRow!, buildRow)
      }

      // Get next probe row
      this.currentProbeRow = this.left.next()
      if (this.currentProbeRow === null) return null

      // Find matches
      const probeKey = this.currentProbeRow[this.leftColumn]
      this.currentMatches = this.hashTable.get(probeKey) || []
      this.matchIndex = 0

      // Handle no matches for LEFT join
      if (this.currentMatches.length === 0 && this.joinType === 'LEFT') {
        return this.mergeRows(this.currentProbeRow, this.createNullRow())
      }

      // For INNER join, continue to next probe row if no matches
      if (this.currentMatches.length === 0 && this.joinType === 'INNER') {
        continue
      }
    }
  }

  close(): void {
    this.left.close()
    this.hashTable.clear()
    this.ctx = null
  }

  private mergeRows(left: Row, right: Row): Row {
    return { ...left, ...right }
  }

  private createNullRow(): Row {
    const nullRow: Row = {}
    // Get a sample row to know the columns
    const firstEntry = this.hashTable.values().next().value
    if (firstEntry && firstEntry.length > 0) {
      for (const key of Object.keys(firstEntry[0])) {
        nullRow[key] = null
      }
    }
    return nullRow
  }
}

/**
 * Hash Aggregate operator - groups rows and computes aggregates
 */
export class HashAggregateOperator implements Operator {
  private groups: Map<string, { rows: Row[]; key: Record<string, unknown> }> = new Map()
  private resultIterator: Iterator<{ rows: Row[]; key: Record<string, unknown> }> | null = null

  constructor(
    private readonly input: Operator,
    private readonly groupBy: string[],
    private readonly aggregations: AggregationSpec[]
  ) {}

  open(ctx: PipelineContext): void {
    this.groups.clear()

    // Consume entire input and group
    this.input.open(ctx)
    let row: Row | null
    while ((row = this.input.next()) !== null) {
      const groupKey = this.computeGroupKey(row)
      const keyString = JSON.stringify(groupKey)

      if (!this.groups.has(keyString)) {
        this.groups.set(keyString, { rows: [], key: groupKey })
      }
      this.groups.get(keyString)!.rows.push(row)
    }
    this.input.close()

    // Handle global aggregation (no group by)
    if (this.groupBy.length === 0 && this.groups.size === 0) {
      this.groups.set('', { rows: [], key: {} })
    }

    this.resultIterator = this.groups.values()
  }

  next(): Row | null {
    if (!this.resultIterator) return null

    const result = this.resultIterator.next()
    if (result.done) return null

    const group = result.value
    const outputRow: Row = { ...group.key }

    for (const agg of this.aggregations) {
      outputRow[agg.alias] = this.computeAggregate(agg, group.rows)
    }

    return outputRow
  }

  close(): void {
    this.groups.clear()
    this.resultIterator = null
  }

  private computeGroupKey(row: Row): Record<string, unknown> {
    const key: Record<string, unknown> = {}
    for (const col of this.groupBy) {
      key[col] = row[col]
    }
    return key
  }

  private computeAggregate(agg: AggregationSpec, rows: Row[]): number {
    switch (agg.function) {
      case 'count':
        return rows.length

      case 'sum':
        return rows.reduce((acc, row) => acc + (row[agg.column!] as number || 0), 0)

      case 'avg': {
        if (rows.length === 0) return 0
        const sum = rows.reduce((acc, row) => acc + (row[agg.column!] as number || 0), 0)
        return sum / rows.length
      }

      case 'min':
        return Math.min(...rows.map((row) => row[agg.column!] as number).filter((v) => v !== undefined))

      case 'max':
        return Math.max(...rows.map((row) => row[agg.column!] as number).filter((v) => v !== undefined))

      default:
        throw new Error(`Unknown aggregation function: ${agg.function}`)
    }
  }
}

/**
 * Sort operator - sorts all input rows
 */
export class SortOperator implements Operator {
  private sortedRows: Row[] = []
  private index = 0
  private allocatedBytes = 0
  private ctx: PipelineContext | null = null

  constructor(
    private readonly input: Operator,
    private readonly orderBy: SortSpec[]
  ) {}

  open(ctx: PipelineContext): void {
    this.ctx = ctx
    this.sortedRows = []
    this.index = 0
    this.allocatedBytes = 0

    // Consume all input
    this.input.open(ctx)
    let row: Row | null
    while ((row = this.input.next()) !== null) {
      // Estimate row size
      const rowSize = JSON.stringify(row).length * 2
      ctx.memoryTracker.allocate(rowSize)
      this.allocatedBytes += rowSize
      this.sortedRows.push(row)
    }
    this.input.close()

    // Sort
    this.sortedRows.sort((a, b) => this.compareRows(a, b))
  }

  next(): Row | null {
    if (this.index >= this.sortedRows.length) return null
    return this.sortedRows[this.index++]!
  }

  close(): void {
    if (this.ctx) {
      this.ctx.memoryTracker.deallocate(this.allocatedBytes)
    }
    this.sortedRows = []
    this.allocatedBytes = 0
    this.ctx = null
  }

  private compareRows(a: Row, b: Row): number {
    for (const spec of this.orderBy) {
      const aVal = a[spec.column]
      const bVal = b[spec.column]

      let cmp = 0
      if (aVal === null || aVal === undefined) cmp = 1
      else if (bVal === null || bVal === undefined) cmp = -1
      else if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal
      } else {
        cmp = String(aVal).localeCompare(String(bVal))
      }

      if (cmp !== 0) {
        return spec.direction === 'DESC' ? -cmp : cmp
      }
    }
    return 0
  }
}

/**
 * Limit operator - limits and offsets results
 */
export class LimitOperator implements Operator {
  private count = 0
  private skipped = 0

  constructor(
    private readonly input: Operator,
    private readonly limit: number,
    private readonly offset: number
  ) {}

  open(ctx: PipelineContext): void {
    this.count = 0
    this.skipped = 0
    this.input.open(ctx)
  }

  next(): Row | null {
    // Skip offset rows
    while (this.skipped < this.offset) {
      const row = this.input.next()
      if (row === null) return null
      this.skipped++
    }

    // Check limit
    if (this.count >= this.limit) return null

    const row = this.input.next()
    if (row !== null) {
      this.count++
    }
    return row
  }

  close(): void {
    this.input.close()
  }
}

// =============================================================================
// Operator Fusion
// =============================================================================

/**
 * Fused Filter + Project operator - single pass for common pattern
 */
export class FusedFilterProjectOperator implements Operator {
  constructor(
    private readonly input: Operator,
    private readonly predicate: (row: Row) => boolean,
    private readonly columns: ColumnProjection[]
  ) {}

  open(ctx: PipelineContext): void {
    this.input.open(ctx)
  }

  next(): Row | null {
    let row: Row | null
    while ((row = this.input.next()) !== null) {
      if (this.predicate(row)) {
        // Project in same iteration
        const projected: Row = {}
        for (const col of this.columns) {
          if (typeof col === 'string') {
            projected[col] = row[col]
          } else if ('alias' in col && 'column' in col) {
            projected[col.alias] = row[col.column]
          } else if ('compute' in col) {
            projected[col.alias] = col.compute(row)
          }
        }
        return projected
      }
    }
    return null
  }

  close(): void {
    this.input.close()
  }
}

// =============================================================================
// Pipeline Executor
// =============================================================================

export interface ExecutionResult {
  rows: Row[]
  stats?: {
    rowsProcessed: number
    executionTimeMs: number
    fusedOperators: number
    peakMemoryBytes: number
  }
}

/**
 * Executes physical plans by building operator trees
 */
export class PipelineExecutor {
  async execute(plan: PhysicalPlan, ctx: PipelineContext): Promise<ExecutionResult> {
    const startTime = performance.now()
    const operator = this.buildOperator(plan, ctx)

    operator.open(ctx)
    const rows: Row[] = []
    let row: Row | null
    let rowsProcessed = 0

    while ((row = operator.next()) !== null) {
      rows.push(row)
      rowsProcessed++
    }

    operator.close()
    const executionTimeMs = performance.now() - startTime

    return {
      rows,
      stats: {
        rowsProcessed,
        executionTimeMs,
        fusedOperators: 0,
        peakMemoryBytes: ctx.memoryTracker.peakBytes,
      },
    }
  }

  private buildOperator(plan: PhysicalPlan, ctx: PipelineContext): Operator {
    switch (plan.type) {
      case 'scan':
        return new ScanOperator(plan.tableName, plan.columns)

      case 'filter':
        return new FilterOperator(
          this.buildOperator(plan.input, ctx),
          this.buildPredicateFunction(plan.predicate)
        )

      case 'project':
        return new ProjectOperator(this.buildOperator(plan.input, ctx), plan.columns)

      case 'hash_join':
        return new HashJoinOperator(
          this.buildOperator(plan.left, ctx),
          this.buildOperator(plan.right, ctx),
          plan.leftColumn,
          plan.rightColumn,
          plan.joinType
        )

      case 'nested_loop':
        // For now, use hash join implementation
        return new HashJoinOperator(
          this.buildOperator(plan.left, ctx),
          this.buildOperator(plan.right, ctx),
          plan.leftColumn,
          plan.rightColumn,
          plan.joinType
        )

      case 'hash_aggregate':
        return new HashAggregateOperator(
          this.buildOperator(plan.input, ctx),
          plan.groupBy,
          plan.aggregations
        )

      case 'stream_aggregate':
        // Use hash aggregate for now
        return new HashAggregateOperator(
          this.buildOperator(plan.input, ctx),
          plan.groupBy,
          plan.aggregations
        )

      case 'sort':
        return new SortOperator(this.buildOperator(plan.input, ctx), plan.orderBy)

      case 'limit':
        return new LimitOperator(this.buildOperator(plan.input, ctx), plan.limit, plan.offset)

      default:
        throw new Error(`Unknown physical plan type: ${(plan as any).type}`)
    }
  }

  private buildPredicateFunction(pred: PredicateExpr): (row: Row) => boolean {
    if (pred.type === 'predicate') {
      return (row: Row) => this.evaluatePredicate(row, pred)
    }

    // Logical predicate
    const childFns = pred.children.map((c) => this.buildPredicateFunction(c))

    if (pred.op === 'AND') {
      return (row: Row) => childFns.every((fn) => fn(row))
    } else if (pred.op === 'OR') {
      return (row: Row) => childFns.some((fn) => fn(row))
    } else {
      // NOT
      return (row: Row) => !childFns[0]!(row)
    }
  }

  private evaluatePredicate(row: Row, pred: SimplePredicate): boolean {
    const value = row[pred.column]

    switch (pred.op) {
      case '=':
        return value === pred.value
      case '!=':
        return value !== pred.value
      case '>':
        return (value as number) > (pred.value as number)
      case '>=':
        return (value as number) >= (pred.value as number)
      case '<':
        return (value as number) < (pred.value as number)
      case '<=':
        return (value as number) <= (pred.value as number)
      case 'IN':
        return (pred.value as unknown[]).includes(value)
      case 'LIKE':
        // Simple pattern matching
        const pattern = (pred.value as string).replace(/%/g, '.*').replace(/_/g, '.')
        return new RegExp(`^${pattern}$`).test(String(value))
      default:
        return false
    }
  }
}
