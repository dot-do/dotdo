/**
 * @dotdo/influxdb - Downsampling using WindowManager
 *
 * Continuous queries and downsampling backed by the WindowManager primitive.
 * Supports tumbling window aggregations for time-series data rollup.
 */

import {
  WindowManager,
  EventTimeTrigger,
  minutes,
  hours,
  seconds,
  type Duration,
} from '../../primitives/window-manager'
import type { StoredPoint } from './storage'

// ============================================================================
// Types
// ============================================================================

/**
 * Aggregation functions supported by continuous queries
 */
export type AggregationFunction = 'mean' | 'sum' | 'count' | 'min' | 'max' | 'first' | 'last'

/**
 * Configuration for a continuous query
 */
export interface ContinuousQueryConfig {
  /** Name of the continuous query */
  name: string
  /** Source bucket to read from */
  sourceBucket: string
  /** Destination bucket to write aggregated results */
  destinationBucket: string
  /** Measurement to aggregate */
  measurement: string
  /** Window size (e.g., '1m', '5m', '1h') */
  windowSize: string
  /** Aggregation function */
  aggregation: AggregationFunction
  /** Tags to group by (preserves in output) */
  groupBy?: string[]
  /** Callback when aggregated result is ready */
  onResult?: (point: StoredPoint) => void
}

/**
 * Configuration for downsampling rules
 */
