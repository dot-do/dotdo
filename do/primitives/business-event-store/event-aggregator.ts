/**
 * EventAggregator - Dimension-based roll-ups and aggregations
 *
 * Provides aggregation capabilities for business events:
 * - Aggregation by any 5W+H dimension (What, When, Where, Why, Who, How)
 * - Count, sum, avg, min, max aggregations
 * - Group-by with multiple dimensions
 * - Integration with WindowManager for time-based windows
 * - Streaming aggregation support
 * - Late event handling
 * - Window triggers and emit
 *
 * @module db/primitives/business-event-store/event-aggregator
 */

import type { BusinessEvent } from './index'
import { WindowManager, type Window, type LateDataHandler } from '../window-manager'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Supported aggregation types
 */
export type AggregationType = 'count' | 'sum' | 'avg' | 'min' | 'max'

/**
 * Dimension keys for grouping (5W+H)
 */
export type DimensionKey = 'what' | 'when' | 'where' | 'why' | 'who' | 'how' | 'channel'

/**
 * Time granularity for time-based aggregation
 */
export type TimeGranularity = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

/**
 * Configuration for EventAggregator
 */
export interface AggregationConfig {
  /** Default aggregations to perform */
  defaultAggregations?: AggregationType[]
  /** Separator for composite keys */
  keySeparator?: string
}

/**
 * Configuration for aggregate() method
 */
export interface AggregateOptions {
  /** Dimensions to group by */
  groupBy?: DimensionKey[]
  /** Aggregations to perform */
  aggregations?: AggregationType[]
  /** Field to use for numeric aggregations */
  valueField?: string
  /** Include parsed keys in result */
  includeKeys?: boolean
}

/**
 * Configuration for streaming aggregation
 */
export interface StreamingConfig {
  /** Dimensions to group by */
  groupBy?: DimensionKey[]
  /** Aggregations to track */
  aggregations?: AggregationType[]
  /** Field to use for numeric aggregations */
  valueField?: string
  /** Emit updates on each event */
  emitOnUpdate?: boolean
}

/**
 * Rollup configuration for hierarchical aggregation
 */
export interface RollupConfig {
  /** Dimension to roll up */
  dimension: DimensionKey
  /** Hierarchy levels (e.g., ['country', 'state', 'city']) */
  levels: string[]
  /** Separator in dimension values */
  separator: string
  /** Aggregations to perform */
  aggregations: AggregationType[]
  /** Value field for numeric aggregations */
  valueField?: string
}

/**
 * Drill-down configuration
 */
export interface DrillDownConfig {
  /** Dimension to drill down */
  dimension: DimensionKey
  /** Current hierarchy level */
  currentLevel: string
  /** Current value at that level */
  currentValue: string
  /** Target level to drill to */
  targetLevel: string
  /** Separator in dimension values */
  separator: string
  /** Aggregations to perform */
  aggregations: AggregationType[]
  /** Value field for numeric aggregations */
  valueField?: string
  /** Hierarchy levels (optional - if not provided, will use position-based indexing) */
  levels?: string[]
}

/**
 * Single aggregation result entry
 */
export interface AggregationResultEntry {
  count?: number
  sum?: number
  avg?: number
  min?: number
  max?: number
  keys?: Record<string, string>
}

/**
 * Windowed aggregation result
 */
export interface AggregationResult {
  /** Window information */
  window?: Window
  /** Total count */
  count?: number
  /** Sum of values */
  sum?: number
  /** Average of values */
  avg?: number
  /** Minimum value */
  min?: number
  /** Maximum value */
  max?: number
  /** Grouped results */
  groups?: Record<string, AggregationResultEntry>
}

/**
 * Rollup result with hierarchical levels
 */
export interface RollupResult {
  /** Total aggregations */
  totals: AggregationResultEntry
  /** Aggregations by hierarchy level */
  byLevel: Record<string, Record<string, AggregationResultEntry>>
}

/**
 * Time series entry
 */
export interface TimeSeriesEntry {
  timestamp: number
  count?: number
  sum?: number
  avg?: number
  min?: number
  max?: number
}

/**
 * Table row format for results
 */
export interface TableRow extends Record<string, unknown> {
  count?: number
  sum?: number
  avg?: number
  min?: number
  max?: number
}

// =============================================================================
// STREAMING AGGREGATOR
// =============================================================================

/**
 * StreamingAggregator - Incrementally updates aggregations as events arrive
 */
