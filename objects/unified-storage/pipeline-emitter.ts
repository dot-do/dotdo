/**
 * PipelineEmitter - Fire-and-forget event emission to Cloudflare Pipeline
 *
 * Sends events to Cloudflare Pipeline in fire-and-forget mode:
 * - Emits events immediately (before local SQLite persistence)
 * - Generates idempotency keys to prevent duplicates
 * - Batches events for efficiency
 * - Handles failures gracefully (retry logic with exponential backoff)
 * - Queues events for retry when Pipeline fails (no data loss)
 * - Sends events to DLQ after max retries exhausted
 * - Notifies clients/health checks of degraded mode
 * - Replays queued events when Pipeline is restored
 * - Applies backpressure when retry queue grows too large
 *
 * @example
 * ```typescript
 * const emitter = new PipelineEmitter(env.EVENTS, {
 *   namespace: 'customer-tenant',
 *   batchSize: 1000,
 *   flushInterval: 60_000,
 * })
 *
 * // Fire-and-forget emission
 * emitter.emit('thing.created', 'things', { $id: 'customer-123', name: 'Alice' })
 *
 * // Explicit flush when needed
 * await emitter.flush()
 *
 * // Clean up
 * await emitter.close()
 * ```
 */

import type { PipelineEmitterMetrics } from './metrics'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Event verb types for unified storage operations
 */
export type EventVerb = 'thing.created' | 'thing.updated' | 'thing.deleted' | string

/**
 * Emit options for additional metadata
 */
export interface EmitOptions {
  /** Whether the payload is a delta (partial update) */
  isDelta?: boolean
}

/**
 * DLQ metadata attached to failed events
 */
export interface DLQMetadata {
  /** Number of retry attempts made */
  retryCount: number
  /** Last error message */
  lastError: string
  /** Timestamp when event was sent to DLQ */
  failedAt: string
}

/**
 * Emitted event structure sent to Pipeline
 */
export interface EmittedEvent {
  /** Event type verb (e.g., 'thing.created') */
  verb: EventVerb
  /** Store/table name (e.g., 'things') */
  store: string
  /** Event payload data */
  payload: unknown
  /** ISO 8601 timestamp */
  timestamp: string
  /** Idempotency key for deduplication */
  idempotencyKey: string
  /** Event metadata */
  _meta: {
    /** Namespace/tenant identifier */
    namespace: string
    /** Whether payload is a delta */
    isDelta?: boolean
  }
  /** Sequence number for ordering guarantees */
  _seq?: number
  /** DLQ metadata (present on failed events) */
  _dlq?: DLQMetadata
}

/**
 * Health status for the emitter
 */
export type HealthStatus = 'healthy' | 'degraded'

/**
 * Callback for health status changes
 */
export type HealthChangeCallback = (status: HealthStatus) => void

/**
 * Callback for backpressure state changes
 */
export type BackpressureChangeCallback = (active: boolean) => void

/**
 * Overflow policy when retry queue is full
 */
export type OverflowPolicy = 'drop-newest' | 'drop-oldest'

/**
 * Local storage interface for persistence
 */
export interface LocalStorage {
  put(key: string, value: unknown): Promise<void>
  get<T>(key: string): Promise<T | undefined>
  delete(key: string): Promise<boolean>
  list(): Promise<Map<string, unknown>>
}

/**
 * Health details for the emitter
 */
export interface HealthDetails {
  /** Current health status */
  status: HealthStatus
  /** Number of events in retry queue */
  retryQueueSize: number
  /** Number of consecutive failures */
  consecutiveFailures: number
  /** Last error encountered */
  lastError?: string
  /** Timestamp when degraded mode started */
  degradedSinceMs?: number
  /** Duration in degraded mode */
  degradedDurationMs?: number
}

/**
 * Retry queue metrics
 */
export interface RetryQueueMetrics {
  /** Current queue size */
  size: number
  /** Maximum queue size */
  maxSize: number
  /** Queue utilization percentage */
  utilizationPercent: number
}

