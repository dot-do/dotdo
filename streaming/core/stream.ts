/**
 * StreamBridge - Cloudflare Pipelines integration for the compat layer
 *
 * Handles streaming data changes to analytics sinks:
 * - emit() for CRUD operations (insert/update/delete)
 * - Configurable batching and flush intervals
 * - Transform functions for filtering/enrichment
 * - Error handling with retries
 *
 * @example
 * ```typescript
 * const stream = new StreamBridge(env.EVENTS_PIPELINE, {
 *   sink: 'iceberg',
 *   batchSize: 1000,
 *   flushInterval: 60000,
 * })
 *
 * // Emit changes
 * stream.emit('insert', 'users', { id: 1, name: 'Alice' })
 * stream.emit('update', 'users', { id: 1, name: 'Bob' })
 *
 * // Flush at end of transaction
 * await stream.flush()
 * ```
 */
// Stream config types - will be moved to streaming/core in a future task
// For now, define locally to avoid circular dependency with db/core

/**
 * Analytics sink format
 * - iceberg: Apache Iceberg tables
 * - parquet: Parquet files
 * - json: JSON lines
 */
export type StreamSink = 'iceberg' | 'parquet' | 'json'

/**
 * Configuration for Cloudflare Pipelines integration
 */
export interface StreamConfig {
  /** Pipeline binding name */
  pipeline?: string
  /** Output format/sink */
  sink: StreamSink
  /** Transform function applied before sending */
  transform?: (event: unknown) => unknown
  /** Batch size before flush */
  batchSize?: number
  /** Flush interval in ms */
  flushInterval?: number
}

/**
 * Default stream configuration
 */
export const DEFAULT_STREAM_CONFIG: Pick<StreamConfig, 'sink' | 'batchSize' | 'flushInterval'> = {
  sink: 'iceberg',
  batchSize: 1000,
  flushInterval: 60000,
}

// ============================================================================
// STREAM EVENT TYPES
// ============================================================================

/**
 * Operation type for stream events
 */
export type StreamOperation = 'insert' | 'update' | 'delete'

/**
 * Stream event structure
 */
export interface StreamEvent {
  operation: StreamOperation
  table: string
  data: unknown
  previous?: unknown
  timestamp: number
  metadata?: Record<string, unknown>
}

/**
 * Create a stream event
 */
export function createStreamEvent(
  operation: StreamOperation,
  table: string,
  data: unknown,
  previous?: unknown,
  metadata?: Record<string, unknown>
): StreamEvent {
  return {
    operation,
    table,
    data,
    previous,
    timestamp: Date.now(),
    metadata,
  }
}

// ============================================================================
// PIPELINE TYPE
// ============================================================================

/**
 * Cloudflare Pipeline interface
 */
interface Pipeline {
  send(events: unknown[]): Promise<void>
}

// ============================================================================
// STREAM BRIDGE OPTIONS
// ============================================================================

/**
 * Additional options for StreamBridge
 */
export interface StreamBridgeOptions {
  /** Error handler for failed flushes */
  onError?: (error: Error, events: StreamEvent[]) => void
  /** Maximum retry attempts */
  maxRetries?: number
  /** Retry delay in ms */
  retryDelay?: number
}

// ============================================================================
// STREAM BRIDGE CLASS
// ============================================================================

/**
 * StreamBridge - Bridges database changes to Cloudflare Pipelines
 */
export class StreamBridge {
  private pipeline: Pipeline
  private _config: StreamConfig
  private options: StreamBridgeOptions
  private buffer: StreamEvent[] = []
  private flushTimer?: ReturnType<typeof setInterval>
  private destroyed = false

  constructor(
    pipeline: Pipeline,
    config?: Partial<StreamConfig>,
    options?: StreamBridgeOptions
  ) {
    this.pipeline = pipeline
    this._config = {
      ...DEFAULT_STREAM_CONFIG,
      ...config,
    }
    this.options = {
      maxRetries: 3,
      retryDelay: 1000,
      ...options,
    }
  }

  /**
   * Start auto-flush timer (call manually if needed)
   */
  startAutoFlush(): void {
    if (this.flushTimer || this.destroyed) {
      return
    }

    if (this._config.flushInterval && this._config.flushInterval > 0) {
      this.flushTimer = setInterval(() => {
        this.flush().catch(() => {
          // Errors handled internally
        })
      }, this._config.flushInterval)
    }
  }

  /**
   * Get the stream configuration
   */
  get config(): StreamConfig {
    return this._config
  }

  /**
   * Get current buffer size
   */
  get bufferSize(): number {
    return this.buffer.length
  }

  /**
   * Check if there are pending events
   */
  get pending(): boolean {
    return this.buffer.length > 0
  }

  /**
   * Emit a stream event
   *
   * @param operation - The CRUD operation
   * @param table - Table name
   * @param data - The row data
   * @param previous - Previous data (for updates)
   * @param metadata - Optional metadata
   */
  emit(
    operation: StreamOperation,
    table: string,
    data: unknown,
    previous?: unknown,
    metadata?: Record<string, unknown>
  ): void {
    if (this.destroyed) {
      return
    }

    const event = createStreamEvent(operation, table, data, previous, metadata)
    this.buffer.push(event)

    // Auto-flush if batch size reached
    if (this._config.batchSize && this.buffer.length >= this._config.batchSize) {
      this.flush().catch(() => {
        // Errors handled internally
      })
    }
  }

  /**
   * Flush all buffered events to the pipeline
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return
    }

    // Take and clear buffer
    const events = this.buffer.slice()
    this.buffer = []

    // Apply transform if configured
    let transformedEvents = events
    if (this._config.transform) {
      transformedEvents = []
      for (const event of events) {
        const result = this._config.transform(event)
        if (result !== null && result !== undefined) {
          transformedEvents.push(result as StreamEvent)
        }
      }
    }

    // Don't send if all events were filtered
    if (transformedEvents.length === 0) {
      return
    }

    // Send with retries
    let lastError: Error | undefined
    for (let attempt = 0; attempt < (this.options.maxRetries ?? 3); attempt++) {
      try {
        await this.pipeline.send(transformedEvents)
        return // Success
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Wait before retry (except on last attempt)
        if (attempt < (this.options.maxRetries ?? 3) - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.options.retryDelay ?? 1000)
          )
        }
      }
    }

    // Call error handler if all retries failed
    if (this.options.onError && lastError) {
      this.options.onError(lastError, events)
    }
  }

  /**
   * Destroy the stream bridge
   * Flushes any remaining events and stops auto-flush
   */
  destroy(): void {
    this.destroyed = true

    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = undefined
    }

    // Flush remaining events
    if (this.buffer.length > 0) {
      this.flush().catch(() => {
        // Best effort flush on destroy
      })
    }
  }
}
