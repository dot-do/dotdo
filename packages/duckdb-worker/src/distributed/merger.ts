/**
 * Result Merger for Distributed Query Layer
 *
 * The merger is responsible for:
 * 1. Combining partial aggregates from data workers (SUM, COUNT, AVG, MIN, MAX)
 * 2. Handling grouped aggregates by merging per group key
 * 3. Applying global ORDER BY after merging
 * 4. Applying LIMIT after sorting
 * 5. Streaming large results
 *
 * @module packages/duckdb-worker/src/distributed/merger
 */

import type {
  PartialResult,
  PartialAggregate,
  MergedResult,
  QueryStats,
  SortSpec,
  ColumnMeta,
  AggregateFunction,
} from './types.js'

// ============================================================================
// Merge Options
// ============================================================================

interface MergeOptions {
  /** ORDER BY specification for global sorting */
  orderBy?: SortSpec[]

  /** LIMIT to apply after sorting */
  limit?: number

  /** Whether to stream results */
  stream?: boolean
}

// ============================================================================
// Result Merger Implementation
// ============================================================================

/**
 * Result Merger for combining partial results from data workers
 *
 * Handles the complex logic of merging partial aggregates,
 * particularly for AVG which requires weighted averaging.
 */
export class ResultMerger {
  /**
   * Merge partial results from multiple workers
   */
  merge(partials: PartialResult[], options: MergeOptions = {}): MergedResult {
    // Handle empty input
    if (partials.length === 0) {
      return {
        rows: [],
        columns: [],
        rowCount: 0,
        stats: this.emptyStats(),
      }
    }

    // Get columns from first partial (all should have same schema)
    const columns = partials[0].columns

    // Check if we're dealing with aggregates
    const hasAggregates = partials.some((p) => p.aggregates.size > 0)

    let rows: Record<string, unknown>[]

    if (hasAggregates) {
      // Merge aggregates
      rows = this.mergeAggregates(partials)
    } else {
      // Concatenate rows
      rows = this.mergeRows(partials)
    }

    // Apply ORDER BY if specified
    if (options.orderBy && options.orderBy.length > 0) {
      rows = this.sortRows(rows, options.orderBy)
    }

    // Apply LIMIT if specified
    if (options.limit !== undefined && options.limit > 0) {
      rows = rows.slice(0, options.limit)
    }

    return {
      rows,
      columns,
      rowCount: rows.length,
      stats: this.emptyStats(), // Stats will be filled by DistributedQuery
    }
  }

  /**
   * Merge aggregated results
   */
  private mergeAggregates(partials: PartialResult[]): Record<string, unknown>[] {
    // Collect all aggregates by group key
    const mergedGroups = new Map<string, Map<string, MergeableAggregate>>()

    for (const partial of partials) {
      for (const [groupKey, aggregates] of partial.aggregates) {
        if (!mergedGroups.has(groupKey)) {
          mergedGroups.set(groupKey, new Map())
        }

        const groupAggs = mergedGroups.get(groupKey)!

        for (const agg of aggregates) {
          if (!groupAggs.has(agg.alias)) {
            groupAggs.set(agg.alias, {
              fn: agg.fn,
              alias: agg.alias,
              values: [],
              counts: [],
            })
          }

          const merged = groupAggs.get(agg.alias)!
          merged.values.push(agg.value)
          if (agg.count !== undefined) {
            merged.counts.push(agg.count)
          }
        }
      }
    }

    // Compute final values for each group
    const rows: Record<string, unknown>[] = []

    for (const [groupKey, aggregates] of mergedGroups) {
      const row: Record<string, unknown> = {}

      // Parse group key to get group by columns
      if (groupKey !== '__global__') {
        const groupValues = JSON.parse(groupKey) as Record<string, unknown>
        Object.assign(row, groupValues)
      }

      // Compute final aggregate values
      for (const [alias, merged] of aggregates) {
        row[alias] = this.computeFinalValue(merged)
      }

      rows.push(row)
    }

    return rows
  }

  /**
   * Compute final aggregate value from merged partial values
   */
  private computeFinalValue(merged: MergeableAggregate): unknown {
    const nonNullValues = merged.values.filter((v) => v !== null && v !== undefined) as number[]

    if (nonNullValues.length === 0) {
      return null
    }

    switch (merged.fn) {
      case 'SUM':
      case 'COUNT':
        // Sum all partial values
        return nonNullValues.reduce((sum, v) => sum + v, 0)

      case 'AVG':
        // Weighted average: sum(value * count) / sum(count)
        if (merged.counts.length !== nonNullValues.length) {
          // Fallback to simple average if counts not available
          return nonNullValues.reduce((sum, v) => sum + v, 0) / nonNullValues.length
        }

        let totalSum = 0
        let totalCount = 0
        for (let i = 0; i < nonNullValues.length; i++) {
          const count = merged.counts[i] || 1
          totalSum += nonNullValues[i] * count
          totalCount += count
        }

        return totalCount > 0 ? totalSum / totalCount : null

      case 'MIN':
        return Math.min(...nonNullValues)

      case 'MAX':
        return Math.max(...nonNullValues)

      case 'COUNT_DISTINCT':
        // For COUNT_DISTINCT, we can only get an approximate result
        // by summing partial counts. True distributed COUNT_DISTINCT
        // would require HyperLogLog or similar
        return nonNullValues.reduce((sum, v) => sum + v, 0)

      default:
        // Unknown function, return first value
        return nonNullValues[0]
    }
  }

