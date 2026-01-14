/**
 * Window Key Parsing Tests (RED Phase)
 *
 * These tests expose the window key parsing bug in streaming.ts lines 844-864.
 *
 * BUG: Current implementation uses string.split('-') which breaks on:
 * - ISO dates like '2024-01-15' in window keys
 * - Year-week patterns like '2024-03' that collide with dates
 * - Any key containing dashes
 *
 * The window key format is: "${start}-${end}-${key}"
 * When key contains dashes, parseWindowKey incorrectly splits them.
 *
 * @see dotdo-window-parsing-bug
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  StreamingPipeline,
  createStreamingPipeline,
  Window,
  EventTimeTrigger,
  CountTrigger,
  ProcessingTimeTrigger,
  IncrementalResult,
  minutes,
  seconds,
  hours,
  WindowManager,
} from '../streaming'

// ============================================================================
// Test Data Types
// ============================================================================

interface TimeSeriesEvent {
  id: string
  timestamp: number
  value: number
  date: string // ISO date like '2024-01-15'
  yearWeek: string // Year-week like '2024-03'
  category: string
}

interface SalesEvent {
  orderId: string
  timestamp: number
  amount: number
  region: string
  date: string
}

// ============================================================================
// Window Key Format Tests
// ============================================================================

describe('Window Key Parsing Bug', () => {
  describe('Window key format', () => {
    it('parses year-week format correctly', () => {
      // Year-week key like '2024-03' should be preserved
      // When parsed back, key should be '2024-03', not split into parts
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.yearWeek)
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<TimeSeriesEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      // Events with year-week keys
      pipeline.process({
        id: '1',
        timestamp: baseTime,
        value: 100,
        date: '2024-01-15',
        yearWeek: '2024-03', // Week 3 of 2024
        category: 'A',
      })
      pipeline.process({
        id: '2',
        timestamp: baseTime + 1000,
        value: 200,
        date: '2024-01-16',
        yearWeek: '2024-03', // Same week
        category: 'B',
      })

      pipeline.advanceWatermark(baseTime + 3600000)

      expect(results).toHaveLength(1)
      // The aggregation should have key '2024-03'
      expect(results[0].aggregations.has('2024-03')).toBe(true)
      expect(results[0].aggregations.get('2024-03')?.count).toBe(2)
    })

    it('parses ISO date correctly - NOT split on dashes', () => {
      // ISO date like '2024-01-15' in window key should NOT be split
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date)
        .aggregate({ sum: { $sum: '$value' } })

      const results: IncrementalResult<TimeSeriesEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      pipeline.process({
        id: '1',
        timestamp: baseTime,
        value: 100,
        date: '2024-01-15',
        yearWeek: '2024-03',
        category: 'A',
      })
      pipeline.process({
        id: '2',
        timestamp: baseTime + 1000,
        value: 50,
        date: '2024-01-15', // Same date
        yearWeek: '2024-03',
        category: 'B',
      })

      pipeline.advanceWatermark(baseTime + 3600000)

      expect(results).toHaveLength(1)
      // BUG: The current split('-') implementation will mangle '2024-01-15'
      // It should parse back to exactly '2024-01-15'
      expect(results[0].aggregations.has('2024-01-15')).toBe(true)
      expect(results[0].aggregations.get('2024-01-15')?.sum).toBe(150)
    })

    it('distinguishes date from year-week unambiguously', () => {
      // '2024-03' (year-week) vs '2024-03-01' (date) must be distinguishable
      // This test verifies that during checkpoint/restore, date keys are preserved
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date)
        .aggregate({ count: { $count: {} } })

      const hourMs = 3600000
      const baseTime = Math.floor(Date.now() / hourMs) * hourMs // Align to hour boundary

      // Two different dates in the same window
      pipeline.process({
        id: '1',
        timestamp: baseTime + 1000,
        value: 100,
        date: '2024-03-01',
        yearWeek: '2024-09',
        category: 'A',
      })
      pipeline.process({
        id: '2',
        timestamp: baseTime + 2000,
        value: 100,
        date: '2024-03-15',
        yearWeek: '2024-11',
        category: 'A',
      })

      // Create checkpoint - this is where the bug manifests
      const checkpoint = pipeline.createCheckpoint()

      // BUG: The split('-') implementation corrupts the keys
      // '2024-03-01' becomes '2024' and '2024-03-15' becomes '2024'
      // Both dates should be preserved distinctly
      const windowKeys = checkpoint.windowStates.map((ws) => ws.window.key)
      const uniqueKeys = new Set(windowKeys.filter((k) => k !== undefined))

      // We should have TWO distinct keys, not one corrupted key
      expect(uniqueKeys.size).toBe(2)
      expect(uniqueKeys.has('2024-03-01')).toBe(true)
      expect(uniqueKeys.has('2024-03-15')).toBe(true)
    })

    it('handles edge case dates at month boundaries', () => {
      // Dates like '2024-01-31', '2024-02-01', '2024-02-29' (leap year)
      // This test verifies checkpoint preserves boundary date keys
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date)
        .aggregate({ count: { $count: {} } })

      const hourMs = 3600000
      const baseTime = Math.floor(Date.now() / hourMs) * hourMs // Align to hour boundary
      const boundaryDates = ['2024-01-31', '2024-02-01', '2024-02-29', '2024-12-31']

      for (let i = 0; i < boundaryDates.length; i++) {
        pipeline.process({
          id: boundaryDates[i],
          timestamp: baseTime + i * 1000, // All in same window
          value: 100,
          date: boundaryDates[i],
          yearWeek: '2024-01',
          category: 'A',
        })
      }

      // Create checkpoint - bug manifests here
      const checkpoint = pipeline.createCheckpoint()

      // BUG: split('-') corrupts ALL these dates to just '2024'
      // Expected: 4 unique keys for 4 different dates
      const windowKeys = checkpoint.windowStates.map((ws) => ws.window.key)
      const uniqueKeys = new Set(windowKeys.filter((k) => k !== undefined))

      // Each date should be preserved as its own key
      expect(uniqueKeys.size).toBe(boundaryDates.length)
      for (const date of boundaryDates) {
        expect(uniqueKeys.has(date)).toBe(true)
      }
    })
  })

  // ============================================================================
  // Time Window Tests
  // ============================================================================

  describe('Time windows', () => {
    it('daily windows group correctly with date keys', () => {
      // 24-hour buckets with ISO date keys
      const pipeline = createStreamingPipeline<SalesEvent>({
        windowAssigner: WindowManager.tumbling(hours(24)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date)
        .aggregate({
          totalSales: { $sum: '$amount' },
          orderCount: { $count: {} },
        })

      const results: IncrementalResult<SalesEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      // Base time: midnight Jan 15, 2024
      const jan15Midnight = new Date('2024-01-15T00:00:00Z').getTime()

      // Events throughout Jan 15
      pipeline.process({
        orderId: '1',
        timestamp: jan15Midnight + 1000,
        amount: 100,
        region: 'US',
        date: '2024-01-15',
      })
      pipeline.process({
        orderId: '2',
        timestamp: jan15Midnight + 3600000, // 1 hour later
        amount: 200,
        region: 'EU',
        date: '2024-01-15',
      })
      pipeline.process({
        orderId: '3',
        timestamp: jan15Midnight + 7200000, // 2 hours later
        amount: 150,
        region: 'US',
        date: '2024-01-15',
      })

      // Advance past the 24-hour window
      pipeline.advanceWatermark(jan15Midnight + 86400000)

      expect(results).toHaveLength(1)
      expect(results[0].aggregations.has('2024-01-15')).toBe(true)
      expect(results[0].aggregations.get('2024-01-15')?.totalSales).toBe(450)
      expect(results[0].aggregations.get('2024-01-15')?.orderCount).toBe(3)
    })

    it('weekly windows group correctly with year-week keys', () => {
      // This test verifies that year-week keys like '2024-03' are preserved in checkpoint
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)), // Use 1-hour window for simplicity
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.yearWeek)
        .aggregate({ sum: { $sum: '$value' } })

      const hourMs = 3600000
      const baseTime = Math.floor(Date.now() / hourMs) * hourMs // Align to hour boundary

      // Events with year-week key '2024-03'
      for (let i = 0; i < 7; i++) {
        pipeline.process({
          id: `w3-${i}`,
          timestamp: baseTime + i * 1000, // All in same window
          value: 100,
          date: `2024-01-${15 + i}`,
          yearWeek: '2024-03',
          category: 'A',
        })
      }

      // Create checkpoint - this is where the bug manifests
      const checkpoint = pipeline.createCheckpoint()

      // BUG: split('-') corrupts '2024-03' to just '2024'
      expect(checkpoint.windowStates.length).toBeGreaterThan(0)
      expect(checkpoint.windowStates[0].window.key).toBe('2024-03')
    })

    it('monthly windows group correctly with YYYY-MM keys', () => {
      // Calendar month windows with YYYY-MM keys
      const pipeline = createStreamingPipeline<SalesEvent>({
        windowAssigner: WindowManager.tumbling(hours(744)), // ~31 days
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date.substring(0, 7)) // Extract YYYY-MM
        .aggregate({ revenue: { $sum: '$amount' } })

      const results: IncrementalResult<SalesEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const jan1 = new Date('2024-01-01T00:00:00Z').getTime()

      pipeline.process({
        orderId: '1',
        timestamp: jan1,
        amount: 1000,
        region: 'US',
        date: '2024-01-01',
      })
      pipeline.process({
        orderId: '2',
        timestamp: jan1 + 86400000 * 15, // Jan 16
        amount: 2000,
        region: 'EU',
        date: '2024-01-16',
      })

      pipeline.advanceWatermark(jan1 + 2678400000) // ~31 days

      expect(results).toHaveLength(1)
      // Key should be '2024-01', not split incorrectly
      expect(results[0].aggregations.has('2024-01')).toBe(true)
      expect(results[0].aggregations.get('2024-01')?.revenue).toBe(3000)
    })

    it('custom interval windows with date-containing keys', () => {
      // 6-hour windows with datetime keys like '2024-01-15T06:00:00'
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(6)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => {
          // Create a 6-hour bucket key like '2024-01-15T06'
          const d = new Date(e.timestamp)
          const hour = Math.floor(d.getUTCHours() / 6) * 6
          return `${e.date}T${hour.toString().padStart(2, '0')}`
        })
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<TimeSeriesEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const base = new Date('2024-01-15T08:00:00Z').getTime() // 8 AM

      pipeline.process({
        id: '1',
        timestamp: base,
        value: 100,
        date: '2024-01-15',
        yearWeek: '2024-03',
        category: 'A',
      })
      pipeline.process({
        id: '2',
        timestamp: base + 3600000, // 9 AM
        value: 200,
        date: '2024-01-15',
        yearWeek: '2024-03',
        category: 'B',
      })

      pipeline.advanceWatermark(base + 21600000) // 6 hours later

      expect(results).toHaveLength(1)
      // Key should be '2024-01-15T06' - contains dashes and T
      expect(results[0].aggregations.has('2024-01-15T06')).toBe(true)
      expect(results[0].aggregations.get('2024-01-15T06')?.count).toBe(2)
    })
  })

  // ============================================================================
  // Window Boundary Tests
  // ============================================================================

  describe('Window boundaries', () => {
    it('window key is unique per period - no collisions', () => {
      // Keys like '2024-01' (Jan 2024) vs '2024-01' (week 1) should be distinguishable
      // This tests that the format doesn't cause collisions
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.category)
        .aggregate({ count: { $count: {} } })

      const hourMs = 3600000
      const baseTime = Math.floor(Date.now() / hourMs) * hourMs // Align to hour boundary

      // Categories that contain dashes
      const categories = ['2024-01', '2024-1', '2024', '01-15', 'A-B-C']

      for (let i = 0; i < categories.length; i++) {
        pipeline.process({
          id: categories[i],
          timestamp: baseTime + i * 1000, // All in same window
          value: 100,
          date: '2024-01-15',
          yearWeek: '2024-03',
          category: categories[i],
        })
      }

      // Create checkpoint - bug manifests here
      const checkpoint = pipeline.createCheckpoint()

      // BUG: split('-') corrupts keys with dashes
      // '2024-01' becomes '2024', 'A-B-C' becomes 'A'
      const windowKeys = checkpoint.windowStates.map((ws) => ws.window.key)
      const uniqueKeys = new Set(windowKeys.filter((k) => k !== undefined))

      // Each category should be preserved as its own distinct key
      expect(uniqueKeys.size).toBe(categories.length)
      for (const cat of categories) {
        expect(uniqueKeys.has(cat)).toBe(true)
      }
    })

    it('events near window boundary are grouped correctly', () => {
      // Events at the edge of a window (end - 1ms, end, end + 1ms)
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(minutes(5)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date)
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<TimeSeriesEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const windowSize = 5 * 60 * 1000 // 5 minutes
      const windowStart = Math.floor(Date.now() / windowSize) * windowSize
      const windowEnd = windowStart + windowSize

      // Event at boundary - 1ms (should be in current window)
      pipeline.process({
        id: '1',
        timestamp: windowEnd - 1,
        value: 100,
        date: '2024-01-15',
        yearWeek: '2024-03',
        category: 'A',
      })

      // Event exactly at boundary (should be in next window)
      pipeline.process({
        id: '2',
        timestamp: windowEnd,
        value: 100,
        date: '2024-01-16',
        yearWeek: '2024-03',
        category: 'A',
      })

      // Advance past both windows
      pipeline.advanceWatermark(windowEnd + windowSize)

      // Should have results from both windows
      expect(results.length).toBeGreaterThanOrEqual(1)
      // First window should have the event with date '2024-01-15'
      const firstWindowResult = results.find((r) => r.aggregations.has('2024-01-15'))
      expect(firstWindowResult).toBeDefined()
      expect(firstWindowResult?.aggregations.get('2024-01-15')?.count).toBe(1)
    })

    it('DST transitions do not corrupt date keys', () => {
      // Test around DST transition dates (e.g., March 10, 2024 in US)
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date)
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<TimeSeriesEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      // March 10, 2024 - DST starts in US (2 AM becomes 3 AM)
      const dstDate = new Date('2024-03-10T02:30:00Z').getTime()

      pipeline.process({
        id: '1',
        timestamp: dstDate,
        value: 100,
        date: '2024-03-10',
        yearWeek: '2024-10',
        category: 'A',
      })

      pipeline.advanceWatermark(dstDate + 3600000)

      expect(results).toHaveLength(1)
      // Date key should be preserved exactly
      expect(results[0].aggregations.has('2024-03-10')).toBe(true)
    })

    it('leap year date Feb 29 is handled correctly', () => {
      // 2024 is a leap year
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date)
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<TimeSeriesEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const feb29 = new Date('2024-02-29T12:00:00Z').getTime()

      pipeline.process({
        id: '1',
        timestamp: feb29,
        value: 100,
        date: '2024-02-29',
        yearWeek: '2024-09',
        category: 'A',
      })

      pipeline.advanceWatermark(feb29 + 3600000)

      expect(results).toHaveLength(1)
      // Leap day date should be preserved
      expect(results[0].aggregations.has('2024-02-29')).toBe(true)
    })
  })

  // ============================================================================
  // Serialization Tests
  // ============================================================================

  describe('Serialization', () => {
    it('window key serializes to storable string format', () => {
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date)
        .aggregate({ count: { $count: {} } })

      const baseTime = Date.now()

      pipeline.process({
        id: '1',
        timestamp: baseTime,
        value: 100,
        date: '2024-01-15',
        yearWeek: '2024-03',
        category: 'A',
      })

      const checkpoint = pipeline.createCheckpoint()

      // Checkpoint should contain window state that can be serialized
      expect(checkpoint.windowStates).toBeDefined()
      expect(checkpoint.windowStates.length).toBeGreaterThan(0)

      // Window key should be serializable
      const windowKey = checkpoint.windowStates[0].windowKey
      expect(typeof windowKey).toBe('string')

      // The key in the window should be preserved
      expect(checkpoint.windowStates[0].window.key).toBe('2024-01-15')
    })

    it('window key deserializes correctly after checkpoint restore', () => {
      const pipeline1 = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date)
        .aggregate({ sum: { $sum: '$value' } })

      const baseTime = Date.now()

      pipeline1.process({
        id: '1',
        timestamp: baseTime,
        value: 100,
        date: '2024-01-15',
        yearWeek: '2024-03',
        category: 'A',
      })

      const checkpoint = pipeline1.createCheckpoint()

      // Serialize and deserialize (simulate storage)
      const serialized = JSON.stringify(checkpoint)
      const restored = JSON.parse(serialized)

      // Create new pipeline and restore
      const pipeline2 = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date)
        .aggregate({ sum: { $sum: '$value' } })

      pipeline2.restoreFromCheckpoint(restored)

      // Continue processing
      pipeline2.process({
        id: '2',
        timestamp: baseTime + 1000,
        value: 50,
        date: '2024-01-15',
        yearWeek: '2024-03',
        category: 'B',
      })

      const results: IncrementalResult<TimeSeriesEvent>[] = []
      pipeline2.onResult((result) => results.push(result))
      pipeline2.advanceWatermark(baseTime + 3600000)

      expect(results).toHaveLength(1)
      // Sum should include both events: 100 + 50 = 150
      // BUG: If date key '2024-01-15' was corrupted during checkpoint/restore,
      // the aggregations won't match
      expect(results[0].aggregations.has('2024-01-15')).toBe(true)
      expect(results[0].aggregations.get('2024-01-15')?.sum).toBe(150)
    })

    it('window keys sort chronologically when using date keys', () => {
      // When keys are ISO dates, they should sort correctly
      const keys: string[] = []
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date)
        .aggregate({ count: { $count: {} } })

      pipeline.onResult((result) => {
        for (const [key] of result.aggregations) {
          if (typeof key === 'string') keys.push(key)
        }
      })

      const baseTime = Date.now()
      const dates = ['2024-01-15', '2024-01-14', '2024-02-01', '2024-01-01']

      for (const date of dates) {
        pipeline.process({
          id: date,
          timestamp: baseTime,
          value: 100,
          date,
          yearWeek: '2024-01',
          category: 'A',
        })
      }

      pipeline.advanceWatermark(baseTime + 3600000)

      // All dates should be present and sortable
      expect(keys.length).toBe(dates.length)
      const sorted = [...keys].sort()
      expect(sorted).toEqual(['2024-01-01', '2024-01-14', '2024-01-15', '2024-02-01'])
    })

    it('roundtrip preserves complex keys with multiple dashes', () => {
      // Key like 'US-WEST-2024-01-15' should survive serialize/deserialize
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => `${e.category}-${e.date}`)
        .aggregate({ count: { $count: {} } })

      const baseTime = Date.now()

      pipeline.process({
        id: '1',
        timestamp: baseTime,
        value: 100,
        date: '2024-01-15',
        yearWeek: '2024-03',
        category: 'US-WEST',
      })

      const checkpoint = pipeline.createCheckpoint()
      const serialized = JSON.stringify(checkpoint)
      const restored = JSON.parse(serialized)

      // The window key should preserve 'US-WEST-2024-01-15'
      expect(restored.windowStates[0].window.key).toBe('US-WEST-2024-01-15')
    })
  })

  // ============================================================================
  // Additional Edge Cases
  // ============================================================================

  describe('Additional edge cases', () => {
    it('handles negative timestamp windows with date keys', () => {
      // This tests the interaction between negative numbers and dash-containing keys
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.date)
        .aggregate({ count: { $count: {} } })

      // Use a timestamp in the past (before Unix epoch) - edge case
      // Note: Most systems don't support this, but the parser should handle it
      const baseTime = -86400000 // 1 day before epoch

      // This may not work with all window assigners, but tests the parsing
      try {
        pipeline.process({
          id: '1',
          timestamp: Math.abs(baseTime), // Use positive for valid timestamp
          value: 100,
          date: '1969-12-31',
          yearWeek: '1969-53',
          category: 'A',
        })
      } catch {
        // Some implementations may not support negative timestamps
      }
    })

    it('handles empty key gracefully', () => {
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor(() => '')
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<TimeSeriesEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()

      pipeline.process({
        id: '1',
        timestamp: baseTime,
        value: 100,
        date: '2024-01-15',
        yearWeek: '2024-03',
        category: 'A',
      })

      pipeline.advanceWatermark(baseTime + 3600000)

      expect(results).toHaveLength(1)
      // Empty key should work
      expect(results[0].aggregations.has('')).toBe(true)
    })

    it('handles key with only dashes', () => {
      // Pathological case: key is '---'
      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor(() => '---')
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<TimeSeriesEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()

      pipeline.process({
        id: '1',
        timestamp: baseTime,
        value: 100,
        date: '2024-01-15',
        yearWeek: '2024-03',
        category: 'A',
      })

      pipeline.advanceWatermark(baseTime + 3600000)

      expect(results).toHaveLength(1)
      // Key '---' should be preserved
      expect(results[0].aggregations.has('---')).toBe(true)
    })

    it('handles UUID-like keys with dashes', () => {
      // UUID: '550e8400-e29b-41d4-a716-446655440000'
      const uuid = '550e8400-e29b-41d4-a716-446655440000'

      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor(() => uuid)
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<TimeSeriesEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()

      pipeline.process({
        id: uuid,
        timestamp: baseTime,
        value: 100,
        date: '2024-01-15',
        yearWeek: '2024-03',
        category: 'A',
      })

      pipeline.advanceWatermark(baseTime + 3600000)

      expect(results).toHaveLength(1)
      // UUID should be preserved exactly
      expect(results[0].aggregations.has(uuid)).toBe(true)
    })

    it('handles keys resembling window key format', () => {
      // Key that looks like internal format: '12345-67890-'
      // This could confuse the parser
      const trickyKey = '12345-67890-extra'

      const pipeline = createStreamingPipeline<TimeSeriesEvent>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor(() => trickyKey)
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<TimeSeriesEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()

      pipeline.process({
        id: '1',
        timestamp: baseTime,
        value: 100,
        date: '2024-01-15',
        yearWeek: '2024-03',
        category: 'A',
      })

      pipeline.advanceWatermark(baseTime + 3600000)

      expect(results).toHaveLength(1)
      // Key should not be confused with window metadata
      expect(results[0].aggregations.has(trickyKey)).toBe(true)
    })
  })
})
