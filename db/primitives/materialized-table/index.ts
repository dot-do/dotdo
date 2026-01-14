/**
 * MaterializedTable - Incremental Aggregate Storage Primitive
 *
 * Like ClickHouse MaterializedViews, this primitive stores pre-computed aggregates
 * and supports incremental refresh as new data arrives.
 *
 * Key features:
 * - Define aggregates with groupBy and aggregate functions
 * - Incremental updates (no need to recompute from scratch)
 * - Partial aggregates that can be merged (for distributed computing)
 * - Multiple aggregate functions: sum, count, avg, min, max
 * - Multi-dimensional grouping
 * - Batch and immediate refresh modes
 *
 * @module db/primitives/materialized-table
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Supported aggregate functions
 */
export type AggregateFunctionType = 'sum' | 'count' | 'avg' | 'min' | 'max'

/**
 * Refresh mode for the materialized table
 * - 'immediate': Updates are applied immediately on ingest
 * - 'batch': Updates are buffered and applied on refresh()
 */
export type RefreshMode = 'immediate' | 'batch'

/**
 * Specification for a single aggregate
 */
export interface AggregateSpec {
  fn: AggregateFunctionType
  field?: string // Optional for count
}

/**
 * Configuration for a materialized table
 */
export interface MaterializedTableConfig<T> {
  /** Fields to group by (empty array for global aggregation) */
  groupBy: (keyof T & string)[]
  /** Aggregate definitions keyed by output field name */
  aggregates: Record<string, AggregateSpec>
  /** Refresh mode (default: 'immediate') */
  refreshMode?: RefreshMode
}

/**
 * Internal state for a partial aggregate (supports merging)
 */
export interface AggregateState {
  /** Sum value or running total for avg */
  sum?: number
  /** Count of values */
  count?: number
  /** Minimum value */
  min?: number
  /** Maximum value */
  max?: number
}

/**
 * Partial aggregate for merging between tables
 */
export interface PartialAggregate {
  /** The group key (serialized) */
  key: string
  /** The group key values */
  keyValues: Record<string, unknown>
  /** State for each aggregate */
  state: Record<string, AggregateState>
}

/**
 * Statistics for ingestion
 */
export interface IngestStats {
  rowsProcessed: number
  groupsCreated: number
  groupsUpdated: number
}

/**
 * Statistics about the materialized table
 */
export interface MaterializedTableStats {
  totalRowsIngested: number
  groupCount: number
  lastUpdated: number
  estimatedMemoryBytes: number
}

/**
 * Query filter - partial match on group key values
 */
export type QueryFilter<T> = Partial<Record<keyof T & string, unknown>>

/**
 * Query result row - group keys plus aggregate values
 */
export type QueryResult<T> = Record<string, unknown>

/**
 * MaterializedTable interface
 */
export interface MaterializedTable<T> {
  /**
   * Get the configuration
   */
  getConfig(): MaterializedTableConfig<T>

  /**
   * Get the refresh mode
   */
  getRefreshMode(): RefreshMode

  /**
   * Ingest rows and update aggregates
   */
  ingest(rows: T[]): IngestStats

  /**
   * Query the materialized data with optional filter
   */
  query(filter?: QueryFilter<T>): QueryResult<T>[]

  /**
   * Get partial aggregates for merging
   */
  getPartialAggregates(): PartialAggregate[]

  /**
   * Merge partial aggregates from another table
   */
  merge(partials: PartialAggregate[]): void

  /**
   * Refresh (apply buffered rows in batch mode)
   */
  refresh(): void

  /**
   * Get count of buffered rows (batch mode)
   */
  getBufferedRowCount(): number

  /**
   * Get statistics about the table
   */
  getStats(): MaterializedTableStats

  /**
   * Clear all aggregates and reset
   */
  clear(): void
}

// ============================================================================
// Internal Types
// ============================================================================