/**
 * Internal retry event with tracking metadata
 */
interface RetryEvent extends EmittedEvent {
  /** Number of retry attempts made */
  retryCount: number
}

/**
 * Configuration for PipelineEmitter
 */
export interface PipelineEmitterConfig {
  /** Namespace/tenant identifier */
  namespace: string
  /** Batch count before flush - defaults to 1000 */
  batchSize?: number
  /** Batch bytes before flush - defaults to 1MB */
  batchBytes?: number
  /** Flush interval in ms - defaults to 60000 (0 = immediate) */
  flushInterval?: number
  /** Maximum retry attempts - defaults to 3 */
  maxRetries?: number
  /** Initial retry delay in ms - defaults to 1000 */
  retryDelay?: number
  /** Use exponential backoff for retries - defaults to false */
  exponentialBackoff?: boolean
  /** Dead-letter queue for failed events */
  deadLetterQueue?: Pipeline
  /** Metrics collector for observability */
  metrics?: PipelineEmitterMetrics
  /** Local storage for retry queue persistence */
  localStorage?: LocalStorage
  /** Whether to persist retry queue to local storage */
  persistRetryQueue?: boolean
  /** Health change callback */
  onHealthChange?: HealthChangeCallback
  /** Maximum retry queue size for backpressure */
  maxRetryQueueSize?: number
  /** Whether to reject on backpressure */
  rejectOnBackpressure?: boolean
  /** Backpressure change callback */
  onBackpressureChange?: BackpressureChangeCallback
  /** Overflow policy when retry queue is full */
  overflowPolicy?: OverflowPolicy
}

/**
 * Resolved config with defaults applied
 */
export interface ResolvedPipelineEmitterConfig {
  readonly namespace: string
  readonly batchSize: number
  readonly batchBytes: number
  readonly flushInterval: number
  readonly maxRetries: number
  readonly retryDelay: number
  readonly exponentialBackoff: boolean
  readonly deadLetterQueue?: Pipeline
  readonly localStorage?: LocalStorage
  readonly persistRetryQueue: boolean
  readonly onHealthChange?: HealthChangeCallback
  readonly maxRetryQueueSize: number
  readonly rejectOnBackpressure: boolean
  readonly onBackpressureChange?: BackpressureChangeCallback
  readonly overflowPolicy: OverflowPolicy
}

// Re-export unified Pipeline interface from shared types
export type { Pipeline } from './types/pipeline'
import type { Pipeline } from './types/pipeline'

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG = {
  batchSize: 1000,
  batchBytes: 1024 * 1024, // 1MB
  flushInterval: 60_000, // 60 seconds
  maxRetries: 3,
  retryDelay: 1000,
  exponentialBackoff: false,
  persistRetryQueue: false,
  maxRetryQueueSize: Infinity,
  rejectOnBackpressure: false,
  overflowPolicy: 'drop-newest' as OverflowPolicy,
} as const

const RETRY_QUEUE_STORAGE_KEY = 'pipeline_retry_queue'

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Estimate size of data in bytes when JSON-serialized
 */
function estimateBytes(data: unknown): number {
  return JSON.stringify(data).length
}

/**
 * Sleep for a given number of milliseconds
 * Uses setTimeout to work correctly with fake timers in tests
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// PIPELINE EMITTER CLASS
// ============================================================================

/**
 * PipelineEmitter - Fire-and-forget event emission to Cloudflare Pipeline
 *
 * Features resilient pipeline failure handling:
 * - Retry queue for failed events
 * - Persistent retry queue via localStorage
 * - Health status tracking (healthy/degraded)
 * - Backpressure management
 * - DLQ with metadata
 * - FIFO ordering with sequence numbers
 */
