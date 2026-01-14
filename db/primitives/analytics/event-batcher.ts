/**
 * EventBatcher - Event batching primitive with replay support
 *
 * Provides efficient event batching with:
 * - Automatic flush on batch size threshold
 * - Automatic flush on time interval
 * - Retry with configurable backoff (fixed or exponential)
 * - Dead-letter queue for failed events
 * - Event replay capability with filtering and idempotency
 *
 * @module db/primitives/analytics/event-batcher
 */

// ============================================================================
// TYPES
// ============================================================================

export interface BatchConfig {
  /** Maximum number of events before automatic flush */
  maxBatchSize: number
  /** Time in milliseconds before automatic flush */
  flushIntervalMs: number
  /** Maximum number of retry attempts */
  maxRetries: number
  /** Initial retry delay in milliseconds */
  retryDelayMs: number
  /** Backoff strategy: 'fixed' | 'exponential' */
  backoffStrategy: 'fixed' | 'exponential'
  /** Maximum retry delay (for exponential backoff) */
  maxRetryDelayMs?: number
  /** Maximum queue size (optional, defaults to 100000) */
  maxQueueSize?: number
}

export interface BatchEvent {
  id: string
  type: string
  timestamp: Date
  data: Record<string, unknown>
}

export interface FlushResult {
  success: boolean
  eventCount: number
  duration: number
  error?: Error
  retryCount?: number
}

export interface BatchStats {
  totalEvents: number
  totalFlushes: number
  successfulFlushes: number
  failedFlushes: number
  retriedFlushes: number
  eventsDropped: number
  averageFlushDuration: number
  lastFlushTime?: Date
}

/**
 * Dead letter queue entry for failed events
 */
export interface DeadLetterEntry {
  /** Unique ID for this DLQ entry */
  id: string
  /** The original events that failed */
  events: BatchEvent[]
  /** Error that caused the failure */
  error: Error
  /** Number of delivery attempts */
  attempts: number
  /** When the events were first queued */
  firstAttemptAt: Date
  /** When the events were last attempted */
  lastAttemptAt: Date
  /** Number of replay attempts */
  replayAttempts: number
  /** Whether replay succeeded */
  replaySucceeded?: boolean
  /** When replay succeeded */
  replaySucceededAt?: Date
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for replaying events
 */
export interface ReplayOptions {
  /** Replay only entries matching these IDs */
  entryIds?: string[]
  /** Replay only entries with errors matching this pattern */
  errorPattern?: RegExp
  /** Replay only entries created after this time */
  since?: Date
  /** Replay only entries created before this time */
  until?: Date
  /** Maximum number of entries to replay */
  limit?: number
  /** Maximum retry attempts for replay */
  maxRetries?: number
  /** Retry delay for replay */
  retryDelayMs?: number
  /** Clear successfully replayed entries from DLQ */
  clearOnSuccess?: boolean
}

/**
 * Result of a replay operation
 */
export interface ReplayResult {
  /** Total entries attempted */
  totalEntries: number
  /** Successfully replayed entries */
  succeeded: number
  /** Failed replay attempts */
  failed: number
  /** Entries that were skipped (e.g., already replayed) */
  skipped: number
  /** Errors encountered during replay */
  errors: Array<{ entryId: string; error: Error }>
  /** Duration of replay operation */
  durationMs: number
}

/**
 * Dead letter queue statistics
 */
export interface DeadLetterStats {
  /** Total entries in the DLQ */
  totalEntries: number
  /** Total events across all entries */
  totalEvents: number
  /** Entries that have never been replayed */
  pendingReplay: number
  /** Entries that were successfully replayed */
  replayedSuccessfully: number
  /** Oldest entry timestamp */
  oldestEntry?: Date
  /** Newest entry timestamp */
  newestEntry?: Date
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: BatchConfig = {
  maxBatchSize: 100,
  flushIntervalMs: 10000,
  maxRetries: 3,
  retryDelayMs: 100,
  backoffStrategy: 'exponential',
  maxRetryDelayMs: 30000,
  maxQueueSize: 100000,
}

const MAX_BATCH_SIZE = 100000
const MAX_FLUSH_INTERVAL = 3600000 // 1 hour

// ============================================================================
// EVENT BATCHER CLASS
// ============================================================================

export class EventBatcher {
  readonly config: BatchConfig

