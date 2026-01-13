/**
 * @dotdo/flink - Apache Flink DataStream API Compat Layer for Cloudflare Workers
 *
 * Stateful stream processing on Durable Objects with Flink-compatible API.
 * Provides the familiar Flink DataStream API for building real-time data pipelines.
 *
 * Features:
 * - DataStream API with map, filter, keyBy, window operations
 * - Keyed state (ValueState, ListState, MapState, ReducingState, AggregatingState)
 * - Windows (tumbling, sliding, session, global)
 * - Watermarks and event-time processing
 * - Checkpointing backed by Durable Objects storage
 * - Process functions with timers
 *
 * @example Basic Stream Processing
 * ```typescript
 * import { StreamExecutionEnvironment, Time, TumblingEventTimeWindows } from '@dotdo/flink'
 *
 * const env = StreamExecutionEnvironment.getExecutionEnvironment()
 *
 * const stream = env.fromElements(
 *   { userId: 'u1', value: 1, timestamp: 1000 },
 *   { userId: 'u1', value: 2, timestamp: 2000 },
 *   { userId: 'u2', value: 3, timestamp: 3000 },
 * )
 *
 * const result = stream
 *   .filter((e) => e.value > 0)
 *   .keyBy((e) => e.userId)
 *   .window(TumblingEventTimeWindows.of(Time.seconds(5)))
 *   .reduce((a, b) => ({ ...a, value: a.value + b.value }))
 *
 * await env.execute('My Job')
 * ```
 *
 * @example Keyed State
 * ```typescript
 * import {
 *   StreamExecutionEnvironment,
 *   KeyedProcessFunction,
 *   ValueState,
 *   ValueStateDescriptor,
 *   RuntimeContext,
 *   Context,
 *   Collector
 * } from '@dotdo/flink'
 *
 * class CountingFunction extends KeyedProcessFunction<string, Event, Result> {
 *   private count!: ValueState<number>
 *
 *   open(ctx: RuntimeContext) {
 *     this.count = ctx.getState(new ValueStateDescriptor('count', 0))
 *   }
 *
 *   processElement(event: Event, ctx: Context, out: Collector<Result>) {
 *     const current = (this.count.value() ?? 0) + 1
 *     this.count.update(current)
 *     out.collect({ userId: event.userId, count: current })
 *   }
 * }
 *
 * const result = stream
 *   .keyBy((e) => e.userId)
 *   .process(new CountingFunction())
 * ```
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/overview/
 */

// ===========================================================================
// Internal State Management
// ===========================================================================

const _environments: StreamExecutionEnvironment[] = []
const _keyedStates = new Map<string, Map<string, any>>()

/**
 * Clear all internal state (for testing)
 */
export function _clear(): void {
  _environments.length = 0
  _keyedStates.clear()
}

// ===========================================================================
// Time Utilities
// ===========================================================================

/**
 * Represents a time duration
 */
export class Time {
  private constructor(private readonly millis: number) {}

  toMilliseconds(): number {
    return this.millis
  }

  static milliseconds(ms: number): Time {
    return new Time(ms)
  }

  static seconds(s: number): Time {
    return new Time(s * 1000)
  }

  static minutes(m: number): Time {
    return new Time(m * 60 * 1000)
  }

  static hours(h: number): Time {
    return new Time(h * 60 * 60 * 1000)
  }

  static days(d: number): Time {
    return new Time(d * 24 * 60 * 60 * 1000)
  }
}

/**
 * Duration class for time intervals
 */
export class Duration {
  private constructor(private readonly millis: number) {}

  toMillis(): number {
    return this.millis
  }

  static ofMillis(ms: number): Duration {
    return new Duration(ms)
  }

  static ofSeconds(s: number): Duration {
    return new Duration(s * 1000)
  }

  static ofMinutes(m: number): Duration {
    return new Duration(m * 60 * 1000)
  }

  static ofHours(h: number): Duration {
    return new Duration(h * 60 * 60 * 1000)
  }
}

// ===========================================================================
// Window Types
// ===========================================================================

/**
 * Represents a time window
 */
export interface TimeWindow {
  getStart(): number
  getEnd(): number
  maxTimestamp(): number
}

class TimeWindowImpl implements TimeWindow {
  constructor(
    private readonly start: number,
    private readonly end: number
  ) {}

  getStart(): number {
    return this.start
  }

  getEnd(): number {
    return this.end
  }

  maxTimestamp(): number {
    return this.end - 1
  }
}

/**
 * Base interface for window assigners
 */
export interface WindowAssigner<T, W extends TimeWindow> {
  assignWindows(element: T, timestamp: number): W[]
  getDefaultTrigger(): Trigger<T, W>
  isEventTime(): boolean
}

/**
 * Tumbling event-time windows
 */
export class TumblingEventTimeWindows implements WindowAssigner<any, TimeWindow> {
  private constructor(
    private readonly size: Time,
    private readonly offset: Time = Time.milliseconds(0)
  ) {}

  static of(size: Time, offset?: Time): TumblingEventTimeWindows {
    return new TumblingEventTimeWindows(size, offset)
  }

  assignWindows(element: any, timestamp: number): TimeWindow[] {
    const sizeMs = this.size.toMilliseconds()
    const offsetMs = this.offset.toMilliseconds()
    const start = Math.floor((timestamp - offsetMs) / sizeMs) * sizeMs + offsetMs
    return [new TimeWindowImpl(start, start + sizeMs)]
  }

  getDefaultTrigger(): Trigger<any, TimeWindow> {
    return EventTimeTrigger.create()
  }

  isEventTime(): boolean {
    return true
  }
}

/**
 * Tumbling processing-time windows
 */
export class TumblingProcessingTimeWindows implements WindowAssigner<any, TimeWindow> {
  private constructor(
    private readonly size: Time,
    private readonly offset: Time = Time.milliseconds(0)
  ) {}

  static of(size: Time, offset?: Time): TumblingProcessingTimeWindows {
    return new TumblingProcessingTimeWindows(size, offset)
  }

  assignWindows(element: any, timestamp: number): TimeWindow[] {
    const sizeMs = this.size.toMilliseconds()
    const offsetMs = this.offset.toMilliseconds()
    const now = Date.now()
    const start = Math.floor((now - offsetMs) / sizeMs) * sizeMs + offsetMs
    return [new TimeWindowImpl(start, start + sizeMs)]
  }

  getDefaultTrigger(): Trigger<any, TimeWindow> {
    return ProcessingTimeTrigger.create()
  }

  isEventTime(): boolean {
    return false
  }
}

/**
 * Sliding event-time windows
 */
export class SlidingEventTimeWindows implements WindowAssigner<any, TimeWindow> {
  private constructor(
    private readonly size: Time,
    private readonly slide: Time
  ) {}

  static of(size: Time, slide: Time): SlidingEventTimeWindows {
    return new SlidingEventTimeWindows(size, slide)
  }

  assignWindows(element: any, timestamp: number): TimeWindow[] {
    const sizeMs = this.size.toMilliseconds()
    const slideMs = this.slide.toMilliseconds()
    const windows: TimeWindow[] = []

    let windowStart = Math.floor(timestamp / slideMs) * slideMs
    while (windowStart > timestamp - sizeMs) {
      windows.push(new TimeWindowImpl(windowStart, windowStart + sizeMs))
      windowStart -= slideMs
    }

    return windows
  }

  getDefaultTrigger(): Trigger<any, TimeWindow> {
    return EventTimeTrigger.create()
  }

  isEventTime(): boolean {
    return true
  }
}

/**
 * Sliding processing-time windows
 */
export class SlidingProcessingTimeWindows implements WindowAssigner<any, TimeWindow> {
  private constructor(
    private readonly size: Time,
    private readonly slide: Time
  ) {}

  static of(size: Time, slide: Time): SlidingProcessingTimeWindows {
    return new SlidingProcessingTimeWindows(size, slide)
  }

  assignWindows(element: any, timestamp: number): TimeWindow[] {
    const sizeMs = this.size.toMilliseconds()
    const slideMs = this.slide.toMilliseconds()
    const now = Date.now()
    const windows: TimeWindow[] = []

    let windowStart = Math.floor(now / slideMs) * slideMs
    while (windowStart > now - sizeMs) {
      windows.push(new TimeWindowImpl(windowStart, windowStart + sizeMs))
      windowStart -= slideMs
    }

    return windows
  }

  getDefaultTrigger(): Trigger<any, TimeWindow> {
    return ProcessingTimeTrigger.create()
  }

  isEventTime(): boolean {
    return false
  }
}

/**
 * Session windows with fixed gap
 */
export class SessionWindows implements WindowAssigner<any, TimeWindow> {
  private constructor(
    private readonly gap: Time,
    private readonly dynamicGapExtractor?: { extract: (element: any) => number }
  ) {}

  static withGap(gap: Time): SessionWindows {
    return new SessionWindows(gap)
  }

  static withDynamicGap(extractor: { extract: (element: any) => number }): SessionWindows {
    return new SessionWindows(Time.milliseconds(0), extractor)
  }

  assignWindows(element: any, timestamp: number): TimeWindow[] {
    const gapMs = this.dynamicGapExtractor
      ? this.dynamicGapExtractor.extract(element)
      : this.gap.toMilliseconds()
    return [new TimeWindowImpl(timestamp, timestamp + gapMs)]
  }

  getDefaultTrigger(): Trigger<any, TimeWindow> {
    return EventTimeTrigger.create()
  }

  isEventTime(): boolean {
    return true
  }
}

/**
 * Global windows (unbounded)
 */
export class GlobalWindows implements WindowAssigner<any, TimeWindow> {
  private static readonly INSTANCE = new GlobalWindows()

  private constructor() {}

  static create(): GlobalWindows {
    return GlobalWindows.INSTANCE
  }

  assignWindows(element: any, timestamp: number): TimeWindow[] {
    return [new TimeWindowImpl(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)]
  }

  getDefaultTrigger(): Trigger<any, TimeWindow> {
    return NeverTrigger.create()
  }

