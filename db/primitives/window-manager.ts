/**
 * Window Manager - Unified Stream Windowing Inspired by Apache Flink
 *
 * Provides stream windowing capabilities for real-time analytics and event
 * processing. Supports multiple window types, flexible triggers, and late
 * data handling with watermark-based event-time semantics.
 *
 * ## Window Types
 * | Type | Description | Use Case |
 * |------|-------------|----------|
 * | Tumbling | Fixed-size, non-overlapping | Per-minute/hour aggregations |
 * | Sliding | Fixed-size, overlapping | Moving averages |
 * | Session | Gap-based, dynamic size | User sessions, activity bursts |
 * | Global | Single window for all elements | Custom triggers |
 *
 * ## Trigger Types
 * - **EventTimeTrigger** - Fire when watermark passes window end
 * - **CountTrigger** - Fire after N elements
 * - **ProcessingTimeTrigger** - Fire on wall-clock intervals
 * - **Composite** - AND/OR combinations of triggers
 *
 * ## Features
 * - **Watermarks** - Handle out-of-order events with event-time semantics
 * - **Late Data** - Allowed lateness window + side output for late arrivals
 * - **Key Extraction** - Group elements by key before windowing
 * - **Observability** - Metrics for window creation, triggers, late data
 *
 * @example Tumbling Windows
 * ```typescript
 * import { WindowManager, minutes, EventTimeTrigger } from 'dotdo/db/primitives/window-manager'
 *
 * const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
 *   .withTrigger(new EventTimeTrigger())
 *   .allowLateness(minutes(1))
 *
 * manager.onTrigger((window, elements) => {
 *   const sum = elements.reduce((acc, e) => acc + e.value, 0)
 *   console.log(`Window [${window.start}, ${window.end}): sum=${sum}`)
 * })
 *
 * // Process events
 * events.forEach(e => manager.process(e, e.timestamp))
 * manager.advanceWatermark(Date.now())
 * ```
 *
 * @example Session Windows with Key
 * ```typescript
 * const manager = new WindowManager(WindowManager.session(minutes(30)))
 *   .withKeyExtractor(event => event.userId)
 *   .withTrigger(new EventTimeTrigger())
 *
 * // Each user gets their own session windows
 * manager.process({ userId: 'alice', action: 'click' }, timestamp)
 * ```
 *
 * @example Sliding Windows with Count Trigger
 * ```typescript
 * // 10-minute window, sliding every 1 minute, trigger every 100 elements
 * const manager = new WindowManager(WindowManager.sliding(minutes(10), minutes(1)))
 *   .withTrigger(new CountTrigger(100))
 *
 * manager.onTrigger((window, elements) => {
 *   // Called when 100 elements accumulated in any window
 * })
 * ```
 *
 * @example Late Data Handling
 * ```typescript
 * const manager = new WindowManager(WindowManager.tumbling(hours(1)))
 *   .withTrigger(new EventTimeTrigger())
 *   .allowLateness(minutes(5))
 *   .sideOutputLate((element, window) => {
 *     console.log(`Late data for window ${window?.start}: ${element}`)
 *   })
 * ```
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/operators/windows/
 * @module db/primitives/window-manager
 */

import {
  DurationObject as Duration,
  hours,
  minutes,
  seconds,
  milliseconds,
} from './utils/duration'
import { type MetricsCollector, noopMetrics, MetricNames } from './observability'

// Re-export Duration type and factory functions for backwards compatibility
export type { DurationObject as Duration } from './utils/duration'
export { hours, minutes, seconds, milliseconds } from './utils/duration'

// ============================================================================
// Window Types
// ============================================================================

/**
 * Represents a time window with start and end boundaries
 */
export interface Window {
  start: number
  end: number
  key?: string
}

/**
 * State associated with a window
 */
export type WindowState<T> = T[]

/**
 * Handler for late data
 */
export type LateDataHandler<T> = (element: T, window?: Window) => void