interface GroupState {
  keyValues: Record<string, unknown>
  aggregates: Record<string, AggregateState>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a field value from an object
 */
function getFieldValue(obj: unknown, field: string): unknown {
  if (obj === null || obj === undefined) return undefined
  if (typeof obj !== 'object') return undefined
  return (obj as Record<string, unknown>)[field]
}

/**
 * Generate a string key from group key values
 */
function generateKey(keyValues: Record<string, unknown>): string {
  return JSON.stringify(keyValues)
}

/**
 * Initialize aggregate state based on function type
 */
function initAggregateState(spec: AggregateSpec): AggregateState {
  switch (spec.fn) {
    case 'sum':
      return { sum: 0 }
    case 'count':
      return { count: 0 }
    case 'avg':
      return { sum: 0, count: 0 }
    case 'min':
      return { min: undefined }
    case 'max':
      return { max: undefined }
    default:
      return {}
  }
}

/**
 * Update aggregate state with a value
 */
function updateAggregateState(
  state: AggregateState,
  spec: AggregateSpec,
  value: unknown
): void {
  const numValue = typeof value === 'number' ? value : 0

  switch (spec.fn) {
    case 'sum':
      state.sum = (state.sum ?? 0) + numValue
      break
    case 'count':
      state.count = (state.count ?? 0) + 1
      break
    case 'avg':
      state.sum = (state.sum ?? 0) + numValue
      state.count = (state.count ?? 0) + 1
      break
    case 'min':
      if (typeof value === 'number') {
        if (state.min === undefined || value < state.min) {
          state.min = value
        }
      }
      break
    case 'max':
      if (typeof value === 'number') {
        if (state.max === undefined || value > state.max) {
          state.max = value
        }
      }
      break
  }
}

/**
 * Merge two aggregate states
 */
function mergeAggregateState(
  target: AggregateState,
  source: AggregateState,
  spec: AggregateSpec
): void {
  switch (spec.fn) {
    case 'sum':
      target.sum = (target.sum ?? 0) + (source.sum ?? 0)
      break
    case 'count':
      target.count = (target.count ?? 0) + (source.count ?? 0)
      break
    case 'avg':
      target.sum = (target.sum ?? 0) + (source.sum ?? 0)
      target.count = (target.count ?? 0) + (source.count ?? 0)
      break
    case 'min':
      if (source.min !== undefined) {
        if (target.min === undefined || source.min < target.min) {
          target.min = source.min
        }
      }
      break
    case 'max':
      if (source.max !== undefined) {
        if (target.max === undefined || source.max > target.max) {
          target.max = source.max
        }
      }
      break
  }
}

/**
 * Finalize aggregate state to get the output value
 */
function finalizeAggregateState(state: AggregateState, spec: AggregateSpec): number {
  switch (spec.fn) {
    case 'sum':
      return state.sum ?? 0
    case 'count':
      return state.count ?? 0
    case 'avg':
      if (state.count === 0 || state.count === undefined) return 0
      return (state.sum ?? 0) / state.count
    case 'min':
      return state.min ?? 0
    case 'max':
      return state.max ?? 0
    default:
      return 0
  }
}

/**
 * Estimate memory usage of a group state
 */
function estimateGroupMemory(group: GroupState): number {
  // Rough estimate: key + aggregates
  const keySize = JSON.stringify(group.keyValues).length * 2 // UTF-16
  const aggregatesSize = Object.keys(group.aggregates).length * 32 // ~32 bytes per aggregate
  return keySize + aggregatesSize + 64 // Overhead
}

// ============================================================================
// Implementation
// ============================================================================

class MaterializedTableImpl<T> implements MaterializedTable<T> {
  private config: MaterializedTableConfig<T>
  private groups: Map<string, GroupState> = new Map()
  private buffer: T[] = []
  private totalRowsIngested = 0
  private lastUpdated = 0

  constructor(config: MaterializedTableConfig<T>) {
    this.config = {
      ...config,
      refreshMode: config.refreshMode ?? 'immediate',
    }
  }

  getConfig(): MaterializedTableConfig<T> {
    return this.config
  }

  getRefreshMode(): RefreshMode {
    return this.config.refreshMode ?? 'immediate'
  }

