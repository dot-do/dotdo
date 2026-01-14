/**
 * Analytics Client Implementation
 *
 * Segment-compatible analytics client for dotdo.
 * Handles event buffering, batching, and delivery with:
 * - Automatic batching and flushing
 * - Retry logic with exponential backoff for network errors
 * - Backpressure handling with configurable queue limits
 * - Debug mode for observability
 * - Memory-efficient buffer management
 *
 * @module @dotdo/compat/analytics/analytics
 */

import type { AnalyticsEvent, EventContext } from './types'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default maximum events to buffer before auto-flush */
const DEFAULT_BATCH_SIZE = 20

/** Default flush interval in milliseconds */
const DEFAULT_FLUSH_INTERVAL = 10000

/** Default maximum retries for failed network requests */
const DEFAULT_MAX_RETRIES = 3

/** Default maximum queue size for backpressure handling */
const DEFAULT_MAX_QUEUE_SIZE = 1000

/** Default Segment API endpoint */
const DEFAULT_ENDPOINT = 'https://api.segment.io/v1/batch'

/** Base delay for exponential backoff in milliseconds */
const RETRY_BASE_DELAY_MS = 100

// ============================================================================
// TYPES
// ============================================================================

/**
 * Analytics client configuration
 *
 * @example
 * ```typescript
 * const config: AnalyticsConfig = {
 *   writeKey: 'your-write-key',
 *   batchSize: 20,
 *   flushInterval: 10000,
 *   maxRetries: 3,
 *   maxQueueSize: 1000,
 *   debug: true,
 *   onError: (error, events) => console.error('Failed to send events', error)
 * }
 * ```
 */
export interface AnalyticsConfig {
  /** Segment write key (required) */
  writeKey: string
  /** Maximum events to buffer before auto-flush (default: 20) */
  batchSize?: number
  /** Flush interval in milliseconds (default: 10000) */
  flushInterval?: number
  /** Maximum retries for failed sends (default: 3) */
  maxRetries?: number
  /** Maximum queue size for backpressure (default: 1000) */
  maxQueueSize?: number
  /** Endpoint URL override */
  endpoint?: string
  /** Default context to merge with all events */
  defaultContext?: Partial<EventContext>
  /** Enable debug logging */
  debug?: boolean
  /** Error callback for failed flushes after all retries exhausted */
  onError?: (error: Error, events: AnalyticsEvent[]) => void
  /** Callback when events are dropped due to backpressure */
  onDrop?: (events: AnalyticsEvent[], reason: string) => void
}

/**
 * Batch payload for sending to server
 */
export interface BatchPayload {
  batch: AnalyticsEvent[]
  sentAt: string
  writeKey: string
}

/**
 * Delivery callback result
 */
export interface DeliveryResult {
  /** Whether the delivery was successful */
  success: boolean
  /** Error message if delivery failed */
  error?: string
  /** Number of retry attempts made before success or failure */
  retriesUsed?: number
  /** Number of events that were dropped due to backpressure */
  eventsDropped?: number
}

/**
 * Analytics client metrics for observability
 */
export interface AnalyticsMetrics {
  /** Total events enqueued since creation */
  eventsEnqueued: number
  /** Total events successfully sent */
  eventsSent: number
  /** Total events dropped due to backpressure */
  eventsDropped: number
  /** Total flush attempts */
  flushAttempts: number
  /** Total successful flushes */
  flushSuccesses: number
  /** Total failed flushes (after retries) */
  flushFailures: number
  /** Current buffer size */
  bufferSize: number
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return crypto.randomUUID()
}

/**
 * Generate ISO timestamp
 */
export function generateTimestamp(): string {
  return new Date().toISOString()
}

// ============================================================================
// ANALYTICS CLIENT IMPLEMENTATION
// ============================================================================

/**
 * Analytics client for event collection and delivery
 *
 * Features:
 * - Automatic batching and flushing based on size or time interval
 * - Retry logic with exponential backoff for network failures
 * - Backpressure handling to prevent memory exhaustion
 * - Debug mode for development and troubleshooting
 * - Metrics collection for observability
 *
 * @example
 * ```typescript
 * const analytics = new AnalyticsClient({
 *   writeKey: 'your-write-key',
 *   batchSize: 20,
 *   flushInterval: 10000,
 *   debug: true,
 *   onError: (err, events) => {
 *     console.error('Failed to send', events.length, 'events:', err)
 *   }
 * })
 *
 * analytics.track({
 *   event: 'Product Viewed',
 *   userId: 'user-123',
 *   properties: { productId: 'prod-456' }
 * })
 *
 * await analytics.flush()
 * ```
 */
