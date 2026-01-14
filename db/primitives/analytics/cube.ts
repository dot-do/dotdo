/**
 * CUBE/ROLLUP Operations - Multi-dimensional aggregation for OLAP analytics
 *
 * Implements SQL-standard CUBE and ROLLUP operations for multi-dimensional analysis:
 *
 * ROLLUP(a, b, c) generates hierarchical grouping sets:
 *   - (a, b, c) - most detailed
 *   - (a, b)    - first subtotal
 *   - (a)       - higher subtotal
 *   - ()        - grand total
 *
 * CUBE(a, b, c) generates all 2^n grouping set combinations:
 *   - (a, b, c), (a, b), (a, c), (b, c), (a), (b), (c), ()
 *
 * Key features:
 * - groupingId bitmap in results to identify which columns are grouped
 * - Support for multiple aggregate functions (sum, count, avg, min, max)
 * - Type-safe column references
 * - Works with any record type
 *
 * @module db/primitives/analytics/cube
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Supported aggregate functions
 */
export type AggregateFunction = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'first' | 'last'

/**
 * Aggregate specification for a single measure
 */
export interface AggregateSpec {
  /** Column to aggregate */
  column: string
  /** Aggregate function to apply */
  fn: AggregateFunction
  /** Optional alias for the result */
  alias?: string
}

/**
 * A grouping set is an array of column names to group by
 */
export type GroupingSet = string[]

/**
 * Result row from CUBE/ROLLUP operations
 */
export interface CubeResultRow {
  /** The grouped dimension values (null for aggregated dimensions) */
  dimensions: Record<string, unknown>
  /** The aggregated measure values */
  measures: Record<string, number | null>
  /** Bitmap indicating which dimensions are grouped (1 = grouped/aggregated, 0 = not grouped) */
  groupingId: number
  /** Object form of grouping indicators per dimension */
  grouping: Record<string, 0 | 1>
  /** Number of dimensions that are aggregated (rolled up) */
  groupingLevel: number
}

/**
 * Options for CUBE/ROLLUP operations
 */
export interface CubeOptions {
  /** Whether to include the grand total (empty grouping set) */
  includeGrandTotal?: boolean
  /** Sort results by grouping level (most detailed first if true) */
  sortByLevel?: boolean
}

// ============================================================================
// Grouping Set Generators
// ============================================================================

/**
 * Generate CUBE grouping sets (all 2^n combinations)
 *
 * For columns [a, b, c], generates:
 * [], [a], [b], [c], [a,b], [a,c], [b,c], [a,b,c]
 *
 * @param columns - Array of column names
 * @returns All possible subsets of columns (power set)
 */
export function cube(columns: string[]): GroupingSet[] {
  const result: GroupingSet[] = [[]]

  for (const column of columns) {
    const currentLength = result.length
    for (let i = 0; i < currentLength; i++) {
      result.push([...result[i]!, column])
    }
  }

  // Sort by length (most dimensions first, then alphabetically for determinism)
  return result.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length
    return a.join(',').localeCompare(b.join(','))
  })
}

/**
 * Generate ROLLUP grouping sets (hierarchical prefixes)
 *
 * For columns [a, b, c], generates:
 * [a, b, c], [a, b], [a], []
 *
 * @param columns - Array of column names in hierarchical order
 * @returns Hierarchical grouping sets from most to least detailed
 */
export function rollup(columns: string[]): GroupingSet[] {
  const result: GroupingSet[] = []

  // Start with all columns and progressively remove from the end
  for (let i = columns.length; i >= 0; i--) {
    result.push(columns.slice(0, i))
  }

  return result
}

/**
 * Generate a custom list of grouping sets
 *
 * Allows explicit control over which groupings to compute
 *
 * @param sets - Array of grouping sets to compute
 * @returns The provided grouping sets (validated)
 */
export function groupingSets(sets: GroupingSet[]): GroupingSet[] {
  // Validate and deduplicate
  const seen = new Set<string>()
  const result: GroupingSet[] = []

  for (const set of sets) {
    const key = [...set].sort().join(',')
    if (!seen.has(key)) {
      seen.add(key)
      result.push(set)
    }
  }

  return result
}

// ============================================================================
// Grouping ID Calculation
// ============================================================================

/**
 * Calculate the grouping ID bitmap for a given grouping set
 *
 * The grouping ID is a bitmap where each bit represents whether
 * a dimension is aggregated (1) or grouped (0).
 *
 * For dimensions [a, b, c] with active dimensions [a], the bitmap is:
 * - a: bit 2 = 0 (not aggregated, present in active)
 * - b: bit 1 = 1 (aggregated, not in active)
 * - c: bit 0 = 1 (aggregated, not in active)
 * Result: 0b011 = 3
 *
 * @param allDimensions - All dimension columns in order
 * @param activeDimensions - Dimensions that are grouped (not aggregated)
 * @returns Bitmap indicating aggregated dimensions
 */
