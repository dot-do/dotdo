/**
 * @dotdo/flink - ProcessFunction with Timers Tests (GREEN Phase)
 * Issue: dotdo-yrp0z
 *
 * Tests for Flink ProcessFunction implementation with:
 * - ProcessFunction base class with processElement()
 * - KeyedProcessFunction with state and timers
 * - TimerService interface (registerProcessingTimeTimer, registerEventTimeTimer)
 * - OnTimer callbacks
 * - Side outputs via OutputTag
 * - Context with timestamp, timerService, output
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  StreamExecutionEnvironment,
  DataStream,
  ProcessFunction,
  KeyedProcessFunction,
  RuntimeContext,
  Context,
  OnTimerContext,
  Collector,
  OutputTag,
  ValueState,
  ValueStateDescriptor,
  ListStateDescriptor,
  TimerService,
  WatermarkStrategy,
  Time,
  _clear,
  createTestEnvironment,
} from '../index'

import {
  FlinkTimerService,
  FlinkProcessFunctionRunner,
  FlinkKeyedProcessFunctionRunner,
} from '../process-function'

// Test event types
interface SensorEvent {
  sensorId: string
  timestamp: number
  value: number
}

interface UserAction {
  userId: string
  action: string
  timestamp: number
}

describe('@dotdo/flink - ProcessFunction with Timers', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // FlinkTimerService
  // ===========================================================================

  describe('FlinkTimerService', () => {
    it('should return current processing time', () => {
      const timerService = new FlinkTimerService()
      const now = Date.now()
      const processingTime = timerService.currentProcessingTime()

      // Should be within 100ms of current time
      expect(processingTime).toBeGreaterThanOrEqual(now - 100)
      expect(processingTime).toBeLessThanOrEqual(now + 100)
    })

    it('should track current watermark', () => {
      const timerService = new FlinkTimerService()

      // Initially watermark should be MIN_SAFE_INTEGER
      expect(timerService.currentWatermark()).toBe(Number.MIN_SAFE_INTEGER)

      // Set watermark
      timerService.setWatermark(5000)
      expect(timerService.currentWatermark()).toBe(5000)

      // Watermark should only advance forward
      timerService.setWatermark(3000)
      expect(timerService.currentWatermark()).toBe(5000)

      // Advance watermark
      timerService.setWatermark(10000)
      expect(timerService.currentWatermark()).toBe(10000)
    })

    it('should register event-time timers', () => {
      const timerService = new FlinkTimerService()

      timerService.registerEventTimeTimer(1000)
      timerService.registerEventTimeTimer(2000)
      timerService.registerEventTimeTimer(3000)

      expect(timerService.getRegisteredEventTimeTimers()).toContain(1000)
      expect(timerService.getRegisteredEventTimeTimers()).toContain(2000)
      expect(timerService.getRegisteredEventTimeTimers()).toContain(3000)
    })

    it('should register processing-time timers', () => {
      const timerService = new FlinkTimerService()

      timerService.registerProcessingTimeTimer(1000)
      timerService.registerProcessingTimeTimer(2000)

      expect(timerService.getRegisteredProcessingTimeTimers()).toContain(1000)
      expect(timerService.getRegisteredProcessingTimeTimers()).toContain(2000)
    })

    it('should delete event-time timers', () => {
      const timerService = new FlinkTimerService()

      timerService.registerEventTimeTimer(1000)
      timerService.registerEventTimeTimer(2000)

      timerService.deleteEventTimeTimer(1000)

      expect(timerService.getRegisteredEventTimeTimers()).not.toContain(1000)
      expect(timerService.getRegisteredEventTimeTimers()).toContain(2000)
    })

    it('should delete processing-time timers', () => {
      const timerService = new FlinkTimerService()

      timerService.registerProcessingTimeTimer(1000)
      timerService.registerProcessingTimeTimer(2000)

      timerService.deleteProcessingTimeTimer(1000)

      expect(timerService.getRegisteredProcessingTimeTimers()).not.toContain(1000)
      expect(timerService.getRegisteredProcessingTimeTimers()).toContain(2000)
    })

    it('should fire event-time timers when watermark advances', () => {
      const timerService = new FlinkTimerService()

      timerService.registerEventTimeTimer(1000)
      timerService.registerEventTimeTimer(2000)
      timerService.registerEventTimeTimer(5000)

      // Advance watermark to 3000
      const firedTimers = timerService.fireEventTimeTimers(3000)

      expect(firedTimers).toContain(1000)
      expect(firedTimers).toContain(2000)
      expect(firedTimers).not.toContain(5000)

      // Fired timers should be removed
      expect(timerService.getRegisteredEventTimeTimers()).not.toContain(1000)
      expect(timerService.getRegisteredEventTimeTimers()).not.toContain(2000)
      expect(timerService.getRegisteredEventTimeTimers()).toContain(5000)
    })

    it('should fire processing-time timers when time advances', () => {
      const timerService = new FlinkTimerService()
      const now = Date.now()

      timerService.registerProcessingTimeTimer(now + 100)
      timerService.registerProcessingTimeTimer(now + 200)
      timerService.registerProcessingTimeTimer(now + 1000)

      // Fire timers up to now + 500
      const firedTimers = timerService.fireProcessingTimeTimers(now + 500)

      expect(firedTimers).toContain(now + 100)
      expect(firedTimers).toContain(now + 200)
      expect(firedTimers).not.toContain(now + 1000)
    })

    it('should not fire same timer twice (coalescing)', () => {
      const timerService = new FlinkTimerService()

      // Register same timer multiple times
      timerService.registerEventTimeTimer(1000)
      timerService.registerEventTimeTimer(1000)
      timerService.registerEventTimeTimer(1000)

      const firedTimers = timerService.fireEventTimeTimers(2000)

      // Timer should only fire once
      expect(firedTimers.filter((t) => t === 1000)).toHaveLength(1)
    })

    it('should clear all timers on dispose', () => {
      const timerService = new FlinkTimerService()

      timerService.registerEventTimeTimer(1000)
      timerService.registerProcessingTimeTimer(2000)

      timerService.dispose()

      expect(timerService.getRegisteredEventTimeTimers()).toHaveLength(0)
      expect(timerService.getRegisteredProcessingTimeTimers()).toHaveLength(0)
    })
  })

  // ===========================================================================
  // ProcessFunction Base Class
  // ===========================================================================

  describe('ProcessFunction', () => {
    it('should process elements with processElement()', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { id: 1, value: 10 },
        { id: 2, value: 20 },
        { id: 3, value: 30 }
      )

      class DoubleValueFunction extends ProcessFunction<
        { id: number; value: number },
        { id: number; doubled: number }
      > {
        processElement(
          value: { id: number; value: number },
          ctx: Context,
          out: Collector<{ id: number; doubled: number }>
        ) {
          out.collect({ id: value.id, doubled: value.value * 2 })
        }
      }

      const processed = stream.process(new DoubleValueFunction())
      const result = await env.executeAndCollect(processed)

      expect(result).toEqual([
        { id: 1, doubled: 20 },
        { id: 2, doubled: 40 },
        { id: 3, doubled: 60 },
      ])
    })

    it('should provide timestamp in context', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { id: 1, timestamp: 1000 },
          { id: 2, timestamp: 2000 },
          { id: 3, timestamp: 3000 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{ id: number; timestamp: number }>().withTimestampAssigner(
            (e) => e.timestamp
          )
        )

      const timestamps: (number | null)[] = []

      class TimestampCapturingFunction extends ProcessFunction<
        { id: number; timestamp: number },
        { id: number; capturedTimestamp: number | null }
      > {
        processElement(
          value: { id: number; timestamp: number },
          ctx: Context,
          out: Collector<{ id: number; capturedTimestamp: number | null }>
        ) {
          const ts = ctx.timestamp()
          timestamps.push(ts)
          out.collect({ id: value.id, capturedTimestamp: ts })
        }
      }

      const processed = stream.process(new TimestampCapturingFunction())
      const result = await env.executeAndCollect(processed)

      expect(timestamps).toEqual([1000, 2000, 3000])
      expect(result[0]?.capturedTimestamp).toBe(1000)
    })

    it('should provide timerService in context', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements({ id: 1 })

      let timerServiceAccessed = false

      class TimerServiceAccessFunction extends ProcessFunction<{ id: number }, { id: number }> {
        processElement(value: { id: number }, ctx: Context, out: Collector<{ id: number }>) {
          const ts = ctx.timerService()
          timerServiceAccessed = ts !== undefined && ts !== null
          out.collect(value)
        }
      }

      const processed = stream.process(new TimerServiceAccessFunction())
      await env.executeAndCollect(processed)

      expect(timerServiceAccessed).toBe(true)
    })

    it('should emit to side outputs', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { id: 1, value: 5 },
        { id: 2, value: 15 },
        { id: 3, value: 8 },
        { id: 4, value: 25 }
      )

      const largeValueTag = new OutputTag<{ id: number; value: number }>('large-values')

      class SplittingFunction extends ProcessFunction<
        { id: number; value: number },
        { id: number; value: number }
      > {
        processElement(
          value: { id: number; value: number },
          ctx: Context,
          out: Collector<{ id: number; value: number }>
        ) {
          if (value.value > 10) {
            ctx.output(largeValueTag, value)
          } else {
            out.collect(value)
          }
        }
      }

      const processed = stream.process(new SplittingFunction())
      const mainOutput = await env.executeAndCollect(processed)
      const sideOutput = await env.executeAndCollect(processed.getSideOutput(largeValueTag))

      expect(mainOutput).toEqual([
        { id: 1, value: 5 },
        { id: 3, value: 8 },
      ])
      expect(sideOutput).toEqual([
        { id: 2, value: 15 },
        { id: 4, value: 25 },
      ])
    })

    it('should call open() lifecycle method', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements({ id: 1 })

      let openCalled = false

      class LifecycleFunction extends ProcessFunction<{ id: number }, { id: number }> {
        open(context: RuntimeContext) {
          openCalled = true
        }

        processElement(value: { id: number }, ctx: Context, out: Collector<{ id: number }>) {
          out.collect(value)
        }
      }

      const processed = stream.process(new LifecycleFunction())
      await env.executeAndCollect(processed)

      expect(openCalled).toBe(true)
    })

    it('should call close() lifecycle method', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements({ id: 1 })

      let closeCalled = false

      class LifecycleFunction extends ProcessFunction<{ id: number }, { id: number }> {
        close() {
          closeCalled = true
        }

        processElement(value: { id: number }, ctx: Context, out: Collector<{ id: number }>) {
          out.collect(value)
        }
      }

      const processed = stream.process(new LifecycleFunction())
      await env.executeAndCollect(processed)

      expect(closeCalled).toBe(true)
    })
  })

  // ===========================================================================
  // KeyedProcessFunction with Timers
  // ===========================================================================

  describe('KeyedProcessFunction with Timers', () => {
    it('should register and fire event-time timers', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, value: 1 },
          { userId: 'u1', timestamp: 5000, value: 2 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            userId: string
            timestamp: number
            value: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const timerFiredTimes: number[] = []

      class TimerFunction extends KeyedProcessFunction<
        string,
        { userId: string; timestamp: number; value: number },
        { type: string; timestamp: number }
      > {
        processElement(
          event: { userId: string; timestamp: number; value: number },
          ctx: Context,
          out: Collector<{ type: string; timestamp: number }>
        ) {
          // Register a timer 2 seconds after the event
          ctx.timerService().registerEventTimeTimer(event.timestamp + 2000)
          out.collect({ type: 'element', timestamp: event.timestamp })
        }

        onTimer(
          timestamp: number,
          ctx: OnTimerContext,
          out: Collector<{ type: string; timestamp: number }>
        ) {
          timerFiredTimes.push(timestamp)
          out.collect({ type: 'timer', timestamp })
        }
      }

      const processed = stream.keyBy((e) => e.userId).process(new TimerFunction())
      const result = await env.executeAndCollect(processed)

      // Timer at 3000 should fire when watermark advances past it (at 5000)
      expect(timerFiredTimes).toContain(3000)
      expect(result).toContainEqual({ type: 'timer', timestamp: 3000 })
    })

    it('should provide timeDomain() in OnTimerContext', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { key: 'a', timestamp: 1000 },
          { key: 'a', timestamp: 5000 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            key: string
            timestamp: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const timeDomains: string[] = []

      class TimeDomainFunction extends KeyedProcessFunction<
        string,
        { key: string; timestamp: number },
        string
      > {
        processElement(
          event: { key: string; timestamp: number },
          ctx: Context,
          out: Collector<string>
        ) {
          ctx.timerService().registerEventTimeTimer(event.timestamp + 1000)
          out.collect('element')
        }

        onTimer(timestamp: number, ctx: OnTimerContext, out: Collector<string>) {
          timeDomains.push(ctx.timeDomain())
          out.collect(`timer-${ctx.timeDomain()}`)
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new TimeDomainFunction())
      await env.executeAndCollect(processed)

      expect(timeDomains).toContain('EVENT_TIME')
    })

    it('should delete registered event-time timers', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { userId: 'u1', timestamp: 1000, action: 'start' },
          { userId: 'u1', timestamp: 2000, action: 'cancel' },
          { userId: 'u1', timestamp: 10000, action: 'done' }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            userId: string
            timestamp: number
            action: string
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const timersFired: number[] = []

      class CancellableTimerFunction extends KeyedProcessFunction<
        string,
        { userId: string; timestamp: number; action: string },
        string
      > {
        private pendingTimer!: ValueState<number>

        open(ctx: RuntimeContext) {
          this.pendingTimer = ctx.getState(new ValueStateDescriptor<number>('pending-timer'))
        }

        processElement(
          event: { userId: string; timestamp: number; action: string },
          ctx: Context,
          out: Collector<string>
        ) {
          if (event.action === 'start') {
            const timerTime = event.timestamp + 5000
            ctx.timerService().registerEventTimeTimer(timerTime)
            this.pendingTimer.update(timerTime)
            out.collect(`timer registered for ${timerTime}`)
          } else if (event.action === 'cancel') {
            const pending = this.pendingTimer.value()
            if (pending !== null) {
              ctx.timerService().deleteEventTimeTimer(pending)
              this.pendingTimer.clear()
              out.collect(`timer at ${pending} cancelled`)
            }
          }
        }

        onTimer(timestamp: number, ctx: OnTimerContext, out: Collector<string>) {
          timersFired.push(timestamp)
          out.collect(`timer fired at ${timestamp}`)
        }
      }

      const processed = stream.keyBy((e) => e.userId).process(new CancellableTimerFunction())
      await env.executeAndCollect(processed)

      // Timer at 6000 should NOT fire because it was cancelled
      expect(timersFired).not.toContain(6000)
    })

    it('should maintain separate timers per key', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { key: 'a', timestamp: 1000 },
          { key: 'b', timestamp: 1000 },
          { key: 'a', timestamp: 5000 },
          { key: 'b', timestamp: 5000 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            key: string
            timestamp: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const timersByKey: Record<string, number[]> = { a: [], b: [] }

      class PerKeyTimerFunction extends KeyedProcessFunction<
        string,
        { key: string; timestamp: number },
        { key: string; type: string }
      > {
        processElement(
          event: { key: string; timestamp: number },
          ctx: Context,
          out: Collector<{ key: string; type: string }>
        ) {
          ctx.timerService().registerEventTimeTimer(event.timestamp + 2000)
          out.collect({ key: event.key, type: 'element' })
        }

        onTimer(
          timestamp: number,
          ctx: OnTimerContext,
          out: Collector<{ key: string; type: string }>
        ) {
          // getCurrentKey would return the key in a real implementation
          const key = (ctx as any).getCurrentKey?.() ?? 'unknown'
          if (timersByKey[key]) {
            timersByKey[key].push(timestamp)
          }
          out.collect({ key, type: 'timer' })
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new PerKeyTimerFunction())
      const result = await env.executeAndCollect(processed)

      // Both keys should have their timers fire
      expect(result.filter((r) => r.type === 'timer')).toHaveLength(2)
    })

    it('should coalesce duplicate timer registrations', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { key: 'a', timestamp: 1000 },
          { key: 'a', timestamp: 1100 },
          { key: 'a', timestamp: 1200 },
          { key: 'a', timestamp: 5000 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            key: string
            timestamp: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      let timerFireCount = 0

      class CoalescingTimerFunction extends KeyedProcessFunction<
        string,
        { key: string; timestamp: number },
        string
      > {
        processElement(event: { key: string; timestamp: number }, ctx: Context, out: Collector<string>) {
          // All elements register timer for same time
          ctx.timerService().registerEventTimeTimer(3000)
          out.collect('element')
        }

        onTimer(timestamp: number, ctx: OnTimerContext, out: Collector<string>) {
          timerFireCount++
          out.collect(`timer fired at ${timestamp}`)
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new CoalescingTimerFunction())
      await env.executeAndCollect(processed)

      // Timer at 3000 should fire exactly once, not three times
      expect(timerFireCount).toBe(1)
    })

    it('should fire all pending timers when stream ends', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements({ key: 'a', timestamp: 1000 })
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            key: string
            timestamp: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const timersFired: number[] = []

      class EndOfStreamTimerFunction extends KeyedProcessFunction<
        string,
        { key: string; timestamp: number },
        string
      > {
        processElement(event: { key: string; timestamp: number }, ctx: Context, out: Collector<string>) {
          // Register timer far in the future
          ctx.timerService().registerEventTimeTimer(event.timestamp + 100000)
          out.collect('element')
        }

        onTimer(timestamp: number, ctx: OnTimerContext, out: Collector<string>) {
          timersFired.push(timestamp)
          out.collect(`timer fired at ${timestamp}`)
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new EndOfStreamTimerFunction())
      await env.executeAndCollect(processed)

      // Timer should fire at end of stream (watermark advances to MAX)
      expect(timersFired).toContain(101000)
    })

    it('should access current watermark in timer service', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { key: 'a', timestamp: 1000 },
          { key: 'a', timestamp: 3000 },
          { key: 'a', timestamp: 5000 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            key: string
            timestamp: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const watermarks: number[] = []

      class WatermarkTrackingFunction extends KeyedProcessFunction<
        string,
        { key: string; timestamp: number },
        { timestamp: number; watermark: number }
      > {
        processElement(
          event: { key: string; timestamp: number },
          ctx: Context,
          out: Collector<{ timestamp: number; watermark: number }>
        ) {
          const watermark = ctx.timerService().currentWatermark()
          watermarks.push(watermark)
          out.collect({ timestamp: event.timestamp, watermark })
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new WatermarkTrackingFunction())
      const result = await env.executeAndCollect(processed)

      // Watermarks should increase as we process elements
      expect(result[1]?.watermark).toBeGreaterThan(result[0]?.watermark ?? 0)
      expect(result[2]?.watermark).toBeGreaterThan(result[1]?.watermark ?? 0)
    })

    it('should output to side outputs from onTimer', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { key: 'a', timestamp: 1000 },
          { key: 'a', timestamp: 5000 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            key: string
            timestamp: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      const timerOutputTag = new OutputTag<{ timerTimestamp: number }>('timer-outputs')

      class SideOutputTimerFunction extends KeyedProcessFunction<
        string,
        { key: string; timestamp: number },
        string
      > {
        processElement(event: { key: string; timestamp: number }, ctx: Context, out: Collector<string>) {
          ctx.timerService().registerEventTimeTimer(event.timestamp + 2000)
          out.collect('element')
        }

        onTimer(timestamp: number, ctx: OnTimerContext, out: Collector<string>) {
          ctx.output(timerOutputTag, { timerTimestamp: timestamp })
          out.collect('timer')
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new SideOutputTimerFunction())
      const mainOutput = await env.executeAndCollect(processed)
      const sideOutput = await env.executeAndCollect(processed.getSideOutput(timerOutputTag))

      expect(mainOutput).toContain('timer')
      expect(sideOutput).toContainEqual({ timerTimestamp: 3000 })
    })

    it('should provide access to keyed state in onTimer', async () => {
      const env = createTestEnvironment()
      const stream = env
        .fromElements(
          { key: 'a', timestamp: 1000, value: 10 },
          { key: 'a', timestamp: 2000, value: 20 },
          { key: 'a', timestamp: 5000, value: 30 }
        )
        .assignTimestampsAndWatermarks(
          WatermarkStrategy.forMonotonousTimestamps<{
            key: string
            timestamp: number
            value: number
          }>().withTimestampAssigner((e) => e.timestamp)
        )

      class StatefulTimerFunction extends KeyedProcessFunction<
        string,
        { key: string; timestamp: number; value: number },
        { type: string; sum?: number }
      > {
        private sumState!: ValueState<number>

        open(ctx: RuntimeContext) {
          this.sumState = ctx.getState(new ValueStateDescriptor<number>('sum', 0))
        }

        processElement(
          event: { key: string; timestamp: number; value: number },
          ctx: Context,
          out: Collector<{ type: string; sum?: number }>
        ) {
          const current = this.sumState.value() ?? 0
          this.sumState.update(current + event.value)

          // Only register timer on first element
          if (current === 0) {
            ctx.timerService().registerEventTimeTimer(event.timestamp + 3000)
          }

          out.collect({ type: 'element' })
        }

        onTimer(
          timestamp: number,
          ctx: OnTimerContext,
          out: Collector<{ type: string; sum?: number }>
        ) {
          // Should have access to the accumulated state
          const sum = this.sumState.value()
          out.collect({ type: 'timer', sum: sum ?? 0 })
        }
      }

      const processed = stream.keyBy((e) => e.key).process(new StatefulTimerFunction())
      const result = await env.executeAndCollect(processed)

      // Timer should see sum of 10 + 20 = 30 (first two elements before timer fires at 4000)
      const timerResult = result.find((r) => r.type === 'timer')
      expect(timerResult?.sum).toBe(30)
    })
  })

  // ===========================================================================
  // FlinkProcessFunctionRunner
  // ===========================================================================

  describe('FlinkProcessFunctionRunner', () => {
    it('should run a ProcessFunction and collect results', () => {
      class SimpleFunction extends ProcessFunction<number, number> {
        processElement(value: number, ctx: Context, out: Collector<number>) {
          out.collect(value * 2)
        }
      }

      const runner = new FlinkProcessFunctionRunner(new SimpleFunction())
      const results = runner.processAll([1, 2, 3])

      expect(results).toEqual([2, 4, 6])
    })

    it('should handle lifecycle methods', () => {
      let openCalled = false
      let closeCalled = false

      class LifecycleFunction extends ProcessFunction<number, number> {
        open() {
          openCalled = true
        }

        close() {
          closeCalled = true
        }

        processElement(value: number, ctx: Context, out: Collector<number>) {
          out.collect(value)
        }
      }

      const runner = new FlinkProcessFunctionRunner(new LifecycleFunction())
      runner.processAll([1, 2, 3])

      expect(openCalled).toBe(true)
      expect(closeCalled).toBe(true)
    })

    it('should collect side outputs', () => {
      const errorTag = new OutputTag<{ error: string }>('errors')

      class ErrorHandlingFunction extends ProcessFunction<
        { value: number },
        { result: number }
      > {
        processElement(
          input: { value: number },
          ctx: Context,
          out: Collector<{ result: number }>
        ) {
          if (input.value < 0) {
            ctx.output(errorTag, { error: `Negative value: ${input.value}` })
          } else {
            out.collect({ result: input.value * 2 })
          }
        }
      }

      const runner = new FlinkProcessFunctionRunner(new ErrorHandlingFunction())
      const results = runner.processAll([{ value: 1 }, { value: -2 }, { value: 3 }])
      const errors = runner.getSideOutput(errorTag)

      expect(results).toEqual([{ result: 2 }, { result: 6 }])
      expect(errors).toEqual([{ error: 'Negative value: -2' }])
    })
  })

  // ===========================================================================
  // FlinkKeyedProcessFunctionRunner
  // ===========================================================================

  describe('FlinkKeyedProcessFunctionRunner', () => {
    it('should maintain separate state per key', () => {
      class CountingFunction extends KeyedProcessFunction<
        string,
        { key: string; value: number },
        { key: string; count: number }
      > {
        private countState!: ValueState<number>

        open(ctx: RuntimeContext) {
          this.countState = ctx.getState(new ValueStateDescriptor<number>('count', 0))
        }

        processElement(
          event: { key: string; value: number },
          ctx: Context,
          out: Collector<{ key: string; count: number }>
        ) {
          const count = (this.countState.value() ?? 0) + 1
          this.countState.update(count)
          out.collect({ key: event.key, count })
        }
      }

      const runner = new FlinkKeyedProcessFunctionRunner(
        new CountingFunction(),
        (e: { key: string; value: number }) => e.key
      )

      const results = runner.processAll([
        { key: 'a', value: 1 },
        { key: 'b', value: 1 },
        { key: 'a', value: 2 },
        { key: 'b', value: 2 },
        { key: 'a', value: 3 },
      ])

      expect(results).toContainEqual({ key: 'a', count: 1 })
      expect(results).toContainEqual({ key: 'a', count: 2 })
      expect(results).toContainEqual({ key: 'a', count: 3 })
      expect(results).toContainEqual({ key: 'b', count: 1 })
      expect(results).toContainEqual({ key: 'b', count: 2 })
    })

    it('should fire timers and call onTimer', () => {
      const timersFired: number[] = []

      class TimerFunction extends KeyedProcessFunction<
        string,
        { key: string; timestamp: number },
        { type: string; timestamp?: number }
      > {
        processElement(
          event: { key: string; timestamp: number },
          ctx: Context,
          out: Collector<{ type: string; timestamp?: number }>
        ) {
          ctx.timerService().registerEventTimeTimer(event.timestamp + 1000)
          out.collect({ type: 'element' })
        }

        onTimer(
          timestamp: number,
          ctx: OnTimerContext,
          out: Collector<{ type: string; timestamp?: number }>
        ) {
          timersFired.push(timestamp)
          out.collect({ type: 'timer', timestamp })
        }
      }

      const runner = new FlinkKeyedProcessFunctionRunner(
        new TimerFunction(),
        (e: { key: string; timestamp: number }) => e.key,
        (e: { key: string; timestamp: number }) => e.timestamp
      )

      const results = runner.processAll([
        { key: 'a', timestamp: 1000 },
        { key: 'a', timestamp: 5000 },
      ])

      // Timer at 2000 should fire when we process element at 5000
      expect(timersFired).toContain(2000)
      expect(results).toContainEqual({ type: 'timer', timestamp: 2000 })
    })
  })

  // ===========================================================================
  // Integration with DataStream API
  // ===========================================================================

  describe('Integration with DataStream API', () => {
    it('should work with DataStream.process()', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(1, 2, 3, 4, 5)

      class FilterEvenFunction extends ProcessFunction<number, number> {
        processElement(value: number, ctx: Context, out: Collector<number>) {
          if (value % 2 === 0) {
            out.collect(value)
          }
        }
      }

      const processed = stream.process(new FilterEvenFunction())
      const result = await env.executeAndCollect(processed)

      expect(result).toEqual([2, 4])
    })

    it('should work with KeyedStream.process()', async () => {
      const env = createTestEnvironment()
      const stream = env.fromElements(
        { category: 'A', value: 10 },
        { category: 'B', value: 20 },
        { category: 'A', value: 30 },
        { category: 'B', value: 40 }
      )

      class SumFunction extends KeyedProcessFunction<
        string,
        { category: string; value: number },
        { category: string; sum: number }
      > {
        private sumState!: ValueState<number>

        open(ctx: RuntimeContext) {
          this.sumState = ctx.getState(new ValueStateDescriptor<number>('sum', 0))
        }

        processElement(
          event: { category: string; value: number },
          ctx: Context,
          out: Collector<{ category: string; sum: number }>
        ) {
          const sum = (this.sumState.value() ?? 0) + event.value
          this.sumState.update(sum)
          out.collect({ category: event.category, sum })
        }
      }

      const processed = stream.keyBy((e) => e.category).process(new SumFunction())
      const result = await env.executeAndCollect(processed)

      // A: 10, 40
      // B: 20, 60
      const aResults = result.filter((r) => r.category === 'A')
      const bResults = result.filter((r) => r.category === 'B')

      expect(aResults[aResults.length - 1]?.sum).toBe(40)
      expect(bResults[bResults.length - 1]?.sum).toBe(60)
    })
  })
})