export class StreamingAggregator {
  private config: StreamingConfig
  private keySeparator: string
  private windowManager?: WindowManager<BusinessEvent>
  private updateCallback?: (result: AggregationResult) => void

  // Running state
  private _count = 0
  private _sum = 0
  private _min: number | undefined
  private _max: number | undefined
  private _values: number[] = []

  // Grouped state
  private groupedState: Map<
    string,
    {
      count: number
      sum: number
      min?: number
      max?: number
      values: number[]
    }
  > = new Map()

  constructor(
    config: StreamingConfig,
    keySeparator = '|',
    windowManager?: WindowManager<BusinessEvent>
  ) {
    this.config = config
    this.keySeparator = keySeparator
    this.windowManager = windowManager
  }

  /**
   * Register update callback
   */
  onUpdate(callback: (result: AggregationResult) => void): this {
    this.updateCallback = callback
    return this
  }

  /**
   * Add an event to the stream
   */
  add(event: BusinessEvent, timestamp?: number): void {
    const value = this.extractValue(event)

    // Update global aggregations
    this._count++
    if (value !== undefined) {
      this._sum += value
      this._values.push(value)
      if (this._min === undefined || value < this._min) {
        this._min = value
      }
      if (this._max === undefined || value > this._max) {
        this._max = value
      }
    }

    // Update grouped aggregations
    if (this.config.groupBy && this.config.groupBy.length > 0) {
      const key = this.buildGroupKey(event)
      let groupState = this.groupedState.get(key)
      if (!groupState) {
        groupState = { count: 0, sum: 0, values: [] }
        this.groupedState.set(key, groupState)
      }
      groupState.count++
      if (value !== undefined) {
        groupState.sum += value
        groupState.values.push(value)
        if (groupState.min === undefined || value < groupState.min) {
          groupState.min = value
        }
        if (groupState.max === undefined || value > groupState.max) {
          groupState.max = value
        }
      }
    }

    // Process through window manager if present
    if (this.windowManager && timestamp !== undefined) {
      this.windowManager.process(event, timestamp)
    }

    // Emit update if configured
    if (this.config.emitOnUpdate && this.updateCallback) {
      this.updateCallback(this.getResult())
    }
  }

  /**
   * Get current aggregation result
   */
  getResult(): AggregationResult {
    const result: AggregationResult = {}
    const aggregations = this.config.aggregations || ['count']

    if (aggregations.includes('count')) {
      result.count = this._count
    }
    if (aggregations.includes('sum')) {
      result.sum = this._sum
    }
    if (aggregations.includes('avg')) {
      result.avg = this._values.length > 0 ? this._sum / this._values.length : 0
    }
    if (aggregations.includes('min')) {
      result.min = this._min
    }
    if (aggregations.includes('max')) {
      result.max = this._max
    }

    return result
  }

  /**
   * Get grouped aggregation result
   */
  getGroupedResult(): Record<string, AggregationResultEntry> {
    const result: Record<string, AggregationResultEntry> = {}
    const aggregations = this.config.aggregations || ['count']

    for (const [key, state] of this.groupedState) {
      const entry: AggregationResultEntry = {}

      if (aggregations.includes('count')) {
        entry.count = state.count
      }
      if (aggregations.includes('sum')) {
        entry.sum = state.sum
      }
      if (aggregations.includes('avg')) {
        entry.avg = state.values.length > 0 ? state.sum / state.values.length : 0
      }
      if (aggregations.includes('min')) {
        entry.min = state.min
      }
      if (aggregations.includes('max')) {
        entry.max = state.max
      }

      result[key] = entry
    }

    return result
  }

  /**
   * Reset streaming state
   */
  reset(): void {
    this._count = 0
    this._sum = 0
    this._min = undefined
    this._max = undefined
    this._values = []
    this.groupedState.clear()
  }

  /**
   * Dispose and clean up
   */
  dispose(): void {
    this.reset()
    this.updateCallback = undefined
  }

  private extractValue(event: BusinessEvent): number | undefined {
    if (!this.config.valueField) return undefined

    const parts = this.config.valueField.split('.')
    let current: unknown = event

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return typeof current === 'number' ? current : undefined
  }

  private buildGroupKey(event: BusinessEvent): string {
    if (!this.config.groupBy) return ''

    const parts = this.config.groupBy.map((dim) => {
      const value = this.getDimensionValue(event, dim)
      return value ?? '_undefined'
    })

    return parts.join(this.keySeparator)
  }