  private queue: BatchEvent[] = []
  private _isClosed = false
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private flushLock: Promise<FlushResult> | null = null
  private readonly handler: (events: BatchEvent[]) => Promise<void>

  // Statistics
  private stats: BatchStats = {
    totalEvents: 0,
    totalFlushes: 0,
    successfulFlushes: 0,
    failedFlushes: 0,
    retriedFlushes: 0,
    eventsDropped: 0,
    averageFlushDuration: 0,
  }
  private flushDurations: number[] = []

  // Dead letter queue
  private deadLetterQueue: Map<string, DeadLetterEntry> = new Map()
  private dlqIdCounter = 0

  constructor(
    config: Partial<BatchConfig>,
    handler: (events: BatchEvent[]) => Promise<void>
  ) {
    // Validate config
    const maxBatchSize = config.maxBatchSize ?? DEFAULT_CONFIG.maxBatchSize
    if (maxBatchSize < 1) {
      throw new Error('maxBatchSize must be at least 1')
    }

    const flushIntervalMs = config.flushIntervalMs ?? DEFAULT_CONFIG.flushIntervalMs
    if (flushIntervalMs < 0) {
      throw new Error('flushIntervalMs must be non-negative')
    }

    const maxRetries = config.maxRetries ?? DEFAULT_CONFIG.maxRetries
    if (maxRetries < 0) {
      throw new Error('maxRetries must be non-negative')
    }

    this.config = {
      maxBatchSize: Math.min(maxBatchSize, MAX_BATCH_SIZE),
      flushIntervalMs: Math.min(flushIntervalMs, MAX_FLUSH_INTERVAL),
      maxRetries,
      retryDelayMs: config.retryDelayMs ?? DEFAULT_CONFIG.retryDelayMs,
      backoffStrategy: config.backoffStrategy ?? DEFAULT_CONFIG.backoffStrategy,
      maxRetryDelayMs: config.maxRetryDelayMs ?? DEFAULT_CONFIG.maxRetryDelayMs,
      maxQueueSize: config.maxQueueSize ?? DEFAULT_CONFIG.maxQueueSize,
    }

    this.handler = handler

    // Start flush interval timer if configured
    if (this.config.flushIntervalMs > 0) {
      this.startFlushTimer()
    }
  }

  get queueSize(): number {
    return this.queue.length
  }

  get isClosed(): boolean {
    return this._isClosed
  }

  /**
   * Add an event to the batch queue
   */
  async add(event: BatchEvent): Promise<void> {
    if (this._isClosed) {
      throw new Error('EventBatcher is closed')
    }

    // Validate event
    if (!event.id) {
      throw new Error('Event must have an id')
    }
    if (!event.timestamp) {
      throw new Error('Event must have a timestamp')
    }

    this.stats.totalEvents++
    this.queue.push(event)

    // Check if we need to flush due to batch size
    if (this.queue.length >= this.config.maxBatchSize) {
      // Trigger async flush (don't await to avoid blocking)
      this.triggerAutoFlush()
    }
  }

  /**
   * Manually flush all queued events
   */
  async flush(): Promise<FlushResult> {
    if (this._isClosed) {
      throw new Error('EventBatcher is closed')
    }

    // If another flush is in progress, wait for it
    if (this.flushLock) {
      return this.flushLock
    }

    // Empty queue check
    if (this.queue.length === 0) {
      return {
        success: true,
        eventCount: 0,
        duration: 0,
        retryCount: 0,
      }
    }

    // Take ownership of the queue
    const batch = [...this.queue]
    this.queue = []

    // Reset the interval timer after manual flush
    this.resetFlushTimer()

    this.flushLock = this.doFlush(batch)

    try {
      return await this.flushLock
    } finally {
      this.flushLock = null
    }
  }

  /**
   * Get current batch statistics
   */
  getStats(): BatchStats {
    return {
      ...this.stats,
      averageFlushDuration:
        this.flushDurations.length > 0
          ? this.flushDurations.reduce((a, b) => a + b, 0) / this.flushDurations.length
          : 0,
    }
  }

  /**
   * Close the batcher, flushing any remaining events
   */
  async close(): Promise<void> {
    if (this._isClosed) {
      return
    }

    this.stopFlushTimer()

    // Flush any remaining events
    if (this.queue.length > 0) {
      const batch = [...this.queue]
      this.queue = []
      await this.doFlush(batch)
    }

    this._isClosed = true
  }

