/**
 * Backpressure Controller - Handle slow consumers without losing events
 *
 * Provides backpressure mechanisms for streaming/CDC systems:
 * - Buffer with high/low watermarks for pause/resume
 * - Rate limiting for throughput control
 * - Multiple overflow strategies (drop, block, buffer to disk)
 * - Metrics for monitoring backpressure events
 *
 * ## Overview
 *
 * Backpressure is essential when producers outpace consumers. This module
 * provides configurable strategies to handle this mismatch gracefully.
 *
 * ## Strategies
 *
 * 1. **Block**: Producer blocks until buffer space is available (default)
 * 2. **Drop**: Drop oldest or newest events when buffer is full
 * 3. **Buffer to Disk**: Spill overflow to persistent storage
 * 4. **Sample**: Keep only every Nth event when under pressure
 *
 * ## Usage Example
 *
 * ```typescript
 * import { BackpressureController, OverflowStrategy } from './backpressure'
 *
 * const controller = new BackpressureController({
 *   highWatermark: 1000,
 *   lowWatermark: 200,
 *   overflowStrategy: OverflowStrategy.BLOCK,
 *   maxWaitMs: 5000,
 *   onPause: () => console.log('Source paused'),
 *   onResume: () => console.log('Source resumed'),
 * })
 *
 * // Push events (will pause source when buffer fills)
 * await controller.push(event)
 *
 * // Pull events for processing
 * const event = await controller.pull()
 * ```
 *
 * @module db/primitives/cdc/backpressure
 */

import { type MetricsCollector, noopMetrics } from '../observability'

// =============================================================================
// CONSTANTS
// =============================================================================

/** Metric names for backpressure monitoring */
export const BackpressureMetrics = {
  /** Total events pushed */
  EVENTS_PUSHED: 'backpressure.events_pushed',
  /** Total events pulled */
  EVENTS_PULLED: 'backpressure.events_pulled',
  /** Events dropped due to overflow */
  EVENTS_DROPPED: 'backpressure.events_dropped',
  /** Events spilled to disk */
  EVENTS_SPILLED: 'backpressure.events_spilled',
  /** Events sampled (skipped) */
  EVENTS_SAMPLED: 'backpressure.events_sampled',
  /** Current buffer size */
  BUFFER_SIZE: 'backpressure.buffer_size',
  /** Buffer utilization percentage */
  BUFFER_UTILIZATION: 'backpressure.buffer_utilization',
  /** Number of pause events */
  PAUSE_COUNT: 'backpressure.pause_count',
  /** Number of resume events */
  RESUME_COUNT: 'backpressure.resume_count',
  /** Time spent paused (ms) */
  PAUSED_TIME_MS: 'backpressure.paused_time_ms',
  /** Wait latency for push operations (ms) */
  PUSH_WAIT_LATENCY: 'backpressure.push_wait_latency',
  /** Consumer lag (events behind producer) */
  CONSUMER_LAG: 'backpressure.consumer_lag',
} as const

// =============================================================================
// TYPES
// =============================================================================

/**
 * Strategy for handling buffer overflow
 */
export enum OverflowStrategy {
  /** Block producer until space is available */
  BLOCK = 'BLOCK',
  /** Drop oldest events when buffer is full */
  DROP_OLDEST = 'DROP_OLDEST',
  /** Drop newest events (incoming) when buffer is full */
  DROP_NEWEST = 'DROP_NEWEST',
  /** Spill overflow to disk storage */
  BUFFER_TO_DISK = 'BUFFER_TO_DISK',
  /** Sample events (keep every Nth) when under pressure */
  SAMPLE = 'SAMPLE',
}

/**
 * State of the backpressure controller
 */
export enum BackpressureState {
  /** Normal operation, accepting events */
  FLOWING = 'FLOWING',
  /** Paused, buffer approaching capacity */
  PAUSED = 'PAUSED',
  /** Overflow, applying overflow strategy */
  OVERFLOW = 'OVERFLOW',
}

/**
 * Event with metadata for ordering and deduplication
 */
export interface BufferedEvent<T> {
  /** The actual event data */
  data: T
  /** Monotonically increasing sequence number */
  sequence: number
  /** Timestamp when event was pushed */
  pushedAt: number
  /** Priority for ordering (lower = higher priority) */
  priority?: number
}

/**
 * Statistics about backpressure state
 */
export interface BackpressureStats {
  /** Current state */
  state: BackpressureState
  /** Current buffer size */
  bufferSize: number
  /** Maximum buffer size (high watermark) */
  maxBufferSize: number
  /** Buffer utilization percentage (0-100) */
  utilizationPercent: number
  /** Total events pushed */
  totalPushed: number
  /** Total events pulled */
  totalPulled: number
  /** Total events dropped */
  totalDropped: number
  /** Total events spilled to disk */
  totalSpilled: number
  /** Total events sampled (skipped) */
  totalSampled: number
  /** Number of pause events */
  pauseCount: number
  /** Number of resume events */
  resumeCount: number
  /** Total time spent paused (ms) */
  totalPausedTimeMs: number
  /** Current consumer lag */
  consumerLag: number
  /** Events currently on disk (spilled) */
  diskBufferSize: number
  /** Is source currently paused */
  isPaused: boolean
}

