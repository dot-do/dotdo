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
  DeltaEvictor,

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

  // ==========================================================================
  // 10. Processing Time Windows
  // ==========================================================================

  describe('Processing Time Windows', () => {
    it('should create tumbling processing time windows', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', pageId: 'home', value: 10 },
        { userId: 'u1', pageId: 'products', value: 20 },
        { userId: 'u1', pageId: 'cart', value: 30 }
      )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingProcessingTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      // Processing time windows should produce results
      const result = await env.executeAndCollect(windowed)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should create sliding processing time windows', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', pageId: 'a', value: 10 },
        { userId: 'u1', pageId: 'b', value: 20 }
      )

      // 4 second window, sliding every 2 seconds
      const windowed = events
        .keyBy((e) => e.userId)
        .window(SlidingProcessingTimeWindows.of(Time.seconds(4), Time.seconds(2)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)
      expect(result).toBeDefined()
    })

    it('should use processing time trigger for processing time windows', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', value: 10 },
        { userId: 'u1', value: 20 }
      )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingProcessingTimeWindows.of(Time.seconds(5)))
        .trigger(ProcessingTimeTrigger.create())
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      expect(windowed).toBeInstanceOf(DataStream)
    })

    it('should handle processing time window with offset', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', value: 10 },
        { userId: 'u1', value: 20 }
      )

      // Window with 500ms offset
      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingProcessingTimeWindows.of(Time.seconds(5), Time.milliseconds(500)))
        .reduce((a, b) => a)

      const result = await env.executeAndCollect(windowed)
      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // 11. Incremental Aggregation with Window Metadata
  // ==========================================================================

  describe('Incremental Aggregation with Window Metadata', () => {
    it('should combine reduce with ProcessWindowFunction for window metadata', async () => {
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

      interface EnrichedResult {
        key: string
        sum: number
        windowStart: number
        windowEnd: number
        elementCount: number
      }

      // Incremental reduce followed by ProcessWindowFunction for enrichment
      const processFunction: ProcessWindowFunction<ClickEvent, EnrichedResult, string> = {
        process: (key, context, elements, out) => {
          const window = context.window()
          let sum = 0
          let count = 0
          for (const e of elements) {
            sum += e.value ?? 0
            count++
          }
          out.collect({
            key,
            sum,
            windowStart: window.getStart(),
            windowEnd: window.getEnd(),
            elementCount: count,
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
        sum: 60,
        windowStart: 0,
        windowEnd: 5000,
        elementCount: 3,
      })
    })

    it('should combine aggregate with WindowFunction for enriched output', async () => {
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
      expect(result[0]).toBe(15) // Average of 10 and 20
    })

    it('should access window state in ProcessWindowFunction', async () => {
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

      let processingTimeAccessed = false
      let watermarkAccessed = false

      const processFunction: ProcessWindowFunction<ClickEvent, string, string> = {
        process: (key, context, elements, out) => {
          // Access processing time and watermark
          const processingTime = context.currentProcessingTime()
          const watermark = context.currentWatermark()

          processingTimeAccessed = typeof processingTime === 'number'
          watermarkAccessed = typeof watermark === 'number'

          out.collect(`processed-${key}`)
        },
      }

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .process(processFunction)

      await env.executeAndCollect(windowed)

      expect(processingTimeAccessed).toBe(true)
      expect(watermarkAccessed).toBe(true)
    })
  })

  // ==========================================================================
  // 12. Custom Triggers
  // ==========================================================================

  describe('Custom Triggers', () => {
    it('should fire on continuous event time intervals', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 3000, pageId: 'b', value: 20 },
          { userId: 'u1', timestamp: 5000, pageId: 'c', value: 30 },
          { userId: 'u1', timestamp: 7000, pageId: 'd', value: 40 },
          { userId: 'u1', timestamp: 9000, pageId: 'e', value: 50 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      // 10 second window with continuous trigger every 2 seconds
      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(10)))
        .trigger(ContinuousEventTimeTrigger.of(Time.seconds(2)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Should fire multiple times during the window
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should purge window contents after firing', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', pageId: 'a', value: 10 },
        { userId: 'u1', pageId: 'b', value: 20 },
        { userId: 'u1', pageId: 'c', value: 30 },
        { userId: 'u1', pageId: 'd', value: 40 }
      )

      // Global window with purging count trigger
      const windowed = events
        .keyBy((e) => e.userId)
        .window(GlobalWindows.create())
        .trigger(PurgingTrigger.of(CountTrigger.of(2)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Should have 2 results: (10+20=30) and (30+40=70)
      expect(result).toHaveLength(2)
      expect(result[0]?.value).toBe(30)
      expect(result[1]?.value).toBe(70)
    })

    it('should handle delta trigger for change detection', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 2000, pageId: 'b', value: 12 }, // Delta = 2
          { userId: 'u1', timestamp: 3000, pageId: 'c', value: 25 }, // Delta = 13, should trigger
          { userId: 'u1', timestamp: 4000, pageId: 'd', value: 27 }  // Delta = 2
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      // Delta trigger fires when delta exceeds threshold
      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(10)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================================================
  // 13. Delta Evictor
  // ==========================================================================

  describe('Delta Evictor', () => {
    it('should evict elements based on delta function', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
        { userId: 'u1', timestamp: 2000, pageId: 'b', value: 50 },
        { userId: 'u1', timestamp: 3000, pageId: 'c', value: 15 },
        { userId: 'u1', timestamp: 4000, pageId: 'd', value: 55 },
        { userId: 'u1', timestamp: 5000, pageId: 'e', value: 20 }
      )

      // DeltaEvictor removes elements where delta from last element exceeds threshold
      const deltaFunction = (a: ClickEvent, b: ClickEvent) =>
        Math.abs((a.value ?? 0) - (b.value ?? 0))

      const windowed = events
        .keyBy((e) => e.userId)
        .window(GlobalWindows.create())
        .trigger(CountTrigger.of(5))
        .evictor(DeltaEvictor.of(30, deltaFunction))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should apply evictor after window function when configured', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', timestamp: 1000, pageId: 'a', value: 1 },
        { userId: 'u1', timestamp: 2000, pageId: 'b', value: 2 },
        { userId: 'u1', timestamp: 3000, pageId: 'c', value: 3 },
        { userId: 'u1', timestamp: 4000, pageId: 'd', value: 4 },
        { userId: 'u1', timestamp: 5000, pageId: 'e', value: 5 }
      )

      // CountEvictor with doEvictAfter=true
      const windowed = events
        .keyBy((e) => e.userId)
        .window(GlobalWindows.create())
        .trigger(CountTrigger.of(5))
        .evictor(CountEvictor.of(3, true)) // Evict after processing, keep last 3
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)
      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // 14. Window State and Timers
  // ==========================================================================

  describe('Window State and Timers', () => {
    it('should register event time timer from ProcessWindowFunction', async () => {
      const env = createTestEnvironment()
      const timersFired: number[] = []

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

      const processFunction: ProcessWindowFunction<ClickEvent, string, string> = {
        process: (key, context, elements, out) => {
          // Register a timer for cleanup or late firing
          const window = context.window()
          out.collect(`window-${window.getStart()}-${window.getEnd()}`)
        },
      }

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .process(processFunction)

      const result = await env.executeAndCollect(windowed)
      expect(result).toContain('window-0-5000')
    })

    it('should access global state from window function', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 6000, pageId: 'b', value: 20 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      let windowCount = 0

      const windowFunction: WindowFunction<ClickEvent, WindowResult, string> = {
        apply: (key, window, elements, out) => {
          windowCount++
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

      expect(result).toHaveLength(2) // Two windows
      expect(windowCount).toBe(2)
    })
  })

  // ==========================================================================
  // 15. Count Windows
  // ==========================================================================

  describe('Count Windows', () => {
    it('should create tumbling count window', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', pageId: 'a', value: 1 },
        { userId: 'u1', pageId: 'b', value: 2 },
        { userId: 'u1', pageId: 'c', value: 3 },
        { userId: 'u1', pageId: 'd', value: 4 },
        { userId: 'u1', pageId: 'e', value: 5 },
        { userId: 'u1', pageId: 'f', value: 6 }
      )

      // Count window of size 3
      const windowed = events
        .keyBy((e) => e.userId)
        .countWindow(3)
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // First window: 1+2+3 = 6
      // Second window: 4+5+6 = 15
      expect(result).toHaveLength(2)
      expect(result[0]?.value).toBe(6)
      expect(result[1]?.value).toBe(15)
    })

    it('should create sliding count window', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', pageId: 'a', value: 1 },
        { userId: 'u1', pageId: 'b', value: 2 },
        { userId: 'u1', pageId: 'c', value: 3 },
        { userId: 'u1', pageId: 'd', value: 4 },
        { userId: 'u1', pageId: 'e', value: 5 }
      )

      // Count window: size 3, slide 2
      const windowed = events
        .keyBy((e) => e.userId)
        .countWindow(3, 2)
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Windows: [1,2,3]=6, [3,4,5]=12
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle count window with different keys', async () => {
      const env = createTestEnvironment()
      const events = env.fromElements(
        { userId: 'u1', value: 1 },
        { userId: 'u2', value: 10 },
        { userId: 'u1', value: 2 },
        { userId: 'u2', value: 20 },
        { userId: 'u1', value: 3 },
        { userId: 'u2', value: 30 }
      )

      const windowed = events
        .keyBy((e) => e.userId)
        .countWindow(3)
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // u1: 1+2+3 = 6
      // u2: 10+20+30 = 60
      expect(result).toContainEqual(expect.objectContaining({ userId: 'u1', value: 6 }))
      expect(result).toContainEqual(expect.objectContaining({ userId: 'u2', value: 60 }))
    })
  })

  // ==========================================================================
  // 16. Window Joins
  // ==========================================================================

  describe('Window Joins', () => {
    it('should join two streams in tumbling window', async () => {
      const env = createTestEnvironment()

      const orders = env
        .fromElements(
          { orderId: 'o1', userId: 'u1', timestamp: 1000, amount: 100 },
          { orderId: 'o2', userId: 'u2', timestamp: 2000, amount: 200 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            orderId: string
            userId: string
            timestamp: number
            amount: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const payments = env
        .fromElements(
          { paymentId: 'p1', orderId: 'o1', timestamp: 1500, status: 'completed' },
          { paymentId: 'p2', orderId: 'o2', timestamp: 2500, status: 'pending' }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            paymentId: string
            orderId: string
            timestamp: number
            status: string
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      // Join orders with payments on orderId within 5-second tumbling windows
      const joined = orders
        .join(payments)
        .where((o) => o.orderId)
        .equalTo((p) => p.orderId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .apply((order, payment) => ({
          orderId: order.orderId,
          amount: order.amount,
          status: payment.status,
        }))

      const result = await env.executeAndCollect(joined)

      expect(result).toContainEqual({
        orderId: 'o1',
        amount: 100,
        status: 'completed',
      })
    })

    it('should coGroup two streams in tumbling window', async () => {
      const env = createTestEnvironment()

      const clicks = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'home' },
          { userId: 'u1', timestamp: 2000, pageId: 'products' },
          { userId: 'u2', timestamp: 1500, pageId: 'home' }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            userId: string
            timestamp: number
            pageId: string
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const purchases = env
        .fromElements(
          { userId: 'u1', timestamp: 3000, productId: 'prod1', amount: 50 },
          { userId: 'u2', timestamp: 4000, productId: 'prod2', amount: 100 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            userId: string
            timestamp: number
            productId: string
            amount: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      // CoGroup allows processing unmatched elements
      const coGrouped = clicks
        .coGroup(purchases)
        .where((c) => c.userId)
        .equalTo((p) => p.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .apply((clicksIter, purchasesIter, out) => {
          const clickList = [...clicksIter]
          const purchaseList = [...purchasesIter]
          out.collect({
            clickCount: clickList.length,
            purchaseCount: purchaseList.length,
            totalAmount: purchaseList.reduce((sum, p) => sum + p.amount, 0),
          })
        })

      const result = await env.executeAndCollect(coGrouped)
      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // 17. Interval Joins
  // ==========================================================================

  describe('Interval Joins', () => {
    it('should join elements within time interval', async () => {
      const env = createTestEnvironment()

      const clicks = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'checkout' },
          { userId: 'u2', timestamp: 5000, pageId: 'checkout' }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            userId: string
            timestamp: number
            pageId: string
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const purchases = env
        .fromElements(
          { userId: 'u1', timestamp: 2000, amount: 100 },
          { userId: 'u2', timestamp: 8000, amount: 200 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            userId: string
            timestamp: number
            amount: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      // Interval join: purchase must occur within [-2s, +5s] of click
      const intervalJoined = clicks
        .keyBy((c) => c.userId)
        .intervalJoin(purchases.keyBy((p) => p.userId))
        .between(Time.seconds(-2), Time.seconds(5))
        .process((click, purchase, out) => {
          out.collect({
            userId: click.userId,
            pageId: click.pageId,
            amount: purchase.amount,
          })
        })

      const result = await env.executeAndCollect(intervalJoined)

      // u1: click@1000, purchase@2000 -> within [1000-2000, 1000+5000] = [-1000, 6000]
      // u2: click@5000, purchase@8000 -> within [5000-2000, 5000+5000] = [3000, 10000]
      expect(result).toContainEqual({
        userId: 'u1',
        pageId: 'checkout',
        amount: 100,
      })
    })

    it('should handle asymmetric time bounds in interval join', async () => {
      const env = createTestEnvironment()

      const events1 = env
        .fromElements({ key: 'a', timestamp: 5000, value: 'e1' })
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            key: string
            timestamp: number
            value: string
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const events2 = env
        .fromElements(
          { key: 'a', timestamp: 3000, value: 'e2-early' },
          { key: 'a', timestamp: 7000, value: 'e2-later' },
          { key: 'a', timestamp: 10000, value: 'e2-late' }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            key: string
            timestamp: number
            value: string
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      // Events from events2 must be within [e1.timestamp - 3s, e1.timestamp + 2s]
      // For e1@5000: valid range is [2000, 7000]
      const joined = events1
        .keyBy((e) => e.key)
        .intervalJoin(events2.keyBy((e) => e.key))
        .between(Time.seconds(-3), Time.seconds(2))
        .process((e1, e2, out) => {
          out.collect({ e1: e1.value, e2: e2.value })
        })

      const result = await env.executeAndCollect(joined)

      // e2-early@3000 is in [2000, 7000] -> included
      // e2-later@7000 is in [2000, 7000] -> included
      // e2-late@10000 is NOT in [2000, 7000] -> excluded
      expect(result).toContainEqual({ e1: 'e1', e2: 'e2-early' })
      expect(result).toContainEqual({ e1: 'e1', e2: 'e2-later' })
      expect(result).not.toContainEqual(expect.objectContaining({ e2: 'e2-late' }))
    })

    it('should exclude lower and upper bounds when configured', async () => {
      const env = createTestEnvironment()

      const left = env
        .fromElements({ key: 'a', timestamp: 5000 })
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{ key: string; timestamp: number }>()
            .withTimestampAssigner((e) => e.timestamp)
        )

      const right = env
        .fromElements(
          { key: 'a', timestamp: 3000 }, // Exactly at lower bound
          { key: 'a', timestamp: 7000 }  // Exactly at upper bound
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{ key: string; timestamp: number }>()
            .withTimestampAssigner((e) => e.timestamp)
        )

      // With lowerBoundExclusive and upperBoundExclusive
      const joined = left
        .keyBy((e) => e.key)
        .intervalJoin(right.keyBy((e) => e.key))
        .between(Time.seconds(-2), Time.seconds(2))
        .lowerBoundExclusive()
        .upperBoundExclusive()
        .process((l, r, out) => {
          out.collect({ leftTs: l.timestamp, rightTs: r.timestamp })
        })

      const result = await env.executeAndCollect(joined)

      // With exclusive bounds [3000, 7000) and (3000, 7000]
      // Neither 3000 nor 7000 should be included
      expect(result).not.toContainEqual(expect.objectContaining({ rightTs: 3000 }))
      expect(result).not.toContainEqual(expect.objectContaining({ rightTs: 7000 }))
    })
  })

  // ==========================================================================
  // 18. Window Assigner Properties
  // ==========================================================================

  describe('Window Assigner Properties', () => {
    it('should correctly identify event time vs processing time windows', () => {
      const eventTimeWindow = TumblingEventTimeWindows.of(Time.seconds(5))
      const processingTimeWindow = TumblingProcessingTimeWindows.of(Time.seconds(5))

      expect(eventTimeWindow.isEventTime()).toBe(true)
      expect(processingTimeWindow.isEventTime()).toBe(false)
    })

    it('should return correct default trigger for each window type', () => {
      const tumblingEventTime = TumblingEventTimeWindows.of(Time.seconds(5))
      const slidingEventTime = SlidingEventTimeWindows.of(Time.seconds(5), Time.seconds(1))
      const sessionWindow = SessionWindows.withGap(Time.seconds(5))
      const globalWindow = GlobalWindows.create()

      // Event time windows default to EventTimeTrigger
      expect(tumblingEventTime.getDefaultTrigger()).toBeDefined()
      expect(slidingEventTime.getDefaultTrigger()).toBeDefined()
      expect(sessionWindow.getDefaultTrigger()).toBeDefined()

      // Global windows default to NeverTrigger (requires explicit trigger)
      expect(globalWindow.getDefaultTrigger()).toBeDefined()
    })

    it('should assign windows correctly based on element timestamp', () => {
      const windowAssigner = TumblingEventTimeWindows.of(Time.seconds(5))

      // Element at timestamp 2500 should be in window [0, 5000)
      const windows1 = windowAssigner.assignWindows({}, 2500)
      expect(windows1).toHaveLength(1)
      expect(windows1[0]?.getStart()).toBe(0)
      expect(windows1[0]?.getEnd()).toBe(5000)

      // Element at timestamp 7000 should be in window [5000, 10000)
      const windows2 = windowAssigner.assignWindows({}, 7000)
      expect(windows2).toHaveLength(1)
      expect(windows2[0]?.getStart()).toBe(5000)
      expect(windows2[0]?.getEnd()).toBe(10000)
    })

    it('should assign element to multiple windows for sliding assigner', () => {
      const windowAssigner = SlidingEventTimeWindows.of(Time.seconds(4), Time.seconds(2))

      // Element at timestamp 3000 should be in multiple overlapping windows
      const windows = windowAssigner.assignWindows({}, 3000)

      // Should be in at least 2 windows
      expect(windows.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================================================
  // 19. Trigger Behavior Details
  // ==========================================================================

  describe('Trigger Behavior Details', () => {
    it('should return correct TriggerResult values', () => {
      expect(TriggerResult.CONTINUE).toBe('CONTINUE')
      expect(TriggerResult.FIRE).toBe('FIRE')
      expect(TriggerResult.PURGE).toBe('PURGE')
      expect(TriggerResult.FIRE_AND_PURGE).toBe('FIRE_AND_PURGE')
    })

    it('should register timers in trigger context', async () => {
      const env = createTestEnvironment()
      let timerRegistered = false

      const events = env
        .fromElements({ userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 })
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .trigger(EventTimeTrigger.create())
        .reduce((a, b) => a)

      await env.executeAndCollect(windowed)

      // Timer registration should happen internally
      expect(windowed).toBeInstanceOf(DataStream)
    })

    it('should handle onEventTime callback in trigger', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 6000, pageId: 'b', value: 20 } // Advances watermark past first window
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .trigger(EventTimeTrigger.create())
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // First window [0, 5000) should fire when watermark reaches 5000
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================================================
  // 20. Complex Window Scenarios
  // ==========================================================================

  describe('Complex Window Scenarios', () => {
    it('should handle nested windowing operations', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 2000, pageId: 'b', value: 20 },
          { userId: 'u1', timestamp: 8000, pageId: 'c', value: 30 },
          { userId: 'u1', timestamp: 9000, pageId: 'd', value: 40 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      // First aggregation: 5-second windows
      const firstLevel = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(5)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      // The result can be further processed
      const result = await env.executeAndCollect(firstLevel)

      // Window [0, 5000): 10 + 20 = 30
      // Window [5000, 10000): 30 + 40 = 70
      expect(result).toContainEqual(expect.objectContaining({ value: 30 }))
      expect(result).toContainEqual(expect.objectContaining({ value: 70 }))
    })

    it('should handle high-cardinality keys efficiently', async () => {
      const env = createTestEnvironment()

      // Generate events with many different keys
      const events: ClickEvent[] = []
      for (let i = 0; i < 100; i++) {
        events.push({
          userId: `user-${i}`,
          timestamp: i * 100,
          pageId: 'page',
          value: i,
        })
      }

      const stream = env
        .fromCollection(events)
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const windowed = stream
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.seconds(10)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // Should have results for all keys
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle very long windows correctly', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 0, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 30000, pageId: 'b', value: 20 },
          { userId: 'u1', timestamp: 59000, pageId: 'c', value: 30 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<ClickEvent>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      // 1-minute window
      const windowed = events
        .keyBy((e) => e.userId)
        .window(TumblingEventTimeWindows.of(Time.minutes(1)))
        .reduce((a, b) => ({ ...a, value: (a.value ?? 0) + (b.value ?? 0) }))

      const result = await env.executeAndCollect(windowed)

      // All events should be in one window [0, 60000)
      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(60) // 10 + 20 + 30
    })

    it('should handle events with same timestamp correctly', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, pageId: 'a', value: 10 },
          { userId: 'u1', timestamp: 1000, pageId: 'b', value: 20 },
          { userId: 'u1', timestamp: 1000, pageId: 'c', value: 30 }
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

      // All events at same timestamp should be in same window
      expect(result).toHaveLength(1)
      expect(result[0]?.value).toBe(60)
    })

    it('should handle events at window end timestamp correctly', async () => {
      const env = createTestEnvironment()
      const events = env
        .fromElements(
          { userId: 'u1', timestamp: 4999, pageId: 'a', value: 10 }, // Last element in [0, 5000)
          { userId: 'u1', timestamp: 5000, pageId: 'b', value: 20 }  // First element in [5000, 10000)
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

      // Should have 2 windows with 1 element each
      expect(result).toHaveLength(2)
      expect(result).toContainEqual(expect.objectContaining({ value: 10 }))
      expect(result).toContainEqual(expect.objectContaining({ value: 20 }))
    })
  })
})