export class PipelineEmitter {
  private pipeline: Pipeline
  private _config: ResolvedPipelineEmitterConfig
  private buffer: EmittedEvent[] = []
  private _bufferBytes: number = 0
  private flushTimer?: ReturnType<typeof setInterval>
  private retryTimer?: ReturnType<typeof setTimeout>
  private _closed: boolean = false
  private metrics?: PipelineEmitterMetrics

  // Resilience state
  private _retryQueue: RetryEvent[] = []
  private _failedEvents: EmittedEvent[] = []
  private _consecutiveFailures: number = 0
  private _lastError?: string
  private _degradedSince?: number
  private _isBackpressured: boolean = false
  private _sequenceNumber: number = 0
  private _isRetrying: boolean = false
  private _flushLock: Promise<void> | null = null

  constructor(pipeline: Pipeline, config: PipelineEmitterConfig) {
    this.pipeline = pipeline
    this.metrics = config.metrics

    // Merge config with defaults
    this._config = Object.freeze({
      namespace: config.namespace,
      batchSize: config.batchSize ?? DEFAULT_CONFIG.batchSize,
      batchBytes: config.batchBytes ?? DEFAULT_CONFIG.batchBytes,
      flushInterval: config.flushInterval ?? DEFAULT_CONFIG.flushInterval,
      maxRetries: config.maxRetries ?? DEFAULT_CONFIG.maxRetries,
      retryDelay: config.retryDelay ?? DEFAULT_CONFIG.retryDelay,
      exponentialBackoff: config.exponentialBackoff ?? DEFAULT_CONFIG.exponentialBackoff,
      deadLetterQueue: config.deadLetterQueue,
      localStorage: config.localStorage,
      persistRetryQueue: config.persistRetryQueue ?? DEFAULT_CONFIG.persistRetryQueue,
      onHealthChange: config.onHealthChange,
      maxRetryQueueSize: config.maxRetryQueueSize ?? DEFAULT_CONFIG.maxRetryQueueSize,
      rejectOnBackpressure: config.rejectOnBackpressure ?? DEFAULT_CONFIG.rejectOnBackpressure,
      onBackpressureChange: config.onBackpressureChange,
      overflowPolicy: config.overflowPolicy ?? DEFAULT_CONFIG.overflowPolicy,
    })

    // Restore retry queue from local storage if available
    this.restoreRetryQueue()

    // Start auto-flush timer if interval > 0
    this.startAutoFlush()
  }

  /**
   * Restore retry queue from localStorage on initialization
   */
  private restoreRetryQueue(): void {
    if (!this._config.localStorage) return

    // Use setTimeout to avoid blocking constructor
    setTimeout(async () => {
      try {
        const stored = await this._config.localStorage!.get<string>(RETRY_QUEUE_STORAGE_KEY)
        if (stored) {
          const events = JSON.parse(stored) as RetryEvent[]
          this._retryQueue = events
          // Start retry processing
          this.scheduleRetry()
        }
      } catch {
        // Best effort restore
      }
    }, 0)
  }

  /**
   * Persist retry queue to localStorage
   */
  private async persistRetryQueueToStorage(): Promise<void> {
    if (!this._config.localStorage) return

    try {
      await this._config.localStorage.put(RETRY_QUEUE_STORAGE_KEY, JSON.stringify(this._retryQueue))
    } catch {
      // Best effort persist
    }
  }

  /**
   * Set metrics collector (can be set after construction)
   */
  setMetrics(metrics: PipelineEmitterMetrics): void {
    this.metrics = metrics
    // Update buffer gauge with current state
    this.metrics.eventsBatched.set(this.buffer.length)
  }

  /**
   * Get the emitter configuration (readonly/frozen)
   */
  get config(): ResolvedPipelineEmitterConfig {
    return this._config
  }

  /**
   * Get current buffer event count
   */
  get bufferSize(): number {
    return this.buffer.length
  }

  /**
   * Get current buffer size in bytes
   */
  get bufferBytes(): number {
    return this._bufferBytes
  }

  /**
   * Check if the emitter is closed
   */
  get closed(): boolean {
    return this._closed
  }

