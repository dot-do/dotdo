/**
 * Analytics Stream Integration
 *
 * Cloudflare Pipelines streaming for real-time analytics export.
 * Provides a Segment-like API that emits events to StreamBridge.
 *
 * Features:
 * - Multiple destinations with routing
 * - Format adapters (JSON, NDJSON, Protobuf)
 * - Dead letter queue for failed events
 * - Per-destination retry logic
 * - Metrics tracking (sent, failed, retried)
 *
 * @module @dotdo/compat/analytics/stream-integration
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Cloudflare Pipeline interface
 */
export interface Pipeline {
  send(events: unknown[]): Promise<void>
}

/**
 * Analytics stream event (emitted to pipeline)
 */
export interface AnalyticsStreamEvent {
  operation: 'insert'
  table: 'analytics_events'
  data: {
    type: string
    event?: string
    userId?: string
    anonymousId?: string
    properties?: Record<string, unknown>
    traits?: Record<string, unknown>
    timestamp: string
    messageId: string
  }
  timestamp: number
  metadata?: Record<string, unknown>
}

/**
 * BeforeSend callback for transforms
 */
export type BeforeSendCallback = (event: AnalyticsStreamEvent) => AnalyticsStreamEvent | null

// ============================================================================
// FORMAT ADAPTERS
// ============================================================================

/**
 * Supported output formats for destinations
 */
export type OutputFormat = 'json' | 'ndjson' | 'protobuf'

/**
 * Format adapter interface - transforms events to specific wire format
 */
export interface FormatAdapter {
  /** Format identifier */
  readonly format: OutputFormat
  /** Encode events to the target format */
  encode(events: AnalyticsStreamEvent[]): unknown[]
  /** Content type for HTTP destinations */
  contentType: string
}

/**
 * JSON format adapter - default format, returns events as-is
 */
export const jsonAdapter: FormatAdapter = {
  format: 'json',
  contentType: 'application/json',
  encode(events: AnalyticsStreamEvent[]): unknown[] {
    return events
  },
}

/**
 * NDJSON (Newline Delimited JSON) format adapter
 * Each event is serialized as a separate JSON line
 */
export const ndjsonAdapter: FormatAdapter = {
  format: 'ndjson',
  contentType: 'application/x-ndjson',
  encode(events: AnalyticsStreamEvent[]): unknown[] {
    // For pipeline send, we return individual stringified events
    // The receiving end joins with newlines
    return events.map((e) => JSON.stringify(e))
  },
}

/**
 * Protobuf format adapter (placeholder - requires schema definition)
 * Encodes events using Protocol Buffers for efficient wire format
 */
export const protobufAdapter: FormatAdapter = {
  format: 'protobuf',
  contentType: 'application/x-protobuf',
  encode(events: AnalyticsStreamEvent[]): unknown[] {
    // Placeholder: In production, this would use a protobuf library
    // For now, we encode as a simplified binary-like format
    return events.map((e) => ({
      _proto: true,
      _encoded: btoa(JSON.stringify(e)),
    }))
  },
}

/**
 * Get a format adapter by name
 */
export function getFormatAdapter(format: OutputFormat): FormatAdapter {
  switch (format) {
    case 'json':
      return jsonAdapter
    case 'ndjson':
      return ndjsonAdapter
    case 'protobuf':
      return protobufAdapter
    default:
      return jsonAdapter
  }
}

// ============================================================================
// DESTINATION TYPES
// ============================================================================

/**
 * Event type filter - determines which events are sent to a destination
 */
export type EventTypeFilter = 'all' | 'track' | 'identify' | 'page' | string[]

/**
 * Retry configuration for a destination
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelayMs?: number
  /** Maximum delay in ms between retries (default: 30000) */
  maxDelayMs?: number
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number
}

/**
 * Destination configuration for multi-destination streaming
 */
export interface DestinationConfig {
  /** Unique identifier for this destination */
  id: string
  /** Pipeline binding for this destination */
  pipeline: Pipeline
  /** Output format (default: 'json') */
  format?: OutputFormat
  /** Event type filter (default: 'all') */
  filter?: EventTypeFilter
  /** Transform callback specific to this destination */
  transform?: BeforeSendCallback
  /** Retry configuration */
  retry?: RetryConfig
  /** Whether this destination is enabled (default: true) */
  enabled?: boolean
}

/**
 * Dead letter queue entry for failed events
 */
