/**
 * DeliveryQueue - Notification delivery queue with enterprise features
 *
 * Provides reliable notification delivery with:
 * - **Batching**: Accumulates items for efficient batch processing
 * - **Per-channel rate limiting**: Prevents overwhelming downstream services
 * - **Retry logic**: Exponential backoff with configurable jitter
 * - **Dead letter queue (DLQ)**: Captures permanently failed deliveries
 * - **Persistence**: Durable storage via storage interface (DO-compatible)
 * - **Status tracking**: Full delivery lifecycle visibility
 *
 * ## Usage
 *
 * ```typescript
 * import { createDeliveryQueue } from './delivery-queue'
 *
 * const queue = createDeliveryQueue({
 *   storage: ctx.storage,
 *   retry: { maxAttempts: 5, initialDelayMs: 1000 },
 *   rateLimit: { email: { maxPerSecond: 10 } },
 * })
 *
 * // Register handlers
 * queue.registerHandler('email', async (item) => {
 *   const result = await sendEmail(item.payload)
 *   return { messageId: result.id }
 * })
 *
 * // Enqueue and process
 * await queue.enqueue({
 *   channel: 'email',
 *   payload: { to: 'user@example.com', subject: 'Hello' },
 *   recipient: { email: 'user@example.com' },
 * })
 *
 * queue.start() // Begin automatic processing
 * ```
 *
 * @module db/primitives/notifications
 */

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Storage interface compatible with Durable Objects storage
 */
export interface QueueStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list<T>(prefix: string): Promise<Map<string, T>>
}

/**
 * Notification channel types
 */
export type NotificationChannel = 'email' | 'sms' | 'push' | 'webhook' | 'slack' | 'in-app' | string

/**
 * Priority levels for queue items
 */
export type DeliveryPriority = 'low' | 'normal' | 'high' | 'critical'

/**
 * Delivery status values
 */
export type DeliveryStatus =
  | 'queued'
  | 'scheduled'
  | 'processing'
  | 'pending_retry'
  | 'rate_limited'
  | 'sent'
  | 'failed'

/**
 * Recipient information
 */
export interface Recipient {
  email?: string
  phone?: string
  userId?: string
  deviceToken?: string
  webhookUrl?: string
  slackChannel?: string
  [key: string]: unknown
}

/**
 * Item to be delivered
 */
