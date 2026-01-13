/**
 * Backpressure Module - Memory-efficient streaming with flow control
 *
 * Provides utilities for handling backpressure in async streams:
 * - Bounded buffers with configurable strategies
 * - Rate limiting
 * - Pause/resume flow control
 */

import type {
  AsyncIterableSource,
  BackpressureOptions,
  BackpressureState,
  BackpressureStrategy,
} from './types'
import { iterate } from './iterator'

// ============================================================================
// Backpressure Controller
// ============================================================================

/**
 * Backpressure controller for managing flow in async streams
 *
 * @example
 * ```typescript
 * const controller = new BackpressureController({ highWaterMark: 100 })
 *
 * // Producer
 * for await (const item of source) {
 *   await controller.push(item) // Blocks when buffer is full
 * }
 * controller.end()
 *
 * // Consumer
 * for await (const item of controller) {
 *   await processItem(item)
 * }
 * ```
 */
export class BackpressureController<T> implements AsyncIterable<T> {
  private buffer: T[] = []
  private readonly highWaterMark: number
  private readonly lowWaterMark: number
  private readonly strategy: BackpressureStrategy
  private readonly blockTimeout?: number

  private isPaused = false
  private isEnded = false
  private droppedCount = 0

  // Promises for blocking
  private pushWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = []
  private pullWaiters: Array<{ resolve: (value: T | undefined) => void; reject: (err: Error) => void }> = []

  constructor(options: BackpressureOptions = {}) {
    this.highWaterMark = options.highWaterMark ?? 16
    this.lowWaterMark = options.lowWaterMark ?? Math.floor(this.highWaterMark / 4)
    this.strategy = options.strategy ?? 'block'
    this.blockTimeout = options.blockTimeout
  }

  /**
   * Push an item into the buffer
   * Returns a promise that resolves when the item is accepted
   */
  async push(item: T): Promise<boolean> {
    if (this.isEnded) {
      throw new Error('Cannot push to ended controller')
    }

    // If there are waiting consumers, deliver directly
    if (this.pullWaiters.length > 0) {
      const waiter = this.pullWaiters.shift()!
      waiter.resolve(item)
      return true
    }

    // Check buffer capacity
    if (this.buffer.length >= this.highWaterMark) {
      this.isPaused = true

      switch (this.strategy) {
        case 'drop-oldest':
          this.buffer.shift()
          this.droppedCount++
          this.buffer.push(item)
          return true

        case 'drop-newest':
          this.droppedCount++
          return false

        case 'error':
          throw new Error('Buffer overflow')

        case 'block':
        default:
          // Wait for space in buffer
          await this.waitForSpace()
          break
      }
    }

    this.buffer.push(item)
    return true
  }

  /**
   * Pull an item from the buffer
   */
  async pull(): Promise<T | undefined> {
    // If buffer has items, return immediately
    if (this.buffer.length > 0) {
      const item = this.buffer.shift()!

      // Resume if below low water mark
      if (this.isPaused && this.buffer.length <= this.lowWaterMark) {
        this.isPaused = false
        this.notifyPushWaiters()
      }

      return item
    }

    // If ended and buffer empty, return undefined
    if (this.isEnded) {
      return undefined
    }

    // Wait for an item
    return this.waitForItem()
  }

  /**
   * Signal that no more items will be pushed
   */
  end(): void {
    this.isEnded = true

    // Resolve all waiting consumers with undefined
    for (const waiter of this.pullWaiters) {
      waiter.resolve(undefined)
    }
    this.pullWaiters = []

    // Reject all waiting producers
    for (const waiter of this.pushWaiters) {
      waiter.reject(new Error('Controller ended'))
    }
    this.pushWaiters = []
  }

  /**
   * Get current state
   */
  getState(): BackpressureState {
    return {
      bufferSize: this.buffer.length,
      highWaterMark: this.highWaterMark,
      lowWaterMark: this.lowWaterMark,
      isPaused: this.isPaused,
      droppedCount: this.droppedCount,
    }
  }

  /**
   * Async iterator implementation
   */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const item = await this.pull()
      if (item === undefined && this.isEnded) {
        break
      }
      if (item !== undefined) {
        yield item
      }
    }
  }

  /**
   * Wait for space in buffer
   */
  private waitForSpace(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = this.blockTimeout
        ? setTimeout(() => {
            const index = this.pushWaiters.findIndex(w => w.resolve === resolve)
            if (index !== -1) {
              this.pushWaiters.splice(index, 1)
            }
            reject(new Error('Push timeout'))
          }, this.blockTimeout)
        : undefined

      this.pushWaiters.push({
        resolve: () => {
          if (timeout) clearTimeout(timeout)
          resolve()
        },
        reject: (err) => {
          if (timeout) clearTimeout(timeout)
          reject(err)
        },
      })
    })
  }

  /**
   * Wait for an item
   */
  private waitForItem(): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.pullWaiters.push({ resolve, reject })
    })
  }

  /**
   * Notify waiting producers that space is available
   */
  private notifyPushWaiters(): void {
    while (this.pushWaiters.length > 0 && this.buffer.length < this.highWaterMark) {
      const waiter = this.pushWaiters.shift()!
      waiter.resolve()
    }
  }
}

// ============================================================================
// Backpressure Transform
// ============================================================================

/**
 * Create a backpressure-aware iterator wrapper
 *
 * @example
 * ```typescript
 * // Slow down fast producer to match slow consumer
 * const buffered = withBackpressure(fastSource, { highWaterMark: 100 })
 *
 * for await (const item of buffered) {
 *   await slowProcess(item) // Buffer absorbs speed mismatch
 * }
 * ```
 */
