/**
 * WindowManager - Coordinates multiple windows with watermark handling
 */

import { parseDuration } from './utils'
import { Watermark } from './watermark'
import type {
  WindowManagerOptions,
  TimestampedEvent,
  AddResult,
  WindowCloseMetadata,
} from './types'
import type { TumblingWindow } from './tumbling'
import type { SlidingWindow } from './sliding'
import type { SessionWindow } from './session'

type AnyWindow<T extends TimestampedEvent> =
  | TumblingWindow<T, unknown>
  | SlidingWindow<T, unknown>
  | SessionWindow<T, unknown>

type EventHandler = (...args: unknown[]) => void

export class WindowManager<T extends TimestampedEvent = TimestampedEvent> {
  readonly watermarkStrategy: 'bounded' | 'punctuated'
  private maxOutOfOrder: number
  private allowedLateness: number

  private windows: Map<string, AnyWindow<T>> = new Map()
  private _currentWatermark: Watermark
  private lastClosedWindows: Map<string, number> = new Map() // windowName -> lastClosedEndTime

  private eventHandlers: Map<string, EventHandler[]> = new Map()

  constructor(options?: WindowManagerOptions) {
    this.watermarkStrategy = options?.watermarkStrategy || 'bounded'
    this.maxOutOfOrder = options?.maxOutOfOrder ? parseDuration(options.maxOutOfOrder) : 0
    this.allowedLateness = options?.allowedLateness ? parseDuration(options.allowedLateness) : 0
    this._currentWatermark = new Watermark(Number.MIN_SAFE_INTEGER)
  }

  /**
   * Get current watermark
   */
  get currentWatermark(): Watermark {
    return this._currentWatermark
  }

  /**
   * Register a window with a name
   */
  register(name: string, window: AnyWindow<T>): void {
    if (this.windows.has(name)) {
      throw new Error(`Window '${name}' already registered`)
    }
    this.windows.set(name, window)
  }

  /**
   * Get a registered window by name
   */
  get(name: string): AnyWindow<T> | undefined {
    return this.windows.get(name)
  }

  /**
   * Register an event handler
   */
  on(event: 'lateData' | 'windowClose', handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event) || []
    handlers.push(handler)
    this.eventHandlers.set(event, handlers)
  }

  /**
   * Emit an event to handlers
   */
  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event) || []
    for (const handler of handlers) {
      handler(...args)
    }
  }

  /**
   * Add an event to all registered windows
   */
  async add(event: T): Promise<AddResult> {
    const eventTime = event.timestamp
    const previousWatermark = this._currentWatermark.timestamp

    // Calculate the adjusted watermark for this event
    const adjustedWatermark = eventTime - this.maxOutOfOrder

    // Check if event is too late (beyond allowed lateness)
    if (previousWatermark !== Number.MIN_SAFE_INTEGER) {
      const latenessThreshold = previousWatermark - this.allowedLateness
      if (eventTime < latenessThreshold) {
        return {
          accepted: false,
          reason: 'beyond_allowed_lateness',
        }
      }

      // Check if event is late (behind current watermark)
      if (eventTime < previousWatermark + this.maxOutOfOrder) {
        // Find which window this late event belongs to
        for (const [name, window] of this.windows) {
          if (this.isTumblingWindow(window)) {
            const sizeMs = window.size
            const windowStart = Math.floor(eventTime / sizeMs) * sizeMs
            const windowEnd = windowStart + sizeMs

            this.emit('lateData', event, {
              windowId: `${name}_${windowStart}`,
              startTime: windowStart,
              endTime: windowEnd,
            })
            break
          }
        }
      }
    }

    // Route event to all windows FIRST (this updates window state)
    for (const window of this.windows.values()) {
      await window.add(event)
    }

    // Update watermark (monotonic - only advance, never go back)
    if (adjustedWatermark > this._currentWatermark.timestamp) {
      this._currentWatermark = new Watermark(adjustedWatermark)

      // Check for window closes AFTER adding events
      await this.checkWindowCloses(previousWatermark)
    }

    return { accepted: true }
  }

  /**
   * Check if any windows should be closed and emit events
   */
  private async checkWindowCloses(previousWatermark: number): Promise<void> {
    for (const [name, window] of this.windows) {
      if (this.isTumblingWindow(window)) {
        const closed = await window.getClosed()
        for (const closedWindow of closed) {
          const lastClosed = this.lastClosedWindows.get(name) || Number.MIN_SAFE_INTEGER
          if (closedWindow.endTime > lastClosed) {
            this.lastClosedWindows.set(name, closedWindow.endTime)

            const metadata: WindowCloseMetadata = {
              windowType: 'tumbling',
              startTime: closedWindow.startTime,
              endTime: closedWindow.endTime,
            }
            this.emit('windowClose', name, closedWindow.result, metadata)
          }
        }
      }
    }
  }

  /**
   * Type guard for tumbling windows
   */
  private isTumblingWindow(window: AnyWindow<T>): window is TumblingWindow<T, unknown> {
    return 'size' in window && !('slide' in window) && !('gap' in window)
  }
}
