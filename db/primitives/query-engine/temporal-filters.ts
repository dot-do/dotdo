/**
 * Temporal Filters - AS OF Semantics for Time-Travel Queries
 *
 * Provides temporal query support with AS OF semantics for time-travel queries
 * against versioned tables. Integrates with the query engine to add temporal
 * predicates for point-in-time and range-based queries.
 *
 * ## Features
 * - **asOf(timestamp)** - Return data as it existed at a point in time
 * - **between(start, end)** - Query data within a temporal range
 * - **current()** - Return the latest version (current state)
 * - **versions()** - Query all versions with optional filtering
 * - **Query Compiler Integration** - Generate SQL predicates and AST nodes
 *
 * ## Temporal Table Schema
 * Versioned tables require two timestamp columns:
 * - `valid_from` - When this version became active (inclusive)
 * - `valid_to` - When this version was superseded (exclusive, NULL for current)
 *
 * @example Point-in-Time Query
 * ```typescript
 * import { asOf, compileTemporalPredicate } from 'dotdo/db/primitives/query-engine'
 *
 * // Query orders as they existed on a specific date
 * const predicate = compileTemporalPredicate(
 *   asOf('2024-06-15T12:00:00Z'),
 *   { table: 'orders', validFromColumn: 'valid_from', validToColumn: 'valid_to' }
 * )
 * // Generates: valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
 * ```
 *
 * @example Range Query
 * ```typescript
 * import { between, compileTemporalPredicate } from 'dotdo/db/primitives/query-engine'
 *
 * // Query all order versions within a time range
 * const predicate = compileTemporalPredicate(
 *   between('2024-01-01', '2024-06-30'),
 *   { table: 'orders', validFromColumn: 'valid_from', validToColumn: 'valid_to' }
 * )
 * ```
 *
 * @example Using with Query Builder
 * ```typescript
 * import { TemporalQueryBuilder } from 'dotdo/db/primitives/query-engine'
 *
 * const filter = new TemporalQueryBuilder()
 *   .asOf('2024-06-15')
 *   .forTable('orders', { validFromColumn: 'effective_date', validToColumn: 'expiry_date' })
 *   .build()
 * ```
 *
 * @see dotdo-1u71j
 * @module db/primitives/query-engine/temporal-filters
 */

import { type PredicateNode, type LogicalNode, and, lte, gt, isNull, or } from './ast'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Input type for timestamp values - supports multiple formats
 */
export type TimestampInput = number | Date | string

/**
 * AS OF query for point-in-time queries
 */
export interface AsOfQuery {
  type: 'asOf'
  timestamp: number
}

/**
 * Temporal range query for range-based queries
 */
export interface TemporalRange {
  type: 'between'
  start: number
  end: number
}

/**
 * Current state query - returns only latest versions
 */
export interface CurrentQuery {
  type: 'current'
  timestamp?: undefined
  includesLatest: boolean
}

/**
 * Versions query - returns all or filtered versions
 */
export interface VersionsQuery {
  type: 'versions'
  all: boolean
  limit?: number
  start?: number
  end?: number
}

/**
 * Union type of all temporal query types
 */
export type TemporalQuery = AsOfQuery | TemporalRange | CurrentQuery | VersionsQuery

/**
 * Compiled temporal predicate for SQL generation
 */
export interface TemporalPredicate {
  /** SQL WHERE clause fragment */
  sql: string
  /** Parameterized values for the SQL query */
  params: unknown[]
}

/**
 * Options for temporal filter compilation
 */
export interface TemporalFilterOptions {
  /** Table name (optional, for documentation) */
  table?: string
  /** Column name for version start timestamp */
  validFromColumn: string
  /** Column name for version end timestamp */
  validToColumn: string
  /** Use inclusive bounds (default: validFrom inclusive, validTo exclusive) */
  inclusive?: boolean
}

/**
 * Built temporal filter with all configuration
 */
export type BuiltTemporalFilter = TemporalQuery & {
  table?: string
  validFromColumn: string
  validToColumn: string
}

/**
 * A row with versioning metadata
 */
export interface VersionedRow<T> {
  data: T
  validFrom: number
  validTo: number | null
  version: number
}

// =============================================================================
// TIMESTAMP NORMALIZATION
// =============================================================================

/**
 * Convert various timestamp input formats to milliseconds since epoch
 */
