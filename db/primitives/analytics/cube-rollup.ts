/**
 * CUBE/ROLLUP Operations for TypedColumnStore
 *
 * Multi-dimensional OLAP aggregation operations optimized for columnar storage.
 * Implements SQL CUBE and ROLLUP semantics for generating multiple grouping sets.
 *
 * Key features:
 * - CUBE: Generate all 2^n combinations of dimensions
 * - ROLLUP: Generate hierarchical n+1 grouping sets
 * - groupingId: Bitmask to identify which dimensions are aggregated
 * - Optimized for TypedColumnStore's columnar access patterns
 *
 * @see https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-GROUPING-SETS
 * @module db/primitives/analytics/cube-rollup
 */

import type { TypedColumnStore, AggregateFunction } from '../typed-column-store'

// ============================================================================
// Types
// ============================================================================

/**
 * A grouping set defines which columns to group by.
 * Empty columns array represents the grand total.
 */
export interface GroupingSet {
  columns: string[]
}

/**
 * Definition of an aggregate to compute.
 */
export interface AggregateDefinition {
  /** Output field name */
  name: string
  /** Column to aggregate */
  column: string
  /** Aggregation function */
  fn: AggregateFunction
}

/**
 * Result of a grouped aggregation.
 */
export interface GroupedResult {
  /** Key values for this group (undefined for aggregated dimensions) */
  keys: Record<string, unknown>
  /** Computed aggregate values */
  aggregates: Record<string, number>
  /** Bitmask indicating which dimensions are aggregated (1 = aggregated) */
  groupingId: number
}

/**
 * CUBE/ROLLUP operations interface.
 */
export interface CubeOperations {
  /**
   * Generate all 2^n grouping sets for CUBE.
   * CUBE(a, b, c) = all combinations: (a,b,c), (a,b), (a,c), (b,c), (a), (b), (c), ()
   */
  cube(columns: string[]): GroupingSet[]

  /**
   * Generate n+1 hierarchical grouping sets for ROLLUP.
   * ROLLUP(a, b, c) = (a,b,c), (a,b), (a), ()
   */
  rollup(columns: string[]): GroupingSet[]

  /**
   * Execute aggregation with grouping sets on a TypedColumnStore.
   */
  aggregate(
    store: TypedColumnStore,
    groupingSets: GroupingSet[],
    aggregates: AggregateDefinition[]
  ): GroupedResult[]
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate the power set (all subsets) of an array.
 * Used for CUBE to generate all 2^n combinations.
 */
function powerSet<T>(arr: T[]): T[][] {
  const result: T[][] = [[]]

  for (const item of arr) {
    const len = result.length
    for (let i = 0; i < len; i++) {
      result.push([...result[i]!, item])
    }
  }

  return result
}

/**
 * Generate hierarchical prefixes for ROLLUP.
 * ROLLUP(a, b, c) = [a,b,c], [a,b], [a], []
 */
function rollupPrefixes<T>(arr: T[]): T[][] {
  const result: T[][] = []

  // Add prefixes from longest to shortest
  for (let i = arr.length; i >= 0; i--) {
    result.push(arr.slice(0, i))
  }

  return result
}

/**
 * Calculate groupingId bitmask for a grouping set.
 * Each bit represents whether a dimension is aggregated (1) or grouped (0).
 *
 * For dimensions [a, b, c]:
 * - (a, b, c) -> 0b000 = 0 (none aggregated)
 * - (a, b)    -> 0b001 = 1 (c aggregated)
 * - (a)       -> 0b011 = 3 (b, c aggregated)
 * - ()        -> 0b111 = 7 (all aggregated)
 */
function calculateGroupingId(allDimensions: string[], activeDimensions: string[]): number {
  let id = 0
  const activeSet = new Set(activeDimensions)

  for (let i = 0; i < allDimensions.length; i++) {
    if (!activeSet.has(allDimensions[i]!)) {
      // Dimension is aggregated (not in active set)
      // Set bit at position (n - 1 - i) where n is total dimensions
      id |= 1 << (allDimensions.length - 1 - i)
    }
  }

  return id
}

/**
 * Generate a composite key string for grouping.
 */
function generateGroupKey(values: unknown[]): string {
  return JSON.stringify(values)
}

// ============================================================================
// Implementation
// ============================================================================

class CubeOperationsImpl implements CubeOperations {
  cube(columns: string[]): GroupingSet[] {
    const allSubsets = powerSet(columns)

    // Convert to GroupingSet format and sort by length (most specific first)
    return allSubsets
      .map(subset => ({ columns: subset }))
      .sort((a, b) => b.columns.length - a.columns.length)
  }

  rollup(columns: string[]): GroupingSet[] {
    const prefixes = rollupPrefixes(columns)

    // Already sorted longest to shortest
    return prefixes.map(prefix => ({ columns: prefix }))
  }