  isEventTime(): boolean {
    return false
  }
}

// ===========================================================================
// Triggers
// ===========================================================================

/**
 * Result of a trigger evaluation
 */
export enum TriggerResult {
  CONTINUE = 'CONTINUE',
  FIRE = 'FIRE',
  PURGE = 'PURGE',
  FIRE_AND_PURGE = 'FIRE_AND_PURGE',
}

/**
 * Base trigger interface
 */
export interface Trigger<T, W extends TimeWindow> {
  onElement(element: T, timestamp: number, window: W, ctx: TriggerContext): TriggerResult
  onEventTime(time: number, window: W, ctx: TriggerContext): TriggerResult
  onProcessingTime(time: number, window: W, ctx: TriggerContext): TriggerResult
  clear(window: W, ctx: TriggerContext): void
}

/**
 * Trigger context for accessing state and timers
 */
export interface TriggerContext {
  getCurrentWatermark(): number
  registerEventTimeTimer(time: number): void
  registerProcessingTimeTimer(time: number): void
  deleteEventTimeTimer(time: number): void
  deleteProcessingTimeTimer(time: number): void
  getPartitionedState<T>(descriptor: StateDescriptor<T>): T
}

/**
 * Event time trigger - fires when watermark passes window end
 */
export class EventTimeTrigger implements Trigger<any, TimeWindow> {
  private static readonly INSTANCE = new EventTimeTrigger()

  static create(): EventTimeTrigger {
    return EventTimeTrigger.INSTANCE
  }

  onElement(element: any, timestamp: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    ctx.registerEventTimeTimer(window.maxTimestamp())
    return TriggerResult.CONTINUE
  }

  onEventTime(time: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    return time === window.maxTimestamp() ? TriggerResult.FIRE : TriggerResult.CONTINUE
  }

  onProcessingTime(time: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    return TriggerResult.CONTINUE
  }

  clear(window: TimeWindow, ctx: TriggerContext): void {
    ctx.deleteEventTimeTimer(window.maxTimestamp())
  }
}

/**
 * Processing time trigger
 */
export class ProcessingTimeTrigger implements Trigger<any, TimeWindow> {
  private static readonly INSTANCE = new ProcessingTimeTrigger()

  static create(): ProcessingTimeTrigger {
    return ProcessingTimeTrigger.INSTANCE
  }

  onElement(element: any, timestamp: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    ctx.registerProcessingTimeTimer(window.maxTimestamp())
    return TriggerResult.CONTINUE
  }

  onEventTime(time: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    return TriggerResult.CONTINUE
  }

  onProcessingTime(time: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    return time >= window.maxTimestamp() ? TriggerResult.FIRE : TriggerResult.CONTINUE
  }

  clear(window: TimeWindow, ctx: TriggerContext): void {
    ctx.deleteProcessingTimeTimer(window.maxTimestamp())
  }
}

/**
 * Count trigger - fires every N elements
 */
export class CountTrigger implements Trigger<any, TimeWindow> {
  private constructor(private readonly count: number) {}

  static of(count: number): CountTrigger {
    return new CountTrigger(count)
  }

  onElement(element: any, timestamp: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    const countState = ctx.getPartitionedState<{ count: number }>({ name: 'count', defaultValue: { count: 0 } })
    countState.count++
    if (countState.count >= this.count) {
      countState.count = 0
      return TriggerResult.FIRE
    }
    return TriggerResult.CONTINUE
  }

  onEventTime(time: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    return TriggerResult.CONTINUE
  }

  onProcessingTime(time: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    return TriggerResult.CONTINUE
  }

  clear(window: TimeWindow, ctx: TriggerContext): void {
    const countState = ctx.getPartitionedState<{ count: number }>({ name: 'count', defaultValue: { count: 0 } })
    countState.count = 0
  }
}

/**
 * Never trigger - never fires (for global windows)
 */
class NeverTrigger implements Trigger<any, TimeWindow> {
  private static readonly INSTANCE = new NeverTrigger()

  static create(): NeverTrigger {
    return NeverTrigger.INSTANCE
  }

  onElement(element: any, timestamp: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    return TriggerResult.CONTINUE
  }

  onEventTime(time: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    return TriggerResult.CONTINUE
  }

  onProcessingTime(time: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    return TriggerResult.CONTINUE
  }

  clear(window: TimeWindow, ctx: TriggerContext): void {}
}

/**
 * Continuous event time trigger
 */
export class ContinuousEventTimeTrigger implements Trigger<any, TimeWindow> {
  private constructor(private readonly interval: Time) {}

  static of(interval: Time): ContinuousEventTimeTrigger {
    return new ContinuousEventTimeTrigger(interval)
  }

  onElement(element: any, timestamp: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    const nextFireTime = Math.ceil(ctx.getCurrentWatermark() / this.interval.toMilliseconds()) * this.interval.toMilliseconds()
    ctx.registerEventTimeTimer(Math.min(nextFireTime, window.maxTimestamp()))
    return TriggerResult.CONTINUE
  }

  onEventTime(time: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    if (time === window.maxTimestamp()) {
      return TriggerResult.FIRE
    }
    const nextFireTime = time + this.interval.toMilliseconds()
    if (nextFireTime < window.maxTimestamp()) {
      ctx.registerEventTimeTimer(nextFireTime)
    }
    return TriggerResult.FIRE
  }

  onProcessingTime(time: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    return TriggerResult.CONTINUE
  }

  clear(window: TimeWindow, ctx: TriggerContext): void {}
}

/**
 * Continuous processing time trigger
 */
export class ContinuousProcessingTimeTrigger implements Trigger<any, TimeWindow> {
  private constructor(private readonly interval: Time) {}

  static of(interval: Time): ContinuousProcessingTimeTrigger {
    return new ContinuousProcessingTimeTrigger(interval)
  }

  onElement(element: any, timestamp: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    const nextFireTime = Date.now() + this.interval.toMilliseconds()
    ctx.registerProcessingTimeTimer(Math.min(nextFireTime, window.maxTimestamp()))
    return TriggerResult.CONTINUE
  }

  onEventTime(time: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    return TriggerResult.CONTINUE
  }

  onProcessingTime(time: number, window: TimeWindow, ctx: TriggerContext): TriggerResult {
    if (time >= window.maxTimestamp()) {
      return TriggerResult.FIRE
    }
    const nextFireTime = time + this.interval.toMilliseconds()
    if (nextFireTime < window.maxTimestamp()) {
      ctx.registerProcessingTimeTimer(nextFireTime)
    }
    return TriggerResult.FIRE
  }

  clear(window: TimeWindow, ctx: TriggerContext): void {}
}

/**
 * Purging trigger wrapper
 */
export class PurgingTrigger<T, W extends TimeWindow> implements Trigger<T, W> {
  private constructor(private readonly nestedTrigger: Trigger<T, W>) {}

  static of<T, W extends TimeWindow>(trigger: Trigger<T, W>): PurgingTrigger<T, W> {
    return new PurgingTrigger(trigger)
  }

  onElement(element: T, timestamp: number, window: W, ctx: TriggerContext): TriggerResult {
    const result = this.nestedTrigger.onElement(element, timestamp, window, ctx)
    return this.toPurging(result)
  }

  onEventTime(time: number, window: W, ctx: TriggerContext): TriggerResult {
    const result = this.nestedTrigger.onEventTime(time, window, ctx)
    return this.toPurging(result)
  }

  onProcessingTime(time: number, window: W, ctx: TriggerContext): TriggerResult {
    const result = this.nestedTrigger.onProcessingTime(time, window, ctx)
    return this.toPurging(result)
  }

  clear(window: W, ctx: TriggerContext): void {
    this.nestedTrigger.clear(window, ctx)
  }

  private toPurging(result: TriggerResult): TriggerResult {
    return result === TriggerResult.FIRE ? TriggerResult.FIRE_AND_PURGE : result
  }
}

// ===========================================================================
// Evictors
// ===========================================================================

/**
 * Evictor interface for removing elements from windows
 */
export interface Evictor<T, W extends TimeWindow> {
  evictBefore(elements: Iterable<T>, size: number, window: W, ctx: EvictorContext): void
  evictAfter(elements: Iterable<T>, size: number, window: W, ctx: EvictorContext): void
}

/**
 * Evictor context
 */
export interface EvictorContext {
  getCurrentProcessingTime(): number
  getCurrentWatermark(): number
}

/**
 * Count evictor - keeps only last N elements
 */
export class CountEvictor<T> implements Evictor<T, TimeWindow> {
  private constructor(
    private readonly maxCount: number,
    private readonly doEvictAfter: boolean = false
  ) {}

  static of<T>(count: number, doEvictAfter: boolean = false): CountEvictor<T> {
    return new CountEvictor(count, doEvictAfter)
  }

  evictBefore(elements: Iterable<T>, size: number, window: TimeWindow, ctx: EvictorContext): void {
    if (!this.doEvictAfter) {
      this.evict(elements, size)
    }
  }

  evictAfter(elements: Iterable<T>, size: number, window: TimeWindow, ctx: EvictorContext): void {
    if (this.doEvictAfter) {
      this.evict(elements, size)
    }
  }

  private evict(elements: Iterable<T>, size: number): void {
    const arr = elements as T[]
    if (arr.length > this.maxCount) {
      arr.splice(0, arr.length - this.maxCount)
    }
  }
}

/**
 * Time evictor - removes elements older than specified time
 */
export class TimeEvictor<T extends { timestamp?: number }> implements Evictor<T, TimeWindow> {
  private constructor(
    private readonly windowSize: Time,
    private readonly doEvictAfter: boolean = false
  ) {}

  static of<T extends { timestamp?: number }>(windowSize: Time, doEvictAfter: boolean = false): TimeEvictor<T> {
    return new TimeEvictor(windowSize, doEvictAfter)
  }

  evictBefore(elements: Iterable<T>, size: number, window: TimeWindow, ctx: EvictorContext): void {
    if (!this.doEvictAfter) {
      this.evict(elements, window)
    }
  }

