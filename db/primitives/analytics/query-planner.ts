/**
 * Query Planner with Partition Pruning
 *
 * A cost-based query planner that leverages statistics for optimization:
 * - Partition pruning based on filter predicates
 * - Cost estimation using column statistics
 * - Query plan generation with predicate/aggregation pushdown
 * - Human-readable EXPLAIN output
 *
 * The planner integrates with Iceberg column statistics for file pruning
 * and uses bloom filters for equality predicates.
 *
 * @module db/primitives/analytics/query-planner
 * @see dotdo-wjymp
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Column data types for statistics
 */
export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'timestamp'

/**
 * Comparison operators for filter predicates
 */
export type ComparisonOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'between' | 'in'

/**
 * Filter predicate
 */
export interface Predicate {
  column: string
  op: ComparisonOp
  value: unknown
}

/**
 * Aggregate function specification
 */
export interface AggregateSpec {
  type: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'countDistinct'
  column?: string
}

/**
 * Order specification
 */
export interface OrderSpec {
  column: string
  direction: 'asc' | 'desc'
}

/**
 * Column statistics for optimization
 */
export interface ColumnStats {
  name: string
  type: ColumnType
  distinctCount: number
  nullCount: number
  minValue: unknown
  maxValue: unknown
  histogram?: number[]
}

/**
 * Bloom filter interface for equality pruning
 */
export interface BloomFilter {
  column: string
  bitArray: Uint8Array
  hashCount: number
  contains: (value: unknown) => boolean
}

/**
 * Statistics for a single partition
 */
export interface PartitionStats {
  partitionId: string
  rowCount: number
  sizeBytes: number
  columns: Map<string, ColumnStats>
  bloomFilter: BloomFilter | null
}

/**
 * Table-level statistics
 */
export interface TableStats {
  tableName: string
  rowCount: number
  sizeBytes: number
  partitions: PartitionStats[]
  columns: ColumnStats[]
}

/**
 * Analytics query definition
 */
export interface AnalyticsQuery {
  select: string[]
  from: string
  filters: Predicate[]
  groupBy: string[]
  aggregates: Record<string, AggregateSpec>
  orderBy: OrderSpec[]
  limit?: number
  offset?: number
}

/**
 * Cost estimate breakdown
 */
export interface CostEstimate {
  totalCost: number
  cpuCost: number
  ioCost: number
  memoryCost: number
}

/**
 * Statistics for a plan node
 */
export interface NodeStats {
  estimatedRows: number
  estimatedBytes: number
}

/**
 * Plan node types
 */
export type PlanNodeType = 'scan' | 'filter' | 'aggregate' | 'join' | 'sort' | 'limit'

/**
 * Plan node in the query execution plan
 */
export interface PlanNode {
  type: PlanNodeType
  inputs: PlanNode[]
  cost: CostEstimate
  stats: NodeStats
  columns?: string[]
  pushdownPredicates?: Predicate[]
  partialAggregates?: AggregateSpec[]
  predicates?: Predicate[]
  groupBy?: string[]
  aggregates?: Record<string, AggregateSpec>
  orderBy?: OrderSpec[]
  limit?: number
  offset?: number
}

/**
 * Complete query execution plan
 */
export interface QueryPlan {
  operations: PlanNode[]
  estimatedRows: number
  estimatedCost: number
  partitionsPruned: number
  columnsPruned: number
}

/**
 * EXPLAIN format options
 */
export interface ExplainOptions {
  format?: 'default' | 'verbose' | 'tree' | 'json'
}

/**
 * Query planner configuration
 */
export interface QueryPlannerConfig {
  enableBloomFilter?: boolean
  costModel?: 'io-based' | 'cpu-based' | 'balanced'
}

/**
 * Query planner interface
 */
export interface QueryPlanner {
  plan(query: AnalyticsQuery, stats: TableStats): QueryPlan
  estimateCost(plan: QueryPlan): CostEstimate
  explain(plan: QueryPlan, options?: ExplainOptions): string
}

// ============================================================================
// Predicate Helpers
// ============================================================================

/**
 * Create an equality predicate
 */
export function eq(column: string, value: unknown): Predicate {
  return { column, op: '=', value }
}

/**
 * Create an inequality predicate
 */
export function neq(column: string, value: unknown): Predicate {
  return { column, op: '!=', value }
}