  /**
   * Get the retry queue (for testing/inspection)
   */
  get retryQueue(): RetryEvent[] {
    return this._retryQueue
  }

  /**
   * Get failed events that couldn't be sent (no DLQ configured)
   */
  get failedEvents(): EmittedEvent[] {
    return this._failedEvents
  }

  /**
   * Check if the emitter is in degraded mode
   */
  get isDegraded(): boolean {
    return this._retryQueue.length > 0 || this._consecutiveFailures > 0
  }

  /**
   * Get the current health status
   */
  get healthStatus(): HealthStatus {
    return this.isDegraded ? 'degraded' : 'healthy'
  }

  /**
   * Check if backpressure is active
   */
  get isBackpressured(): boolean {
    return this._isBackpressured
  }

  /**
   * Get detailed health information
   */
  getHealthDetails(): HealthDetails {
    const now = Date.now()
    return {
      status: this.healthStatus,
      retryQueueSize: this._retryQueue.length,
      consecutiveFailures: this._consecutiveFailures,
      lastError: this._lastError,
      degradedSinceMs: this._degradedSince,
      degradedDurationMs: this._degradedSince ? now - this._degradedSince : undefined,
    }
  }

  /**
   * Get retry queue metrics for backpressure monitoring
   */
  getRetryQueueMetrics(): RetryQueueMetrics {
    const maxSize = this._config.maxRetryQueueSize === Infinity ? 0 : this._config.maxRetryQueueSize
    return {
      size: this._retryQueue.length,
      maxSize: this._config.maxRetryQueueSize,
      utilizationPercent: maxSize > 0 ? Math.round((this._retryQueue.length / maxSize) * 100) : 0,
    }
  }

  /**
   * Start the auto-flush interval timer
   */
  private startAutoFlush(): void {
    if (this.flushTimer || this._closed) {
      return
    }

    if (this._config.flushInterval > 0) {
      this.flushTimer = setInterval(() => {
        if (this.buffer.length > 0) {
          this.triggerFlush()
        }
      }, this._config.flushInterval)
    }
  }

  /**
   * Generate idempotency key for event deduplication
   * Format: ${entityId}:${operation}:${timestamp}
   */
  private generateIdempotencyKey(verb: EventVerb, payload: unknown): string {
    const timestamp = Date.now()
    const entityId = (payload as { $id?: string })?.$id || 'unknown'
    const operation = verb.split('.')[1] || verb // Extract 'created' from 'thing.created'
    return `${entityId}:${operation}:${timestamp}`
  }

  /**
   * Get the next sequence number
   */
  private getNextSequence(): number {
    return ++this._sequenceNumber
  }

  /**
   * Update health status and notify callback
   */
  private updateHealthStatus(wasDegraded: boolean): void {
    const nowDegraded = this.isDegraded

    if (wasDegraded !== nowDegraded) {
      if (nowDegraded) {
        this._degradedSince = Date.now()
      } else {
        this._degradedSince = undefined
      }
      this._config.onHealthChange?.(nowDegraded ? 'degraded' : 'healthy')
    }
  }

  /**
   * Update backpressure status and notify callback
   */
  private updateBackpressureStatus(): void {
    const shouldBackpressure =
      this._config.maxRetryQueueSize !== Infinity &&
      this._retryQueue.length >= this._config.maxRetryQueueSize

    if (shouldBackpressure !== this._isBackpressured) {
      this._isBackpressured = shouldBackpressure
      this._config.onBackpressureChange?.(this._isBackpressured)
    }
  }

  /**
   * Add event to retry queue with overflow handling
   */
  private addToRetryQueue(event: RetryEvent): void {
    const maxSize = this._config.maxRetryQueueSize

    // Check backpressure BEFORE adding
    if (maxSize !== Infinity && this._retryQueue.length >= maxSize) {
      // Queue is full, apply overflow policy
      if (this._config.overflowPolicy === 'drop-newest') {
        // Drop the new event (don't add it)
        // Update backpressure status since we're at capacity
        this._isBackpressured = true
        this._config.onBackpressureChange?.(true)
        return
      } else {
        // Drop oldest - remove from front
        this._retryQueue.shift()
      }
    }

    this._retryQueue.push(event)
    this.updateBackpressureStatus()
  }