  evictAfter(elements: Iterable<T>, size: number, window: TimeWindow, ctx: EvictorContext): void {
    if (this.doEvictAfter) {
      this.evict(elements, window)
    }
  }

  private evict(elements: Iterable<T>, window: TimeWindow): void {
    const arr = elements as T[]
    const cutoff = window.getEnd() - this.windowSize.toMilliseconds()
    let i = 0
    while (i < arr.length && (arr[i]?.timestamp ?? 0) < cutoff) {
      i++
    }
    if (i > 0) {
      arr.splice(0, i)
    }
  }
}

/**
 * Delta evictor - removes elements based on a delta function
 */
export class DeltaEvictor<T> implements Evictor<T, TimeWindow> {
  private constructor(
    private readonly threshold: number,
    private readonly deltaFunction: (a: T, b: T) => number,
    private readonly doEvictAfter: boolean = false
  ) {}

  static of<T>(
    threshold: number,
    deltaFunction: (a: T, b: T) => number,
    doEvictAfter: boolean = false
  ): DeltaEvictor<T> {
    return new DeltaEvictor(threshold, deltaFunction, doEvictAfter)
  }

  evictBefore(elements: Iterable<T>, size: number, window: TimeWindow, ctx: EvictorContext): void {
    if (!this.doEvictAfter) {
      this.evict(elements)
    }
  }

  evictAfter(elements: Iterable<T>, size: number, window: TimeWindow, ctx: EvictorContext): void {
    if (this.doEvictAfter) {
      this.evict(elements)
    }
  }

  private evict(elements: Iterable<T>): void {
    const arr = elements as T[]
    if (arr.length <= 1) return

    const lastElement = arr[arr.length - 1]!
    let i = 0
    while (i < arr.length - 1) {
      if (this.deltaFunction(arr[i]!, lastElement) >= this.threshold) {
        arr.splice(i, 1)
      } else {
        i++
      }
    }
  }
}

// ===========================================================================
// Watermarks
// ===========================================================================

/**
 * Represents a watermark
 */
export class Watermark {
  constructor(private readonly timestamp: number) {}

  getTimestamp(): number {
    return this.timestamp
  }
}

/**
 * Output for emitting watermarks
 */
export interface WatermarkOutput {
  emitWatermark(watermark: Watermark): void
}

/**
 * Watermark generator interface
 */
export interface WatermarkGenerator<T> {
  onEvent(event: T, eventTimestamp: number, output: WatermarkOutput): void
  onPeriodicEmit(output: WatermarkOutput): void
}

/**
 * Timestamp assigner interface
 */
export interface TimestampAssigner<T> {
  extractTimestamp(element: T, recordTimestamp: number): number
}

/**
 * Bounded out-of-orderness watermarks
 */
export class BoundedOutOfOrdernessWatermarks<T> implements WatermarkGenerator<T> {
  private maxTimestamp = Number.MIN_SAFE_INTEGER

  constructor(private readonly maxOutOfOrderness: Time) {}

  onEvent(event: T, eventTimestamp: number, output: WatermarkOutput): void {
    this.maxTimestamp = Math.max(this.maxTimestamp, eventTimestamp)
  }

  onPeriodicEmit(output: WatermarkOutput): void {
    output.emitWatermark(new Watermark(this.maxTimestamp - this.maxOutOfOrderness.toMilliseconds() - 1))
  }
}

/**
 * Ascending timestamps watermarks (no out-of-orderness)
 */
export class AscendingTimestampsWatermarks<T> implements WatermarkGenerator<T> {
  private maxTimestamp = Number.MIN_SAFE_INTEGER

  onEvent(event: T, eventTimestamp: number, output: WatermarkOutput): void {
    this.maxTimestamp = Math.max(this.maxTimestamp, eventTimestamp)
  }

  onPeriodicEmit(output: WatermarkOutput): void {
    output.emitWatermark(new Watermark(this.maxTimestamp - 1))
  }
}

/**
 * Watermark strategy builder
 */
export class WatermarkStrategy<T> {
  private timestampAssigner?: (element: T) => number
  private idlenessTimeout?: Time
  private generatorSupplier?: () => WatermarkGenerator<T>

  private constructor() {}

  static forBoundedOutOfOrderness<T>(maxOutOfOrderness: Time): WatermarkStrategy<T> {
    const strategy = new WatermarkStrategy<T>()
    strategy.generatorSupplier = () => new BoundedOutOfOrdernessWatermarks<T>(maxOutOfOrderness)
    return strategy
  }

  static forMonotonousTimestamps<T>(): WatermarkStrategy<T> {
    const strategy = new WatermarkStrategy<T>()
    strategy.generatorSupplier = () => new AscendingTimestampsWatermarks<T>()
    return strategy
  }

  static noWatermarks<T>(): WatermarkStrategy<T> {
    const strategy = new WatermarkStrategy<T>()
    strategy.generatorSupplier = () => ({
      onEvent: () => {},
      onPeriodicEmit: () => {},
    })
    return strategy
  }

  static forGenerator<T>(supplier: () => WatermarkGenerator<T>): WatermarkStrategy<T> {
    const strategy = new WatermarkStrategy<T>()
    strategy.generatorSupplier = supplier
    return strategy
  }

  withTimestampAssigner(assigner: (element: T) => number): WatermarkStrategy<T> {
    this.timestampAssigner = assigner
    return this
  }

  withIdleness(idleTimeout: Time): WatermarkStrategy<T> {
    this.idlenessTimeout = idleTimeout
    return this
  }

  getTimestampAssigner(): ((element: T) => number) | undefined {
    return this.timestampAssigner
  }

  createWatermarkGenerator(): WatermarkGenerator<T> {
    return this.generatorSupplier?.() ?? {
      onEvent: () => {},
      onPeriodicEmit: () => {},
    }
  }
}

// ===========================================================================
// State Management
// ===========================================================================

/**
 * Base state descriptor interface
 */
export interface StateDescriptor<T> {
  name: string
  defaultValue: T
}

/**
 * Value state descriptor
 */
export class ValueStateDescriptor<T> implements StateDescriptor<T | null> {
  constructor(
    public readonly name: string,
    public readonly defaultValue: T | null = null
  ) {}

  private ttlConfig?: StateTtlConfig

  enableTimeToLive(config: StateTtlConfig): void {
    this.ttlConfig = config
  }

  getTtlConfig(): StateTtlConfig | undefined {
    return this.ttlConfig
  }
}

/**
 * List state descriptor
 */
export class ListStateDescriptor<T> implements StateDescriptor<T[]> {
  constructor(
    public readonly name: string,
    public readonly defaultValue: T[] = []
  ) {}
}

/**
 * Map state descriptor
 */
export class MapStateDescriptor<K, V> implements StateDescriptor<Map<K, V>> {
  constructor(
    public readonly name: string,
    public readonly defaultValue: Map<K, V> = new Map()
  ) {}
}

/**
 * Reducing state descriptor
 */
export class ReducingStateDescriptor<T> implements StateDescriptor<T | null> {
  constructor(
    public readonly name: string,
    public readonly reduceFunction: (a: T, b: T) => T,
    public readonly defaultValue: T | null = null
  ) {}
}

/**
 * Aggregating state descriptor
 */
export class AggregatingStateDescriptor<IN, ACC, OUT> {
  constructor(
    public readonly name: string,
    public readonly aggregateFunction: AggregateFunction<IN, ACC, OUT>
  ) {}
}

/**
 * State TTL configuration
 */
export class StateTtlConfig {
  private constructor(
    private readonly ttl: Time,
    private readonly updateType: StateTtlConfig.UpdateType,
    private readonly stateVisibility: StateTtlConfig.StateVisibility
  ) {}

  static newBuilder(ttl: Time): StateTtlConfigBuilder {
    return new StateTtlConfigBuilder(ttl)
  }

  getTtl(): Time {
    return this.ttl
  }

  getUpdateType(): StateTtlConfig.UpdateType {
    return this.updateType
  }

  getStateVisibility(): StateTtlConfig.StateVisibility {
    return this.stateVisibility
  }
}

export namespace StateTtlConfig {
  export enum UpdateType {
    OnCreateAndWrite = 'OnCreateAndWrite',
    OnReadAndWrite = 'OnReadAndWrite',
  }

  export enum StateVisibility {
    ReturnExpiredIfNotCleanedUp = 'ReturnExpiredIfNotCleanedUp',
    NeverReturnExpired = 'NeverReturnExpired',
  }
}

class StateTtlConfigBuilder {
  private updateType = StateTtlConfig.UpdateType.OnCreateAndWrite
  private stateVisibility = StateTtlConfig.StateVisibility.NeverReturnExpired

  constructor(private readonly ttl: Time) {}

  setUpdateType(updateType: StateTtlConfig.UpdateType): StateTtlConfigBuilder {
    this.updateType = updateType
    return this
  }

  setStateVisibility(stateVisibility: StateTtlConfig.StateVisibility): StateTtlConfigBuilder {
    this.stateVisibility = stateVisibility
    return this
  }

  build(): StateTtlConfig {
    return new (StateTtlConfig as any)(this.ttl, this.updateType, this.stateVisibility)
  }
}

/**
 * Value state interface
 */
export interface ValueState<T> {
  value(): T | null
  update(value: T): void
  clear(): void
}

/**
 * List state interface
 */
export interface ListState<T> {
  get(): Iterable<T>
  add(value: T): void
  addAll(values: T[]): void
  update(values: T[]): void
  clear(): void
}

/**
 * Map state interface
 */
export interface MapState<K, V> {
  get(key: K): V | undefined
  put(key: K, value: V): void
  putAll(map: Map<K, V>): void
  remove(key: K): void
  contains(key: K): boolean
  keys(): Iterable<K>
  values(): Iterable<V>
  entries(): Iterable<[K, V]>
  isEmpty(): boolean
  size(): number
  clear(): void
}

/**
 * Reducing state interface
 */
export interface ReducingState<T> {
  get(): T | null
  add(value: T): void
  clear(): void
}