/**
 * Create a greater-than predicate
 */
export function gt(column: string, value: unknown): Predicate {
  return { column, op: '>', value }
}

/**
 * Create a less-than predicate
 */
export function lt(column: string, value: unknown): Predicate {
  return { column, op: '<', value }
}

/**
 * Create a greater-than-or-equal predicate
 */
export function gte(column: string, value: unknown): Predicate {
  return { column, op: '>=', value }
}

/**
 * Create a less-than-or-equal predicate
 */
export function lte(column: string, value: unknown): Predicate {
  return { column, op: '<=', value }
}

/**
 * Create a between predicate (inclusive)
 */
export function between(column: string, min: unknown, max: unknown): Predicate {
  return { column, op: 'between', value: [min, max] }
}

/**
 * Create an in-list predicate
 */
export function inList(column: string, values: unknown[]): Predicate {
  return { column, op: 'in', value: values }
}

// ============================================================================
// Query Planner Implementation
// ============================================================================

/**
 * Default cost model weights
 */
const COST_WEIGHTS = {
  IO_WEIGHT: 1.0,
  CPU_WEIGHT: 0.5,
  MEMORY_WEIGHT: 0.3,
  BYTES_PER_ROW: 100,
  FILTER_SELECTIVITY_DEFAULT: 0.3,
  EQUALITY_SELECTIVITY: 0.01,
  RANGE_SELECTIVITY: 0.3,
  IN_LIST_BASE_SELECTIVITY: 0.1,
}

/**
 * Query planner implementation
 */
class QueryPlannerImpl implements QueryPlanner {
  private config: QueryPlannerConfig

  constructor(config: QueryPlannerConfig = {}) {
    this.config = {
      enableBloomFilter: config.enableBloomFilter ?? true,
      costModel: config.costModel ?? 'balanced',
    }
  }

  /**
   * Generate an optimized query plan
   */
  plan(query: AnalyticsQuery, stats: TableStats): QueryPlan {
    // Determine which columns are needed
    const neededColumns = this.computeNeededColumns(query, stats)
    const columnsPruned = stats.columns.length - neededColumns.size

    // Prune partitions based on predicates
    const { prunedPartitions, remainingPartitions } = this.prunePartitions(
      query.filters,
      stats.partitions
    )
    const partitionsPruned = prunedPartitions.length

    // Estimate row count after pruning and filtering
    const estimatedRowsAfterPrune = remainingPartitions.reduce(
      (sum, p) => sum + p.rowCount,
      0
    )
    const filterSelectivity = this.estimateFilterSelectivity(query.filters, stats)
    const estimatedRowsAfterFilter = Math.max(
      1,
      Math.floor(estimatedRowsAfterPrune * filterSelectivity)
    )

    // Build plan operations
    const operations: PlanNode[] = []

    // Scan operation
    const scanOp = this.buildScanOperation(
      query,
      stats,
      remainingPartitions,
      neededColumns
    )
    operations.push(scanOp)

    // Filter operation (if predicates exist that weren't pushed down)
    if (query.filters.length > 0) {
      const filterOp = this.buildFilterOperation(query.filters, scanOp.stats.estimatedRows)
      operations.push(filterOp)
    }

    // Aggregate operation
    if (query.groupBy.length > 0 || Object.keys(query.aggregates).length > 0) {
      const inputRows = operations[operations.length - 1]?.stats.estimatedRows ?? estimatedRowsAfterFilter
      const aggOp = this.buildAggregateOperation(query, inputRows, stats)
      operations.push(aggOp)
    }

    // Sort operation
    if (query.orderBy.length > 0) {
      const inputRows = operations[operations.length - 1]?.stats.estimatedRows ?? estimatedRowsAfterFilter
      const sortOp = this.buildSortOperation(query.orderBy, inputRows)
      operations.push(sortOp)
    }

    // Limit operation
    if (query.limit !== undefined || query.offset !== undefined) {
      const inputRows = operations[operations.length - 1]?.stats.estimatedRows ?? estimatedRowsAfterFilter
      const limitOp = this.buildLimitOperation(query.limit, query.offset, inputRows)
      operations.push(limitOp)
    }

    // Calculate final estimates
    const finalOp = operations[operations.length - 1]
    const estimatedRows = finalOp?.stats.estimatedRows ?? 0
    const estimatedCost = operations.reduce((sum, op) => sum + op.cost.totalCost, 0)

    return {
      operations,
      estimatedRows,
      estimatedCost,
      partitionsPruned,
      columnsPruned,
    }
  }

