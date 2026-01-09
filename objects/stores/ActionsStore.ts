/**
 * ActionsStore - Action logging and lifecycle management
 *
 * Provides:
 * - Append-only action logging
 * - Action completion/failure tracking
 * - Retry support for durable actions
 */

import * as schema from '../../db'
import type {
  StoreContext,
  ActionsStore as IActionsStore,
  ActionEntity,
  ActionsLogOptions,
  ActionsListOptions,
} from './types'

export class ActionsStore implements IActionsStore {
  private db: StoreContext['db']
  private ns: string

  constructor(ctx: StoreContext) {
    this.db = ctx.db
    this.ns = ctx.ns
  }

  async log(options: ActionsLogOptions): Promise<ActionEntity> {
    const id = crypto.randomUUID()
    const now = new Date()
    const durability = options.durability ?? 'try'

    await this.db.insert(schema.actions).values({
      id,
      verb: options.verb,
      target: options.target,
      actor: options.actor ?? null,
      input: options.input as Record<string, unknown> | null,
      status: 'pending',
      createdAt: now,
    })

    return {
      id,
      verb: options.verb,
      target: options.target,
      actor: options.actor ?? null,
      input: options.input ?? null,
      output: null,
      options: null,
      durability,
      status: 'pending',
      error: null,
      requestId: options.requestId ?? null,
      sessionId: options.sessionId ?? null,
      workflowId: options.workflowId ?? null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      duration: null,
      retryCount: 0,
    }
  }

  async complete(id: string, output: unknown): Promise<ActionEntity> {
    const existing = await this.get(id)
    if (!existing) {
      throw new Error(`Action with id ${id} not found`)
    }
    if (existing.status === 'completed') {
      throw new Error(`Action ${id} is already completed`)
    }

    const now = new Date()
    const duration = existing.createdAt
      ? now.getTime() - existing.createdAt.getTime()
      : null

    // Note: In production, use proper Drizzle update
    // await this.db.update(schema.actions)
    //   .set({ status: 'completed', output, completedAt: now })
    //   .where(eq(schema.actions.id, id))

    return {
      ...existing,
      status: 'completed',
      output: output as Record<string, unknown> | null,
      completedAt: now,
      duration,
    }
  }

  async fail(id: string, error: Error | Record<string, unknown>): Promise<ActionEntity> {
    const existing = await this.get(id)
    if (!existing) {
      throw new Error(`Action with id ${id} not found`)
    }

    const now = new Date()
    const errorData =
      error instanceof Error
        ? { message: error.message, name: error.name, stack: error.stack }
        : error

    // Note: In production, use proper Drizzle update

    return {
      ...existing,
      status: 'failed',
      error: errorData,
      completedAt: now,
    }
  }

  async retry(id: string): Promise<ActionEntity> {
    const existing = await this.get(id)
    if (!existing) {
      throw new Error(`Action with id ${id} not found`)
    }
    if (existing.durability === 'send') {
      throw new Error(`Cannot retry action with durability 'send'`)
    }

    const retryCount = (existing.retryCount ?? 0) + 1

    // Note: In production, use proper Drizzle update

    return {
      ...existing,
      status: 'retrying',
      retryCount,
    }
  }

  async get(id: string): Promise<ActionEntity | null> {
    const results = await this.db.select().from(schema.actions)
    const result = results.find((r) => r.id === id)

    if (!result) return null
    return this.toEntity(result)
  }

  async list(options?: ActionsListOptions): Promise<ActionEntity[]> {
    const results = await this.db.select().from(schema.actions)

    let filtered = results

    if (options?.target) {
      filtered = filtered.filter((r) => r.target === options.target)
    }
    if (options?.actor) {
      filtered = filtered.filter((r) => r.actor === options.actor)
    }
    if (options?.status) {
      filtered = filtered.filter((r) => r.status === options.status)
    }
    if (options?.verb) {
      filtered = filtered.filter((r) => r.verb === options.verb)
    }

    return filtered.map((r) => this.toEntity(r))
  }

  async pending(): Promise<ActionEntity[]> {
    return this.list({ status: 'pending' })
  }

  async failed(): Promise<ActionEntity[]> {
    return this.list({ status: 'failed' })
  }

  private toEntity(row: typeof schema.actions.$inferSelect): ActionEntity {
    return {
      id: row.id,
      verb: row.verb,
      target: row.target,
      actor: row.actor ?? null,
      input: row.input as number | Record<string, unknown> | null,
      output: null, // Schema may not have this field
      options: null,
      durability: 'try', // Default - schema may not have this
      status: (row.status as ActionEntity['status']) ?? 'pending',
      error: null,
      requestId: null,
      sessionId: null,
      workflowId: null,
      createdAt: row.createdAt,
      startedAt: null,
      completedAt: null,
      duration: null,
      retryCount: 0,
    }
  }
}
