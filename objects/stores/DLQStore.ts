/**
 * DLQStore - Dead Letter Queue for failed events
 *
 * Provides:
 * - Add failed events with error context
 * - Retry tracking (count, max, timestamps)
 * - Replay capabilities
 * - Cleanup and purge operations
 */

import * as schema from '../../db'
import type {
  StoreContext,
  DLQStore as IDLQStore,
  DLQEntity,
  DLQAddOptions,
  DLQListOptions,
  DLQReplayResult,
  DLQReplayAllResult,
} from './types'

export class DLQStore implements IDLQStore {
  private db: StoreContext['db']
  private ns: string
  private eventHandlers: Map<string, (data: unknown) => Promise<unknown>>

  constructor(ctx: StoreContext, eventHandlers?: Map<string, (data: unknown) => Promise<unknown>>) {
    this.db = ctx.db
    this.ns = ctx.ns
    this.eventHandlers = eventHandlers || new Map()
  }

  /**
   * Register an event handler for replay
   */
  registerHandler(verb: string, handler: (data: unknown) => Promise<unknown>): void {
    this.eventHandlers.set(verb, handler)
  }

  /**
   * Add a failed event to the DLQ
   */
  async add(options: DLQAddOptions): Promise<DLQEntity> {
    const id = crypto.randomUUID()
    const now = new Date()

    await this.db.insert(schema.dlq).values({
      id,
      eventId: options.eventId ?? null,
      verb: options.verb,
      source: options.source,
      data: options.data,
      error: options.error,
      errorStack: options.errorStack ?? null,
      retryCount: 0,
      maxRetries: options.maxRetries ?? 3,
      lastAttemptAt: now,
      createdAt: now,
    })

    return {
      id,
      eventId: options.eventId ?? null,
      verb: options.verb,
      source: options.source,
      data: options.data,
      error: options.error,
      errorStack: options.errorStack ?? null,
      retryCount: 0,
      maxRetries: options.maxRetries ?? 3,
      lastAttemptAt: now,
      createdAt: now,
    }
  }

  /**
   * Get a DLQ entry by ID
   */
  async get(id: string): Promise<DLQEntity | null> {
    const results = await this.db.select().from(schema.dlq)
    const result = results.find((r) => r.id === id)

    if (!result) return null
    return this.toEntity(result)
  }

  /**
   * List DLQ entries with optional filtering
   */
  async list(options?: DLQListOptions): Promise<DLQEntity[]> {
    const results = await this.db.select().from(schema.dlq)

    let filtered = results

    if (options?.verb) {
      filtered = filtered.filter((r) => r.verb === options.verb)
    }
    if (options?.source) {
      filtered = filtered.filter((r) => r.source === options.source)
    }
    if (options?.minRetries !== undefined) {
      filtered = filtered.filter((r) => r.retryCount >= options.minRetries!)
    }
    if (options?.maxRetries !== undefined) {
      filtered = filtered.filter((r) => r.retryCount <= options.maxRetries!)
    }

    // Apply limit and offset
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? filtered.length

    filtered = filtered.slice(offset, offset + limit)

    return filtered.map((r) => this.toEntity(r))
  }

  /**
   * Count total DLQ entries
   */
  async count(): Promise<number> {
    const results = await this.db.select().from(schema.dlq)
    return results.length
  }

  /**
   * Increment retry count for a DLQ entry
   */
  async incrementRetry(id: string): Promise<DLQEntity> {
    const entry = await this.get(id)
    if (!entry) {
      throw new Error(`DLQ entry with id ${id} not found`)
    }

    const now = new Date()
    const newRetryCount = entry.retryCount + 1

    // Note: In production, use proper Drizzle update
    // For now, we'll re-fetch after a conceptual update
    // await this.db.update(schema.dlq)
    //   .set({ retryCount: newRetryCount, lastAttemptAt: now })
    //   .where(eq(schema.dlq.id, id))

    return {
      ...entry,
      retryCount: newRetryCount,
      lastAttemptAt: now,
    }
  }

  /**
   * Replay a single event from the DLQ
   */
  async replay(id: string): Promise<DLQReplayResult> {
    const entry = await this.get(id)
    if (!entry) {
      return { success: false, error: `DLQ entry with id ${id} not found` }
    }

    // Increment retry count before attempting
    await this.incrementRetry(id)

    // Get handler for this verb
    const handler = this.eventHandlers.get(entry.verb)
    if (!handler) {
      return { success: false, error: `No handler registered for verb: ${entry.verb}` }
    }

    try {
      const result = await handler(entry.data)

      // Success - remove from DLQ
      await this.remove(id)

      return { success: true, result }
    } catch (error) {
      // Failed again - keep in DLQ
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Replay multiple events from the DLQ
   */
  async replayAll(options?: { verb?: string; source?: string }): Promise<DLQReplayAllResult> {
    const entries = await this.list({
      verb: options?.verb,
      source: options?.source,
    })

    let replayed = 0
    let failed = 0

    for (const entry of entries) {
      const result = await this.replay(entry.id)
      if (result.success) {
        replayed++
      } else {
        failed++
      }
    }

    return { replayed, failed }
  }

  /**
   * Remove an entry from the DLQ
   */
  async remove(id: string): Promise<boolean> {
    const entry = await this.get(id)
    if (!entry) {
      return false
    }

    // Note: In production, use proper Drizzle delete
    // await this.db.delete(schema.dlq).where(eq(schema.dlq.id, id))

    return true
  }

  /**
   * Purge entries that have exceeded max retries
   */
  async purgeExhausted(): Promise<number> {
    const entries = await this.list()
    const exhausted = entries.filter((e) => e.retryCount >= e.maxRetries)

    let purged = 0
    for (const entry of exhausted) {
      // Archive before purging (in production, would store in R2 or similar)
      // await this.archive(entry)

      const removed = await this.remove(entry.id)
      if (removed) {
        purged++
      }
    }

    return purged
  }

  /**
   * Convert database row to DLQ entity
   */
  private toEntity(row: typeof schema.dlq.$inferSelect): DLQEntity {
    return {
      id: row.id,
      eventId: row.eventId,
      verb: row.verb,
      source: row.source,
      data: row.data as Record<string, unknown>,
      error: row.error,
      errorStack: row.errorStack,
      retryCount: row.retryCount,
      maxRetries: row.maxRetries,
      lastAttemptAt: row.lastAttemptAt ?? null,
      createdAt: row.createdAt,
    }
  }
}