/**
 * Persistent storage interface for buffer-to-disk strategy
 */
export interface DiskBuffer<T> {
  /** Write events to disk */
  write(events: BufferedEvent<T>[]): Promise<void>
  /** Read events from disk */
  read(limit: number): Promise<BufferedEvent<T>[]>
  /** Delete events from disk */
  delete(sequences: number[]): Promise<void>
  /** Get count of events on disk */
  size(): Promise<number>
  /** Clear all events from disk */
  clear(): Promise<void>
}

/**
 * Options for backpressure controller
 */
export interface BackpressureOptions<T> {
  /** Buffer size threshold to trigger pause (default: 1000) */
  highWatermark?: number
  /** Buffer size threshold to trigger resume (default: 200) */
  lowWatermark?: number
  /** Strategy for handling overflow (default: BLOCK) */
  overflowStrategy?: OverflowStrategy
  /** Maximum wait time for BLOCK strategy in ms (default: 30000) */
  maxWaitMs?: number
  /** Sampling rate for SAMPLE strategy (keep 1 in N) */
  sampleRate?: number
  /** Callback when source should be paused */
  onPause?: () => void | Promise<void>
  /** Callback when source should be resumed */
  onResume?: () => void | Promise<void>
  /** Callback when events are dropped */
  onDrop?: (events: BufferedEvent<T>[]) => void | Promise<void>
  /** Callback when overflow occurs */
  onOverflow?: (strategy: OverflowStrategy) => void | Promise<void>
  /** Disk buffer for BUFFER_TO_DISK strategy */
  diskBuffer?: DiskBuffer<T>
  /** Rate limit for push operations (events per second) */
  rateLimitPerSecond?: number
  /** Metrics collector */
  metrics?: MetricsCollector
}

/**
 * Interface for a controllable source
 */
export interface ControllableSource {
  /** Pause the source from producing */
  pause(): void | Promise<void>
  /** Resume the source to produce */
  resume(): void | Promise<void>
  /** Check if source is paused */
  isPaused(): boolean
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * BackpressureController manages flow control between producers and consumers
 *
 * @example
 * ```typescript
 * const controller = new BackpressureController<MyEvent>({
 *   highWatermark: 1000,
 *   lowWatermark: 200,
 *   overflowStrategy: OverflowStrategy.DROP_OLDEST,
 * })
 *
 * // Producer side
 * await controller.push(event)
 *
 * // Consumer side
 * const event = await controller.pull()
 * ```
 */
export class BackpressureController<T> {
  private readonly options: Required<
    Omit<BackpressureOptions<T>, 'onPause' | 'onResume' | 'onDrop' | 'onOverflow' | 'diskBuffer' | 'metrics'>
  > & Pick<BackpressureOptions<T>, 'onPause' | 'onResume' | 'onDrop' | 'onOverflow' | 'diskBuffer' | 'metrics'>

  private readonly metrics: MetricsCollector
  private readonly buffer: BufferedEvent<T>[] = []

  // State
  private state: BackpressureState = BackpressureState.FLOWING
  private isPaused: boolean = false
  private sequence: number = 0
  private pullSequence: number = 0

  // Statistics
  private totalPushed: number = 0
  private totalPulled: number = 0
  private totalDropped: number = 0
  private totalSpilled: number = 0
  private totalSampled: number = 0
  private pauseCount: number = 0
  private resumeCount: number = 0
  private totalPausedTimeMs: number = 0
  private lastPauseTime: number = 0

  // Rate limiting
  private rateLimitTokens: number
  private lastTokenRefill: number
  private readonly tokensPerMs: number

  // Waiting producers
  private readonly waitQueue: Array<{ resolve: () => void; reject: (error: Error) => void }> = []

  // Pull waiters
  private readonly pullWaitQueue: Array<{ resolve: (event: BufferedEvent<T>) => void }> = []

