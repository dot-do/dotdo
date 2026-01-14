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
 */
export class CDCEmitter {
  private pipeline: Pipeline
  private ns: string
  private source: string
  private correlationId?: string

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
   */
  async emit(partial: PartialEvent, options?: EmitOptions): Promise<UnifiedEvent> {
    const event = this.buildEvent(partial, options)
    await this.pipeline.send([event])
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
