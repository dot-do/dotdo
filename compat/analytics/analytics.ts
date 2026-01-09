/**
 * Analytics Client Implementation
 *
 * Segment-compatible analytics client for dotdo.
 * Handles event buffering, batching, and delivery.
 *
 * @module @dotdo/compat/analytics/analytics
 */

import type { AnalyticsEvent, EventContext } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Analytics client configuration
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
  /** Endpoint URL override */
  endpoint?: string
  /** Default context to merge with all events */
  defaultContext?: Partial<EventContext>
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
  success: boolean
  error?: string
  retriesUsed?: number
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
 * @example
 * ```typescript
 * const analytics = new AnalyticsClient({
 *   writeKey: 'your-write-key',
 *   batchSize: 20,
 *   flushInterval: 10000,
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
  private readonly config: Required<
    Pick<AnalyticsConfig, 'writeKey' | 'batchSize' | 'flushInterval' | 'maxRetries'>
  > &
    Pick<AnalyticsConfig, 'endpoint' | 'defaultContext'>
  private buffer: AnalyticsEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private destroyed = false

  constructor(config: AnalyticsConfig) {
    // Validate writeKey
    if (!config.writeKey || config.writeKey.trim() === '') {
      throw new Error('writeKey is required and must be non-empty')
    }

    // Store config with defaults
    this.config = {
      writeKey: config.writeKey,
      batchSize: config.batchSize ?? 20,
      flushInterval: config.flushInterval ?? 10000,
      maxRetries: config.maxRetries ?? 3,
      endpoint: config.endpoint,
      defaultContext: config.defaultContext,
    }

    // Initialize empty buffer
    this.buffer = []

    // Set up flush interval timer
    this.startFlushTimer()
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

    this.buffer.push(enrichedEvent)

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
   */
  async flush(): Promise<DeliveryResult> {
    // Return early if buffer is empty
    if (this.buffer.length === 0) {
      return { success: true }
    }

    // Capture current buffer and clear it
    const batch = [...this.buffer]
    this.buffer = []

    // Create batch payload
    const payload: BatchPayload = {
      batch,
      sentAt: generateTimestamp(),
      writeKey: this.config.writeKey,
    }

    const endpoint = this.config.endpoint || 'https://api.segment.io/v1/batch'

    let retriesUsed = 0
    let lastError: string | undefined

    // Implement retry logic - only retry on network errors, not HTTP errors
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })

        if (response.ok) {
          // Reset flush timer on successful flush
          this.resetFlushTimer()
          return {
            success: true,
            retriesUsed: attempt > 0 ? attempt : undefined,
          }
        } else {
          // HTTP error - don't retry, return failure immediately
          lastError = `HTTP ${response.status}: ${response.statusText}`
          this.resetFlushTimer()
          return {
            success: false,
            error: lastError,
          }
        }
      } catch (error) {
        // Network error - retry
        lastError = error instanceof Error ? error.message : 'Unknown error'
        retriesUsed = attempt + 1
      }
    }

    // All retries exhausted - reset timer even on failure
    this.resetFlushTimer()

    return {
      success: false,
      error: lastError,
      retriesUsed: retriesUsed > 0 ? retriesUsed : undefined,
    }
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