  /**
   * Try to emit an event, returns false if backpressure prevents it
   * @returns true if event was accepted, false if rejected due to backpressure
   */
  tryEmit(verb: EventVerb, store: string, payload: unknown, options?: EmitOptions): boolean {
    if (this._closed) {
      return false
    }

    if (this._config.rejectOnBackpressure && this._isBackpressured) {
      return false
    }

    this.emit(verb, store, payload, options)
    return true
  }

  /**
   * Emit an event (fire-and-forget)
   *
   * @param verb - Event type (e.g., 'thing.created')
   * @param store - Store/table name
   * @param payload - Event data payload
   * @param options - Additional emit options
   */
  emit(verb: EventVerb, store: string, payload: unknown, options?: EmitOptions): void {
    if (this._closed) {
      return
    }

    const event: EmittedEvent = {
      verb,
      store,
      payload,
      timestamp: new Date().toISOString(),
      idempotencyKey: this.generateIdempotencyKey(verb, payload),
      _meta: {
        namespace: this._config.namespace,
        ...(options?.isDelta && { isDelta: true }),
      },
      _seq: this.getNextSequence(),
    }

    // Track bytes
    const eventBytes = estimateBytes(event)
    this._bufferBytes += eventBytes
    this.buffer.push(event)

    // Update metrics
    this.metrics?.eventsEmitted.inc()
    this.metrics?.eventsBatched.set(this.buffer.length)

    // Check if we should flush immediately (flushInterval === 0)
    // or if batch thresholds are reached
    if (this._config.flushInterval === 0) {
      this.triggerFlush()
    } else if (
      this.buffer.length >= this._config.batchSize ||
      this._bufferBytes >= this._config.batchBytes
    ) {
      this.triggerFlush()
    }
  }

  /**
   * Trigger a flush - takes events synchronously, flushes async (fire-and-forget)
   */
  private triggerFlush(): void {
    if (this.buffer.length === 0) {
      return
    }

    // Take events synchronously
    const events = this.buffer.slice()
    this.buffer = []
    this._bufferBytes = 0

    // Update metrics for batched count
    this.metrics?.eventsBatched.set(0)

    // Flush asynchronously (fire-and-forget)
    this.doFlush(events).catch(() => {
      // Errors handled internally by doFlush
    })
  }

