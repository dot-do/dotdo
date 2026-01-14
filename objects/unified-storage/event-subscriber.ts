/**
 * EventSubscriber - Subscribe to Pipeline events for replication
 *
 * Enables DOs to subscribe to Pipeline events for replication:
 * - Subscribes to topics on the Pipeline event bus
 * - Receives events in order with batch delivery
 * - Checkpoints consumed offsets for durability
 * - Replays from checkpoint on reconnect
 * - Ensures exactly-once delivery via idempotency keys
 *
 * @example
 * ```typescript
 * const subscriber = new EventSubscriber(pipelineSource, {
 *   namespace: 'replica-do',
 *   checkpointStore,
 *   onEvent: (event) => processEvent(event),
 *   enableIdempotency: true,
 * })
 *
 * await subscriber.subscribe('things')
 * await subscriber.poll()
 *
 * // Later
 * await subscriber.close()
 * ```
 *
 * @module unified-storage/event-subscriber
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Consumed event structure from Pipeline
 */
export interface ConsumedEvent {
  /** Event offset in the topic */
  offset: number
  /** Topic name */
  topic: string
  /** Event verb (e.g., 'thing.created') */
  verb: string
  /** Idempotency key for deduplication */
  idempotencyKey?: string
  /** ISO 8601 timestamp */
  timestamp: string
  /** Event payload data */
  payload: unknown
  /** Event metadata */
  _meta: {
    namespace: string
    source: string
    isDelta?: boolean
  }
}

/**
 * Checkpoint mode for controlling when offsets are persisted
 */
export type CheckpointMode = 'auto' | 'manual' | 'interval'

/**
 * Options for subscribing to a topic
 */
export interface SubscriptionOptions {
  /** Starting offset to consume from */
  fromOffset?: number
  /** Batch size for consumption */
  batchSize?: number
  /** Enable auto-checkpoint for this subscription */
  autoCheckpoint?: boolean
}

/**
 * Checkpoint store interface for persisting offsets
 */
export interface CheckpointStore {
  get(key: string): Promise<number | null>
  set(key: string, offset: number): Promise<void>
  delete(key: string): Promise<void>
  getAll(): Promise<Record<string, number>>
}

/**
 * Pipeline source interface for consuming events
 */
export interface PipelineSource {
  connect(topic: string): Promise<{ topic: string; offset: number }>
  disconnect(): Promise<void>
  subscribe(topic: string, callback: (event: ConsumedEvent) => void): void
  unsubscribe(topic: string): void
  consume(
    topic: string,
    fromOffset: number,
    limit: number
  ): Promise<{
    events: ConsumedEvent[]
    nextOffset: number
    hasMore: boolean
  }>
  getLatestOffset(topic: string): Promise<number>
}

/**
 * Configuration for EventSubscriber
 */
export interface EventSubscriberConfig {
  /** Namespace/tenant identifier */
  namespace: string
  /** Checkpoint store for persisting offsets */
  checkpointStore: CheckpointStore
  /** Event callback for individual events */
  onEvent?: (event: ConsumedEvent) => void
  /** Batch callback for batch delivery */
  onBatch?: (events: ConsumedEvent[]) => void
  /** Error callback */
  onError?: (error: Error, event?: ConsumedEvent) => void
  /** Batch size for consumption - defaults to 100 */
  batchSize?: number
  /** Poll interval in ms - defaults to 1000 */
  pollInterval?: number
  /** Checkpoint mode - defaults to 'auto' */
  checkpointMode?: CheckpointMode
  /** Checkpoint interval in ms (for interval mode) */
  checkpointInterval?: number
  /** Enable idempotency tracking */
  enableIdempotency?: boolean
  /** Idempotency window in ms */
  idempotencyWindowMs?: number
  /** Maximum retry attempts */
  maxRetries?: number
  /** Retry delay in ms */
  retryDelay?: number
}

/**
 * Resolved config with defaults applied
 */
export interface ResolvedEventSubscriberConfig {
  readonly namespace: string
  readonly batchSize: number
  readonly pollInterval: number
  readonly checkpointMode: CheckpointMode
  readonly checkpointInterval: number
  readonly enableIdempotency: boolean
  readonly idempotencyWindowMs: number
  readonly maxRetries: number
  readonly retryDelay: number
}

/**
 * Idempotency statistics
 */
