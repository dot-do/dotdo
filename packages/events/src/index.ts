/**
 * @dotdo/events v4 - Event emission to Cloudflare Pipelines
 * Core package - every DO uses this
 */

import type { Event, EventId, OrgId } from '@dotdo/types'

// ============================================================================
// Pipeline Binding Types (Cloudflare Pipelines)
// ============================================================================

/**
 * Cloudflare Pipeline Stream binding
 * @see https://developers.cloudflare.com/pipelines/streams/
 */
export interface PipelineStream {
  send(message: unknown): Promise<void>
  sendBatch(messages: unknown[]): Promise<void>
}

// ============================================================================
// Event Emitter
// ============================================================================

export interface EventEmitterOptions {
  /** Pipeline stream binding */
  pipeline: PipelineStream
  /** Organization ID for all events */
  orgId?: OrgId
  /** DO ID for correlation */
  doId?: string
  /** DO class name */
  doClass?: string
  /** Batch size before auto-flush */
  batchSize?: number
  /** Flush interval in ms */
  flushIntervalMs?: number
}

export class EventEmitter {
  private pipeline: PipelineStream
  private orgId?: OrgId
  private doId?: string
  private doClass?: string
  private batchSize: number
  private flushIntervalMs: number
  private buffer: Event[] = []
  private flushTimer?: ReturnType<typeof setTimeout>

  constructor(options: EventEmitterOptions) {
    this.pipeline = options.pipeline
    this.orgId = options.orgId
    this.doId = options.doId
    this.doClass = options.doClass
    this.batchSize = options.batchSize ?? 100
    this.flushIntervalMs = options.flushIntervalMs ?? 1000
  }

  /**
   * Emit a single event
   */
  async emit<T>(event: Omit<Event<T>, 'id' | 'timestamp' | 'orgId'> & { orgId?: OrgId }): Promise<EventId> {
    const id = crypto.randomUUID() as EventId
    const fullEvent: Event<T> = {
      ...event,
      id,
      timestamp: new Date(),
      orgId: event.orgId ?? this.orgId,
      metadata: {
        ...event.metadata,
        doId: this.doId,
        doClass: this.doClass,
      },
    } as Event<T>

    this.buffer.push(fullEvent as Event)

    if (this.buffer.length >= this.batchSize) {
      await this.flush()
    } else {
      this.scheduleFlush()
    }

    return id
  }

  /**
   * Emit a batch of events
   */
  async emitBatch<T>(events: Array<Omit<Event<T>, 'id' | 'timestamp'>>): Promise<EventId[]> {
    const ids: EventId[] = []

    for (const event of events) {
      const id = await this.emit(event)
      ids.push(id)
    }

    return ids
  }

  /**
   * Flush buffered events to Pipeline
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const events = this.buffer.splice(0, this.buffer.length)
    this.clearFlushTimer()

    try {
      await this.pipeline.sendBatch(events)
    } catch (error) {
      // On failure, put events back in buffer
      this.buffer.unshift(...events)
      throw error
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flush().catch(console.error)
    }, this.flushIntervalMs)
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
  }

  /**
   * Get pending event count
   */
  get pendingCount(): number {
    return this.buffer.length
  }
}

// ============================================================================
// Standard Event Helpers
// ============================================================================

export function createRpcEvent(data: {
  method: string
  duration: number
  success: boolean
  error?: string
}): Omit<Event, 'id' | 'timestamp' | 'orgId'> {
  return {
    type: 'rpc.call',
    data,
  }
}

export function createCdcEvent(data: {
  operation: 'insert' | 'update' | 'delete'
  collection: string
  docId: string
  before?: unknown
  after?: unknown
}): Omit<Event, 'id' | 'timestamp' | 'orgId'> {
  return {
    type: 'cdc.change',
    data,
  }
}

export function createUsageEvent(data: {
  metric: string
  value: number
  unit?: string
}): Omit<Event, 'id' | 'timestamp' | 'orgId'> {
  return {
    type: 'usage.recorded',
    data,
  }
}

export function createLifecycleEvent(data: {
  action: 'created' | 'activated' | 'hibernated' | 'deleted'
  doId: string
  doClass: string
}): Omit<Event, 'id' | 'timestamp' | 'orgId'> {
  return {
    type: 'lifecycle.changed',
    data,
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export type { Event, EventId, RpcEvent, CdcEvent, LifecycleEvent, UsageEvent } from '@dotdo/types'
