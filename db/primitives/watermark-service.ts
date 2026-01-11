/**
 * WatermarkService - Event-time progress tracking primitive
 *
 * Watermarks track the progress of event-time through a streaming system.
 * They represent the point in time up to which all events have been observed.
 *
 * Key concepts:
 * - Monotonic advancement (watermarks never go backwards)
 * - Multi-source aggregation (min across all sources)
 * - Idle source handling (don't block watermark on inactive sources)
 * - Bounded out-of-orderness (allow late events within a window)
 */

/** Duration in milliseconds */
export type Duration = number

/** Unsubscribe function returned by callbacks */
export type Unsubscribe = () => void

/**
 * WatermarkService interface for event-time tracking
 */
export interface WatermarkServiceInterface {
  /** Get current watermark (event-time progress) */
  current(): number

  /** Advance watermark from an incoming event timestamp */
  advance(eventTimestamp: number): void

  /** Mark a source as idle (won't contribute to watermark) */
  markIdle(sourceId: string): void

  /** Check if a source is marked idle */
  isIdle(sourceId: string): boolean

  /** Register a source for multi-source aggregation */
  register(sourceId: string): void

  /** Update watermark for a specific source */
  updateSource(sourceId: string, watermark: number): void

  /** Get aggregated watermark (min across all active sources) */
  aggregated(): number

  /** Configure bounded out-of-orderness */
  withBoundedOutOfOrderness(maxLateness: Duration): this

  /** Subscribe to watermark advancement events */
  onAdvance(callback: (watermark: number) => void): Unsubscribe

  /** Unregister a source */
  unregister(sourceId: string): void

  /** Mark a source as active (opposite of idle) */
  markActive(sourceId: string): void

  /** Get all registered source IDs */
  getSources(): string[]

  /** Get watermark for a specific source */
  getSourceWatermark(sourceId: string): number | undefined
}

/**
 * WatermarkService implementation
 */
export class WatermarkService implements WatermarkServiceInterface {
  /** Current single-source watermark (event-time, before lateness adjustment) */
  private _watermark: number = Number.NEGATIVE_INFINITY

  /** Whether the watermark has been initialized with a real value */
  private _initialized: boolean = false

  /** Max lateness for bounded out-of-orderness */
  private _maxLateness: Duration = 0

  /** Map of source ID to watermark (event-time, before lateness adjustment) */
  private _sourceWatermarks: Map<string, number> = new Map()

  /** Set of idle source IDs */
  private _idleSources: Set<string> = new Set()

  /** Callbacks to invoke on watermark advancement */
  private _callbacks: Array<(watermark: number) => void> = []

  current(): number {
    return this._watermark - this._maxLateness
  }

  advance(eventTimestamp: number): void {
    // Clamp NEGATIVE_INFINITY to the smallest finite value
    const clampedTimestamp =
      eventTimestamp === Number.NEGATIVE_INFINITY ? -Number.MAX_VALUE : eventTimestamp

    // Accept first event (uninitialized state) or later events (monotonic advancement)
    if (!this._initialized || clampedTimestamp > this._watermark) {
      const previousWatermark = this._watermark
      this._watermark = clampedTimestamp
      this._initialized = true
      const adjusted = this._watermark - this._maxLateness
      // Only notify if watermark actually changed
      if (this._watermark !== previousWatermark) {
        this._notifyCallbacks(adjusted)
      }
    }
  }

  markIdle(sourceId: string): void {
    // Only mark as idle if the source is registered
    if (this._sourceWatermarks.has(sourceId)) {
      this._idleSources.add(sourceId)
    }
  }

  isIdle(sourceId: string): boolean {
    return this._idleSources.has(sourceId)
  }

  register(sourceId: string): void {
    if (!this._sourceWatermarks.has(sourceId)) {
      this._sourceWatermarks.set(sourceId, Number.NEGATIVE_INFINITY)
    }
  }

  updateSource(sourceId: string, watermark: number): void {
    // Auto-register if not already registered
    if (!this._sourceWatermarks.has(sourceId)) {
      this.register(sourceId)
    }
    this._sourceWatermarks.set(sourceId, watermark)
  }

  aggregated(): number {
    if (this._sourceWatermarks.size === 0) {
      return Number.NEGATIVE_INFINITY
    }

    // Get active sources (non-idle)
    const activeSources: number[] = []
    const allSources: number[] = []

    for (const [sourceId, watermark] of this._sourceWatermarks) {
      allSources.push(watermark)
      if (!this._idleSources.has(sourceId)) {
        activeSources.push(watermark)
      }
    }

    let minWatermark: number
    if (activeSources.length === 0) {
      // All sources are idle - use max of all source watermarks
      minWatermark = Math.max(...allSources)
    } else {
      // Use min of active sources
      minWatermark = Math.min(...activeSources)
    }

    return minWatermark - this._maxLateness
  }

  withBoundedOutOfOrderness(maxLateness: Duration): this {
    this._maxLateness = maxLateness
    return this
  }

  onAdvance(callback: (watermark: number) => void): Unsubscribe {
    this._callbacks.push(callback)
    return () => {
      const index = this._callbacks.indexOf(callback)
      if (index !== -1) {
        this._callbacks.splice(index, 1)
      }
    }
  }

  unregister(sourceId: string): void {
    this._sourceWatermarks.delete(sourceId)
    this._idleSources.delete(sourceId)
  }

  markActive(sourceId: string): void {
    this._idleSources.delete(sourceId)
  }

  getSources(): string[] {
    return Array.from(this._sourceWatermarks.keys())
  }

  getSourceWatermark(sourceId: string): number | undefined {
    return this._sourceWatermarks.get(sourceId)
  }

  private _notifyCallbacks(watermark: number): void {
    for (const callback of this._callbacks) {
      try {
        callback(watermark)
      } catch {
        // Swallow errors from callbacks to not affect other callbacks
      }
    }
  }
}

/**
 * Factory function to create a WatermarkService
 */
export function createWatermarkService(): WatermarkService {
  return new WatermarkService()
}