  // ============================================================================
  // DEAD LETTER QUEUE API
  // ============================================================================

  /**
   * Get all dead letter queue entries
   */
  getDeadLetterEntries(): DeadLetterEntry[] {
    return Array.from(this.deadLetterQueue.values())
  }

  /**
   * Get a specific dead letter queue entry by ID
   */
  getDeadLetterEntry(id: string): DeadLetterEntry | undefined {
    return this.deadLetterQueue.get(id)
  }

  /**
   * Get dead letter queue statistics
   */
  getDeadLetterStats(): DeadLetterStats {
    const entries = Array.from(this.deadLetterQueue.values())
    const totalEvents = entries.reduce((sum, e) => sum + e.events.length, 0)
    const pendingReplay = entries.filter((e) => !e.replaySucceeded).length
    const replayedSuccessfully = entries.filter((e) => e.replaySucceeded).length

    let oldestEntry: Date | undefined
    let newestEntry: Date | undefined

    for (const entry of entries) {
      if (!oldestEntry || entry.firstAttemptAt < oldestEntry) {
        oldestEntry = entry.firstAttemptAt
      }
      if (!newestEntry || entry.firstAttemptAt > newestEntry) {
        newestEntry = entry.firstAttemptAt
      }
    }

    return {
      totalEntries: entries.length,
      totalEvents,
      pendingReplay,
      replayedSuccessfully,
      oldestEntry,
      newestEntry,
    }
  }

  /**
   * Replay failed events from the dead letter queue
   */
  async replay(options: ReplayOptions = {}): Promise<ReplayResult> {
    const startTime = Date.now()
    const result: ReplayResult = {
      totalEntries: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      durationMs: 0,
    }

    // Get entries to replay based on filters
    let entries = this.filterDeadLetterEntries(options)

    // Apply limit
    if (options.limit && options.limit > 0) {
      entries = entries.slice(0, options.limit)
    }

    result.totalEntries = entries.length

    const maxRetries = options.maxRetries ?? this.config.maxRetries
    const retryDelayMs = options.retryDelayMs ?? this.config.retryDelayMs

    for (const entry of entries) {
      // Skip already successfully replayed entries (idempotency)
      if (entry.replaySucceeded) {
        result.skipped++
        continue
      }

      // Attempt replay with retries
      let success = false
      let lastError: Error | undefined

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          await this.sleep(retryDelayMs)
        }

        try {
          await this.handler(entry.events)
          success = true
          break
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
        }
      }

      // Update entry
      entry.replayAttempts++
      entry.lastAttemptAt = new Date()

      if (success) {
        entry.replaySucceeded = true
        entry.replaySucceededAt = new Date()
        result.succeeded++

        // Clear from DLQ if requested
        if (options.clearOnSuccess) {
          this.deadLetterQueue.delete(entry.id)
        }
      } else {
        result.failed++
        if (lastError) {
          result.errors.push({ entryId: entry.id, error: lastError })
        }
      }
    }

    result.durationMs = Date.now() - startTime
    return result
  }

  /**
   * Replay a single dead letter queue entry by ID
   */
  async replayEntry(entryId: string, options: Omit<ReplayOptions, 'entryIds' | 'limit'> = {}): Promise<ReplayResult> {
    return this.replay({ ...options, entryIds: [entryId], limit: 1 })
  }

