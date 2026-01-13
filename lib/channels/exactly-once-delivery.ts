/**
 * ExactlyOnceChannelDelivery - Exactly-once delivery guarantees for channels
 *
 * Provides exactly-once delivery semantics for notification channels:
 * - **Idempotency Keys**: Unique keys prevent duplicate delivery
 * - **Deduplication Logic**: Time-based sliding window for replay protection
 * - **Delivery Acknowledgment**: Durable record of all deliveries
 * - **Retry with Idempotency**: Exponential backoff with deduplication
 *
 * ## Architecture
 *
 * ```
 * Message -> Generate Key -> Deduplication -> Delivery -> Acknowledgment
 *               |                 |              |            |
 *               v                 v              v            v
 *         [Idempotency]     [Duplicate?]   [Retry?]    [Record]
 *               |                 |              |            |
 *            [Store]          [Skip]        [Backoff]    [Persist]
 * ```
 *
 * @example Basic usage
 * ```typescript
 * import { createExactlyOnceChannelDelivery } from 'dotdo/lib/channels'
 *
 * const delivery = createExactlyOnceChannelDelivery({
 *   onDeliver: async (event) => {
 *     await slackChannel.send(event.payload)
 *   },
 *   deduplicationWindowMs: 300_000, // 5 minutes
 * })
 *
 * await delivery.deliver({
 *   idempotencyKey: 'notification-123',
 *   channel: 'slack',
 *   recipient: '#general',
 *   payload: { message: 'Hello!' },
 * })
 * ```
 *
 * @module lib/channels/exactly-once-delivery
 */

// ============================================================================
// TYPES
// ============================================================================

/** Idempotency key type */
export type IdempotencyKey = string

/** Channel type for delivery */
export type DeliveryChannel = 'slack' | 'discord' | 'email' | 'mdxui' | string

/** Delivery status */
export type ChannelDeliveryStatus = 'pending' | 'delivered' | 'failed'

