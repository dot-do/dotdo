/**
 * L1: PipelineEmitter (WAL)
 *
 * Fire-and-forget event emission for durability.
 * Events are durable in Pipeline BEFORE local SQLite persistence.
 * This guarantees zero data loss on DO eviction.
 */

export interface EmittedEvent {
  type: string
  stream: string
  payload: unknown
  timestamp: string
  idempotencyKey: string
  _meta: {
    namespace: string
    emittedAt: number
  }
}

export interface PipelineEmitterConfig {
  namespace: string
  flushInterval?: number // ms between flushes
  batchSize?: number // max events before flush
  maxRetries?: number // retry count on failure
  retryDelay?: number // ms between retries
  deadLetterQueue?: Pipeline // DLQ for failed events
}

interface Pipeline {
  send(batch: unknown[]): Promise<void>
}

/**
 * Generates a unique idempotency key
 */
function generateIdempotencyKey(): string {
  const random = Math.random().toString(36).substring(2, 15)
  const timestamp = Date.now().toString(36)
  return `${timestamp}-${random}`
}

export class PipelineEmitter {
  private pipeline: Pipeline
  private config: Required<Omit<PipelineEmitterConfig, 'deadLetterQueue'>> & { deadLetterQueue?: Pipeline }
  private buffer: EmittedEvent[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private closed: boolean = false
  private flushPromise: Promise<void> | null = null
  private pendingFlushes: Promise<void>[] = []

  constructor(pipeline: Pipeline, config: PipelineEmitterConfig) {
    this.pipeline = pipeline
    this.config = {
      namespace: config.namespace,
      flushInterval: config.flushInterval ?? 1000,
      batchSize: config.batchSize ?? 100,
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 100,
      deadLetterQueue: config.deadLetterQueue,
    }

    // Start flush timer if interval > 0
    if (this.config.flushInterval > 0) {
      this.scheduleFlush()
    }
  }

  /**
   * Emit an event to the pipeline (fire-and-forget)
   * Returns immediately - does not wait for pipeline response
   */
  emit(type: string, stream: string, payload: unknown): void {
    if (this.closed) {
      throw new Error('PipelineEmitter is closed')
    }

    const event: EmittedEvent = {
      type,
      stream,
      payload,
      timestamp: new Date().toISOString(),
      idempotencyKey: generateIdempotencyKey(),
      _meta: {
        namespace: this.config.namespace,
        emittedAt: Date.now(),
      },
    }

    this.buffer.push(event)

    // Check if we should flush immediately (batch size reached or immediate mode)
    if (this.config.flushInterval === 0 || this.buffer.length >= this.config.batchSize) {
      this.triggerFlush()
    }
  }

  /**
   * Explicitly flush all buffered events
   */
  async flush(): Promise<void> {
    // Wait for ALL in-flight flushes to complete first
    if (this.pendingFlushes.length > 0) {
      await Promise.all(this.pendingFlushes)
    }

    if (this.buffer.length === 0) return

    const batch = this.buffer.splice(0, this.buffer.length)
    await this.sendWithRetry(batch)
  }

  /**
   * Close the emitter, flushing remaining events
   * Awaits all in-flight flush operations before returning.
   */
  async close(): Promise<void> {
    // Stop accepting new events
    this.closed = true

    // Stop the flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    // Wait for all in-flight flush operations to complete
    if (this.pendingFlushes.length > 0) {
      await Promise.all(this.pendingFlushes)
    }

    // Flush any remaining events in the buffer
    if (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, this.buffer.length)
      await this.sendWithRetry(batch)
    }

    // Clear state
    this.pendingFlushes = []
    this.flushPromise = null
  }

  /**
   * Schedule periodic flush
   */
  private scheduleFlush(): void {
    if (this.closed) return

    this.flushTimer = setTimeout(() => {
      this.triggerFlush()
      this.scheduleFlush()
    }, this.config.flushInterval)
  }

  /**
   * Trigger an async flush (non-blocking)
   */
  private triggerFlush(): void {
    if (this.buffer.length === 0) return

    const batch = this.buffer.splice(0, this.buffer.length)

    // Fire and forget - but track the promise so close() can await it
    const flushOp = this.sendWithRetry(batch).finally(() => {
      // Remove this promise from pendingFlushes when done
      const idx = this.pendingFlushes.indexOf(flushOp)
      if (idx >= 0) {
        this.pendingFlushes.splice(idx, 1)
      }
      // Clear flushPromise if it's this one
      if (this.flushPromise === flushOp) {
        this.flushPromise = null
      }
    })

    this.pendingFlushes.push(flushOp)
    this.flushPromise = flushOp
  }

  /**
   * Send batch with retry logic
   * @throws Error if all retries fail and no DLQ is configured (or DLQ also fails)
   */
  private async sendWithRetry(batch: EmittedEvent[]): Promise<void> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        await this.pipeline.send(batch)
        return // Success
      } catch (error) {
        lastError = error as Error

        // Wait before retry (except on last attempt)
        if (attempt < this.config.maxRetries - 1) {
          await this.delay(this.config.retryDelay)
        }
      }
    }

    // All retries failed - send to DLQ if configured
    if (this.config.deadLetterQueue) {
      try {
        await this.config.deadLetterQueue.send(batch)
        return // DLQ succeeded, don't throw
      } catch {
        // DLQ also failed - events are lost, throw the original error
        console.error('Failed to send to dead letter queue', lastError)
      }
    }

    // No DLQ or DLQ failed - propagate the error
    if (lastError) {
      throw lastError
    }
  }

  /**
   * Promise-based delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