export interface DeliveryItem {
  /** Unique identifier */
  id: string
  /** Notification channel */
  channel: NotificationChannel
  /** Channel-specific payload */
  payload: Record<string, unknown>
  /** Recipient information */
  recipient: Recipient
  /** Priority level */
  priority: DeliveryPriority
  /** Current status */
  status: DeliveryStatus
  /** Number of delivery attempts */
  attempts: number
  /** When the item was queued */
  queuedAt: Date
  /** When to send (for scheduled deliveries) */
  scheduledAt?: Date
  /** When delivery was sent */
  sentAt?: Date
  /** When delivery failed permanently */
  failedAt?: Date
  /** External message ID from handler */
  messageId?: string
  /** Last error message */
  lastError?: string
  /** Next retry timestamp */
  nextRetryAt?: Date
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Enqueue request for a new delivery
 */
export interface EnqueueRequest {
  channel: NotificationChannel
  payload: Record<string, unknown>
  recipient: Recipient
  priority?: DeliveryPriority
  scheduledAt?: Date
  metadata?: Record<string, unknown>
}

/**
 * Result from enqueueing an item
 */
export interface EnqueueResult {
  id: string
  status: DeliveryStatus
}

/**
 * Result returned by a delivery handler
 */
export interface DeliveryResult {
  messageId?: string
  [key: string]: unknown
}

/**
 * Handler function for delivering notifications
 */
export type DeliveryHandler = (item: DeliveryItem) => Promise<DeliveryResult>

/**
 * Dead letter queue entry
 */
export interface DeadLetterEntry {
  id: string
  originalId: string
  channel: NotificationChannel
  payload: Record<string, unknown>
  recipient: Recipient
  metadata?: Record<string, unknown>
  error: string
  attempts: number
  failedAt: Date
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number
  /** Initial retry delay in ms (default: 1000) */
  initialDelayMs?: number
  /** Maximum retry delay in ms (default: 60000) */
  maxDelayMs?: number
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number
  /** Jitter factor 0-1 (default: 0.1) */
  jitterFactor?: number
}

/**
 * Batch configuration
 */
export interface BatchConfig {
  /** Maximum items per batch (default: 100) */
  maxSize?: number
  /** Maximum wait time before flush (default: 5000ms) */
  maxWaitMs?: number
}

/**
 * Per-channel rate limit configuration
 */
export interface ChannelRateLimit {
  /** Max deliveries per second */
  maxPerSecond?: number
  /** Max deliveries per minute */
  maxPerMinute?: number
}

/**
 * Rate limit configuration per channel
 */
export type RateLimitConfig = Record<string, ChannelRateLimit>

/**
 * Rate limit status for a channel
 */
export interface RateLimitStatus {
  currentSecond: number
  remainingSecond: number
  currentMinute: number
  remainingMinute: number
}

/**
 * Queue statistics
 */
export interface QueueStats {
  total: number
  queued: number
  sent: number
  failed: number
  pendingRetry: number
  dlq: number
  byChannel: Record<
    string,
    {
      queued: number
      sent: number
      failed: number
    }
  >
}

/**
 * DLQ replay result
 */
export interface ReplayResult {
  success: boolean
  error?: string
}

/**
 * Bulk DLQ replay result
 */
export interface BulkReplayResult {
  successful: number
  failed: number
}

/**
 * Delivery item status for external queries
 */
export interface DeliveryItemStatus {
  id: string
  status: DeliveryStatus
  channel: NotificationChannel
  attempts: number
  queuedAt: Date
  sentAt?: Date
  failedAt?: Date
  messageId?: string
  lastError?: string
  nextRetryAt?: Date
}

/**
 * Queue configuration options
 */
export interface DeliveryQueueOptions {
  /** Storage implementation */
  storage: QueueStorage
  /** Retry configuration */
  retry?: RetryConfig
  /** Batch configuration */
  batch?: BatchConfig
  /** Per-channel rate limits */
  rateLimit?: RateLimitConfig
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

interface RateLimitWindow {
  second: { count: number; timestamp: number }
  minute: { count: number; timestamp: number }
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Delivery queue with batching, rate limiting, retries, and DLQ
 */
export class DeliveryQueue {
  private readonly storage: QueueStorage
  private readonly retryConfig: Required<RetryConfig>
  private readonly batchConfig: Required<BatchConfig>
  private readonly rateLimitConfig: RateLimitConfig
  private readonly handlers: Map<string, DeliveryHandler> = new Map()
  private readonly rateLimitWindows: Map<string, RateLimitWindow> = new Map()

  private pendingBatch: string[] = []
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private processInterval: ReturnType<typeof setInterval> | null = null

  constructor(options: DeliveryQueueOptions) {
    this.storage = options.storage

    // Default retry config
    this.retryConfig = {
      maxAttempts: options.retry?.maxAttempts ?? 3,
      initialDelayMs: options.retry?.initialDelayMs ?? 1000,
      maxDelayMs: options.retry?.maxDelayMs ?? 60000,
      backoffMultiplier: options.retry?.backoffMultiplier ?? 2,
      jitterFactor: options.retry?.jitterFactor ?? 0.1,
    }

    // Default batch config
    this.batchConfig = {
      maxSize: options.batch?.maxSize ?? 100,
      maxWaitMs: options.batch?.maxWaitMs ?? 5000,
    }

    this.rateLimitConfig = options.rateLimit ?? {}
  }

  // ===========================================================================
  // Handler Registration
  // ===========================================================================

  /**
   * Register a delivery handler for a channel
   */
  registerHandler(channel: NotificationChannel, handler: DeliveryHandler): void {
    this.handlers.set(channel, handler)
  }

  /**
   * Check if a handler is registered for a channel
   */
  hasHandler(channel: NotificationChannel): boolean {
    return this.handlers.has(channel)
  }

  // ===========================================================================
  // Enqueueing
  // ===========================================================================

  /**
   * Enqueue a single delivery item
   */
  async enqueue(request: EnqueueRequest): Promise<EnqueueResult> {
    const id = this.generateId()
    const now = new Date()

    const item: DeliveryItem = {
      id,
      channel: request.channel,
      payload: request.payload,
      recipient: request.recipient,
      priority: request.priority ?? 'normal',
      status: request.scheduledAt ? 'scheduled' : 'queued',
      attempts: 0,
      queuedAt: now,
      scheduledAt: request.scheduledAt,
      metadata: request.metadata,
    }

    await this.storage.put(`delivery:${id}`, item)

    // Add to pending batch if auto-processing
    if (this.running) {
      this.pendingBatch.push(id)
      this.checkBatchFlush()
    }

    return { id, status: item.status }
  }

