/**
 * RED Phase Tests for $.measure Business Metrics API
 *
 * These tests define the expected behavior of the $.measure namespace
 * for time-series business metrics. They will FAIL until implementation.
 *
 * The measure API provides founder-native vocabulary for KPIs:
 * - $.measure.revenue(1000, { tags }) - Record business metrics
 * - $.measure.mrr.current() - Get current value
 * - $.measure.revenue.sum().since('7d') - Aggregations over time
 * - $.measure.activeUsers.set() - Gauges (current value)
 * - $.measure.requests.increment() - Counters (running total)
 *
 * @see docs/plans/2026-01-11-data-api-design.md
 * @module workflows/data/measure/tests/measure
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// Type Definitions for $.measure API
// These define the expected API shape - implementation will satisfy these
// ============================================================================

/** Tags/dimensions for metrics */
type MetricTags = Record<string, string | number | boolean> & { _timestamp?: number }

/** Aggregation result with timestamp */
interface AggregationResult {
  timestamp: number
  value: number
}

/** Trend analysis result */
interface TrendResult {
  slope: number
  direction: 'up' | 'down' | 'flat'
}

/** Comparison result (vs previous period) */
interface ComparisonResult {
  current: number
  previous: number
  change: number
  percentChange: number
}

/** Window subscription stats */
interface WindowStats {
  sum: number
  count: number
  avg: number
  min: number
  max: number
}

/** Alert info passed to notify function */
interface AlertInfo {
  metric: string
  value: number
  tags: MetricTags
  timestamp: number
}

/** Alert configuration */
interface AlertConfig {
  condition: ((value: number) => boolean) | { op: '>' | '<' | '>=' | '<=' | '='; value: number }
  for?: string
  notify: (info: AlertInfo) => void | Promise<void>
}

/** Alert instance */
interface AlertInstance {
  id: string
  status: 'active' | 'disabled'
  for?: string
  disable: () => Promise<void>
  delete: () => Promise<void>
}

/** Rollup configuration */
interface RollupConfig {
  granularity: ('minute' | 'hour' | 'day' | 'week' | 'month')[]
  aggregates: ('sum' | 'count' | 'avg' | 'min' | 'max')[]
  retention?: Record<string, string>
}

/** Rollup result */
interface RollupResult {
  status: 'configured'
  retention?: Record<string, string>
}

/** Window subscription */
interface WindowSubscription {
  unsubscribe: () => void
}

/** Metric stats */
interface MetricStats {
  count: number
  sum: number
  min: number
  max: number
  avg: number
  lastRecordedAt: number
}

/** Chainable query builder for time-based queries */
interface QueryBuilder<T> {
  since: (duration: string) => QueryBuilder<T>
  by: (granularity: 'hour' | 'day' | 'week' | 'month') => Promise<AggregationResult[]>
  vs: (comparison: 'prev' | 'prev_week' | 'prev_month' | 'prev_year') => Promise<ComparisonResult>
  then: (onfulfilled: (value: T) => any) => Promise<any>
}

/** Metric instance for a specific metric name */
interface MetricInstance {
  // Record value
  (value: number, tags?: MetricTags): Promise<void>

  // Gauges
  set: (value: number, tags?: MetricTags) => Promise<void>

  // Counters
  increment: (value?: number, tags?: MetricTags) => Promise<void>

  // Read current
  current: (tags?: MetricTags) => Promise<number | null>

  // Stats
  stats: () => Promise<MetricStats>

  // Aggregations
  sum: () => QueryBuilder<number>
  avg: () => QueryBuilder<number>
  min: () => QueryBuilder<number>
  max: () => QueryBuilder<number>
  count: () => QueryBuilder<number>
  percentile: (p: number) => QueryBuilder<number>

  // Trends
  trend: () => QueryBuilder<TrendResult>

  // Rollups
  rollup: (config: RollupConfig) => Promise<RollupResult>

  // Alerts
  alert: (config: AlertConfig) => Promise<AlertInstance>
  alertAbove: (threshold: number, notify: (info: AlertInfo) => void) => Promise<AlertInstance>
  alertBelow: (threshold: number, notify: (info: AlertInfo) => void) => Promise<AlertInstance>

  // Window subscriptions
  window: (duration: string, options?: { slide?: string }) => {
    subscribe: (callback: (stats: WindowStats) => void) => WindowSubscription
  }
}

/** The measure namespace proxy */
interface MeasureNamespace {
  [metricName: string]: MetricInstance
}