// ============================================================================
// Window Assigners
// ============================================================================

export type WindowAssignerType = 'tumbling' | 'sliding' | 'session' | 'global'

export interface WindowAssigner<T> {
  type: WindowAssignerType
  size?: Duration
  slide?: Duration
  gap?: Duration
  assignWindows(element: T, timestamp: number, key?: string, existingWindows?: Map<string, WindowData<T>>): Window[]
}

interface WindowData<T> {
  window: Window
  elements: T[]
  triggered: boolean
  countSinceLastTrigger: number
}

// ============================================================================
// Tumbling Window Assigner
// ============================================================================

class TumblingWindowAssigner<T> implements WindowAssigner<T> {
  readonly type = 'tumbling' as const

  constructor(readonly size: Duration) {}

  assignWindows(element: T, timestamp: number): Window[] {
    const sizeMs = this.size.toMillis()
    const windowStart = Math.floor(timestamp / sizeMs) * sizeMs
    return [
      {
        start: windowStart,
        end: windowStart + sizeMs,
      },
    ]
  }
}

// ============================================================================
// Sliding Window Assigner
// ============================================================================

class SlidingWindowAssigner<T> implements WindowAssigner<T> {
  readonly type = 'sliding' as const

  constructor(
    readonly size: Duration,
    readonly slide: Duration
  ) {
    const slideMs = slide.toMillis()
    const sizeMs = size.toMillis()

    if (slideMs <= 0) {
      throw new Error('Slide must be positive')
    }
    if (slideMs > sizeMs) {
      throw new Error('Slide cannot be larger than size')
    }
  }

  assignWindows(element: T, timestamp: number): Window[] {
    const sizeMs = this.size.toMillis()
    const slideMs = this.slide.toMillis()

    const windows: Window[] = []
    // Find all windows that contain this timestamp
    // A window contains timestamp if: start <= timestamp < end
    // where end = start + size
    // So: start <= timestamp < start + size
    // Which means: timestamp - size < start <= timestamp

    // The last window start that contains this element
    const lastWindowStart = Math.floor(timestamp / slideMs) * slideMs

    // Count backwards to find all windows
    const numWindows = Math.ceil(sizeMs / slideMs)

    for (let i = 0; i < numWindows; i++) {
      const windowStart = lastWindowStart - i * slideMs
      const windowEnd = windowStart + sizeMs

      // Check if this window actually contains the timestamp
      if (windowStart <= timestamp && timestamp < windowEnd) {
        windows.push({ start: windowStart, end: windowEnd })
      }
    }

    return windows.sort((a, b) => a.start - b.start)
  }
}

// ============================================================================
// Session Window Assigner
// ============================================================================

class SessionWindowAssigner<T> implements WindowAssigner<T> {
  readonly type = 'session' as const

  constructor(readonly gap: Duration) {}

  assignWindows(
    element: T,
    timestamp: number,
    key?: string,
    existingWindows?: Map<string, WindowData<T>>
  ): Window[] {
    const gapMs = this.gap.toMillis()

    // For session windows, we need to find or create a session
    // The initial window is [timestamp, timestamp + gap)
    const newWindow: Window = {
      start: timestamp,
      end: timestamp + gapMs,
      key,
    }

    if (!existingWindows) {
      return [newWindow]
    }

    // Find overlapping or adjacent sessions to merge
    const windowsToMerge: Window[] = [newWindow]

    for (const [windowKey, windowData] of existingWindows) {
      const w = windowData.window
      if (key !== undefined && w.key !== key) continue

      // Check if windows overlap or are adjacent (within gap)
      // Two sessions should merge if the gap between them is less than the session gap
      // Session windows: [start1, end1) and [start2, end2) merge if they overlap or touch
      if (
        (newWindow.start <= w.end && newWindow.end >= w.start) || // Overlap
        Math.abs(newWindow.start - w.end) <= gapMs || // New starts within gap of existing end
        Math.abs(w.start - newWindow.end) <= gapMs // Existing starts within gap of new end
      ) {
        windowsToMerge.push(w)
      }
    }

    // Merge all overlapping windows
    if (windowsToMerge.length === 1) {
      return [newWindow]
    }

    const mergedStart = Math.min(...windowsToMerge.map((w) => w.start))
    const mergedEnd = Math.max(...windowsToMerge.map((w) => w.end))

    return [{ start: mergedStart, end: mergedEnd, key }]
  }
}

