/**
 * CDCEmitterWithDLQ - CDC emitter with retry and dead letter queue support
 *
 * Wraps CDCEmitter with:
 * - Configurable retry policies (constant, exponential)
 * - Dead Letter Queue routing for failed events
 * - DLQ metadata attachment
 */

import type { Pipeline } from './emitter'
import type { PartialEvent, EmitOptions, UnifiedEvent } from './types'
import { createCDCEvent } from './transform'

/**
 * ULID generator for DLQ IDs
 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function ulid(): string {
  const now = Date.now()
  let timestamp = now
  let timeStr = ''
  for (let i = 0; i < 10; i++) {
    timeStr = ENCODING[timestamp % 32] + timeStr
    timestamp = Math.floor(timestamp / 32)
  }

  let randStr = ''
  for (let i = 0; i < 16; i++) {
    randStr += ENCODING[Math.floor(Math.random() * 32)]
  }

  return timeStr + randStr
}

/**
 * DLQ metadata attached to failed events
 */
export interface DLQMetadata {
  dlqId: string
  reason: string
  retries: number
  originalTimestamp: string
  dlqTimestamp: string
  failureStack?: string
}

/**
 * Event with DLQ metadata
 */
export interface DLQEvent extends UnifiedEvent {
  _dlq: DLQMetadata
}

/**
 * Retry policy type
 */
export type RetryPolicy = 'constant' | 'exponential' | 'none'

/**
 * Options for CDCEmitterWithDLQ
 */
export interface CDCEmitterWithDLQOptions {
  ns: string
  source: string
  dlq: Pipeline
  maxRetries?: number
  retryPolicy?: RetryPolicy
  baseDelay?: number
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * CDCEmitterWithDLQ - Emitter with retry and dead letter queue
 */
export class CDCEmitterWithDLQ {
  private pipeline: Pipeline
  private dlq: Pipeline
  private ns: string
  private source: string
  private maxRetries: number
  private retryPolicy: RetryPolicy
  private baseDelay: number

  constructor(pipeline: Pipeline, options: CDCEmitterWithDLQOptions) {
    this.pipeline = pipeline
    this.dlq = options.dlq
    this.ns = options.ns
    this.source = options.source
    this.maxRetries = options.maxRetries ?? 3
    this.retryPolicy = options.retryPolicy ?? 'none'
    this.baseDelay = options.baseDelay ?? 100
  }

  /**
   * Calculate delay for a retry attempt
   */
  private getRetryDelay(attempt: number): number {
    switch (this.retryPolicy) {
      case 'exponential':
        return this.baseDelay * Math.pow(2, attempt)
      case 'constant':
        return this.baseDelay
      default:
        return 0
    }
  }

  /**
   * Build event from partial
   */
  private buildEvent(partial: PartialEvent, options?: EmitOptions): UnifiedEvent {
    return createCDCEvent({
      ...partial,
      ns: this.ns,
      _meta: {
        schemaVersion: 1,
        source: this.source,
        ...partial._meta,
      },
    })
  }

  /**
   * Send event to DLQ with metadata
   */
  private async sendToDLQ(event: UnifiedEvent, error: Error, retries: number): Promise<void> {
    const dlqEvent: DLQEvent = {
      ...event,
      _dlq: {
        dlqId: ulid(),
        reason: error.message,
        retries,
        originalTimestamp: event.timestamp,
        dlqTimestamp: new Date().toISOString(),
        failureStack: error.stack,
      },
    }

    await this.dlq.send([dlqEvent])
  }

  /**
   * Emit a single event with retry and DLQ support
   */
  async emit(partial: PartialEvent, options?: EmitOptions): Promise<UnifiedEvent> {
    const event = this.buildEvent(partial, options)

    let lastError: Error | null = null
    let attempts = 0

    // Try initial + retries
    while (attempts <= this.maxRetries) {
      try {
        await this.pipeline.send([event])
        return event
      } catch (error) {
        lastError = error as Error
        attempts++

        // If we have more retries, wait before next attempt
        if (attempts <= this.maxRetries) {
          const delay = this.getRetryDelay(attempts - 1)
          if (delay > 0) {
            await sleep(delay)
          }
        }
      }
    }

    // All retries exhausted, send to DLQ
    await this.sendToDLQ(event, lastError!, this.maxRetries)

    return event
  }
}