export function calculateGroupingId(
  allDimensions: string[],
  activeDimensions: string[]
): number {
  const activeSet = new Set(activeDimensions)
  let id = 0

  for (let i = 0; i < allDimensions.length; i++) {
    if (!activeSet.has(allDimensions[i]!)) {
      // This dimension is aggregated, set its bit
      id |= 1 << (allDimensions.length - 1 - i)
    }
  }

  return id
}

/**
 * Calculate grouping indicators as an object
 *
 * @param allDimensions - All dimension columns
 * @param activeDimensions - Dimensions that are grouped
 * @returns Object with 0/1 for each dimension
 */
export function calculateGroupingIndicators(
  allDimensions: string[],
  activeDimensions: string[]
): Record<string, 0 | 1> {
  const activeSet = new Set(activeDimensions)
  const result: Record<string, 0 | 1> = {}

  for (const dim of allDimensions) {
    result[dim] = activeSet.has(dim) ? 0 : 1
  }

  return result
}

/**
 * Calculate the grouping level (number of aggregated dimensions)
 *
 * @param allDimensions - All dimension columns
 * @param activeDimensions - Dimensions that are grouped
 * @returns Number of dimensions that are aggregated
 */
export function calculateGroupingLevel(
  allDimensions: string[],
  activeDimensions: string[]
): number {
  return allDimensions.length - activeDimensions.length
}

// ============================================================================
// Aggregation Helpers
// ============================================================================

/**
 * Get a value from an object by path (supports nested paths like "a.b.c")
 */
