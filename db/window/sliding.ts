/**
 * SlidingWindow - Overlapping windows with configurable slide
 */

import { parseDuration, generateWindowId, getSlidingWindowBounds } from './utils'
import type {
  SlidingWindowOptions,
  TimestampedEvent,
  WindowState,
  ClosedWindowResult,
  AggregateFunction,
  BaseTrigger,
} from './types'

interface InternalWindow<T> {
  windowId: string
  startTime: number
  endTime: number
  events: T[]
  status: 'active' | 'closed'
}

export class SlidingWindow<T extends TimestampedEvent, R = unknown> {
  readonly size: number
  readonly slide: number
  readonly aggregate?: AggregateFunction<T, R>
  readonly trigger?: BaseTrigger

  private windows: Map<string, InternalWindow<T>> = new Map()
  private latestTimestamp: number = 0

  constructor(options: SlidingWindowOptions<T, R>) {
    this.size = parseDuration(options.size)
    this.slide = parseDuration(options.slide)
    this.aggregate = options.aggregate as AggregateFunction<T, R> | undefined
    this.trigger = options.trigger

    if (this.slide > this.size) {
      throw new Error('Slide cannot be larger than size')
    }
  }

  /**
   * Add an event to all relevant overlapping windows
   */
  async add(event: T): Promise<void> {
    const windowBounds = getSlidingWindowBounds(event.timestamp, this.size, this.slide)

    // Update latest timestamp for closing windows
    if (event.timestamp > this.latestTimestamp) {
      this.latestTimestamp = event.timestamp
      this.closeOldWindows()
    }

    for (const { start, end } of windowBounds) {
      const windowId = generateWindowId('sliding', start)

      let window = this.windows.get(windowId)
      if (!window) {
        window = {
          windowId,
          startTime: start,
          endTime: end,
          events: [],
          status: 'active',
        }
        this.windows.set(windowId, window)
      }

      window.events.push(event)
    }
  }

  /**
   * Close windows whose end time is before the latest timestamp
   */
  private closeOldWindows(): void {
    for (const window of this.windows.values()) {
      if (window.status === 'active' && window.endTime <= this.latestTimestamp) {
        window.status = 'closed'
      }
    }
  }

  /**
   * Get all active windows
   */
  async getActive(): Promise<WindowState<T, R>[]> {
    return Array.from(this.windows.values())
      .filter((w) => w.status === 'active')
      .sort((a, b) => a.startTime - b.startTime)
      .map((w) => ({
        windowId: w.windowId,
        startTime: w.startTime,
        endTime: w.endTime,
        events: w.events,
        result: this.computeResult(w.events),
      }))
  }

  /**
   * Get all windows containing a specific event
   */
  async getWindowsForEvent(event: T): Promise<WindowState<T, R>[]> {
    const windowBounds = getSlidingWindowBounds(event.timestamp, this.size, this.slide)
    return windowBounds.map(({ start, end }) => {
      const windowId = generateWindowId('sliding', start)
      const window = this.windows.get(windowId)

      return {
        windowId,
        startTime: start,
        endTime: end,
        events: window?.events || [],
        result: this.computeResult(window?.events || []),
      }
    })
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
   * Compute aggregate result
   */
  private computeResult(events: T[]): R {
    if (this.aggregate && events.length > 0) {
      return this.aggregate(events)
    }
    return {} as R
  }
}