  /**
   * Clear dead letter queue entries
   */
  clearDeadLetterQueue(options: {
    /** Clear only entries matching these IDs */
    entryIds?: string[]
    /** Clear only successfully replayed entries */
    onlySuccessful?: boolean
    /** Clear all entries */
    all?: boolean
  } = {}): number {
    let cleared = 0

    if (options.all) {
      cleared = this.deadLetterQueue.size
      this.deadLetterQueue.clear()
      return cleared
    }

    if (options.entryIds) {
      for (const id of options.entryIds) {
        if (this.deadLetterQueue.delete(id)) {
          cleared++
        }
      }
      return cleared
    }

    if (options.onlySuccessful) {
      for (const [id, entry] of this.deadLetterQueue) {
        if (entry.replaySucceeded) {
          this.deadLetterQueue.delete(id)
          cleared++
        }
      }
      return cleared
    }

    return cleared
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.queue.length > 0 && !this.flushLock) {
        this.triggerAutoFlush()
      }
    }, this.config.flushIntervalMs)
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  private resetFlushTimer(): void {
    this.stopFlushTimer()
    if (this.config.flushIntervalMs > 0) {
      this.startFlushTimer()
    }
  }

  private triggerAutoFlush(): void {
    if (this.flushLock) return

    const batch = this.queue.splice(0, this.config.maxBatchSize)
    if (batch.length === 0) return

    this.flushLock = this.doFlush(batch)
    this.flushLock
      .catch(() => {
        // Error already handled in doFlush
      })
      .finally(() => {
        this.flushLock = null
      })
  }

  private async doFlush(batch: BatchEvent[]): Promise<FlushResult> {
    const startTime = Date.now()
    let retryCount = 0
    let lastError: Error | undefined
    let delay = this.config.retryDelayMs

    // Try initial attempt + retries
    const maxAttempts = 1 + this.config.maxRetries

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        retryCount++
        this.stats.retriedFlushes++

        // Wait before retry
        await this.sleep(delay)

        // Calculate next delay
        if (this.config.backoffStrategy === 'exponential') {
          delay = Math.min(delay * 2, this.config.maxRetryDelayMs ?? 30000)
        }
      }

      try {
        // Check if error is non-retryable
        if (lastError && (lastError as Error & { retryable?: boolean }).retryable === false) {
          break
        }

        await this.handler(batch)

        // Success!
        const duration = Date.now() - startTime
        this.stats.totalFlushes++
        this.stats.successfulFlushes++
        this.stats.lastFlushTime = new Date()
        this.flushDurations.push(duration)

        // Keep only last 100 durations
        if (this.flushDurations.length > 100) {
          this.flushDurations.shift()
        }

        return {
          success: true,
          eventCount: batch.length,
          duration,
          retryCount,
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // Don't retry non-retryable errors
        if ((lastError as Error & { retryable?: boolean }).retryable === false) {
          break
        }
      }
    }

    // All attempts failed
    const duration = Date.now() - startTime
    this.stats.totalFlushes++
    this.stats.failedFlushes++

    // Add to dead letter queue for replay
    this.addToDeadLetterQueue(batch, lastError!)

    // Note: Events are stored in DLQ for replay, NOT put back in main queue.
    // Use replay() to re-process failed events. This prevents double-processing
    // and allows filtering/controlled replay of specific failed batches.

    return {
      success: false,
      eventCount: batch.length,
      duration,
      error: lastError,
      retryCount,
    }
  }

  private addToDeadLetterQueue(events: BatchEvent[], error: Error): void {
    const id = `dlq_${++this.dlqIdCounter}_${Date.now()}`
    const now = new Date()

    const entry: DeadLetterEntry = {
      id,
      events: [...events],
      error,
      attempts: 1 + (this.config.maxRetries > 0 ? this.config.maxRetries : 0),
      firstAttemptAt: now,
      lastAttemptAt: now,
      replayAttempts: 0,
    }

    this.deadLetterQueue.set(id, entry)
  }

  private filterDeadLetterEntries(options: ReplayOptions): DeadLetterEntry[] {
    let entries = Array.from(this.deadLetterQueue.values())

    // Filter by entry IDs
    if (options.entryIds && options.entryIds.length > 0) {
      const idSet = new Set(options.entryIds)
      entries = entries.filter((e) => idSet.has(e.id))
    }

    // Filter by error pattern
    if (options.errorPattern) {
      entries = entries.filter((e) => options.errorPattern!.test(e.error.message))
    }

    // Filter by time range
    if (options.since) {
      entries = entries.filter((e) => e.firstAttemptAt >= options.since!)
    }
    if (options.until) {
      entries = entries.filter((e) => e.firstAttemptAt <= options.until!)
    }

    // Sort by first attempt time (oldest first)
    entries.sort((a, b) => a.firstAttemptAt.getTime() - b.firstAttemptAt.getTime())

    return entries
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new EventBatcher instance
 */
export function createEventBatcher(
  config: Partial<BatchConfig>,
  handler: (events: BatchEvent[]) => Promise<void>
): EventBatcher {
  return new EventBatcher(config, handler)
}
