/**
 * Temporal Filters Tests - AS OF Semantics for Time-Travel Queries
 *
 * RED Phase: These tests define the expected behavior of temporal query filters.
 * All tests should FAIL until implementation is complete.
 *
 * Temporal filters enable time-travel queries with AS OF semantics:
 * - asOf(timestamp) - Return data as it existed at a point in time
 * - between(start, end) - Query data within a temporal range
 * - current() - Return the latest version (current state)
 * - Integration with query compiler for predicate generation
 *
 * @see dotdo-1u71j
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Types
  type AsOfQuery,
  type TemporalRange,
  type TemporalPredicate,
  type VersionedRow,
  type TemporalFilterOptions,
  // Factory functions
  asOf,
  between,
  current,
  versions,
  // Query builder
  TemporalQueryBuilder,
  // Predicate compiler integration
  compileTemporalPredicate,
  // Type guards
  isAsOfQuery,
  isTemporalRange,
} from '../temporal-filters'

// ============================================================================
// TEST DATA AND HELPERS
// ============================================================================

interface TestRecord {
  id: string
  name: string
  status: string
  amount: number
}

/**
 * Create a sample versioned row for testing
 */
function createVersionedRow(
  data: TestRecord,
  validFrom: number,
  validTo: number | null = null
): VersionedRow<TestRecord> {
  return {
    data,
    validFrom,
    validTo,
    version: 1,
  }
}

/**
 * Generate timestamp for testing (ms since epoch)
 */
function ts(offsetMs: number = 0): number {
  return 1704067200000 + offsetMs // Fixed base: 2024-01-01 00:00:00 UTC
}

// ============================================================================
// AS OF QUERY INTERFACE
// ============================================================================

describe('AsOfQuery Interface', () => {
  describe('asOf() factory function', () => {
    it('should create an AsOfQuery with timestamp', () => {
      const timestamp = ts()
      const query = asOf(timestamp)

      expect(isAsOfQuery(query)).toBe(true)
      expect(query.type).toBe('asOf')
      expect(query.timestamp).toBe(timestamp)
    })

    it('should create an AsOfQuery with Date object', () => {
      const date = new Date('2024-06-15T12:00:00Z')
      const query = asOf(date)

      expect(query.timestamp).toBe(date.getTime())
    })

    it('should create an AsOfQuery with ISO string', () => {
      const isoString = '2024-06-15T12:00:00Z'
      const query = asOf(isoString)

      expect(query.timestamp).toBe(new Date(isoString).getTime())
    })

    it('should throw for invalid timestamp', () => {
      expect(() => asOf(-1)).toThrow('Invalid timestamp')
      expect(() => asOf(NaN)).toThrow('Invalid timestamp')
    })
  })

  describe('between() factory function', () => {
    it('should create a TemporalRange with start and end', () => {
      const start = ts(-1000)
      const end = ts()
      const query = between(start, end)

      expect(isTemporalRange(query)).toBe(true)
      expect(query.type).toBe('between')
      expect(query.start).toBe(start)
      expect(query.end).toBe(end)
    })

    it('should accept Date objects for range', () => {
      const start = new Date('2024-01-01')
      const end = new Date('2024-12-31')
      const query = between(start, end)

      expect(query.start).toBe(start.getTime())
      expect(query.end).toBe(end.getTime())
    })

    it('should throw if start > end', () => {
      const start = ts()
      const end = ts(-1000)

      expect(() => between(start, end)).toThrow('Start timestamp must be before end')
    })

    it('should allow equal start and end (point-in-time range)', () => {
      const point = ts()
      const query = between(point, point)

      expect(query.start).toBe(point)
      expect(query.end).toBe(point)
    })
  })

  describe('current() factory function', () => {
    it('should create a query for current/latest version', () => {
      const query = current()

      expect(query.type).toBe('current')
      expect(query.timestamp).toBeUndefined()
    })

    it('should be the default when no temporal filter specified', () => {
      const query = current()

      expect(query.includesLatest).toBe(true)
    })
  })

  describe('versions() factory function', () => {
    it('should create a query for all versions', () => {
      const query = versions()

      expect(query.type).toBe('versions')
      expect(query.all).toBe(true)
    })

    it('should support limiting version count', () => {
      const query = versions({ limit: 10 })

      expect(query.limit).toBe(10)
    })

    it('should support filtering versions by time range', () => {
      const start = ts(-1000)
      const end = ts()
      const query = versions({ start, end })

      expect(query.start).toBe(start)
      expect(query.end).toBe(end)
    })
  })
})

// ============================================================================
// TEMPORAL QUERY BUILDER
// ============================================================================