// ============================================================================
// Global Window Assigner
// ============================================================================

class GlobalWindowAssigner<T> implements WindowAssigner<T> {
  readonly type = 'global' as const

  assignWindows(): Window[] {
    return [
      {
        start: Number.MIN_SAFE_INTEGER,
        end: Number.MAX_SAFE_INTEGER,
      },
    ]
  }
}

// ============================================================================
// Trigger Types
// ============================================================================

export enum TriggerResult {
  CONTINUE = 'CONTINUE',
  FIRE = 'FIRE',
  FIRE_AND_PURGE = 'FIRE_AND_PURGE',
  PURGE = 'PURGE',
}

interface TriggerContext<T> {
  window: Window
  elements: T[]
  watermark: number
  countSinceLastTrigger: number
}

export abstract class Trigger<T = unknown> {
  abstract onElement(ctx: TriggerContext<T>): TriggerResult
  abstract onWatermark(ctx: TriggerContext<T>): TriggerResult
  abstract onProcessingTime(ctx: TriggerContext<T>): TriggerResult

  /**
   * Clean up any resources held by this trigger.
   * Subclasses should override if they hold timers or other resources.
   */
  dispose(): void {
    // Default implementation does nothing
  }

  static or<T>(...triggers: Trigger<T>[]): Trigger<T> {
    return new OrTrigger(triggers)
  }

  static and<T>(...triggers: Trigger<T>[]): Trigger<T> {
    return new AndTrigger(triggers)
  }
}

// ============================================================================
// Event Time Trigger
// ============================================================================

export class EventTimeTrigger<T = unknown> extends Trigger<T> {
  onElement(_ctx: TriggerContext<T>): TriggerResult {
    return TriggerResult.CONTINUE
  }

  onWatermark(ctx: TriggerContext<T>): TriggerResult {
    if (ctx.watermark >= ctx.window.end) {
      return TriggerResult.FIRE
    }
    return TriggerResult.CONTINUE
  }

  onProcessingTime(_ctx: TriggerContext<T>): TriggerResult {
    return TriggerResult.CONTINUE
  }
}

// ============================================================================
// Count Trigger
// ============================================================================

export class CountTrigger<T = unknown> extends Trigger<T> {
  constructor(private readonly count: number) {
    super()
  }

  onElement(ctx: TriggerContext<T>): TriggerResult {
    if (ctx.countSinceLastTrigger >= this.count) {
      return TriggerResult.FIRE_AND_PURGE
    }
    return TriggerResult.CONTINUE
  }

  onWatermark(_ctx: TriggerContext<T>): TriggerResult {
    return TriggerResult.CONTINUE
  }

  onProcessingTime(_ctx: TriggerContext<T>): TriggerResult {
    return TriggerResult.CONTINUE
  }
}

// ============================================================================
// Processing Time Trigger
// ============================================================================

export class ProcessingTimeTrigger<T = unknown> extends Trigger<T> {
  private timerId: ReturnType<typeof setInterval> | null = null
  private callback: (() => void) | null = null

  constructor(private readonly interval: Duration) {
    super()
  }

  setCallback(callback: () => void): void {
    this.callback = callback
    if (this.timerId) {
      clearInterval(this.timerId)
    }
    this.timerId = setInterval(() => {
      if (this.callback) {
        this.callback()
      }
    }, this.interval.toMillis())
  }

  clearTimer(): void {
    if (this.timerId) {
      clearInterval(this.timerId)
      this.timerId = null
    }
  }

