/**
 * EventsStore - Event emission and streaming
 *
 * Provides:
 * - Event emission with sequence numbers
 * - Stream to Pipeline
 * - Replay capabilities
 */

import * as schema from '..'
import type {
  StoreContext,
  EventsStore as IEventsStore,
  EventEntity,
  EventsEmitOptions,
  EventsListOptions,
  EventsReplayOptions,
} from './types'

export class EventsStore implements IEventsStore {
  private db: StoreContext['db']
  private ns: string
  private pipeline?: StoreContext['env']['PIPELINE']
  private sequenceCounter = 0

  constructor(ctx: StoreContext) {
    this.db = ctx.db
    this.ns = ctx.ns
    this.pipeline = ctx.env.PIPELINE
  }

  async emit(options: EventsEmitOptions): Promise<EventEntity> {
    const id = crypto.randomUUID()
    const now = new Date()
    const sequence = ++this.sequenceCounter

    await this.db.insert(schema.events).values({
      id,
      verb: options.verb,
      source: options.source,
      data: options.data,
      sequence,
      streamed: false,
      createdAt: now,
    })

    return {
      id,
      verb: options.verb,
      source: options.source,
      data: options.data,
      actionId: options.actionId ?? null,
      sequence,
      streamed: false,
      streamedAt: null,
      createdAt: now,
    }
  }

  async stream(id: string): Promise<EventEntity> {
    const event = await this.get(id)
    if (!event) {
      throw new Error(`Event with id ${id} not found`)
    }

    if (this.pipeline) {
      await this.pipeline.send({
        id: event.id,
        verb: event.verb,
        source: event.source,
        data: event.data,
        sequence: event.sequence,
        timestamp: event.createdAt.toISOString(),
      })
    }

    const now = new Date()

    // Note: In production, use proper Drizzle update
    // await this.db.update(schema.events)
    //   .set({ streamed: true, streamedAt: now })
    //   .where(eq(schema.events.id, id))

    return {
      ...event,
      streamed: true,
      streamedAt: now,
    }
  }

  async streamPending(): Promise<number> {
    const pending = await this.list()
    const unstreamed = pending.filter((e) => !e.streamed)

    let count = 0
    for (const event of unstreamed) {
      await this.stream(event.id)
      count++
    }

    return count
  }

  async get(id: string): Promise<EventEntity | null> {
    const results = await this.db.select().from(schema.events)
    const result = results.find((r) => r.id === id)

    if (!result) return null
    return this.toEntity(result)
  }

  async list(options?: EventsListOptions): Promise<EventEntity[]> {
    const results = await this.db.select().from(schema.events)

    let filtered = results

    if (options?.source) {
      filtered = filtered.filter((r) => r.source === options.source)
    }
    if (options?.verb) {
      filtered = filtered.filter((r) => r.verb === options.verb)
    }
    if (options?.afterSequence !== undefined) {
      filtered = filtered.filter((r) => r.sequence > options.afterSequence!)
    }

    // Order
    const orderBy = options?.orderBy ?? 'sequence'
    const order = options?.order ?? 'asc'

    filtered.sort((a, b) => {
      let aVal: number | Date
      let bVal: number | Date

      if (orderBy === 'sequence') {
        aVal = a.sequence
        bVal = b.sequence
      } else {
        aVal = a.createdAt
        bVal = b.createdAt
      }

      if (aVal < bVal) return order === 'asc' ? -1 : 1
      if (aVal > bVal) return order === 'asc' ? 1 : -1
      return 0
    })

    return filtered.map((r) => this.toEntity(r))
  }

  async replay(options: EventsReplayOptions): Promise<EventEntity[]> {
    const limit = options.limit ?? 100
    const events = await this.list({
      afterSequence: options.fromSequence - 1,
      orderBy: 'sequence',
      order: 'asc',
    })

    return events.slice(0, limit)
  }

  private toEntity(row: typeof schema.events.$inferSelect): EventEntity {
    return {
      id: row.id,
      verb: row.verb,
      source: row.source,
      data: row.data as Record<string, unknown>,
      actionId: null, // Schema may not have this
      sequence: row.sequence,
      streamed: row.streamed ?? false,
      streamedAt: null, // Schema may not have this
      createdAt: row.createdAt,
    }
  }
}