  private getDimensionValue(event: BusinessEvent, dimension: DimensionKey): string | undefined {
    switch (dimension) {
      case 'what':
        return event.what[0]
      case 'when':
        return event.when.toISOString()
      case 'where':
        return event.where
      case 'why':
        return event.why
      case 'who':
        return event.who
      case 'how':
        return event.how
      case 'channel':
        return event.channel
      default:
        return undefined
    }
  }
}

// =============================================================================
// EVENT AGGREGATOR
// =============================================================================

/**
 * EventAggregator - Main aggregation class
 */
export class EventAggregator {
  private config: AggregationConfig
  private keySeparator: string
  private windowManager?: WindowManager<BusinessEvent>
  private windowCompleteCallback?: (result: AggregationResult) => void
  private aggregationConfig?: AggregateOptions
  private pendingEvents: BusinessEvent[] = []
  private lateDataHandler?: LateDataHandler<BusinessEvent>

  constructor(config?: AggregationConfig) {
    this.config = config || {}
    this.keySeparator = config?.keySeparator || '|'
  }

  // ===========================================================================
  // Basic Aggregations
  // ===========================================================================

  /**
   * Count events
   */
  count(events: BusinessEvent[]): number {
    return events.length
  }

  /**
   * Sum a numeric field
   */
  sum(events: BusinessEvent[], field: string): number {
    return events.reduce((total, event) => {
      const value = this.extractField(event, field)
      return total + (typeof value === 'number' ? value : 0)
    }, 0)
  }