  /**
   * Clean up the interval timer to prevent memory leaks.
   */
  override dispose(): void {
    this.clearTimer()
    this.callback = null
  }

  onElement(_ctx: TriggerContext<T>): TriggerResult {
    return TriggerResult.CONTINUE
  }

  onWatermark(_ctx: TriggerContext<T>): TriggerResult {
    return TriggerResult.CONTINUE
  }

  onProcessingTime(_ctx: TriggerContext<T>): TriggerResult {
    return TriggerResult.FIRE
  }
}

// ============================================================================
// Purging Trigger
// ============================================================================

export class PurgingTrigger<T = unknown> extends Trigger<T> {
  constructor(private readonly innerTrigger: Trigger<T>) {
    super()
  }

  onElement(ctx: TriggerContext<T>): TriggerResult {
    const result = this.innerTrigger.onElement(ctx)
    if (result === TriggerResult.FIRE) {
      return TriggerResult.FIRE_AND_PURGE
    }
    return result
  }

  onWatermark(ctx: TriggerContext<T>): TriggerResult {
    const result = this.innerTrigger.onWatermark(ctx)
    if (result === TriggerResult.FIRE) {
      return TriggerResult.FIRE_AND_PURGE
    }
    return result
  }

  onProcessingTime(ctx: TriggerContext<T>): TriggerResult {
    const result = this.innerTrigger.onProcessingTime(ctx)
    if (result === TriggerResult.FIRE) {
      return TriggerResult.FIRE_AND_PURGE
    }
    return result
  }

  override dispose(): void {
    this.innerTrigger.dispose()
  }
}

// ============================================================================
// Composite Triggers
// ============================================================================

class OrTrigger<T = unknown> extends Trigger<T> {
  private firedTriggers = new Set<number>()

  constructor(private readonly triggers: Trigger<T>[]) {
    super()
  }

  onElement(ctx: TriggerContext<T>): TriggerResult {
    for (let i = 0; i < this.triggers.length; i++) {
      const result = this.triggers[i]!.onElement(ctx)
      if (result === TriggerResult.FIRE || result === TriggerResult.FIRE_AND_PURGE) {
        this.firedTriggers.add(i)
        return result
      }
    }
    return TriggerResult.CONTINUE
  }

  onWatermark(ctx: TriggerContext<T>): TriggerResult {
    for (let i = 0; i < this.triggers.length; i++) {
      const result = this.triggers[i]!.onWatermark(ctx)
      if (result === TriggerResult.FIRE || result === TriggerResult.FIRE_AND_PURGE) {
        this.firedTriggers.add(i)
        return result
      }
    }
    return TriggerResult.CONTINUE
  }

  onProcessingTime(ctx: TriggerContext<T>): TriggerResult {
    for (let i = 0; i < this.triggers.length; i++) {
      const result = this.triggers[i]!.onProcessingTime(ctx)
      if (result === TriggerResult.FIRE || result === TriggerResult.FIRE_AND_PURGE) {
        this.firedTriggers.add(i)
        return result
      }
    }
    return TriggerResult.CONTINUE
  }

  override dispose(): void {
    for (const trigger of this.triggers) {
      trigger.dispose()
    }
    this.firedTriggers.clear()
  }
}

class AndTrigger<T = unknown> extends Trigger<T> {
  private satisfiedTriggers = new Map<string, Set<number>>()

  constructor(private readonly triggers: Trigger<T>[]) {
    super()
  }

  private getWindowKey(window: Window): string {
    return `${window.start}-${window.end}-${window.key || ''}`
  }

  private checkAndFire(windowKey: string): TriggerResult {
    const satisfied = this.satisfiedTriggers.get(windowKey)
    if (satisfied && satisfied.size === this.triggers.length) {
      this.satisfiedTriggers.delete(windowKey)
      return TriggerResult.FIRE
    }
    return TriggerResult.CONTINUE
  }