export interface DeadLetterEntry {
  /** Original event that failed */
  event: AnalyticsStreamEvent
  /** Destination ID where it failed */
  destinationId: string
  /** Error message */
  error: string
  /** Number of retry attempts made */
  attempts: number
  /** Timestamp when first failed */
  failedAt: number
  /** Timestamp of last retry attempt */
  lastAttemptAt: number
}

/**
 * Metrics tracking for analytics stream
 */
export interface StreamMetrics {
  /** Total events sent successfully */
  sent: number
  /** Total events that failed */
  failed: number
  /** Total retry attempts */
  retried: number
  /** Events currently in dead letter queue */
  deadLetterCount: number
  /** Metrics per destination */
  byDestination: Record<
    string,
    {
      sent: number
      failed: number
      retried: number
    }
  >
}

/**
 * Analytics stream client configuration
 */
export interface AnalyticsStreamConfig {
  /** Pipeline binding for streaming (single destination mode) */
  pipeline?: Pipeline
  /** Multiple destinations configuration */
  destinations?: DestinationConfig[]
  /** Batch size before auto-flush (default: 100) */
  batchSize?: number
  /** Auto-flush interval in ms (default: 5000) */
  flushInterval?: number
  /** Transform callback before sending (applies to all destinations) */
  beforeSend?: BeforeSendCallback
  /** Default metadata to include with all events */
  defaultMetadata?: Record<string, unknown>
  /** Dead letter queue size limit (default: 1000) */
  deadLetterQueueSize?: number
  /** Callback when events are added to dead letter queue */
  onDeadLetter?: (entry: DeadLetterEntry) => void
}

/**
 * Track event input
 */
export interface TrackEventInput {
  event: string
  userId?: string
  anonymousId?: string
  properties?: Record<string, unknown>
}

/**
 * Identify event input
 */
export interface IdentifyEventInput {
  userId: string
  traits?: Record<string, unknown>
}

/**
 * Page event input
 */
export interface PageEventInput {
  name?: string
  category?: string
  properties?: Record<string, unknown>
  anonymousId?: string
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return crypto.randomUUID()
}

/**
 * Generate ISO timestamp
 */
function generateTimestamp(): string {
  return new Date().toISOString()
}

// ============================================================================
// INTERNAL DESTINATION WRAPPER
// ============================================================================

/**
 * Internal destination state with resolved configuration
 */
interface ResolvedDestination {
  id: string
  pipeline: Pipeline
  format: OutputFormat
  adapter: FormatAdapter
  filter: EventTypeFilter
  transform?: BeforeSendCallback
  retry: Required<RetryConfig>
  enabled: boolean
}

/**
 * Default retry configuration values
 */
const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
}

/**
 * Resolve a destination configuration with defaults
 */
function resolveDestination(config: DestinationConfig): ResolvedDestination {
  const format = config.format ?? 'json'
  return {
    id: config.id,
    pipeline: config.pipeline,
    format,
    adapter: getFormatAdapter(format),
    filter: config.filter ?? 'all',
    transform: config.transform,
    retry: {
      ...DEFAULT_RETRY_CONFIG,
      ...config.retry,
    },
    enabled: config.enabled ?? true,
  }
}

/**
 * Check if an event matches a destination's filter
 */
function matchesFilter(event: AnalyticsStreamEvent, filter: EventTypeFilter): boolean {
  if (filter === 'all') {
    return true
  }
  const eventType = event.data.type
  if (Array.isArray(filter)) {
    return filter.includes(eventType)
  }
  return eventType === filter
}

/**
 * Calculate delay for retry attempt using exponential backoff
 */
function calculateRetryDelay(attempt: number, config: Required<RetryConfig>): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1)
  return Math.min(delay, config.maxDelayMs)
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// ANALYTICS STREAM CLIENT CLASS
// ============================================================================

/**
 * Analytics Stream Client
 *
 * Streams analytics events to Cloudflare Pipelines for real-time export.
 * Supports batching, auto-flush intervals, beforeSend transforms, and
 * multi-destination routing with retry logic.
 *
 * @example Single destination (backward compatible)
 * ```typescript
 * const client = createAnalyticsStreamClient({
 *   pipeline: env.ANALYTICS_PIPELINE,
 *   batchSize: 100,
 *   flushInterval: 5000,
 *   beforeSend: (event) => ({
 *     ...event,
 *     metadata: { ...event.metadata, source: 'web' }
 *   }),
 * })
 *
 * client.track({ event: 'Button Clicked', userId: 'user-123' })
 * await client.flush()
 * ```
 *
 * @example Multiple destinations with filtering
 * ```typescript
 * const client = createAnalyticsStreamClient({
 *   destinations: [
 *     {
 *       id: 'primary',
 *       pipeline: env.PRIMARY_PIPELINE,
 *       filter: 'all',
 *     },
 *     {
 *       id: 'tracking-only',
 *       pipeline: env.TRACKING_PIPELINE,
 *       filter: 'track',
 *       format: 'ndjson',
 *     },
 *     {
 *       id: 'identity',
 *       pipeline: env.IDENTITY_PIPELINE,
 *       filter: ['identify', 'page'],
 *       retry: { maxAttempts: 5 },
 *     },
 *   ],
 *   batchSize: 100,
 *   flushInterval: 5000,
 * })
 * ```
 */