function getFieldValue<T>(obj: T, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Initialize accumulator state for an aggregate function
 */
interface AccumulatorState {
  sum: number
  count: number
  min: number | null
  max: number | null
  first: unknown
  last: unknown
  hasFirst: boolean
}

function initAccumulator(): AccumulatorState {
  return {
    sum: 0,
    count: 0,
    min: null,
    max: null,
    first: null,
    last: null,
    hasFirst: false,
  }
}

/**
 * Update accumulator with a new value
 */
function updateAccumulator(state: AccumulatorState, value: unknown): void {
  state.count++

  if (!state.hasFirst) {
    state.first = value
    state.hasFirst = true
  }
  state.last = value

  if (typeof value === 'number' && !isNaN(value)) {
    state.sum += value

    if (state.min === null || value < state.min) {
      state.min = value
    }
    if (state.max === null || value > state.max) {
      state.max = value
    }
  }
}

/**
 * Finalize accumulator to get the result for a specific aggregate function
 */
function finalizeAccumulator(state: AccumulatorState, fn: AggregateFunction): number | null {
  switch (fn) {
    case 'sum':
      return state.sum
    case 'count':
      return state.count
    case 'avg':
      return state.count > 0 ? state.sum / state.count : null
    case 'min':
      return state.min
    case 'max':
      return state.max
    case 'first':
      return typeof state.first === 'number' ? state.first : null
    case 'last':
      return typeof state.last === 'number' ? state.last : null
    default:
      return null
  }
}

// ============================================================================
// Main Aggregation Function
// ============================================================================

/**
 * Execute multi-dimensional aggregation with the specified grouping sets
 *
 * @param data - Array of records to aggregate
 * @param groupingSets - Array of grouping sets to compute
 * @param aggregates - Array of aggregate specifications
 * @param options - Optional configuration
 * @returns Array of result rows with dimensions, measures, and grouping metadata
 */
export function aggregate<T extends Record<string, unknown>>(
  data: T[],
  groupingSets: GroupingSet[],
  aggregates: AggregateSpec[],
  options: CubeOptions = {}
): CubeResultRow[] {
  const { sortByLevel = true } = options

  // Collect all unique dimensions across grouping sets
  const allDimensionsSet = new Set<string>()
  for (const set of groupingSets) {
    for (const dim of set) {
      allDimensionsSet.add(dim)
    }
  }
  const allDimensions = Array.from(allDimensionsSet).sort()

  const results: CubeResultRow[] = []

  // Process each grouping set
  for (const activeDimensions of groupingSets) {
    // Group data by the active dimensions
    const groups = new Map<string, {
      dimensionValues: Record<string, unknown>
      accumulators: Map<string, AccumulatorState>
    }>()

    for (const row of data) {
      // Build the group key from active dimensions
      const keyParts: unknown[] = []
      const dimensionValues: Record<string, unknown> = {}

      for (const dim of allDimensions) {
        if (activeDimensions.includes(dim)) {
          const value = getFieldValue(row, dim)
          dimensionValues[dim] = value
          keyParts.push(value)
        } else {
          dimensionValues[dim] = null
        }
      }

      const keyStr = JSON.stringify(keyParts)

      if (!groups.has(keyStr)) {
        // Initialize accumulators for each aggregate
        const accumulators = new Map<string, AccumulatorState>()
        for (const agg of aggregates) {
          accumulators.set(agg.alias || `${agg.fn}_${agg.column}`, initAccumulator())
        }
        groups.set(keyStr, { dimensionValues, accumulators })
      }

      // Update accumulators
      const group = groups.get(keyStr)!
      for (const agg of aggregates) {
        const value = getFieldValue(row, agg.column)
        const accumulator = group.accumulators.get(agg.alias || `${agg.fn}_${agg.column}`)!
        updateAccumulator(accumulator, value)
      }
    }

    // Calculate grouping metadata
    const groupingId = calculateGroupingId(allDimensions, activeDimensions)
    const groupingIndicators = calculateGroupingIndicators(allDimensions, activeDimensions)
    const groupingLevel = calculateGroupingLevel(allDimensions, activeDimensions)

    // Build result rows for this grouping set
    const groupValues = Array.from(groups.values())
    for (const group of groupValues) {
      const measures: Record<string, number | null> = {}

      for (const agg of aggregates) {
        const key = agg.alias || `${agg.fn}_${agg.column}`
        const accumulator = group.accumulators.get(key)!
        measures[key] = finalizeAccumulator(accumulator, agg.fn)
      }

      results.push({
        dimensions: group.dimensionValues,
        measures,
        groupingId,
        grouping: groupingIndicators,
        groupingLevel,
      })
    }

    // Handle empty data case - still produce a row for grand total
    if (data.length === 0 && activeDimensions.length === 0) {
      const measures: Record<string, number | null> = {}
      const dimensions: Record<string, unknown> = {}

      for (const dim of allDimensions) {
        dimensions[dim] = null
      }

      for (const agg of aggregates) {
        const key = agg.alias || `${agg.fn}_${agg.column}`
        measures[key] = agg.fn === 'count' ? 0 : null
      }

      results.push({
        dimensions,
        measures,
        groupingId,
        grouping: groupingIndicators,
        groupingLevel,
      })
    }
  }

  // Sort by grouping level if requested (most detailed first)
  if (sortByLevel) {
    results.sort((a, b) => a.groupingLevel - b.groupingLevel)
  }

  return results
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Execute a CUBE aggregation on data
 *
 * @param data - Array of records to aggregate
 * @param dimensions - Columns to use as dimensions
 * @param aggregates - Aggregate specifications
 * @param options - Optional configuration
 * @returns Array of result rows with all dimension combinations
 */
export function cubeAggregate<T extends Record<string, unknown>>(
  data: T[],
  dimensions: string[],
  aggregates: AggregateSpec[],
  options: CubeOptions = {}
): CubeResultRow[] {
  return aggregate(data, cube(dimensions), aggregates, options)
}

/**
 * Execute a ROLLUP aggregation on data
 *
 * @param data - Array of records to aggregate
 * @param dimensions - Columns to use as dimensions (in hierarchical order)
 * @param aggregates - Aggregate specifications
 * @param options - Optional configuration
 * @returns Array of result rows with hierarchical subtotals
 */
export function rollupAggregate<T extends Record<string, unknown>>(
  data: T[],
  dimensions: string[],
  aggregates: AggregateSpec[],
  options: CubeOptions = {}
): CubeResultRow[] {
  return aggregate(data, rollup(dimensions), aggregates, options)
}

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Check if a row is a subtotal (has any aggregated dimensions)
 */
export function isSubtotal(row: CubeResultRow): boolean {
  return row.groupingLevel > 0
}

/**
 * Check if a row is the grand total (all dimensions aggregated)
 */
export function isGrandTotal(row: CubeResultRow): boolean {
  return Object.values(row.grouping).every((v) => v === 1)
}

/**
 * Get active (non-aggregated) dimensions for a row
 */
export function getActiveDimensions(row: CubeResultRow): string[] {
  return Object.entries(row.grouping)
    .filter(([_, v]) => v === 0)
    .map(([k]) => k)
}

/**
 * Filter results to a specific grouping level
 */
export function filterByGroupingLevel(
  results: CubeResultRow[],
  level: number
): CubeResultRow[] {
  return results.filter((r) => r.groupingLevel === level)
}

/**
 * Filter results by grouping ID
 */
export function filterByGroupingId(
  results: CubeResultRow[],
  groupingId: number
): CubeResultRow[] {
  return results.filter((r) => r.groupingId === groupingId)
}

/**
 * Get only detail rows (no subtotals)
 */
export function getDetailRows(results: CubeResultRow[]): CubeResultRow[] {
  return results.filter((r) => r.groupingLevel === 0)
}

/**
 * Get only the grand total row
 */
export function getGrandTotalRow(results: CubeResultRow[]): CubeResultRow | undefined {
  return results.find(isGrandTotal)
}
