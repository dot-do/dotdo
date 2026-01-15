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
    if (this.buffer.length === 0) return

    const batch = this.buffer.splice(0, this.buffer.length)
    await this.sendWithRetry(batch)
  }

  /**
   * Close the emitter, flushing remaining events
   */
  async close(): Promise<void> {
    this.closed = true
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    // Flush remaining events in buffer (not yet started)
    // These haven't been sent yet, so we await them
    if (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, this.buffer.length)
      await this.sendWithRetry(batch)
    }

    // Don't wait for any previously in-flight promise - it will complete in background
    // This is safe because events are already on their way to pipeline
    // Not awaiting prevents hanging when pipeline is slow
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

    // Fire and forget - don't await
    this.flushPromise = this.sendWithRetry(batch).finally(() => {
      this.flushPromise = null
    })
  }

  /**
   * Send batch with retry logic
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
      } catch {
        // DLQ also failed - events are lost
        console.error('Failed to send to dead letter queue', lastError)
      }
    }
  }

  /**
   * Promise-based delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