  /**
   * Enqueue multiple delivery items atomically
   */
  async enqueueBatch(requests: EnqueueRequest[]): Promise<EnqueueResult[]> {
    const results: EnqueueResult[] = []

    for (const request of requests) {
      const result = await this.enqueue(request)
      results.push(result)
    }

    return results
  }

  // ===========================================================================
  // Processing
  // ===========================================================================

  /**
   * Process a single item by ID
   */
  async processOne(id: string): Promise<void> {
    const item = await this.storage.get<DeliveryItem>(`delivery:${id}`)
    if (!item) return

    await this.processItem(item)
  }

  /**
   * Process multiple items by ID
   */
  async processBatch(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.processOne(id)
    }
  }

  /**
   * Process all pending items
   */
  async processPending(): Promise<void> {
    const items = await this.storage.list<DeliveryItem>('delivery:')

    for (const [, item] of items) {
      if (item.status === 'queued' || item.status === 'rate_limited') {
        await this.processItem(item)
      }
    }
  }

  /**
   * Process items that are ready for retry
   */
  async processRetries(): Promise<void> {
    const now = Date.now()
    const items = await this.storage.list<DeliveryItem>('delivery:')

    for (const [, item] of items) {
      if (item.status === 'pending_retry' && item.nextRetryAt) {
        // Handle both Date objects and ISO strings (from deserialization)
        const nextRetryTime =
          item.nextRetryAt instanceof Date ? item.nextRetryAt.getTime() : new Date(item.nextRetryAt).getTime()

        if (nextRetryTime <= now) {
          await this.processItem(item)
        }
      }
    }
  }