  onElement(ctx: TriggerContext<T>): TriggerResult {
    const windowKey = this.getWindowKey(ctx.window)
    if (!this.satisfiedTriggers.has(windowKey)) {
      this.satisfiedTriggers.set(windowKey, new Set())
    }
    const satisfied = this.satisfiedTriggers.get(windowKey)!

    for (let i = 0; i < this.triggers.length; i++) {
      const result = this.triggers[i]!.onElement(ctx)
      if (result === TriggerResult.FIRE || result === TriggerResult.FIRE_AND_PURGE) {
        satisfied.add(i)
      }
    }

    return this.checkAndFire(windowKey)
  }

  onWatermark(ctx: TriggerContext<T>): TriggerResult {
    const windowKey = this.getWindowKey(ctx.window)
    if (!this.satisfiedTriggers.has(windowKey)) {
      this.satisfiedTriggers.set(windowKey, new Set())
    }
    const satisfied = this.satisfiedTriggers.get(windowKey)!

    for (let i = 0; i < this.triggers.length; i++) {
      const result = this.triggers[i]!.onWatermark(ctx)
      if (result === TriggerResult.FIRE || result === TriggerResult.FIRE_AND_PURGE) {
        satisfied.add(i)
      }
    }

    return this.checkAndFire(windowKey)
  }

  onProcessingTime(ctx: TriggerContext<T>): TriggerResult {
    const windowKey = this.getWindowKey(ctx.window)
    if (!this.satisfiedTriggers.has(windowKey)) {
      this.satisfiedTriggers.set(windowKey, new Set())
    }
    const satisfied = this.satisfiedTriggers.get(windowKey)!

    for (let i = 0; i < this.triggers.length; i++) {
      const result = this.triggers[i]!.onProcessingTime(ctx)
      if (result === TriggerResult.FIRE || result === TriggerResult.FIRE_AND_PURGE) {
        satisfied.add(i)
      }
    }

    return this.checkAndFire(windowKey)
  }

  override dispose(): void {
    for (const trigger of this.triggers) {
      trigger.dispose()
    }
    this.satisfiedTriggers.clear()
  }
}

// ============================================================================
// Window Manager Options
// ============================================================================

export interface WindowManagerOptions {
  /** Optional metrics collector for observability */
  metrics?: MetricsCollector
}

// ============================================================================
// Window Manager
// ============================================================================

export class WindowManager<T = unknown> {
  private windows = new Map<string, WindowData<T>>()
  private watermark = Number.MIN_SAFE_INTEGER
  private trigger: Trigger<T> | null = null
  private lateDataHandler: LateDataHandler<T> | null = null
  private allowedLateness = 0
  private triggerCallback: ((window: Window, elements: T[]) => void) | null = null
  private keyExtractor: ((element: T) => string) | null = null
  private metrics: MetricsCollector

  constructor(
    private readonly assigner: WindowAssigner<T>,
    options?: WindowManagerOptions
  ) {
    this.metrics = options?.metrics ?? noopMetrics
  }

  // -------------------------------------------------------------------------
  // Static Factory Methods
  // -------------------------------------------------------------------------

  static tumbling<T>(size: Duration): WindowAssigner<T> {
    return new TumblingWindowAssigner<T>(size)
  }

  static sliding<T>(size: Duration, slide: Duration): WindowAssigner<T> {
    return new SlidingWindowAssigner<T>(size, slide)
  }

  static session<T>(gap: Duration): WindowAssigner<T> {
    return new SessionWindowAssigner<T>(gap)
  }

  static global<T>(): WindowAssigner<T> {
    return new GlobalWindowAssigner<T>()
  }

  // -------------------------------------------------------------------------
  // Configuration Methods
  // -------------------------------------------------------------------------

  withTrigger(trigger: Trigger<T>): this {
    this.trigger = trigger

    // Set up processing time trigger if applicable
    if (trigger instanceof ProcessingTimeTrigger) {
      trigger.setCallback(() => {
        this.fireProcessingTimeTrigger()
      })
    }

    return this
  }

