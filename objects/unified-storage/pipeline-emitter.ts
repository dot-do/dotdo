/**
 * PipelineEmitter - Fire-and-forget event emission to Cloudflare Pipeline
 *
 * Sends events to Cloudflare Pipeline in fire-and-forget mode:
 * - Emits events immediately (before local SQLite persistence)
 * - Generates idempotency keys to prevent duplicates
 * - Batches events for efficiency
 * - Handles failures gracefully (retry logic with exponential backoff)
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
}

/**
 * Pipeline interface (compatible with Cloudflare Pipeline)
 */
export interface Pipeline {
  send(events: unknown[]): Promise<void>
}

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
} as const

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
 */
export class PipelineEmitter {
  private pipeline: Pipeline
  private _config: ResolvedPipelineEmitterConfig
  private buffer: EmittedEvent[] = []
  private _bufferBytes: number = 0
  private flushTimer?: ReturnType<typeof setInterval>
  private _closed: boolean = false

  constructor(pipeline: Pipeline, config: PipelineEmitterConfig) {
    this.pipeline = pipeline

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
    })

    // Start auto-flush timer if interval > 0
    this.startAutoFlush()
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
    }

    // Track bytes
    const eventBytes = estimateBytes(event)
    this._bufferBytes += eventBytes
    this.buffer.push(event)

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

    await this.doFlush(events)
  }

  /**
   * Internal flush implementation with retry logic
   */
  private async doFlush(events: EmittedEvent[]): Promise<void> {
    if (events.length === 0) {
      return
    }

    let lastError: Error | undefined
    let currentDelay = this._config.retryDelay

    for (let attempt = 0; attempt < this._config.maxRetries; attempt++) {
      try {
        await this.pipeline.send(events)
        return // Success
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Wait before retry (except on last attempt)
        if (attempt < this._config.maxRetries - 1) {
          await sleep(currentDelay)

          // Apply exponential backoff if enabled
          if (this._config.exponentialBackoff) {
            currentDelay *= 2
          }
        }
      }
    }

    // Send to dead-letter queue if all retries failed and DLQ is configured
    if (this._config.deadLetterQueue && lastError) {
      try {
        await this._config.deadLetterQueue.send(events)
      } catch {
        // Best effort - don't throw
      }
    }
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
