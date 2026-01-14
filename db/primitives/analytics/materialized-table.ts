/**
 * MaterializedTable Primitive
 *
 * A primitive for storing pre-computed aggregates that can be incrementally
 * updated, similar to ClickHouse materialized views.
 *
 * Key features:
 * - Define groupBy + aggregates materialization
 * - Incremental updates from new rows
 * - Merge operations for distributed aggregates
 * - Window-based materializations (tumbling, sliding)
 * - Partial aggregate export/import for distributed computing
 *
 * @module db/primitives/analytics/materialized-table
 * @see dotdo-xi4kc
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Aggregate function type
 */
export type AggregateFnType = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'countDistinct'

/**
 * Aggregate function definition
 */
export interface AggregateFnDef {
  type: AggregateFnType
  field?: string
}

/**
 * Named aggregate definition
 */
export interface AggregateDefinition {
  name: string
  fn: AggregateFnDef
}

/**
 * Window assigner type
 */
export type WindowType = 'tumbling' | 'sliding'

/**
 * Window assigner configuration
 */
export interface WindowAssigner {
  type: WindowType
  size: number
  slide?: number
}

/**
 * Comparison operators for predicates
 */
export type ComparisonOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'in' | 'between'

/**
 * Predicate for filtering rows
 */
export interface Predicate {
  column: string
  op: ComparisonOp
  value: unknown
}

/**
 * Refresh mode for materializations
 */
export type RefreshMode = 'on-insert' | 'periodic' | 'manual'

/**
 * Materialization configuration
 */
export interface MaterializationConfig<T> {
  groupBy: (keyof T)[]
  aggregates: AggregateDefinition[]
  window?: WindowAssigner
  refresh: RefreshMode
  refreshInterval?: number
}

/**
 * Partial aggregate state for distributed merge
 */
export interface PartialAggregateValue {
  type: AggregateFnType
  value: number
  count?: number // For avg, we need sum and count
  sum?: number // For avg
  distinctSet?: Set<string> // For countDistinct
}

/**
 * Partial aggregate export format
 */
export interface PartialAggregate {
  groupKey: Record<string, unknown>
  aggregates: Record<string, PartialAggregateValue>
}

/**
 * Materialization statistics
 */
export interface MaterializationStats {
  rowCount: number
  groupCount: number
  lastRefreshTime?: number
  refreshMode?: RefreshMode
  refreshInterval?: number
  aggregateCount?: number
  groupByFields?: string[]
  memoryBytes?: number
}

/**
 * Result row from query
 */
export interface MaterializedRow {
  [key: string]: unknown
  windowStart?: number
  windowEnd?: number
}

/**
 * MaterializedTable interface
 */
export interface MaterializedTable<T> {
  /**
   * Define the materialization schema
   */
  define(config: MaterializationConfig<T>): void

  /**
   * Ingest new rows and update aggregates
   */
  ingest(rows: T[]): void

  /**
   * Query the materialized data
   */
  query(filter?: Predicate[]): MaterializedRow[]

  /**
   * Merge another MaterializedTable into this one
   */
  merge(other: MaterializedTable<T>): void

  /**
   * Force refresh (for manual mode)
   */
  refresh(): void

  /**
   * Get materialization statistics
   */
  getStats(): MaterializationStats

  /**
   * Export partial aggregates for distributed merge
   */
  exportPartials(): PartialAggregate[]

  /**
   * Import partial aggregates
   */
  importPartials(partials: PartialAggregate[]): void

  /**
   * Compact old windows (for windowed tables)
   */
  compact(beforeTimestamp: number): void
}

// ============================================================================
// Aggregate State
// ============================================================================

/**
 * Internal aggregate state that tracks partial values
 */
interface AggregateState {
  type: AggregateFnType
  field?: string
  value: number
  count: number // For count and avg
  sum: number // For avg (sum / count)
  min: number
  max: number
  distinctSet: Set<string> // For countDistinct
}

function createAggregateState(fn: AggregateFnDef): AggregateState {
  return {
    type: fn.type,
    field: fn.field,
    value: 0,
    count: 0,
    sum: 0,
    min: Infinity,
    max: -Infinity,
    distinctSet: new Set(),
  }
}