  /**
   * Estimate the cost of a query plan
   */
  estimateCost(plan: QueryPlan): CostEstimate {
    let cpuCost = 0
    let ioCost = 0
    let memoryCost = 0

    for (const op of plan.operations) {
      cpuCost += op.cost.cpuCost
      ioCost += op.cost.ioCost
      memoryCost += op.cost.memoryCost
    }

    const totalCost = this.calculateTotalCost(cpuCost, ioCost, memoryCost)

    return {
      totalCost,
      cpuCost,
      ioCost,
      memoryCost,
    }
  }

  /**
   * Generate human-readable EXPLAIN output
   */
  explain(plan: QueryPlan, options: ExplainOptions = {}): string {
    const format = options.format ?? 'default'

    switch (format) {
      case 'json':
        return JSON.stringify(this.planToJson(plan), null, 2)
      case 'tree':
        return this.formatTreeExplain(plan)
      case 'verbose':
        return this.formatVerboseExplain(plan)
      default:
        return this.formatDefaultExplain(plan)
    }
  }

  // =========================================================================
  // Private: Partition Pruning
  // =========================================================================

  /**
   * Prune partitions based on filter predicates
   */
  private prunePartitions(
    filters: Predicate[],
    partitions: PartitionStats[]
  ): { prunedPartitions: PartitionStats[]; remainingPartitions: PartitionStats[] } {
    if (filters.length === 0) {
      return { prunedPartitions: [], remainingPartitions: partitions }
    }

    const prunedPartitions: PartitionStats[] = []
    const remainingPartitions: PartitionStats[] = []

    for (const partition of partitions) {
      if (this.canPrunePartition(partition, filters)) {
        prunedPartitions.push(partition)
      } else {
        remainingPartitions.push(partition)
      }
    }

    return { prunedPartitions, remainingPartitions }
  }

  /**
   * Check if a partition can be pruned based on filters
   */
  private canPrunePartition(partition: PartitionStats, filters: Predicate[]): boolean {
    for (const filter of filters) {
      const columnStats = partition.columns.get(filter.column)

      if (!columnStats) {
        // No stats for this column, can't prune
        continue
      }

      // Check if filter can prune this partition
      if (this.predicatePrunesPartition(filter, columnStats, partition.bloomFilter)) {
        return true
      }
    }

    return false
  }

  /**
   * Check if a predicate prunes a partition
   */
  private predicatePrunesPartition(
    predicate: Predicate,
    columnStats: ColumnStats,
    bloomFilter: BloomFilter | null
  ): boolean {
    const { minValue, maxValue } = columnStats

    // Check bloom filter for equality predicates
    if (
      predicate.op === '=' &&
      this.config.enableBloomFilter &&
      bloomFilter?.column === predicate.column
    ) {
      if (!bloomFilter.contains(predicate.value)) {
        return true // Bloom filter says value definitely not in partition
      }
    }

    switch (predicate.op) {
      case '=':
        // Value must be in range
        return !this.isInRange(predicate.value, minValue, maxValue)

      case '!=':
        // Can prune if partition contains only the excluded value
        return minValue === maxValue && minValue === predicate.value

      case '>':
        // Prune if max value is <= predicate value
        return this.compare(maxValue, predicate.value) <= 0

      case '<':
        // Prune if min value is >= predicate value
        return this.compare(minValue, predicate.value) >= 0

      case '>=':
        // Prune if max value is < predicate value
        return this.compare(maxValue, predicate.value) < 0

      case '<=':
        // Prune if min value is > predicate value
        return this.compare(minValue, predicate.value) > 0

      case 'between': {
        const [rangeMin, rangeMax] = predicate.value as [unknown, unknown]
        // Prune if partition range doesn't overlap with predicate range
        return (
          this.compare(maxValue, rangeMin) < 0 || this.compare(minValue, rangeMax) > 0
        )
      }

      case 'in': {
        const values = predicate.value as unknown[]
        // Prune if none of the values fall in partition range
        return values.every((v) => !this.isInRange(v, minValue, maxValue))
      }

      default:
        return false
    }
  }