class AnalyticsStreamClientImpl {
  private readonly destinations: ResolvedDestination[]
  private readonly batchSize: number
  private readonly flushInterval: number
  private readonly beforeSend?: BeforeSendCallback
  private readonly defaultMetadata?: Record<string, unknown>
  private readonly deadLetterQueueSize: number
  private readonly onDeadLetter?: (entry: DeadLetterEntry) => void

  private buffer: AnalyticsStreamEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private destroyed = false
  private deadLetterQueue: DeadLetterEntry[] = []
  private metrics: StreamMetrics

  constructor(config: AnalyticsStreamConfig) {
    // Handle single pipeline (backward compatibility) or multiple destinations
    if (config.destinations && config.destinations.length > 0) {
      this.destinations = config.destinations.map(resolveDestination)
    } else if (config.pipeline) {
      // Backward compatibility: wrap single pipeline as a destination
      this.destinations = [
        resolveDestination({
          id: 'default',
          pipeline: config.pipeline,
        }),
      ]
    } else {
      throw new Error('Either pipeline or destinations must be provided')
    }

    this.batchSize = config.batchSize ?? 100
    this.flushInterval = config.flushInterval ?? 5000
    this.beforeSend = config.beforeSend
    this.defaultMetadata = config.defaultMetadata
    this.deadLetterQueueSize = config.deadLetterQueueSize ?? 1000
    this.onDeadLetter = config.onDeadLetter

    // Initialize metrics
    this.metrics = {
      sent: 0,
      failed: 0,
      retried: 0,
      deadLetterCount: 0,
      byDestination: {},
    }
    for (const dest of this.destinations) {
      this.metrics.byDestination[dest.id] = { sent: 0, failed: 0, retried: 0 }
    }

    // Start auto-flush timer
    this.startFlushTimer()
  }

  /**
   * Start the auto-flush interval timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
    }
    this.flushTimer = setInterval(() => {
      this.flush()
    }, this.flushInterval)
  }

  /**
   * Create a stream event from analytics data
   */
  private createStreamEvent(
    type: string,
    data: Omit<AnalyticsStreamEvent['data'], 'type' | 'timestamp' | 'messageId'>
  ): AnalyticsStreamEvent {
    return {
      operation: 'insert',
      table: 'analytics_events',
      data: {
        ...data,
        type,
        timestamp: generateTimestamp(),
        messageId: generateMessageId(),
      },
      timestamp: Date.now(),
      metadata: this.defaultMetadata ? { ...this.defaultMetadata } : undefined,
    }
  }

  /**
   * Enqueue an event to the buffer
   */
  private enqueue(event: AnalyticsStreamEvent): void {
    if (this.destroyed) {
      return
    }

    this.buffer.push(event)

    // Auto-flush if batch size reached
    if (this.buffer.length >= this.batchSize) {
      this.flush()
    }
  }

  /**
   * Add an event to the dead letter queue
   */
  private addToDeadLetter(event: AnalyticsStreamEvent, destinationId: string, error: string, attempts: number): void {
    const now = Date.now()
    const entry: DeadLetterEntry = {
      event,
      destinationId,
      error,
      attempts,
      failedAt: now,
      lastAttemptAt: now,
    }

    // Enforce queue size limit (FIFO eviction)
    if (this.deadLetterQueue.length >= this.deadLetterQueueSize) {
      this.deadLetterQueue.shift()
    }

    this.deadLetterQueue.push(entry)
    this.metrics.deadLetterCount = this.deadLetterQueue.length
    this.metrics.failed++
    this.metrics.byDestination[destinationId].failed++

    // Notify callback if configured
    if (this.onDeadLetter) {
      this.onDeadLetter(entry)
    }
  }