  aggregate(
    store: TypedColumnStore,
    groupingSets: GroupingSet[],
    aggregates: AggregateDefinition[]
  ): GroupedResult[] {
    // Get all unique dimensions across all grouping sets
    const allDimensions = [...new Set(groupingSets.flatMap(gs => gs.columns))]

    // Project all needed columns from the store
    const neededColumns = [
      ...allDimensions,
      ...aggregates.map(a => a.column),
    ]
    const uniqueColumns = [...new Set(neededColumns)]

    let batch
    try {
      batch = store.project(uniqueColumns)
    } catch {
      // If projection fails (e.g., column doesn't exist), return empty
      return []
    }

    const rowCount = batch.rowCount

    // Handle empty store
    if (rowCount === 0) {
      // Return one result per grouping set with default values
      return groupingSets.map(gs => ({
        keys: {},
        aggregates: Object.fromEntries(
          aggregates.map(a => [a.name, a.fn === 'count' ? 0 : 0])
        ),
        groupingId: calculateGroupingId(allDimensions, gs.columns),
      }))
    }

    // Get column data
    const columnData = new Map<string, unknown[]>()
    for (const col of uniqueColumns) {
      columnData.set(col, batch.columns.get(col) || [])
    }

    // Process each grouping set
    const results: GroupedResult[] = []

    for (const groupingSet of groupingSets) {
      const groupingId = calculateGroupingId(allDimensions, groupingSet.columns)
      const groupResults = this.aggregateGroupingSet(
        columnData,
        rowCount,
        groupingSet.columns,
        aggregates,
        groupingId
      )
      results.push(...groupResults)
    }

    return results
  }

  private aggregateGroupingSet(
    columnData: Map<string, unknown[]>,
    rowCount: number,
    groupByColumns: string[],
    aggregates: AggregateDefinition[],
    groupingId: number
  ): GroupedResult[] {
    // Group rows by the grouping columns
    const groups = new Map<string, {
      keys: Record<string, unknown>
      accumulators: Map<string, AccumulatorState>
    }>()

    // Initialize accumulator state type
    type AccumulatorState = {
      fn: AggregateFunction
      sum: number
      count: number
      min: number
      max: number
    }

    // Process each row
    for (let i = 0; i < rowCount; i++) {
      // Build group key
      const keyValues: unknown[] = []
      const keys: Record<string, unknown> = {}

      for (const col of groupByColumns) {
        const colData = columnData.get(col)
        const value = colData ? colData[i] : undefined
        keyValues.push(value)
        keys[col] = value
      }

      const keyStr = generateGroupKey(keyValues)

      // Get or create group
      if (!groups.has(keyStr)) {
        const accumulators = new Map<string, AccumulatorState>()
        for (const agg of aggregates) {
          accumulators.set(agg.name, {
            fn: agg.fn,
            sum: 0,
            count: 0,
            min: Infinity,
            max: -Infinity,
          })
        }
        groups.set(keyStr, { keys, accumulators })
      }

      const group = groups.get(keyStr)!

      // Update accumulators
      for (const agg of aggregates) {
        const colData = columnData.get(agg.column)
        const value = colData ? colData[i] : undefined
        const acc = group.accumulators.get(agg.name)!

        if (typeof value === 'number') {
          acc.sum += value
          acc.count += 1
          if (value < acc.min) acc.min = value
          if (value > acc.max) acc.max = value
        } else if (agg.fn === 'count') {
          acc.count += 1
        }
      }
    }

    // Handle empty grouping (grand total)
    if (groupByColumns.length === 0 && groups.size === 0) {
      const accumulators = new Map<string, AccumulatorState>()
      for (const agg of aggregates) {
        accumulators.set(agg.name, {
          fn: agg.fn,
          sum: 0,
          count: 0,
          min: Infinity,
          max: -Infinity,
        })
      }

      // Process all rows
      for (let i = 0; i < rowCount; i++) {
        for (const agg of aggregates) {
          const colData = columnData.get(agg.column)
          const value = colData ? colData[i] : undefined
          const acc = accumulators.get(agg.name)!

          if (typeof value === 'number') {
            acc.sum += value
            acc.count += 1
            if (value < acc.min) acc.min = value
            if (value > acc.max) acc.max = value
          } else if (agg.fn === 'count') {
            acc.count += 1
          }
        }
      }

      groups.set('', { keys: {}, accumulators })
    }

    // Convert groups to results
    const results: GroupedResult[] = []

    for (const group of groups.values()) {
      const aggResults: Record<string, number> = {}

      for (const agg of aggregates) {
        const acc = group.accumulators.get(agg.name)!

        switch (agg.fn) {
          case 'sum':
            aggResults[agg.name] = acc.sum
            break
          case 'count':
            aggResults[agg.name] = acc.count
            break
          case 'avg':
            aggResults[agg.name] = acc.count > 0 ? acc.sum / acc.count : 0
            break
          case 'min':
            aggResults[agg.name] = acc.min === Infinity ? 0 : acc.min
            break
          case 'max':
            aggResults[agg.name] = acc.max === -Infinity ? 0 : acc.max
            break
        }
      }

      results.push({
        keys: group.keys,
        aggregates: aggResults,
        groupingId,
      })
    }

    return results
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new CubeOperations instance.
 */
export function createCubeOperations(): CubeOperations {
  return new CubeOperationsImpl()
}
