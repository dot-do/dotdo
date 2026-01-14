/**
 * TumblingWindow - Fixed-size, non-overlapping windows
 */

import { parseDuration, generateWindowId, getTumblingWindowBounds } from './utils'
import type {
  TumblingWindowOptions,
  TimestampedEvent,
  WindowState,
  ClosedWindowResult,
  AggregateFunction,
  BaseTrigger,
  WindowSerializedState,
  SerializedWindowData,
} from './types'

interface InternalWindow<T> {
  windowId: string
  startTime: number
  endTime: number
  events: T[]
  status: 'active' | 'closed' | 'fired'
  createdAt: number
  lastEventTime: number
}

export class TumblingWindow<T extends TimestampedEvent, R = unknown> {
  readonly size: number
  readonly aggregate?: AggregateFunction<T, R>
  readonly trigger?: BaseTrigger

  private windows: Map<string, InternalWindow<T>> = new Map()
  private latestTimestamp: number = 0

  constructor(options: TumblingWindowOptions<T, R>) {
    this.size = parseDuration(options.size)
    this.aggregate = options.aggregate as AggregateFunction<T, R> | undefined
    this.trigger = options.trigger

    // Restore from initial state if provided
    if (options.initialState) {
      this.restoreState(options.initialState)
    }
  }

  /**
   * Add an event to the appropriate window
   */
  async add(event: T): Promise<void> {
    const { start, end } = getTumblingWindowBounds(event.timestamp, this.size)
    const windowId = generateWindowId('tumbling', start)

    // Update latest timestamp for closing windows
    if (event.timestamp > this.latestTimestamp) {
      this.latestTimestamp = event.timestamp
      this.closeOldWindows()
    }

    let window = this.windows.get(windowId)
    if (!window) {
      window = {
        windowId,
        startTime: start,
        endTime: end,
        events: [],
        status: 'active',
        createdAt: Date.now(),
        lastEventTime: event.timestamp,
      }
      this.windows.set(windowId, window)
    }

    window.events.push(event)
    window.lastEventTime = Math.max(window.lastEventTime, event.timestamp)

    // Check trigger
    if (this.trigger && window.status === 'active') {
      const shouldFire = this.trigger.shouldFire({
        eventCount: window.events.length,
        windowEnd: window.endTime,
        windowCreated: window.createdAt,
        now: Date.now(),
        lastEventTime: window.lastEventTime,
      })
      if (shouldFire) {
        window.status = 'fired'
      }
    }
  }

  /**
   * Close windows that are before the latest timestamp
   */
  private closeOldWindows(): void {
    const currentWindowStart = Math.floor(this.latestTimestamp / this.size) * this.size

    for (const window of this.windows.values()) {
      if (window.status === 'active' && window.startTime < currentWindowStart) {
        window.status = 'closed'
      }
    }
  }

  /**
   * Get the current (latest) window state
   */
  async getCurrent(): Promise<WindowState<T, R>> {
    // Find the window containing the latest timestamp
    const { start } = getTumblingWindowBounds(this.latestTimestamp || Date.now(), this.size)
    const windowId = generateWindowId('tumbling', start)

    let window = this.windows.get(windowId)
    if (!window) {
      // Create empty current window
      const bounds = getTumblingWindowBounds(Date.now(), this.size)
      window = {
        windowId: generateWindowId('tumbling', bounds.start),
        startTime: bounds.start,
        endTime: bounds.end,
        events: [],
        status: 'active',
        createdAt: Date.now(),
        lastEventTime: Date.now(),
      }
    }

    return {
      windowId: window.windowId,
      startTime: window.startTime,
      endTime: window.endTime,
      events: window.events,
      result: this.computeResult(window.events),
    }
  }

  /**
   * Get all windows
   */
  async getAll(): Promise<WindowState<T, R>[]> {
    return Array.from(this.windows.values()).map((w) => ({
      windowId: w.windowId,
      startTime: w.startTime,
      endTime: w.endTime,
      events: w.events,
      result: this.computeResult(w.events),
    }))
  }

  /**
   * Get closed windows
   */
  async getClosed(options?: { limit?: number }): Promise<ClosedWindowResult<R>[]> {
    const closed = Array.from(this.windows.values())
      .filter((w) => w.status === 'closed')
      .sort((a, b) => a.startTime - b.startTime)
      .map((w) => ({
        windowId: w.windowId,
        startTime: w.startTime,
        endTime: w.endTime,
        result: this.computeResult(w.events),
      }))

    if (options?.limit) {
      return closed.slice(0, options.limit)
    }
    return closed
  }

  /**
   * Get windows that have been fired by trigger
   */
  async getFired(): Promise<ClosedWindowResult<R>[]> {
    return Array.from(this.windows.values())
      .filter((w) => w.status === 'fired')
      .sort((a, b) => a.startTime - b.startTime)
      .map((w) => ({
        windowId: w.windowId,
        startTime: w.startTime,
        endTime: w.endTime,
        result: this.computeResult(w.events),
      }))
  }

  /**
   * Get serialized state for persistence
   */
  async getState(): Promise<WindowSerializedState> {
    const windows: SerializedWindowData[] = Array.from(this.windows.values()).map((w) => ({
      windowId: w.windowId,
      startTime: w.startTime,
      endTime: w.endTime,
      events: w.events as unknown[],
      status: w.status,
    }))

    return {
      windows,
      latestTimestamp: this.latestTimestamp,
    }
  }

  /**
   * Restore state from serialized data
   */
  private restoreState(state: WindowSerializedState): void {
    this.latestTimestamp = state.latestTimestamp
    for (const w of state.windows) {
      this.windows.set(w.windowId, {
        windowId: w.windowId,
        startTime: w.startTime,
        endTime: w.endTime,
        events: w.events as T[],
        status: w.status,
        createdAt: Date.now(),
        lastEventTime: w.startTime,
      })
    }
  }

  /**
   * Compute aggregate result
   */
  private computeResult(events: T[]): R {
    if (this.aggregate && events.length > 0) {
      return this.aggregate(events)
    }
    return {} as R
  }
}