  constructor(options?: BackpressureOptions<T>) {
    this.options = {
      highWatermark: options?.highWatermark ?? 1000,
      lowWatermark: options?.lowWatermark ?? 200,
      overflowStrategy: options?.overflowStrategy ?? OverflowStrategy.BLOCK,
      maxWaitMs: options?.maxWaitMs ?? 30000,
      sampleRate: options?.sampleRate ?? 10,
      rateLimitPerSecond: options?.rateLimitPerSecond ?? 0,
      onPause: options?.onPause,
      onResume: options?.onResume,
      onDrop: options?.onDrop,
      onOverflow: options?.onOverflow,
      diskBuffer: options?.diskBuffer,
      metrics: options?.metrics,
    }

    this.metrics = options?.metrics ?? noopMetrics

    // Validate watermarks
    if (this.options.lowWatermark >= this.options.highWatermark) {
      throw new Error('lowWatermark must be less than highWatermark')
    }

    // Initialize rate limiting
    this.tokensPerMs = this.options.rateLimitPerSecond > 0
      ? this.options.rateLimitPerSecond / 1000
      : 0
    this.rateLimitTokens = this.options.rateLimitPerSecond
    this.lastTokenRefill = Date.now()
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Push an event into the buffer
   *
   * May block if using BLOCK strategy and buffer is full.
   *
   * @param data - Event data to push
   * @param priority - Optional priority (lower = higher priority)
   * @returns Promise that resolves when event is accepted
   * @throws Error if max wait time exceeded (BLOCK strategy)
   */
  async push(data: T, priority?: number): Promise<void> {
    const startTime = performance.now()

    // Rate limiting
    if (this.tokensPerMs > 0) {
      await this.acquireRateLimitToken()
    }

    // Check buffer state
    await this.handleBufferState()

    // Create buffered event
    const event: BufferedEvent<T> = {
      data,
      sequence: ++this.sequence,
      pushedAt: Date.now(),
      priority,
    }

    // Apply overflow strategy if needed
    if (this.state === BackpressureState.OVERFLOW) {
      const accepted = await this.applyOverflowStrategy(event)
      if (!accepted) {
        return
      }
    }

    // Add to buffer
    if (priority !== undefined) {
      // Insert in priority order
      let inserted = false
      for (let i = 0; i < this.buffer.length; i++) {
        if ((this.buffer[i]!.priority ?? 0) > priority) {
          this.buffer.splice(i, 0, event)
          inserted = true
          break
        }
      }
      if (!inserted) {
        this.buffer.push(event)
      }
    } else {
      this.buffer.push(event)
    }

    this.totalPushed++
    this.metrics.incrementCounter(BackpressureMetrics.EVENTS_PUSHED)
    this.metrics.recordGauge(BackpressureMetrics.BUFFER_SIZE, this.buffer.length)
    this.updateUtilizationMetric()

    // Record wait latency
    const waitLatency = performance.now() - startTime
    if (waitLatency > 1) {
      this.metrics.recordLatency(BackpressureMetrics.PUSH_WAIT_LATENCY, waitLatency)
    }

    // Notify waiting consumers
    this.notifyPullWaiters()
  }

  /**
   * Push multiple events (batch)
   *
   * @param events - Array of event data to push
   * @param priority - Optional priority for all events
   */
  async pushBatch(events: T[], priority?: number): Promise<void> {
    for (const event of events) {
      await this.push(event, priority)
    }
  }

  /**
   * Pull an event from the buffer
   *
   * @param timeoutMs - Optional timeout to wait for event
   * @returns Event or null if timeout
   */
  async pull(timeoutMs?: number): Promise<BufferedEvent<T> | null> {
    // Check disk buffer first if using that strategy
    if (this.options.diskBuffer) {
      const diskEvents = await this.options.diskBuffer.read(1)
      if (diskEvents.length > 0) {
        await this.options.diskBuffer.delete([diskEvents[0]!.sequence])
        this.pullSequence = diskEvents[0]!.sequence
        this.totalPulled++
        this.metrics.incrementCounter(BackpressureMetrics.EVENTS_PULLED)
        this.updateLagMetric()
        this.checkResume()
        return diskEvents[0]!
      }
    }

    // Check memory buffer
    if (this.buffer.length > 0) {
      const event = this.buffer.shift()!
      this.pullSequence = event.sequence
      this.totalPulled++
      this.metrics.incrementCounter(BackpressureMetrics.EVENTS_PULLED)
      this.metrics.recordGauge(BackpressureMetrics.BUFFER_SIZE, this.buffer.length)
      this.updateUtilizationMetric()
      this.updateLagMetric()
      this.checkResume()

      // Notify waiting producers
      this.notifyPushWaiters()

      return event
    }

    // Wait for event if timeout specified
    if (timeoutMs !== undefined && timeoutMs > 0) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const idx = this.pullWaitQueue.findIndex(w => w.resolve === wrappedResolve)
          if (idx >= 0) {
            this.pullWaitQueue.splice(idx, 1)
          }
          resolve(null)
        }, timeoutMs)

        const wrappedResolve = (event: BufferedEvent<T>) => {
          clearTimeout(timer)
          resolve(event)
        }