describe('TemporalQueryBuilder', () => {
  let builder: TemporalQueryBuilder

  beforeEach(() => {
    builder = new TemporalQueryBuilder()
  })

  describe('asOf() method', () => {
    it('should set point-in-time filter', () => {
      const timestamp = ts()
      builder.asOf(timestamp)

      const filter = builder.build()
      expect(filter.type).toBe('asOf')
      expect(filter.timestamp).toBe(timestamp)
    })

    it('should be chainable', () => {
      const result = builder.asOf(ts()).forTable('users')

      expect(result).toBe(builder)
    })
  })

  describe('between() method', () => {
    it('should set temporal range filter', () => {
      const start = ts(-1000)
      const end = ts()
      builder.between(start, end)

      const filter = builder.build()
      expect(filter.type).toBe('between')
      expect(filter.start).toBe(start)
      expect(filter.end).toBe(end)
    })
  })

  describe('current() method', () => {
    it('should set filter for latest version only', () => {
      builder.current()

      const filter = builder.build()
      expect(filter.type).toBe('current')
    })
  })

  describe('forTable() method', () => {
    it('should specify the table with temporal columns', () => {
      builder.asOf(ts()).forTable('orders')

      const filter = builder.build()
      expect(filter.table).toBe('orders')
    })

    it('should use default column names', () => {
      builder.asOf(ts()).forTable('orders')

      const filter = builder.build()
      expect(filter.validFromColumn).toBe('valid_from')
      expect(filter.validToColumn).toBe('valid_to')
    })

    it('should support custom temporal column names', () => {
      builder.asOf(ts()).forTable('orders', {
        validFromColumn: 'effective_start',
        validToColumn: 'effective_end',
      })

      const filter = builder.build()
      expect(filter.validFromColumn).toBe('effective_start')
      expect(filter.validToColumn).toBe('effective_end')
    })
  })

  describe('build() method', () => {
    it('should throw if no temporal filter specified', () => {
      expect(() => builder.build()).toThrow('No temporal filter specified')
    })

    it('should return complete TemporalPredicate', () => {
      const filter = builder.asOf(ts()).forTable('users').build()

      expect(filter).toMatchObject({
        type: 'asOf',
        table: 'users',
        validFromColumn: 'valid_from',
        validToColumn: 'valid_to',
      })
    })
  })
})

// ============================================================================
// PREDICATE COMPILATION
// ============================================================================

describe('compileTemporalPredicate', () => {
  describe('AS OF predicate generation', () => {
    it('should generate SQL predicate for point-in-time query', () => {
      const timestamp = ts()
      const predicate = compileTemporalPredicate(
        asOf(timestamp),
        { table: 'orders', validFromColumn: 'valid_from', validToColumn: 'valid_to' }
      )

      expect(predicate.sql).toBe(
        'valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)'
      )
      expect(predicate.params).toEqual([timestamp, timestamp])
    })

    it('should handle different column names', () => {
      const timestamp = ts()
      const predicate = compileTemporalPredicate(
        asOf(timestamp),
        { table: 'events', validFromColumn: 'start_time', validToColumn: 'end_time' }
      )

      expect(predicate.sql).toBe(
        'start_time <= ? AND (end_time IS NULL OR end_time > ?)'
      )
    })
  })

  describe('BETWEEN predicate generation', () => {
    it('should generate SQL predicate for range query', () => {
      const start = ts(-1000)
      const end = ts()
      const predicate = compileTemporalPredicate(
        between(start, end),
        { table: 'orders', validFromColumn: 'valid_from', validToColumn: 'valid_to' }
      )

      // Range overlaps: row.validFrom < end AND (row.validTo IS NULL OR row.validTo > start)
      expect(predicate.sql).toBe(
        'valid_from < ? AND (valid_to IS NULL OR valid_to > ?)'
      )
      expect(predicate.params).toEqual([end, start])
    })

    it('should handle inclusive range option', () => {
      const start = ts(-1000)
      const end = ts()
      const predicate = compileTemporalPredicate(
        between(start, end),
        { table: 'orders', validFromColumn: 'valid_from', validToColumn: 'valid_to', inclusive: true }
      )

      expect(predicate.sql).toBe(
        'valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)'
      )
    })
  })

  describe('CURRENT predicate generation', () => {
    it('should generate SQL predicate for current state', () => {
      const predicate = compileTemporalPredicate(
        current(),
        { table: 'orders', validFromColumn: 'valid_from', validToColumn: 'valid_to' }
      )

      expect(predicate.sql).toBe('valid_to IS NULL')
      expect(predicate.params).toEqual([])
    })
  })

  describe('VERSIONS predicate generation', () => {
    it('should generate SQL for all versions (no filter)', () => {
      const predicate = compileTemporalPredicate(
        versions(),
        { table: 'orders', validFromColumn: 'valid_from', validToColumn: 'valid_to' }
      )

      expect(predicate.sql).toBe('1=1') // No temporal restriction
      expect(predicate.params).toEqual([])
    })

    it('should generate SQL for versions with time range', () => {
      const start = ts(-1000)
      const end = ts()
      const predicate = compileTemporalPredicate(
        versions({ start, end }),
        { table: 'orders', validFromColumn: 'valid_from', validToColumn: 'valid_to' }
      )

      expect(predicate.sql).toBe(
        'valid_from < ? AND (valid_to IS NULL OR valid_to > ?)'
      )
    })
  })
})