  /**
   * Send events to a single destination with retry logic
   */
  private async sendToDestination(
    destination: ResolvedDestination,
    events: AnalyticsStreamEvent[]
  ): Promise<void> {
    // Filter events for this destination
    const filteredEvents = events.filter((e) => matchesFilter(e, destination.filter))
    if (filteredEvents.length === 0) {
      return
    }

    // Apply destination-specific transform
    let transformedEvents = filteredEvents
    if (destination.transform) {
      transformedEvents = []
      for (const event of filteredEvents) {
        const result = destination.transform(event)
        if (result !== null) {
          transformedEvents.push(result)
        }
      }
    }

    if (transformedEvents.length === 0) {
      return
    }

    // Apply format adapter
    const encodedEvents = destination.adapter.encode(transformedEvents)

    // Send with retry logic
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= destination.retry.maxAttempts; attempt++) {
      try {
        await destination.pipeline.send(encodedEvents)
        // Success
        this.metrics.sent += transformedEvents.length
        this.metrics.byDestination[destination.id].sent += transformedEvents.length
        return
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Track retry if not the last attempt
        if (attempt < destination.retry.maxAttempts) {
          this.metrics.retried++
          this.metrics.byDestination[destination.id].retried++

          // Wait before retry with exponential backoff
          const delay = calculateRetryDelay(attempt, destination.retry)
          await sleep(delay)
        }
      }
    }