        this.pullWaitQueue.push({ resolve: wrappedResolve })
      })
    }

    return null
  }

  /**
   * Pull multiple events (batch)
   *
   * @param maxCount - Maximum number of events to pull
   * @returns Array of events
   */
  async pullBatch(maxCount: number): Promise<BufferedEvent<T>[]> {
    const events: BufferedEvent<T>[] = []

    // Check disk buffer first
    if (this.options.diskBuffer) {
      const diskEvents = await this.options.diskBuffer.read(maxCount)
      if (diskEvents.length > 0) {
        await this.options.diskBuffer.delete(diskEvents.map(e => e.sequence))
        for (const event of diskEvents) {
          this.pullSequence = event.sequence
          this.totalPulled++
          events.push(event)
        }
      }
    }

    // Fill remainder from memory buffer
    const remaining = maxCount - events.length
    for (let i = 0; i < remaining && this.buffer.length > 0; i++) {
      const event = this.buffer.shift()!
      this.pullSequence = event.sequence
      this.totalPulled++
      events.push(event)
    }

    if (events.length > 0) {
      this.metrics.incrementCounter(BackpressureMetrics.EVENTS_PULLED, undefined, events.length)
      this.metrics.recordGauge(BackpressureMetrics.BUFFER_SIZE, this.buffer.length)
      this.updateUtilizationMetric()
      this.updateLagMetric()
      this.checkResume()
      this.notifyPushWaiters()
    }

    return events
  }

  /**
   * Peek at the next event without removing it
   */
  peek(): BufferedEvent<T> | null {
    return this.buffer.length > 0 ? this.buffer[0]! : null
  }

  /**
   * Get current statistics
   */
  getStats(): BackpressureStats {
    return {
      state: this.state,
      bufferSize: this.buffer.length,
      maxBufferSize: this.options.highWatermark,
      utilizationPercent: (this.buffer.length / this.options.highWatermark) * 100,
      totalPushed: this.totalPushed,
      totalPulled: this.totalPulled,
      totalDropped: this.totalDropped,
      totalSpilled: this.totalSpilled,
      totalSampled: this.totalSampled,
      pauseCount: this.pauseCount,
      resumeCount: this.resumeCount,
      totalPausedTimeMs: this.totalPausedTimeMs + (this.isPaused ? Date.now() - this.lastPauseTime : 0),
      consumerLag: this.sequence - this.pullSequence,
      diskBufferSize: 0, // Would be async to get actual size
      isPaused: this.isPaused,
    }
  }

  /**
   * Get current backpressure state
   */
  getState(): BackpressureState {
    return this.state
  }

  /**
   * Check if source is currently paused
   */
  isSourcePaused(): boolean {
    return this.isPaused
  }

  /**
   * Get current buffer size
   */
  size(): number {
    return this.buffer.length
  }

  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    return this.buffer.length === 0
  }

  /**
   * Clear the buffer
   *
   * @param dropCallback - If true, calls onDrop callback for cleared events
   */
  async clear(dropCallback: boolean = false): Promise<void> {
    if (dropCallback && this.options.onDrop && this.buffer.length > 0) {
      await this.options.onDrop([...this.buffer])
      this.totalDropped += this.buffer.length
      this.metrics.incrementCounter(BackpressureMetrics.EVENTS_DROPPED, undefined, this.buffer.length)
    }

    this.buffer.length = 0
    this.metrics.recordGauge(BackpressureMetrics.BUFFER_SIZE, 0)
    this.updateUtilizationMetric()

    if (this.options.diskBuffer) {
      await this.options.diskBuffer.clear()
    }

    // Resume if paused
    if (this.isPaused) {
      await this.resumeSource()
    }

    this.state = BackpressureState.FLOWING

    // Notify waiting producers
    this.notifyPushWaiters()
  }

  /**
   * Attach a controllable source for automatic pause/resume
   */
  attachSource(source: ControllableSource): void {
    this.options.onPause = () => source.pause()
    this.options.onResume = () => source.resume()
  }

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    await this.clear(false)

    // Reject all waiting producers
    for (const waiter of this.waitQueue) {
      waiter.reject(new Error('BackpressureController disposed'))
    }
    this.waitQueue.length = 0

    // Clear pull waiters
    this.pullWaitQueue.length = 0
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private async handleBufferState(): Promise<void> {
    const currentSize = this.buffer.length

    // Check if we need to pause
    if (currentSize >= this.options.highWatermark && !this.isPaused) {
      await this.pauseSource()
      this.state = BackpressureState.OVERFLOW
      if (this.options.onOverflow) {
        await this.options.onOverflow(this.options.overflowStrategy)
      }
    }

    // Block if using BLOCK strategy and buffer is full
    if (this.state === BackpressureState.OVERFLOW &&
        this.options.overflowStrategy === OverflowStrategy.BLOCK) {
      await this.waitForSpace()
    }
  }

  private async waitForSpace(): Promise<void> {
    if (this.buffer.length < this.options.highWatermark) {
      return
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.waitQueue.findIndex(w => w.resolve === resolve)
        if (idx >= 0) {
          this.waitQueue.splice(idx, 1)
        }
        reject(new Error(`Backpressure timeout: waited ${this.options.maxWaitMs}ms for buffer space`))
      }, this.options.maxWaitMs)

      const wrappedResolve = () => {
        clearTimeout(timeout)
        resolve()
      }

      this.waitQueue.push({ resolve: wrappedResolve, reject })
    })
  }

  private notifyPushWaiters(): void {
    if (this.buffer.length < this.options.highWatermark && this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()
      if (waiter) {
        waiter.resolve()
      }
    }
  }

  private notifyPullWaiters(): void {
    if (this.buffer.length > 0 && this.pullWaitQueue.length > 0) {
      const waiter = this.pullWaitQueue.shift()
      if (waiter && this.buffer.length > 0) {
        const event = this.buffer.shift()!
        this.pullSequence = event.sequence
        this.totalPulled++
        this.metrics.incrementCounter(BackpressureMetrics.EVENTS_PULLED)
        this.metrics.recordGauge(BackpressureMetrics.BUFFER_SIZE, this.buffer.length)
        this.updateUtilizationMetric()
        this.updateLagMetric()
        waiter.resolve(event)
      }
    }
  }

  private async applyOverflowStrategy(event: BufferedEvent<T>): Promise<boolean> {
    switch (this.options.overflowStrategy) {
      case OverflowStrategy.BLOCK:
        // Already handled by waitForSpace
        return true

      case OverflowStrategy.DROP_OLDEST:
        if (this.buffer.length >= this.options.highWatermark) {
          const dropped = this.buffer.shift()
          if (dropped) {
            this.totalDropped++
            this.metrics.incrementCounter(BackpressureMetrics.EVENTS_DROPPED)
            if (this.options.onDrop) {
              await this.options.onDrop([dropped])
            }
          }
        }
        return true

      case OverflowStrategy.DROP_NEWEST:
        if (this.buffer.length >= this.options.highWatermark) {
          this.totalDropped++
          this.metrics.incrementCounter(BackpressureMetrics.EVENTS_DROPPED)
          if (this.options.onDrop) {
            await this.options.onDrop([event])
          }
          return false // Event not accepted
        }
        return true

      case OverflowStrategy.BUFFER_TO_DISK:
        if (this.buffer.length >= this.options.highWatermark && this.options.diskBuffer) {
          await this.options.diskBuffer.write([event])
          this.totalSpilled++
          this.metrics.incrementCounter(BackpressureMetrics.EVENTS_SPILLED)
          return false // Event went to disk, not memory buffer
        }
        return true

      case OverflowStrategy.SAMPLE:
        // Keep 1 in N events when under pressure
        if (this.buffer.length >= this.options.highWatermark) {
          if (this.sequence % this.options.sampleRate !== 0) {
            this.totalSampled++
            this.metrics.incrementCounter(BackpressureMetrics.EVENTS_SAMPLED)
            return false // Event sampled out
          }
        }
        return true

      default:
        return true
    }
  }

  private async pauseSource(): Promise<void> {
    if (this.isPaused) return

    this.isPaused = true
    this.pauseCount++
    this.lastPauseTime = Date.now()
    this.state = BackpressureState.PAUSED

    this.metrics.incrementCounter(BackpressureMetrics.PAUSE_COUNT)

    if (this.options.onPause) {
      await this.options.onPause()
    }
  }

  private async resumeSource(): Promise<void> {
    if (!this.isPaused) return

    this.isPaused = false
    this.resumeCount++
    this.totalPausedTimeMs += Date.now() - this.lastPauseTime
    this.state = BackpressureState.FLOWING

    this.metrics.incrementCounter(BackpressureMetrics.RESUME_COUNT)
    this.metrics.recordGauge(BackpressureMetrics.PAUSED_TIME_MS, this.totalPausedTimeMs)

    if (this.options.onResume) {
      await this.options.onResume()
    }
  }

  private checkResume(): void {
    if (this.isPaused && this.buffer.length <= this.options.lowWatermark) {
      this.resumeSource()
    }
  }

  private async acquireRateLimitToken(): Promise<void> {
    if (this.tokensPerMs === 0) return

    // Refill tokens based on elapsed time
    const now = Date.now()
    const elapsed = now - this.lastTokenRefill
    this.rateLimitTokens = Math.min(
      this.options.rateLimitPerSecond,
      this.rateLimitTokens + elapsed * this.tokensPerMs
    )
    this.lastTokenRefill = now

    // Wait for token if none available
    while (this.rateLimitTokens < 1) {
      const waitMs = (1 - this.rateLimitTokens) / this.tokensPerMs
      await new Promise(resolve => setTimeout(resolve, Math.ceil(waitMs)))

      const afterWait = Date.now()
      const elapsedWait = afterWait - this.lastTokenRefill
      this.rateLimitTokens = Math.min(
        this.options.rateLimitPerSecond,
        this.rateLimitTokens + elapsedWait * this.tokensPerMs
      )
      this.lastTokenRefill = afterWait
    }

    this.rateLimitTokens -= 1
  }

  private updateUtilizationMetric(): void {
    const utilization = (this.buffer.length / this.options.highWatermark) * 100
    this.metrics.recordGauge(BackpressureMetrics.BUFFER_UTILIZATION, utilization)
  }

  private updateLagMetric(): void {
    const lag = this.sequence - this.pullSequence
    this.metrics.recordGauge(BackpressureMetrics.CONSUMER_LAG, lag)
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new BackpressureController
 *
 * @param options - Configuration options
 * @returns A new BackpressureController instance
 */
export function createBackpressureController<T>(
  options?: BackpressureOptions<T>
): BackpressureController<T> {
  return new BackpressureController<T>(options)
}

// =============================================================================
// IN-MEMORY DISK BUFFER
// =============================================================================

/**
 * Simple in-memory implementation of DiskBuffer for testing
 *
 * In production, this would be backed by SQLite or file storage.
 */
export class InMemoryDiskBuffer<T> implements DiskBuffer<T> {
  private readonly storage: BufferedEvent<T>[] = []

  async write(events: BufferedEvent<T>[]): Promise<void> {
    this.storage.push(...events)
    // Sort by sequence to maintain order
    this.storage.sort((a, b) => a.sequence - b.sequence)
  }

  async read(limit: number): Promise<BufferedEvent<T>[]> {
    return this.storage.slice(0, limit)
  }

  async delete(sequences: number[]): Promise<void> {
    const sequenceSet = new Set(sequences)
    for (let i = this.storage.length - 1; i >= 0; i--) {
      if (sequenceSet.has(this.storage[i]!.sequence)) {
        this.storage.splice(i, 1)
      }
    }
  }

  async size(): Promise<number> {
    return this.storage.length
  }

  async clear(): Promise<void> {
    this.storage.length = 0
  }
}

/**
 * Create an in-memory disk buffer for testing
 */
export function createInMemoryDiskBuffer<T>(): DiskBuffer<T> {
  return new InMemoryDiskBuffer<T>()
}

// =============================================================================
// FLOW STATE ENUM
// =============================================================================

/**
 * State of the flow controller
 */
export enum FlowState {
  /** Normal operation, accepting events */
  FLOWING = 'FLOWING',
  /** Paused due to buffer pressure */
  PAUSED = 'PAUSED',
}

// =============================================================================
// FLOW CONTROLLER
// =============================================================================

/**
 * Options for FlowController
 */
export interface FlowControllerOptions<T> {
  /** Buffer size threshold to trigger pause */
  highWatermark: number
  /** Buffer size threshold to trigger resume */
  lowWatermark: number
  /** Maximum buffer size (events beyond this are handled by overflowStrategy) */
  maxBufferSize?: number
  /** Strategy for handling overflow */
  overflowStrategy?: OverflowStrategy
  /** Callback when state changes */
  onStateChange?: (state: FlowState) => void
  /** Callback when events are dropped */
  onDrop?: (event: T) => void
  /** BackpressureSignal for upstream coordination */
  backpressureSignal?: BackpressureSignal
}

/**
 * Statistics for FlowController
 */
export interface FlowControllerStats {
  totalPushed: number
  totalPulled: number
  droppedCount: number
  pauseCount: number
  resumeCount: number
  maxBufferSizeReached: number
}

/**
 * FlowController with watermark-based flow control
 */
export class FlowController<T> {
  private readonly options: FlowControllerOptions<T>
  private readonly buffer: T[] = []
  private state: FlowState = FlowState.FLOWING
  private stats: FlowControllerStats = {
    totalPushed: 0,
    totalPulled: 0,
    droppedCount: 0,
    pauseCount: 0,
    resumeCount: 0,
    maxBufferSizeReached: 0,
  }
  private waitResolvers: Array<() => void> = []

  constructor(options: FlowControllerOptions<T>) {
    // Validate watermarks
    if (options.lowWatermark >= options.highWatermark) {
      throw new Error('lowWatermark must be less than highWatermark')
    }
    if (options.lowWatermark < 0 || options.highWatermark < 0) {
      throw new Error('Watermarks must be positive')
    }

    this.options = {
      overflowStrategy: OverflowStrategy.BLOCK,
      ...options,
    }
  }

  getHighWatermark(): number {
    return this.options.highWatermark
  }

  getLowWatermark(): number {
    return this.options.lowWatermark
  }

  getState(): FlowState {
    return this.state
  }

  isFlowing(): boolean {
    return this.state === FlowState.FLOWING
  }

  getBufferSize(): number {
    return this.buffer.length
  }

  getBufferUtilization(): number {
    return (this.buffer.length / this.options.highWatermark) * 100
  }

  getStats(): FlowControllerStats {
    return { ...this.stats }
  }

  peek(): T | undefined {
    return this.buffer[0]
  }

  async push(event: T): Promise<void> {
    const maxBuffer = this.options.maxBufferSize ?? Number.MAX_SAFE_INTEGER

    // Handle overflow strategies
    if (this.buffer.length >= maxBuffer) {
      switch (this.options.overflowStrategy) {
        case OverflowStrategy.BLOCK:
          // Wait for space
          await this.waitForSpace()
          break

        case OverflowStrategy.DROP_OLDEST:
          const dropped = this.buffer.shift()
          if (dropped) {
            this.stats.droppedCount++
            if (this.options.onDrop) {
              this.options.onDrop(dropped)
            }
          }
          break

        case OverflowStrategy.DROP_NEWEST:
          this.stats.droppedCount++
          if (this.options.onDrop) {
            this.options.onDrop(event)
          }
          return // Don't add the event

        case OverflowStrategy.SAMPLE:
          // For sample, we'll just drop
          this.stats.droppedCount++
          return

        default:
          // ERROR strategy
          throw new Error('Buffer overflow: maximum buffer size exceeded')
      }
    }

    this.buffer.push(event)
    this.stats.totalPushed++

    // Track max buffer size
    if (this.buffer.length > this.stats.maxBufferSizeReached) {
      this.stats.maxBufferSizeReached = this.buffer.length
    }

    // Check if we need to pause
    if (this.buffer.length >= this.options.highWatermark && this.state === FlowState.FLOWING) {
      this.transition(FlowState.PAUSED)
    }
  }

  private waitForSpace(): Promise<void> {
    const maxBuffer = this.options.maxBufferSize ?? Number.MAX_SAFE_INTEGER
    if (this.buffer.length < maxBuffer) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      this.waitResolvers.push(resolve)
    })
  }

  private notifyWaiters(): void {
    const maxBuffer = this.options.maxBufferSize ?? Number.MAX_SAFE_INTEGER
    while (this.waitResolvers.length > 0 && this.buffer.length < maxBuffer) {
      const resolve = this.waitResolvers.shift()
      if (resolve) resolve()
    }
  }

  async pull(): Promise<T | undefined> {
    const event = this.buffer.shift()

    if (event !== undefined) {
      this.stats.totalPulled++

      // Check if we should resume
      if (this.buffer.length <= this.options.lowWatermark && this.state === FlowState.PAUSED) {
        this.transition(FlowState.FLOWING)
      }

      // Notify waiting pushers
      this.notifyWaiters()
    }

    return event
  }

  async pullBatch(count: number): Promise<T[]> {
    const batch: T[] = []
    for (let i = 0; i < count && this.buffer.length > 0; i++) {
      const event = this.buffer.shift()
      if (event !== undefined) {
        batch.push(event)
        this.stats.totalPulled++
      }
    }

    // Check if we should resume
    if (this.buffer.length <= this.options.lowWatermark && this.state === FlowState.PAUSED) {
      this.transition(FlowState.FLOWING)
    }

    // Notify waiting pushers
    this.notifyWaiters()

    return batch
  }

  clear(): void {
    this.buffer.length = 0
    if (this.state === FlowState.PAUSED) {
      this.transition(FlowState.FLOWING)
    }
    this.notifyWaiters()
  }

  private transition(newState: FlowState): void {
    if (this.state === newState) return

    const oldState = this.state
    this.state = newState

    if (newState === FlowState.PAUSED) {
      this.stats.pauseCount++
      if (this.options.backpressureSignal) {
        this.options.backpressureSignal.pause()
      }
    } else if (newState === FlowState.FLOWING && oldState === FlowState.PAUSED) {
      this.stats.resumeCount++
      if (this.options.backpressureSignal) {
        this.options.backpressureSignal.resume()
      }
    }

    if (this.options.onStateChange) {
      this.options.onStateChange(newState)
    }
  }
}