  /**
   * Merge non-aggregated rows
   */
  private mergeRows(partials: PartialResult[]): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = []

    for (const partial of partials) {
      rows.push(...partial.rows)
    }

    return rows
  }

  /**
   * Sort rows by ORDER BY specification
   */
  private sortRows(rows: Record<string, unknown>[], orderBy: SortSpec[]): Record<string, unknown>[] {
    return rows.sort((a, b) => {
      for (const spec of orderBy) {
        const aVal = a[spec.column]
        const bVal = b[spec.column]

        // Handle nulls
        if (aVal === null || aVal === undefined) {
          if (bVal === null || bVal === undefined) {
            continue // Both null, check next column
          }
          // a is null, b is not
          return spec.nulls === 'FIRST' ? -1 : 1
        }
        if (bVal === null || bVal === undefined) {
          // b is null, a is not
          return spec.nulls === 'FIRST' ? 1 : -1
        }

        // Compare non-null values
        let comparison: number
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal
        } else if (typeof aVal === 'string' && typeof bVal === 'string') {
          comparison = aVal.localeCompare(bVal)
        } else {
          comparison = String(aVal).localeCompare(String(bVal))
        }

        if (comparison !== 0) {
          return spec.direction === 'DESC' ? -comparison : comparison
        }
      }

      return 0 // All columns equal
    })
  }

  /**
   * Create empty stats object
   */
  private emptyStats(): QueryStats {
    return {
      totalPartitions: 0,
      prunedPartitions: 0,
      scannedPartitions: 0,
      bytesScanned: 0,
      rowsProcessed: 0,
      planningTimeMs: 0,
      executionTimeMs: 0,
      workerStats: [],
    }
  }
}

// ============================================================================
// Helper Types
// ============================================================================

interface MergeableAggregate {
  fn: AggregateFunction
  alias: string
  values: unknown[]
  counts: number[]
}

// ============================================================================
// Streaming Merger
// ============================================================================

/**
 * Streaming result merger for large results
 *
 * Uses an async generator to yield results incrementally
 * without loading everything into memory.
 */
export class StreamingResultMerger {
  /**
   * Merge partial results as a stream
   */
  async *mergeStream(
    partials: AsyncIterable<PartialResult>,
    options: MergeOptions = {}
  ): AsyncGenerator<Record<string, unknown>[], void, unknown> {
    // For non-aggregate streaming, we can yield rows incrementally
    if (!options.orderBy && !options.limit) {
      for await (const partial of partials) {
        if (partial.rows.length > 0) {
          yield partial.rows
        }
      }
      return
    }

    // For sorted/limited results, we need to collect all first
    const collected: PartialResult[] = []
    for await (const partial of partials) {
      collected.push(partial)
    }

    const merger = new ResultMerger()
    const result = merger.merge(collected, options)

    // Yield in chunks
    const chunkSize = 1000
    for (let i = 0; i < result.rows.length; i += chunkSize) {
      yield result.rows.slice(i, i + chunkSize)
    }
  }
}

// ============================================================================
// Top-N Merger
// ============================================================================

/**
 * Specialized merger for Top-N queries
 *
 * Maintains a bounded heap to efficiently merge sorted results
 * from multiple partitions without loading all data.
 */
export class TopNMerger {
  private readonly limit: number
  private readonly orderBy: SortSpec[]

  constructor(limit: number, orderBy: SortSpec[]) {
    this.limit = limit
    this.orderBy = orderBy
  }

  /**
   * Merge top-N results from multiple partitions
   *
   * Uses a min/max heap depending on sort direction
   * to maintain only the top N results in memory.
   */
  merge(partials: PartialResult[]): Record<string, unknown>[] {
    // Simple approach: collect all, sort, limit
    // For production, use a proper heap data structure
    const allRows: Record<string, unknown>[] = []

    for (const partial of partials) {
      // For grouped aggregates
      if (partial.aggregates.size > 0) {
        const merger = new ResultMerger()
        const merged = merger.merge([partial])
        allRows.push(...merged.rows)
      } else {
        allRows.push(...partial.rows)
      }
    }

    // Sort all rows
    const sorted = this.sortRows(allRows)

    // Return top N
    return sorted.slice(0, this.limit)
  }

  /**
   * Sort rows by ORDER BY specification
   */
  private sortRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return rows.sort((a, b) => {
      for (const spec of this.orderBy) {
        const aVal = a[spec.column]
        const bVal = b[spec.column]

        if (aVal === null || aVal === undefined) {
          if (bVal === null || bVal === undefined) continue
          return spec.nulls === 'FIRST' ? -1 : 1
        }
        if (bVal === null || bVal === undefined) {
          return spec.nulls === 'FIRST' ? 1 : -1
        }

        let comparison: number
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal
        } else {
          comparison = String(aVal).localeCompare(String(bVal))
        }

        if (comparison !== 0) {
          return spec.direction === 'DESC' ? -comparison : comparison
        }
      }
      return 0
    })
  }
}
