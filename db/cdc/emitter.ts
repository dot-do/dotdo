/**
 * CDCEmitter - Emits unified events to a pipeline
 */

import type {
  UnifiedEvent,
  PartialEvent,
  CDCEmitterOptions,
  EmitOptions,
} from './types'
import { createCDCEvent } from './transform'

/**
 * Pipeline interface (compatible with Cloudflare Pipeline)
 */
export interface Pipeline {
  send(events: unknown[]): Promise<void>
}

/**
 * CDCEmitter - Emits CDC and domain events to a pipeline
 *
 * Supports two modes:
 * 1. Immediate mode (default): Events sent immediately on emit()
 * 2. Batch mode: Events accumulated and sent on flush()
 */
export class CDCEmitter {
  protected pipeline: Pipeline
  protected ns: string
  protected source: string
  protected correlationId?: string

  // Batching state
  private batchMode: boolean = false
  private batchBuffer: UnifiedEvent[] = []
  private maxBatchSize: number = Infinity
  private maxBatchDelay: number = 0
  private batchTimer: ReturnType<typeof setTimeout> | null = null

  constructor(pipeline: Pipeline, options: CDCEmitterOptions) {
    if (!options.ns) {
      throw new Error('CDCEmitter requires ns option')
    }
    if (!options.source) {
      throw new Error('CDCEmitter requires source option')
    }

    this.pipeline = pipeline
    this.ns = options.ns
    this.source = options.source
  }

  /**
   * Start batch mode - events are accumulated until flush() is called
   */
  startBatch(): void {
    this.batchMode = true
    this.startDelayTimer()
  }

  /**
   * Set maximum batch size - auto-flush when reached
   */
  setMaxBatchSize(size: number): void {
    this.maxBatchSize = size
  }

  /**
   * Set maximum batch delay in milliseconds - auto-flush when reached
   */
  setMaxBatchDelay(delayMs: number): void {
    this.maxBatchDelay = delayMs
    // Restart timer if we're already in batch mode
    if (this.batchMode && this.batchBuffer.length > 0) {
      this.startDelayTimer()
    }
  }

  /**
   * Flush accumulated events to the pipeline
   * @returns Number of events flushed
   */
  async flush(): Promise<number> {
    this.clearDelayTimer()

    if (this.batchBuffer.length === 0) {
      return 0
    }

    const events = [...this.batchBuffer]
    this.batchBuffer = []

    await this.pipeline.send(events)
    return events.length
  }

  private startDelayTimer(): void {
    if (this.maxBatchDelay > 0 && !this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.flush()
      }, this.maxBatchDelay)
    }
  }

  private clearDelayTimer(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
  }

  private async checkAutoFlush(): Promise<void> {
    if (this.batchBuffer.length >= this.maxBatchSize) {
      await this.flush()
    }
  }

  /**
   * Create a new emitter with a correlation ID for context propagation
   */
  withCorrelation(correlationId: string): CDCEmitter {
    const emitter = new CDCEmitter(this.pipeline, {
      ns: this.ns,
      source: this.source,
    })
    emitter.correlationId = correlationId
    return emitter
  }

  /**
   * Build a complete UnifiedEvent from partial input
   */
  private buildEvent(partial: PartialEvent, options?: EmitOptions): UnifiedEvent {
    const event = createCDCEvent({
      ...partial,
      ns: this.ns,
    })

    // Add source to _meta
    event._meta = {
      ...event._meta,
      source: this.source,
    }

    // Add correlation ID from options or instance
    const correlationId = options?.correlationId ?? this.correlationId
    if (correlationId) {
      event.correlationId = correlationId
    }

    return event
  }

  /**
   * Emit a single event to the pipeline
   *
   * In batch mode, events are accumulated until flush() is called
   */
  async emit(partial: PartialEvent, options?: EmitOptions): Promise<UnifiedEvent> {
    const event = this.buildEvent(partial, options)

    if (this.batchMode) {
      this.batchBuffer.push(event)
      await this.checkAutoFlush()
    } else {
      await this.pipeline.send([event])
    }

    return event
  }

  /**
   * Emit multiple events in a single batch
   */
  async emitBatch(
    partials: PartialEvent[],
    options?: EmitOptions
  ): Promise<UnifiedEvent[]> {
    if (partials.length === 0) {
      return []
    }

    const events = partials.map((partial, index) => {
      const event = this.buildEvent(partial, options)

      // Add txid if provided
      if (options?.txid) {
        event.txid = options.txid
      }

      // Add sequential lsn
      event.lsn = index

      return event
    })

    await this.pipeline.send(events)
    return events
  }
}