/**
 * Create a FlowController instance
 */
export function createFlowController<T>(options: FlowControllerOptions<T>): FlowController<T> {
  return new FlowController<T>(options)
}

// =============================================================================
// ADAPTIVE BATCHER
// =============================================================================

/**
 * Options for AdaptiveBatcher
 */
export interface AdaptiveBatcherOptions<T> {
  /** Initial batch size */
  initialBatchSize: number
  /** Minimum batch size */
  minBatchSize: number
  /** Maximum batch size */
  maxBatchSize: number
  /** Target latency for batch processing (ms) */
  targetLatencyMs?: number
  /** Timeout before forcing batch emission (ms) */
  batchTimeoutMs?: number
  /** Smoothing factor for exponential moving average (0-1) */
  smoothingFactor?: number
  /** Memory pressure threshold (0-1) */
  memoryPressureThreshold?: number
  /** Function to get current memory pressure (0-1) */
  getMemoryPressure?: () => number
  /** Handler for completed batches */
  onBatch?: (batch: T[]) => Promise<void>
}

/**
 * Statistics for AdaptiveBatcher
 */
export interface AdaptiveBatcherStats {
  eventsPerSecond: number
  avgBatchProcessingTimeMs: number
  batchSizeHistory: number[]
  totalEventsProcessed: number
  totalBatchesProcessed: number
}