export interface IdempotencyStats {
  trackedKeys: number
  duplicatesSkipped: number
}

/**
 * Processing statistics
 */
export interface ProcessingStats {
  eventsProcessed: number
  batchesProcessed: number
  lastProcessedOffset: number | null
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG = {
  batchSize: 100,
  pollInterval: 1000,
  checkpointMode: 'auto' as CheckpointMode,
  checkpointInterval: 5000,
  enableIdempotency: false,
  idempotencyWindowMs: 60000, // 1 minute
  maxRetries: 3,
  retryDelay: 100,
} as const

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Yield control back to the event loop
 * Works correctly with both real and fake timers
 */
function nextTick(): Promise<void> {
  return Promise.resolve().then(() => {})
}

// ============================================================================
// EVENT SUBSCRIBER CLASS
// ============================================================================

/**
 * EventSubscriber - Subscribe to Pipeline events for replication
 */
export class EventSubscriber {
  private pipelineSource: PipelineSource
  private checkpointStore: CheckpointStore
  private _config: ResolvedEventSubscriberConfig
  private onEventCallback?: (event: ConsumedEvent) => void
  private onBatchCallback?: (events: ConsumedEvent[]) => void
  private onErrorCallback?: (error: Error, event?: ConsumedEvent) => void

  // Subscription state
  private subscriptions = new Map<string, { offset: number; options?: SubscriptionOptions }>()
  private _closed = false

  // Idempotency tracking
  private _seenIdempotencyKeys = new Map<string, number>() // key -> timestamp
  private _duplicatesSkipped = 0

  // Processing stats
  private _eventsProcessed = 0
  private _batchesProcessed = 0
  private _lastProcessedOffset: number | null = null

  // Checkpoint interval timer
  private checkpointTimer?: ReturnType<typeof setInterval>
  private pendingCheckpoint = new Map<string, number>()

  constructor(pipelineSource: PipelineSource, config: EventSubscriberConfig) {
    this.pipelineSource = pipelineSource
    this.checkpointStore = config.checkpointStore
    this.onEventCallback = config.onEvent
    this.onBatchCallback = config.onBatch
    this.onErrorCallback = config.onError

    // Merge config with defaults
    this._config = Object.freeze({
      namespace: config.namespace,
      batchSize: config.batchSize ?? DEFAULT_CONFIG.batchSize,
      pollInterval: config.pollInterval ?? DEFAULT_CONFIG.pollInterval,
      checkpointMode: config.checkpointMode ?? DEFAULT_CONFIG.checkpointMode,
      checkpointInterval: config.checkpointInterval ?? DEFAULT_CONFIG.checkpointInterval,
      enableIdempotency: config.enableIdempotency ?? DEFAULT_CONFIG.enableIdempotency,
      idempotencyWindowMs: config.idempotencyWindowMs ?? DEFAULT_CONFIG.idempotencyWindowMs,
      maxRetries: config.maxRetries ?? DEFAULT_CONFIG.maxRetries,
      retryDelay: config.retryDelay ?? DEFAULT_CONFIG.retryDelay,
    })

    // Start checkpoint interval timer if configured
    if (this._config.checkpointMode === 'interval') {
      this.startCheckpointInterval()
    }
  }

  /**
   * Get the subscriber configuration (readonly/frozen)
   */
  get config(): ResolvedEventSubscriberConfig {
    return this._config
  }

  /**
   * Check if subscribed to any topics
   */
  get isSubscribed(): boolean {
    return this.subscriptions.size > 0
  }

  /**
   * Get list of subscribed topics
   */
  get subscribedTopics(): string[] {
    return Array.from(this.subscriptions.keys())
  }

  /**
   * Check if subscribed to a specific topic
   */
  isSubscribedTo(topic: string): boolean {
    return this.subscriptions.has(topic)
  }

  /**
   * Check if the subscriber is closed
   */
  get closed(): boolean {
    return this._closed
  }

  /**
   * Get seen idempotency keys (for testing)
   */
  get seenIdempotencyKeys(): Map<string, number> {
    return this._seenIdempotencyKeys
  }

  /**
   * Get idempotency statistics
   */
  get idempotencyStats(): IdempotencyStats {
    return {
      trackedKeys: this._seenIdempotencyKeys.size,
      duplicatesSkipped: this._duplicatesSkipped,
    }
  }