/** Event to be delivered through a channel */
export interface ChannelDeliveryEvent<T = unknown> {
  /** Unique idempotency key - same key = same message (optional, will be generated if not provided) */
  idempotencyKey?: IdempotencyKey
  /** Target channel type */
  channel: DeliveryChannel
  /** Recipient identifier (channel ID, email, user ID, etc.) */
  recipient: string
  /** Message payload */
  payload: T
  /** Event timestamp (defaults to now) */
  timestamp?: number
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/** Result of delivery attempt */
export interface ChannelDeliveryResult {
  /** Whether delivery succeeded */
  success: boolean
  /** Idempotency key used */
  idempotencyKey: IdempotencyKey
  /** Delivery status */
  status: ChannelDeliveryStatus
  /** Whether this was a duplicate (already delivered) */
  wasDuplicate: boolean
  /** Error message if failed */
  error?: string
  /** Delivery duration in ms */
  durationMs: number
  /** External message ID from provider */
  externalId?: string
}

/** Delivery handler return type */
export interface DeliveryHandlerResult {
  /** External message ID from provider */
  messageId?: string
  /** Provider name */
  provider?: string
}

/** Delivery acknowledgment record */
export interface DeliveryAcknowledgment {
  /** Idempotency key */
  idempotencyKey: IdempotencyKey
  /** Delivery status */
  status: ChannelDeliveryStatus
  /** Channel used */
  channel: DeliveryChannel
  /** Recipient */
  recipient: string
  /** When delivered (undefined if failed) */
  deliveredAt?: number
  /** Number of attempts */
  attempts: number
  /** Attempt history */
  attemptHistory: Array<{
    timestamp: number
    success: boolean
    error?: string
    durationMs: number
  }>
  /** Last error message if failed */
  lastError?: string
  /** External message ID from provider */
  externalId?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/** Checkpoint state for persistence */
export interface ChannelDeliveryCheckpoint {
  /** Delivered keys with timestamps */
  deliveredKeys: Map<IdempotencyKey, number>
  /** Acknowledgment records */
  acknowledgments: DeliveryAcknowledgment[]
  /** Checkpoint timestamp */
  checkpointedAt: number
  /** Version for compatibility */
  version: number
}

/** Delivery statistics */
export interface ChannelDeliveryStats {
  /** Total messages delivered */
  totalDelivered: number
  /** Duplicate messages skipped */
  duplicatesSkipped: number
  /** Total failed deliveries */
  totalFailed: number
  /** Deduplication cache size */
  deduplicationCacheSize: number
  /** Average delivery latency */
  avgDeliveryLatencyMs: number
  /** Deliveries by channel */
  byChannel: Record<string, number>
}

/** Handler for delivering events */
export type DeliveryHandler<T = unknown> = (
  event: ChannelDeliveryEvent<T>
) => Promise<DeliveryHandlerResult | void>

/** Custom deduplication key generator */
export type DeduplicationKeyGenerator<T = unknown> = (
  event: ChannelDeliveryEvent<T>
) => string

/** Custom retry policy */
export type RetryPolicy = (error: Error, attempt: number) => boolean

/** Configuration options */
export interface ChannelDeliveryOptions<T = unknown> {
  /** Handler for delivering events */
  onDeliver?: DeliveryHandler<T>
  /** Deduplication window in ms (default: 300000 = 5 minutes) */
  deduplicationWindowMs?: number
  /** Maximum retry attempts (default: 3) */
  maxRetryAttempts?: number
  /** Retry delay in ms (default: 1000) */
  retryDelayMs?: number
  /** Retry backoff multiplier (default: 2) */
  retryBackoffMultiplier?: number
  /** Maximum retry delay in ms (default: 30000) */
  maxRetryDelayMs?: number
  /** Custom deduplication key generator */
  generateDeduplicationKey?: DeduplicationKeyGenerator<T>
  /** Custom retry policy */
  shouldRetry?: RetryPolicy
}

// ============================================================================
// UTILITIES
// ============================================================================

function generateIdempotencyKey(): IdempotencyKey {
  return `ck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

function calculateBackoff(
  attempt: number,
  baseMs: number,
  multiplier: number,
  maxMs: number
): number {
  const delay = baseMs * Math.pow(multiplier, attempt - 1)
  const jitter = delay * 0.1 * (Math.random() * 2 - 1)
  return Math.min(delay + jitter, maxMs)
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * ExactlyOnceChannelDelivery - Exactly-once delivery for notification channels
 */
export class ExactlyOnceChannelDelivery<T = unknown> {
  private readonly options: Required<
    Omit<ChannelDeliveryOptions<T>, 'onDeliver' | 'generateDeduplicationKey' | 'shouldRetry'>
  > & {
    onDeliver?: DeliveryHandler<T>
    generateDeduplicationKey?: DeduplicationKeyGenerator<T>
    shouldRetry?: RetryPolicy
  }

  // Deduplication cache: key -> timestamp
  private readonly deduplicationCache: Map<IdempotencyKey, number> = new Map()

  // Acknowledgment records
  private readonly acknowledgments: Map<IdempotencyKey, DeliveryAcknowledgment> = new Map()

  // Processing locks to prevent concurrent delivery of same key
  private readonly processingLocks: Map<IdempotencyKey, Promise<ChannelDeliveryResult>> = new Map()

  // Statistics
  private totalDelivered = 0
  private duplicatesSkipped = 0
  private totalFailed = 0
  private totalLatencyMs = 0
  private channelCounts: Record<string, number> = {}

  constructor(options?: ChannelDeliveryOptions<T>) {
    this.options = {
      deduplicationWindowMs: options?.deduplicationWindowMs ?? 300_000, // 5 minutes
      maxRetryAttempts: options?.maxRetryAttempts ?? 3,
      retryDelayMs: options?.retryDelayMs ?? 1000,
      retryBackoffMultiplier: options?.retryBackoffMultiplier ?? 2,
      maxRetryDelayMs: options?.maxRetryDelayMs ?? 30_000,
      onDeliver: options?.onDeliver,
      generateDeduplicationKey: options?.generateDeduplicationKey,
      shouldRetry: options?.shouldRetry,
    }
  }

  // ==========================================================================
  // DELIVERY API
  // ==========================================================================

  /**
   * Deliver a message with exactly-once semantics
   */
  async deliver(event: ChannelDeliveryEvent<T>): Promise<ChannelDeliveryResult> {
    const startTime = performance.now()

    // Generate idempotency key if not provided
    const idempotencyKey = event.idempotencyKey ?? generateIdempotencyKey()
    const eventWithKey: ChannelDeliveryEvent<T> = { ...event, idempotencyKey }

    // Get deduplication key (may be different from idempotency key)
    const dedupKey = this.options.generateDeduplicationKey
      ? this.options.generateDeduplicationKey(eventWithKey)
      : idempotencyKey

    // Check for concurrent delivery of same key
    const existingLock = this.processingLocks.get(dedupKey)
    if (existingLock) {
      return existingLock
    }

    // Create processing promise
    const processPromise = this.processDelivery(eventWithKey, dedupKey, startTime)
    this.processingLocks.set(dedupKey, processPromise)

    try {
      return await processPromise
    } finally {
      this.processingLocks.delete(dedupKey)
    }
  }

  private async processDelivery(
    event: ChannelDeliveryEvent<T>,
    dedupKey: string,
    startTime: number
  ): Promise<ChannelDeliveryResult> {
    const idempotencyKey = event.idempotencyKey!
    event.timestamp = event.timestamp ?? Date.now()

    // Check deduplication window
    if (this.isDuplicateInternal(dedupKey)) {
      this.duplicatesSkipped++

      return {
        success: true,
        idempotencyKey,
        status: 'delivered',
        wasDuplicate: true,
        durationMs: performance.now() - startTime,
      }
    }

    // Deliver with retries
    const attemptHistory: Array<{
      timestamp: number
      success: boolean
      error?: string
      durationMs: number
    }> = []
    let lastError: string | undefined
    let externalId: string | undefined

    for (let attempt = 1; attempt <= this.options.maxRetryAttempts; attempt++) {
      const attemptStart = performance.now()

      try {
        // Execute handler
        if (this.options.onDeliver) {
          const result = await this.options.onDeliver(event)
          if (result && result.messageId) {
            externalId = result.messageId
          }
        }

        // Record success
        attemptHistory.push({
          timestamp: Date.now(),
          success: true,
          durationMs: performance.now() - attemptStart,
        })

        // Record in deduplication cache
        this.recordDelivered(dedupKey)

        // Record acknowledgment
        this.recordAcknowledgment({
          idempotencyKey,
          status: 'delivered',
          channel: event.channel,
          recipient: event.recipient,
          deliveredAt: Date.now(),
          attempts: attempt,
          attemptHistory,
          externalId,
          metadata: event.metadata,
        })

        // Update stats
        this.totalDelivered++
        const durationMs = performance.now() - startTime
        this.totalLatencyMs += durationMs
        this.channelCounts[event.channel] = (this.channelCounts[event.channel] ?? 0) + 1

        return {
          success: true,
          idempotencyKey,
          status: 'delivered',
          wasDuplicate: false,
          durationMs,
          externalId,
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)

        attemptHistory.push({
          timestamp: Date.now(),
          success: false,
          error: lastError,
          durationMs: performance.now() - attemptStart,
        })

        // Check custom retry policy
        if (this.options.shouldRetry) {
          const shouldRetry = this.options.shouldRetry(
            error instanceof Error ? error : new Error(String(error)),
            attempt
          )
          if (!shouldRetry) {
            break
          }
        }

        // Retry with backoff
        if (attempt < this.options.maxRetryAttempts) {
          const backoff = calculateBackoff(
            attempt,
            this.options.retryDelayMs,
            this.options.retryBackoffMultiplier,
            this.options.maxRetryDelayMs
          )
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      }
    }

    // All retries exhausted
    this.totalFailed++

    // Record failed acknowledgment
    this.recordAcknowledgment({
      idempotencyKey,
      status: 'failed',
      channel: event.channel,
      recipient: event.recipient,
      attempts: attemptHistory.length,
      attemptHistory,
      lastError,
      metadata: event.metadata,
    })

    return {
      success: false,
      idempotencyKey,
      status: 'failed',
      wasDuplicate: false,
      durationMs: performance.now() - startTime,
      error: lastError,
    }
  }

  /**
   * Deliver multiple messages with exactly-once semantics
   */
  async deliverBatch(events: ChannelDeliveryEvent<T>[]): Promise<ChannelDeliveryResult[]> {
    // Process sequentially to maintain ordering
    const results: ChannelDeliveryResult[] = []
    for (const event of events) {
      results.push(await this.deliver(event))
    }
    return results
  }

  // ==========================================================================
  // DEDUPLICATION
  // ==========================================================================

  /**
   * Check if a message was already delivered
   */
  async isDelivered(idempotencyKey: IdempotencyKey): Promise<boolean> {
    return this.isDuplicateInternal(idempotencyKey)
  }

  private isDuplicateInternal(key: string): boolean {
    const deliveredAt = this.deduplicationCache.get(key)
    if (!deliveredAt) {
      return false
    }

    // Check if within deduplication window
    const elapsed = Date.now() - deliveredAt
    if (elapsed >= this.options.deduplicationWindowMs) {
      // Expired - remove from cache
      this.deduplicationCache.delete(key)
      return false
    }

    return true
  }

  private recordDelivered(key: string): void {
    this.deduplicationCache.set(key, Date.now())
  }

  /**
   * Clean up expired entries from deduplication cache
   */
  cleanupExpiredEntries(): number {
    const now = Date.now()
    let cleaned = 0
    const keysToDelete: string[] = []

    this.deduplicationCache.forEach((deliveredAt, key) => {
      const elapsed = now - deliveredAt
      if (elapsed >= this.options.deduplicationWindowMs) {
        keysToDelete.push(key)
      }
    })

    keysToDelete.forEach((key) => {
      this.deduplicationCache.delete(key)
      cleaned++
    })

    return cleaned
  }

  // ==========================================================================
  // ACKNOWLEDGMENTS
  // ==========================================================================

  private recordAcknowledgment(ack: DeliveryAcknowledgment): void {
    this.acknowledgments.set(ack.idempotencyKey, ack)
  }

  /**
   * Get acknowledgment for a delivery
   */
  getAcknowledgment(idempotencyKey: IdempotencyKey): DeliveryAcknowledgment | undefined {
    return this.acknowledgments.get(idempotencyKey)
  }

  /**
   * Get all acknowledgments
   */
  getAllAcknowledgments(): DeliveryAcknowledgment[] {
    return Array.from(this.acknowledgments.values())
  }

  /**
   * Clear an acknowledgment (allows retry)
   */
  clearAcknowledgment(idempotencyKey: IdempotencyKey): void {
    this.acknowledgments.delete(idempotencyKey)
    this.deduplicationCache.delete(idempotencyKey)
  }

  // ==========================================================================
  // CHECKPOINT & RECOVERY
  // ==========================================================================

  /**
   * Get checkpoint state for persistence
   */
  getCheckpoint(): ChannelDeliveryCheckpoint {
    return {
      deliveredKeys: new Map(this.deduplicationCache),
      acknowledgments: Array.from(this.acknowledgments.values()),
      checkpointedAt: Date.now(),
      version: 1,
    }
  }

  /**
   * Restore from checkpoint state
   */
  restoreFromCheckpoint(checkpoint: ChannelDeliveryCheckpoint): void {
    // Validate version
    if (checkpoint.version !== 1) {
      throw new Error(`Unsupported checkpoint version: ${checkpoint.version}`)
    }

    // Restore deduplication cache (filter out expired entries)
    this.deduplicationCache.clear()
    const now = Date.now()
    checkpoint.deliveredKeys.forEach((timestamp, key) => {
      const elapsed = now - timestamp
      if (elapsed < this.options.deduplicationWindowMs) {
        this.deduplicationCache.set(key, timestamp)
      }
    })

    // Restore acknowledgments
    this.acknowledgments.clear()
    for (const ack of checkpoint.acknowledgments) {
      this.acknowledgments.set(ack.idempotencyKey, ack)
    }
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Get delivery statistics
   */
  getStats(): ChannelDeliveryStats {
    return {
      totalDelivered: this.totalDelivered,
      duplicatesSkipped: this.duplicatesSkipped,
      totalFailed: this.totalFailed,
      deduplicationCacheSize: this.deduplicationCache.size,
      avgDeliveryLatencyMs:
        this.totalDelivered > 0 ? this.totalLatencyMs / this.totalDelivered : 0,
      byChannel: { ...this.channelCounts },
    }
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Clear all state
   */
  clear(): void {
    this.deduplicationCache.clear()
    this.acknowledgments.clear()
    this.processingLocks.clear()
    this.totalDelivered = 0
    this.duplicatesSkipped = 0
    this.totalFailed = 0
    this.totalLatencyMs = 0
    this.channelCounts = {}
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ExactlyOnceChannelDelivery instance
 *
 * @param options - Configuration options
 * @returns A new ExactlyOnceChannelDelivery instance
 *
 * @example
 * ```typescript
 * const delivery = createExactlyOnceChannelDelivery({
 *   onDeliver: async (event) => {
 *     await channel.send(event.payload)
 *   },
 *   deduplicationWindowMs: 300_000, // 5 minutes
 *   maxRetryAttempts: 5,
 * })
 *
 * // Deliver with idempotency
 * await delivery.deliver({
 *   idempotencyKey: 'notification-123',
 *   channel: 'slack',
 *   recipient: '#general',
 *   payload: { message: 'Hello!' },
 * })
 *
 * // Check delivery status
 * const ack = delivery.getAcknowledgment('notification-123')
 * console.log(ack.status) // 'delivered'
 * ```
 */
export function createExactlyOnceChannelDelivery<T = unknown>(
  options?: ChannelDeliveryOptions<T>
): ExactlyOnceChannelDelivery<T> {
  return new ExactlyOnceChannelDelivery<T>(options)
}