export interface DownsampleConfig extends ContinuousQueryConfig {
  // Alias for ContinuousQueryConfig
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a duration string to a Duration object
 */
function parseDuration(durationStr: string): Duration {
  const match = durationStr.match(/^(\d+)(s|m|h)$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${durationStr}`)
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2]!

  switch (unit) {
    case 's':
      return seconds(value)
    case 'm':
      return minutes(value)
    case 'h':
      return hours(value)
    default:
      throw new Error(`Unknown duration unit: ${unit}`)
  }
}

/**
 * Create a group key from tags
 */
function createGroupKey(point: StoredPoint, groupBy?: string[]): string {
  if (!groupBy || groupBy.length === 0) {
    return point.measurement
  }

  const tagParts = groupBy
    .filter((key) => point.tags[key] !== undefined)
    .map((key) => `${key}=${point.tags[key]}`)
    .sort()

  return `${point.measurement}:${tagParts.join(',')}`
}

/**
 * Extract tags for a group key
 */
function extractGroupTags(point: StoredPoint, groupBy?: string[]): Record<string, string> {
  if (!groupBy || groupBy.length === 0) {
    return { ...point.tags }
  }

  const tags: Record<string, string> = {}
  for (const key of groupBy) {
    if (point.tags[key] !== undefined) {
      tags[key] = point.tags[key]
    }
  }
  return tags
}

// ============================================================================
// ContinuousQuery
// ============================================================================

/**
 * A continuous query that aggregates data in time windows
 *
 * Uses WindowManager with tumbling windows and EventTimeTrigger
 * to perform real-time aggregation as data arrives.
 */
export class ContinuousQuery {
  private config: ContinuousQueryConfig
  private windowManagers: Map<string, WindowManager<StoredPoint>> = new Map()
  private windowDuration: Duration
  private results: Map<string, Map<string, StoredPoint[]>> = new Map() // groupKey -> windowKey -> points

  constructor(config: ContinuousQueryConfig) {
    this.config = config
    this.windowDuration = parseDuration(config.windowSize)
  }

  /**
   * Process an incoming point
   */
  process(point: StoredPoint): void {
    if (point.measurement !== this.config.measurement) {
      return
    }

    const groupKey = createGroupKey(point, this.config.groupBy)

    // Get or create window manager for this group
    let wm = this.windowManagers.get(groupKey)
    if (!wm) {
      wm = new WindowManager<StoredPoint>(WindowManager.tumbling<StoredPoint>(this.windowDuration))
      wm.withTrigger(new EventTimeTrigger<StoredPoint>())

      // Set up trigger callback
      wm.onTrigger((window, elements) => {
        this.handleWindowTrigger(groupKey, window, elements)
      })

      this.windowManagers.set(groupKey, wm)
    }

    wm.process(point, point.timestamp)
  }

  /**
   * Advance time to trigger windows
   */
  advanceTime(timestamp: number): void {
    for (const wm of this.windowManagers.values()) {
      wm.advanceWatermark(timestamp)
    }
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    for (const wm of this.windowManagers.values()) {
      wm.dispose()
    }
    this.windowManagers.clear()
    this.results.clear()
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private handleWindowTrigger(
    groupKey: string,
    window: { start: number; end: number },
    elements: StoredPoint[]
  ): void {
    if (elements.length === 0) return

    // Get representative point for tags
    const representative = elements[0]!
    const tags = extractGroupTags(representative, this.config.groupBy)

    // Aggregate each field
    const aggregatedFields: Record<string, number> = {}
    const fieldNames = new Set<string>()
    elements.forEach((p) =>
      Object.keys(p.fields).forEach((f) => {
        if (typeof p.fields[f] === 'number') {
          fieldNames.add(f)
        }
      })
    )

    for (const fieldName of fieldNames) {
      const values = elements
        .map((p) => p.fields[fieldName])
        .filter((v): v is number => typeof v === 'number')

      if (values.length > 0) {
        aggregatedFields[fieldName] = this.aggregate(values, this.config.aggregation)
      }
    }

    const result: StoredPoint = {
      measurement: this.config.measurement,
      tags,
      fields: aggregatedFields,
      timestamp: window.start,
    }

    if (this.config.onResult) {
      this.config.onResult(result)
    }
  }

  private aggregate(values: number[], fn: AggregationFunction): number {
    if (values.length === 0) return NaN

    switch (fn) {
      case 'mean':
        return values.reduce((a, b) => a + b, 0) / values.length

      case 'sum':
        return values.reduce((a, b) => a + b, 0)

      case 'count':
        return values.length

      case 'min':
        return Math.min(...values)

      case 'max':
        return Math.max(...values)

      case 'first':
        return values[0]!

      case 'last':
        return values[values.length - 1]!

      default:
        throw new Error(`Unknown aggregation function: ${fn}`)
    }
  }
}

// ============================================================================
// DownsampleManager
// ============================================================================

/**
 * Manages multiple downsampling rules
 *
 * Routes incoming data to appropriate ContinuousQuery instances
 * based on source bucket and measurement.
 */
export class DownsampleManager {
  private rules: Map<string, ContinuousQuery> = new Map()
  private ruleConfigs: Map<string, DownsampleConfig> = new Map()

  /**
   * Create a new downsampling rule
   */
  createRule(config: DownsampleConfig): void {
    if (this.rules.has(config.name)) {
      throw new Error(`Rule '${config.name}' already exists`)
    }

    const cq = new ContinuousQuery(config)
    this.rules.set(config.name, cq)
    this.ruleConfigs.set(config.name, config)
  }

  /**
   * Remove a downsampling rule
   */
  removeRule(name: string): void {
    const cq = this.rules.get(name)
    if (cq) {
      cq.dispose()
      this.rules.delete(name)
      this.ruleConfigs.delete(name)
    }
  }

  /**
   * List all configured rules
   */
  listRules(): DownsampleConfig[] {
    return Array.from(this.ruleConfigs.values())
  }

  /**
   * Process a point through matching rules
   *
   * @param bucket - The source bucket the point is from
   * @param point - The data point
   */
  process(bucket: string, point: StoredPoint): void {
    for (const [name, config] of this.ruleConfigs) {
      if (config.sourceBucket === bucket && config.measurement === point.measurement) {
        const cq = this.rules.get(name)
        if (cq) {
          cq.process(point)
        }
      }
    }
  }

  /**
   * Advance time for all rules
   */
  advanceTime(timestamp: number): void {
    for (const cq of this.rules.values()) {
      cq.advanceTime(timestamp)
    }
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    for (const cq of this.rules.values()) {
      cq.dispose()
    }
    this.rules.clear()
    this.ruleConfigs.clear()
  }
}