/**
 * AdaptiveBatcher that adjusts batch size based on throughput
 */
export class AdaptiveBatcher<T> {
  private readonly options: AdaptiveBatcherOptions<T>
  private currentBatchSize: number
  private buffer: T[] = []
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private stats: AdaptiveBatcherStats = {
    eventsPerSecond: 0,
    avgBatchProcessingTimeMs: 0,
    batchSizeHistory: [],
    totalEventsProcessed: 0,
    totalBatchesProcessed: 0,
  }
  private totalProcessingTimeMs: number = 0
  private processingStartTime: number = Date.now()

  constructor(options: AdaptiveBatcherOptions<T>) {
    this.options = {
      smoothingFactor: 0.2,
      ...options,
    }
    this.currentBatchSize = options.initialBatchSize
  }

  getCurrentBatchSize(): number {
    return this.currentBatchSize
  }

  getStats(): AdaptiveBatcherStats {
    const elapsedSeconds = (Date.now() - this.processingStartTime) / 1000
    return {
      ...this.stats,
      eventsPerSecond: elapsedSeconds > 0 ? this.stats.totalEventsProcessed / elapsedSeconds : 0,
      avgBatchProcessingTimeMs:
        this.stats.totalBatchesProcessed > 0
          ? this.totalProcessingTimeMs / this.stats.totalBatchesProcessed
          : 0,
    }
  }