    // All retries exhausted - add to dead letter queue
    for (const event of transformedEvents) {
      this.addToDeadLetter(
        event,
        destination.id,
        lastError?.message ?? 'Unknown error',
        destination.retry.maxAttempts
      )
    }
  }

  /**
   * Track an event
   */
  track(input: TrackEventInput): void {
    const event = this.createStreamEvent('track', {
      event: input.event,
      userId: input.userId,
      anonymousId: input.anonymousId,
      properties: input.properties,
    })
    this.enqueue(event)
  }

  /**
   * Identify a user
   */
  identify(input: IdentifyEventInput): void {
    const event = this.createStreamEvent('identify', {
      userId: input.userId,
      traits: input.traits,
    })
    this.enqueue(event)
  }

  /**
   * Track a page view
   */
  page(input?: PageEventInput): void {
    const event = this.createStreamEvent('page', {
      event: input?.name,
      anonymousId: input?.anonymousId,
      properties: input?.category ? { ...input.properties, category: input.category } : input?.properties,
    })
    this.enqueue(event)
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.buffer.length
  }

  /**
   * Get current metrics
   */
  getMetrics(): StreamMetrics {
    return { ...this.metrics, byDestination: { ...this.metrics.byDestination } }
  }

  /**
   * Get dead letter queue entries
   */
  getDeadLetterQueue(): DeadLetterEntry[] {
    return [...this.deadLetterQueue]
  }

  /**
   * Clear the dead letter queue
   */
  clearDeadLetterQueue(): void {
    this.deadLetterQueue = []
    this.metrics.deadLetterCount = 0
  }

  /**
   * Retry all events in the dead letter queue
   */
  async retryDeadLetterQueue(): Promise<{ succeeded: number; failed: number }> {
    const entries = [...this.deadLetterQueue]
    this.deadLetterQueue = []
    this.metrics.deadLetterCount = 0

    let succeeded = 0
    let failed = 0

    // Group entries by destination
    const byDestination = new Map<string, DeadLetterEntry[]>()
    for (const entry of entries) {
      const existing = byDestination.get(entry.destinationId) ?? []
      existing.push(entry)
      byDestination.set(entry.destinationId, existing)
    }

    // Retry each destination's events
    for (const [destId, destEntries] of byDestination) {
      const destination = this.destinations.find((d) => d.id === destId)
      if (!destination || !destination.enabled) {
        // Destination no longer exists or disabled, mark as failed
        failed += destEntries.length
        continue
      }

      const events = destEntries.map((e) => e.event)
      const encodedEvents = destination.adapter.encode(events)

      try {
        await destination.pipeline.send(encodedEvents)
        succeeded += events.length
        this.metrics.sent += events.length
        this.metrics.byDestination[destId].sent += events.length
      } catch (error) {
        // Re-add to dead letter queue
        for (const entry of destEntries) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          this.addToDeadLetter(entry.event, destId, errorMsg, entry.attempts + 1)
        }
        failed += destEntries.length
      }
    }

    return { succeeded, failed }
  }

  /**
   * Flush all buffered events to all destinations
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return
    }

    // Capture and clear buffer
    const events = [...this.buffer]
    this.buffer = []

    // Apply global beforeSend transform if configured
    let transformedEvents: AnalyticsStreamEvent[] = events
    if (this.beforeSend) {
      transformedEvents = []
      for (const event of events) {
        const result = this.beforeSend(event)
        if (result !== null) {
          transformedEvents.push(result)
        }
      }
    }

    // Don't send if all events were filtered
    if (transformedEvents.length === 0) {
      return
    }

    // Send to all enabled destinations in parallel
    const enabledDestinations = this.destinations.filter((d) => d.enabled)
    await Promise.all(enabledDestinations.map((dest) => this.sendToDestination(dest, transformedEvents)))
  }

  /**
   * Destroy the client, flushing remaining events and stopping timers
   */
  destroy(): void {
    if (this.destroyed) {
      return
    }

    this.destroyed = true

    // Stop auto-flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    // Flush remaining events
    if (this.buffer.length > 0) {
      // Capture buffer before clearing
      const remainingEvents = [...this.buffer]
      this.buffer = []

      // Apply transforms
      let transformedEvents: AnalyticsStreamEvent[] = remainingEvents
      if (this.beforeSend) {
        transformedEvents = []
        for (const event of remainingEvents) {
          const result = this.beforeSend(event)
          if (result !== null) {
            transformedEvents.push(result)
          }
        }
      }

      // Send if there are events to send
      if (transformedEvents.length > 0) {
        const enabledDestinations = this.destinations.filter((d) => d.enabled)
        Promise.all(enabledDestinations.map((dest) => this.sendToDestination(dest, transformedEvents))).catch(() => {
          // Best effort flush on destroy
        })
      }
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Analytics Stream Client interface
 */
export interface AnalyticsStreamClient {
  /** Track a custom event */
  track(event: TrackEventInput): void
  /** Identify a user */
  identify(event: IdentifyEventInput): void
  /** Track a page view */
  page(event?: PageEventInput): void
  /** Flush all buffered events to destinations */
  flush(): Promise<void>
  /** Destroy the client and flush remaining events */
  destroy(): void
  /** Get current buffer size */
  getBufferSize(): number
  /** Get current metrics (sent, failed, retried counts) */
  getMetrics(): StreamMetrics
  /** Get all entries in the dead letter queue */
  getDeadLetterQueue(): DeadLetterEntry[]
  /** Clear the dead letter queue */
  clearDeadLetterQueue(): void
  /** Retry all events in the dead letter queue */
  retryDeadLetterQueue(): Promise<{ succeeded: number; failed: number }>
}

/**
 * Create an Analytics Stream Client
 *
 * Creates a client for streaming analytics events to one or more Cloudflare
 * Pipeline destinations. Supports batching, auto-flush intervals, transforms,
 * event filtering, format adapters, retry logic, and dead letter queues.
 *
 * @param config - Configuration options
 * @returns An AnalyticsStreamClient instance
 *
 * @example Single destination (backward compatible)
 * ```typescript
 * const client = createAnalyticsStreamClient({
 *   pipeline: env.ANALYTICS_PIPELINE,
 *   batchSize: 100,
 *   flushInterval: 5000,
 * })
 *
 * client.track({
 *   event: 'Button Clicked',
 *   userId: 'user-123',
 *   properties: { buttonId: 'submit-btn' }
 * })
 *
 * await client.flush()
 * ```
 *
 * @example Multiple destinations with filtering and retry
 * ```typescript
 * const client = createAnalyticsStreamClient({
 *   destinations: [
 *     {
 *       id: 'primary',
 *       pipeline: env.PRIMARY_PIPELINE,
 *       filter: 'all',
 *       retry: { maxAttempts: 5 },
 *     },
 *     {
 *       id: 'tracking-only',
 *       pipeline: env.TRACKING_PIPELINE,
 *       filter: 'track',
 *       format: 'ndjson',
 *     },
 *   ],
 *   batchSize: 100,
 *   flushInterval: 5000,
 *   onDeadLetter: (entry) => {
 *     console.error(`Event failed for ${entry.destinationId}:`, entry.error)
 *   },
 * })
 *
 * // Track events
 * client.track({ event: 'Purchase', userId: 'user-123' })
 *
 * // Check metrics
 * const metrics = client.getMetrics()
 * console.log(`Sent: ${metrics.sent}, Failed: ${metrics.failed}`)
 *
 * // Retry failed events
 * const result = await client.retryDeadLetterQueue()
 * console.log(`Retried: ${result.succeeded} succeeded, ${result.failed} failed`)
 * ```
 */
export function createAnalyticsStreamClient(config: AnalyticsStreamConfig): AnalyticsStreamClient {
  return new AnalyticsStreamClientImpl(config)
}
