/**
 * RED Phase Tests: Flink Window Function Operations
 * Issue: dotdo-czvgf
 *
 * These tests define expected behavior for window function operations.
 * They should FAIL until the implementation is complete.
 *
 * Tests cover:
 * 1. Tumbling window reduce/aggregate functions
 * 2. Sliding window reduce/aggregate functions
 * 3. Session window reduce/aggregate functions
 * 4. Global window reduce/aggregate functions
 * 5. Window function combinations (reduce + ProcessWindowFunction)
 * 6. Window state accumulation patterns
 * 7. Window result emission ordering
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/operators/windows/#window-functions
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Environment
  StreamExecutionEnvironment,
  createTestEnvironment,
  _clear,

  // Streams
  DataStream,
  WindowedStream,

  // Windows
  TumblingEventTimeWindows,
  SlidingEventTimeWindows,
  SessionWindows,
  GlobalWindows,

  // Window functions
  WindowFunction,
  ProcessWindowFunction,
  AggregateFunction,
  ReduceFunction,

  // Triggers
  CountTrigger,
  PurgingTrigger,

  // Time utilities
  Time,

  // Watermarks
  WatermarkStrategy,

  // Types
  Collector,
  TimeWindow,
} from '../index'

// ============================================================================
// Test Types
// ============================================================================

interface MetricEvent {
  sensorId: string
  timestamp: number
  value: number
  type: 'temperature' | 'humidity' | 'pressure'
}

interface WindowStats {
  key: string
  count: number
  sum: number
  min: number
  max: number
  avg: number
  windowStart: number
  windowEnd: number
}

interface RollingAverage {
  key: string
  currentAvg: number
  windowCount: number
}

// ============================================================================
// Test Setup
// ============================================================================

describe('@dotdo/flink - Window Function Operations (TDD RED Phase)', () => {
  beforeEach(() => {
    _clear()
  })

  // ==========================================================================
  // 1. Tumbling Window Reduce Functions
  // ==========================================================================

  describe('Tumbling Window Reduce Functions', () => {
    it('should reduce elements incrementally within tumbling window', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 20, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 3000, value: 30, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 4000, value: 40, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({
          sensorId: a.sensorId,
          timestamp: Math.max(a.timestamp, b.timestamp),
          value: a.value + b.value,
          type: a.type,
        }))

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(100) // 10+20+30+40
      expect(result[0]?.timestamp).toBe(4000) // Max timestamp
    })

    it('should apply reduce with ReduceFunction interface', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 25, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 30, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 3000, value: 20, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const maxReducer: ReduceFunction<MetricEvent> = {
        reduce: (a, b) => ({
          sensorId: a.sensorId,
          timestamp: b.timestamp,
          value: Math.max(a.value, b.value),
          type: a.type,
        }),
      }

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce(maxReducer)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(30) // Max value
    })

    it('should handle reduce across multiple keys in same window', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's2', timestamp: 1500, value: 100, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 20, type: 'temperature' as const },
          { sensorId: 's2', timestamp: 2500, value: 200, type: 'temperature' as const },
          { sensorId: 's3', timestamp: 3000, value: 1000, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(3)
      expect(result).toContainEqual(expect.objectContaining({ sensorId: 's1', value: 30 }))
      expect(result).toContainEqual(expect.objectContaining({ sensorId: 's2', value: 300 }))
      expect(result).toContainEqual(expect.objectContaining({ sensorId: 's3', value: 1000 }))
    })
  })

  // ==========================================================================
  // 2. Tumbling Window Aggregate Functions
  // ==========================================================================

  describe('Tumbling Window Aggregate Functions', () => {
    it('should compute complex statistics with AggregateFunction', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 20, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 3000, value: 15, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 4000, value: 25, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const statsAggregator: AggregateFunction<
        MetricEvent,
        { sum: number; count: number; min: number; max: number; key: string },
        { key: string; avg: number; min: number; max: number; count: number }
      > = {
        createAccumulator: () => ({
          sum: 0,
          count: 0,
          min: Number.MAX_SAFE_INTEGER,
          max: Number.MIN_SAFE_INTEGER,
          key: '',
        }),
        add: (value, acc) => ({
          sum: acc.sum + value.value,
          count: acc.count + 1,
          min: Math.min(acc.min, value.value),
          max: Math.max(acc.max, value.value),
          key: value.sensorId,
        }),
        getResult: (acc) => ({
          key: acc.key,
          avg: acc.count > 0 ? acc.sum / acc.count : 0,
          min: acc.min,
          max: acc.max,
          count: acc.count,
        }),
        merge: (a, b) => ({
          sum: a.sum + b.sum,
          count: a.count + b.count,
          min: Math.min(a.min, b.min),
          max: Math.max(a.max, b.max),
          key: a.key || b.key,
        }),
      }

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .aggregate(statsAggregator)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        key: 's1',
        avg: 17.5, // (10+20+15+25) / 4
        min: 10,
        max: 25,
        count: 4,
      })
    })

    it('should handle aggregate with empty accumulator merging', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 50, type: 'humidity' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const countAggregator: AggregateFunction<MetricEvent, number, number> = {
        createAccumulator: () => 0,
        add: (_, acc) => acc + 1,
        getResult: (acc) => acc,
        merge: (a, b) => a + b,
      }

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .aggregate(countAggregator)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]).toBe(1)
    })
  })

  // ==========================================================================
  // 3. Sliding Window Reduce Functions
  // ==========================================================================

  describe('Sliding Window Reduce Functions', () => {
    it('should reduce elements in overlapping sliding windows', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 0, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 1000, value: 20, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 30, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 3000, value: 40, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 4000, value: 50, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      // 3 second window, sliding every 1 second
      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(SlidingEventTimeWindows.of(Time.seconds(3), Time.seconds(1)))
        .reduce((a, b) => ({ ...a, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)

      // Multiple overlapping windows should produce multiple results
      expect(result.length).toBeGreaterThan(1)
    })

    it('should include same element in multiple sliding window reductions', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements({ sensorId: 's1', timestamp: 2000, value: 100, type: 'pressure' as const })
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      // 4 second window, sliding every 1 second
      // Element at 2000 should be in windows: [0,4000), [1000,5000), [2000,6000)
      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(SlidingEventTimeWindows.of(Time.seconds(4), Time.seconds(1)))
        .reduce((a, b) => a)

      const result = await env.executeAndCollect(windowed)

      // Same element should appear in multiple windows
      expect(result.length).toBeGreaterThanOrEqual(1)
      result.forEach((r) => {
        expect(r.value).toBe(100)
      })
    })
  })

  // ==========================================================================
  // 4. Sliding Window Aggregate Functions
  // ==========================================================================

  describe('Sliding Window Aggregate Functions', () => {
    it('should compute moving average with sliding windows', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 0, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 1000, value: 20, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 30, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 3000, value: 40, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const avgAggregator: AggregateFunction<
        MetricEvent,
        { sum: number; count: number },
        number
      > = {
        createAccumulator: () => ({ sum: 0, count: 0 }),
        add: (value, acc) => ({ sum: acc.sum + value.value, count: acc.count + 1 }),
        getResult: (acc) => (acc.count > 0 ? acc.sum / acc.count : 0),
        merge: (a, b) => ({ sum: a.sum + b.sum, count: a.count + b.count }),
      }

      // 2 second window, sliding every 1 second
      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(SlidingEventTimeWindows.of(Time.seconds(2), Time.seconds(1)))
        .aggregate(avgAggregator)

      const result = await env.executeAndCollect(windowed)

      // Should have multiple moving averages
      expect(result.length).toBeGreaterThan(1)
      // All values should be positive numbers
      result.forEach((avg) => {
        expect(typeof avg).toBe('number')
        expect(avg).toBeGreaterThan(0)
      })
    })
  })

  // ==========================================================================
  // 5. Session Window Reduce Functions
  // ==========================================================================

  describe('Session Window Reduce Functions', () => {
    it('should reduce elements within session gap', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          // Session 1
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 20, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 3000, value: 30, type: 'temperature' as const },
          // Gap > 5 seconds
          // Session 2
          { sensorId: 's1', timestamp: 10000, value: 100, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 11000, value: 200, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(SessionWindows.withGap(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)

      // Should have 2 sessions
      expect(result).toHaveLength(2)
      expect(result).toContainEqual(expect.objectContaining({ value: 60 })) // 10+20+30
      expect(result).toContainEqual(expect.objectContaining({ value: 300 })) // 100+200
    })

    it('should merge sessions when bridging event arrives', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 8000, value: 80, type: 'temperature' as const },
          // Bridging event - arrives late but within session gap of both
          { sensorId: 's1', timestamp: 4500, value: 45, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(SessionWindows.withGap(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)

      // Bridging event should merge sessions
      // Event at 1000 -> session ends at 6000
      // Event at 4500 -> session [4500, 9500) overlaps with previous
      // Event at 8000 -> session [8000, 13000) overlaps
      // All should merge into one session
      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(135) // 10+45+80
    })
  })

  // ==========================================================================
  // 6. Session Window Aggregate Functions
  // ==========================================================================

  describe('Session Window Aggregate Functions', () => {
    it('should aggregate session data with complex accumulator', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 20, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 3000, value: 15, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      interface SessionStats {
        firstEventTime: number
        lastEventTime: number
        eventCount: number
        totalValue: number
      }

      const sessionAggregator: AggregateFunction<MetricEvent, SessionStats, SessionStats> = {
        createAccumulator: () => ({
          firstEventTime: Number.MAX_SAFE_INTEGER,
          lastEventTime: 0,
          eventCount: 0,
          totalValue: 0,
        }),
        add: (value, acc) => ({
          firstEventTime: Math.min(acc.firstEventTime, value.timestamp),
          lastEventTime: Math.max(acc.lastEventTime, value.timestamp),
          eventCount: acc.eventCount + 1,
          totalValue: acc.totalValue + value.value,
        }),
        getResult: (acc) => acc,
        merge: (a, b) => ({
          firstEventTime: Math.min(a.firstEventTime, b.firstEventTime),
          lastEventTime: Math.max(a.lastEventTime, b.lastEventTime),
          eventCount: a.eventCount + b.eventCount,
          totalValue: a.totalValue + b.totalValue,
        }),
      }

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(SessionWindows.withGap(Time.seconds(5)))
        .aggregate(sessionAggregator)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        firstEventTime: 1000,
        lastEventTime: 3000,
        eventCount: 3,
        totalValue: 45,
      })
    })
  })

  // ==========================================================================
  // 7. Global Window Reduce Functions
  // ==========================================================================

  describe('Global Window Reduce Functions', () => {
    it('should reduce all elements in global window with count trigger', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
        { sensorId: 's1', timestamp: 2000, value: 20, type: 'temperature' as const },
        { sensorId: 's1', timestamp: 3000, value: 30, type: 'temperature' as const }
      )

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(GlobalWindows.create())
        .trigger(CountTrigger.of(3))
        .reduce((a, b) => ({ ...a, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(60)
    })

    it('should fire multiple times with count trigger in global window', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { sensorId: 's1', timestamp: 1000, value: 1, type: 'temperature' as const },
        { sensorId: 's1', timestamp: 2000, value: 2, type: 'temperature' as const },
        { sensorId: 's1', timestamp: 3000, value: 3, type: 'temperature' as const },
        { sensorId: 's1', timestamp: 4000, value: 4, type: 'temperature' as const }
      )

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(GlobalWindows.create())
        .trigger(CountTrigger.of(2))
        .reduce((a, b) => ({ ...a, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)

      // Should fire at count 2 and again at count 4
      // But global window accumulates, so depends on purging behavior
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should purge and restart accumulation with PurgingTrigger', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
        { sensorId: 's1', timestamp: 2000, value: 20, type: 'temperature' as const },
        { sensorId: 's1', timestamp: 3000, value: 30, type: 'temperature' as const },
        { sensorId: 's1', timestamp: 4000, value: 40, type: 'temperature' as const }
      )

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(GlobalWindows.create())
        .trigger(PurgingTrigger.of(CountTrigger.of(2)))
        .reduce((a, b) => ({ ...a, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)

      // First fire: 10+20=30, Second fire: 30+40=70
      expect(result).toHaveLength(2)
      expect(result[0]?.value).toBe(30)
      expect(result[1]?.value).toBe(70)
    })
  })

  // ==========================================================================
  // 8. Global Window Aggregate Functions
  // ==========================================================================

  describe('Global Window Aggregate Functions', () => {
    it('should aggregate with running statistics in global window', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
        { sensorId: 's1', timestamp: 2000, value: 20, type: 'temperature' as const },
        { sensorId: 's1', timestamp: 3000, value: 30, type: 'temperature' as const }
      )

      const runningAvgAggregator: AggregateFunction<
        MetricEvent,
        { sum: number; count: number },
        { avg: number; count: number }
      > = {
        createAccumulator: () => ({ sum: 0, count: 0 }),
        add: (value, acc) => ({ sum: acc.sum + value.value, count: acc.count + 1 }),
        getResult: (acc) => ({
          avg: acc.count > 0 ? acc.sum / acc.count : 0,
          count: acc.count,
        }),
        merge: (a, b) => ({ sum: a.sum + b.sum, count: a.count + b.count }),
      }

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(GlobalWindows.create())
        .trigger(CountTrigger.of(3))
        .aggregate(runningAvgAggregator)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ avg: 20, count: 3 })
    })
  })

  // ==========================================================================
  // 9. WindowFunction with Full Element Access
  // ==========================================================================

  describe('WindowFunction with Full Element Access', () => {
    it('should provide all window elements to WindowFunction.apply()', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 20, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 3000, value: 30, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      let elementsReceived: MetricEvent[] = []

      const windowFn: WindowFunction<MetricEvent, WindowStats, string> = {
        apply: (key, window, elements, out) => {
          const arr = [...elements]
          elementsReceived = arr

          let sum = 0
          let min = Number.MAX_SAFE_INTEGER
          let max = Number.MIN_SAFE_INTEGER

          for (const e of arr) {
            sum += e.value
            min = Math.min(min, e.value)
            max = Math.max(max, e.value)
          }

          out.collect({
            key,
            count: arr.length,
            sum,
            min,
            max,
            avg: arr.length > 0 ? sum / arr.length : 0,
            windowStart: window.getStart(),
            windowEnd: window.getEnd(),
          })
        },
      }

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .apply(windowFn)

      const result = await env.executeAndCollect(windowed)

      expect(elementsReceived).toHaveLength(3)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        key: 's1',
        count: 3,
        sum: 60,
        min: 10,
        max: 30,
        avg: 20,
        windowStart: 0,
        windowEnd: 5000,
      })
    })

    it('should emit multiple results from single window with WindowFunction', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 20, type: 'humidity' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowFn: WindowFunction<MetricEvent, string, string> = {
        apply: (key, window, elements, out) => {
          // Emit one result per element
          for (const e of elements) {
            out.collect(`${key}:${e.type}:${e.value}`)
          }
        },
      }

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .apply(windowFn)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(2)
      expect(result).toContain('s1:temperature:10')
      expect(result).toContain('s1:humidity:20')
    })
  })

  // ==========================================================================
  // 10. ProcessWindowFunction with Context
  // ==========================================================================

  describe('ProcessWindowFunction with Context', () => {
    it('should provide window context in ProcessWindowFunction', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 2500, value: 25, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 3500, value: 35, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      let capturedContext: {
        windowStart: number
        windowEnd: number
        processingTime: number
        watermark: number
      } | null = null

      const processFn: ProcessWindowFunction<
        MetricEvent,
        { key: string; windowStart: number; windowEnd: number },
        string
      > = {
        process: (key, context, elements, out) => {
          const window = context.window()
          capturedContext = {
            windowStart: window.getStart(),
            windowEnd: window.getEnd(),
            processingTime: context.currentProcessingTime(),
            watermark: context.currentWatermark(),
          }

          out.collect({
            key,
            windowStart: window.getStart(),
            windowEnd: window.getEnd(),
          })
        },
      }

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .process(processFn)

      const result = await env.executeAndCollect(windowed)

      expect(capturedContext).not.toBeNull()
      expect(capturedContext!.windowStart).toBe(0)
      expect(capturedContext!.windowEnd).toBe(5000)
      expect(typeof capturedContext!.processingTime).toBe('number')
      expect(typeof capturedContext!.watermark).toBe('number')

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        key: 's1',
        windowStart: 0,
        windowEnd: 5000,
      })
    })

    it('should handle ProcessWindowFunction with per-window state', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 20, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 6000, value: 60, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowCounts: number[] = []

      const processFn: ProcessWindowFunction<MetricEvent, number, string> = {
        process: (key, context, elements, out) => {
          let count = 0
          for (const _ of elements) {
            count++
          }
          windowCounts.push(count)
          out.collect(count)
        },
      }

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .process(processFn)

      const result = await env.executeAndCollect(windowed)

      // Two windows: [0, 5000) with 2 elements, [5000, 10000) with 1 element
      expect(result).toHaveLength(2)
      expect(result).toContainEqual(2)
      expect(result).toContainEqual(1)
    })
  })

  // ==========================================================================
  // 11. Reduce + WindowFunction Combination
  // ==========================================================================

  describe('Reduce + WindowFunction Combination', () => {
    it('should combine incremental reduce with WindowFunction for enrichment', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 20, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 3000, value: 30, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      // First reduce incrementally, then enrich with window metadata
      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce(
          (a, b) => ({ ...a, value: a.value + b.value }),
          {
            apply: (key: string, window: TimeWindow, input: Iterable<MetricEvent>, out: Collector<{ key: string; sum: number; windowStart: number; windowEnd: number }>) => {
              for (const reduced of input) {
                out.collect({
                  key,
                  sum: reduced.value,
                  windowStart: window.getStart(),
                  windowEnd: window.getEnd(),
                })
              }
            },
          }
        )

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        key: 's1',
        sum: 60,
        windowStart: 0,
        windowEnd: 5000,
      })
    })
  })

  // ==========================================================================
  // 12. Aggregate + WindowFunction Combination
  // ==========================================================================

  describe('Aggregate + WindowFunction Combination', () => {
    it('should combine aggregate with WindowFunction for enriched output', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 20, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const avgAggregator: AggregateFunction<MetricEvent, { sum: number; count: number }, number> = {
        createAccumulator: () => ({ sum: 0, count: 0 }),
        add: (value, acc) => ({ sum: acc.sum + value.value, count: acc.count + 1 }),
        getResult: (acc) => (acc.count > 0 ? acc.sum / acc.count : 0),
        merge: (a, b) => ({ sum: a.sum + b.sum, count: a.count + b.count }),
      }

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .aggregate(
          avgAggregator,
          {
            apply: (key: string, window: TimeWindow, input: Iterable<number>, out: Collector<{ key: string; avg: number; windowStart: number }>) => {
              for (const avg of input) {
                out.collect({
                  key,
                  avg,
                  windowStart: window.getStart(),
                })
              }
            },
          }
        )

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        key: 's1',
        avg: 15,
        windowStart: 0,
      })
    })
  })

  // ==========================================================================
  // 13. Window Function Output Ordering
  // ==========================================================================

  describe('Window Function Output Ordering', () => {
    it('should maintain key ordering in window results', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's2', timestamp: 1500, value: 100, type: 'temperature' as const },
          { sensorId: 's3', timestamp: 2000, value: 1000, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => a)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(3)
      // All three keys should have results
      const sensorIds = result.map((r) => r.sensorId).sort()
      expect(sensorIds).toEqual(['s1', 's2', 's3'])
    })

    it('should emit windows in timestamp order for same key', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 6000, value: 60, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 11000, value: 110, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowFn: WindowFunction<MetricEvent, { value: number; windowStart: number }, string> = {
        apply: (key, window, elements, out) => {
          for (const e of elements) {
            out.collect({ value: e.value, windowStart: window.getStart() })
          }
        },
      }

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .apply(windowFn)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(3)
      // Windows should be in order: [0,5000), [5000,10000), [10000,15000)
      expect(result[0]?.windowStart).toBe(0)
      expect(result[1]?.windowStart).toBe(5000)
      expect(result[2]?.windowStart).toBe(10000)
    })
  })

  // ==========================================================================
  // 14. Edge Cases for Window Functions
  // ==========================================================================

  describe('Edge Cases for Window Functions', () => {
    it('should handle single element in window', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: 42, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(42)
    })

    it('should handle empty stream gracefully', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements<MetricEvent>()

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => a)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(0)
    })

    it('should handle events exactly at window boundary', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 4999, value: 10, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 5000, value: 50, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => a)

      const result = await env.executeAndCollect(windowed)

      // 4999 in [0, 5000), 5000 in [5000, 10000)
      expect(result).toHaveLength(2)
      expect(result).toContainEqual(expect.objectContaining({ value: 10 }))
      expect(result).toContainEqual(expect.objectContaining({ value: 50 }))
    })

    it('should handle very large values in aggregation', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { sensorId: 's1', timestamp: 1000, value: Number.MAX_SAFE_INTEGER - 1, type: 'temperature' as const },
          { sensorId: 's1', timestamp: 2000, value: 1, type: 'temperature' as const }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<MetricEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.sensorId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: a.value + b.value }))

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(Number.MAX_SAFE_INTEGER)
    })
  })
})