/**
 * Aggregating state interface
 */
export interface AggregatingState<IN, OUT> {
  get(): OUT | null
  add(value: IN): void
  clear(): void
}

// State implementations
class ValueStateImpl<T> implements ValueState<T> {
  constructor(
    private readonly stateStore: Map<string, any>,
    private readonly name: string,
    private readonly defaultValue: T | null
  ) {}

  value(): T | null {
    return this.stateStore.has(this.name) ? this.stateStore.get(this.name) : this.defaultValue
  }

  update(value: T): void {
    this.stateStore.set(this.name, value)
  }

  clear(): void {
    this.stateStore.delete(this.name)
  }
}

class ListStateImpl<T> implements ListState<T> {
  constructor(
    private readonly stateStore: Map<string, any>,
    private readonly name: string
  ) {
    if (!this.stateStore.has(this.name)) {
      this.stateStore.set(this.name, [])
    }
  }

  get(): Iterable<T> {
    return this.stateStore.get(this.name) ?? []
  }

  add(value: T): void {
    const list = this.stateStore.get(this.name) ?? []
    list.push(value)
    this.stateStore.set(this.name, list)
  }

  addAll(values: T[]): void {
    const list = this.stateStore.get(this.name) ?? []
    list.push(...values)
    this.stateStore.set(this.name, list)
  }

  update(values: T[]): void {
    this.stateStore.set(this.name, [...values])
  }

  clear(): void {
    this.stateStore.set(this.name, [])
  }
}

class MapStateImpl<K, V> implements MapState<K, V> {
  constructor(
    private readonly stateStore: Map<string, any>,
    private readonly name: string
  ) {
    if (!this.stateStore.has(this.name)) {
      this.stateStore.set(this.name, new Map<K, V>())
    }
  }

  private getMap(): Map<K, V> {
    return this.stateStore.get(this.name)
  }

  get(key: K): V | undefined {
    return this.getMap().get(key)
  }

  put(key: K, value: V): void {
    this.getMap().set(key, value)
  }

  putAll(map: Map<K, V>): void {
    for (const [k, v] of map) {
      this.getMap().set(k, v)
    }
  }

  remove(key: K): void {
    this.getMap().delete(key)
  }

  contains(key: K): boolean {
    return this.getMap().has(key)
  }

  keys(): Iterable<K> {
    return this.getMap().keys()
  }

  values(): Iterable<V> {
    return this.getMap().values()
  }

  entries(): Iterable<[K, V]> {
    return this.getMap().entries()
  }

  isEmpty(): boolean {
    return this.getMap().size === 0
  }

  size(): number {
    return this.getMap().size
  }

  clear(): void {
    this.getMap().clear()
  }
}

class ReducingStateImpl<T> implements ReducingState<T> {
  constructor(
    private readonly stateStore: Map<string, any>,
    private readonly name: string,
    private readonly reduceFunction: (a: T, b: T) => T,
    private readonly defaultValue: T | null
  ) {}

  get(): T | null {
    return this.stateStore.has(this.name) ? this.stateStore.get(this.name) : this.defaultValue
  }

  add(value: T): void {
    const current = this.get()
    if (current === null) {
      this.stateStore.set(this.name, value)
    } else {
      this.stateStore.set(this.name, this.reduceFunction(current, value))
    }
  }

  clear(): void {
    this.stateStore.delete(this.name)
  }
}

class AggregatingStateImpl<IN, ACC, OUT> implements AggregatingState<IN, OUT> {
  constructor(
    private readonly stateStore: Map<string, any>,
    private readonly name: string,
    private readonly aggregateFunction: AggregateFunction<IN, ACC, OUT>
  ) {
    if (!this.stateStore.has(this.name)) {
      this.stateStore.set(this.name, this.aggregateFunction.createAccumulator())
    }
  }

  get(): OUT | null {
    const acc = this.stateStore.get(this.name)
    return acc !== undefined ? this.aggregateFunction.getResult(acc) : null
  }

  add(value: IN): void {
    const acc = this.stateStore.get(this.name) ?? this.aggregateFunction.createAccumulator()
    this.stateStore.set(this.name, this.aggregateFunction.add(value, acc))
  }

  clear(): void {
    this.stateStore.set(this.name, this.aggregateFunction.createAccumulator())
  }
}

// ===========================================================================
// Runtime Context
// ===========================================================================

/**
 * Runtime context for accessing state and configuration
 */
export interface RuntimeContext {
  getNumberOfParallelSubtasks(): number
  getIndexOfThisSubtask(): number
  getState<T>(descriptor: ValueStateDescriptor<T>): ValueState<T>
  getListState<T>(descriptor: ListStateDescriptor<T>): ListState<T>
  getMapState<K, V>(descriptor: MapStateDescriptor<K, V>): MapState<K, V>
  getReducingState<T>(descriptor: ReducingStateDescriptor<T>): ReducingState<T>
  getAggregatingState<IN, ACC, OUT>(descriptor: AggregatingStateDescriptor<IN, ACC, OUT>): AggregatingState<IN, OUT>
}

class RuntimeContextImpl implements RuntimeContext {
  constructor(
    private readonly stateStore: Map<string, any>,
    private readonly parallelism: number = 1,
    private readonly subtaskIndex: number = 0
  ) {}

  getNumberOfParallelSubtasks(): number {
    return this.parallelism
  }

  getIndexOfThisSubtask(): number {
    return this.subtaskIndex
  }

  getState<T>(descriptor: ValueStateDescriptor<T>): ValueState<T> {
    return new ValueStateImpl<T>(this.stateStore, descriptor.name, descriptor.defaultValue)
  }

  getListState<T>(descriptor: ListStateDescriptor<T>): ListState<T> {
    return new ListStateImpl<T>(this.stateStore, descriptor.name)
  }

  getMapState<K, V>(descriptor: MapStateDescriptor<K, V>): MapState<K, V> {
    return new MapStateImpl<K, V>(this.stateStore, descriptor.name)
  }

  getReducingState<T>(descriptor: ReducingStateDescriptor<T>): ReducingState<T> {
    return new ReducingStateImpl<T>(
      this.stateStore,
      descriptor.name,
      descriptor.reduceFunction,
      descriptor.defaultValue
    )
  }

  getAggregatingState<IN, ACC, OUT>(descriptor: AggregatingStateDescriptor<IN, ACC, OUT>): AggregatingState<IN, OUT> {
    return new AggregatingStateImpl<IN, ACC, OUT>(
      this.stateStore,
      descriptor.name,
      descriptor.aggregateFunction
    )
  }
}

// ===========================================================================
// Timer Service
// ===========================================================================

/**
 * Timer service for registering timers
 */
export interface TimerService {
  currentProcessingTime(): number
  currentWatermark(): number
  registerEventTimeTimer(time: number): void
  registerProcessingTimeTimer(time: number): void
  deleteEventTimeTimer(time: number): void
  deleteProcessingTimeTimer(time: number): void
}

class TimerServiceImpl implements TimerService {
  private watermark = Number.MIN_SAFE_INTEGER
  private eventTimeTimers: Set<number> = new Set()
  private processingTimeTimers: Set<number> = new Set()
  private timerCallbacks: Map<number, () => void> = new Map()

  currentProcessingTime(): number {
    return Date.now()
  }

  currentWatermark(): number {
    return this.watermark
  }

  setWatermark(watermark: number): void {
    this.watermark = watermark
  }

  registerEventTimeTimer(time: number): void {
    this.eventTimeTimers.add(time)
  }

  registerProcessingTimeTimer(time: number): void {
    this.processingTimeTimers.add(time)
  }

  deleteEventTimeTimer(time: number): void {
    this.eventTimeTimers.delete(time)
  }

  deleteProcessingTimeTimer(time: number): void {
    this.processingTimeTimers.delete(time)
  }

  getEventTimeTimers(): Set<number> {
    return this.eventTimeTimers
  }

  getProcessingTimeTimers(): Set<number> {
    return this.processingTimeTimers
  }

  fireEventTimeTimers(currentWatermark: number): number[] {
    const fired: number[] = []
    for (const time of this.eventTimeTimers) {
      if (time <= currentWatermark) {
        fired.push(time)
      }
    }
    for (const time of fired) {
      this.eventTimeTimers.delete(time)
    }
    return fired
  }
}

// ===========================================================================
// Context Types
// ===========================================================================

/**
 * Process function context
 */
export interface Context {
  timestamp(): number | null
  timerService(): TimerService
  output<T>(tag: OutputTag<T>, value: T): void
}

/**
 * On timer context
 */
export interface OnTimerContext extends Context {
  timeDomain(): 'EVENT_TIME' | 'PROCESSING_TIME'
}

/**
 * Collector for outputting results
 */
export interface Collector<T> {
  collect(value: T): void
  close(): void
}

class CollectorImpl<T> implements Collector<T> {
  private results: T[] = []

  collect(value: T): void {
    this.results.push(value)
  }

  close(): void {}

  getResults(): T[] {
    return this.results
  }
}

// ===========================================================================
// Function Interfaces
// ===========================================================================

/**
 * Map function interface
 */
export interface MapFunction<T, R> {
  map(value: T, ctx?: RuntimeContext): R
}

/**
 * FlatMap function interface
 */
export interface FlatMapFunction<T, R> {
  flatMap(value: T, out: Collector<R>): void
}

/**
 * Filter function interface
 */
export interface FilterFunction<T> {
  filter(value: T): boolean
}

/**
 * Key selector function
 */
export interface KeySelector<T, K> {
  getKey(value: T): K
}

/**
 * Reduce function interface
 */
export interface ReduceFunction<T> {
  reduce(value1: T, value2: T): T
}

/**
 * Aggregate function interface
 */
export interface AggregateFunction<IN, ACC, OUT> {
  createAccumulator(): ACC
  add(value: IN, accumulator: ACC): ACC
  getResult(accumulator: ACC): OUT
  merge(a: ACC, b: ACC): ACC
}

/**
 * Window function interface
 */