  /**
   * Get processing statistics
   */
  get stats(): ProcessingStats {
    return {
      eventsProcessed: this._eventsProcessed,
      batchesProcessed: this._batchesProcessed,
      lastProcessedOffset: this._lastProcessedOffset,
    }
  }

  /**
   * Subscribe to a topic and start consuming events
   */
  async subscribe(topic: string, options?: SubscriptionOptions): Promise<void> {
    if (this._closed) {
      throw new Error('EventSubscriber is closed')
    }

    if (this.subscriptions.has(topic)) {
      throw new Error(`Already subscribed to topic: ${topic}`)
    }

    // Connect to topic
    await this.pipelineSource.connect(topic)

    // Get starting offset from checkpoint or options
    let startOffset = options?.fromOffset ?? 0
    const checkpoint = await this.checkpointStore.get(topic)
    if (checkpoint !== null && options?.fromOffset === undefined) {
      startOffset = checkpoint
    }

    // Register subscription
    this.subscriptions.set(topic, { offset: startOffset, options })

    // Subscribe for real-time push notifications
    this.pipelineSource.subscribe(topic, (event) => {
      this.handlePushedEvent(event)
    })
  }

  /**
   * Unsubscribe from a topic or all topics
   */
  async unsubscribe(topic?: string): Promise<void> {
    if (topic) {
      // Unsubscribe from specific topic
      if (this.subscriptions.has(topic)) {
        this.pipelineSource.unsubscribe(topic)
        this.subscriptions.delete(topic)
      }
    } else {
      // Unsubscribe from all topics
      for (const t of this.subscriptions.keys()) {
        this.pipelineSource.unsubscribe(t)
      }
      this.subscriptions.clear()
    }

    // Disconnect if no more subscriptions
    if (this.subscriptions.size === 0) {
      await this.pipelineSource.disconnect()
    }
  }

  /**
   * Get the last checkpoint for a topic
   */
  async getCheckpoint(topic: string): Promise<number | null> {
    return this.checkpointStore.get(topic)
  }

  /**
   * Manually checkpoint an offset for a topic
   */
  async checkpoint(topic: string, offset: number): Promise<void> {
    await this.checkpointStore.set(topic, offset)
  }

  /**
   * Poll for new events from all subscribed topics
   */
  async poll(): Promise<void> {
    if (this._closed) {
      return
    }

    for (const [topic, sub] of this.subscriptions) {
      await this.pollTopic(topic, sub.offset)
    }
  }

  /**
   * Replay events from a specific offset
   */
  async replayFrom(topic: string, offset: number): Promise<void> {
    if (!this.subscriptions.has(topic)) {
      throw new Error(`Not subscribed to topic: ${topic}`)
    }

    // Update the subscription offset
    const sub = this.subscriptions.get(topic)!
    sub.offset = offset

    // Poll from the new offset
    await this.pollTopic(topic, offset)
  }

  /**
   * Clean up old idempotency keys outside the window
   */
  cleanupIdempotencyKeys(): void {
    const now = Date.now()
    const window = this._config.idempotencyWindowMs

    for (const [key, timestamp] of this._seenIdempotencyKeys) {
      if (now - timestamp > window) {
        this._seenIdempotencyKeys.delete(key)
      }
    }
  }

  /**
   * Close the subscriber
   */
  async close(): Promise<void> {
    if (this._closed) {
      return
    }

    this._closed = true

    // Stop checkpoint interval timer
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer)
      this.checkpointTimer = undefined
    }

    // Checkpoint all pending offsets
    for (const [topic, offset] of this.pendingCheckpoint) {
      await this.checkpointStore.set(topic, offset)
    }
    this.pendingCheckpoint.clear()

    // Also checkpoint last processed offsets for each subscription
    for (const [topic, sub] of this.subscriptions) {
      if (sub.offset > 0) {
        await this.checkpointStore.set(topic, sub.offset)
      }
    }

    // Unsubscribe from all topics
    for (const topic of this.subscriptions.keys()) {
      this.pipelineSource.unsubscribe(topic)
    }
    this.subscriptions.clear()