/** Factory function to create measure namespace */
type CreateMeasureNamespace = () => MeasureNamespace

// Import the measure API (will fail - module doesn't exist yet)
// This import will cause tests to fail until implementation exists
import { createMeasureNamespace } from '../index'

describe('$.measure - Business Metrics API', () => {
  let $: { measure: MeasureNamespace }

  beforeEach(() => {
    // Create a fresh measure namespace for each test
    $ = { measure: createMeasureNamespace() }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ============================================================================
  // WRITE: Record Measurements
  // ============================================================================

  describe('Recording Metrics', () => {
    describe('$.measure.metricName(value)', () => {
      it('records a business metric with numeric value', async () => {
        await $.measure.revenue(1000)

        const current = await $.measure.revenue.current()
        expect(current).toBe(1000)
      })

      it('records metric with tags/dimensions', async () => {
        await $.measure.revenue(1000, { plan: 'pro', region: 'us' })
        await $.measure.revenue(500, { plan: 'free', region: 'eu' })

        const proCurrent = await $.measure.revenue.current({ plan: 'pro' })
        expect(proCurrent).toBe(1000)

        const freeCurrent = await $.measure.revenue.current({ plan: 'free' })
        expect(freeCurrent).toBe(500)
      })

      it('records operational metrics', async () => {
        await $.measure.latency(23, { endpoint: '/api/users' })
        await $.measure.cpu(85, { host: 'web-01' })
        await $.measure.errors(1, { type: 'timeout' })

        expect(await $.measure.latency.current({ endpoint: '/api/users' })).toBe(23)
        expect(await $.measure.cpu.current({ host: 'web-01' })).toBe(85)
        expect(await $.measure.errors.current({ type: 'timeout' })).toBe(1)
      })

      it('records with implicit timestamp', async () => {
        const before = Date.now()
        await $.measure.mrr(50000)
        const after = Date.now()

        const stats = await $.measure.mrr.stats()
        expect(stats.lastRecordedAt).toBeGreaterThanOrEqual(before)
        expect(stats.lastRecordedAt).toBeLessThanOrEqual(after)
      })

      it('records with explicit timestamp', async () => {
        const customTimestamp = Date.now() - 60000 // 1 minute ago
        await $.measure.revenue(1000, { _timestamp: customTimestamp })

        const stats = await $.measure.revenue.stats()
        expect(stats.lastRecordedAt).toBe(customTimestamp)
      })

      it('accumulates multiple recordings over time', async () => {
        vi.useFakeTimers()

        await $.measure.revenue(100)
        vi.advanceTimersByTime(1000)
        await $.measure.revenue(200)
        vi.advanceTimersByTime(1000)
        await $.measure.revenue(300)

        const stats = await $.measure.revenue.stats()
        expect(stats.count).toBe(3)
      })

      it('validates numeric value', async () => {
        await expect($.measure.revenue('not a number' as any)).rejects.toThrow()
        await expect($.measure.revenue(NaN)).rejects.toThrow()
        await expect($.measure.revenue(Infinity)).rejects.toThrow()
      })
    })
  })

  // ============================================================================
  // Gauges vs Counters
  // ============================================================================

  describe('Gauges vs Counters', () => {
    describe('$.measure.metricName.set() - Gauges', () => {
      it('sets a gauge to specific value (overwrites)', async () => {
        await $.measure.activeUsers.set(100)
        expect(await $.measure.activeUsers.current()).toBe(100)

        await $.measure.activeUsers.set(150)
        expect(await $.measure.activeUsers.current()).toBe(150)

        await $.measure.activeUsers.set(120)
        expect(await $.measure.activeUsers.current()).toBe(120)
      })

      it('sets gauge with tags', async () => {
        await $.measure.activeUsers.set(100, { region: 'us' })
        await $.measure.activeUsers.set(50, { region: 'eu' })

        expect(await $.measure.activeUsers.current({ region: 'us' })).toBe(100)
        expect(await $.measure.activeUsers.current({ region: 'eu' })).toBe(50)
      })

      it('gauge maintains history but current() returns latest', async () => {
        vi.useFakeTimers()

        await $.measure.temperature.set(72)
        vi.advanceTimersByTime(1000)
        await $.measure.temperature.set(74)
        vi.advanceTimersByTime(1000)
        await $.measure.temperature.set(73)

        // current() returns the latest set value
        expect(await $.measure.temperature.current()).toBe(73)

        // but history is still available
        const stats = await $.measure.temperature.stats()
        expect(stats.count).toBe(3)
      })

      it('gauge returns null/undefined for unset metric', async () => {
        const current = await $.measure.unsetGauge.current()
        expect(current).toBeNull()
      })
    })

    describe('$.measure.metricName.increment() - Counters', () => {
      it('increments counter by 1 by default', async () => {
        await $.measure.requests.increment()

        expect(await $.measure.requests.current()).toBe(1)
      })

      it('increments counter by specified amount', async () => {
        await $.measure.requests.increment(10)

        expect(await $.measure.requests.current()).toBe(10)
      })

      it('accumulates multiple increments', async () => {
        await $.measure.pageViews.increment()
        await $.measure.pageViews.increment()
        await $.measure.pageViews.increment()
        await $.measure.pageViews.increment(5)

        expect(await $.measure.pageViews.current()).toBe(8)
      })

      it('increments with tags', async () => {
        await $.measure.requests.increment(1, { endpoint: '/api/users' })
        await $.measure.requests.increment(1, { endpoint: '/api/users' })
        await $.measure.requests.increment(1, { endpoint: '/api/orders' })

        expect(await $.measure.requests.current({ endpoint: '/api/users' })).toBe(2)
        expect(await $.measure.requests.current({ endpoint: '/api/orders' })).toBe(1)
      })

      it('counter starts at 0 for new metric', async () => {
        expect(await $.measure.newCounter.current()).toBe(0)
      })

      it('handles concurrent increments correctly', async () => {
        await Promise.all([
          $.measure.concurrent.increment(),
          $.measure.concurrent.increment(),
          $.measure.concurrent.increment(),
          $.measure.concurrent.increment(),
          $.measure.concurrent.increment(),
        ])

        expect(await $.measure.concurrent.current()).toBe(5)
      })

      it('handles large increments', async () => {
        await $.measure.bigCounter.increment(1_000_000)
        await $.measure.bigCounter.increment(2_000_000)

        expect(await $.measure.bigCounter.current()).toBe(3_000_000)
      })

      it('does not allow negative increments on counters', async () => {
        await $.measure.strictCounter.increment(10)
        // Counters should not decrement - use gauges for bidirectional
        await expect($.measure.strictCounter.increment(-5)).rejects.toThrow()
      })
    })
  })

  // ============================================================================
  // READ: Query Measurements
  // ============================================================================

  describe('Query Current Value', () => {
    describe('$.measure.metricName.current()', () => {
      it('returns current/latest value', async () => {
        await $.measure.mrr(50000)

        const current = await $.measure.mrr.current()
        expect(current).toBe(50000)
      })

      it('returns current value with tag filter', async () => {
        await $.measure.cpu(85, { host: 'web-01' })
        await $.measure.cpu(72, { host: 'web-02' })

        expect(await $.measure.cpu.current({ host: 'web-01' })).toBe(85)
        expect(await $.measure.cpu.current({ host: 'web-02' })).toBe(72)
      })

      it('returns null for non-existent metric', async () => {
        const current = await $.measure.nonexistent.current()
        expect(current).toBeNull()
      })

      it('returns null for non-matching tags', async () => {
        await $.measure.cpu(85, { host: 'web-01' })

        const current = await $.measure.cpu.current({ host: 'web-99' })
        expect(current).toBeNull()
      })
    })
  })

  // ============================================================================
  // Aggregations Over Time
  // ============================================================================

  describe('Aggregations', () => {
    beforeEach(async () => {
      vi.useFakeTimers()
      const baseTime = new Date('2026-01-01T00:00:00Z').getTime()
      vi.setSystemTime(baseTime)

      // Record revenue over time
      await $.measure.revenue(100)
      vi.advanceTimersByTime(86400000) // +1 day
      await $.measure.revenue(200)
      vi.advanceTimersByTime(86400000) // +1 day
      await $.measure.revenue(150)
      vi.advanceTimersByTime(86400000) // +1 day
      await $.measure.revenue(300)
      vi.advanceTimersByTime(86400000) // +1 day
      await $.measure.revenue(250)
    })

    describe('$.measure.metricName.sum()', () => {
      it('calculates sum of all values', async () => {
        const total = await $.measure.revenue.sum()
        expect(total).toBe(1000) // 100+200+150+300+250
      })

      it('calculates sum since time period', async () => {
        const last3Days = await $.measure.revenue.sum().since('3d')
        expect(last3Days).toBe(700) // 150+300+250
      })

      it('calculates sum grouped by time', async () => {
        const byDay = await $.measure.revenue.sum().since('7d').by('day')

        expect(byDay).toBeInstanceOf(Array)
        expect(byDay.length).toBe(5)
        expect(byDay[0].value).toBe(100)
        expect(byDay[4].value).toBe(250)
      })
    })

    describe('$.measure.metricName.avg()', () => {
      it('calculates average of all values', async () => {
        const avg = await $.measure.revenue.avg()
        expect(avg).toBe(200) // 1000/5
      })

      it('calculates average since time period', async () => {
        const avgLast3Days = await $.measure.revenue.avg().since('3d')
        expect(avgLast3Days).toBeCloseTo(233.33, 2) // 700/3
      })
    })

    describe('$.measure.metricName.percentile()', () => {
      beforeEach(async () => {
        // Record latency values for percentile testing
        const latencies = [10, 15, 20, 25, 30, 35, 40, 100, 150, 200]
        for (const latency of latencies) {
          await $.measure.latency(latency)
          vi.advanceTimersByTime(1000)
        }
      })

      it('calculates p50 (median)', async () => {
        const p50 = await $.measure.latency.percentile(50).since('1h')
        expect(p50).toBe(32.5) // median of 10 values
      })

      it('calculates p99', async () => {
        const p99 = await $.measure.latency.percentile(99).since('1h')
        expect(p99).toBeGreaterThanOrEqual(150)
      })

      it('calculates p95', async () => {
        const p95 = await $.measure.latency.percentile(95).since('1h')
        expect(p95).toBeGreaterThanOrEqual(100)
      })

      it('validates percentile range (0-100)', async () => {
        await expect($.measure.latency.percentile(-1)).rejects.toThrow()
        await expect($.measure.latency.percentile(101)).rejects.toThrow()
      })
    })

    describe('$.measure.metricName.min() and .max()', () => {
      it('finds minimum value', async () => {
        const min = await $.measure.revenue.min().since('7d')
        expect(min).toBe(100)
      })

      it('finds maximum value', async () => {
        const max = await $.measure.revenue.max().since('7d')
        expect(max).toBe(300)
      })
    })

    describe('$.measure.metricName.count()', () => {
      it('counts number of recordings', async () => {
        const count = await $.measure.revenue.count().since('7d')
        expect(count).toBe(5)
      })
    })
  })

  // ============================================================================
  // Time Grouping
  // ============================================================================

  describe('Time Grouping', () => {
    beforeEach(async () => {
      vi.useFakeTimers()
      const baseTime = new Date('2026-01-01T00:00:00Z').getTime()
      vi.setSystemTime(baseTime)

      // Record hourly data for 3 days
      for (let day = 0; day < 3; day++) {
        for (let hour = 0; hour < 24; hour++) {
          await $.measure.requests(Math.floor(Math.random() * 100) + 50)
          vi.advanceTimersByTime(3600000) // +1 hour
        }
      }
    })

    describe('$.measure.metricName.since(duration)', () => {
      it('filters to last N days', async () => {
        const last2Days = await $.measure.requests.count().since('2d')
        expect(last2Days).toBe(48) // 24 hours * 2 days
      })

      it('filters to last N hours', async () => {
        const last6Hours = await $.measure.requests.count().since('6h')
        expect(last6Hours).toBe(6)
      })

      it('filters to quarter', async () => {
        const thisQuarter = await $.measure.requests.count().since('quarter')
        expect(thisQuarter).toBeGreaterThan(0)
      })

      it('filters to year', async () => {
        const thisYear = await $.measure.requests.count().since('year')
        expect(thisYear).toBeGreaterThan(0)
      })

      it('filters to month', async () => {
        const thisMonth = await $.measure.requests.count().since('month')
        expect(thisMonth).toBeGreaterThan(0)
      })

      it('filters to week', async () => {
        const thisWeek = await $.measure.requests.count().since('week')
        expect(thisWeek).toBeGreaterThan(0)
      })
    })

    describe('$.measure.metricName.by(granularity)', () => {
      it('groups by hour', async () => {
        const byHour = await $.measure.requests.sum().since('1d').by('hour')

        expect(byHour).toBeInstanceOf(Array)
        expect(byHour.length).toBe(24)
        for (const bucket of byHour) {
          expect(bucket).toHaveProperty('timestamp')
          expect(bucket).toHaveProperty('value')
        }
      })

      it('groups by day', async () => {
        const byDay = await $.measure.requests.sum().since('7d').by('day')

        expect(byDay).toBeInstanceOf(Array)
        expect(byDay.length).toBeLessThanOrEqual(7)
      })

      it('groups by week', async () => {
        const byWeek = await $.measure.requests.sum().since('30d').by('week')

        expect(byWeek).toBeInstanceOf(Array)
        expect(byWeek.length).toBeLessThanOrEqual(5)
      })

      it('groups by month', async () => {
        const byMonth = await $.measure.requests.sum().since('year').by('month')

        expect(byMonth).toBeInstanceOf(Array)
        expect(byMonth.length).toBeLessThanOrEqual(12)
      })

      it('includes empty buckets for periods with no data', async () => {
        // Reset and record sparse data
        $ = { measure: createMeasureNamespace() }
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z').getTime())

        await $.measure.sparse(100)
        vi.advanceTimersByTime(172800000) // Skip 2 days
        await $.measure.sparse(200)

        const byDay = await $.measure.sparse.sum().since('7d').by('day')

        // Should have entries for all days, some with value 0
        const hasEmptyBuckets = byDay.some((b: AggregationResult) => b.value === 0)
        expect(hasEmptyBuckets).toBe(true)
      })
    })
  })

  // ============================================================================
  // Trends and Comparisons
  // ============================================================================

  describe('Trends', () => {
    beforeEach(async () => {
      vi.useFakeTimers()
      const baseTime = new Date('2026-01-01T00:00:00Z').getTime()
      vi.setSystemTime(baseTime)

      // Record increasing MRR over 6 months
      const mrrValues = [40000, 42000, 45000, 48000, 52000, 55000]
      for (const mrr of mrrValues) {
        await $.measure.mrr(mrr)
        vi.advanceTimersByTime(30 * 86400000) // ~1 month
      }
    })

    describe('$.measure.metricName.trend()', () => {
      it('returns trend analysis with slope', async () => {
        const trend = await $.measure.mrr.trend().since('6mo')

        expect(trend).toHaveProperty('slope')
        expect(trend.slope).toBeGreaterThan(0) // Increasing
      })

      it('returns trend direction', async () => {
        const trend = await $.measure.mrr.trend().since('6mo')

        expect(trend).toHaveProperty('direction')
        expect(trend.direction).toBe('up')
      })

      it('identifies flat trend', async () => {
        $ = { measure: createMeasureNamespace() }
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z').getTime())

        // Record flat values
        for (let i = 0; i < 6; i++) {
          await $.measure.stable(1000)
          vi.advanceTimersByTime(30 * 86400000)
        }

        const trend = await $.measure.stable.trend().since('6mo')
        expect(trend.direction).toBe('flat')
      })

      it('identifies declining trend', async () => {
        $ = { measure: createMeasureNamespace() }
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z').getTime())

        const decliningValues = [60000, 55000, 50000, 45000, 40000, 35000]
        for (const val of decliningValues) {
          await $.measure.declining(val)
          vi.advanceTimersByTime(30 * 86400000)
        }

        const trend = await $.measure.declining.trend().since('6mo')
        expect(trend.direction).toBe('down')
        expect(trend.slope).toBeLessThan(0)
      })
    })

    describe('$.measure.metricName.vs(comparison)', () => {
      it('compares week over week', async () => {
        $ = { measure: createMeasureNamespace() }
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z').getTime())

        // Week 1: 1000 total
        await $.measure.weeklyRevenue(1000)
        vi.advanceTimersByTime(7 * 86400000) // +1 week

        // Week 2: 1200 total
        await $.measure.weeklyRevenue(1200)
        vi.advanceTimersByTime(7 * 86400000) // +1 week

        const comparison = await $.measure.weeklyRevenue.sum().since('week').vs('prev')

        expect(comparison).toHaveProperty('current')
        expect(comparison).toHaveProperty('previous')
        expect(comparison).toHaveProperty('change')
        expect(comparison).toHaveProperty('percentChange')
        expect(comparison.percentChange).toBeCloseTo(20, 0) // 20% increase
      })

      it('compares month over month', async () => {
        const comparison = await $.measure.mrr.current().vs('prev_month')

        expect(comparison).toHaveProperty('current')
        expect(comparison).toHaveProperty('previous')
        expect(comparison).toHaveProperty('percentChange')
      })

      it('compares year over year', async () => {
        const comparison = await $.measure.mrr.sum().since('year').vs('prev_year')

        expect(comparison).toHaveProperty('current')
        expect(comparison).toHaveProperty('previous')
      })
    })
  })

  // ============================================================================
  // Rollups (Pre-computed Aggregations)
  // ============================================================================

  describe('Rollups', () => {
    describe('$.measure.metricName.rollup(config)', () => {
      it('configures rollup with multiple granularities', async () => {
        const result = await $.measure.revenue.rollup({
          granularity: ['hour', 'day', 'month'],
          aggregates: ['sum', 'count', 'avg'],
        })

        expect(result).toHaveProperty('status', 'configured')
      })

      it('configures rollup with retention policy', async () => {
        const result = await $.measure.revenue.rollup({
          granularity: ['hour', 'day', 'month'],
          aggregates: ['sum', 'count', 'avg'],
          retention: {
            raw: '7d',
            hour: '90d',
            day: '2y',
          },
        })

        expect(result).toHaveProperty('status', 'configured')
        expect(result).toHaveProperty('retention')
      })

      it('queries pre-computed rollups efficiently', async () => {
        vi.useFakeTimers()
        const baseTime = new Date('2026-01-01T00:00:00Z').getTime()
        vi.setSystemTime(baseTime)

        // Configure rollup
        await $.measure.revenue.rollup({
          granularity: ['hour', 'day'],
          aggregates: ['sum'],
        })

        // Record data
        for (let i = 0; i < 100; i++) {
          await $.measure.revenue(Math.random() * 1000)
          vi.advanceTimersByTime(3600000)
        }

        // Query should use rollup
        const result = await $.measure.revenue.sum().since('7d')
        expect(result).toBeGreaterThan(0)
      })

      it('validates granularity values', async () => {
        await expect(
          $.measure.revenue.rollup({
            granularity: ['invalid' as any],
            aggregates: ['sum'],
          })
        ).rejects.toThrow()
      })

      it('validates aggregate functions', async () => {
        await expect(
          $.measure.revenue.rollup({
            granularity: ['hour'],
            aggregates: ['invalid' as any],
          })
        ).rejects.toThrow()
      })
    })
  })

  // ============================================================================
  // Alerts
  // ============================================================================

  describe('Alerts', () => {
    describe('$.measure.metricName.alert(config)', () => {
      it('creates alert with condition function', async () => {
        const notifyMock = vi.fn()

        const alert = await $.measure.cpu.alert({
          condition: (value) => value > 90,
          notify: notifyMock,
        })

        expect(alert).toHaveProperty('id')
        expect(alert).toHaveProperty('status', 'active')
      })

      it('creates alert with duration requirement', async () => {
        const notifyMock = vi.fn()

        const alert = await $.measure.cpu.alert({
          condition: (value) => value > 90,
          for: '5m', // Must be true for 5 minutes
          notify: notifyMock,
        })

        expect(alert).toHaveProperty('for', '5m')
      })

      it('triggers alert when condition is met', async () => {
        vi.useFakeTimers()
        const notifyMock = vi.fn()

        await $.measure.cpu.alert({
          condition: (value) => value > 90,
          notify: notifyMock,
        })

        // Record high CPU - should trigger
        await $.measure.cpu(95)

        expect(notifyMock).toHaveBeenCalled()
      })

      it('does not trigger alert when condition is not met', async () => {
        const notifyMock = vi.fn()

        await $.measure.cpu.alert({
          condition: (value) => value > 90,
          notify: notifyMock,
        })

        // Record normal CPU - should not trigger
        await $.measure.cpu(50)

        expect(notifyMock).not.toHaveBeenCalled()
      })

      it('respects duration requirement before triggering', async () => {
        vi.useFakeTimers()
        const notifyMock = vi.fn()

        await $.measure.cpu.alert({
          condition: (value) => value > 90,
          for: '5m',
          notify: notifyMock,
        })

        // High CPU for less than 5 minutes
        await $.measure.cpu(95)
        vi.advanceTimersByTime(60000) // 1 minute
        await $.measure.cpu(95)
        vi.advanceTimersByTime(60000) // 2 minutes

        // Should not have triggered yet
        expect(notifyMock).not.toHaveBeenCalled()

        // Now wait for full duration
        vi.advanceTimersByTime(180000) // 3 more minutes
        await $.measure.cpu(95)

        // Now should trigger
        expect(notifyMock).toHaveBeenCalled()
      })

      it('resets alert when condition becomes false', async () => {
        vi.useFakeTimers()
        const notifyMock = vi.fn()

        await $.measure.cpu.alert({
          condition: (value) => value > 90,
          for: '5m',
          notify: notifyMock,
        })

        // High CPU
        await $.measure.cpu(95)
        vi.advanceTimersByTime(120000) // 2 minutes

        // CPU drops below threshold - should reset timer
        await $.measure.cpu(50)
        vi.advanceTimersByTime(120000) // 2 more minutes

        // High again
        await $.measure.cpu(95)
        vi.advanceTimersByTime(120000) // 2 minutes

        // Still should not trigger because timer was reset
        expect(notifyMock).not.toHaveBeenCalled()
      })

      it('passes metric info to notify function', async () => {
        const notifyMock = vi.fn()

        await $.measure.cpu.alert({
          condition: (value) => value > 90,
          notify: notifyMock,
        })

        await $.measure.cpu(95, { host: 'web-01' })

        expect(notifyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            metric: 'cpu',
            value: 95,
            tags: { host: 'web-01' },
          })
        )
      })

      it('supports async notify function', async () => {
        const notifyMock = vi.fn().mockResolvedValue(undefined)

        await $.measure.cpu.alert({
          condition: (value) => value > 90,
          notify: async (info) => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            notifyMock(info)
          },
        })

        await $.measure.cpu(95)

        await vi.waitFor(() => {
          expect(notifyMock).toHaveBeenCalled()
        })
      })

      it('can disable an alert', async () => {
        const notifyMock = vi.fn()

        const alert = await $.measure.cpu.alert({
          condition: (value) => value > 90,
          notify: notifyMock,
        })

        await alert.disable()

        // This should not trigger the alert
        await $.measure.cpu(95)

        expect(notifyMock).not.toHaveBeenCalled()
      })

      it('can delete an alert', async () => {
        const notifyMock = vi.fn()

        const alert = await $.measure.cpu.alert({
          condition: (value) => value > 90,
          notify: notifyMock,
        })

        await alert.delete()

        // This should not trigger
        await $.measure.cpu(95)

        expect(notifyMock).not.toHaveBeenCalled()
      })

      it('supports comparison-based conditions', async () => {
        const notifyMock = vi.fn()

        await $.measure.churn.alert({
          condition: { op: '>', value: 0.05 },
          notify: notifyMock,
        })

        await $.measure.churn(0.06)

        expect(notifyMock).toHaveBeenCalled()
      })

      it('supports threshold-based alert shorthand', async () => {
        const notifyMock = vi.fn()

        // Shorthand for condition: value > threshold
        await $.measure.cpu.alertAbove(90, notifyMock)

        await $.measure.cpu(95)

        expect(notifyMock).toHaveBeenCalled()
      })

      it('supports below-threshold alert shorthand', async () => {
        const notifyMock = vi.fn()

        await $.measure.healthScore.alertBelow(50, notifyMock)

        await $.measure.healthScore(40)

        expect(notifyMock).toHaveBeenCalled()
      })
    })
  })

  // ============================================================================
  // Window Subscriptions
  // ============================================================================

  describe('Window Subscriptions', () => {
    describe('$.measure.metricName.window(duration).subscribe()', () => {
      it('subscribes to windowed aggregations', async () => {
        vi.useFakeTimers()
        const callbackMock = vi.fn()

        const subscription = $.measure.revenue.window('5m').subscribe(callbackMock)

        expect(subscription).toHaveProperty('unsubscribe')
      })

      it('emits window stats at interval', async () => {
        vi.useFakeTimers()
        const callbackMock = vi.fn()

        $.measure.revenue.window('1m').subscribe(callbackMock)

        // Record some data
        await $.measure.revenue(100)
        await $.measure.revenue(200)
        await $.measure.revenue(300)

        // Advance past window
        vi.advanceTimersByTime(60000)

        expect(callbackMock).toHaveBeenCalledWith(
          expect.objectContaining({
            sum: 600,
            count: 3,
            avg: 200,
          })
        )
      })

      it('provides tumbling window stats', async () => {
        vi.useFakeTimers()
        const results: any[] = []

        $.measure.requests.window('1m').subscribe((stats) => {
          results.push(stats)
        })

        // Window 1
        await $.measure.requests(10)
        await $.measure.requests(20)
        vi.advanceTimersByTime(60000)

        // Window 2
        await $.measure.requests(30)
        await $.measure.requests(40)
        vi.advanceTimersByTime(60000)

        expect(results.length).toBe(2)
        expect(results[0].sum).toBe(30)
        expect(results[1].sum).toBe(70)
      })

      it('can unsubscribe from window', async () => {
        vi.useFakeTimers()
        const callbackMock = vi.fn()

        const subscription = $.measure.revenue.window('1m').subscribe(callbackMock)

        await $.measure.revenue(100)
        vi.advanceTimersByTime(60000)

        expect(callbackMock).toHaveBeenCalledTimes(1)

        subscription.unsubscribe()

        await $.measure.revenue(200)
        vi.advanceTimersByTime(60000)

        // Should not be called again after unsubscribe
        expect(callbackMock).toHaveBeenCalledTimes(1)
      })

      it('supports sliding windows', async () => {
        vi.useFakeTimers()
        const results: any[] = []

        // 5 minute window, sliding every 1 minute
        $.measure.requests.window('5m', { slide: '1m' }).subscribe((stats) => {
          results.push(stats)
        })

        for (let i = 0; i < 10; i++) {
          await $.measure.requests(10)
          vi.advanceTimersByTime(60000)
        }

        // Should have more emissions than tumbling
        expect(results.length).toBeGreaterThan(2)
      })

      it('handles empty windows', async () => {
        vi.useFakeTimers()
        const callbackMock = vi.fn()

        $.measure.empty.window('1m').subscribe(callbackMock)

        // No data recorded
        vi.advanceTimersByTime(60000)

        expect(callbackMock).toHaveBeenCalledWith(
          expect.objectContaining({
            sum: 0,
            count: 0,
          })
        )
      })
    })
  })

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles empty metric name gracefully', async () => {
      await expect($.measure['' as any](100)).rejects.toThrow()
    })

    it('handles special characters in metric name', async () => {
      await $.measure['api.requests.total'](100)
      expect(await $.measure['api.requests.total'].current()).toBe(100)
    })

    it('handles unicode in metric name', async () => {
      await $.measure['revenue_EUR'](100)
      expect(await $.measure['revenue_EUR'].current()).toBe(100)
    })

    it('handles very large numbers', async () => {
      await $.measure.bigNumber(Number.MAX_SAFE_INTEGER - 1)
      expect(await $.measure.bigNumber.current()).toBe(Number.MAX_SAFE_INTEGER - 1)
    })

    it('handles very small numbers', async () => {
      await $.measure.smallNumber(0.0000001)
      expect(await $.measure.smallNumber.current()).toBeCloseTo(0.0000001, 10)
    })

    it('handles zero value', async () => {
      await $.measure.zero(0)
      expect(await $.measure.zero.current()).toBe(0)
    })

    it('handles negative values for gauges', async () => {
      await $.measure.temperature.set(-40)
      expect(await $.measure.temperature.current()).toBe(-40)
    })

    it('preserves precision for floating point', async () => {
      await $.measure.precise(0.1 + 0.2)
      const value = await $.measure.precise.current()
      expect(value).toBeCloseTo(0.3, 10)
    })

    it('handles high cardinality tags gracefully', async () => {
      // Record with many unique tag values
      for (let i = 0; i < 1000; i++) {
        await $.measure.highCardinality(1, { userId: `user-${i}` })
      }

      const total = await $.measure.highCardinality.sum()
      expect(total).toBe(1000)
    })

    it('handles concurrent operations correctly', async () => {
      const operations = Array.from({ length: 100 }, (_, i) =>
        $.measure.concurrent(i)
      )

      await Promise.all(operations)

      const count = await $.measure.concurrent.count()
      expect(count).toBe(100)
    })
  })

  // ============================================================================
  // Integration with $ Context
  // ============================================================================

  describe('Integration with $ Context', () => {
    it('measure is accessible from $ proxy', async () => {
      expect($.measure).toBeDefined()
      expect(typeof $.measure.revenue).toBe('function')
    })

    it('supports method chaining fluently', async () => {
      vi.useFakeTimers()

      await $.measure.revenue(100)
      vi.advanceTimersByTime(86400000)
      await $.measure.revenue(200)

      // Fluent chain
      const result = await $.measure.revenue.sum().since('7d').by('day')

      expect(result).toBeInstanceOf(Array)
    })

    it('supports tags in all operations consistently', async () => {
      const tags = { plan: 'pro', region: 'us' }

      await $.measure.revenue(100, tags)
      await $.measure.revenue.increment(50, tags)
      await $.measure.revenue.set(200, tags)

      const current = await $.measure.revenue.current(tags)
      expect(current).toBeDefined()
    })
  })
})