  /**
   * Average of a numeric field
   */
  avg(events: BusinessEvent[], field: string): number {
    const values = events
      .map((event) => this.extractField(event, field))
      .filter((v): v is number => typeof v === 'number')

    if (values.length === 0) return NaN
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  /**
   * Minimum of a numeric field
   */
  min(events: BusinessEvent[], field: string): number | undefined {
    const values = events
      .map((event) => this.extractField(event, field))
      .filter((v): v is number => typeof v === 'number')

    if (values.length === 0) return undefined
    return Math.min(...values)
  }

  /**
   * Maximum of a numeric field
   */
  max(events: BusinessEvent[], field: string): number | undefined {
    const values = events
      .map((event) => this.extractField(event, field))
      .filter((v): v is number => typeof v === 'number')

    if (values.length === 0) return undefined
    return Math.max(...values)
  }

  // ===========================================================================
  // Dimension-based Grouping
  // ===========================================================================

  /**
   * Group events by a single dimension
   */
  groupByDimension(events: BusinessEvent[], dimension: DimensionKey): Record<string, BusinessEvent[]> {
    const groups: Record<string, BusinessEvent[]> = {}

    for (const event of events) {
      const value = this.getDimensionValue(event, dimension) ?? '_undefined'
      if (!groups[value]) {
        groups[value] = []
      }
      groups[value].push(event)
    }

    return groups
  }

  /**
   * Aggregate by dimension with specific aggregation type
   */
  aggregateByDimension(
    events: BusinessEvent[],
    dimension: DimensionKey,
    aggregation: AggregationType | AggregationType[],
    valueField?: string
  ): Record<string, AggregationResultEntry> {
    const groups = this.groupByDimension(events, dimension)
    const aggregations = Array.isArray(aggregation) ? aggregation : [aggregation]
    const result: Record<string, AggregationResultEntry> = {}

    for (const [key, groupEvents] of Object.entries(groups)) {
      result[key] = this.computeAggregations(groupEvents, aggregations, valueField)
    }

    return result
  }

  // ===========================================================================
  // Multi-Dimension Group-By
  // ===========================================================================

  /**
   * Group events by multiple dimensions
   */
  groupBy(events: BusinessEvent[], dimensions: DimensionKey[]): Record<string, BusinessEvent[]> {
    const groups: Record<string, BusinessEvent[]> = {}

    for (const event of events) {
      const key = dimensions
        .map((dim) => this.getDimensionValue(event, dim) ?? '_undefined')
        .join(this.keySeparator)

      if (!groups[key]) {
        groups[key] = []
      }
      groups[key].push(event)
    }

    return groups
  }

  /**
   * Full aggregate with options
   */
  aggregate(events: BusinessEvent[], options: AggregateOptions): Record<string, AggregationResultEntry> {
    const dimensions = options.groupBy || []
    const aggregations = options.aggregations || ['count']
    const groups = this.groupBy(events, dimensions)
    const result: Record<string, AggregationResultEntry> = {}

    // Store dimensions for toTable to use
    this._lastGroupByDimensions = dimensions

    for (const [key, groupEvents] of Object.entries(groups)) {
      const entry = this.computeAggregations(groupEvents, aggregations, options.valueField)

      if (options.includeKeys) {
        entry.keys = this.parseKey(key, dimensions)
      }

      result[key] = entry
    }

    return result
  }

  // Store last used groupBy dimensions for toTable
  private _lastGroupByDimensions: DimensionKey[] = []

  // ===========================================================================
  // WindowManager Integration
  // ===========================================================================

  /**
   * Integrate with a WindowManager for time-based windowing
   */
  withWindowManager(windowManager: WindowManager<BusinessEvent>): this {
    this.windowManager = windowManager

    // Set up trigger callback
    windowManager.onTrigger((window, elements) => {
      this.handleWindowTrigger(window, elements)
    })

    return this
  }

  /**
   * Register callback for window completion
   */
  onWindowComplete(callback: (result: AggregationResult) => void): this {
    this.windowCompleteCallback = callback
    return this
  }

  /**
   * Configure aggregation settings for windowed results
   */
  configureAggregation(options: AggregateOptions): this {
    this.aggregationConfig = options
    return this
  }

  /**
   * Handle late events
   */
  withLateDataHandler(handler: LateDataHandler<BusinessEvent>): this {
    this.lateDataHandler = handler
    if (this.windowManager) {
      this.windowManager.sideOutputLate(handler)
    }
    return this
  }

  /**
   * Process an event through the window
   */
  processEvent(event: BusinessEvent, timestamp: number): void {
    if (!this.windowManager) {
      throw new Error('WindowManager not configured. Call withWindowManager() first.')
    }

    this.pendingEvents.push(event)
    this.windowManager.process(event, timestamp)
  }

  /**
   * Advance the watermark to trigger windows
   */
  advanceWatermark(timestamp: number): Window[] {
    if (!this.windowManager) {
      throw new Error('WindowManager not configured. Call withWindowManager() first.')
    }

    return this.windowManager.advanceWatermark(timestamp)
  }

  /**
   * Get the count of pending events
   */
  getPendingEventCount(): number {
    return this.pendingEvents.length
  }

  /**
   * Dispose and clean up
   */
  dispose(): void {
    if (this.windowManager) {
      this.windowManager.dispose()
    }
    this.pendingEvents = []
    this.windowCompleteCallback = undefined
    this.aggregationConfig = undefined
  }

  // ===========================================================================
  // Time-based Aggregation
  // ===========================================================================

  /**
   * Aggregate events by time granularity
   */
  aggregateByTime(
    events: BusinessEvent[],
    granularity: TimeGranularity,
    aggregations: AggregationType[],
    valueField?: string
  ): Record<number, AggregationResultEntry> {
    const buckets: Map<number, BusinessEvent[]> = new Map()

    for (const event of events) {
      const bucket = this.truncateTime(event.when.getTime(), granularity)
      let bucketEvents = buckets.get(bucket)
      if (!bucketEvents) {
        bucketEvents = []
        buckets.set(bucket, bucketEvents)
      }
      bucketEvents.push(event)
    }

    const result: Record<number, AggregationResultEntry> = {}
    for (const [bucket, bucketEvents] of buckets) {
      result[bucket] = this.computeAggregations(bucketEvents, aggregations, valueField)
    }

    return result
  }

  /**
   * Aggregate events within a time range
   */
  aggregateByTimeRange(
    events: BusinessEvent[],
    start: Date,
    end: Date,
    aggregations: AggregationType[],
    valueField?: string
  ): AggregationResultEntry {
    const filtered = events.filter((event) => {
      const time = event.when.getTime()
      return time >= start.getTime() && time < end.getTime()
    })

    return this.computeAggregations(filtered, aggregations, valueField)
  }

  // ===========================================================================
  // Hierarchical Aggregation
  // ===========================================================================

  /**
   * Perform hierarchical rollup aggregation
   */
  rollup(events: BusinessEvent[], config: RollupConfig): RollupResult {
    const result: RollupResult = {
      totals: this.computeAggregations(events, config.aggregations, config.valueField),
      byLevel: {},
    }

    // Initialize levels
    for (const level of config.levels) {
      result.byLevel[level] = {}
    }

    // Group events by hierarchy levels
    for (const event of events) {
      const fullValue = this.getDimensionValue(event, config.dimension)
      if (!fullValue) continue

      const parts = fullValue.split(config.separator)

      // Build keys for each level
      for (let i = 0; i < config.levels.length && i < parts.length; i++) {
        const level = config.levels[i]
        const key = parts.slice(0, i + 1).join(config.separator)

        if (!result.byLevel[level][key]) {
          result.byLevel[level][key] = { count: 0, sum: 0 }
        }

        // We'll need to re-aggregate later
      }
    }

    // Now properly aggregate for each level
    for (let i = 0; i < config.levels.length; i++) {
      const level = config.levels[i]
      const levelEvents: Map<string, BusinessEvent[]> = new Map()

      for (const event of events) {
        const fullValue = this.getDimensionValue(event, config.dimension)
        if (!fullValue) continue

        const parts = fullValue.split(config.separator)
        if (i >= parts.length) continue

        const key = parts.slice(0, i + 1).join(config.separator)

        let keyEvents = levelEvents.get(key)
        if (!keyEvents) {
          keyEvents = []
          levelEvents.set(key, keyEvents)
        }
        keyEvents.push(event)
      }

      for (const [key, keyEvents] of levelEvents) {
        result.byLevel[level][key] = this.computeAggregations(
          keyEvents,
          config.aggregations,
          config.valueField
        )
      }
    }

    return result
  }

  /**
   * Drill down from higher to lower granularity
   */
  drillDown(events: BusinessEvent[], config: DrillDownConfig): Record<string, AggregationResultEntry> {
    const { currentValue, targetLevel, separator, dimension, levels, aggregations, valueField } = config

    // Find indices for current and target levels
    // If levels array is provided, use it to find indices
    // Otherwise, infer from level names (country=0, state=1, city=2, etc.)
    let currentIdx: number
    let targetIdx: number

    if (levels && levels.length > 0) {
      currentIdx = levels.indexOf(config.currentLevel)
      targetIdx = levels.indexOf(targetLevel)
    } else {
      // Infer indices based on common hierarchy naming
      const levelMap: Record<string, number> = {
        country: 0,
        state: 1,
        city: 2,
        region: 0,
        subregion: 1,
        area: 2,
      }
      currentIdx = levelMap[config.currentLevel] ?? -1
      targetIdx = levelMap[targetLevel] ?? -1
    }

    if (currentIdx === -1 || targetIdx === -1 || targetIdx <= currentIdx) {
      return {}
    }

    // Filter events that match current value
    const matchingEvents = events.filter((event) => {
      const fullValue = this.getDimensionValue(event, dimension)
      if (!fullValue) return false
      return fullValue.startsWith(currentValue)
    })

    // Group by target level
    const groups: Map<string, BusinessEvent[]> = new Map()

    for (const event of matchingEvents) {
      const fullValue = this.getDimensionValue(event, dimension)
      if (!fullValue) continue

      const parts = fullValue.split(separator)
      if (targetIdx >= parts.length) continue

      const key = parts.slice(0, targetIdx + 1).join(separator)

      let keyEvents = groups.get(key)
      if (!keyEvents) {
        keyEvents = []
        groups.set(key, keyEvents)
      }
      keyEvents.push(event)
    }

    // Compute aggregations for each group
    const result: Record<string, AggregationResultEntry> = {}
    for (const [key, keyEvents] of groups) {
      result[key] = this.computeAggregations(keyEvents, aggregations, valueField)
    }

    return result
  }

  // ===========================================================================
  // Result Formatting
  // ===========================================================================

  /**
   * Format aggregation results as table rows
   */
  toTable(result: Record<string, AggregationResultEntry>): TableRow[] {
    const rows: TableRow[] = []

    for (const [key, entry] of Object.entries(result)) {
      const row: TableRow = { ...entry }

      // Parse key if it has dimension info
      if (entry.keys) {
        for (const [dim, value] of Object.entries(entry.keys)) {
          row[dim] = value
        }
        delete row.keys
      } else {
        // Try to parse key from composite key using stored dimensions
        const parts = key.split(this.keySeparator)
        if (this._lastGroupByDimensions.length > 0 && parts.length === this._lastGroupByDimensions.length) {
          // Use stored dimension names to parse keys
          for (let i = 0; i < this._lastGroupByDimensions.length; i++) {
            row[this._lastGroupByDimensions[i]] = parts[i]
          }
        } else if (parts.length === 1) {
          row.dimension = key
        } else {
          // Without dimension info, we just add the full key
          row.key = key
        }
      }

      rows.push(row)
    }

    return rows
  }

  /**
   * Format time-based aggregations as time series
   */
  toTimeSeries(result: Record<number, AggregationResultEntry>): TimeSeriesEntry[] {
    const entries: TimeSeriesEntry[] = []

    for (const [timestamp, entry] of Object.entries(result)) {
      entries.push({
        timestamp: Number(timestamp),
        ...entry,
      })
    }

    return entries.sort((a, b) => a.timestamp - b.timestamp)
  }

  // ===========================================================================
  // Streaming
  // ===========================================================================

  /**
   * Create a streaming aggregator
   */
  streaming(config?: StreamingConfig): StreamingAggregator {
    return new StreamingAggregator(config || {}, this.keySeparator, this.windowManager)
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private extractField(event: BusinessEvent, field: string): unknown {
    const parts = field.split('.')
    let current: unknown = event

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  private getDimensionValue(event: BusinessEvent, dimension: DimensionKey): string | undefined {
    switch (dimension) {
      case 'what':
        return event.what[0]
      case 'when':
        return event.when.toISOString()
      case 'where':
        return event.where
      case 'why':
        return event.why
      case 'who':
        return event.who
      case 'how':
        return event.how
      case 'channel':
        return event.channel
      default:
        return undefined
    }
  }

  private computeAggregations(
    events: BusinessEvent[],
    aggregations: AggregationType[],
    valueField?: string
  ): AggregationResultEntry {
    const result: AggregationResultEntry = {}

    for (const agg of aggregations) {
      switch (agg) {
        case 'count':
          result.count = this.count(events)
          break
        case 'sum':
          if (valueField) {
            result.sum = this.sum(events, valueField)
          }
          break
        case 'avg':
          if (valueField) {
            result.avg = this.avg(events, valueField)
          }
          break
        case 'min':
          if (valueField) {
            result.min = this.min(events, valueField)
          }
          break
        case 'max':
          if (valueField) {
            result.max = this.max(events, valueField)
          }
          break
      }
    }

    return result
  }

  private parseKey(key: string, dimensions: DimensionKey[]): Record<string, string> {
    const parts = key.split(this.keySeparator)
    const result: Record<string, string> = {}

    for (let i = 0; i < dimensions.length && i < parts.length; i++) {
      result[dimensions[i]] = parts[i]
    }

    return result
  }

  private truncateTime(timestamp: number, granularity: TimeGranularity): number {
    const date = new Date(timestamp)

    switch (granularity) {
      case 'minute':
        date.setUTCSeconds(0, 0)
        break
      case 'hour':
        date.setUTCMinutes(0, 0, 0)
        break
      case 'day':
        date.setUTCHours(0, 0, 0, 0)
        break
      case 'week': {
        date.setUTCHours(0, 0, 0, 0)
        const day = date.getUTCDay()
        const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1)
        date.setUTCDate(diff)
        break
      }
      case 'month':
        date.setUTCDate(1)
        date.setUTCHours(0, 0, 0, 0)
        break
      case 'year':
        date.setUTCMonth(0, 1)
        date.setUTCHours(0, 0, 0, 0)
        break
    }

    return date.getTime()
  }

  private handleWindowTrigger(window: Window, elements: BusinessEvent[]): void {
    if (!this.windowCompleteCallback) return

    const config = this.aggregationConfig || { aggregations: ['count'] as AggregationType[] }
    const aggregations = config.aggregations || ['count']

    const result: AggregationResult = {
      window,
      ...this.computeAggregations(elements, aggregations, config.valueField),
    }

    // Add grouped results if groupBy is configured
    if (config.groupBy && config.groupBy.length > 0) {
      const groups = this.groupBy(elements, config.groupBy)
      result.groups = {}

      for (const [key, groupEvents] of Object.entries(groups)) {
        result.groups[key] = this.computeAggregations(groupEvents, aggregations, config.valueField)
      }
    }

    // Clear pending events that belong to this window
    this.pendingEvents = this.pendingEvents.filter((event) => {
      const eventTime = event.when.getTime()
      return eventTime < window.start || eventTime >= window.end
    })

    this.windowCompleteCallback(result)
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Factory function to create an EventAggregator instance
 */
export function createEventAggregator(config?: AggregationConfig): EventAggregator {
  return new EventAggregator(config)
}