function updateAggregateState(state: AggregateState, value: unknown): void {
  const numValue = typeof value === 'number' ? value : 0
  const strValue = value !== undefined && value !== null ? String(value) : ''

  switch (state.type) {
    case 'sum':
      state.sum += numValue
      state.value = state.sum
      break

    case 'count':
      state.count += 1
      state.value = state.count
      break

    case 'avg':
      state.sum += numValue
      state.count += 1
      state.value = state.count > 0 ? state.sum / state.count : 0
      break

    case 'min':
      if (numValue < state.min) {
        state.min = numValue
      }
      state.value = state.min === Infinity ? 0 : state.min
      break

    case 'max':
      if (numValue > state.max) {
        state.max = numValue
      }
      state.value = state.max === -Infinity ? 0 : state.max
      break

    case 'countDistinct':
      state.distinctSet.add(strValue)
      state.value = state.distinctSet.size
      break
  }
}

function mergeAggregateStates(target: AggregateState, source: AggregateState): void {
  switch (target.type) {
    case 'sum':
      target.sum += source.sum
      target.value = target.sum
      break

    case 'count':
      target.count += source.count
      target.value = target.count
      break

    case 'avg':
      target.sum += source.sum
      target.count += source.count
      target.value = target.count > 0 ? target.sum / target.count : 0
      break

    case 'min':
      if (source.min < target.min) {
        target.min = source.min
      }
      target.value = target.min === Infinity ? 0 : target.min
      break

    case 'max':
      if (source.max > target.max) {
        target.max = source.max
      }
      target.value = target.max === -Infinity ? 0 : target.max
      break

    case 'countDistinct':
      for (const item of source.distinctSet) {
        target.distinctSet.add(item)
      }
      target.value = target.distinctSet.size
      break
  }
}

function exportAggregateState(state: AggregateState): PartialAggregateValue {
  const result: PartialAggregateValue = {
    type: state.type,
    value: state.value,
  }

  if (state.type === 'avg') {
    result.sum = state.sum
    result.count = state.count
  }

  return result
}

function importAggregateState(state: AggregateState, partial: PartialAggregateValue): void {
  switch (state.type) {
    case 'sum':
      state.sum += partial.value
      state.value = state.sum
      break

    case 'count':
      state.count += partial.value
      state.value = state.count
      break

    case 'avg':
      if (partial.sum !== undefined && partial.count !== undefined) {
        state.sum += partial.sum
        state.count += partial.count
      } else {
        // Fallback: treat value as already computed average (not ideal)
        state.sum += partial.value
        state.count += 1
      }
      state.value = state.count > 0 ? state.sum / state.count : 0
      break

    case 'min':
      if (partial.value < state.min) {
        state.min = partial.value
      }
      state.value = state.min === Infinity ? 0 : state.min
      break

    case 'max':
      if (partial.value > state.max) {
        state.max = partial.value
      }
      state.value = state.max === -Infinity ? 0 : state.max
      break

    case 'countDistinct':
      // For countDistinct, we can only approximate by taking max
      // True merge would require the actual set
      state.value = Math.max(state.value, partial.value)
      break
  }
}

// ============================================================================
// Group Management
// ============================================================================

/**
 * A materialized group with its aggregate states
 */
interface MaterializedGroup {
  key: Record<string, unknown>
  keyString: string
  aggregates: Map<string, AggregateState>
  windowStart?: number
  windowEnd?: number
}

function generateGroupKey(row: unknown, groupByFields: string[]): Record<string, unknown> {
  const key: Record<string, unknown> = {}
  const record = row as Record<string, unknown>

  for (const field of groupByFields) {
    key[field] = record[field]
  }

  return key
}

function groupKeyToString(key: Record<string, unknown>, windowStart?: number): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(key)) {
    parts.push(`${k}=${v === undefined ? 'null' : v}`)
  }
  if (windowStart !== undefined) {
    parts.push(`_window=${windowStart}`)
  }
  return parts.join('|')
}

// ============================================================================
// Window Helpers
// ============================================================================