export class AnalyticsClient {
  // Configuration (required fields explicitly typed)
  private readonly config: Required<
    Pick<AnalyticsConfig, 'writeKey' | 'batchSize' | 'flushInterval' | 'maxRetries' | 'maxQueueSize' | 'debug'>
  > &
    Pick<AnalyticsConfig, 'endpoint' | 'defaultContext' | 'onError' | 'onDrop'>

  // Event buffer
  private buffer: AnalyticsEvent[] = []

  // Timer for periodic flushing
  private flushTimer: ReturnType<typeof setInterval> | null = null

  // Lifecycle state
  private destroyed = false

  // Metrics tracking
  private metrics: AnalyticsMetrics = {
    eventsEnqueued: 0,
    eventsSent: 0,
    eventsDropped: 0,
    flushAttempts: 0,
    flushSuccesses: 0,
    flushFailures: 0,
    bufferSize: 0,
  }

  // Prevent concurrent flushes
  private flushInProgress = false

  constructor(config: AnalyticsConfig) {
    // Validate writeKey
    if (!config.writeKey || config.writeKey.trim() === '') {
      throw new Error('writeKey is required and must be non-empty')
    }

    // Store config with defaults using constants
    this.config = {
      writeKey: config.writeKey,
      batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
      flushInterval: config.flushInterval ?? DEFAULT_FLUSH_INTERVAL,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      maxQueueSize: config.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
      debug: config.debug ?? false,
      endpoint: config.endpoint,
      defaultContext: config.defaultContext,
      onError: config.onError,
      onDrop: config.onDrop,
    }

    // Initialize empty buffer
    this.buffer = []

    this.log('Client initialized', {
      batchSize: this.config.batchSize,
      flushInterval: this.config.flushInterval,
      maxRetries: this.config.maxRetries,
      maxQueueSize: this.config.maxQueueSize,
    })

    // Set up flush interval timer
    this.startFlushTimer()
  }

  /**
   * Log a debug message if debug mode is enabled
   */
  private log(message: string, data?: Record<string, unknown>): void {
    if (this.config.debug) {
      const timestamp = new Date().toISOString()
      const prefix = `[Analytics ${timestamp}]`
      if (data) {
        console.log(prefix, message, data)
      } else {
        console.log(prefix, message)
      }
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
    }
    this.flushTimer = setInterval(() => {
      this.flush()
    }, this.config.flushInterval)
  }

  private resetFlushTimer(): void {
    this.startFlushTimer()
  }

  /**
   * Track an event
   */
  track(event: Omit<AnalyticsEvent, 'type'> & { event: string }): void {
    this.enqueue({
      ...event,
      type: 'track',
    } as AnalyticsEvent)
  }

  /**
   * Identify a user
   */
  identify(event: Omit<AnalyticsEvent, 'type'>): void {
    this.enqueue({
      ...event,
      type: 'identify',
    } as AnalyticsEvent)
  }

  /**
   * Track a page view
   */
  page(event?: Omit<AnalyticsEvent, 'type'>): void {
    this.enqueue({
      ...(event || {}),
      type: 'page',
    } as AnalyticsEvent)
  }

  /**
   * Track a screen view (mobile)
   */
  screen(event: Omit<AnalyticsEvent, 'type'>): void {
    this.enqueue({
      ...event,
      type: 'screen',
    } as AnalyticsEvent)
  }

  /**
   * Associate user with a group
   */
  group(event: Omit<AnalyticsEvent, 'type'> & { groupId: string }): void {
    this.enqueue({
      ...event,
      type: 'group',
    } as AnalyticsEvent)
  }

  /**
   * Alias a user ID to another
   */
  alias(event: { userId: string; previousId: string }): void {
    this.enqueue({
      ...event,
      type: 'alias',
    } as AnalyticsEvent)
  }

  /**
   * Enqueue an event to the buffer
   *
   * Handles backpressure by dropping oldest events when the queue
   * exceeds maxQueueSize.
   *
   * @throws Error if the client has been destroyed
   */
  enqueue(event: AnalyticsEvent): void {
    if (this.destroyed) {
      throw new Error('Client has been destroyed')
    }

    // Auto-generate messageId if missing
    const enrichedEvent: AnalyticsEvent = {
      ...event,
      messageId: (event as any).messageId || generateMessageId(),
      timestamp: (event as any).timestamp || generateTimestamp(),
    }

    // Merge defaultContext with event context
    if (this.config.defaultContext) {
      ;(enrichedEvent as any).context = {
        ...this.config.defaultContext,
        ...(event as any).context,
      }
    }

    // Handle backpressure: if queue is at max capacity, drop oldest events
    if (this.buffer.length >= this.config.maxQueueSize) {
      // Calculate how many to drop to make room
      const toDrop = Math.max(1, Math.floor(this.config.maxQueueSize * 0.1))
      const droppedEvents = this.buffer.splice(0, toDrop)

      this.metrics.eventsDropped += droppedEvents.length

      this.log('Backpressure: dropping oldest events', {
        dropped: droppedEvents.length,
        bufferSize: this.buffer.length,
        maxQueueSize: this.config.maxQueueSize,
      })

      // Notify via callback if provided
      if (this.config.onDrop) {
        this.config.onDrop(droppedEvents, 'Queue full - backpressure applied')
      }
    }

    this.buffer.push(enrichedEvent)
    this.metrics.eventsEnqueued++
    this.metrics.bufferSize = this.buffer.length

    this.log('Event enqueued', {
      type: event.type,
      bufferSize: this.buffer.length,
    })

    // Trigger flush if buffer size reached
    if (this.buffer.length >= this.config.batchSize) {
      this.flush()
    }
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.buffer.length
  }

