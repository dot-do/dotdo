/**
 * Streaming Pipeline with WindowManager Integration Tests (RED Phase)
 *
 * Tests for streaming aggregation pipeline:
 * - Continuous aggregation
 * - Window-based grouping
 * - Watermark handling
 * - Late data side outputs
 * - Incremental results
 *
 * @see dotdo-sivsj
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  StreamingPipeline,
  createStreamingPipeline,
  StreamingPipelineOptions,
  WindowedAggregation,
  IncrementalResult,
  LateDataOutput,
  CheckpointState,
} from '../streaming'
import {
  WindowManager,
  Window,
  EventTimeTrigger,
  CountTrigger,
  ProcessingTimeTrigger,
  PurgingTrigger,
  Trigger,
  TriggerResult,
  minutes,
  seconds,
  hours,
} from '../../window-manager'
import type { Accumulator } from '../stages/group'

// Test data types
interface ClickEvent {
  userId: string
  pageId: string
  timestamp: number
  sessionId: string
  duration: number
  action: 'view' | 'click' | 'scroll'
}

interface SensorReading {
  sensorId: string
  value: number
  timestamp: number
  unit: string
  quality: 'good' | 'suspect' | 'bad'
}

interface Transaction {
  transactionId: string
  accountId: string
  amount: number
  timestamp: number
  type: 'credit' | 'debit'
  category: string
}

describe('StreamingPipeline', () => {
  let mockWindowManager: WindowManager<ClickEvent>

  afterEach(() => {
    // Clean up any timers
    vi.restoreAllMocks()
  })

  describe('Pipeline creation', () => {
    it('should create a streaming pipeline with WindowManager', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.tumbling(minutes(5)),
        trigger: new EventTimeTrigger(),
      })

      expect(pipeline).toBeDefined()
      expect(pipeline.isStreaming).toBe(true)
    })

    it('should support tumbling window configuration', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.tumbling(minutes(10)),
        trigger: new EventTimeTrigger(),
      })

      expect(pipeline.windowType).toBe('tumbling')
      expect(pipeline.windowSize.toMillis()).toBe(600000)
    })

    it('should support sliding window configuration', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.sliding(minutes(10), minutes(5)),
        trigger: new EventTimeTrigger(),
      })

      expect(pipeline.windowType).toBe('sliding')
      expect(pipeline.windowSlide?.toMillis()).toBe(300000)
    })

    it('should support session window configuration', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.session(minutes(30)),
        trigger: new EventTimeTrigger(),
      })

      expect(pipeline.windowType).toBe('session')
    })

    it('should support global window configuration', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.global(),
        trigger: new CountTrigger(100),
      })

      expect(pipeline.windowType).toBe('global')
    })
  })

  describe('Continuous aggregation', () => {
    it('should aggregate events within a tumbling window', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.tumbling(minutes(5)),
        trigger: new EventTimeTrigger(),
      })
        .groupBy('userId')
        .aggregate({
          totalDuration: { $sum: '$duration' },
          eventCount: { $count: {} },
        })

      const results: IncrementalResult<ClickEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      // Use a base time aligned to window boundary to ensure all events are in the same window
      const windowSizeMs = 5 * 60 * 1000 // 5 minutes in ms
      const baseTime = Math.floor(Date.now() / windowSizeMs) * windowSizeMs // Align to window start
      pipeline.process({ userId: 'u1', pageId: 'p1', timestamp: baseTime, sessionId: 's1', duration: 30, action: 'view' })
      pipeline.process({ userId: 'u1', pageId: 'p2', timestamp: baseTime + 60000, sessionId: 's1', duration: 45, action: 'click' })
      pipeline.process({ userId: 'u1', pageId: 'p3', timestamp: baseTime + 120000, sessionId: 's1', duration: 20, action: 'view' })

      // Advance watermark past window end
      pipeline.advanceWatermark(baseTime + windowSizeMs)

      expect(results).toHaveLength(1)
      expect(results[0].aggregations.get('u1')?.totalDuration).toBe(95)
      expect(results[0].aggregations.get('u1')?.eventCount).toBe(3)
    })

    it('should handle multiple windows for sliding configuration', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.sliding(minutes(10), minutes(5)),
        trigger: new EventTimeTrigger(),
      })
        .groupBy('pageId')
        .aggregate({ viewCount: { $count: {} } })

      const results: IncrementalResult<ClickEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      // Event at minute 3 should be in windows [0-10] and will be in [0-10] only
      pipeline.process({ userId: 'u1', pageId: 'home', timestamp: baseTime + 180000, sessionId: 's1', duration: 10, action: 'view' })

      // Advance watermark to trigger first window
      pipeline.advanceWatermark(baseTime + 600000)

      // Each event may appear in multiple overlapping windows
      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it('should merge sessions for session windows', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.session(minutes(5)),
        trigger: new EventTimeTrigger(),
      })
        .withKeyExtractor((e) => e.userId)
        .aggregate({ totalDuration: { $sum: '$duration' } })

      const results: IncrementalResult<ClickEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      // Events within 5-minute gap should merge into same session
      pipeline.process({ userId: 'u1', pageId: 'p1', timestamp: baseTime, sessionId: 's1', duration: 30, action: 'view' })
      pipeline.process({ userId: 'u1', pageId: 'p2', timestamp: baseTime + 120000, sessionId: 's1', duration: 45, action: 'view' }) // 2 min later
      pipeline.process({ userId: 'u1', pageId: 'p3', timestamp: baseTime + 240000, sessionId: 's1', duration: 20, action: 'view' }) // 4 min from first

      // Advance watermark past session timeout
      pipeline.advanceWatermark(baseTime + 600000)

      // Should be one merged session
      expect(results).toHaveLength(1)
      expect(results[0].aggregations.get('u1')?.totalDuration).toBe(95)
    })

    it('should support keyed aggregation within windows', () => {
      const pipeline = createStreamingPipeline<Transaction>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .groupBy(['accountId', 'type'])
        .aggregate({
          totalAmount: { $sum: '$amount' },
          transactionCount: { $count: {} },
        })

      const results: IncrementalResult<Transaction>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      pipeline.process({ transactionId: 't1', accountId: 'a1', amount: 100, timestamp: baseTime, type: 'credit', category: 'income' })
      pipeline.process({ transactionId: 't2', accountId: 'a1', amount: 50, timestamp: baseTime + 1000, type: 'debit', category: 'shopping' })
      pipeline.process({ transactionId: 't3', accountId: 'a1', amount: 200, timestamp: baseTime + 2000, type: 'credit', category: 'income' })

      pipeline.advanceWatermark(baseTime + 3600000)

      expect(results).toHaveLength(1)
      // Should have separate aggregations for (a1, credit) and (a1, debit)
      expect(results[0].aggregations.size).toBeGreaterThan(1)
    })
  })

  describe('Window-based grouping', () => {
    it('should include window metadata in results', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.tumbling(minutes(5)),
        trigger: new EventTimeTrigger(),
      })
        .groupBy('userId')
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<ClickEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      pipeline.process({ userId: 'u1', pageId: 'p1', timestamp: baseTime, sessionId: 's1', duration: 30, action: 'view' })
      pipeline.advanceWatermark(baseTime + 300000)

      expect(results[0].window).toBeDefined()
      expect(results[0].window.start).toBeDefined()
      expect(results[0].window.end).toBeDefined()
    })

    it('should support window start/end in aggregation expressions', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.tumbling(minutes(5)),
        trigger: new EventTimeTrigger(),
      })
        .groupBy('userId')
        .aggregate({
          count: { $count: {} },
          windowStart: { $windowStart: true },
          windowEnd: { $windowEnd: true },
        })

      const results: IncrementalResult<ClickEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      pipeline.process({ userId: 'u1', pageId: 'p1', timestamp: baseTime, sessionId: 's1', duration: 30, action: 'view' })
      pipeline.advanceWatermark(baseTime + 300000)

      const userResult = results[0].aggregations.get('u1')
      expect(userResult?.windowStart).toBeDefined()
      expect(userResult?.windowEnd).toBeDefined()
      expect(userResult?.windowEnd - userResult?.windowStart).toBe(300000)
    })

    it('should support per-window deduplication', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.tumbling(minutes(5)),
        trigger: new EventTimeTrigger(),
        deduplication: {
          enabled: true,
          keyExtractor: (e) => `${e.userId}-${e.pageId}`,
        },
      })
        .groupBy('userId')
        .aggregate({ uniquePages: { $addToSet: '$pageId' } })

      const results: IncrementalResult<ClickEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      // Same user viewing same page multiple times
      pipeline.process({ userId: 'u1', pageId: 'p1', timestamp: baseTime, sessionId: 's1', duration: 30, action: 'view' })
      pipeline.process({ userId: 'u1', pageId: 'p1', timestamp: baseTime + 1000, sessionId: 's1', duration: 45, action: 'view' })
      pipeline.process({ userId: 'u1', pageId: 'p2', timestamp: baseTime + 2000, sessionId: 's1', duration: 20, action: 'view' })

      pipeline.advanceWatermark(baseTime + 300000)

      expect(results[0].aggregations.get('u1')?.uniquePages).toHaveLength(2)
    })
  })

  describe('Watermark handling', () => {
    it('should track watermark progression', () => {
      const pipeline = createStreamingPipeline<SensorReading>({
        windowAssigner: WindowManager.tumbling(minutes(1)),
        trigger: new EventTimeTrigger(),
      })

      const baseTime = Date.now()
      expect(pipeline.getCurrentWatermark()).toBeLessThan(baseTime)

      pipeline.advanceWatermark(baseTime)
      expect(pipeline.getCurrentWatermark()).toBe(baseTime)

      pipeline.advanceWatermark(baseTime + 60000)
      expect(pipeline.getCurrentWatermark()).toBe(baseTime + 60000)
    })

    it('should not allow watermark to go backwards', () => {
      const pipeline = createStreamingPipeline<SensorReading>({
        windowAssigner: WindowManager.tumbling(minutes(1)),
        trigger: new EventTimeTrigger(),
      })

      const baseTime = Date.now()
      pipeline.advanceWatermark(baseTime + 60000)

      expect(() => pipeline.advanceWatermark(baseTime)).toThrow()
    })

    it('should trigger windows when watermark passes window end', () => {
      const pipeline = createStreamingPipeline<SensorReading>({
        windowAssigner: WindowManager.tumbling(minutes(1)),
        trigger: new EventTimeTrigger(),
      })
        .aggregate({ avgValue: { $avg: '$value' } })

      const results: IncrementalResult<SensorReading>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = 60000 * 10 // Start at minute 10
      pipeline.process({ sensorId: 's1', value: 100, timestamp: baseTime, unit: 'C', quality: 'good' })
      pipeline.process({ sensorId: 's1', value: 110, timestamp: baseTime + 30000, unit: 'C', quality: 'good' })

      expect(results).toHaveLength(0) // Not triggered yet

      pipeline.advanceWatermark(baseTime + 60000) // Pass window end

      expect(results).toHaveLength(1)
      expect(results[0].aggregations.get(undefined)?.avgValue).toBe(105)
    })

    it('should support allowed lateness configuration', () => {
      const pipeline = createStreamingPipeline<SensorReading>({
        windowAssigner: WindowManager.tumbling(minutes(1)),
        trigger: new EventTimeTrigger(),
        allowedLateness: seconds(30),
      })
        .aggregate({ sum: { $sum: '$value' } })

      const results: IncrementalResult<SensorReading>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = 60000 * 10
      pipeline.process({ sensorId: 's1', value: 100, timestamp: baseTime, unit: 'C', quality: 'good' })
      pipeline.advanceWatermark(baseTime + 60000) // Trigger window

      expect(results).toHaveLength(1)
      expect(results[0].aggregations.get(undefined)?.sum).toBe(100)

      // Late data within allowed lateness
      pipeline.process({ sensorId: 's1', value: 50, timestamp: baseTime + 10000, unit: 'C', quality: 'good' })
      pipeline.advanceWatermark(baseTime + 75000)

      // Should re-fire with updated result
      expect(results).toHaveLength(2)
      expect(results[1].aggregations.get(undefined)?.sum).toBe(150)
    })
  })

  describe('Late data side outputs', () => {
    it('should route late data to side output', () => {
      const lateData: LateDataOutput<SensorReading>[] = []

      const pipeline = createStreamingPipeline<SensorReading>({
        windowAssigner: WindowManager.tumbling(minutes(1)),
        trigger: new EventTimeTrigger(),
        allowedLateness: seconds(10),
      })
        .aggregate({ sum: { $sum: '$value' } })
        .onLateData((event, window) => {
          lateData.push({ event, window })
        })

      const baseTime = 60000 * 10
      pipeline.process({ sensorId: 's1', value: 100, timestamp: baseTime, unit: 'C', quality: 'good' })
      pipeline.advanceWatermark(baseTime + 60000 + 15000) // Past allowed lateness

      // This event is too late
      pipeline.process({ sensorId: 's1', value: 50, timestamp: baseTime + 5000, unit: 'C', quality: 'good' })

      expect(lateData).toHaveLength(1)
      expect(lateData[0].event.value).toBe(50)
    })

    it('should include original window information in late data output', () => {
      const lateData: LateDataOutput<SensorReading>[] = []

      const pipeline = createStreamingPipeline<SensorReading>({
        windowAssigner: WindowManager.tumbling(minutes(1)),
        trigger: new EventTimeTrigger(),
      })
        .aggregate({ sum: { $sum: '$value' } })
        .onLateData((event, window) => {
          lateData.push({ event, window })
        })

      const baseTime = 60000 * 10
      pipeline.advanceWatermark(baseTime + 120000) // Well past any early windows

      // This event would have belonged to window [baseTime, baseTime + 60000]
      pipeline.process({ sensorId: 's1', value: 50, timestamp: baseTime + 5000, unit: 'C', quality: 'good' })

      expect(lateData[0].window).toBeDefined()
      expect(lateData[0].window.start).toBeLessThanOrEqual(baseTime + 5000)
    })

    it('should support custom late data handling strategies', () => {
      let droppedCount = 0
      let retainedForLater: SensorReading[] = []

      const pipeline = createStreamingPipeline<SensorReading>({
        windowAssigner: WindowManager.tumbling(minutes(1)),
        trigger: new EventTimeTrigger(),
        lateDataStrategy: {
          type: 'custom',
          handler: (event, window, context) => {
            if (event.quality === 'good') {
              retainedForLater.push(event)
              return 'retain'
            } else {
              droppedCount++
              return 'drop'
            }
          },
        },
      })

      const baseTime = 60000 * 10
      pipeline.advanceWatermark(baseTime + 120000)

      pipeline.process({ sensorId: 's1', value: 50, timestamp: baseTime, unit: 'C', quality: 'good' })
      pipeline.process({ sensorId: 's1', value: 60, timestamp: baseTime + 1000, unit: 'C', quality: 'bad' })

      expect(retainedForLater).toHaveLength(1)
      expect(droppedCount).toBe(1)
    })
  })

  describe('Incremental results', () => {
    it('should emit incremental updates with count trigger', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.global(),
        trigger: new CountTrigger(3),
      })
        .aggregate({ totalClicks: { $count: {} } })

      const results: IncrementalResult<ClickEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      pipeline.process({ userId: 'u1', pageId: 'p1', timestamp: baseTime, sessionId: 's1', duration: 10, action: 'click' })
      pipeline.process({ userId: 'u1', pageId: 'p2', timestamp: baseTime + 1000, sessionId: 's1', duration: 10, action: 'click' })

      expect(results).toHaveLength(0) // Not triggered yet

      pipeline.process({ userId: 'u1', pageId: 'p3', timestamp: baseTime + 2000, sessionId: 's1', duration: 10, action: 'click' })

      expect(results).toHaveLength(1)
      expect(results[0].aggregations.get(undefined)?.totalClicks).toBe(3)
    })

    it('should support periodic processing time triggers', async () => {
      vi.useFakeTimers()

      const pipeline = createStreamingPipeline<SensorReading>({
        windowAssigner: WindowManager.global(),
        trigger: new ProcessingTimeTrigger(seconds(1)),
      })
        .aggregate({ avgValue: { $avg: '$value' } })

      const results: IncrementalResult<SensorReading>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      pipeline.process({ sensorId: 's1', value: 100, timestamp: baseTime, unit: 'C', quality: 'good' })
      pipeline.process({ sensorId: 's1', value: 110, timestamp: baseTime + 100, unit: 'C', quality: 'good' })

      expect(results).toHaveLength(0)

      // Advance time by 1 second + 1ms to ensure interval fires
      await vi.advanceTimersByTimeAsync(1001)

      expect(results).toHaveLength(1)
      expect(results[0].aggregations.get(undefined)?.avgValue).toBe(105)

      // Clean up timer
      pipeline.dispose()
      vi.useRealTimers()
    })

    it('should support composite triggers (OR)', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.tumbling(minutes(5)),
        trigger: Trigger.or(new CountTrigger(10), new EventTimeTrigger()),
      })
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<ClickEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()

      // Add 10 events - should trigger on count
      for (let i = 0; i < 10; i++) {
        pipeline.process({
          userId: 'u1',
          pageId: `p${i}`,
          timestamp: baseTime + i * 1000,
          sessionId: 's1',
          duration: 10,
          action: 'view',
        })
      }

      expect(results).toHaveLength(1) // Triggered by count
    })

    it('should support purging triggers', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.global(),
        trigger: new PurgingTrigger(new CountTrigger(3)),
      })
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<ClickEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()

      // First batch of 3
      for (let i = 0; i < 3; i++) {
        pipeline.process({ userId: 'u1', pageId: `p${i}`, timestamp: baseTime + i, sessionId: 's1', duration: 10, action: 'view' })
      }

      expect(results).toHaveLength(1)
      expect(results[0].aggregations.get(undefined)?.count).toBe(3)

      // Second batch of 3 (state was purged)
      for (let i = 0; i < 3; i++) {
        pipeline.process({ userId: 'u1', pageId: `p${i + 3}`, timestamp: baseTime + i + 3, sessionId: 's1', duration: 10, action: 'view' })
      }

      expect(results).toHaveLength(2)
      expect(results[1].aggregations.get(undefined)?.count).toBe(3) // Not cumulative
    })

    it('should include delta since last emission', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.global(),
        trigger: new CountTrigger(5),
        emitDeltas: true,
      })
        .aggregate({
          count: { $count: {} },
          totalDuration: { $sum: '$duration' },
        })

      const results: IncrementalResult<ClickEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      for (let i = 0; i < 10; i++) {
        pipeline.process({
          userId: 'u1',
          pageId: `p${i}`,
          timestamp: baseTime + i,
          sessionId: 's1',
          duration: 10,
          action: 'view',
        })
      }

      expect(results).toHaveLength(2)
      // First emission
      expect(results[0].aggregations.get(undefined)?.count).toBe(5)
      // Second emission includes delta
      expect(results[1].delta?.countDelta).toBe(5)
    })
  })

  describe('Stateful accumulator checkpointing', () => {
    it('should support checkpoint creation', () => {
      const pipeline = createStreamingPipeline<Transaction>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
        checkpointing: {
          enabled: true,
          interval: minutes(5),
        },
      })
        .groupBy('accountId')
        .aggregate({ balance: { $sum: '$amount' } })

      const baseTime = Date.now()
      pipeline.process({ transactionId: 't1', accountId: 'a1', amount: 100, timestamp: baseTime, type: 'credit', category: 'income' })
      pipeline.process({ transactionId: 't2', accountId: 'a1', amount: -30, timestamp: baseTime + 1000, type: 'debit', category: 'expense' })

      const checkpoint = pipeline.createCheckpoint()

      expect(checkpoint).toBeDefined()
      expect(checkpoint.watermark).toBeDefined()
      expect(checkpoint.windowStates).toBeDefined()
      expect(checkpoint.accumulatorStates).toBeDefined()
    })

    it('should restore from checkpoint', () => {
      const pipeline1 = createStreamingPipeline<Transaction>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .groupBy('accountId')
        .aggregate({ balance: { $sum: '$amount' } })

      const baseTime = Date.now()
      pipeline1.process({ transactionId: 't1', accountId: 'a1', amount: 100, timestamp: baseTime, type: 'credit', category: 'income' })

      const checkpoint = pipeline1.createCheckpoint()

      // Create new pipeline and restore
      const pipeline2 = createStreamingPipeline<Transaction>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .groupBy('accountId')
        .aggregate({ balance: { $sum: '$amount' } })

      pipeline2.restoreFromCheckpoint(checkpoint)

      // Continue processing
      pipeline2.process({ transactionId: 't2', accountId: 'a1', amount: 50, timestamp: baseTime + 1000, type: 'credit', category: 'income' })

      const results: IncrementalResult<Transaction>[] = []
      pipeline2.onResult((result) => results.push(result))
      pipeline2.advanceWatermark(baseTime + 3600000)

      expect(results[0].aggregations.get('a1')?.balance).toBe(150) // 100 + 50
    })

    it('should serialize checkpoint state', () => {
      const pipeline = createStreamingPipeline<Transaction>({
        windowAssigner: WindowManager.tumbling(hours(1)),
        trigger: new EventTimeTrigger(),
      })
        .aggregate({ count: { $count: {} } })

      const baseTime = Date.now()
      pipeline.process({ transactionId: 't1', accountId: 'a1', amount: 100, timestamp: baseTime, type: 'credit', category: 'income' })

      const checkpoint = pipeline.createCheckpoint()
      const serialized = JSON.stringify(checkpoint)
      const restored = JSON.parse(serialized)

      expect(restored.watermark).toBe(checkpoint.watermark)
    })
  })

  describe('Pipeline stages with streaming', () => {
    it('should support $match stage before aggregation', () => {
      const pipeline = createStreamingPipeline<Transaction>({
        windowAssigner: WindowManager.tumbling(minutes(5)),
        trigger: new EventTimeTrigger(),
      })
        .match({ type: 'credit' })
        .aggregate({ creditTotal: { $sum: '$amount' } })

      const results: IncrementalResult<Transaction>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      pipeline.process({ transactionId: 't1', accountId: 'a1', amount: 100, timestamp: baseTime, type: 'credit', category: 'income' })
      pipeline.process({ transactionId: 't2', accountId: 'a1', amount: 50, timestamp: baseTime + 1000, type: 'debit', category: 'expense' })
      pipeline.process({ transactionId: 't3', accountId: 'a1', amount: 75, timestamp: baseTime + 2000, type: 'credit', category: 'income' })

      pipeline.advanceWatermark(baseTime + 300000)

      // Should only include credits
      expect(results[0].aggregations.get(undefined)?.creditTotal).toBe(175)
    })

    it('should support $project stage after aggregation', () => {
      const pipeline = createStreamingPipeline<Transaction>({
        windowAssigner: WindowManager.tumbling(minutes(5)),
        trigger: new EventTimeTrigger(),
      })
        .groupBy('accountId')
        .aggregate({
          totalCredits: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] } },
          totalDebits: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] } },
        })
        .project({
          accountId: 1,
          netBalance: { $subtract: ['$totalCredits', '$totalDebits'] },
        })

      const results: IncrementalResult<Transaction>[] = []
      pipeline.onResult((result) => results.push(result))

      const baseTime = Date.now()
      pipeline.process({ transactionId: 't1', accountId: 'a1', amount: 100, timestamp: baseTime, type: 'credit', category: 'income' })
      pipeline.process({ transactionId: 't2', accountId: 'a1', amount: 30, timestamp: baseTime + 1000, type: 'debit', category: 'expense' })

      pipeline.advanceWatermark(baseTime + 300000)

      expect(results[0].aggregations.get('a1')?.netBalance).toBe(70)
    })
  })

  describe('Resource management', () => {
    it('should clean up resources on dispose', () => {
      vi.useFakeTimers()

      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.global(),
        trigger: new ProcessingTimeTrigger(seconds(1)),
      })
        .aggregate({ count: { $count: {} } })

      const results: IncrementalResult<ClickEvent>[] = []
      pipeline.onResult((result) => results.push(result))

      pipeline.process({ userId: 'u1', pageId: 'p1', timestamp: Date.now(), sessionId: 's1', duration: 10, action: 'view' })

      pipeline.dispose()

      // Timer should be cleared, no new results after dispose
      vi.advanceTimersByTime(2000)
      expect(results).toHaveLength(0)

      vi.useRealTimers()
    })

    it('should report active window count', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.tumbling(minutes(5)),
        trigger: new EventTimeTrigger(),
      })
        .aggregate({ count: { $count: {} } })

      expect(pipeline.getActiveWindowCount()).toBe(0)

      const baseTime = Date.now()
      pipeline.process({ userId: 'u1', pageId: 'p1', timestamp: baseTime, sessionId: 's1', duration: 10, action: 'view' })

      expect(pipeline.getActiveWindowCount()).toBe(1)

      // Trigger and clean up window
      pipeline.advanceWatermark(baseTime + 600000)

      expect(pipeline.getActiveWindowCount()).toBe(0)
    })

    it('should provide memory usage estimates', () => {
      const pipeline = createStreamingPipeline<ClickEvent>({
        windowAssigner: WindowManager.tumbling(minutes(5)),
        trigger: new EventTimeTrigger(),
      })
        .groupBy('userId')
        .aggregate({ count: { $count: {} } })

      const baseTime = Date.now()
      for (let i = 0; i < 100; i++) {
        pipeline.process({
          userId: `u${i % 10}`,
          pageId: `p${i}`,
          timestamp: baseTime + i * 100,
          sessionId: 's1',
          duration: 10,
          action: 'view',
        })
      }

      const memoryEstimate = pipeline.estimateMemoryUsage()
      expect(memoryEstimate.total).toBeGreaterThan(0)
      expect(memoryEstimate).toHaveProperty('windowState')
      expect(memoryEstimate).toHaveProperty('accumulatorState')
    })
  })
})