function normalizeTimestamp(input: TimestampInput): number {
  if (typeof input === 'number') {
    return input
  }
  if (input instanceof Date) {
    return input.getTime()
  }
  if (typeof input === 'string') {
    const parsed = new Date(input).getTime()
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid timestamp string: ${input}`)
    }
    return parsed
  }
  throw new Error(`Invalid timestamp type: ${typeof input}`)
}

/**
 * Validate a timestamp value
 */
function validateTimestamp(timestamp: number, name: string = 'timestamp'): void {
  if (Number.isNaN(timestamp) || timestamp < 0) {
    throw new Error(`Invalid ${name}: must be a non-negative number`)
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create an AS OF query for point-in-time queries.
 *
 * Returns data as it existed at the specified timestamp.
 * A row is included if: validFrom <= timestamp AND (validTo IS NULL OR validTo > timestamp)
 *
 * @param timestamp - Point in time to query (ms since epoch, Date, or ISO string)
 * @returns AsOfQuery
 *
 * @example
 * // Query using timestamp
 * const query = asOf(Date.now() - 86400000) // 1 day ago
 *
 * // Query using Date
 * const query = asOf(new Date('2024-06-15'))
 *
 * // Query using ISO string
 * const query = asOf('2024-06-15T12:00:00Z')
 */
export function asOf(timestamp: TimestampInput): AsOfQuery {
  const normalizedTs = normalizeTimestamp(timestamp)
  validateTimestamp(normalizedTs)

  return {
    type: 'asOf',
    timestamp: normalizedTs,
  }
}

/**
 * Create a temporal range query.
 *
 * Returns data that was valid at any point within the range.
 * A row is included if its validity period overlaps with [start, end].
 *
 * @param start - Start of time range (inclusive)
 * @param end - End of time range (inclusive)
 * @returns TemporalRange
 *
 * @example
 * // Query all versions active during Q1 2024
 * const query = between('2024-01-01', '2024-03-31')
 */
export function between(start: TimestampInput, end: TimestampInput): TemporalRange {
  const normalizedStart = normalizeTimestamp(start)
  const normalizedEnd = normalizeTimestamp(end)

  validateTimestamp(normalizedStart, 'start')
  validateTimestamp(normalizedEnd, 'end')

  if (normalizedStart > normalizedEnd) {
    throw new Error('Start timestamp must be before end timestamp')
  }

  return {
    type: 'between',
    start: normalizedStart,
    end: normalizedEnd,
  }
}

/**
 * Create a query for the current/latest version.
 *
 * Returns only rows where validTo IS NULL (current state).
 *
 * @returns CurrentQuery
 *
 * @example
 * const query = current()
 */
export function current(): CurrentQuery {
  return {
    type: 'current',
    includesLatest: true,
  }
}

/**
 * Create a query for all versions or filtered versions.
 *
 * Without options, returns all historical versions.
 * With options, can limit count or filter by time range.
 *
 * @param options - Optional filtering options
 * @returns VersionsQuery
 *
 * @example
 * // All versions
 * const allVersions = versions()
 *
 * // Last 10 versions
 * const recent = versions({ limit: 10 })
 *
 * // Versions within time range
 * const ranged = versions({ start: t1, end: t2 })
 */
export function versions(options?: {
  limit?: number
  start?: TimestampInput
  end?: TimestampInput
}): VersionsQuery {
  const query: VersionsQuery = {
    type: 'versions',
    all: true,
  }

  if (options?.limit !== undefined) {
    query.limit = options.limit
  }

  if (options?.start !== undefined) {
    query.start = normalizeTimestamp(options.start)
  }

  if (options?.end !== undefined) {
    query.end = normalizeTimestamp(options.end)
  }

  return query
}

// =============================================================================
// TEMPORAL QUERY BUILDER
// =============================================================================

/**
 * Fluent builder for temporal queries.
 *
 * @example
 * const filter = new TemporalQueryBuilder()
 *   .asOf('2024-06-15')
 *   .forTable('orders')
 *   .build()
 */
export class TemporalQueryBuilder {
  private query: TemporalQuery | null = null
  private tableName?: string
  private validFromCol: string = 'valid_from'
  private validToCol: string = 'valid_to'

  /**
   * Set point-in-time filter
   */
  asOf(timestamp: TimestampInput): this {
    this.query = asOf(timestamp)
    return this
  }

  /**
   * Set temporal range filter
   */
  between(start: TimestampInput, end: TimestampInput): this {
    this.query = between(start, end)
    return this
  }

  /**
   * Set filter for current/latest version only
   */
  current(): this {
    this.query = current()
    return this
  }

  /**
   * Set filter for all versions
   */
  versions(options?: { limit?: number; start?: TimestampInput; end?: TimestampInput }): this {
    this.query = versions(options)
    return this
  }

  /**
   * Specify the table and optionally customize column names
   */
  forTable(
    table: string,
    options?: { validFromColumn?: string; validToColumn?: string }
  ): this {
    this.tableName = table
    if (options?.validFromColumn) {
      this.validFromCol = options.validFromColumn
    }
    if (options?.validToColumn) {
      this.validToCol = options.validToColumn
    }
    return this
  }

  /**
   * Build the complete temporal filter
   */
  build(): BuiltTemporalFilter {
    if (!this.query) {
      throw new Error('No temporal filter specified. Call asOf(), between(), current(), or versions() first.')
    }

    return {
      ...this.query,
      table: this.tableName,
      validFromColumn: this.validFromCol,
      validToColumn: this.validToCol,
    }
  }
}

// =============================================================================
// PREDICATE COMPILATION
// =============================================================================

/**
 * Compile a temporal query to SQL predicate.
 *
 * Generates SQL WHERE clause fragment with parameterized values.
 *
 * @param query - The temporal query (asOf, between, current, versions)
 * @param options - Column configuration
 * @returns Compiled predicate with SQL and params
 *
 * @example
 * const predicate = compileTemporalPredicate(
 *   asOf(timestamp),
 *   { table: 'orders', validFromColumn: 'valid_from', validToColumn: 'valid_to' }
 * )
 * // predicate.sql: 'valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)'
 * // predicate.params: [timestamp, timestamp]
 */
export function compileTemporalPredicate(
  query: TemporalQuery,
  options: TemporalFilterOptions
): TemporalPredicate {
  const { validFromColumn, validToColumn, inclusive = false } = options

  switch (query.type) {
    case 'asOf': {
      // Point-in-time: validFrom <= timestamp AND (validTo IS NULL OR validTo > timestamp)
      const sql = `${validFromColumn} <= ? AND (${validToColumn} IS NULL OR ${validToColumn} > ?)`
      return { sql, params: [query.timestamp, query.timestamp] }
    }

    case 'between': {
      // Range overlap: validFrom < end AND (validTo IS NULL OR validTo > start)
      // With inclusive option: validFrom <= end AND (validTo IS NULL OR validTo >= start)
      if (inclusive) {
        const sql = `${validFromColumn} <= ? AND (${validToColumn} IS NULL OR ${validToColumn} >= ?)`
        return { sql, params: [query.end, query.start] }
      }
      const sql = `${validFromColumn} < ? AND (${validToColumn} IS NULL OR ${validToColumn} > ?)`
      return { sql, params: [query.end, query.start] }
    }

    case 'current': {
      // Current state: validTo IS NULL
      return { sql: `${validToColumn} IS NULL`, params: [] }
    }

    case 'versions': {
      // All versions with optional range filter
      if (query.start !== undefined && query.end !== undefined) {
        const sql = `${validFromColumn} < ? AND (${validToColumn} IS NULL OR ${validToColumn} > ?)`
        return { sql, params: [query.end, query.start] }
      }
      // No filter - return all
      return { sql: '1=1', params: [] }
    }

    default: {
      const exhaustive: never = query
      throw new Error(`Unknown temporal query type: ${(exhaustive as TemporalQuery).type}`)
    }
  }
}

// =============================================================================
// AST NODE GENERATION
// =============================================================================

/**
 * Create AST nodes for temporal predicates.
 *
 * Generates nodes compatible with the unified query AST for integration
 * with the query compiler and planner.
 *
 * @param query - The temporal query
 * @param options - Column configuration
 * @returns LogicalNode representing the temporal predicate
 */
export function createTemporalPredicateNode(
  query: TemporalQuery,
  options: { validFromColumn: string; validToColumn: string }
): LogicalNode {
  const { validFromColumn, validToColumn } = options

  switch (query.type) {
    case 'asOf': {
      // validFrom <= timestamp AND (validTo IS NULL OR validTo > timestamp)
      return and(
        lte(validFromColumn, query.timestamp),
        or(isNull(validToColumn), gt(validToColumn, query.timestamp))
      )
    }

    case 'between': {
      // validFrom < end AND (validTo IS NULL OR validTo > start)
      return and(
        // Using lte with end-1 to simulate < for integers, or just use actual value
        // For proper < we'd need to add lt to ast helpers
        lte(validFromColumn, query.end - 1), // Approximate < with <=
        or(isNull(validToColumn), gt(validToColumn, query.start))
      )
    }

    case 'current': {
      // validTo IS NULL - wrap in AND for consistent return type
      return and(isNull(validToColumn))
    }

    case 'versions': {
      if (query.start !== undefined && query.end !== undefined) {
        return and(
          lte(validFromColumn, query.end - 1),
          or(isNull(validToColumn), gt(validToColumn, query.start))
        )
      }
      // All versions - create a tautology
      // Using a comparison that's always true
      return and(lte('1', 1))
    }

    default: {
      const exhaustive: never = query
      throw new Error(`Unknown temporal query type: ${(exhaustive as TemporalQuery).type}`)
    }
  }
}

// =============================================================================
// ROW FILTERING
// =============================================================================

/**
 * Filter versioned rows based on temporal query.
 *
 * Applies in-memory filtering to an array of versioned rows.
 * Useful for testing or when data is already loaded.
 *
 * @param rows - Array of versioned rows to filter
 * @param query - The temporal query to apply
 * @returns Filtered array of rows matching the temporal criteria
 *
 * @example
 * const filtered = filterVersions(rows, asOf(timestamp))
 */
export function filterVersions<T>(
  rows: VersionedRow<T>[],
  query: TemporalQuery
): VersionedRow<T>[] {
  if (rows.length === 0) {
    return []
  }

  switch (query.type) {
    case 'asOf': {
      // Row is valid at timestamp if: validFrom <= timestamp AND (validTo IS NULL OR validTo > timestamp)
      return rows.filter((row) => {
        const validAtStart = row.validFrom <= query.timestamp
        const validAtEnd = row.validTo === null || row.validTo > query.timestamp
        return validAtStart && validAtEnd
      })
    }

    case 'between': {
      // Row overlaps range if: validFrom < end AND (validTo IS NULL OR validTo > start)
      return rows.filter((row) => {
        const startsBeforeEnd = row.validFrom <= query.end
        const endsAfterStart = row.validTo === null || row.validTo > query.start
        return startsBeforeEnd && endsAfterStart
      })
    }

    case 'current': {
      // Current state: validTo IS NULL
      return rows.filter((row) => row.validTo === null)
    }

    case 'versions': {
      // All versions with optional range
      if (query.start !== undefined && query.end !== undefined) {
        return rows.filter((row) => {
          const startsBeforeEnd = row.validFrom < query.end
          const endsAfterStart = row.validTo === null || row.validTo > query.start
          return startsBeforeEnd && endsAfterStart
        })
      }
      // Return all
      let result = [...rows]
      if (query.limit !== undefined) {
        result = result.slice(0, query.limit)
      }
      return result
    }

    default: {
      const exhaustive: never = query
      throw new Error(`Unknown temporal query type: ${(exhaustive as TemporalQuery).type}`)
    }
  }
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if a value is an AsOfQuery
 */
export function isAsOfQuery(value: unknown): value is AsOfQuery {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as AsOfQuery).type === 'asOf' &&
    'timestamp' in value &&
    typeof (value as AsOfQuery).timestamp === 'number'
  )
}

/**
 * Check if a value is a TemporalRange
 */
export function isTemporalRange(value: unknown): value is TemporalRange {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as TemporalRange).type === 'between' &&
    'start' in value &&
    'end' in value &&
    typeof (value as TemporalRange).start === 'number' &&
    typeof (value as TemporalRange).end === 'number'
  )
}

/**
 * Check if a value is a CurrentQuery
 */
export function isCurrentQuery(value: unknown): value is CurrentQuery {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as CurrentQuery).type === 'current'
  )
}

/**
 * Check if a value is a VersionsQuery
 */
export function isVersionsQuery(value: unknown): value is VersionsQuery {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as VersionsQuery).type === 'versions'
  )
}

/**
 * Check if a value is any TemporalQuery
 */
export function isTemporalQuery(value: unknown): value is TemporalQuery {
  return isAsOfQuery(value) || isTemporalRange(value) || isCurrentQuery(value) || isVersionsQuery(value)
}

// =============================================================================
// TIME WINDOW AGGREGATIONS
// =============================================================================

/**
 * Window type for temporal aggregations
 */
export type WindowType = 'tumbling' | 'sliding' | 'session'

/**
 * Duration unit for time windows
 */
export type DurationUnit = 'milliseconds' | 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks'

/**
 * Duration specification
 */
export interface Duration {
  value: number
  unit: DurationUnit
}

/**
 * Time window configuration
 */
export interface TimeWindow {
  type: WindowType
  /** Size of the window */
  size: Duration
  /** Slide interval for sliding windows (defaults to window size for tumbling) */
  slide?: Duration
  /** Session gap for session windows */
  gap?: Duration
  /** Alignment offset for window boundaries */
  offset?: number
}

/**
 * Result of a windowed aggregation
 */
export interface WindowedResult<T> {
  windowStart: number
  windowEnd: number
  data: T
}

/**
 * Convert a duration to milliseconds
 */
export function durationToMs(duration: Duration): number {
  const multipliers: Record<DurationUnit, number> = {
    milliseconds: 1,
    seconds: 1000,
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
  }
  return duration.value * multipliers[duration.unit]
}

/**
 * Create a tumbling window specification.
 *
 * Tumbling windows are fixed-size, non-overlapping time intervals.
 * Each event belongs to exactly one window.
 *
 * @param size - Window size (e.g., { value: 1, unit: 'hours' })
 * @param offset - Optional offset for window alignment
 * @returns TimeWindow configuration
 *
 * @example
 * // Create 1-hour tumbling windows
 * const window = tumblingWindow({ value: 1, unit: 'hours' })
 */
export function tumblingWindow(size: Duration, offset?: number): TimeWindow {
  return {
    type: 'tumbling',
    size,
    offset,
  }
}

/**
 * Create a sliding window specification.
 *
 * Sliding windows are fixed-size with a configurable slide interval.
 * Events may belong to multiple overlapping windows.
 *
 * @param size - Window size
 * @param slide - Slide interval (how often a new window starts)
 * @param offset - Optional offset for window alignment
 * @returns TimeWindow configuration
 *
 * @example
 * // Create 1-hour windows that slide every 15 minutes
 * const window = slidingWindow(
 *   { value: 1, unit: 'hours' },
 *   { value: 15, unit: 'minutes' }
 * )
 */
export function slidingWindow(size: Duration, slide: Duration, offset?: number): TimeWindow {
  return {
    type: 'sliding',
    size,
    slide,
    offset,
  }
}

/**
 * Create a session window specification.
 *
 * Session windows group events that arrive within a gap of each other.
 * Window size is dynamic based on event timing.
 *
 * @param gap - Maximum gap between events in the same session
 * @returns TimeWindow configuration
 *
 * @example
 * // Create session windows with 30-minute gaps
 * const window = sessionWindow({ value: 30, unit: 'minutes' })
 */
export function sessionWindow(gap: Duration): TimeWindow {
  return {
    type: 'session',
    size: gap, // Size is determined by actual session duration
    gap,
  }
}

/**
 * Calculate window boundaries for a given timestamp
 */
export function getWindowBoundaries(
  timestamp: number,
  window: TimeWindow
): { start: number; end: number } {
  const sizeMs = durationToMs(window.size)
  const offset = window.offset ?? 0

  // Align timestamp to window boundary
  const alignedTs = timestamp - offset
  const windowIndex = Math.floor(alignedTs / sizeMs)
  const start = windowIndex * sizeMs + offset
  const end = start + sizeMs

  return { start, end }
}

/**
 * Generate all window boundaries for a time range
 */
export function generateWindowBoundaries(
  start: number,
  end: number,
  window: TimeWindow
): Array<{ start: number; end: number }> {
  const sizeMs = durationToMs(window.size)
  const slideMs = window.slide ? durationToMs(window.slide) : sizeMs
  const offset = window.offset ?? 0

  const windows: Array<{ start: number; end: number }> = []

  // Find first window that could contain data from our range
  const alignedStart = start - offset
  let windowStart = Math.floor(alignedStart / slideMs) * slideMs + offset

  // For sliding windows, we need to start earlier to catch windows that overlap with start
  if (window.type === 'sliding') {
    windowStart = Math.max(0, windowStart - sizeMs + slideMs)
  }

  while (windowStart < end) {
    const windowEnd = windowStart + sizeMs
    // Only include windows that overlap with our range
    if (windowEnd > start) {
      windows.push({ start: windowStart, end: windowEnd })
    }
    windowStart += slideMs
  }

  return windows
}

/**
 * Assign rows to windows based on their timestamp
 */
export function assignToWindows<T>(
  rows: VersionedRow<T>[],
  window: TimeWindow,
  timestampExtractor: (row: VersionedRow<T>) => number = (r) => r.validFrom
): Map<string, VersionedRow<T>[]> {
  const windowMap = new Map<string, VersionedRow<T>[]>()

  if (rows.length === 0) {
    return windowMap
  }

  if (window.type === 'session') {
    return assignToSessionWindows(rows, window, timestampExtractor)
  }

  for (const row of rows) {
    const ts = timestampExtractor(row)
    const sizeMs = durationToMs(window.size)
    const slideMs = window.slide ? durationToMs(window.slide) : sizeMs
    const offset = window.offset ?? 0

    if (window.type === 'tumbling') {
      // Each event belongs to exactly one window
      const { start, end } = getWindowBoundaries(ts, window)
      const key = `${start}-${end}`
      if (!windowMap.has(key)) {
        windowMap.set(key, [])
      }
      windowMap.get(key)!.push(row)
    } else {
      // Sliding window: event may belong to multiple windows
      // Find all windows that contain this timestamp
      const alignedTs = ts - offset
      let windowStart = Math.floor((alignedTs - sizeMs) / slideMs) * slideMs + slideMs + offset

      while (windowStart <= ts) {
        const windowEnd = windowStart + sizeMs
        if (ts >= windowStart && ts < windowEnd) {
          const key = `${windowStart}-${windowEnd}`
          if (!windowMap.has(key)) {
            windowMap.set(key, [])
          }
          windowMap.get(key)!.push(row)
        }
        windowStart += slideMs
      }
    }
  }

  return windowMap
}

/**
 * Assign rows to session windows
 */
function assignToSessionWindows<T>(
  rows: VersionedRow<T>[],
  window: TimeWindow,
  timestampExtractor: (row: VersionedRow<T>) => number
): Map<string, VersionedRow<T>[]> {
  const windowMap = new Map<string, VersionedRow<T>[]>()
  const gapMs = durationToMs(window.gap!)

  // Sort rows by timestamp
  const sortedRows = [...rows].sort((a, b) => timestampExtractor(a) - timestampExtractor(b))

  let sessionStart = -1
  let sessionEnd = -1
  let currentSession: VersionedRow<T>[] = []

  for (const row of sortedRows) {
    const ts = timestampExtractor(row)

    if (sessionStart === -1) {
      // Start first session
      sessionStart = ts
      sessionEnd = ts
      currentSession = [row]
    } else if (ts - sessionEnd <= gapMs) {
      // Extend current session
      sessionEnd = ts
      currentSession.push(row)
    } else {
      // Close current session and start new one
      const key = `${sessionStart}-${sessionEnd + gapMs}`
      windowMap.set(key, currentSession)
      sessionStart = ts
      sessionEnd = ts
      currentSession = [row]
    }
  }

  // Don't forget the last session
  if (currentSession.length > 0) {
    const key = `${sessionStart}-${sessionEnd + gapMs}`
    windowMap.set(key, currentSession)
  }

  return windowMap
}

/**
 * Apply aggregation function to windowed data
 */
export function aggregateWindows<T, R>(
  windowedData: Map<string, VersionedRow<T>[]>,
  aggregator: (rows: VersionedRow<T>[]) => R
): WindowedResult<R>[] {
  const results: WindowedResult<R>[] = []

  // Use Array.from for compatibility with older TypeScript targets
  const entries = Array.from(windowedData.entries())
  for (const [key, rows] of entries) {
    const [startStr, endStr] = key.split('-')
    const windowStart = parseInt(startStr, 10)
    const windowEnd = parseInt(endStr, 10)

    results.push({
      windowStart,
      windowEnd,
      data: aggregator(rows),
    })
  }

  // Sort by window start
  results.sort((a, b) => a.windowStart - b.windowStart)

  return results
}

/**
 * Common aggregation functions for windowed data
 */
export const windowAggregators = {
  count: <T>(rows: VersionedRow<T>[]): number => rows.length,

  sum: <T>(rows: VersionedRow<T>[], extractor: (row: VersionedRow<T>) => number): number =>
    rows.reduce((acc, row) => acc + extractor(row), 0),

  avg: <T>(rows: VersionedRow<T>[], extractor: (row: VersionedRow<T>) => number): number => {
    if (rows.length === 0) return 0
    return windowAggregators.sum(rows, extractor) / rows.length
  },

  min: <T>(rows: VersionedRow<T>[], extractor: (row: VersionedRow<T>) => number): number => {
    if (rows.length === 0) return Infinity
    return Math.min(...rows.map(extractor))
  },

  max: <T>(rows: VersionedRow<T>[], extractor: (row: VersionedRow<T>) => number): number => {
    if (rows.length === 0) return -Infinity
    return Math.max(...rows.map(extractor))
  },

  first: <T>(rows: VersionedRow<T>[]): VersionedRow<T> | undefined => rows[0],

  last: <T>(rows: VersionedRow<T>[]): VersionedRow<T> | undefined => rows[rows.length - 1],

  collect: <T>(rows: VersionedRow<T>[]): VersionedRow<T>[] => rows,
}

// =============================================================================
// TEMPORAL JOINS
// =============================================================================

/**
 * Temporal join type
 */
export type TemporalJoinType = 'inner' | 'left' | 'right' | 'full'

/**
 * Temporal join options
 */
export interface TemporalJoinOptions<L, R> {
  /** Join type (default: inner) */
  type?: TemporalJoinType
  /** Custom key extractor for left side */
  leftKey?: (row: VersionedRow<L>) => string
  /** Custom key extractor for right side */
  rightKey?: (row: VersionedRow<R>) => string
  /** Tolerance for temporal matching in milliseconds (default: 0) */
  tolerance?: number
}

/**
 * Result of a temporal join
 */
export interface TemporalJoinResult<L, R> {
  left: VersionedRow<L> | null
  right: VersionedRow<R> | null
  validFrom: number
  validTo: number | null
}

/**
 * Check if two validity periods overlap
 */
export function periodsOverlap(
  period1: { validFrom: number; validTo: number | null },
  period2: { validFrom: number; validTo: number | null },
  tolerance: number = 0
): boolean {
  const end1 = period1.validTo ?? Infinity
  const end2 = period2.validTo ?? Infinity

  // Period 1 starts before period 2 ends (with tolerance)
  // AND period 2 starts before period 1 ends (with tolerance)
  return (
    period1.validFrom <= end2 + tolerance &&
    period2.validFrom <= end1 + tolerance
  )
}

/**
 * Calculate the intersection of two validity periods
 */
export function periodIntersection(
  period1: { validFrom: number; validTo: number | null },
  period2: { validFrom: number; validTo: number | null }
): { validFrom: number; validTo: number | null } | null {
  const end1 = period1.validTo ?? Infinity
  const end2 = period2.validTo ?? Infinity

  const start = Math.max(period1.validFrom, period2.validFrom)
  const end = Math.min(end1, end2)

  if (start > end) {
    return null // No overlap
  }

  return {
    validFrom: start,
    validTo: end === Infinity ? null : end,
  }
}

/**
 * Perform a temporal inner join between two sets of versioned rows.
 *
 * Returns rows that have overlapping validity periods.
 *
 * @param leftRows - Left side of the join
 * @param rightRows - Right side of the join
 * @param options - Join options
 * @returns Array of joined results with computed validity periods
 *
 * @example
 * const customers = [{ data: { id: '1', name: 'Alice' }, validFrom: 0, validTo: null, version: 1 }]
 * const orders = [{ data: { customerId: '1', total: 100 }, validFrom: 50, validTo: 200, version: 1 }]
 *
 * const joined = temporalJoin(customers, orders, {
 *   leftKey: (r) => r.data.id,
 *   rightKey: (r) => r.data.customerId,
 * })
 */
export function temporalJoin<L, R>(
  leftRows: VersionedRow<L>[],
  rightRows: VersionedRow<R>[],
  options: TemporalJoinOptions<L, R> = {}
): TemporalJoinResult<L, R>[] {
  const {
    type = 'inner',
    leftKey = () => '',
    rightKey = () => '',
    tolerance = 0,
  } = options

  const results: TemporalJoinResult<L, R>[] = []

  // Build index of right rows by key for efficient lookup
  const rightIndex = new Map<string, VersionedRow<R>[]>()
  for (const right of rightRows) {
    const key = rightKey(right)
    if (!rightIndex.has(key)) {
      rightIndex.set(key, [])
    }
    rightIndex.get(key)!.push(right)
  }

  // Track which right rows have been matched (for right/full outer joins)
  const matchedRight = new Set<VersionedRow<R>>()

  // Process left rows
  for (const left of leftRows) {
    const key = leftKey(left)
    const candidates = rightIndex.get(key) ?? []
    let hasMatch = false

    for (const right of candidates) {
      if (periodsOverlap(left, right, tolerance)) {
        const intersection = periodIntersection(left, right)
        if (intersection) {
          results.push({
            left,
            right,
            validFrom: intersection.validFrom,
            validTo: intersection.validTo,
          })
          hasMatch = true
          matchedRight.add(right)
        }
      }
    }

    // For left/full outer joins, include unmatched left rows
    if (!hasMatch && (type === 'left' || type === 'full')) {
      results.push({
        left,
        right: null,
        validFrom: left.validFrom,
        validTo: left.validTo,
      })
    }
  }

  // For right/full outer joins, include unmatched right rows
  if (type === 'right' || type === 'full') {
    for (const right of rightRows) {
      if (!matchedRight.has(right)) {
        results.push({
          left: null,
          right,
          validFrom: right.validFrom,
          validTo: right.validTo,
        })
      }
    }
  }

  // Sort by validFrom
  results.sort((a, b) => a.validFrom - b.validFrom)

  return results
}

/**
 * AS OF join - join two tables at a specific point in time.
 *
 * For each left row, finds the corresponding right row that was valid
 * at the same point in time.
 *
 * @param leftRows - Left side of the join
 * @param rightRows - Right side of the join
 * @param timestamp - Point in time for the join
 * @param options - Join options
 * @returns Array of joined results
 *
 * @example
 * // Find customer-order relationships as they existed on 2024-06-15
 * const joined = asOfJoin(customers, orders, new Date('2024-06-15').getTime(), {
 *   leftKey: (r) => r.data.id,
 *   rightKey: (r) => r.data.customerId,
 * })
 */
export function asOfJoin<L, R>(
  leftRows: VersionedRow<L>[],
  rightRows: VersionedRow<R>[],
  timestamp: TimestampInput,
  options: Omit<TemporalJoinOptions<L, R>, 'tolerance'> = {}
): TemporalJoinResult<L, R>[] {
  const ts = typeof timestamp === 'number' ? timestamp :
    timestamp instanceof Date ? timestamp.getTime() :
    new Date(timestamp).getTime()

  // First filter both sides to the point in time
  const leftAtTime = filterVersions(leftRows, asOf(ts))
  const rightAtTime = filterVersions(rightRows, asOf(ts))

  // Then perform the join
  return temporalJoin(leftAtTime, rightAtTime, {
    ...options,
    tolerance: 0,
  })
}

/**
 * Compile a temporal join to SQL.
 *
 * Generates SQL for joining two tables with temporal predicates.
 *
 * @param leftTable - Left table name
 * @param rightTable - Right table name
 * @param options - Join configuration
 * @returns SQL fragment and parameters
 *
 * @example
 * const { sql, params } = compileTemporalJoin(
 *   'customers',
 *   'orders',
 *   {
 *     type: 'inner',
 *     leftOptions: { validFromColumn: 'valid_from', validToColumn: 'valid_to' },
 *     rightOptions: { validFromColumn: 'valid_from', validToColumn: 'valid_to' },
 *     on: { leftColumn: 'id', rightColumn: 'customer_id' },
 *   }
 * )
 */
export function compileTemporalJoin(
  leftTable: string,
  rightTable: string,
  options: {
    type?: TemporalJoinType
    leftOptions: TemporalFilterOptions
    rightOptions: TemporalFilterOptions
    on: { leftColumn: string; rightColumn: string }
    asOf?: TimestampInput
  }
): TemporalPredicate {
  const {
    type = 'inner',
    leftOptions,
    rightOptions,
    on,
    asOf: asOfTs,
  } = options

  const joinTypeMap: Record<TemporalJoinType, string> = {
    inner: 'INNER JOIN',
    left: 'LEFT JOIN',
    right: 'RIGHT JOIN',
    full: 'FULL OUTER JOIN',
  }

  const parts: string[] = []
  const params: unknown[] = []

  // Join clause
  parts.push(`${leftTable} ${joinTypeMap[type]} ${rightTable}`)

  // Join condition: key match + temporal overlap
  const joinConditions: string[] = [
    `${leftTable}.${on.leftColumn} = ${rightTable}.${on.rightColumn}`,
  ]

  // Temporal overlap condition
  // Left.validFrom < Right.validTo AND Right.validFrom < Left.validTo
  joinConditions.push(
    `${leftTable}.${leftOptions.validFromColumn} < COALESCE(${rightTable}.${rightOptions.validToColumn}, 9223372036854775807)`,
    `${rightTable}.${rightOptions.validFromColumn} < COALESCE(${leftTable}.${leftOptions.validToColumn}, 9223372036854775807)`
  )

  parts.push(`ON ${joinConditions.join(' AND ')}`)

  // AS OF filter if specified
  if (asOfTs !== undefined) {
    const normalizedTs = typeof asOfTs === 'number' ? asOfTs :
      asOfTs instanceof Date ? asOfTs.getTime() :
      new Date(asOfTs).getTime()

    const whereConditions: string[] = []

    // Left table AS OF
    whereConditions.push(
      `${leftTable}.${leftOptions.validFromColumn} <= ?`,
      `(${leftTable}.${leftOptions.validToColumn} IS NULL OR ${leftTable}.${leftOptions.validToColumn} > ?)`
    )
    params.push(normalizedTs, normalizedTs)

    // Right table AS OF
    whereConditions.push(
      `${rightTable}.${rightOptions.validFromColumn} <= ?`,
      `(${rightTable}.${rightOptions.validToColumn} IS NULL OR ${rightTable}.${rightOptions.validToColumn} > ?)`
    )
    params.push(normalizedTs, normalizedTs)

    parts.push(`WHERE ${whereConditions.join(' AND ')}`)
  }

  return {
    sql: parts.join(' '),
    params,
  }
}