function getWindowBoundaries(
  timestamp: number,
  window: WindowAssigner
): { start: number; end: number }[] {
  const windows: { start: number; end: number }[] = []

  if (window.type === 'tumbling') {
    // Single window containing the timestamp
    const start = Math.floor(timestamp / window.size) * window.size
    windows.push({ start, end: start + window.size })
  } else if (window.type === 'sliding') {
    // Multiple overlapping windows
    const slide = window.slide || window.size
    // Find all windows that contain this timestamp
    // A window [start, start+size) contains timestamp if start <= timestamp < start+size
    // Earliest possible start: timestamp - size + 1 (rounded down to slide boundary)
    // Latest possible start: timestamp (rounded down to slide boundary)
    const earliestStart = Math.floor((timestamp - window.size + 1) / slide) * slide
    const latestStart = Math.floor(timestamp / slide) * slide

    for (let start = Math.max(0, earliestStart); start <= latestStart; start += slide) {
      const end = start + window.size
      if (timestamp >= start && timestamp < end) {
        windows.push({ start, end })
      }
    }
  }

  return windows
}

// ============================================================================
// MaterializedTable Implementation
// ============================================================================

class MaterializedTableImpl<T> implements MaterializedTable<T> {
  private config: MaterializationConfig<T> | null = null
  private groups: Map<string, MaterializedGroup> = new Map()
  private pendingRows: T[] = []
  private totalRowCount: number = 0
  private lastRefreshTime?: number

  define(config: MaterializationConfig<T>): void {
    if (this.config !== null) {
      throw new Error('Materialization already defined. Create a new MaterializedTable to use a different schema.')
    }
    this.config = config
  }

  ingest(rows: T[]): void {
    if (this.config === null) {
      throw new Error('Materialization not defined. Call define() before ingest().')
    }

    if (rows.length === 0) {
      return
    }

    if (this.config.refresh === 'manual') {
      // Buffer rows for later refresh
      this.pendingRows.push(...rows)
    } else {
      // Process immediately
      this.processRows(rows)
    }

    this.totalRowCount += rows.length
  }

  private processRows(rows: T[]): void {
    if (!this.config) return

    const groupByFields = this.config.groupBy.map(String)

    for (const row of rows) {
      const record = row as Record<string, unknown>

      if (this.config.window) {
        // Windowed aggregation
        const timestamp = record.timestamp as number
        if (timestamp === undefined) {
          throw new Error('Window-based materialization requires a "timestamp" field')
        }

        const windows = getWindowBoundaries(timestamp, this.config.window)

        for (const { start, end } of windows) {
          const groupKey = generateGroupKey(row, groupByFields)
          const keyString = groupKeyToString(groupKey, start)

          let group = this.groups.get(keyString)
          if (!group) {
            group = this.createGroup(groupKey, keyString, start, end)
            this.groups.set(keyString, group)
          }

          this.updateGroupAggregates(group, record)
        }
      } else {
        // Non-windowed aggregation
        const groupKey = generateGroupKey(row, groupByFields)
        const keyString = groupKeyToString(groupKey)

        let group = this.groups.get(keyString)
        if (!group) {
          group = this.createGroup(groupKey, keyString)
          this.groups.set(keyString, group)
        }

        this.updateGroupAggregates(group, record)
      }
    }

    this.lastRefreshTime = Date.now()
  }

  private createGroup(
    key: Record<string, unknown>,
    keyString: string,
    windowStart?: number,
    windowEnd?: number
  ): MaterializedGroup {
    const aggregates = new Map<string, AggregateState>()

    for (const aggDef of this.config!.aggregates) {
      aggregates.set(aggDef.name, createAggregateState(aggDef.fn))
    }

    return {
      key,
      keyString,
      aggregates,
      windowStart,
      windowEnd,
    }
  }

  private updateGroupAggregates(group: MaterializedGroup, record: Record<string, unknown>): void {
    for (const aggDef of this.config!.aggregates) {
      const state = group.aggregates.get(aggDef.name)!
      const fieldValue = state.field ? record[state.field] : undefined
      updateAggregateState(state, fieldValue)
    }
  }