  async add(event: T): Promise<void> {
    this.buffer.push(event)

    // Check for memory pressure
    if (this.options.getMemoryPressure && this.options.memoryPressureThreshold) {
      const pressure = this.options.getMemoryPressure()
      if (pressure > this.options.memoryPressureThreshold) {
        this.adjustBatchSize(this.currentBatchSize * 0.8) // Reduce by 20%
      }
    }

    // Start timeout timer if configured
    if (this.options.batchTimeoutMs && !this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushInternal(), this.options.batchTimeoutMs)
    }

    // Check if we should emit a batch
    if (this.buffer.length >= this.currentBatchSize) {
      await this.flushInternal()
    }
  }

  async flush(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    while (this.buffer.length > 0) {
      await this.flushInternal()
    }
  }

  private async flushInternal(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    if (this.buffer.length === 0) return

    const batch = this.buffer.splice(0, this.currentBatchSize)
    const batchSize = batch.length
    this.stats.batchSizeHistory.push(batchSize)

    if (this.options.onBatch) {
      const startTime = performance.now()
      await this.options.onBatch(batch)
      const processingTime = performance.now() - startTime
      this.totalProcessingTimeMs += processingTime

      // Adapt batch size based on latency
      if (this.options.targetLatencyMs) {
        if (processingTime < this.options.targetLatencyMs * 0.8) {
          // Processing fast, increase batch size more aggressively
          // Use a larger multiplier to overcome smoothing
          this.adjustBatchSize(this.currentBatchSize * 1.5)
        } else if (processingTime > this.options.targetLatencyMs * 1.2) {
          // Processing slow, decrease batch size
          this.adjustBatchSize(this.currentBatchSize * 0.7)
        }
      }
    }

    this.stats.totalEventsProcessed += batchSize
    this.stats.totalBatchesProcessed++
  }

  private adjustBatchSize(newSize: number): void {
    const smoothingFactor = this.options.smoothingFactor ?? 0.3

    // Apply exponential moving average for smooth adjustment
    const smoothedSize = this.currentBatchSize * (1 - smoothingFactor) + newSize * smoothingFactor

    // Clamp to min/max bounds
    this.currentBatchSize = Math.max(
      this.options.minBatchSize,
      Math.min(this.options.maxBatchSize, Math.round(smoothedSize))
    )
  }
}

