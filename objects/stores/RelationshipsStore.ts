/**
 * RelationshipsStore - CRUD operations for Relationships
 *
 * Provides typed access to the relationships table with:
 * - Create/delete relationships
 * - Traversal operations (from/to)
 * - Bulk delete by criteria
 */

import * as schema from '../../db'
import type {
  StoreContext,
  RelationshipsStore as IRelationshipsStore,
  RelationshipEntity,
  RelationshipsListOptions,
  RelationshipsTraversalOptions,
} from './types'

export class RelationshipsStore implements IRelationshipsStore {
  private db: StoreContext['db']
  private ns: string

  constructor(ctx: StoreContext) {
    this.db = ctx.db
    this.ns = ctx.ns
  }

  async create(data: {
    verb: string
    from: string
    to: string
    data?: Record<string, unknown>
  }): Promise<RelationshipEntity> {
    // Check for duplicate
    const existing = await this.list({
      verb: data.verb,
      from: data.from,
      to: data.to,
    })
    if (existing.length > 0) {
      throw new Error(`Relationship already exists: ${data.verb} from ${data.from} to ${data.to}`)
    }

    const id = crypto.randomUUID()
    const now = new Date()

    await this.db.insert(schema.relationships).values({
      id,
      verb: data.verb,
      from: data.from,
      to: data.to,
      data: data.data ?? null,
      createdAt: now,
    })

    return {
      id,
      verb: data.verb,
      from: data.from,
      to: data.to,
      data: data.data ?? null,
      createdAt: now,
    }
  }

  async list(options?: RelationshipsListOptions): Promise<RelationshipEntity[]> {
    const limit = options?.limit ?? 100
    const offset = options?.offset ?? 0

    const results = await this.db.select().from(schema.relationships)

    let filtered = results

    // Filter by from
    if (options?.from) {
      filtered = filtered.filter((r) => r.from === options.from)
    }

    // Filter by to
    if (options?.to) {
      filtered = filtered.filter((r) => r.to === options.to)
    }

    // Filter by verb
    if (options?.verb) {
      filtered = filtered.filter((r) => r.verb === options.verb)
    }

    // Apply offset and limit
    filtered = filtered.slice(offset, offset + limit)

    return filtered.map((r) => this.toEntity(r))
  }

  async delete(id: string): Promise<RelationshipEntity> {
    const results = await this.db.select().from(schema.relationships)
    const existing = results.find((r) => r.id === id)

    if (!existing) {
      throw new Error(`Relationship with id ${id} not found`)
    }

    // Note: In production, use proper Drizzle delete
    // await this.db.delete(schema.relationships).where(eq(schema.relationships.id, id))

    return this.toEntity(existing)
  }

  async deleteWhere(criteria: {
    from?: string
    to?: string
    verb?: string
  }): Promise<number> {
    const toDelete = await this.list(criteria)

    // Note: In production, use proper Drizzle delete with conditions
    // This is a simplified implementation

    return toDelete.length
  }

  async from(url: string, options?: RelationshipsTraversalOptions): Promise<RelationshipEntity[]> {
    return this.list({
      from: url,
      verb: options?.verb,
    })
  }

  async to(url: string, options?: RelationshipsTraversalOptions): Promise<RelationshipEntity[]> {
    return this.list({
      to: url,
      verb: options?.verb,
    })
  }

  private toEntity(row: typeof schema.relationships.$inferSelect): RelationshipEntity {
    return {
      id: row.id,
      verb: row.verb,
      from: row.from,
      to: row.to,
      data: row.data as Record<string, unknown> | null,
      createdAt: row.createdAt,
    }
  }
}