  query(filter?: Predicate[]): MaterializedRow[] {
    if (this.config === null) {
      throw new Error('Materialization not defined. Call define() before query().')
    }

    const results: MaterializedRow[] = []

    for (const group of this.groups.values()) {
      const row: MaterializedRow = { ...group.key }

      // Add window boundaries if present
      if (group.windowStart !== undefined) {
        row.windowStart = group.windowStart
        row.windowEnd = group.windowEnd
      }

      // Add aggregate values
      for (const [name, state] of group.aggregates) {
        row[name] = state.value
      }

      // Apply filters
      if (filter && filter.length > 0) {
        if (!this.matchesPredicates(row, filter)) {
          continue
        }
      }

      results.push(row)
    }

    return results
  }

  private matchesPredicates(row: MaterializedRow, predicates: Predicate[]): boolean {
    for (const pred of predicates) {
      const value = row[pred.column]

      switch (pred.op) {
        case '=':
          if (value !== pred.value) return false
          break

        case '!=':
          if (value === pred.value) return false
          break

        case '>':
          if (typeof value !== 'number' || typeof pred.value !== 'number') return false
          if (value <= pred.value) return false
          break

        case '<':
          if (typeof value !== 'number' || typeof pred.value !== 'number') return false
          if (value >= pred.value) return false
          break

        case '>=':
          if (typeof value !== 'number' || typeof pred.value !== 'number') return false
          if (value < pred.value) return false
          break

        case '<=':
          if (typeof value !== 'number' || typeof pred.value !== 'number') return false
          if (value > pred.value) return false
          break

        case 'in':
          if (!Array.isArray(pred.value)) return false
          if (!pred.value.includes(value)) return false
          break

        case 'between':
          if (!Array.isArray(pred.value) || pred.value.length !== 2) return false
          if (typeof value !== 'number') return false
          const [min, max] = pred.value as [number, number]
          if (value < min || value > max) return false
          break
      }
    }

    return true
  }

  merge(other: MaterializedTable<T>): void {
    if (!this.config) {
      throw new Error('Materialization not defined. Call define() before merge().')
    }

    const otherImpl = other as MaterializedTableImpl<T>

    if (!otherImpl.config) {
      throw new Error('Other table has no materialization defined.')
    }

    // Validate schemas match
    const thisGroupBy = this.config.groupBy.map(String).sort().join(',')
    const otherGroupBy = otherImpl.config.groupBy.map(String).sort().join(',')

    if (thisGroupBy !== otherGroupBy) {
      throw new Error('Cannot merge tables with different groupBy schema.')
    }

    const thisAggregates = this.config.aggregates.map((a) => `${a.name}:${a.fn.type}`).sort().join(',')
    const otherAggregates = otherImpl.config.aggregates.map((a) => `${a.name}:${a.fn.type}`).sort().join(',')

    if (thisAggregates !== otherAggregates) {
      throw new Error('Cannot merge tables with different aggregate schema.')
    }

    // Merge groups
    for (const [keyString, otherGroup] of otherImpl.groups) {
      const existingGroup = this.groups.get(keyString)

      if (existingGroup) {
        // Merge aggregate states
        for (const [name, otherState] of otherGroup.aggregates) {
          const existingState = existingGroup.aggregates.get(name)!
          mergeAggregateStates(existingState, otherState)
        }
      } else {
        // Clone the group
        const newGroup: MaterializedGroup = {
          key: { ...otherGroup.key },
          keyString: otherGroup.keyString,
          aggregates: new Map(),
          windowStart: otherGroup.windowStart,
          windowEnd: otherGroup.windowEnd,
        }

        for (const [name, state] of otherGroup.aggregates) {
          const clonedState: AggregateState = {
            type: state.type,
            field: state.field,
            value: state.value,
            count: state.count,
            sum: state.sum,
            min: state.min,
            max: state.max,
            distinctSet: new Set(state.distinctSet),
          }
          newGroup.aggregates.set(name, clonedState)
        }

        this.groups.set(keyString, newGroup)
      }
    }

    this.lastRefreshTime = Date.now()
  }

  refresh(): void {
    if (!this.config) {
      throw new Error('Materialization not defined. Call define() before refresh().')
    }

    if (this.pendingRows.length > 0) {
      this.processRows(this.pendingRows)
      this.pendingRows = []
    }
  }