  /**
   * Check if a value is within a range
   */
  private isInRange(value: unknown, minValue: unknown, maxValue: unknown): boolean {
    return this.compare(value, minValue) >= 0 && this.compare(value, maxValue) <= 0
  }

  /**
   * Compare two values
   */
  private compare(a: unknown, b: unknown): number {
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b)
    }
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime()
    }
    // Fallback to string comparison
    return String(a).localeCompare(String(b))
  }

  // =========================================================================
  // Private: Column Pruning
  // =========================================================================

  /**
   * Compute columns needed for the query
   */
  private computeNeededColumns(query: AnalyticsQuery, stats: TableStats): Set<string> {
    const needed = new Set<string>()

    // Add selected columns
    if (!query.select.includes('*')) {
      query.select.forEach((col) => needed.add(col))
    } else {
      // Select * means all columns
      stats.columns.forEach((col) => needed.add(col.name))
    }

    // Add filter columns
    query.filters.forEach((f) => needed.add(f.column))

    // Add group by columns
    query.groupBy.forEach((col) => needed.add(col))

    // Add aggregate columns
    Object.values(query.aggregates).forEach((agg) => {
      if (agg.column) {
        needed.add(agg.column)
      }
    })

    // Add order by columns
    query.orderBy.forEach((o) => needed.add(o.column))

    return needed
  }

  // =========================================================================
  // Private: Cost Estimation
  // =========================================================================

  /**
   * Estimate filter selectivity
   */
  private estimateFilterSelectivity(filters: Predicate[], stats: TableStats): number {
    if (filters.length === 0) {
      return 1.0
    }

    let selectivity = 1.0

    for (const filter of filters) {
      const columnStats = stats.columns.find((c) => c.name === filter.column)
      const filterSelectivity = this.estimateSingleFilterSelectivity(filter, columnStats)
      selectivity *= filterSelectivity
    }

    return Math.max(0.0001, selectivity) // Minimum selectivity
  }

  /**
   * Estimate selectivity of a single filter
   */
  private estimateSingleFilterSelectivity(
    filter: Predicate,
    columnStats: ColumnStats | undefined
  ): number {
    if (!columnStats) {
      return COST_WEIGHTS.FILTER_SELECTIVITY_DEFAULT
    }

    const distinctCount = Math.max(1, columnStats.distinctCount)

    switch (filter.op) {
      case '=':
        return 1 / distinctCount

      case '!=':
        return (distinctCount - 1) / distinctCount

      case '>':
      case '<':
      case '>=':
      case '<=':
        return COST_WEIGHTS.RANGE_SELECTIVITY

      case 'between':
        return COST_WEIGHTS.RANGE_SELECTIVITY * 0.5

      case 'in': {
        const values = filter.value as unknown[]
        return Math.min(1.0, values.length / distinctCount)
      }

      default:
        return COST_WEIGHTS.FILTER_SELECTIVITY_DEFAULT
    }
  }

  /**
   * Calculate total cost from components
   */
  private calculateTotalCost(cpuCost: number, ioCost: number, memoryCost: number): number {
    switch (this.config.costModel) {
      case 'io-based':
        return ioCost + cpuCost * 0.1 + memoryCost * 0.1
      case 'cpu-based':
        return cpuCost + ioCost * 0.5 + memoryCost * 0.1
      default:
        return (
          cpuCost * COST_WEIGHTS.CPU_WEIGHT +
          ioCost * COST_WEIGHTS.IO_WEIGHT +
          memoryCost * COST_WEIGHTS.MEMORY_WEIGHT
        )
    }
  }

  // =========================================================================
  // Private: Plan Node Builders
  // =========================================================================

  /**
   * Build scan operation
   */
  private buildScanOperation(
    query: AnalyticsQuery,
    stats: TableStats,
    partitions: PartitionStats[],
    neededColumns: Set<string>
  ): PlanNode {
    const totalRows = partitions.reduce((sum, p) => sum + p.rowCount, 0)
    const totalBytes = partitions.reduce((sum, p) => sum + p.sizeBytes, 0)

    // IO cost based on bytes read
    const ioCost = totalBytes / 1024 // Cost per KB

    // CPU cost for scanning rows
    const cpuCost = totalRows * 0.001

    // Determine pushdown predicates (simple predicates can be pushed)
    const pushdownPredicates = query.filters.filter(
      (f) => ['=', '!=', '>', '<', '>=', '<=', 'between', 'in'].includes(f.op)
    )

    // Determine partial aggregates that can be pushed
    const partialAggregates: AggregateSpec[] = []
    for (const [, spec] of Object.entries(query.aggregates)) {
      if (['sum', 'count', 'min', 'max'].includes(spec.type)) {
        partialAggregates.push(spec)
      }
    }

    return {
      type: 'scan',
      inputs: [],
      cost: {
        totalCost: this.calculateTotalCost(cpuCost, ioCost, 0),
        cpuCost,
        ioCost,
        memoryCost: 0,
      },
      stats: {
        estimatedRows: totalRows,
        estimatedBytes: totalBytes,
      },
      columns: Array.from(neededColumns),
      pushdownPredicates,
      partialAggregates: partialAggregates.length > 0 ? partialAggregates : undefined,
    }
  }

  /**
   * Build filter operation
   */
  private buildFilterOperation(predicates: Predicate[], inputRows: number): PlanNode {
    // Estimate output rows based on selectivity
    const selectivity = predicates.reduce((sel, pred) => {
      return sel * this.estimateSingleFilterSelectivity(pred, undefined)
    }, 1.0)

    const outputRows = Math.max(1, Math.floor(inputRows * selectivity))
    const cpuCost = inputRows * 0.0001 * predicates.length

    return {
      type: 'filter',
      inputs: [],
      cost: {
        totalCost: cpuCost,
        cpuCost,
        ioCost: 0,
        memoryCost: 0,
      },
      stats: {
        estimatedRows: outputRows,
        estimatedBytes: outputRows * COST_WEIGHTS.BYTES_PER_ROW,
      },
      predicates,
    }
  }

  /**
   * Build aggregate operation
   */
  private buildAggregateOperation(
    query: AnalyticsQuery,
    inputRows: number,
    stats: TableStats
  ): PlanNode {
    // Estimate output rows based on grouping
    let outputRows: number
    if (query.groupBy.length === 0) {
      outputRows = 1 // Global aggregation
    } else {
      // Estimate based on group by cardinality
      let cardinality = 1
      for (const col of query.groupBy) {
        const colStats = stats.columns.find((c) => c.name === col)
        if (colStats) {
          cardinality *= Math.min(colStats.distinctCount, inputRows)
        }
      }
      outputRows = Math.min(cardinality, inputRows)
    }

    // CPU cost for aggregation
    const aggCount = Object.keys(query.aggregates).length
    const cpuCost = inputRows * 0.001 * Math.max(1, aggCount)

    // Memory cost for hash tables
    const memoryCost = outputRows * 0.01

    return {
      type: 'aggregate',
      inputs: [],
      cost: {
        totalCost: this.calculateTotalCost(cpuCost, 0, memoryCost),
        cpuCost,
        ioCost: 0,
        memoryCost,
      },
      stats: {
        estimatedRows: outputRows,
        estimatedBytes: outputRows * COST_WEIGHTS.BYTES_PER_ROW,
      },
      groupBy: query.groupBy,
      aggregates: query.aggregates,
    }
  }

  /**
   * Build sort operation
   */
  private buildSortOperation(orderBy: OrderSpec[], inputRows: number): PlanNode {
    // Sort cost is O(n log n)
    const cpuCost = inputRows * Math.log2(Math.max(2, inputRows)) * 0.001
    const memoryCost = inputRows * 0.01

    return {
      type: 'sort',
      inputs: [],
      cost: {
        totalCost: this.calculateTotalCost(cpuCost, 0, memoryCost),
        cpuCost,
        ioCost: 0,
        memoryCost,
      },
      stats: {
        estimatedRows: inputRows,
        estimatedBytes: inputRows * COST_WEIGHTS.BYTES_PER_ROW,
      },
      orderBy,
    }
  }

  /**
   * Build limit operation
   */
  private buildLimitOperation(
    limit: number | undefined,
    offset: number | undefined,
    inputRows: number
  ): PlanNode {
    const effectiveOffset = offset ?? 0
    const effectiveLimit = limit ?? inputRows
    const outputRows = Math.max(0, Math.min(effectiveLimit, inputRows - effectiveOffset))

    return {
      type: 'limit',
      inputs: [],
      cost: {
        totalCost: 0.001,
        cpuCost: 0.001,
        ioCost: 0,
        memoryCost: 0,
      },
      stats: {
        estimatedRows: outputRows,
        estimatedBytes: outputRows * COST_WEIGHTS.BYTES_PER_ROW,
      },
      limit,
      offset,
    }
  }

  // =========================================================================
  // Private: EXPLAIN Formatters
  // =========================================================================

  /**
   * Default EXPLAIN format
   */
  private formatDefaultExplain(plan: QueryPlan): string {
    const lines: string[] = []
    lines.push('Query Plan')
    lines.push('='.repeat(60))

    for (const op of plan.operations) {
      const costStr = `cost: ${op.cost.totalCost.toFixed(2)}`
      const rowsStr = `rows: ${op.stats.estimatedRows}`

      switch (op.type) {
        case 'scan':
          lines.push(`Scan: ${op.columns?.length ?? 0} columns (${costStr}, ${rowsStr})`)
          if (op.pushdownPredicates && op.pushdownPredicates.length > 0) {
            lines.push(`  Pushdown: ${op.pushdownPredicates.length} predicates`)
          }
          if (op.partialAggregates && op.partialAggregates.length > 0) {
            lines.push(`  Partial Aggregates: ${op.partialAggregates.map((a) => a.type).join(', ')}`)
          }
          break

        case 'filter':
          lines.push(`Filter: ${op.predicates?.length ?? 0} predicates (${costStr}, ${rowsStr})`)
          break

        case 'aggregate':
          const aggTypes = Object.values(op.aggregates ?? {}).map((a) => a.type)
          lines.push(
            `Aggregate: ${op.groupBy?.length ?? 0} groups, ${aggTypes.length} aggs (${costStr}, ${rowsStr})`
          )
          break

        case 'sort':
          const orderStr = op.orderBy?.map((o) => `${o.column} ${o.direction}`).join(', ')
          lines.push(`Sort: [${orderStr}] (${costStr}, ${rowsStr})`)
          break

        case 'limit':
          lines.push(`Limit: ${op.limit}${op.offset ? ` offset ${op.offset}` : ''} (${rowsStr})`)
          break

        default:
          lines.push(`${op.type}: (${costStr}, ${rowsStr})`)
      }
    }

    lines.push('='.repeat(60))
    lines.push(`Partition pruning: ${plan.partitionsPruned} partitions pruned`)
    lines.push(`Column pruning: ${plan.columnsPruned} columns pruned`)
    lines.push(`Estimated rows: ${plan.estimatedRows}`)
    lines.push(`Estimated cost: ${plan.estimatedCost.toFixed(2)}`)

    return lines.join('\n')
  }

  /**
   * Verbose EXPLAIN format
   */
  private formatVerboseExplain(plan: QueryPlan): string {
    const lines: string[] = []
    lines.push('Query Plan (Verbose)')
    lines.push('='.repeat(80))

    for (let i = 0; i < plan.operations.length; i++) {
      const op = plan.operations[i]!
      lines.push(`\nOperation ${i + 1}: ${op.type.toUpperCase()}`)
      lines.push('-'.repeat(40))

      // Cost breakdown
      lines.push(`Cost Breakdown:`)
      lines.push(`  CPU Cost:    ${op.cost.cpuCost.toFixed(4)}`)
      lines.push(`  IO Cost:     ${op.cost.ioCost.toFixed(4)}`)
      lines.push(`  Memory Cost: ${op.cost.memoryCost.toFixed(4)}`)
      lines.push(`  Total Cost:  ${op.cost.totalCost.toFixed(4)}`)

      // Statistics
      lines.push(`Statistics:`)
      lines.push(`  Estimated Rows:  ${op.stats.estimatedRows}`)
      lines.push(`  Estimated Bytes: ${op.stats.estimatedBytes}`)

      // Type-specific details
      if (op.type === 'scan') {
        lines.push(`Scan Details:`)
        lines.push(`  Columns: [${op.columns?.join(', ')}]`)
        if (op.pushdownPredicates?.length) {
          lines.push(`  Pushed Predicates:`)
          op.pushdownPredicates.forEach((p) => {
            lines.push(`    - ${p.column} ${p.op} ${JSON.stringify(p.value)}`)
          })
        }
        if (op.partialAggregates?.length) {
          lines.push(`  Partial Aggregates:`)
          op.partialAggregates.forEach((a) => {
            lines.push(`    - ${a.type}(${a.column ?? '*'})`)
          })
        }
      } else if (op.type === 'filter') {
        lines.push(`Filter Details:`)
        op.predicates?.forEach((p) => {
          lines.push(`  - ${p.column} ${p.op} ${JSON.stringify(p.value)}`)
        })
      } else if (op.type === 'aggregate') {
        lines.push(`Aggregate Details:`)
        lines.push(`  Group By: [${op.groupBy?.join(', ')}]`)
        lines.push(`  Aggregates:`)
        Object.entries(op.aggregates ?? {}).forEach(([name, spec]) => {
          lines.push(`    - ${name}: ${spec.type}(${spec.column ?? '*'})`)
        })
      } else if (op.type === 'sort') {
        lines.push(`Sort Details:`)
        op.orderBy?.forEach((o) => {
          lines.push(`  - ${o.column} ${o.direction}`)
        })
      } else if (op.type === 'limit') {
        lines.push(`Limit Details:`)
        lines.push(`  Limit:  ${op.limit ?? 'none'}`)
        lines.push(`  Offset: ${op.offset ?? 0}`)
      }
    }

    lines.push('\n' + '='.repeat(80))
    lines.push('Summary:')
    lines.push(`  Partitions Pruned: ${plan.partitionsPruned}`)
    lines.push(`  Columns Pruned:    ${plan.columnsPruned}`)
    lines.push(`  Final Row Estimate: ${plan.estimatedRows}`)
    lines.push(`  Total Cost:         ${plan.estimatedCost.toFixed(4)}`)

    return lines.join('\n')
  }

  /**
   * Tree-style EXPLAIN format
   */
  private formatTreeExplain(plan: QueryPlan): string {
    const lines: string[] = []
    lines.push('Query Plan (Tree)')
    lines.push('')

    const indent = '  '
    for (let i = plan.operations.length - 1; i >= 0; i--) {
      const op = plan.operations[i]!
      const depth = plan.operations.length - 1 - i
      const prefix = indent.repeat(depth) + (depth > 0 ? '-> ' : '')

      const costStr = `cost=${op.cost.totalCost.toFixed(2)}`
      const rowsStr = `rows=${op.stats.estimatedRows}`

      let opDesc = ''
      switch (op.type) {
        case 'scan':
          opDesc = `Scan [${op.columns?.slice(0, 3).join(', ')}${(op.columns?.length ?? 0) > 3 ? '...' : ''}]`
          break
        case 'filter':
          opDesc = `Filter (${op.predicates?.length ?? 0} predicates)`
          break
        case 'aggregate':
          opDesc = `Aggregate [${op.groupBy?.join(', ')}]`
          break
        case 'sort':
          opDesc = `Sort [${op.orderBy?.map((o) => o.column).join(', ')}]`
          break
        case 'limit':
          opDesc = `Limit ${op.limit}`
          break
        default:
          opDesc = op.type
      }

      lines.push(`${prefix}${opDesc} (${costStr}, ${rowsStr})`)
    }

    lines.push('')
    lines.push(`Partition pruning: ${plan.partitionsPruned} pruned`)
    lines.push(`Estimated total cost: ${plan.estimatedCost.toFixed(2)}`)

    return lines.join('\n')
  }

  /**
   * Convert plan to JSON-serializable object
   */
  private planToJson(plan: QueryPlan): object {
    return {
      operations: plan.operations.map((op) => ({
        type: op.type,
        cost: op.cost,
        stats: op.stats,
        columns: op.columns,
        pushdownPredicates: op.pushdownPredicates?.map((p) => ({
          column: p.column,
          op: p.op,
          value: p.value,
        })),
        partialAggregates: op.partialAggregates?.map((a) => ({
          type: a.type,
          column: a.column,
        })),
        predicates: op.predicates?.map((p) => ({
          column: p.column,
          op: p.op,
          value: p.value,
        })),
        groupBy: op.groupBy,
        aggregates: op.aggregates,
        orderBy: op.orderBy,
        limit: op.limit,
        offset: op.offset,
      })),
      summary: {
        estimatedRows: plan.estimatedRows,
        estimatedCost: plan.estimatedCost,
        partitionsPruned: plan.partitionsPruned,
        columnsPruned: plan.columnsPruned,
      },
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new QueryPlanner instance
 */
export function createQueryPlanner(config?: QueryPlannerConfig): QueryPlanner {
  return new QueryPlannerImpl(config)
}