/**
 * Create an AdaptiveBatcher instance
 */
export function createAdaptiveBatcher<T>(options: AdaptiveBatcherOptions<T>): AdaptiveBatcher<T> {
  return new AdaptiveBatcher<T>(options)
}

// =============================================================================
// BACKPRESSURE SIGNAL
// =============================================================================

/**
 * Backpressure callback type
 */
export type BackpressureCallback = () => void | Promise<void>

/**
 * Options for BackpressureSignal
 */
export interface BackpressureSignalOptions {
  /** Mode: 'simple' for pause/resume, 'credit' for credit-based, 'rate' for rate limiting */
  mode?: 'simple' | 'credit' | 'rate'
  /** Initial credits (for credit mode) */
  initialCredits?: number
  /** Max events per second (for rate mode) */
  maxEventsPerSecond?: number
  /** Callback when paused */
  onPause?: BackpressureCallback
  /** Callback when resumed */
  onResume?: BackpressureCallback
  /** Callback when throttled (rate mode) */
  onThrottle?: BackpressureCallback
}

/**
 * BackpressureSignal for upstream coordination
 */
export class BackpressureSignal {
  private readonly options: BackpressureSignalOptions
  private paused: boolean = false
  private credits: number = 0
  private eventTimestamps: number[] = []

  constructor(options: BackpressureSignalOptions = {}) {
    this.options = {
      mode: 'simple',
      ...options,
    }

    if (options.initialCredits !== undefined) {
      this.credits = options.initialCredits
    }
  }

  isPaused(): boolean {
    return this.paused
  }

  async pause(): Promise<void> {
    if (this.paused) return

    this.paused = true
    if (this.options.onPause) {
      await this.options.onPause()
    }
  }

  async resume(): Promise<void> {
    if (!this.paused) return

    this.paused = false
    if (this.options.onResume) {
      await this.options.onResume()
    }
  }

  // Credit-based flow control
  getCredits(): number {
    return this.credits
  }

  consumeCredit(count: number = 1): void {
    this.credits = Math.max(0, this.credits - count)
    if (this.credits === 0 && !this.paused) {
      this.pause()
    }
  }

  grantCredits(count: number): void {
    const wasZero = this.credits === 0
    this.credits += count
    if (wasZero && this.credits > 0 && this.paused) {
      this.resume()
    }
  }

  // Rate-based flow control
  getMaxEventsPerSecond(): number {
    return this.options.maxEventsPerSecond ?? 0
  }

  recordEvent(): void {
    const now = Date.now()
    this.eventTimestamps.push(now)

    // Clean old timestamps (older than 1 second)
    const oneSecondAgo = now - 1000
    this.eventTimestamps = this.eventTimestamps.filter((t) => t > oneSecondAgo)

    // Check if rate exceeded
    if (
      this.options.maxEventsPerSecond &&
      this.eventTimestamps.length > this.options.maxEventsPerSecond
    ) {
      if (this.options.onThrottle) {
        this.options.onThrottle()
      }
    }
  }

  getWaitTimeMs(): number {
    if (!this.options.maxEventsPerSecond) return 0

    const now = Date.now()
    const oneSecondAgo = now - 1000

    // Count events in last second
    const recentEvents = this.eventTimestamps.filter((t) => t > oneSecondAgo).length

    if (recentEvents <= this.options.maxEventsPerSecond) {
      return 0
    }

    // Calculate wait time based on oldest event in window
    const oldestInWindow = this.eventTimestamps.find((t) => t > oneSecondAgo)
    if (oldestInWindow) {
      return 1000 - (now - oldestInWindow)
    }

    return 100 // Default wait
  }
}

/**
 * Create a BackpressureSignal instance
 */
export function createBackpressureSignal(options?: BackpressureSignalOptions): BackpressureSignal {
  return new BackpressureSignal(options)
}