  ingest(rows: T[]): IngestStats {
    if (rows.length === 0) {
      return { rowsProcessed: 0, groupsCreated: 0, groupsUpdated: 0 }
    }

    if (this.config.refreshMode === 'batch') {
      // Buffer rows for later refresh
      this.buffer.push(...rows)
      return { rowsProcessed: rows.length, groupsCreated: 0, groupsUpdated: 0 }
    }

    // Immediate mode: apply updates now
    return this.processRows(rows)
  }

  private processRows(rows: T[]): IngestStats {
    let groupsCreated = 0
    let groupsUpdated = 0

    for (const row of rows) {
      // Generate group key values
      const keyValues: Record<string, unknown> = {}
      for (const field of this.config.groupBy) {
        keyValues[field] = getFieldValue(row, field)
      }

      const key = generateKey(keyValues)
      let group = this.groups.get(key)

      if (!group) {
        // Create new group
        group = {
          keyValues,
          aggregates: {},
        }
        // Initialize aggregate states
        for (const [name, spec] of Object.entries(this.config.aggregates)) {
          group.aggregates[name] = initAggregateState(spec)
        }
        this.groups.set(key, group)
        groupsCreated++
      }

      // Update aggregates
      for (const [name, spec] of Object.entries(this.config.aggregates)) {
        const value = spec.field ? getFieldValue(row, spec.field) : undefined
        updateAggregateState(group.aggregates[name]!, spec, value)
      }
      groupsUpdated++
    }

    this.totalRowsIngested += rows.length
    this.lastUpdated = Date.now()

    return {
      rowsProcessed: rows.length,
      groupsCreated,
      groupsUpdated,
    }
  }

  query(filter?: QueryFilter<T>): QueryResult<T>[] {
    const results: QueryResult<T>[] = []

    for (const group of this.groups.values()) {
      // Apply filter if provided
      if (filter) {
        let matches = true
        for (const [field, value] of Object.entries(filter)) {
          if (group.keyValues[field] !== value) {
            matches = false
            break
          }
        }
        if (!matches) continue
      }

      // Build result row
      const result: QueryResult<T> = { ...group.keyValues }

      for (const [name, spec] of Object.entries(this.config.aggregates)) {
        result[name] = finalizeAggregateState(group.aggregates[name]!, spec)
      }

      results.push(result)
    }

    return results
  }

  getPartialAggregates(): PartialAggregate[] {
    const partials: PartialAggregate[] = []

    for (const [key, group] of this.groups) {
      partials.push({
        key,
        keyValues: { ...group.keyValues },
        state: { ...group.aggregates },
      })
    }

    return partials
  }

  merge(partials: PartialAggregate[]): void {
    for (const partial of partials) {
      let group = this.groups.get(partial.key)

      if (!group) {
        // Create new group from partial
        group = {
          keyValues: { ...partial.keyValues },
          aggregates: {},
        }
        // Initialize aggregate states
        for (const [name, spec] of Object.entries(this.config.aggregates)) {
          group.aggregates[name] = initAggregateState(spec)
        }
        this.groups.set(partial.key, group)
      }

      // Merge each aggregate
      for (const [name, spec] of Object.entries(this.config.aggregates)) {
        if (partial.state[name]) {
          mergeAggregateState(group.aggregates[name]!, partial.state[name]!, spec)
        }
      }
    }

    this.lastUpdated = Date.now()
  }

  refresh(): void {
    if (this.buffer.length === 0) return

    this.processRows(this.buffer)
    this.buffer = []
  }

  getBufferedRowCount(): number {
    return this.buffer.length
  }

  getStats(): MaterializedTableStats {
    let estimatedMemoryBytes = 0
    for (const group of this.groups.values()) {
      estimatedMemoryBytes += estimateGroupMemory(group)
    }

    return {
      totalRowsIngested: this.totalRowsIngested,
      groupCount: this.groups.size,
      lastUpdated: this.lastUpdated,
      estimatedMemoryBytes,
    }
  }

  clear(): void {
    this.groups.clear()
    this.buffer = []
    this.totalRowsIngested = 0
    this.lastUpdated = 0
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new MaterializedTable instance
 */
export function createMaterializedTable<T>(config: MaterializedTableConfig<T>): MaterializedTable<T> {
  return new MaterializedTableImpl(config)
}