export interface WindowFunction<IN, OUT, KEY> {
  apply(key: KEY, window: TimeWindow, elements: Iterable<IN>, out: Collector<OUT>): void
}

/**
 * Process window function interface
 */
export interface ProcessWindowFunction<IN, OUT, KEY> {
  process(key: KEY, context: ProcessWindowFunctionContext, elements: Iterable<IN>, out: Collector<OUT>): void
}

export interface ProcessWindowFunctionContext {
  window(): TimeWindow
  currentProcessingTime(): number
  currentWatermark(): number
}

// ===========================================================================
// Process Functions
// ===========================================================================

/**
 * Base process function class
 */
export abstract class ProcessFunction<I, O> {
  open?(context: RuntimeContext): void
  close?(): void
  abstract processElement(value: I, ctx: Context, out: Collector<O>): void
  onTimer?(timestamp: number, ctx: OnTimerContext, out: Collector<O>): void
}

/**
 * Keyed process function
 */
export abstract class KeyedProcessFunction<K, I, O> {
  open?(context: RuntimeContext): void
  close?(): void
  abstract processElement(value: I, ctx: Context, out: Collector<O>): void
  onTimer?(timestamp: number, ctx: OnTimerContext, out: Collector<O>): void
}

/**
 * Co-process function for connected streams
 */
export interface CoProcessFunction<IN1, IN2, OUT> {
  processElement1(value: IN1, ctx: Context, out: Collector<OUT>): void
  processElement2(value: IN2, ctx: Context, out: Collector<OUT>): void
}

// ===========================================================================
// Output Tags (Side Outputs)
// ===========================================================================

/**
 * Output tag for side outputs
 */
export class OutputTag<T> {
  constructor(public readonly id: string) {}
}

// ===========================================================================
// Connectors
// ===========================================================================

/**
 * Source interface
 */
export interface Source<T> {
  getBoundedness(): 'BOUNDED' | 'CONTINUOUS_UNBOUNDED'
  createReader(): SourceReader<T>
}

/**
 * Source reader interface
 */
export interface SourceReader<T> {
  start(): void
  pollNext(): T | null
  close(): void
}

/**
 * Source function interface
 */
export interface SourceFunction<T> {
  run(ctx: { collect: (value: T) => void }): void
  cancel(): void
}

/**
 * Rich source function with lifecycle
 */
export abstract class RichSourceFunction<T> implements SourceFunction<T> {
  open?(parameters: any): void
  abstract run(ctx: { collect: (value: T) => void }): void
  abstract cancel(): void
  close?(): void
}

/**
 * Sink interface
 */
export interface Sink<T> {
  write(element: T): void
  flush(): void
  close(): void
}

/**
 * Sink function interface
 */
export interface SinkFunction<T> {
  invoke(value: T): void
}

/**
 * Rich sink function with lifecycle
 */
export abstract class RichSinkFunction<T> implements SinkFunction<T> {
  open?(parameters: any): void
  abstract invoke(value: T): void
  close?(): void
}

// ===========================================================================
// Checkpointing
// ===========================================================================

/**
 * Checkpointing mode
 */
export enum CheckpointingMode {
  EXACTLY_ONCE = 'EXACTLY_ONCE',
  AT_LEAST_ONCE = 'AT_LEAST_ONCE',
}

/**
 * Checkpoint storage
 */
export class CheckpointStorage {
  constructor(public readonly uri: string) {}
}

/**
 * State backend
 */
export class StateBackend {
  constructor(public readonly type: string) {}
}

/**
 * Checkpoint configuration
 */
export class CheckpointConfig {
  private checkpointInterval: number = 0
  private checkpointingMode: CheckpointingMode = CheckpointingMode.EXACTLY_ONCE
  private checkpointTimeout: number = 600000
  private minPauseBetweenCheckpoints: number = 0
  private maxConcurrentCheckpoints: number = 1
  private unalignedCheckpoints: boolean = false
  private externalizedCleanup: CheckpointConfig.ExternalizedCheckpointCleanup =
    CheckpointConfig.ExternalizedCheckpointCleanup.DELETE_ON_CANCELLATION
  private storage?: CheckpointStorage
  private tolerableFailures: number = 0
  private maxRetained: number = 5
  private historySize: number = 10
  private expirationTime: number = 0
  private localRecovery: boolean = false
  private localRecoveryPath: string = ''

  setCheckpointInterval(interval: number): void {
    this.checkpointInterval = interval
  }

  getCheckpointInterval(): number {
    return this.checkpointInterval
  }

  setCheckpointingMode(mode: CheckpointingMode): void {
    this.checkpointingMode = mode
  }

  getCheckpointingMode(): CheckpointingMode {
    return this.checkpointingMode
  }

  setCheckpointTimeout(timeout: number): void {
    this.checkpointTimeout = timeout
  }

  getCheckpointTimeout(): number {
    return this.checkpointTimeout
  }

  setMinPauseBetweenCheckpoints(pause: number): void {
    this.minPauseBetweenCheckpoints = pause
  }

  getMinPauseBetweenCheckpoints(): number {
    return this.minPauseBetweenCheckpoints
  }

  setMaxConcurrentCheckpoints(max: number): void {
    this.maxConcurrentCheckpoints = max
  }

  getMaxConcurrentCheckpoints(): number {
    return this.maxConcurrentCheckpoints
  }

  enableUnalignedCheckpoints(): void {
    this.unalignedCheckpoints = true
  }

  isUnalignedCheckpointsEnabled(): boolean {
    return this.unalignedCheckpoints
  }

  setExternalizedCheckpointCleanup(cleanup: CheckpointConfig.ExternalizedCheckpointCleanup): void {
    this.externalizedCleanup = cleanup
  }

  getExternalizedCheckpointCleanup(): CheckpointConfig.ExternalizedCheckpointCleanup {
    return this.externalizedCleanup
  }

  setCheckpointStorage(storage: CheckpointStorage): void {
    this.storage = storage
  }

  getCheckpointStorage(): CheckpointStorage | undefined {
    return this.storage
  }

  // Additional methods for new tests

  setTolerableCheckpointFailureNumber(failures: number): void {
    this.tolerableFailures = failures
  }

  getTolerableCheckpointFailureNumber(): number {
    return this.tolerableFailures
  }

  setMaxRetainedCheckpoints(max: number): void {
    this.maxRetained = max
  }

  getMaxRetainedCheckpoints(): number {
    return this.maxRetained
  }

  setCheckpointHistorySize(size: number): void {
    this.historySize = size
  }

  getCheckpointHistorySize(): number {
    return this.historySize
  }

  setCheckpointExpirationTime(time: number): void {
    this.expirationTime = time
  }

  getCheckpointExpirationTime(): number {
    return this.expirationTime
  }

  enableLocalRecovery(enabled: boolean): void {
    this.localRecovery = enabled
  }

  isLocalRecoveryEnabled(): boolean {
    return this.localRecovery
  }

  setLocalRecoveryPath(path: string): void {
    this.localRecoveryPath = path
  }

  getLocalRecoveryPath(): string {
    return this.localRecoveryPath
  }
}

export namespace CheckpointConfig {
  export enum ExternalizedCheckpointCleanup {
    DELETE_ON_CANCELLATION = 'DELETE_ON_CANCELLATION',
    RETAIN_ON_CANCELLATION = 'RETAIN_ON_CANCELLATION',
    NO_EXTERNALIZED_CHECKPOINTS = 'NO_EXTERNALIZED_CHECKPOINTS',
  }
}

// ===========================================================================
// Job Execution Result
// ===========================================================================

/**
 * Job execution result
 */
export class JobExecutionResult {
  constructor(
    private readonly jobName: string,
    private readonly netRuntime: number = 0
  ) {}

  getJobName(): string {
    return this.jobName
  }

  getNetRuntime(): number {
    return this.netRuntime
  }
}

// ===========================================================================
// DataStream
// ===========================================================================

/**
 * Main DataStream class
 */
export class DataStream<T> {
  protected elements: T[] = []
  protected timestampAssigner?: (element: T) => number
  protected watermarkGenerator?: WatermarkGenerator<T>
  private parallelismValue: number = 1
  protected sinks: SinkFunction<any>[] = []
  protected printEnabled: boolean = false
  protected printIdentifier?: string
  protected writeFilePath?: string
  protected sideOutputs = new Map<string, any[]>()

  constructor(
    protected env: StreamExecutionEnvironment,
    elements: T[] = []
  ) {
    this.elements = [...elements]
  }

  /**
   * Set parallelism for this operator
   */
  setParallelism(parallelism: number): DataStream<T> {
    this.parallelismValue = parallelism
    return this
  }

  /**
   * Get parallelism
   */
  getParallelism(): number {
    return this.parallelismValue
  }

  /**
   * Map transformation
   */
  map<R>(mapper: ((value: T) => R) | MapFunction<T, R>): DataStream<R> {
    const isMapFunctionObject = typeof mapper === 'object' && mapper !== null && 'map' in mapper
    const stateStore = new Map<string, any>()
    const runtimeCtx = new RuntimeContextImpl(stateStore, this.parallelismValue, 0)

    // Call open lifecycle if present
    if (isMapFunctionObject) {
      const richMapper = mapper as { open?: (ctx: RuntimeContext) => void; close?: () => void; map: (value: T, ctx?: RuntimeContext) => R }
      if (richMapper.open) {
        richMapper.open(runtimeCtx)
      }
    }

    const mapFn = typeof mapper === 'function' ? mapper : (v: T) => (mapper as any).map(v, runtimeCtx)
    const newElements = this.elements.map(mapFn)

    // Call close lifecycle if present
    if (isMapFunctionObject) {
      const richMapper = mapper as { open?: (ctx: RuntimeContext) => void; close?: () => void; map: (value: T, ctx?: RuntimeContext) => R }
      if (richMapper.close) {
        richMapper.close()
      }
    }

    const newStream = new DataStream<R>(this.env, newElements)
    newStream.timestampAssigner = this.timestampAssigner as any
    newStream.watermarkGenerator = this.watermarkGenerator as any
    return newStream
  }