  withKeyExtractor(fn: (element: T) => string): this {
    this.keyExtractor = fn
    return this
  }

  allowLateness(duration: Duration): this {
    this.allowedLateness = duration.toMillis()
    return this
  }

  sideOutputLate(handler: LateDataHandler<T>): this {
    this.lateDataHandler = handler
    return this
  }

  onTrigger(callback: (window: Window, elements: T[]) => void): void {
    this.triggerCallback = callback
  }

  // -------------------------------------------------------------------------
  // Core Methods
  // -------------------------------------------------------------------------

  private getWindowKey(window: Window): string {
    return `${window.start}-${window.end}-${window.key || ''}`
  }

  assign(element: T, timestamp: number): Window[] {
    const key = this.keyExtractor ? this.keyExtractor(element) : undefined

    if (this.assigner.type === 'session') {
      return (this.assigner as SessionWindowAssigner<T>).assignWindows(
        element,
        timestamp,
        key,
        this.windows
      )
    }

    const windows = this.assigner.assignWindows(element, timestamp, key)
    if (key !== undefined) {
      return windows.map((w) => ({ ...w, key }))
    }
    return windows
  }

  process(element: T, timestamp: number): void {
    const start = performance.now()
    try {
      const key = this.keyExtractor ? this.keyExtractor(element) : undefined

      // Check if data is late (beyond watermark + allowed lateness)
      if (this.assigner.type !== 'global' && this.assigner.type !== 'session') {
        const windows = this.assign(element, timestamp)
        for (const window of windows) {
          if (window.end <= this.watermark - this.allowedLateness) {
            // Data is too late
            this.metrics.incrementCounter(MetricNames.WINDOW_MANAGER_LATE_DATA)
            if (this.lateDataHandler) {
              this.lateDataHandler(element, window)
            }
            return
          }
        }
      }

      // For session windows, we need special handling
      if (this.assigner.type === 'session') {
        this.processSessionElement(element, timestamp, key)
        this.metrics.incrementCounter(MetricNames.WINDOW_MANAGER_ELEMENTS_PROCESSED)
        return
      }

      const windows = this.assign(element, timestamp)

      for (const window of windows) {
        const windowKey = this.getWindowKey(window)

        // Check if window is still accepting data (within allowed lateness)
        if (window.end <= this.watermark) {
          // Window has been triggered, check if within allowed lateness
          if (window.end > this.watermark - this.allowedLateness) {
            // Re-trigger the window with the late element
            const existing = this.windows.get(windowKey)
            if (existing) {
              existing.elements.push(element)
              this.fireTrigger(existing)
            } else if (this.lateDataHandler) {
              this.metrics.incrementCounter(MetricNames.WINDOW_MANAGER_LATE_DATA)
              this.lateDataHandler(element, window)
            }
          } else if (this.lateDataHandler) {
            this.metrics.incrementCounter(MetricNames.WINDOW_MANAGER_LATE_DATA)
            this.lateDataHandler(element, window)
          }
          continue
        }

        let windowData = this.windows.get(windowKey)
        const isNewWindow = !windowData

        if (!windowData) {
          windowData = {
            window,
            elements: [],
            triggered: false,
            countSinceLastTrigger: 0,
          }
          this.windows.set(windowKey, windowData)
          this.metrics.incrementCounter(MetricNames.WINDOW_MANAGER_WINDOW_CREATED)
        }

        windowData.elements.push(element)
        windowData.countSinceLastTrigger++

        // Check element trigger
        if (this.trigger) {
          const ctx: TriggerContext<T> = {
            window: windowData.window,
            elements: windowData.elements,
            watermark: this.watermark,
            countSinceLastTrigger: windowData.countSinceLastTrigger,
          }

          const result = this.trigger.onElement(ctx)
          this.handleTriggerResult(result, windowData)
        }
      }

      this.metrics.incrementCounter(MetricNames.WINDOW_MANAGER_ELEMENTS_PROCESSED)
      this.metrics.recordGauge(MetricNames.WINDOW_MANAGER_ACTIVE_WINDOWS, this.windows.size)
    } finally {
      this.metrics.recordLatency(MetricNames.WINDOW_MANAGER_PROCESS_LATENCY, performance.now() - start)
    }
  }

