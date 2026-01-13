/**
 * RED Phase Tests: Flink Window Functions
 * Issue: dotdo-czvgf
 *
 * These tests define the expected behavior for Flink Window APIs.
 * They should FAIL until the implementation is complete.
 *
 * Tests cover:
 * 1. TumblingEventTimeWindows - Fixed-size non-overlapping windows
 * 2. SlidingEventTimeWindows - Overlapping windows
 * 3. SessionWindows - Gap-based windows
 * 4. GlobalWindows - Single global window
 * 5. WindowedStream.apply() - Apply WindowFunction
 * 6. WindowedStream.reduce() - Incremental aggregation
 * 7. WindowedStream.aggregate() - Custom aggregator
 * 8. Watermarks and late event handling
 * 9. Allowed lateness configuration
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/operators/windows/
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Environment
  StreamExecutionEnvironment,
  createTestEnvironment,
  _clear,

  // Streams
  DataStream,
  KeyedStream,
  WindowedStream,

  // Windows
  TumblingEventTimeWindows,
  TumblingProcessingTimeWindows,
  SlidingEventTimeWindows,
  SlidingProcessingTimeWindows,
  SessionWindows,
  GlobalWindows,

  // Window functions
  WindowFunction,
  ProcessWindowFunction,
  AggregateFunction,

  // Triggers
  CountTrigger,
  EventTimeTrigger,
  ProcessingTimeTrigger,
  PurgingTrigger,
  ContinuousEventTimeTrigger,
  TriggerResult,

  // Evictors
  CountEvictor,
  TimeEvictor,

  // Time utilities
  Time,
  Duration,

  // Watermarks
  WatermarkStrategy,
  Watermark,
  WatermarkGenerator,
  BoundedOutOfOrdernessWatermarks,

  // Side outputs
  OutputTag,

  // Types
  Collector,
  TimeWindow,
} from '../index'

// ============================================================================
// Test Types
// ============================================================================

interface ClickEvent {
  userId: string
  timestamp: number
  pageId: string
  sessionId?: string
  value?: number
}

interface WindowResult {
  key: string
  count: number
  sum: number
  windowStart: number
  windowEnd: number
}

interface AggregateAccumulator {
  sum: number
  count: number
  min: number
  max: number
}

// ============================================================================
// Test Setup
// ============================================================================

describe('@dotdo/flink - Window Functions (TDD RED Phase)', () => {
  beforeEach(() => {
    _clear()
  })

  // ==========================================================================
  // 1. TumblingEventTimeWindows - Fixed-size non-overlapping windows
  // ==========================================================================

  describe('TumblingEventTimeWindows', () => {
    it('should assign elements to non-overlapping fixed-size windows', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'home', value: 10 },
          { userId: 'u1', timestamp: 2500, pageId: 'products', value: 20 },
          { userId: 'u1', timestamp: 4000, pageId: 'cart', value: 30 },
          // New window [5000, 10000)
          { userId: 'u1', timestamp: 5500, pageId: 'checkout', value: 40 },
          { userId: 'u1', timestamp: 8000, pageId: 'payment', value: 50 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Window [0, 5000) should have sum 60 (10+20+30)
      // Window [5000, 10000) should have sum 90 (40+50)
      expect(result).toHaveLength(2)
      expect(result).toContainEqual(expect.objectContaining({ userId: 'u1', value: 60 }))
      expect(result).toContainEqual(expect.objectContaining({ userId: 'u1', value: 90 }))
    })

    it('should handle window alignment with timestamp offset', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 500, pageId: 'home', value: 10 },
          { userId: 'u1', timestamp: 1200, pageId: 'products', value: 20 },
          { userId: 'u1', timestamp: 2800, pageId: 'cart', value: 30 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      // With 500ms offset, windows are [500, 2500), [2500, 4500), etc.
      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(2), Time.milliseconds(500)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Window [500, 2500) contains events at 500 and 1200 -> sum 30
      // Window [2500, 4500) contains event at 2800 -> sum 30
      expect(result).toHaveLength(2)
      expect(result).toContainEqual(expect.objectContaining({ value: 30 }))
      expect(result).toContainEqual(expect.objectContaining({ value: 30 }))
    })

    it('should maintain separate windows per key', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'home', value: 10 },
          { userId: 'u2', timestamp: 1500, pageId: 'home', value: 100 },
          { userId: 'u1', timestamp: 2000, pageId: 'cart', value: 20 },
          { userId: 'u2', timestamp: 3000, pageId: 'cart', value: 200 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // u1 sum = 30, u2 sum = 300
      expect(result).toHaveLength(2)
      expect(result).toContainEqual(expect.objectContaining({ userId: 'u1', value: 30 }))
      expect(result).toContainEqual(expect.objectContaining({ userId: 'u2', value: 300 }))
    })

    it('should handle empty windows correctly', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'home', value: 10 },
          // Gap - no events in [5000, 10000)
          { userId: 'u1', timestamp: 11000, pageId: 'cart', value: 20 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Only 2 windows should fire (not the empty one in between)
      expect(result).toHaveLength(2)
      expect(result).toContainEqual(expect.objectContaining({ value: 10 }))
      expect(result).toContainEqual(expect.objectContaining({ value: 20 }))
    })
  })

  // ==========================================================================
  // 2. SlidingEventTimeWindows - Overlapping windows
  // ==========================================================================

  describe('SlidingEventTimeWindows', () => {
    it('should assign elements to multiple overlapping windows', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'home', value: 10 },
          { userId: 'u1', timestamp: 3000, pageId: 'products', value: 20 },
          { userId: 'u1', timestamp: 5000, pageId: 'cart', value: 30 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      // 4 second window, sliding every 2 seconds
      // Windows: [-2000, 2000), [0, 4000), [2000, 6000), [4000, 8000), etc.
      const windowed = events
        .keyBy((e) => e.userId)
        .window(SlidingEventTimeWindows.of(Time.seconds(4), Time.seconds(2)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Event at 1000 belongs to windows: [-2000, 2000), [0, 4000)
      // Event at 3000 belongs to windows: [0, 4000), [2000, 6000)
      // Event at 5000 belongs to windows: [2000, 6000), [4000, 8000)
      // Multiple windows should fire with different sums
      expect(result.length).toBeGreaterThan(2)
    })

    it('should include same element in multiple windows based on slide', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements({ userId: 'u1', timestamp: 2500, pageId: 'home', value: 100 })
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      // 6 second window, sliding every 2 seconds
      // Element at 2500 should be in windows: [0, 6000), [2000, 8000)
      const windowed = events
        .keyBy((e) => e.userId)
        .window(SlidingEventTimeWindows.of(Time.seconds(6), Time.seconds(2)))
        .reduce((a, b) => a)

      const result = await env.executeAndCollect(windowed)

      // The single element should appear in multiple windows
      expect(result.length).toBeGreaterThanOrEqual(2)
      result.forEach((r) => {
        expect(r.value).toBe(100)
      })
    })

    it('should compute running averages with overlapping windows', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 0, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 1000, pageId: 'b', value: 20 },
          { userId: 'u1', timestamp: 2000, pageId: 'c', value: 30 },
          { userId: 'u1', timestamp: 3000, pageId: 'd', value: 40 },
          { userId: 'u1', timestamp: 4000, pageId: 'e', value: 50 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      // 3 second window, sliding every 1 second
      const windowed = events
        .keyBy((e) => e.userId)
        .window(SlidingEventTimeWindows.of(Time.seconds(3), Time.seconds(1)))
        .aggregate({
          createAccumulator: () => ({ sum: 0, count: 0 }),
          add: (value, acc) => ({
            sum: acc.sum + (value.value ?? 0),
            count: acc.count + 1,
          }),
          getResult: (acc) => acc.count > 0 ? acc.sum / acc.count : 0,
          merge: (a, b) => ({ sum: a.sum + b.sum, count: a.count + b.count }),
        })

      const result = await env.executeAndCollect(windowed)

      // Should have multiple overlapping window results
      expect(result.length).toBeGreaterThan(2)
      // All averages should be positive numbers
      result.forEach((avg) => {
        expect(avg).toBeGreaterThan(0)
      })
    })
  })

  // ==========================================================================
  // 3. SessionWindows - Gap-based windows
  // ==========================================================================

  describe('SessionWindows', () => {
    it('should create session windows based on inactivity gap', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          // Session 1: events within 3s gap
          { userId: 'u1', timestamp: 1000, pageId: 'home', value: 10 },
          { userId: 'u1', timestamp: 2000, pageId: 'products', value: 20 },
          { userId: 'u1', timestamp: 4000, pageId: 'cart', value: 30 },
          // Gap > 5 seconds - new session
          { userId: 'u1', timestamp: 15000, pageId: 'home', value: 100 },
          { userId: 'u1', timestamp: 17000, pageId: 'checkout', value: 200 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(SessionWindows.withGap(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Session 1: sum = 60 (10+20+30)
      // Session 2: sum = 300 (100+200)
      expect(result).toHaveLength(2)
      expect(result).toContainEqual(expect.objectContaining({ value: 60 }))
      expect(result).toContainEqual(expect.objectContaining({ value: 300 }))
    })

    it('should merge overlapping session windows', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 5000, pageId: 'b', value: 20 },
          // This event bridges the two sessions (gap is 4s from each)
          { userId: 'u1', timestamp: 3000, pageId: 'c', value: 30 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(SessionWindows.withGap(Time.seconds(3)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // All events should merge into a single session
      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(60)
    })

    it('should support dynamic session gap extraction', async () => {
      const env = createTestEnvironment()

      interface SessionEvent extends ClickEvent {
        sessionTimeout: number
      }

      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'home', value: 10, sessionTimeout: 2000 },
          { userId: 'u1', timestamp: 2500, pageId: 'products', value: 20, sessionTimeout: 2000 },
          // Gap > 2s -> new session
          { userId: 'u1', timestamp: 6000, pageId: 'cart', value: 30, sessionTimeout: 5000 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<SessionEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(
          SessionWindows.withDynamicGap({
            extract: (element: SessionEvent) => element.sessionTimeout,
          })
        )
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Session gaps are determined per-element
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle session windows per key independently', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'home', value: 10 },
          { userId: 'u2', timestamp: 1500, pageId: 'home', value: 100 },
          // u1 gap > 5s
          { userId: 'u1', timestamp: 10000, pageId: 'cart', value: 20 },
          // u2 within session
          { userId: 'u2', timestamp: 3000, pageId: 'cart', value: 200 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(SessionWindows.withGap(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // u1: 2 sessions (10, 20)
      // u2: 1 session (300)
      expect(result).toHaveLength(3)
      const u1Results = result.filter((r) => r.userId === 'u1')
      const u2Results = result.filter((r) => r.userId === 'u2')
      expect(u1Results).toHaveLength(2)
      expect(u2Results).toHaveLength(1)
      expect(u2Results[0]?.value).toBe(300)
    })
  })

  // ==========================================================================
  // 4. GlobalWindows - Single global window
  // ==========================================================================

  describe('GlobalWindows', () => {
    it('should create a single global window per key', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
        { userId: 'u1', timestamp: 50000, pageId: 'b', value: 20 },
        { userId: 'u1', timestamp: 100000, pageId: 'c', value: 30 }
      )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(GlobalWindows.create())
        .trigger(CountTrigger.of(3))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Fires after 3 elements
      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(60)
    })

    it('should fire multiple times with count trigger', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', timestamp: 1000, pageId: 'a', value: 1 },
        { userId: 'u1', timestamp: 2000, pageId: 'b', value: 2 },
        { userId: 'u1', timestamp: 3000, pageId: 'c', value: 3 },
        { userId: 'u1', timestamp: 4000, pageId: 'd', value: 4 },
        { userId: 'u1', timestamp: 5000, pageId: 'e', value: 5 },
        { userId: 'u1', timestamp: 6000, pageId: 'f', value: 6 }
      )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(GlobalWindows.create())
        .trigger(CountTrigger.of(2))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Fires after every 2 elements: (1+2), (3+4), (5+6)
      // Note: Global window accumulates, so results depend on implementation
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should work with purging trigger to clear state', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
        { userId: 'u1', timestamp: 2000, pageId: 'b', value: 20 },
        { userId: 'u1', timestamp: 3000, pageId: 'c', value: 30 },
        { userId: 'u1', timestamp: 4000, pageId: 'd', value: 40 }
      )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(GlobalWindows.create())
        .trigger(PurgingTrigger.of(CountTrigger.of(2)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // With purging trigger, each firing clears state
      // First fire: 10+20=30, Second fire: 30+40=70
      expect(result).toHaveLength(2)
      expect(result[0]?.value).toBe(30)
      expect(result[1]?.value).toBe(70)
    })
  })

  // ==========================================================================
  // 5. WindowedStream.apply() - Apply WindowFunction
  // ==========================================================================

  describe('WindowedStream.apply()', () => {
    it('should apply WindowFunction with access to all elements and window metadata', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'home', value: 10 },
          { userId: 'u1', timestamp: 2000, pageId: 'products', value: 20 },
          { userId: 'u1', timestamp: 3000, pageId: 'cart', value: 30 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowFunction: WindowFunction<ClickEvent, WindowResult, string> = {
        apply: (key, window, elements, out) => {
          let sum = 0
          let count = 0
          for (const e of elements) {
            sum += e.value ?? 0
            count++
          }
          out.collect({
            key,
            sum,
            count,
            windowStart: window.getStart(),
            windowEnd: window.getEnd(),
          })
        },
      }

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .apply(windowFunction)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        key: 'u1',
        sum: 60,
        count: 3,
        windowStart: 0,
        windowEnd: 5000,
      })
    })

    it('should provide correct window boundaries in WindowFunction', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 6500, pageId: 'home', value: 10 },
          { userId: 'u1', timestamp: 8000, pageId: 'cart', value: 20 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const boundaries: Array<{ start: number; end: number }> = []

      const windowFunction: WindowFunction<ClickEvent, number, string> = {
        apply: (key, window, elements, out) => {
          boundaries.push({ start: window.getStart(), end: window.getEnd() })
          out.collect(window.getStart())
        },
      }

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .apply(windowFunction)

      await env.executeAndCollect(windowed)

      // Window should be [5000, 10000)
      expect(boundaries).toHaveLength(1)
      expect(boundaries[0]).toEqual({ start: 5000, end: 10000 })
    })

    it('should emit multiple results from single window', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'home', value: 10 },
          { userId: 'u1', timestamp: 2000, pageId: 'products', value: 20 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowFunction: WindowFunction<ClickEvent, string, string> = {
        apply: (key, window, elements, out) => {
          // Emit one result per element in window
          for (const e of elements) {
            out.collect(`${key}:${e.pageId}`)
          }
        },
      }

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .apply(windowFunction)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(2)
      expect(result).toContain('u1:home')
      expect(result).toContain('u1:products')
    })
  })

  // ==========================================================================
  // 6. WindowedStream.reduce() - Incremental aggregation
  // ==========================================================================

  describe('WindowedStream.reduce()', () => {
    it('should incrementally reduce elements as they arrive', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 2000, pageId: 'b', value: 20 },
          { userId: 'u1', timestamp: 3000, pageId: 'c', value: 30 },
          { userId: 'u1', timestamp: 4000, pageId: 'd', value: 40 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(100)
    })

    it('should preserve element structure in reduce', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'first', value: 10 },
          { userId: 'u1', timestamp: 2000, pageId: 'last', value: 20 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({
          userId: a.userId,
          timestamp: Math.max(a.timestamp, b.timestamp),
          pageId: b.pageId, // Keep last pageId
          value: (a.value ?? 0) + (b.value ?? 0),
        }))

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        userId: 'u1',
        timestamp: 2000,
        pageId: 'last',
        value: 30,
      })
    })

    it('should reduce with ReduceFunction interface', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 5 },
          { userId: 'u1', timestamp: 2000, pageId: 'b', value: 15 },
          { userId: 'u1', timestamp: 3000, pageId: 'c', value: 25 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const reduceFunction = {
        reduce: (a: ClickEvent, b: ClickEvent) => ({
          ...a,
          value: Math.max(a.value ?? 0, b.value ?? 0),
        }),
      }

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce(reduceFunction)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(25) // Max value
    })
  })

  // ==========================================================================
  // 7. WindowedStream.aggregate() - Custom aggregator
  // ==========================================================================

  describe('WindowedStream.aggregate()', () => {
    it('should compute average using custom aggregator', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 2000, pageId: 'b', value: 20 },
          { userId: 'u1', timestamp: 3000, pageId: 'c', value: 30 },
          { userId: 'u1', timestamp: 4000, pageId: 'd', value: 40 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const averageAggregator: AggregateFunction<
        ClickEvent,
        { sum: number; count: number },
        number
      > = {
        createAccumulator: () => ({ sum: 0, count: 0 }),
        add: (value, acc) => ({
          sum: acc.sum + (value.value ?? 0),
          count: acc.count + 1,
        }),
        getResult: (acc) => (acc.count > 0 ? acc.sum / acc.count : 0),
        merge: (a, b) => ({ sum: a.sum + b.sum, count: a.count + b.count }),
      }

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .aggregate(averageAggregator)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]).toBe(25) // (10+20+30+40) / 4 = 25
    })

    it('should compute min/max/sum/count statistics', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 5 },
          { userId: 'u1', timestamp: 2000, pageId: 'b', value: 15 },
          { userId: 'u1', timestamp: 3000, pageId: 'c', value: 10 },
          { userId: 'u1', timestamp: 4000, pageId: 'd', value: 20 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const statsAggregator: AggregateFunction<
        ClickEvent,
        AggregateAccumulator,
        { sum: number; count: number; min: number; max: number; avg: number }
      > = {
        createAccumulator: () => ({
          sum: 0,
          count: 0,
          min: Number.MAX_SAFE_INTEGER,
          max: Number.MIN_SAFE_INTEGER,
        }),
        add: (value, acc) => ({
          sum: acc.sum + (value.value ?? 0),
          count: acc.count + 1,
          min: Math.min(acc.min, value.value ?? 0),
          max: Math.max(acc.max, value.value ?? 0),
        }),
        getResult: (acc) => ({
          sum: acc.sum,
          count: acc.count,
          min: acc.min,
          max: acc.max,
          avg: acc.count > 0 ? acc.sum / acc.count : 0,
        }),
        merge: (a, b) => ({
          sum: a.sum + b.sum,
          count: a.count + b.count,
          min: Math.min(a.min, b.min),
          max: Math.max(a.max, b.max),
        }),
      }

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .aggregate(statsAggregator)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        sum: 50,
        count: 4,
        min: 5,
        max: 20,
        avg: 12.5,
      })
    })

    it('should support merging accumulators for parallel processing', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 2000, pageId: 'b', value: 20 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const mergeCalled = vi.fn()

      const aggregator: AggregateFunction<
        ClickEvent,
        { sum: number },
        number
      > = {
        createAccumulator: () => ({ sum: 0 }),
        add: (value, acc) => ({ sum: acc.sum + (value.value ?? 0) }),
        getResult: (acc) => acc.sum,
        merge: (a, b) => {
          mergeCalled()
          return { sum: a.sum + b.sum }
        },
      }

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .aggregate(aggregator)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]).toBe(30)
      // Note: merge may or may not be called depending on parallelism
    })
  })

  // ==========================================================================
  // 8. Watermarks and late event handling
  // ==========================================================================

  describe('Watermarks and late event handling', () => {
    it('should process events in order with monotonous timestamps', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 2000, pageId: 'b', value: 20 },
          { userId: 'u1', timestamp: 3000, pageId: 'c', value: 30 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(60)
    })

    it('should handle bounded out-of-orderness with watermarks', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 3000, pageId: 'c', value: 30 },
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 }, // Out of order
          { userId: 'u1', timestamp: 2000, pageId: 'b', value: 20 }  // Out of order
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forBoundedOutOfOrderness<ClickEvent>(
            Time.seconds(2)
          ).withTimestampAssigner((e) => e.timestamp)
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // All events should be included due to allowed out-of-orderness
      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(60)
    })

    it('should use custom watermark generator', async () => {
      const env = createTestEnvironment()
      const watermarkTimestamps: number[] = []

      const customGenerator: WatermarkGenerator<ClickEvent> = {
        onEvent: (event, eventTimestamp, output) => {
          // Emit watermark on every event for testing
          const watermark = new Watermark(eventTimestamp - 1000)
          output.emitWatermark(watermark)
          watermarkTimestamps.push(watermark.getTimestamp())
        },
        onPeriodicEmit: () => {},
      }

      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 3000, pageId: 'b', value: 20 },
          { userId: 'u1', timestamp: 5000, pageId: 'c', value: 30 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forGenerator<ClickEvent>(() => customGenerator).withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      await env.executeAndCollect(windowed)

      // Watermarks should have been emitted
      expect(watermarkTimestamps.length).toBeGreaterThanOrEqual(3)
    })

    it('should handle idle sources with withIdleness', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements({ userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 })
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>()
            .withTimestampAssigner((e) => e.timestamp)
            .withIdleness(Time.minutes(1))
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => a)

      const result = await env.executeAndCollect(windowed)

      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // 9. Allowed lateness configuration
  // ==========================================================================

  describe('Allowed lateness configuration', () => {
    it('should include late events within allowed lateness window', async () => {
      const env = createTestEnvironment()

      // Simulate events arriving with watermarks that advance past window end
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 2000, pageId: 'b', value: 20 },
          // This event would normally close window [0, 5000)
          { userId: 'u1', timestamp: 6000, pageId: 'c', value: 30 },
          // Late event for window [0, 5000), but within allowed lateness
          { userId: 'u1', timestamp: 3000, pageId: 'late', value: 100 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .allowedLateness(Time.seconds(5))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // The late event should be included due to allowed lateness
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should drop late events beyond allowed lateness', async () => {
      const env = createTestEnvironment()
      const lateTag = new OutputTag<ClickEvent>('late-events')

      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          // Advance watermark significantly
          { userId: 'u1', timestamp: 20000, pageId: 'b', value: 20 },
          // Very late event - beyond allowed lateness
          { userId: 'u1', timestamp: 2000, pageId: 'very-late', value: 1000 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .allowedLateness(Time.seconds(2))
        .sideOutputLateData(lateTag)
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Very late event should NOT be included in main results
      const totalValue = result.reduce((sum, r) => sum + (r.value ?? 0), 0)
      expect(totalValue).not.toBe(1030) // Should not include the 1000 from very late event
    })

    it('should emit late data to side output', async () => {
      const env = createTestEnvironment()
      const lateTag = new OutputTag<ClickEvent>('late-events')

      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 15000, pageId: 'b', value: 20 },
          // Late event
          { userId: 'u1', timestamp: 2000, pageId: 'late', value: 100 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .allowedLateness(Time.seconds(0))
        .sideOutputLateData(lateTag)
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      // Side output should contain late events
      expect(windowed).toBeInstanceOf(DataStream)
      // Late events should be accessible via getSideOutput
    })

    it('should fire window updates for late data within lateness', async () => {
      const env = createTestEnvironment()
      const windowFires: number[] = []

      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 4000, pageId: 'b', value: 20 },
          // Watermark advances past window
          { userId: 'u1', timestamp: 6000, pageId: 'c', value: 30 },
          // Late but allowed
          { userId: 'u1', timestamp: 3000, pageId: 'late', value: 100 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowFunction: WindowFunction<ClickEvent, number, string> = {
        apply: (key, window, elements, out) => {
          let sum = 0
          for (const e of elements) {
            sum += e.value ?? 0
          }
          windowFires.push(sum)
          out.collect(sum)
        },
      }

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .allowedLateness(Time.seconds(10))
        .apply(windowFunction)

      const result = await env.executeAndCollect(windowed)

      // Window should fire at least once for initial data
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================================================
  // Additional Edge Cases and Advanced Scenarios
  // ==========================================================================

  describe('Edge cases and advanced scenarios', () => {
    it('should handle empty stream gracefully', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements<ClickEvent>()

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => a)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(0)
    })

    it('should handle single element window', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements({ userId: 'u1', timestamp: 1000, pageId: 'solo', value: 42 })
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => a)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(42)
    })

    it('should handle events exactly on window boundary', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 0, pageId: 'boundary', value: 10 },
          { userId: 'u1', timestamp: 5000, pageId: 'boundary', value: 20 }, // Exactly on boundary
          { userId: 'u1', timestamp: 10000, pageId: 'boundary', value: 30 } // Exactly on boundary
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Each event should be in its own window since boundaries are [start, end)
      expect(result).toHaveLength(3)
    })

    it('should process windows with evictor', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', timestamp: 1000, pageId: 'a', value: 1 },
        { userId: 'u1', timestamp: 2000, pageId: 'b', value: 2 },
        { userId: 'u1', timestamp: 3000, pageId: 'c', value: 3 },
        { userId: 'u1', timestamp: 4000, pageId: 'd', value: 4 },
        { userId: 'u1', timestamp: 5000, pageId: 'e', value: 5 }
      )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(GlobalWindows.create())
        .trigger(CountTrigger.of(5))
        .evictor(CountEvictor.of(2)) // Keep only last 2 elements
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Should only sum last 2 elements: 4 + 5 = 9
      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(9)
    })

    it('should handle multiple keys with different window contents', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u2', timestamp: 1500, pageId: 'b', value: 100 },
          { userId: 'u3', timestamp: 2000, pageId: 'c', value: 1000 },
          { userId: 'u1', timestamp: 3000, pageId: 'd', value: 20 },
          { userId: 'u2', timestamp: 3500, pageId: 'e', value: 200 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(3)
      expect(result).toContainEqual(expect.objectContaining({ userId: 'u1', value: 30 }))
      expect(result).toContainEqual(expect.objectContaining({ userId: 'u2', value: 300 }))
      expect(result).toContainEqual(expect.objectContaining({ userId: 'u3', value: 1000 }))
    })

    it('should use ProcessWindowFunction with context access', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 2000, pageId: 'b', value: 20 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const processFunction: ProcessWindowFunction<ClickEvent, WindowResult, string> = {
        process: (key, context, elements, out) => {
          const window = context.window()
          const processingTime = context.currentProcessingTime()
          const watermark = context.currentWatermark()

          let sum = 0
          let count = 0
          for (const e of elements) {
            sum += e.value ?? 0
            count++
          }

          out.collect({
            key,
            sum,
            count,
            windowStart: window.getStart(),
            windowEnd: window.getEnd(),
          })
        },
      }

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .process(processFunction)

      const result = await env.executeAndCollect(windowed)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        key: 'u1',
        sum: 30,
        count: 2,
        windowStart: 0,
        windowEnd: 5000,
      })
    })

    it('should combine evictor with time-based window', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 8000, pageId: 'b', value: 20 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(10)))
        .evictor(TimeEvictor.of(Time.seconds(5))) // Evict elements > 5s old relative to window end
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Element at 1000 should be evicted (older than 5s from window end at 10000)
      // Only element at 8000 should remain
      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(20)
    })
  })
})