  /**
   * FlatMap transformation
   */
  flatMap<R>(flatMapper: ((value: T, out: Collector<R>) => void) | FlatMapFunction<T, R>): DataStream<R> {
    const flatMapFn =
      typeof flatMapper === 'function' ? flatMapper : (v: T, out: Collector<R>) => flatMapper.flatMap(v, out)

    const results: R[] = []
    for (const element of this.elements) {
      const collector = new CollectorImpl<R>()
      flatMapFn(element, collector)
      results.push(...collector.getResults())
    }

    const newStream = new DataStream<R>(this.env, results)
    newStream.timestampAssigner = this.timestampAssigner as any
    newStream.watermarkGenerator = this.watermarkGenerator as any
    return newStream
  }

  /**
   * Filter transformation
   */
  filter(predicate: ((value: T) => boolean) | FilterFunction<T>): DataStream<T> {
    const filterFn = typeof predicate === 'function' ? predicate : (v: T) => predicate.filter(v)
    const newElements = this.elements.filter(filterFn)
    const newStream = new DataStream<T>(this.env, newElements)
    newStream.timestampAssigner = this.timestampAssigner
    newStream.watermarkGenerator = this.watermarkGenerator
    return newStream
  }

  /**
   * Key by transformation - creates a KeyedStream
   */
  keyBy<K>(keySelector: ((value: T) => K) | keyof T): KeyedStream<T, K> {
    const selector: (value: T) => K =
      typeof keySelector === 'function' ? keySelector : (v: T) => v[keySelector] as unknown as K

    return new KeyedStream<T, K>(this.env, this.elements, selector, this.timestampAssigner, this.watermarkGenerator)
  }

  /**
   * Process with a ProcessFunction
   */
  process<R>(processFunction: ProcessFunction<T, R>): DataStream<R> {
    const results: R[] = []
    const sideOutputsLocal = new Map<string, any[]>()
    const stateStore = new Map<string, any>()
    const runtimeCtx = new RuntimeContextImpl(stateStore, this.parallelismValue, 0)
    const timerService = new TimerServiceImpl()

    if (processFunction.open) {
      processFunction.open(runtimeCtx)
    }

    for (const element of this.elements) {
      const timestamp = this.timestampAssigner ? this.timestampAssigner(element) : null
      const ctx: Context = {
        timestamp: () => timestamp,
        timerService: () => timerService,
        output: <O>(tag: OutputTag<O>, value: O) => {
          if (!sideOutputsLocal.has(tag.id)) {
            sideOutputsLocal.set(tag.id, [])
          }
          sideOutputsLocal.get(tag.id)!.push(value)
        },
      }

      const collector = new CollectorImpl<R>()
      processFunction.processElement(element, ctx, collector)
      results.push(...collector.getResults())
    }

    if (processFunction.close) {
      processFunction.close()
    }

    const newStream = new DataStream<R>(this.env, results)
    newStream.sideOutputs = sideOutputsLocal
    return newStream
  }

  /**
   * Get side output
   */
  getSideOutput<O>(tag: OutputTag<O>): DataStream<O> {
    const elements = this.sideOutputs.get(tag.id) ?? []
    return new DataStream<O>(this.env, elements)
  }

  /**
   * Assign timestamps and watermarks
   */
  assignTimestampsAndWatermarks(strategy: WatermarkStrategy<T>): DataStream<T> {
    const newStream = new DataStream<T>(this.env, this.elements)
    newStream.timestampAssigner = strategy.getTimestampAssigner()
    newStream.watermarkGenerator = strategy.createWatermarkGenerator()
    return newStream
  }

  /**
   * Union multiple streams
   */
  union(...streams: DataStream<T>[]): DataStream<T> {
    const allElements = [...this.elements]
    for (const stream of streams) {
      allElements.push(...stream.elements)
    }
    return new DataStream<T>(this.env, allElements)
  }

  /**
   * Connect with another stream
   */
  connect<T2>(other: DataStream<T2>): ConnectedStreams<T, T2> {
    return new ConnectedStreams<T, T2>(this.env, this, other)
  }

  /**
   * Shuffle partitioning
   */
  shuffle(): DataStream<T> {
    const shuffled = [...this.elements].sort(() => Math.random() - 0.5)
    const newStream = new DataStream<T>(this.env, shuffled)
    newStream.timestampAssigner = this.timestampAssigner
    newStream.watermarkGenerator = this.watermarkGenerator
    return newStream
  }

  /**
   * Rebalance partitioning
   */
  rebalance(): DataStream<T> {
    return new DataStream<T>(this.env, [...this.elements])
  }

  /**
   * Rescale partitioning
   */
  rescale(): DataStream<T> {
    return new DataStream<T>(this.env, [...this.elements])
  }

  /**
   * Broadcast to all parallel instances
   */
  broadcast(): DataStream<T> {
    return new DataStream<T>(this.env, [...this.elements])
  }

  /**
   * Custom partitioning
   */
  partitionCustom<K>(
    partitioner: { partition: (key: K, numPartitions: number) => number },
    keySelector: (value: T) => K
  ): DataStream<T> {
    return new DataStream<T>(this.env, [...this.elements])
  }

  /**
   * Add a sink
   */
  addSink(sink: SinkFunction<T>): void {
    this.sinks.push(sink)
    this.env.registerSink(this, sink)
  }

  /**
   * Print to stdout
   */
  print(identifier?: string): void {
    this.printEnabled = true
    this.printIdentifier = identifier
    this.env.registerPrint(this, identifier)
  }

  /**
   * Write as text file
   */
  writeAsText(path: string): void {
    this.writeFilePath = path
    this.env.registerWriteAsText(this, path)
  }

  /**
   * Get elements (for testing)
   */
  getElements(): T[] {
    return this.elements
  }

  /**
   * Set operator UID for savepoint compatibility
   */
  uid(uid: string): DataStream<T> {
    // Store UID for savepoint compatibility
    return this
  }

  /**
   * Iterate on the stream - creates an IterativeStream for iterative algorithms
   */
  iterate(maxIterationsOrOptions?: number | { maxIterations?: number; timeout?: number }): IterativeStream<T> {
    let maxIterations = 1000
    let timeout: number | undefined

    if (typeof maxIterationsOrOptions === 'number') {
      maxIterations = maxIterationsOrOptions
    } else if (maxIterationsOrOptions) {
      maxIterations = maxIterationsOrOptions.maxIterations ?? 1000
      timeout = maxIterationsOrOptions.timeout
    }

    return new IterativeStream<T>(this.env, this.elements, maxIterations, timeout)
  }
}

// ===========================================================================
// IterativeStream
// ===========================================================================

/**
 * Iterative stream for running iterative algorithms
 */
export class IterativeStream<T> {
  private feedbackStream?: DataStream<T>
  private bodyStream: DataStream<T>
  private outputElements: T[] = []

  constructor(
    private env: StreamExecutionEnvironment,
    private elements: T[],
    private maxIterations: number = 1000,
    private timeout?: number
  ) {
    // Create the body stream which acts as the iteration input
    this.bodyStream = new DataStream<T>(this.env, [...this.elements])
  }

  /**
   * Get the body of the iteration - the stream to transform
   */
  getBody(): DataStream<T> {
    return this.bodyStream
  }

  /**
   * Close the iteration with a feedback stream
   * Elements in feedback continue iterating, elements not in feedback are output
   */
  closeWith(feedbackStream: DataStream<T>): void {
    this.feedbackStream = feedbackStream
    // The actual iteration execution happens when results are collected
    // Store reference to feedback for later processing
  }

  /**
   * Get the output elements after iteration
   */
  getOutputElements(): T[] {
    return this.outputElements
  }
}

// ===========================================================================
// KeyedStream
// ===========================================================================

/**
 * Keyed stream for stateful operations
 */
export class KeyedStream<T, K> extends DataStream<T> {
  private keySelector: (value: T) => K

  constructor(
    env: StreamExecutionEnvironment,
    elements: T[],
    keySelector: (value: T) => K,
    timestampAssigner?: (element: T) => number,
    watermarkGenerator?: WatermarkGenerator<T>
  ) {
    super(env, elements)
    this.keySelector = keySelector
    this.timestampAssigner = timestampAssigner
    this.watermarkGenerator = watermarkGenerator
  }

  /**
   * Reduce operation
   */
  reduce(reducer: ((a: T, b: T) => T) | ReduceFunction<T>): DataStream<T> {
    const reduceFn = typeof reducer === 'function' ? reducer : (a: T, b: T) => reducer.reduce(a, b)

    // Group by key
    const groups = new Map<string, T[]>()
    for (const element of this.elements) {
      const key = String(this.keySelector(element))
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(element)
    }

    // Reduce each group
    const results: T[] = []
    for (const elements of groups.values()) {
      if (elements.length > 0) {
        let acc = elements[0]!
        for (let i = 1; i < elements.length; i++) {
          acc = reduceFn(acc, elements[i]!)
        }
        results.push(acc)
      }
    }

    return new DataStream<T>(this.env, results)
  }

  /**
   * Sum by field
   */
  sum(field: keyof T | number): DataStream<T> {
    return this.reduce((a, b) => {
      const result = { ...a }
      if (typeof field === 'string') {
        ;(result as any)[field] = (a as any)[field] + (b as any)[field]
      }
      return result
    })
  }

  /**
   * Window operation
   */
  window<W extends TimeWindow>(assigner: WindowAssigner<T, W>): WindowedStream<T, K, W> {
    return new WindowedStream<T, K, W>(this.env, this.elements, this.keySelector, assigner, this.timestampAssigner, this.watermarkGenerator)
  }