  private processSessionElement(element: T, timestamp: number, key?: string): void {
    const gapMs = (this.assigner as SessionWindowAssigner<T>).gap.toMillis()

    // Find all windows that should be merged with this element
    const windowsToMerge: WindowData<T>[] = []
    const newWindow: Window = { start: timestamp, end: timestamp + gapMs, key }

    for (const [windowKey, windowData] of this.windows) {
      const w = windowData.window
      if (key !== undefined && w.key !== key) continue

      // Check if windows should merge
      if (
        (newWindow.start <= w.end && newWindow.end >= w.start) ||
        Math.abs(newWindow.start - w.end) <= 0 ||
        Math.abs(w.start - newWindow.end) <= 0
      ) {
        windowsToMerge.push(windowData)
      }
    }

    if (windowsToMerge.length === 0) {
      // Create new session window
      const windowKey = this.getWindowKey(newWindow)
      this.windows.set(windowKey, {
        window: newWindow,
        elements: [element],
        triggered: false,
        countSinceLastTrigger: 1,
      })
    } else {
      // Merge windows
      const allElements: T[] = [element]
      let mergedStart = timestamp
      let mergedEnd = timestamp + gapMs

      for (const wd of windowsToMerge) {
        allElements.push(...wd.elements)
        mergedStart = Math.min(mergedStart, wd.window.start)
        mergedEnd = Math.max(mergedEnd, wd.window.end)
        // Remove old window
        this.windows.delete(this.getWindowKey(wd.window))
      }

      // Update merged end to be max timestamp + gap
      const maxTimestamp = Math.max(
        timestamp,
        ...windowsToMerge.flatMap((wd) =>
          // For simplicity, use window end - gap as approximate max timestamp
          [wd.window.end - gapMs]
        )
      )
      mergedEnd = maxTimestamp + gapMs

      const mergedWindow: Window = { start: mergedStart, end: mergedEnd, key }
      const windowKey = this.getWindowKey(mergedWindow)
      this.windows.set(windowKey, {
        window: mergedWindow,
        elements: allElements,
        triggered: false,
        countSinceLastTrigger: allElements.length,
      })
    }
  }

  advanceWatermark(timestamp: number): Window[] {
    const start = performance.now()
    try {
      if (timestamp < this.watermark) {
        throw new Error('Watermark cannot go backwards')
      }

      this.watermark = timestamp
      const triggeredWindows: Window[] = []

      // Check watermark trigger for all windows
      for (const [windowKey, windowData] of this.windows) {
        if (windowData.triggered && this.assigner.type !== 'session') continue

        // For session windows, automatically trigger when watermark passes window end
        if (this.assigner.type === 'session' && !windowData.triggered) {
          if (this.watermark >= windowData.window.end) {
            this.fireTrigger(windowData)
            windowData.triggered = true
            triggeredWindows.push(windowData.window)
            this.metrics.incrementCounter(MetricNames.WINDOW_MANAGER_WINDOW_TRIGGERED)
            continue
          }
        }

        if (this.trigger) {
          const ctx: TriggerContext<T> = {
            window: windowData.window,
            elements: windowData.elements,
            watermark: this.watermark,
            countSinceLastTrigger: windowData.countSinceLastTrigger,
          }

          const result = this.trigger.onWatermark(ctx)
          if (result === TriggerResult.FIRE || result === TriggerResult.FIRE_AND_PURGE) {
            this.fireTrigger(windowData)
            windowData.triggered = true
            triggeredWindows.push(windowData.window)
            this.metrics.incrementCounter(MetricNames.WINDOW_MANAGER_WINDOW_TRIGGERED)

            if (result === TriggerResult.FIRE_AND_PURGE) {
              windowData.elements = []
              windowData.countSinceLastTrigger = 0
            }
          }
        }
      }

      // Clean up old windows beyond allowed lateness
      const windowCountBefore = this.windows.size
      this.cleanupOldWindows()
      const windowsRemoved = windowCountBefore - this.windows.size
      if (windowsRemoved > 0) {
        this.metrics.incrementCounter(MetricNames.WINDOW_MANAGER_WINDOW_CLOSED, undefined, windowsRemoved)
      }

      this.metrics.recordGauge(MetricNames.WINDOW_MANAGER_ACTIVE_WINDOWS, this.windows.size)
      return triggeredWindows
    } finally {
      this.metrics.recordLatency(MetricNames.WINDOW_MANAGER_ADVANCE_WATERMARK_LATENCY, performance.now() - start)
    }
  }