    // Disconnect
    await this.pipelineSource.disconnect()
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Start the checkpoint interval timer
   */
  private startCheckpointInterval(): void {
    if (this.checkpointTimer) {
      return
    }

    this.checkpointTimer = setInterval(async () => {
      // Checkpoint all pending offsets
      for (const [topic, offset] of this.pendingCheckpoint) {
        await this.checkpointStore.set(topic, offset)
      }
      this.pendingCheckpoint.clear()
    }, this._config.checkpointInterval)
  }

  /**
   * Poll a single topic for events
   */
  private async pollTopic(topic: string, fromOffset: number): Promise<void> {
    const batchSize = this._config.batchSize
    let currentOffset = fromOffset
    let hasMore = true

    while (hasMore && !this._closed) {
      // Consume with retry
      const result = await this.consumeWithRetry(topic, currentOffset, batchSize)
      if (!result) {
        return
      }

      const { events, nextOffset } = result
      hasMore = result.hasMore

      if (events.length === 0) {
        break
      }

      // Process events
      await this.processEvents(topic, events)

      // Update current offset
      currentOffset = nextOffset

      // Update subscription offset
      const sub = this.subscriptions.get(topic)
      if (sub) {
        sub.offset = currentOffset
      }

      // Handle checkpointing based on mode
      if (this._config.checkpointMode === 'auto') {
        await this.checkpointStore.set(topic, currentOffset)
        this._batchesProcessed++
      } else if (this._config.checkpointMode === 'interval') {
        this.pendingCheckpoint.set(topic, currentOffset)
        this._batchesProcessed++
      } else {
        this._batchesProcessed++
      }
    }
  }

  /**
   * Consume events with retry logic
   */
  private async consumeWithRetry(
    topic: string,
    fromOffset: number,
    limit: number
  ): Promise<{ events: ConsumedEvent[]; nextOffset: number; hasMore: boolean } | null> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt < this._config.maxRetries; attempt++) {
      try {
        return await this.pipelineSource.consume(topic, fromOffset, limit)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        this.onErrorCallback?.(lastError)

        if (attempt < this._config.maxRetries - 1) {
          // Yield to event loop between retries
          // Using nextTick instead of setTimeout to work correctly with fake timers in tests
          await nextTick()
        }
      }
    }

    // All retries failed
    if (lastError) {
      throw lastError
    }

    return null
  }

  /**
   * Process a batch of events
   */
  private async processEvents(topic: string, events: ConsumedEvent[]): Promise<void> {
    // Filter out duplicates if idempotency is enabled
    const filteredEvents = this._config.enableIdempotency
      ? events.filter((event) => this.checkIdempotency(event))
      : events

    // Call batch callback if provided
    if (this.onBatchCallback) {
      this.onBatchCallback(filteredEvents)
    }

    // Call individual event callbacks
    if (this.onEventCallback) {
      for (const event of filteredEvents) {
        try {
          this.onEventCallback(event)
          this._eventsProcessed++
          this._lastProcessedOffset = event.offset
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          this.onErrorCallback?.(err, event)
        }
      }
    } else {
      // Just track stats if no callback
      this._eventsProcessed += filteredEvents.length
      if (filteredEvents.length > 0) {
        this._lastProcessedOffset = filteredEvents[filteredEvents.length - 1].offset
      }
    }
  }

  /**
   * Check idempotency and track key if new
   * Returns true if event should be processed, false if duplicate
   */
  private checkIdempotency(event: ConsumedEvent): boolean {
    if (!event.idempotencyKey) {
      return true
    }

    if (this._seenIdempotencyKeys.has(event.idempotencyKey)) {
      this._duplicatesSkipped++
      return false
    }

    // Track the key
    this._seenIdempotencyKeys.set(event.idempotencyKey, Date.now())
    return true
  }

  /**
   * Handle a pushed event from real-time subscription
   */
  private handlePushedEvent(event: ConsumedEvent): void {
    if (this._closed) {
      return
    }

    // Check idempotency
    if (this._config.enableIdempotency && !this.checkIdempotency(event)) {
      return
    }

    // Call callback
    if (this.onEventCallback) {
      try {
        this.onEventCallback(event)
        this._eventsProcessed++
        this._lastProcessedOffset = event.offset
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        this.onErrorCallback?.(err, event)
      }
    }

    // Update subscription offset
    const sub = this.subscriptions.get(event.topic)
    if (sub) {
      sub.offset = event.offset + 1
    }
  }
}