  /**
   * Process with KeyedProcessFunction
   */
  process<R>(processFunction: KeyedProcessFunction<K, T, R>): DataStream<R> {
    const results: R[] = []
    const sideOutputsLocal = new Map<string, any[]>()
    const keyedStates = new Map<string, Map<string, any>>()
    const timerServices = new Map<string, TimerServiceImpl>()

    // Group by key
    const groups = new Map<string, T[]>()
    for (const element of this.elements) {
      const key = String(this.keySelector(element))
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(element)
    }

    // Process each key group
    for (const [key, elements] of groups) {
      if (!keyedStates.has(key)) {
        keyedStates.set(key, new Map())
      }
      if (!timerServices.has(key)) {
        timerServices.set(key, new TimerServiceImpl())
      }

      const stateStore = keyedStates.get(key)!
      const timerService = timerServices.get(key)!
      const runtimeCtx = new RuntimeContextImpl(stateStore, this.getParallelism(), 0)

      if (processFunction.open) {
        processFunction.open(runtimeCtx)
      }

      let maxWatermark = Number.MIN_SAFE_INTEGER

      for (const element of elements) {
        const timestamp = this.timestampAssigner ? this.timestampAssigner(element) : null
        if (timestamp !== null) {
          maxWatermark = Math.max(maxWatermark, timestamp)
          timerService.setWatermark(maxWatermark)
        }

        const ctx: Context = {
          timestamp: () => timestamp,
          timerService: () => timerService,
          output: <O>(tag: OutputTag<O>, value: O) => {
            if (!sideOutputsLocal.has(tag.id)) {
              sideOutputsLocal.set(tag.id, [])
            }
            sideOutputsLocal.get(tag.id)!.push(value)
          },
        }

        const collector = new CollectorImpl<R>()
        processFunction.processElement(element, ctx, collector)
        results.push(...collector.getResults())

        // Check for expired event time timers
        if (processFunction.onTimer) {
          const firedTimers = timerService.fireEventTimeTimers(maxWatermark)
          for (const timerTime of firedTimers) {
            const timerCtx: OnTimerContext = {
              timestamp: () => timerTime,
              timerService: () => timerService,
              timeDomain: () => 'EVENT_TIME',
              output: <O>(tag: OutputTag<O>, value: O) => {
                if (!sideOutputsLocal.has(tag.id)) {
                  sideOutputsLocal.set(tag.id, [])
                }
                sideOutputsLocal.get(tag.id)!.push(value)
              },
            }
            const timerCollector = new CollectorImpl<R>()
            processFunction.onTimer(timerTime, timerCtx, timerCollector)
            results.push(...timerCollector.getResults())
          }
        }
      }

      // Fire remaining event time timers after all elements processed
      if (processFunction.onTimer) {
        const firedTimers = timerService.fireEventTimeTimers(Number.MAX_SAFE_INTEGER)
        for (const timerTime of firedTimers) {
          const timerCtx: OnTimerContext = {
            timestamp: () => timerTime,
            timerService: () => timerService,
            timeDomain: () => 'EVENT_TIME',
            output: <O>(tag: OutputTag<O>, value: O) => {
              if (!sideOutputsLocal.has(tag.id)) {
                sideOutputsLocal.set(tag.id, [])
              }
              sideOutputsLocal.get(tag.id)!.push(value)
            },
          }
          const timerCollector = new CollectorImpl<R>()
          processFunction.onTimer(timerTime, timerCtx, timerCollector)
          results.push(...timerCollector.getResults())
        }
      }

      if (processFunction.close) {
        processFunction.close()
      }
    }

    const newStream = new DataStream<R>(this.env, results)
    newStream.sideOutputs = sideOutputsLocal
    return newStream
  }

  /**
   * Connect with another keyed stream
   */
  connect<T2>(other: KeyedStream<T2, K>): ConnectedStreams<T, T2> {
    return new ConnectedStreams<T, T2>(this.env, this, other)
  }
}

// ===========================================================================
// WindowedStream
// ===========================================================================

/**
 * Windowed stream for window operations
 */
export class WindowedStream<T, K, W extends TimeWindow> {
  private _trigger?: Trigger<T, W>
  private _evictor?: Evictor<T, W>
  private _allowedLatenessTime: Time = Time.milliseconds(0)
  private _lateDataOutputTag?: OutputTag<T>

  constructor(
    private env: StreamExecutionEnvironment,
    private elements: T[],
    private keySelector: (value: T) => K,
    private windowAssigner: WindowAssigner<T, W>,
    private timestampAssigner?: (element: T) => number,
    private watermarkGenerator?: WatermarkGenerator<T>
  ) {}

  /**
   * Set trigger
   */
  trigger(trigger: Trigger<T, W>): WindowedStream<T, K, W> {
    this._trigger = trigger
    return this
  }

  /**
   * Set evictor
   */
  evictor(evictor: Evictor<T, W>): WindowedStream<T, K, W> {
    this._evictor = evictor
    return this
  }

  /**
   * Set allowed lateness
   */
  allowedLateness(lateness: Time): WindowedStream<T, K, W> {
    this._allowedLatenessTime = lateness
    return this
  }

  /**
   * Set late data output tag
   */
  sideOutputLateData(tag: OutputTag<T>): WindowedStream<T, K, W> {
    this._lateDataOutputTag = tag
    return this
  }

  /**
   * Reduce operation
   */
  reduce(reducer: ((a: T, b: T) => T) | ReduceFunction<T>): DataStream<T> {
    const reduceFn = typeof reducer === 'function' ? reducer : (a: T, b: T) => reducer.reduce(a, b)
    return this.processWindows((elements) => {
      if (elements.length === 0) return []
      let acc = elements[0]!
      for (let i = 1; i < elements.length; i++) {
        acc = reduceFn(acc, elements[i]!)
      }
      return [acc]
    })
  }

  /**
   * Sum by field
   */
  sum(field: keyof T | number): DataStream<T> {
    return this.reduce((a, b) => {
      const result = { ...a }
      if (typeof field === 'string') {
        ;(result as any)[field] = (a as any)[field] + (b as any)[field]
      }
      return result
    })
  }

  /**
   * Apply window function
   */
  apply<R>(windowFunction: WindowFunction<T, R, K>): DataStream<R> {
    return this.processWindowsWithContext((key, window, elements, out) => {
      windowFunction.apply(key, window, elements, out)
    })
  }

  /**
   * Process with ProcessWindowFunction
   */
  process<R>(processFunction: ProcessWindowFunction<T, R, K>): DataStream<R> {
    return this.processWindowsWithContext((key, window, elements, out) => {
      const ctx: ProcessWindowFunctionContext = {
        window: () => window,
        currentProcessingTime: () => Date.now(),
        currentWatermark: () => Number.MIN_SAFE_INTEGER,
      }
      processFunction.process(key, ctx, elements, out)
    })
  }

  /**
   * Aggregate operation
   */
  aggregate<ACC, R>(aggregator: AggregateFunction<T, ACC, R>): DataStream<R> {
    return this.processWindows((elements) => {
      if (elements.length === 0) return []
      let acc = aggregator.createAccumulator()
      for (const element of elements) {
        acc = aggregator.add(element, acc)
      }
      return [aggregator.getResult(acc)]
    })
  }

  /**
   * Internal window processing
   */
  private processWindows<R>(processor: (elements: T[]) => R[]): DataStream<R> {
    // Group elements by key
    const keyGroups = new Map<string, T[]>()
    for (const element of this.elements) {
      const key = String(this.keySelector(element))
      if (!keyGroups.has(key)) {
        keyGroups.set(key, [])
      }
      keyGroups.get(key)!.push(element)
    }

    const results: R[] = []
    const activeTrigger = this._trigger ?? this.windowAssigner.getDefaultTrigger()

    for (const [key, elements] of keyGroups) {
      // Group elements by window
      const windowGroups = new Map<string, T[]>()
      const triggerStates = new Map<string, { count: number }>()

      for (const element of elements) {
        const timestamp = this.timestampAssigner ? this.timestampAssigner(element) : Date.now()
        const windows = this.windowAssigner.assignWindows(element, timestamp)

        for (const window of windows) {
          const windowKey = `${window.getStart()}-${window.getEnd()}`
          if (!windowGroups.has(windowKey)) {
            windowGroups.set(windowKey, [])
          }
          windowGroups.get(windowKey)!.push(element)

          // Check trigger
          if (!triggerStates.has(windowKey)) {
            triggerStates.set(windowKey, { count: 0 })
          }
          const triggerState = triggerStates.get(windowKey)!
          const triggerCtx: TriggerContext = {
            getCurrentWatermark: () => timestamp,
            registerEventTimeTimer: () => {},
            registerProcessingTimeTimer: () => {},
            deleteEventTimeTimer: () => {},
            deleteProcessingTimeTimer: () => {},
            getPartitionedState: <S>(descriptor: StateDescriptor<S>) => {
              return triggerState as unknown as S
            },
          }

          const result = activeTrigger.onElement(element, timestamp, window, triggerCtx)
          if (result === TriggerResult.FIRE || result === TriggerResult.FIRE_AND_PURGE) {
            // Will process in final step
          }
        }
      }

      // Process each window
      for (const [windowKey, windowElements] of windowGroups) {
        // Apply evictor if present
        if (this._evictor) {
          const [start, end] = windowKey.split('-').map(Number)
          const window = new TimeWindowImpl(start!, end!)
          const evictorCtx: EvictorContext = {
            getCurrentProcessingTime: () => Date.now(),
            getCurrentWatermark: () => start!,
          }
          this._evictor.evictBefore(windowElements, windowElements.length, window, evictorCtx)
        }

        const windowResults = processor(windowElements)
        results.push(...windowResults)
      }
    }

    return new DataStream<R>(this.env, results)
  }