  /**
   * Flush all buffered events to the pipeline
   * This is an explicit flush that waits for completion
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return
    }

    // Take and clear buffer atomically
    const events = this.buffer.slice()
    this.buffer = []
    this._bufferBytes = 0

    // Update metrics for batched count
    this.metrics?.eventsBatched.set(0)

    await this.doFlush(events)
  }

  /**
   * Schedule a retry of queued events
   */
  private scheduleRetry(): void {
    // Don't schedule if already retrying, no events, closed, or timer already exists
    if (this._isRetrying || this._retryQueue.length === 0 || this._closed || this.retryTimer) {
      return
    }

    // Calculate delay based on retry count of first event
    const firstEvent = this._retryQueue[0]
    let delay = this._config.retryDelay

    if (this._config.exponentialBackoff && firstEvent.retryCount > 0) {
      delay = this._config.retryDelay * Math.pow(2, firstEvent.retryCount - 1)
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined // Clear timer before processing
      this.processRetryQueue()
    }, delay)
  }

  /**
   * Process the retry queue
   */
  private async processRetryQueue(): Promise<void> {
    if (this._retryQueue.length === 0 || this._closed) {
      return
    }

    this._isRetrying = true
    const wasDegraded = this.isDegraded

    // Take all events from retry queue
    const events = this._retryQueue.slice()
    this._retryQueue = []

    try {
      // Sort by sequence number to maintain FIFO order
      events.sort((a, b) => (a._seq || 0) - (b._seq || 0))

      await this.pipeline.send(events)

      // Success - clear consecutive failures
      this._consecutiveFailures = 0
      this._lastError = undefined

      // Clear persisted queue
      if (this._config.localStorage) {
        await this._config.localStorage.delete(RETRY_QUEUE_STORAGE_KEY)
      }

      // Update metrics
      this.metrics?.flushCount.inc()

      // Update health status
      this.updateBackpressureStatus()
      this.updateHealthStatus(wasDegraded)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this._lastError = err.message

      // Separate events into retry queue vs DLQ
      const toRetry: RetryEvent[] = []
      const toDLQ: RetryEvent[] = []

      for (const event of events) {
        const retryEvent: RetryEvent = {
          ...event,
          retryCount: (event.retryCount || 0) + 1,
        }

        if (retryEvent.retryCount >= this._config.maxRetries) {
          toDLQ.push(retryEvent)
        } else {
          toRetry.push(retryEvent)
        }
      }

      // Add events back to retry queue
      for (const event of toRetry) {
        this.addToRetryQueue(event)
      }

      // Send exhausted events to DLQ in a single batch
      if (toDLQ.length > 0) {
        await this.sendToDLQ(toDLQ, err.message)
      }

      // Persist updated queue
      await this.persistRetryQueueToStorage()

      // Update health status
      this.updateHealthStatus(wasDegraded)

      // Schedule next retry
      this._isRetrying = false
      this.scheduleRetry()
      return
    }

    this._isRetrying = false

    // Check if more events were added during processing
    if (this._retryQueue.length > 0) {
      this.scheduleRetry()
    }
  }

  /**
   * Send events to DLQ with metadata
   * Batches all events into a single DLQ send for efficiency
   */
  private async sendToDLQ(events: EmittedEvent[], errorMessage: string): Promise<void> {
    if (events.length === 0) return

    // Add DLQ metadata to events
    const dlqEvents = events.map((event) => ({
      ...event,
      _dlq: {
        retryCount: (event as RetryEvent).retryCount || this._config.maxRetries,
        lastError: errorMessage,
        failedAt: new Date().toISOString(),
      },
    }))

    if (this._config.deadLetterQueue) {
      try {
        // Send all events in a single batch
        await this._config.deadLetterQueue.send(dlqEvents)
        this.metrics?.dlqCount.inc()
      } catch {
        // DLQ also failed, store locally
        this._failedEvents.push(...dlqEvents)
      }
    } else {
      // No DLQ configured, store locally
      this._failedEvents.push(...dlqEvents)
    }
  }

  // Pending DLQ events to batch
  private _pendingDLQEvents: { event: EmittedEvent; error: string }[] = []
  private _dlqFlushTimer?: ReturnType<typeof setTimeout>

  /**
   * Queue an event for batched DLQ sending
   */
  private queueForDLQ(event: EmittedEvent, errorMessage: string): void {
    this._pendingDLQEvents.push({ event, error: errorMessage })

    // Schedule a batched flush if not already scheduled
    if (!this._dlqFlushTimer) {
      this._dlqFlushTimer = setTimeout(() => {
        this.flushDLQBatch()
      }, 10) // Small delay to batch concurrent failures
    }
  }

  /**
   * Flush pending DLQ events in a batch
   */
  private async flushDLQBatch(): Promise<void> {
    this._dlqFlushTimer = undefined
    if (this._pendingDLQEvents.length === 0) return

    const toSend = this._pendingDLQEvents
    this._pendingDLQEvents = []

    // Group by error message and send batched
    const events = toSend.map((e) => e.event)
    const errorMessage = toSend[0].error // Use first error message

    await this.sendToDLQ(events, errorMessage)
  }

  /**
   * Internal flush implementation with retry logic
   *
   * Key behavior:
   * - Events start with retryCount=0
   * - Each attempt increments retryCount
   * - Events go to retry queue after initial failure
   * - Events go to DLQ only after retryCount >= maxRetries
   * - If retry queue has events, new events go directly to retry queue
   *   to maintain strict FIFO ordering (head-of-line blocking)
   * - Uses a lock to serialize flushes for FIFO ordering
   */
  private async doFlush(events: EmittedEvent[]): Promise<void> {
    if (events.length === 0) {
      return
    }

    // Wait for any previous flush to complete (FIFO ordering)
    if (this._flushLock) {
      await this._flushLock
    }

    // FIFO: If there are events waiting in retry queue, add these to the back.
    // This ensures strict ordering - earlier events must be delivered first.
    if (this._retryQueue.length > 0) {
      for (const event of events) {
        const retryEvent: RetryEvent = {
          ...event,
          retryCount: 0, // First "attempt" - will increment on actual retry
        }
        this.addToRetryQueue(retryEvent)
      }
      await this.persistRetryQueueToStorage()
      this.updateBackpressureStatus()
      // Schedule retry if not already scheduled
      this.scheduleRetry()
      return
    }

    // Create a lock for this flush
    let releaseLock: () => void
    this._flushLock = new Promise((resolve) => {
      releaseLock = resolve
    })

    const startTime = performance.now()
    const wasDegraded = this.isDegraded
    let lastError: Error | undefined

    // Only do ONE attempt here, retries are handled by the retry queue
    try {
      await this.pipeline.send(events)

      // Success - record metrics
      const duration = performance.now() - startTime
      this.metrics?.flushCount.inc()
      this.metrics?.flushLatency.observe(duration)

      // Clear consecutive failures on success
      this._consecutiveFailures = 0
      this._lastError = undefined
      this.updateHealthStatus(wasDegraded)

      // Release lock
      this._flushLock = null
      releaseLock!()

      return // Success
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      this._consecutiveFailures++
      this._lastError = lastError.message

      // Track retry
      this.metrics?.retryCount.inc()

      // Update health status
      this.updateHealthStatus(wasDegraded)
    }

    // Initial send failed - add events to retry queue
    this.metrics?.errorsCount.inc()

    // Record the flush latency even on failure
    const duration = performance.now() - startTime
    this.metrics?.flushLatency.observe(duration)

    // Separate events into retry queue vs DLQ
    const toRetry: RetryEvent[] = []
    const toDLQ: RetryEvent[] = []

    for (const event of events) {
      const retryEvent: RetryEvent = {
        ...event,
        retryCount: (event as RetryEvent).retryCount !== undefined
          ? (event as RetryEvent).retryCount + 1
          : 1,
      }

      if (retryEvent.retryCount >= this._config.maxRetries) {
        toDLQ.push(retryEvent)
      } else {
        toRetry.push(retryEvent)
      }
    }

    // Add events to retry queue
    for (const event of toRetry) {
      this.addToRetryQueue(event)
    }

    // Send exhausted events to DLQ in a single batch
    if (toDLQ.length > 0) {
      await this.sendToDLQ(toDLQ, lastError?.message || 'Unknown error')
    }

    // Persist retry queue
    await this.persistRetryQueueToStorage()

    // Update backpressure status
    this.updateBackpressureStatus()

    // Release lock BEFORE scheduling retry
    this._flushLock = null
    releaseLock!()

    // Schedule retry processing
    this.scheduleRetry()
  }

  /**
   * Close the emitter
   * Flushes any remaining events and stops auto-flush timer
   */
  async close(): Promise<void> {
    if (this._closed) {
      return
    }

    this._closed = true

    // Stop the interval timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = undefined
    }

    // Stop retry timer
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }

    // Flush remaining events
    if (this.buffer.length > 0) {
      try {
        await this.flush()
      } catch {
        // Best effort flush on close - don't throw
      }
    }
  }
}
