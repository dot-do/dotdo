/**
 * BatchWriter - Generic batched event writer with deduplication
 *
 * Provides efficient batched writing with:
 * - Configurable batch size and time thresholds
 * - Message ID-based deduplication with configurable window
 * - Automatic flush on threshold or interval
 * - Error handling with configurable retry logic
 * - Statistics and monitoring
 *
 * @module db/primitives/batch-writer
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of a flush operation
 */
export interface FlushResult {
  success: boolean
  count: number
  error?: Error
  duration?: number
}

/**
 * Handler interface for processing batches
 */
export interface FlushHandler<T> {
  flush(items: T[]): Promise<FlushResult>
}

/**
 * Statistics about the batch writer's operation
 */
export interface BatchWriterStats {
  totalWrites: number
  totalFlushes: number
  failedFlushes: number
  duplicatesDropped: number
  itemsDropped: number
  dedupCacheSize: number
  queueSize: number
}

/**
 * Item wrapper for internal queue management
 */
export interface BatchItem<T> {
  item: T
  messageId: string
  timestamp: number
}

/**
 * Configuration options for BatchWriter
 */
export interface BatchWriterOptions<T> {
  /** Handler that processes batched items */
  handler: FlushHandler<T>
  /** Number of items to trigger automatic flush (default: 20) */
  batchSize?: number
  /** Interval in milliseconds to trigger automatic flush (default: 10000) */
  flushInterval?: number
  /** Maximum queue size before dropping oldest items (default: 10000) */
  maxQueueSize?: number
  /** Number of retry attempts on failure (default: 3) */
  retries?: number
  /** Initial delay between retries in milliseconds (default: 100) */
  retryDelay?: number
  /** Backoff strategy for retries (default: 'exponential') */
  retryBackoff?: 'fixed' | 'exponential'
  /** Time window in milliseconds for deduplication (default: 60000) */
  dedupWindow?: number
  /** Whether to requeue items on error (default: false) */
  requeueOnError?: boolean
  /** Callback on successful flush */
  onFlush?: (result: FlushResult) => void
  /** Callback on write */
  onWrite?: (item: T) => void
  /** Callback on error with failed items */
  onError?: (error: Error, items: T[]) => void
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface InternalOptions<T> {
  handler: FlushHandler<T>
  batchSize: number
  flushInterval: number
  maxQueueSize: number
  retries: number
  retryDelay: number
  retryBackoff: 'fixed' | 'exponential'
  dedupWindow: number
  requeueOnError: boolean
  onFlush?: (result: FlushResult) => void
  onWrite?: (item: T) => void
  onError?: (error: Error, items: T[]) => void
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateId(): string {
  const hex = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) {
      id += '-'
    }
    id += hex[Math.floor(Math.random() * 16)]
  }
  return id
}

// ============================================================================
// BATCH WRITER CLASS
// ============================================================================

/**
 * BatchWriter - Generic batched event writer with deduplication
 *
 * @example
 * ```typescript
 * const writer = createBatchWriter({
 *   handler: {
 *     async flush(items) {
 *       await db.insertMany(items)
 *       return { success: true, count: items.length }
 *     }
 *   },
 *   batchSize: 50,
 *   flushInterval: 5000,
 *   dedupWindow: 60000,
 * })
 *
 * await writer.write({ id: 'msg_1', data: 'hello' })
 * await writer.write({ id: 'msg_2', data: 'world' })
 *
 * // Auto-flush after 50 items or 5 seconds, or manually:
 * await writer.flush()
 *
 * // Clean up
 * await writer.close()
 * ```
 */
export class BatchWriter<T> {
  readonly options: InternalOptions<T>

  private queue: T[] = []
  private seenMessageIds: Map<string, number> = new Map()
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private flushLock: Promise<FlushResult> | null = null
  private closed = false

  // Statistics
  private stats = {
    totalWrites: 0,
    totalFlushes: 0,
    failedFlushes: 0,
    duplicatesDropped: 0,
    itemsDropped: 0,
  }

  constructor(options: BatchWriterOptions<T>) {
    if (!options.handler) {
      throw new Error('handler is required')
    }

    this.options = {
      handler: options.handler,
      batchSize: options.batchSize ?? 20,
      flushInterval: options.flushInterval ?? 10000,
      maxQueueSize: options.maxQueueSize ?? 10000,
      retries: options.retries ?? 3,
      retryDelay: options.retryDelay ?? 100,
      retryBackoff: options.retryBackoff ?? 'exponential',
      dedupWindow: options.dedupWindow ?? 60000,
      requeueOnError: options.requeueOnError ?? false,
      onFlush: options.onFlush,
      onWrite: options.onWrite,
      onError: options.onError,
    }

    this.startFlushTimer()
  }

  // ============================================================================
  // TIMER MANAGEMENT
  // ============================================================================