  /**
   * Internal window processing with context
   */
  private processWindowsWithContext<R>(
    processor: (key: K, window: W, elements: Iterable<T>, out: Collector<R>) => void
  ): DataStream<R> {
    // Group elements by key
    const keyGroups = new Map<string, { key: K; elements: T[] }>()
    for (const element of this.elements) {
      const key = this.keySelector(element)
      const keyStr = String(key)
      if (!keyGroups.has(keyStr)) {
        keyGroups.set(keyStr, { key, elements: [] })
      }
      keyGroups.get(keyStr)!.elements.push(element)
    }

    const results: R[] = []

    for (const { key, elements } of keyGroups.values()) {
      // Group elements by window
      const windowGroups = new Map<string, { window: W; elements: T[] }>()

      for (const element of elements) {
        const timestamp = this.timestampAssigner ? this.timestampAssigner(element) : Date.now()
        const windows = this.windowAssigner.assignWindows(element, timestamp) as W[]

        for (const window of windows) {
          const windowKey = `${window.getStart()}-${window.getEnd()}`
          if (!windowGroups.has(windowKey)) {
            windowGroups.set(windowKey, { window, elements: [] })
          }
          windowGroups.get(windowKey)!.elements.push(element)
        }
      }

      // Process each window
      for (const { window, elements: windowElements } of windowGroups.values()) {
        const collector = new CollectorImpl<R>()
        processor(key, window, windowElements, collector)
        results.push(...collector.getResults())
      }
    }

    return new DataStream<R>(this.env, results)
  }
}

// ===========================================================================
// ConnectedStreams
// ===========================================================================

/**
 * Connected streams for joining
 */
export class ConnectedStreams<T1, T2> {
  constructor(
    private env: StreamExecutionEnvironment,
    private stream1: DataStream<T1>,
    private stream2: DataStream<T2>
  ) {}

  /**
   * Process connected streams
   */
  process<R>(coProcessFunction: CoProcessFunction<T1, T2, R>): DataStream<R> {
    const results: R[] = []

    // Process stream 1
    for (const element of this.stream1.getElements()) {
      const ctx: Context = {
        timestamp: () => null,
        timerService: () => new TimerServiceImpl(),
        output: () => {},
      }
      const collector = new CollectorImpl<R>()
      coProcessFunction.processElement1(element, ctx, collector)
      results.push(...collector.getResults())
    }

    // Process stream 2
    for (const element of this.stream2.getElements()) {
      const ctx: Context = {
        timestamp: () => null,
        timerService: () => new TimerServiceImpl(),
        output: () => {},
      }
      const collector = new CollectorImpl<R>()
      coProcessFunction.processElement2(element, ctx, collector)
      results.push(...collector.getResults())
    }

    return new DataStream<R>(this.env, results)
  }

  /**
   * Key connected streams
   */
  keyBy<K>(keySelector1: (value: T1) => K, keySelector2: (value: T2) => K): ConnectedStreams<T1, T2> {
    return this
  }
}

// ===========================================================================
// StreamExecutionEnvironment
// ===========================================================================

/**
 * Main execution environment
 */
/**
 * Checkpoint metrics
 */
export interface CheckpointMetrics {
  numberOfCompletedCheckpoints: number
  numberOfInProgressCheckpoints: number
  numberOfFailedCheckpoints: number
  lastCheckpointDuration: number
  lastCheckpointSize: number
  lastCheckpointRestoreTimestamp: number
}

/**
 * Metric group interface
 */
export interface MetricGroup {
  getCheckpointMetrics(): CheckpointMetrics
}

export class StreamExecutionEnvironment {
  private parallelismValue: number = 1
  private maxParallelismValue: number = 128
  private checkpointConfig = new CheckpointConfig()
  private stateBackend?: StateBackend
  private registeredSinks: Array<{ stream: DataStream<any>; sink: SinkFunction<any> }> = []
  private registeredPrints: Array<{ stream: DataStream<any>; identifier?: string }> = []
  private registeredWrites: Array<{ stream: DataStream<any>; path: string }> = []
  private changelogStateBackendEnabled: boolean = false

  protected constructor() {}

  /**
   * Get execution environment
   */
  static getExecutionEnvironment(): StreamExecutionEnvironment {
    const env = new StreamExecutionEnvironment()
    _environments.push(env)
    return env
  }

  /**
   * Create local environment
   */
  static createLocalEnvironment(): LocalStreamEnvironment {
    const env = new LocalStreamEnvironment()
    _environments.push(env)
    return env
  }

  /**
   * Set parallelism
   */
  setParallelism(parallelism: number): StreamExecutionEnvironment {
    this.parallelismValue = parallelism
    return this
  }

  /**
   * Get parallelism
   */
  getParallelism(): number {
    return this.parallelismValue
  }

  /**
   * Set max parallelism
   */
  setMaxParallelism(maxParallelism: number): StreamExecutionEnvironment {
    this.maxParallelismValue = maxParallelism
    return this
  }

  /**
   * Get max parallelism
   */
  getMaxParallelism(): number {
    return this.maxParallelismValue
  }

  /**
   * Enable checkpointing
   */
  enableCheckpointing(interval: number, mode?: CheckpointingMode): StreamExecutionEnvironment {
    this.checkpointConfig.setCheckpointInterval(interval)
    if (mode) {
      this.checkpointConfig.setCheckpointingMode(mode)
    }
    return this
  }

  /**
   * Get checkpoint config
   */
  getCheckpointConfig(): CheckpointConfig {
    return this.checkpointConfig
  }

  /**
   * Set state backend
   */
  setStateBackend(backend: StateBackend): StreamExecutionEnvironment {
    this.stateBackend = backend
    return this
  }

  /**
   * Get state backend
   */
  getStateBackend(): StateBackend | undefined {
    return this.stateBackend
  }

  /**
   * Enable changelog state backend
   */
  enableChangelogStateBackend(enabled: boolean): StreamExecutionEnvironment {
    this.changelogStateBackendEnabled = enabled
    return this
  }

  /**
   * Check if changelog state backend is enabled
   */
  isChangelogStateBackendEnabled(): boolean {
    return this.changelogStateBackendEnabled
  }

  /**
   * Get metric group
   */
  getMetricGroup(): MetricGroup {
    return {
      getCheckpointMetrics: () => ({
        numberOfCompletedCheckpoints: 0,
        numberOfInProgressCheckpoints: 0,
        numberOfFailedCheckpoints: 0,
        lastCheckpointDuration: 0,
        lastCheckpointSize: 0,
        lastCheckpointRestoreTimestamp: 0,
      }),
    }
  }

  /**
   * Restore from savepoint
   */
  async restore(settings: any): Promise<void> {
    throw new Error('Not implemented')
  }

  /**
   * Create stream from elements
   */
  fromElements<T>(...elements: T[]): DataStream<T> {
    return new DataStream<T>(this, elements)
  }

  /**
   * Create stream from collection
   */
  fromCollection<T>(collection: T[]): DataStream<T> {
    return new DataStream<T>(this, [...collection])
  }

  /**
   * Add custom source
   */
  addSource<T>(source: SourceFunction<T>): DataStream<T> {
    const elements: T[] = []
    let running = true

    const ctx = {
      collect: (value: T) => {
        if (running) {
          elements.push(value)
        }
      },
    }

    // Handle lifecycle for RichSourceFunction
    const richSource = source as RichSourceFunction<T>
    if (richSource.open) {
      richSource.open({})
    }

    // Run source synchronously for now
    source.run(ctx)

    // Handle close lifecycle
    if (richSource.close) {
      richSource.close()
    }

    return new DataStream<T>(this, elements)
  }

  /**
   * Create stream from Source interface
   */
  fromSource<T>(source: Source<T>, strategy: WatermarkStrategy<T>, sourceName: string): DataStream<T> {
    const elements: T[] = []
    const reader = source.createReader()
    reader.start()

    // Read all elements
    let element: T | null
    while ((element = reader.pollNext()) !== null) {
      elements.push(element)
    }

    reader.close()

    const stream = new DataStream<T>(this, elements)
    return stream.assignTimestampsAndWatermarks(strategy)
  }

  /**
   * Generate sequence
   */
  generateSequence(from: number, to: number): DataStream<number> {
    const elements: number[] = []
    for (let i = from; i <= to; i++) {
      elements.push(i)
    }
    return new DataStream<number>(this, elements)
  }

  /**
   * Create socket text stream
   */
  socketTextStream(hostname: string, port: number): DataStream<string> {
    // Stub - would connect to socket in real implementation
    return new DataStream<string>(this, [])
  }

  /**
   * Register a sink
   */
  registerSink(stream: DataStream<any>, sink: SinkFunction<any>): void {
    this.registeredSinks.push({ stream, sink })
  }

  /**
   * Register print
   */
  registerPrint(stream: DataStream<any>, identifier?: string): void {
    this.registeredPrints.push({ stream, identifier })
  }

  /**
   * Register write as text
   */
  registerWriteAsText(stream: DataStream<any>, path: string): void {
    this.registeredWrites.push({ stream, path })
  }

  /**
   * Execute the job
   */
  async execute(jobName: string = 'Flink Job'): Promise<JobExecutionResult> {
    const startTime = Date.now()

    // Process all registered sinks
    for (const { stream, sink } of this.registeredSinks) {
      if (sink.open) {
        ;(sink as any).open({})
      }
      for (const element of stream.getElements()) {
        // Await async sink operations
        const result = sink.invoke(element)
        if (result && typeof result === 'object' && 'then' in result) {
          await result
        }
      }
      if (sink.close) {
        ;(sink as any).close()
      }
    }

    // Process prints
    for (const { stream, identifier } of this.registeredPrints) {
      for (const element of stream.getElements()) {
        if (identifier) {
          console.log(`${identifier}> ${JSON.stringify(element)}`)
        } else {
          console.log(JSON.stringify(element))
        }
      }
    }

    const endTime = Date.now()
    return new JobExecutionResult(jobName, endTime - startTime)
  }
}

/**
 * Local stream environment for testing
 */
export class LocalStreamEnvironment extends StreamExecutionEnvironment {
  constructor() {
    super()
  }

  /**
   * Execute and collect results
   */
  async executeAndCollect<T>(stream: DataStream<T>): Promise<T[]> {
    return [...stream.getElements()]
  }
}

/**
 * Create test environment helper
 */
export function createTestEnvironment(): LocalStreamEnvironment {
  return StreamExecutionEnvironment.createLocalEnvironment()
}

// ===========================================================================
// Type re-exports for convenience
// ===========================================================================

// Re-export WindowReduceFunction as an alias
export { ReduceFunction as WindowReduceFunction }