  private cleanupOldWindows(): void {
    const windowsToRemove: string[] = []

    for (const [windowKey, windowData] of this.windows) {
      // Don't clean up global windows
      if (this.assigner.type === 'global') continue

      // Remove windows that are beyond watermark + allowed lateness
      if (
        windowData.triggered &&
        windowData.window.end <= this.watermark - this.allowedLateness
      ) {
        windowsToRemove.push(windowKey)
      }
    }

    for (const key of windowsToRemove) {
      this.windows.delete(key)
    }
  }

  getCurrentWatermark(): number {
    return this.watermark
  }

  getWindowState(window: Window): T[] {
    const windowKey = this.getWindowKey(window)
    const windowData = this.windows.get(windowKey)

    if (!windowData) {
      return []
    }

    // Return a copy
    return [...windowData.elements]
  }

  clearWindow(window: Window): void {
    const windowKey = this.getWindowKey(window)
    const windowData = this.windows.get(windowKey)

    if (windowData) {
      windowData.elements = []
      windowData.countSinceLastTrigger = 0
    }
  }

  getActiveWindowCount(): number {
    return this.windows.size
  }

  /**
   * Dispose of all resources held by this WindowManager.
   * This MUST be called when the WindowManager is no longer needed to prevent
   * memory leaks from interval timers (especially ProcessingTimeTrigger).
   *
   * After calling dispose():
   * - All timers are cleared
   * - All window state is cleared
   * - The trigger callback is removed
   * - The WindowManager should not be used again
   */
  dispose(): void {
    // Clean up trigger (especially important for ProcessingTimeTrigger)
    if (this.trigger) {
      this.trigger.dispose()
      this.trigger = null
    }

    // Clear all window state
    this.windows.clear()

    // Clear callbacks
    this.triggerCallback = null
    this.lateDataHandler = null
    this.keyExtractor = null
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private fireTrigger(windowData: WindowData<T>): void {
    if (this.triggerCallback && windowData.elements.length > 0) {
      this.triggerCallback(windowData.window, [...windowData.elements])
    }
  }

  private handleTriggerResult(result: TriggerResult, windowData: WindowData<T>): void {
    if (result === TriggerResult.FIRE) {
      this.fireTrigger(windowData)
      windowData.countSinceLastTrigger = 0
    } else if (result === TriggerResult.FIRE_AND_PURGE) {
      this.fireTrigger(windowData)
      windowData.elements = []
      windowData.countSinceLastTrigger = 0
    } else if (result === TriggerResult.PURGE) {
      windowData.elements = []
      windowData.countSinceLastTrigger = 0
    }
  }

  private fireProcessingTimeTrigger(): void {
    for (const [_, windowData] of this.windows) {
      if (this.trigger) {
        const ctx: TriggerContext<T> = {
          window: windowData.window,
          elements: windowData.elements,
          watermark: this.watermark,
          countSinceLastTrigger: windowData.countSinceLastTrigger,
        }

        const result = this.trigger.onProcessingTime(ctx)
        this.handleTriggerResult(result, windowData)
      }
    }
  }
}