  getStats(): MaterializationStats {
    const stats: MaterializationStats = {
      rowCount: this.totalRowCount,
      groupCount: this.groups.size,
      lastRefreshTime: this.lastRefreshTime,
    }

    if (this.config) {
      stats.refreshMode = this.config.refresh
      stats.refreshInterval = this.config.refreshInterval
      stats.aggregateCount = this.config.aggregates.length
      stats.groupByFields = this.config.groupBy.map(String)
    }

    // Estimate memory usage (rough approximation)
    let memoryBytes = 0
    for (const group of this.groups.values()) {
      // Key storage
      memoryBytes += JSON.stringify(group.key).length * 2

      // Aggregate state storage
      for (const state of group.aggregates.values()) {
        memoryBytes += 64 // Base state size
        if (state.type === 'countDistinct') {
          memoryBytes += state.distinctSet.size * 32 // Estimated string size
        }
      }
    }
    stats.memoryBytes = memoryBytes

    return stats
  }

  exportPartials(): PartialAggregate[] {
    const partials: PartialAggregate[] = []

    for (const group of this.groups.values()) {
      const partial: PartialAggregate = {
        groupKey: { ...group.key },
        aggregates: {},
      }

      for (const [name, state] of group.aggregates) {
        partial.aggregates[name] = exportAggregateState(state)
      }

      partials.push(partial)
    }

    return partials
  }

  importPartials(partials: PartialAggregate[]): void {
    if (!this.config) {
      throw new Error('Materialization not defined. Call define() before importPartials().')
    }

    for (const partial of partials) {
      const keyString = groupKeyToString(partial.groupKey)

      let group = this.groups.get(keyString)
      if (!group) {
        group = this.createGroup(partial.groupKey, keyString)
        this.groups.set(keyString, group)
      }

      for (const [name, partialValue] of Object.entries(partial.aggregates)) {
        const state = group.aggregates.get(name)
        if (state) {
          importAggregateState(state, partialValue)
        }
      }
    }

    this.lastRefreshTime = Date.now()
  }

  compact(beforeTimestamp: number): void {
    if (!this.config?.window) {
      return // No-op for non-windowed tables
    }

    const keysToDelete: string[] = []

    for (const [keyString, group] of this.groups) {
      if (group.windowEnd !== undefined && group.windowEnd < beforeTimestamp) {
        keysToDelete.push(keyString)
      }
    }

    for (const key of keysToDelete) {
      this.groups.delete(key)
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new MaterializedTable instance
 */
export function createMaterializedTable<T>(): MaterializedTable<T> {
  return new MaterializedTableImpl<T>()
}

// ============================================================================
// Aggregate Helper Functions
// ============================================================================

/**
 * Create a SUM aggregate definition
 */
export function sum(field: string): AggregateFnDef {
  return { type: 'sum', field }
}

/**
 * Create a COUNT aggregate definition
 */
export function count(): AggregateFnDef {
  return { type: 'count' }
}

/**
 * Create an AVG aggregate definition
 */
export function avg(field: string): AggregateFnDef {
  return { type: 'avg', field }
}

/**
 * Create a MIN aggregate definition
 */
export function min(field: string): AggregateFnDef {
  return { type: 'min', field }
}

/**
 * Create a MAX aggregate definition
 */
export function max(field: string): AggregateFnDef {
  return { type: 'max', field }
}

/**
 * Create a COUNT DISTINCT aggregate definition
 */
export function countDistinct(field: string): AggregateFnDef {
  return { type: 'countDistinct', field }
}

// ============================================================================
// Window Helper Functions
// ============================================================================

/**
 * Create a tumbling window assigner
 * @param size Window size in milliseconds
 */
export function tumbling(size: number): WindowAssigner {
  return { type: 'tumbling', size }
}

/**
 * Create a sliding window assigner
 * @param size Window size in milliseconds
 * @param slide Slide interval in milliseconds
 */
export function sliding(size: number, slide: number): WindowAssigner {
  return { type: 'sliding', size, slide }
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type {
  AggregateFnType,
  AggregateFnDef,
  AggregateDefinition,
  WindowType,
  WindowAssigner,
  ComparisonOp,
  Predicate,
  RefreshMode,
  MaterializationConfig,
  PartialAggregateValue,
  PartialAggregate,
  MaterializationStats,
  MaterializedRow,
  MaterializedTable,
}