  /**
   * Flush buffered events to server
   *
   * Implements retry logic with exponential backoff for network errors.
   * HTTP errors (4xx, 5xx) are not retried as they indicate server-side issues.
   *
   * @returns Promise resolving to delivery result with success status and metrics
   */
  async flush(): Promise<DeliveryResult> {
    // Return early if buffer is empty
    if (this.buffer.length === 0) {
      this.log('Flush skipped: buffer empty')
      return { success: true }
    }

    // Prevent concurrent flushes - return early if one is in progress
    if (this.flushInProgress) {
      this.log('Flush skipped: flush already in progress')
      return { success: true }
    }

    this.flushInProgress = true
    this.metrics.flushAttempts++

    // Capture current buffer and clear it atomically
    const batch = this.buffer
    this.buffer = []
    this.metrics.bufferSize = 0

    this.log('Flushing events', { count: batch.length })

    // Create batch payload
    const payload: BatchPayload = {
      batch,
      sentAt: generateTimestamp(),
      writeKey: this.config.writeKey,
    }

    const endpoint = this.config.endpoint || DEFAULT_ENDPOINT

    let retriesUsed = 0
    let lastError: Error | undefined

    // Implement retry logic with exponential backoff - only retry on network errors
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Add exponential backoff delay for retries
        if (attempt > 0) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
          this.log('Retry attempt', { attempt, delay })
          await this.sleep(delay)
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })

        if (response.ok) {
          // Success - update metrics and reset timer
          this.metrics.eventsSent += batch.length
          this.metrics.flushSuccesses++
          this.flushInProgress = false

          this.log('Flush successful', {
            eventsSent: batch.length,
            retriesUsed: attempt > 0 ? attempt : 0,
          })

          // Reset flush timer on successful flush
          this.resetFlushTimer()
          return {
            success: true,
            retriesUsed: attempt > 0 ? attempt : undefined,
          }
        } else {
          // HTTP error - don't retry, return failure immediately
          const errorMessage = `HTTP ${response.status}: ${response.statusText}`
          lastError = new Error(errorMessage)
          this.metrics.flushFailures++
          this.flushInProgress = false

          this.log('Flush failed with HTTP error', {
            status: response.status,
            statusText: response.statusText,
          })

          // Notify error callback
          if (this.config.onError) {
            this.config.onError(lastError, batch)
          }

          this.resetFlushTimer()
          return {
            success: false,
            error: errorMessage,
          }
        }
      } catch (error) {
        // Network error - will retry
        lastError = error instanceof Error ? error : new Error(String(error))
        retriesUsed = attempt + 1

        this.log('Flush network error', {
          attempt: attempt + 1,
          maxRetries: this.config.maxRetries,
          error: lastError.message,
        })
      }
    }

    // All retries exhausted
    this.metrics.flushFailures++
    this.flushInProgress = false

    this.log('Flush failed after all retries', {
      retriesUsed,
      error: lastError?.message,
    })

    // Notify error callback
    if (this.config.onError && lastError) {
      this.config.onError(lastError, batch)
    }

    // Reset timer even on failure
    this.resetFlushTimer()

    return {
      success: false,
      error: lastError?.message,
      retriesUsed: retriesUsed > 0 ? retriesUsed : undefined,
    }
  }

  /**
   * Sleep for a specified duration (used for retry backoff)
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Destroy client, stopping timers and flushing remaining events
   */
  async destroy(): Promise<void> {
    // Make idempotent
    if (this.destroyed) {
      return
    }

    this.destroyed = true

    // Clear the interval timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    // Flush remaining events
    if (this.buffer.length > 0) {
      // Temporarily allow flushing after destroyed flag is set
      const eventsToFlush = [...this.buffer]
      this.buffer = []

      const payload: BatchPayload = {
        batch: eventsToFlush,
        sentAt: generateTimestamp(),
        writeKey: this.config.writeKey,
      }

      const endpoint = this.config.endpoint || 'https://api.segment.io/v1/batch'

      try {
        await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
      } catch {
        // Ignore errors during destroy
      }
    }
  }
}