// ============================================================================
// VERSIONED ROW FILTERING
// ============================================================================

describe('VersionedRow filtering', () => {
  const rows: VersionedRow<TestRecord>[] = [
    createVersionedRow({ id: '1', name: 'Alice', status: 'active', amount: 100 }, ts(-3000), ts(-2000)),
    createVersionedRow({ id: '1', name: 'Alice', status: 'inactive', amount: 150 }, ts(-2000), ts(-1000)),
    createVersionedRow({ id: '1', name: 'Alice', status: 'active', amount: 200 }, ts(-1000), null),
    createVersionedRow({ id: '2', name: 'Bob', status: 'active', amount: 50 }, ts(-2500), null),
  ]

  describe('filterVersions with asOf', () => {
    it('should return rows valid at point in time', async () => {
      const { filterVersions } = await import('../temporal-filters')
      const queryTime = ts(-2500)

      const result = filterVersions(rows, asOf(queryTime))

      expect(result).toHaveLength(2)
      expect(result.map((r) => r.data.id)).toContain('1')
      expect(result.map((r) => r.data.id)).toContain('2')
      // For id='1', should get the first version (status='active', amount=100)
      const record1 = result.find((r) => r.data.id === '1')
      expect(record1?.data.amount).toBe(100)
    })

    it('should return latest version when querying current time', async () => {
      const { filterVersions } = await import('../temporal-filters')
      const queryTime = ts()

      const result = filterVersions(rows, asOf(queryTime))

      expect(result).toHaveLength(2)
      const record1 = result.find((r) => r.data.id === '1')
      expect(record1?.data.amount).toBe(200) // Latest version
    })

    it('should return empty array when querying before any data existed', async () => {
      const { filterVersions } = await import('../temporal-filters')
      const queryTime = ts(-5000)

      const result = filterVersions(rows, asOf(queryTime))

      expect(result).toHaveLength(0)
    })
  })

  describe('filterVersions with between', () => {
    it('should return rows overlapping the time range', async () => {
      const { filterVersions } = await import('../temporal-filters')
      const start = ts(-2500)
      const end = ts(-1500)

      const result = filterVersions(rows, between(start, end))

      // Should include versions that overlap with the range
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('filterVersions with current', () => {
    it('should return only current (valid_to IS NULL) rows', async () => {
      const { filterVersions } = await import('../temporal-filters')

      const result = filterVersions(rows, current())

      expect(result).toHaveLength(2) // Only rows where validTo is null
      expect(result.every((r) => r.validTo === null)).toBe(true)
    })
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge cases', () => {
  describe('future timestamps', () => {
    it('should handle queries for future timestamps', () => {
      const futureTime = ts(86400000) // 1 day in future
      const query = asOf(futureTime)

      expect(query.timestamp).toBe(futureTime)
    })

    it('should return current data for future AS OF queries', async () => {
      const { filterVersions } = await import('../temporal-filters')
      const rows: VersionedRow<TestRecord>[] = [
        createVersionedRow(
          { id: '1', name: 'Current', status: 'active', amount: 100 },
          ts(-1000),
          null
        ),
      ]

      const futureTime = ts(86400000)
      const result = filterVersions(rows, asOf(futureTime))

      expect(result).toHaveLength(1)
      expect(result[0]?.data.name).toBe('Current')
    })
  })

  describe('boundary conditions', () => {
    it('should include row when AS OF timestamp equals validFrom', async () => {
      const { filterVersions } = await import('../temporal-filters')
      const exactTime = ts(-1000)
      const rows: VersionedRow<TestRecord>[] = [
        createVersionedRow(
          { id: '1', name: 'Exact', status: 'active', amount: 100 },
          exactTime,
          null
        ),
      ]

      const result = filterVersions(rows, asOf(exactTime))

      expect(result).toHaveLength(1)
    })

    it('should exclude row when AS OF timestamp equals validTo', async () => {
      const { filterVersions } = await import('../temporal-filters')
      const endTime = ts()
      const rows: VersionedRow<TestRecord>[] = [
        createVersionedRow(
          { id: '1', name: 'Ended', status: 'active', amount: 100 },
          ts(-1000),
          endTime
        ),
      ]

      const result = filterVersions(rows, asOf(endTime))

      expect(result).toHaveLength(0) // validTo is exclusive
    })
  })

  describe('empty data sets', () => {
    it('should handle empty row array', async () => {
      const { filterVersions } = await import('../temporal-filters')

      const result = filterVersions([], asOf(ts()))

      expect(result).toHaveLength(0)
    })
  })

  describe('null handling', () => {
    it('should treat null validTo as current/open-ended', async () => {
      const { filterVersions } = await import('../temporal-filters')
      const rows: VersionedRow<TestRecord>[] = [
        createVersionedRow(
          { id: '1', name: 'Open', status: 'active', amount: 100 },
          ts(-1000),
          null
        ),
      ]

      // Query any time after validFrom should return the row
      const result1 = filterVersions(rows, asOf(ts()))
      const result2 = filterVersions(rows, asOf(ts(86400000)))

      expect(result1).toHaveLength(1)
      expect(result2).toHaveLength(1)
    })
  })
})

// ============================================================================
// TYPE GUARDS
// ============================================================================

describe('Type guards', () => {
  describe('isAsOfQuery', () => {
    it('should return true for asOf queries', () => {
      const query = asOf(ts())
      expect(isAsOfQuery(query)).toBe(true)
    })

    it('should return false for other query types', () => {
      const rangeQuery = between(ts(-1000), ts())
      const currentQuery = current()

      expect(isAsOfQuery(rangeQuery)).toBe(false)
      expect(isAsOfQuery(currentQuery)).toBe(false)
    })

    it('should return false for plain objects', () => {
      expect(isAsOfQuery({ timestamp: 123 })).toBe(false)
      expect(isAsOfQuery(null)).toBe(false)
      expect(isAsOfQuery(undefined)).toBe(false)
    })
  })

  describe('isTemporalRange', () => {
    it('should return true for between queries', () => {
      const query = between(ts(-1000), ts())
      expect(isTemporalRange(query)).toBe(true)
    })

    it('should return false for other query types', () => {
      const asOfQuery = asOf(ts())
      const currentQuery = current()

      expect(isTemporalRange(asOfQuery)).toBe(false)
      expect(isTemporalRange(currentQuery)).toBe(false)
    })
  })
})

// ============================================================================
// QUERY COMPILER INTEGRATION
// ============================================================================

describe('Query Compiler Integration', () => {
  it('should generate predicates compatible with PredicateCompiler', async () => {
    const {
      compileTemporalPredicate,
      asOf,
    } = await import('../temporal-filters')

    const predicate = compileTemporalPredicate(
      asOf(ts()),
      { table: 'orders', validFromColumn: 'valid_from', validToColumn: 'valid_to' }
    )

    // Should produce SQL-compatible predicate
    expect(typeof predicate.sql).toBe('string')
    expect(Array.isArray(predicate.params)).toBe(true)
  })

  it('should support AST node generation for query engine', async () => {
    const { createTemporalPredicateNode, asOf } = await import('../temporal-filters')

    const node = createTemporalPredicateNode(
      asOf(ts()),
      { validFromColumn: 'valid_from', validToColumn: 'valid_to' }
    )

    // Should produce a node compatible with the unified AST
    expect(node.type).toBe('logical')
    expect(node.op).toBe('AND')
    expect(node.children).toHaveLength(2)
  })
})

// ============================================================================
// TIME WINDOW AGGREGATIONS
// ============================================================================

describe('Time Window Aggregations', () => {
  describe('durationToMs', () => {
    it('should convert various duration units to milliseconds', async () => {
      const { durationToMs } = await import('../temporal-filters')

      expect(durationToMs({ value: 1, unit: 'milliseconds' })).toBe(1)
      expect(durationToMs({ value: 1, unit: 'seconds' })).toBe(1000)
      expect(durationToMs({ value: 1, unit: 'minutes' })).toBe(60 * 1000)
      expect(durationToMs({ value: 1, unit: 'hours' })).toBe(60 * 60 * 1000)
      expect(durationToMs({ value: 1, unit: 'days' })).toBe(24 * 60 * 60 * 1000)
      expect(durationToMs({ value: 1, unit: 'weeks' })).toBe(7 * 24 * 60 * 60 * 1000)
    })

    it('should handle non-unit values', async () => {
      const { durationToMs } = await import('../temporal-filters')

      expect(durationToMs({ value: 5, unit: 'minutes' })).toBe(5 * 60 * 1000)
      expect(durationToMs({ value: 24, unit: 'hours' })).toBe(24 * 60 * 60 * 1000)
    })
  })

  describe('tumblingWindow', () => {
    it('should create a tumbling window configuration', async () => {
      const { tumblingWindow } = await import('../temporal-filters')

      const window = tumblingWindow({ value: 1, unit: 'hours' })

      expect(window.type).toBe('tumbling')
      expect(window.size).toEqual({ value: 1, unit: 'hours' })
    })

    it('should support optional offset', async () => {
      const { tumblingWindow } = await import('../temporal-filters')

      const window = tumblingWindow({ value: 1, unit: 'hours' }, 1000)

      expect(window.offset).toBe(1000)
    })
  })

  describe('slidingWindow', () => {
    it('should create a sliding window configuration', async () => {
      const { slidingWindow } = await import('../temporal-filters')

      const window = slidingWindow(
        { value: 1, unit: 'hours' },
        { value: 15, unit: 'minutes' }
      )

      expect(window.type).toBe('sliding')
      expect(window.size).toEqual({ value: 1, unit: 'hours' })
      expect(window.slide).toEqual({ value: 15, unit: 'minutes' })
    })
  })

  describe('sessionWindow', () => {
    it('should create a session window configuration', async () => {
      const { sessionWindow } = await import('../temporal-filters')

      const window = sessionWindow({ value: 30, unit: 'minutes' })

      expect(window.type).toBe('session')
      expect(window.gap).toEqual({ value: 30, unit: 'minutes' })
    })
  })

  describe('getWindowBoundaries', () => {
    it('should calculate correct window boundaries', async () => {
      const { getWindowBoundaries, tumblingWindow, durationToMs } = await import('../temporal-filters')

      const hourMs = durationToMs({ value: 1, unit: 'hours' })
      const window = tumblingWindow({ value: 1, unit: 'hours' })

      // Timestamp at 1.5 hours
      const timestamp = hourMs * 1.5
      const boundaries = getWindowBoundaries(timestamp, window)

      expect(boundaries.start).toBe(hourMs) // Start of 2nd hour window
      expect(boundaries.end).toBe(hourMs * 2) // End of 2nd hour window
    })

    it('should respect offset', async () => {
      const { getWindowBoundaries, tumblingWindow, durationToMs } = await import('../temporal-filters')

      const hourMs = durationToMs({ value: 1, unit: 'hours' })
      const offset = 30 * 60 * 1000 // 30 minutes offset
      const window = tumblingWindow({ value: 1, unit: 'hours' }, offset)

      // Timestamp at 0.75 hours (45 minutes)
      const timestamp = hourMs * 0.75
      const boundaries = getWindowBoundaries(timestamp, window)

      // With 30 min offset, window starts at 0:30
      expect(boundaries.start).toBe(offset)
      expect(boundaries.end).toBe(offset + hourMs)
    })
  })

  describe('assignToWindows with tumbling windows', () => {
    it('should assign rows to tumbling windows', async () => {
      const {
        assignToWindows,
        tumblingWindow,
      } = await import('../temporal-filters')
      type VersionedRow<T> = import('../temporal-filters').VersionedRow<T>

      const hourMs = 60 * 60 * 1000
      const window = tumblingWindow({ value: 1, unit: 'hours' })

      const rows: VersionedRow<{ id: string }>[] = [
        { data: { id: '1' }, validFrom: 0.5 * hourMs, validTo: null, version: 1 },
        { data: { id: '2' }, validFrom: 0.7 * hourMs, validTo: null, version: 1 },
        { data: { id: '3' }, validFrom: 1.2 * hourMs, validTo: null, version: 1 },
        { data: { id: '4' }, validFrom: 2.5 * hourMs, validTo: null, version: 1 },
      ]

      const windowedData = assignToWindows(rows, window)

      // Should have 3 windows: 0-1hr, 1-2hr, 2-3hr
      expect(windowedData.size).toBe(3)

      // First window (0-1 hour) should have 2 rows
      const firstWindow = windowedData.get(`0-${hourMs}`)
      expect(firstWindow).toHaveLength(2)
      expect(firstWindow?.map((r) => r.data.id)).toContain('1')
      expect(firstWindow?.map((r) => r.data.id)).toContain('2')

      // Second window (1-2 hours) should have 1 row
      const secondWindow = windowedData.get(`${hourMs}-${2 * hourMs}`)
      expect(secondWindow).toHaveLength(1)
      expect(secondWindow?.[0]?.data.id).toBe('3')
    })
  })

  describe('assignToWindows with sliding windows', () => {
    it('should assign rows to overlapping windows', async () => {
      const {
        assignToWindows,
        slidingWindow,
      } = await import('../temporal-filters')
      type VersionedRow<T> = import('../temporal-filters').VersionedRow<T>

      const hourMs = 60 * 60 * 1000
      const window = slidingWindow(
        { value: 1, unit: 'hours' },
        { value: 30, unit: 'minutes' }
      )

      const rows: VersionedRow<{ id: string }>[] = [
        { data: { id: '1' }, validFrom: 45 * 60 * 1000, validTo: null, version: 1 }, // 45 min
      ]

      const windowedData = assignToWindows(rows, window)

      // The event at 45 minutes should belong to multiple windows:
      // Window 0:00-1:00 contains it
      // Window 0:30-1:30 contains it
      expect(windowedData.size).toBeGreaterThanOrEqual(1)
    })
  })

  describe('assignToWindows with session windows', () => {
    it('should group events into sessions based on gap', async () => {
      const {
        assignToWindows,
        sessionWindow,
      } = await import('../temporal-filters')
      type VersionedRow<T> = import('../temporal-filters').VersionedRow<T>

      const minuteMs = 60 * 1000
      const window = sessionWindow({ value: 5, unit: 'minutes' })

      const rows: VersionedRow<{ id: string }>[] = [
        { data: { id: '1' }, validFrom: 0, validTo: null, version: 1 },
        { data: { id: '2' }, validFrom: 2 * minuteMs, validTo: null, version: 1 }, // 2 min later
        { data: { id: '3' }, validFrom: 4 * minuteMs, validTo: null, version: 1 }, // 2 min later
        // Gap of more than 5 minutes
        { data: { id: '4' }, validFrom: 15 * minuteMs, validTo: null, version: 1 },
        { data: { id: '5' }, validFrom: 17 * minuteMs, validTo: null, version: 1 },
      ]

      const windowedData = assignToWindows(rows, window)

      // Should have 2 sessions
      expect(windowedData.size).toBe(2)

      // Convert to array for easier testing
      const sessions = Array.from(windowedData.values())
      sessions.sort((a, b) => a[0]!.validFrom - b[0]!.validFrom)

      // First session should have 3 events
      expect(sessions[0]).toHaveLength(3)
      // Second session should have 2 events
      expect(sessions[1]).toHaveLength(2)
    })
  })

  describe('aggregateWindows', () => {
    it('should apply aggregator to each window', async () => {
      const {
        assignToWindows,
        aggregateWindows,
        tumblingWindow,
        windowAggregators,
      } = await import('../temporal-filters')
      type VersionedRow<T> = import('../temporal-filters').VersionedRow<T>

      const hourMs = 60 * 60 * 1000
      const window = tumblingWindow({ value: 1, unit: 'hours' })

      const rows: VersionedRow<{ amount: number }>[] = [
        { data: { amount: 100 }, validFrom: 0.5 * hourMs, validTo: null, version: 1 },
        { data: { amount: 200 }, validFrom: 0.7 * hourMs, validTo: null, version: 1 },
        { data: { amount: 150 }, validFrom: 1.2 * hourMs, validTo: null, version: 1 },
      ]

      const windowedData = assignToWindows(rows, window)
      const results = aggregateWindows(windowedData, windowAggregators.count)

      expect(results).toHaveLength(2)
      // First window has 2 events
      expect(results[0]?.data).toBe(2)
      // Second window has 1 event
      expect(results[1]?.data).toBe(1)
    })

    it('should support sum aggregation', async () => {
      const {
        assignToWindows,
        aggregateWindows,
        tumblingWindow,
        windowAggregators,
      } = await import('../temporal-filters')
      type VersionedRow<T> = import('../temporal-filters').VersionedRow<T>

      const hourMs = 60 * 60 * 1000
      const window = tumblingWindow({ value: 1, unit: 'hours' })

      const rows: VersionedRow<{ amount: number }>[] = [
        { data: { amount: 100 }, validFrom: 0.5 * hourMs, validTo: null, version: 1 },
        { data: { amount: 200 }, validFrom: 0.7 * hourMs, validTo: null, version: 1 },
      ]

      const windowedData = assignToWindows(rows, window)
      const results = aggregateWindows(windowedData, (rows) =>
        windowAggregators.sum(rows, (r) => r.data.amount)
      )

      expect(results[0]?.data).toBe(300) // 100 + 200
    })

    it('should support avg aggregation', async () => {
      const {
        assignToWindows,
        aggregateWindows,
        tumblingWindow,
        windowAggregators,
      } = await import('../temporal-filters')
      type VersionedRow<T> = import('../temporal-filters').VersionedRow<T>

      const hourMs = 60 * 60 * 1000
      const window = tumblingWindow({ value: 1, unit: 'hours' })

      const rows: VersionedRow<{ amount: number }>[] = [
        { data: { amount: 100 }, validFrom: 0.5 * hourMs, validTo: null, version: 1 },
        { data: { amount: 200 }, validFrom: 0.7 * hourMs, validTo: null, version: 1 },
      ]

      const windowedData = assignToWindows(rows, window)
      const results = aggregateWindows(windowedData, (rows) =>
        windowAggregators.avg(rows, (r) => r.data.amount)
      )

      expect(results[0]?.data).toBe(150) // (100 + 200) / 2
    })
  })
})

// ============================================================================
// TEMPORAL JOINS
// ============================================================================

describe('Temporal Joins', () => {
  describe('periodsOverlap', () => {
    it('should return true for overlapping periods', async () => {
      const { periodsOverlap } = await import('../temporal-filters')

      const period1 = { validFrom: 0, validTo: 100 }
      const period2 = { validFrom: 50, validTo: 150 }

      expect(periodsOverlap(period1, period2)).toBe(true)
    })

    it('should return false for non-overlapping periods', async () => {
      const { periodsOverlap } = await import('../temporal-filters')

      const period1 = { validFrom: 0, validTo: 100 }
      const period2 = { validFrom: 200, validTo: 300 }

      expect(periodsOverlap(period1, period2)).toBe(false)
    })

    it('should handle null validTo (open-ended)', async () => {
      const { periodsOverlap } = await import('../temporal-filters')

      const period1 = { validFrom: 0, validTo: null }
      const period2 = { validFrom: 1000, validTo: 2000 }

      expect(periodsOverlap(period1, period2)).toBe(true)
    })

    it('should handle tolerance', async () => {
      const { periodsOverlap } = await import('../temporal-filters')

      const period1 = { validFrom: 0, validTo: 100 }
      const period2 = { validFrom: 110, validTo: 200 }

      // Without tolerance - no overlap
      expect(periodsOverlap(period1, period2, 0)).toBe(false)
      // With 20ms tolerance - overlap
      expect(periodsOverlap(period1, period2, 20)).toBe(true)
    })
  })

  describe('periodIntersection', () => {
    it('should calculate intersection of overlapping periods', async () => {
      const { periodIntersection } = await import('../temporal-filters')

      const period1 = { validFrom: 0, validTo: 100 }
      const period2 = { validFrom: 50, validTo: 150 }

      const intersection = periodIntersection(period1, period2)

      expect(intersection).toEqual({ validFrom: 50, validTo: 100 })
    })

    it('should return null for non-overlapping periods', async () => {
      const { periodIntersection } = await import('../temporal-filters')

      const period1 = { validFrom: 0, validTo: 100 }
      const period2 = { validFrom: 200, validTo: 300 }

      expect(periodIntersection(period1, period2)).toBeNull()
    })

    it('should handle null validTo', async () => {
      const { periodIntersection } = await import('../temporal-filters')

      const period1 = { validFrom: 0, validTo: null }
      const period2 = { validFrom: 50, validTo: 150 }

      const intersection = periodIntersection(period1, period2)

      expect(intersection).toEqual({ validFrom: 50, validTo: 150 })
    })

    it('should return null validTo when both are open-ended', async () => {
      const { periodIntersection } = await import('../temporal-filters')

      const period1 = { validFrom: 0, validTo: null }
      const period2 = { validFrom: 50, validTo: null }

      const intersection = periodIntersection(period1, period2)

      expect(intersection).toEqual({ validFrom: 50, validTo: null })
    })
  })

  describe('temporalJoin', () => {
    interface Customer { id: string; name: string }
    interface Order { orderId: string; customerId: string; total: number }

    it('should perform inner join with overlapping periods', async () => {
      const { temporalJoin } = await import('../temporal-filters')
      type VersionedRow<T> = { data: T; validFrom: number; validTo: number | null; version: number }

      const customers: VersionedRow<Customer>[] = [
        { data: { id: 'c1', name: 'Alice' }, validFrom: 0, validTo: null, version: 1 },
      ]

      const orders: VersionedRow<Order>[] = [
        { data: { orderId: 'o1', customerId: 'c1', total: 100 }, validFrom: 50, validTo: 200, version: 1 },
        { data: { orderId: 'o2', customerId: 'c1', total: 150 }, validFrom: 250, validTo: 400, version: 1 },
      ]

      const results = temporalJoin(customers, orders, {
        leftKey: (r) => r.data.id,
        rightKey: (r) => r.data.customerId,
      })

      expect(results).toHaveLength(2)
      // First join result
      expect(results[0]?.left?.data.name).toBe('Alice')
      expect(results[0]?.right?.data.orderId).toBe('o1')
      expect(results[0]?.validFrom).toBe(50) // Max of customer.validFrom and order.validFrom
      expect(results[0]?.validTo).toBe(200) // Min of customer.validTo and order.validTo
    })

    it('should perform left outer join', async () => {
      const { temporalJoin } = await import('../temporal-filters')
      type VersionedRow<T> = { data: T; validFrom: number; validTo: number | null; version: number }

      const customers: VersionedRow<Customer>[] = [
        { data: { id: 'c1', name: 'Alice' }, validFrom: 0, validTo: 100, version: 1 },
        { data: { id: 'c2', name: 'Bob' }, validFrom: 0, validTo: 100, version: 1 },
      ]

      const orders: VersionedRow<Order>[] = [
        { data: { orderId: 'o1', customerId: 'c1', total: 100 }, validFrom: 50, validTo: 80, version: 1 },
      ]

      const results = temporalJoin(customers, orders, {
        type: 'left',
        leftKey: (r) => r.data.id,
        rightKey: (r) => r.data.customerId,
      })

      expect(results).toHaveLength(2)

      // Alice has a matching order
      const aliceResult = results.find((r) => r.left?.data.name === 'Alice')
      expect(aliceResult?.right).not.toBeNull()

      // Bob has no matching order
      const bobResult = results.find((r) => r.left?.data.name === 'Bob')
      expect(bobResult?.right).toBeNull()
    })

    it('should perform right outer join', async () => {
      const { temporalJoin } = await import('../temporal-filters')
      type VersionedRow<T> = { data: T; validFrom: number; validTo: number | null; version: number }

      const customers: VersionedRow<Customer>[] = [
        { data: { id: 'c1', name: 'Alice' }, validFrom: 0, validTo: 50, version: 1 },
      ]

      const orders: VersionedRow<Order>[] = [
        { data: { orderId: 'o1', customerId: 'c1', total: 100 }, validFrom: 100, validTo: 200, version: 1 },
        { data: { orderId: 'o2', customerId: 'c2', total: 150 }, validFrom: 0, validTo: 100, version: 1 },
      ]

      const results = temporalJoin(customers, orders, {
        type: 'right',
        leftKey: (r) => r.data.id,
        rightKey: (r) => r.data.customerId,
      })

      // Both orders should appear, with null left for unmatched
      expect(results).toHaveLength(2)
      expect(results.every((r) => r.right !== null)).toBe(true)
      expect(results.every((r) => r.left === null)).toBe(true) // Neither matches due to no overlap or no customer
    })
  })

  describe('asOfJoin', () => {
    interface Customer { id: string; name: string }
    interface Order { orderId: string; customerId: string; total: number }

    it('should join tables at a specific point in time', async () => {
      const { asOfJoin } = await import('../temporal-filters')
      type VersionedRow<T> = { data: T; validFrom: number; validTo: number | null; version: number }

      const customers: VersionedRow<Customer>[] = [
        { data: { id: 'c1', name: 'Alice v1' }, validFrom: 0, validTo: 100, version: 1 },
        { data: { id: 'c1', name: 'Alice v2' }, validFrom: 100, validTo: null, version: 2 },
      ]

      const orders: VersionedRow<Order>[] = [
        { data: { orderId: 'o1', customerId: 'c1', total: 100 }, validFrom: 50, validTo: 150, version: 1 },
        { data: { orderId: 'o2', customerId: 'c1', total: 200 }, validFrom: 150, validTo: null, version: 1 },
      ]

      // Query at timestamp 75 - should get Alice v1 and order o1
      const resultsAt75 = asOfJoin(customers, orders, 75, {
        leftKey: (r) => r.data.id,
        rightKey: (r) => r.data.customerId,
      })

      expect(resultsAt75).toHaveLength(1)
      expect(resultsAt75[0]?.left?.data.name).toBe('Alice v1')
      expect(resultsAt75[0]?.right?.data.orderId).toBe('o1')

      // Query at timestamp 125 - should get Alice v2 and order o1
      const resultsAt125 = asOfJoin(customers, orders, 125, {
        leftKey: (r) => r.data.id,
        rightKey: (r) => r.data.customerId,
      })

      expect(resultsAt125).toHaveLength(1)
      expect(resultsAt125[0]?.left?.data.name).toBe('Alice v2')
      expect(resultsAt125[0]?.right?.data.orderId).toBe('o1')
    })
  })

  describe('compileTemporalJoin', () => {
    it('should generate SQL for temporal inner join', async () => {
      const { compileTemporalJoin } = await import('../temporal-filters')

      const result = compileTemporalJoin('customers', 'orders', {
        type: 'inner',
        leftOptions: { validFromColumn: 'valid_from', validToColumn: 'valid_to' },
        rightOptions: { validFromColumn: 'valid_from', validToColumn: 'valid_to' },
        on: { leftColumn: 'id', rightColumn: 'customer_id' },
      })

      expect(result.sql).toContain('INNER JOIN')
      expect(result.sql).toContain('customers.id = orders.customer_id')
      expect(result.sql).toContain('COALESCE') // For null handling
    })

    it('should generate SQL for temporal left join', async () => {
      const { compileTemporalJoin } = await import('../temporal-filters')

      const result = compileTemporalJoin('customers', 'orders', {
        type: 'left',
        leftOptions: { validFromColumn: 'valid_from', validToColumn: 'valid_to' },
        rightOptions: { validFromColumn: 'valid_from', validToColumn: 'valid_to' },
        on: { leftColumn: 'id', rightColumn: 'customer_id' },
      })

      expect(result.sql).toContain('LEFT JOIN')
    })

    it('should include AS OF filter when specified', async () => {
      const { compileTemporalJoin } = await import('../temporal-filters')

      const result = compileTemporalJoin('customers', 'orders', {
        leftOptions: { validFromColumn: 'valid_from', validToColumn: 'valid_to' },
        rightOptions: { validFromColumn: 'valid_from', validToColumn: 'valid_to' },
        on: { leftColumn: 'id', rightColumn: 'customer_id' },
        asOf: ts(),
      })

      expect(result.sql).toContain('WHERE')
      expect(result.params).toHaveLength(4) // 2 params for each table's AS OF filter
    })
  })
})