export async function* withBackpressure<T>(
  source: AsyncIterableSource<T>,
  options: BackpressureOptions = {}
): AsyncGenerator<T, void, undefined> {
  const controller = new BackpressureController<T>(options)

  // Start producer in background
  const producer = (async () => {
    try {
      for await (const item of iterate(source)) {
        await controller.push(item)
      }
    } finally {
      controller.end()
    }
  })()

  // Consume from controller
  try {
    for await (const item of controller) {
      yield item
    }
  } finally {
    // Ensure producer is cleaned up
    await producer.catch(() => {}) // Ignore errors, producer ended
  }
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Rate-limited iterator that limits items per time window
 *
 * @example
 * ```typescript
 * // Max 10 items per second
 * const limited = rateLimit(source, { itemsPerSecond: 10 })
 *
 * // Max 100 items per minute
 * const limited = rateLimit(source, { itemsPerWindow: 100, windowMs: 60000 })
 * ```
 */
export async function* rateLimit<T>(
  source: AsyncIterableSource<T>,
  options: RateLimitOptions
): AsyncGenerator<T, void, undefined> {
  const { itemsPerSecond, itemsPerWindow, windowMs = 1000 } = options

  const maxItems = itemsPerSecond !== undefined
    ? itemsPerSecond
    : (itemsPerWindow ?? 1)

  const window = itemsPerSecond !== undefined ? 1000 : windowMs

  let windowStart = Date.now()
  let itemsInWindow = 0

  for await (const item of iterate(source)) {
    const now = Date.now()

    // Check if we're in a new window
    if (now - windowStart >= window) {
      windowStart = now
      itemsInWindow = 0
    }

    // Check if we've exceeded rate
    if (itemsInWindow >= maxItems) {
      // Wait for next window
      const waitTime = window - (now - windowStart)
      if (waitTime > 0) {
        await sleep(waitTime)
      }
      windowStart = Date.now()
      itemsInWindow = 0
    }

    itemsInWindow++
    yield item
  }
}

/**
 * Rate limit options
 */
export interface RateLimitOptions {
  /**
   * Items per second (convenience option)
   */
  itemsPerSecond?: number

  /**
   * Items per custom window
   */
  itemsPerWindow?: number

  /**
   * Window size in ms (default 1000)
   */
  windowMs?: number
}

// ============================================================================
// Throttle and Debounce
// ============================================================================

/**
 * Throttle iterator - emit at most one item per interval
 *
 * @example
 * ```typescript
 * // At most one item every 100ms
 * const throttled = throttle(source, 100)
 * ```
 */
export async function* throttle<T>(
  source: AsyncIterableSource<T>,
  intervalMs: number
): AsyncGenerator<T, void, undefined> {
  let lastEmit = 0

  for await (const item of iterate(source)) {
    const now = Date.now()
    const elapsed = now - lastEmit

    if (elapsed >= intervalMs) {
      lastEmit = now
      yield item
    }
    // Drop items that come too fast
  }
}

/**
 * Debounce iterator - emit only after quiet period
 *
 * @example
 * ```typescript
 * // Only emit after 100ms of no new items
 * const debounced = debounce(source, 100)
 * ```
 */
export async function* debounce<T>(
  source: AsyncIterableSource<T>,
  delayMs: number
): AsyncGenerator<T, void, undefined> {
  let pending: T | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let resolver: ((value: T | undefined) => void) | undefined

  const scheduleEmit = (item: T) => {
    pending = item

    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      if (resolver) {
        resolver(pending)
        resolver = undefined
        pending = undefined
      }
    }, delayMs)
  }

  // Process source items
  const processor = (async () => {
    for await (const item of iterate(source)) {
      scheduleEmit(item)
    }

    // Flush final pending item
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    if (resolver && pending !== undefined) {
      resolver(pending)
    }
  })()

  // Yield debounced items
  try {
    while (true) {
      const item = await new Promise<T | undefined>((resolve) => {
        resolver = resolve
      })

      if (item === undefined) break
      yield item
    }
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    await processor.catch(() => {})
  }
}

// ============================================================================
// Buffering Utilities
// ============================================================================

/**
 * Buffer items and emit in batches based on size or time
 *
 * @example
 * ```typescript
 * // Emit batches of 100 or every 5 seconds
 * const batched = buffer(source, { maxSize: 100, maxWaitMs: 5000 })
 * ```
 */
export async function* buffer<T>(
  source: AsyncIterableSource<T>,
  options: BufferOptions
): AsyncGenerator<T[], void, undefined> {
  const { maxSize = 100, maxWaitMs } = options

  let batch: T[] = []
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let flushResolver: (() => void) | undefined

  const scheduleFlush = () => {
    if (maxWaitMs && !timeoutId) {
      timeoutId = setTimeout(() => {
        timeoutId = undefined
        if (flushResolver) {
          flushResolver()
        }
      }, maxWaitMs)
    }
  }

  for await (const item of iterate(source)) {
    batch.push(item)
    scheduleFlush()

    if (batch.length >= maxSize) {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
      yield batch
      batch = []
    }
  }

  // Flush remaining
  if (timeoutId) {
    clearTimeout(timeoutId)
  }
  if (batch.length > 0) {
    yield batch
  }
}

/**
 * Buffer options
 */
export interface BufferOptions {
  /**
   * Maximum batch size before forcing emit
   */
  maxSize?: number

  /**
   * Maximum time to wait before emitting partial batch
   */
  maxWaitMs?: number
}

// ============================================================================
// Utility Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