  private startFlushTimer(): void {
    if (this.options.flushInterval > 0) {
      this.flushTimer = setInterval(() => {
        if (this.queue.length > 0) {
          this.flush().catch((err) => {
            this.options.onError?.(err, [])
          })
        }
      }, this.options.flushInterval)
    }
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  // ============================================================================
  // DEDUPLICATION
  // ============================================================================

  private isDuplicate(messageId: string): boolean {
    const lastSeen = this.seenMessageIds.get(messageId)
    const now = Date.now()

    if (lastSeen && now - lastSeen < this.options.dedupWindow) {
      return true
    }

    return false
  }

  private markSeen(messageId: string): void {
    this.seenMessageIds.set(messageId, Date.now())
    this.cleanupDedupCache()
  }

  private cleanupDedupCache(): void {
    // Periodically clean up expired entries
    if (this.seenMessageIds.size > 1000) {
      const now = Date.now()
      const expiry = this.options.dedupWindow
      for (const [key, timestamp] of this.seenMessageIds) {
        if (now - timestamp >= expiry) {
          this.seenMessageIds.delete(key)
        }
      }
    }
  }

  // ============================================================================
  // QUEUE MANAGEMENT
  // ============================================================================

  private addToQueue(item: T): void {
    // Enforce max queue size (drop oldest)
    while (this.queue.length >= this.options.maxQueueSize) {
      this.queue.shift()
      this.stats.itemsDropped++
    }

    this.queue.push(item)
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Current queue size
   */
  get queueSize(): number {
    return this.queue.length
  }

  /**
   * Whether the writer is closed
   */
  get isClosed(): boolean {
    return this.closed
  }

  /**
   * Get the message ID from an item, checking for common ID properties
   */
  private getItemId(item: T): string | undefined {
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>
      if (typeof obj.id === 'string') return obj.id
      if (typeof obj.messageId === 'string') return obj.messageId
    }
    return undefined
  }

  /**
   * Write an item to the batch queue
   *
   * @param item - The item to write
   * @param messageId - Optional message ID for deduplication (uses item.id if not provided)
   * @throws Error if the writer is closed
   */
  async write(item: T, messageId?: string): Promise<void> {
    if (this.closed) {
      throw new Error('BatchWriter is closed')
    }

    // Determine message ID for deduplication
    const dedupKey = messageId ?? this.getItemId(item) ?? generateId()

    // Check deduplication
    if (this.isDuplicate(dedupKey)) {
      this.stats.duplicatesDropped++
      return
    }

    // Mark as seen
    this.markSeen(dedupKey)

    // Add to queue
    this.addToQueue(item)
    this.stats.totalWrites++

    // Call onWrite callback
    this.options.onWrite?.(item)

    // Auto-flush if batch size reached
    if (this.queue.length >= this.options.batchSize) {
      this.flush().catch((err) => {
        this.options.onError?.(err, [])
      })
    }
  }

  /**
   * Flush all queued items to the handler
   *
   * @returns Result of the flush operation
   * @throws Error if the writer is closed
   */
  async flush(): Promise<FlushResult> {
    if (this.closed) {
      throw new Error('BatchWriter is closed')
    }

    // If another flush is in progress, wait for it
    if (this.flushLock) {
      return this.flushLock
    }

    // Empty queue case
    if (this.queue.length === 0) {
      const result: FlushResult = { success: true, count: 0 }
      this.options.onFlush?.(result)
      return result
    }

    // Take ownership of the queue
    const batch = [...this.queue]
    this.queue = []

    // Create the flush promise
    this.flushLock = this.doFlush(batch)

    try {
      return await this.flushLock
    } finally {
      this.flushLock = null
    }
  }

  private async doFlush(batch: T[]): Promise<FlushResult> {
    const startTime = Date.now()
    let attempts = 0
    let delay = this.options.retryDelay
    let lastError: Error | undefined

    // Total attempts = 1 initial + retries
    const maxAttempts = 1 + this.options.retries

    while (attempts < maxAttempts) {
      if (attempts > 0) {
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delay))
        if (this.options.retryBackoff === 'exponential') {
          delay *= 2
        }
      }

      attempts++

      try {
        const handlerResult = await this.options.handler.flush(batch)
        this.stats.totalFlushes++

        const result: FlushResult = {
          ...handlerResult,
          duration: Date.now() - startTime,
        }

        this.options.onFlush?.(result)
        return result
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }

    // All attempts failed
    this.stats.failedFlushes++

    // Requeue items if configured
    if (this.options.requeueOnError) {
      this.queue = [...batch, ...this.queue]
    }

    // Call error callback
    if (lastError) {
      this.options.onError?.(lastError, batch)
    }

    const result: FlushResult = {
      success: false,
      count: 0,
      error: lastError,
      duration: Date.now() - startTime,
    }

    this.options.onFlush?.(result)
    return result
  }

  /**
   * Get statistics about the batch writer
   */
  getStats(): BatchWriterStats {
    return {
      ...this.stats,
      dedupCacheSize: this.seenMessageIds.size,
      queueSize: this.queue.length,
    }
  }

  /**
   * Close the batch writer, flushing any pending items
   *
   * Safe to call multiple times (idempotent)
   */
  async close(): Promise<void> {
    if (this.closed) {
      return
    }

    this.stopFlushTimer()

    // Flush any remaining items (bypass closed check)
    if (this.queue.length > 0) {
      const batch = [...this.queue]
      this.queue = []
      await this.doFlush(batch)
    }

    this.closed = true
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new BatchWriter instance
 *
 * @example
 * ```typescript
 * const writer = createBatchWriter({
 *   handler: {
 *     async flush(items) {
 *       await db.insertMany(items)
 *       return { success: true, count: items.length }
 *     }
 *   },
 *   batchSize: 50,
 * })
 * ```
 */
export function createBatchWriter<T>(
  options: BatchWriterOptions<T>
): BatchWriter<T> {
  return new BatchWriter(options)
}