  /**
   * Manually flush the pending batch
   * If not in auto-processing mode, processes all pending items from storage
   */
  async flush(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    if (this.pendingBatch.length > 0) {
      const toProcess = [...this.pendingBatch]
      this.pendingBatch = []

      for (const id of toProcess) {
        await this.processOne(id)
      }
    } else {
      // When not in auto-processing mode, process all pending items
      await this.processPending()
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start automatic processing
   */
  start(): void {
    if (this.running) return
    this.running = true

    // Process retries periodically
    this.processInterval = setInterval(async () => {
      await this.processRetries()
    }, 1000)
  }

  /**
   * Stop automatic processing
   */
  stop(): void {
    this.running = false

    if (this.processInterval) {
      clearInterval(this.processInterval)
      this.processInterval = null
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  /**
   * Get status of a single item
   */
  async getStatus(id: string): Promise<DeliveryItemStatus | undefined> {
    const item = await this.storage.get<DeliveryItem>(`delivery:${id}`)
    if (!item) return undefined

    return {
      id: item.id,
      status: item.status,
      channel: item.channel,
      attempts: item.attempts,
      queuedAt: new Date(item.queuedAt),
      sentAt: item.sentAt ? new Date(item.sentAt) : undefined,
      failedAt: item.failedAt ? new Date(item.failedAt) : undefined,
      messageId: item.messageId,
      lastError: item.lastError,
      nextRetryAt: item.nextRetryAt ? new Date(item.nextRetryAt) : undefined,
    }
  }

  /**
   * Get statuses of multiple items
   */
  async getStatuses(ids: string[]): Promise<Map<string, DeliveryItemStatus>> {
    const result = new Map<string, DeliveryItemStatus>()

    for (const id of ids) {
      const status = await this.getStatus(id)
      if (status) {
        result.set(id, status)
      }
    }

    return result
  }

  /**
   * Get rate limit status for a channel
   */
  getRateLimitStatus(channel: NotificationChannel): RateLimitStatus {
    const config = this.rateLimitConfig[channel]
    const window = this.rateLimitWindows.get(channel)

    const maxPerSecond = config?.maxPerSecond ?? Infinity
    const maxPerMinute = config?.maxPerMinute ?? Infinity

    const currentSecond = window?.second.count ?? 0
    const currentMinute = window?.minute.count ?? 0

    return {
      currentSecond,
      remainingSecond: Math.max(0, maxPerSecond - currentSecond),
      currentMinute,
      remainingMinute: Math.max(0, maxPerMinute - currentMinute),
    }
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats> {
    const items = await this.storage.list<DeliveryItem>('delivery:')
    const dlqItems = await this.storage.list<DeadLetterEntry>('dlq:')

    const stats: QueueStats = {
      total: items.size,
      queued: 0,
      sent: 0,
      failed: 0,
      pendingRetry: 0,
      dlq: dlqItems.size,
      byChannel: {},
    }

    for (const [, item] of items) {
      // Initialize channel stats
      if (!stats.byChannel[item.channel]) {
        stats.byChannel[item.channel] = { queued: 0, sent: 0, failed: 0 }
      }

      switch (item.status) {
        case 'queued':
        case 'scheduled':
        case 'rate_limited':
          stats.queued++
          stats.byChannel[item.channel].queued++
          break
        case 'sent':
          stats.sent++
          stats.byChannel[item.channel].sent++
          break
        case 'failed':
          stats.failed++
          stats.byChannel[item.channel].failed++
          break
        case 'pending_retry':
          stats.pendingRetry++
          break
      }
    }

    return stats
  }

  // ===========================================================================
  // Dead Letter Queue
  // ===========================================================================

  /**
   * Get all DLQ entries
   */
  async getDLQEntries(): Promise<DeadLetterEntry[]> {
    const entries = await this.storage.list<DeadLetterEntry>('dlq:')
    return Array.from(entries.values())
  }

  /**
   * Get DLQ entry count
   */
  async getDLQCount(): Promise<number> {
    const entries = await this.storage.list<DeadLetterEntry>('dlq:')
    return entries.size
  }

  /**
   * Replay a single DLQ entry
   */
  async replayDLQEntry(dlqId: string): Promise<ReplayResult> {
    const entry = await this.storage.get<DeadLetterEntry>(`dlq:${dlqId}`)
    if (!entry) {
      return { success: false, error: 'DLQ entry not found' }
    }

    const handler = this.handlers.get(entry.channel)
    if (!handler) {
      return { success: false, error: `No handler for channel: ${entry.channel}` }
    }

    // Create a temporary item for the handler
    const tempItem: DeliveryItem = {
      id: entry.originalId,
      channel: entry.channel,
      payload: entry.payload,
      recipient: entry.recipient,
      priority: 'normal',
      status: 'processing',
      attempts: entry.attempts + 1,
      queuedAt: new Date(),
      metadata: entry.metadata,
    }

    try {
      await handler(tempItem)

      // Success - remove from DLQ
      await this.storage.delete(`dlq:${dlqId}`)
      return { success: true }
    } catch (error) {
      // Update error but keep in DLQ
      entry.error = error instanceof Error ? error.message : String(error)
      entry.attempts++
      await this.storage.put(`dlq:${dlqId}`, entry)
      return { success: false, error: entry.error }
    }
  }

  /**
   * Replay all DLQ entries
   */
  async replayAllDLQ(): Promise<BulkReplayResult> {
    const entries = await this.getDLQEntries()
    let successful = 0
    let failed = 0

    for (const entry of entries) {
      const result = await this.replayDLQEntry(entry.id)
      if (result.success) {
        successful++
      } else {
        failed++
      }
    }

    return { successful, failed }
  }

  /**
   * Remove a DLQ entry
   */
  async removeDLQEntry(dlqId: string): Promise<boolean> {
    return this.storage.delete(`dlq:${dlqId}`)
  }

  /**
   * Clear all DLQ entries
   */
  async clearDLQ(): Promise<void> {
    const entries = await this.storage.list<DeadLetterEntry>('dlq:')

    for (const [key] of entries) {
      await this.storage.delete(key)
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private generateId(): string {
    return `del_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`
  }

  private async processItem(item: DeliveryItem): Promise<void> {
    const handler = this.handlers.get(item.channel)
    if (!handler) {
      return
    }

    // Check rate limit
    if (!this.checkRateLimit(item.channel)) {
      item.status = 'rate_limited'
      await this.storage.put(`delivery:${item.id}`, item)
      return
    }

    item.status = 'processing'
    item.attempts++
    await this.storage.put(`delivery:${item.id}`, item)

    try {
      const result = await handler(item)

      // Success
      item.status = 'sent'
      item.sentAt = new Date()
      item.messageId = result.messageId
      delete item.nextRetryAt
      delete item.lastError

      await this.storage.put(`delivery:${item.id}`, item)
      this.recordDelivery(item.channel)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isRetryable =
        error instanceof Error && 'retryable' in error ? (error as Error & { retryable?: boolean }).retryable : true

      item.lastError = errorMessage

      if (!isRetryable || item.attempts >= this.retryConfig.maxAttempts) {
        // Permanent failure - move to DLQ
        item.status = 'failed'
        item.failedAt = new Date()
        await this.storage.put(`delivery:${item.id}`, item)
        await this.moveToDLQ(item, errorMessage)
      } else {
        // Schedule retry
        item.status = 'pending_retry'
        item.nextRetryAt = this.calculateNextRetry(item.attempts)
        await this.storage.put(`delivery:${item.id}`, item)
      }
    }
  }

  private checkRateLimit(channel: NotificationChannel): boolean {
    const config = this.rateLimitConfig[channel]
    if (!config) return true

    const now = Date.now()
    let window = this.rateLimitWindows.get(channel)

    if (!window) {
      window = {
        second: { count: 0, timestamp: now },
        minute: { count: 0, timestamp: now },
      }
      this.rateLimitWindows.set(channel, window)
    }

    // Reset second window if expired
    if (now - window.second.timestamp >= 1000) {
      window.second = { count: 0, timestamp: now }
    }

    // Reset minute window if expired
    if (now - window.minute.timestamp >= 60000) {
      window.minute = { count: 0, timestamp: now }
    }

    // Check limits
    if (config.maxPerSecond !== undefined && window.second.count >= config.maxPerSecond) {
      return false
    }

    if (config.maxPerMinute !== undefined && window.minute.count >= config.maxPerMinute) {
      return false
    }

    return true
  }

  private recordDelivery(channel: NotificationChannel): void {
    let window = this.rateLimitWindows.get(channel)

    if (!window) {
      const now = Date.now()
      window = {
        second: { count: 0, timestamp: now },
        minute: { count: 0, timestamp: now },
      }
      this.rateLimitWindows.set(channel, window)
    }

    window.second.count++
    window.minute.count++
  }

  private calculateNextRetry(attempts: number): Date {
    const baseDelay = this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempts - 1)
    const cappedDelay = Math.min(baseDelay, this.retryConfig.maxDelayMs)

    // Add jitter
    const jitter = this.retryConfig.jitterFactor * cappedDelay * (Math.random() * 2 - 1)
    const finalDelay = Math.max(0, cappedDelay + jitter)

    return new Date(Date.now() + finalDelay)
  }

  private async moveToDLQ(item: DeliveryItem, error: string): Promise<void> {
    const dlqId = `dlq_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`

    const entry: DeadLetterEntry = {
      id: dlqId,
      originalId: item.id,
      channel: item.channel,
      payload: item.payload,
      recipient: item.recipient,
      metadata: item.metadata,
      error,
      attempts: item.attempts,
      failedAt: new Date(),
    }

    await this.storage.put(`dlq:${dlqId}`, entry)
  }

  private checkBatchFlush(): void {
    if (this.pendingBatch.length >= this.batchConfig.maxSize) {
      void this.flush()
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null
        void this.flush()
      }, this.batchConfig.maxWaitMs)
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new DeliveryQueue instance
 *
 * @param options - Queue configuration options
 * @returns A new DeliveryQueue instance
 *
 * @example
 * ```typescript
 * const queue = createDeliveryQueue({
 *   storage: ctx.storage,
 *   retry: { maxAttempts: 5, initialDelayMs: 1000 },
 *   rateLimit: { email: { maxPerSecond: 10 } },
 *   batch: { maxSize: 50, maxWaitMs: 2000 },
 * })
 *
 * queue.registerHandler('email', async (item) => {
 *   await sendEmail(item.payload)
 *   return { messageId: 'msg_123' }
 * })
 *
 * const result = await queue.enqueue({
 *   channel: 'email',
 *   payload: { to: 'user@example.com', subject: 'Hello' },
 *   recipient: { email: 'user@example.com' },
 * })
 *
 * queue.start()
 * ```
 */
export function createDeliveryQueue(options: DeliveryQueueOptions): DeliveryQueue {
  return new DeliveryQueue(options)
}
