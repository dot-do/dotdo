/**
 * ObjectsStore - DO registry and resolution
 *
 * Provides:
 * - Register DOs with namespace mapping
 * - Lookup by namespace
 * - Resolve to DO stubs
 */

import * as schema from '../../db'
import type {
  StoreContext,
  ObjectsStore as IObjectsStore,
  DOObjectEntity,
  ObjectsRegisterOptions,
  ObjectsListOptions,
} from './types'

export class ObjectsStore implements IObjectsStore {
  private db: StoreContext['db']
  private currentNs: string
  private doNamespace?: unknown

  constructor(ctx: StoreContext) {
    this.db = ctx.db
    this.currentNs = ctx.ns
    this.doNamespace = ctx.env.DO
  }

  async register(options: ObjectsRegisterOptions): Promise<DOObjectEntity> {
    // Check for duplicate
    const existing = await this.get(options.ns)
    if (existing) {
      throw new Error(`DO with namespace ${options.ns} already exists`)
    }

    const now = new Date()

    await this.db.insert(schema.objects).values({
      ns: options.ns,
      doId: options.id,
      doClass: options.class,
      relationType: options.relation ?? null,
      createdAt: now,
    })

    return {
      ns: options.ns,
      id: options.id,
      class: options.class,
      relation: options.relation ?? null,
      shardKey: options.shardKey ?? null,
      shardIndex: options.shardIndex ?? null,
      region: options.region ?? null,
      primary: options.primary ?? null,
      cached: null,
      createdAt: now,
    }
  }

  async get(ns: string): Promise<DOObjectEntity | null> {
    const results = await this.db.select().from(schema.objects)
    const result = results.find((r) => r.ns === ns)

    if (!result) return null
    return this.toEntity(result)
  }

  async list(options?: ObjectsListOptions): Promise<DOObjectEntity[]> {
    const results = await this.db.select().from(schema.objects)

    let filtered = results

    if (options?.relation) {
      filtered = filtered.filter((r) => r.relationType === options.relation)
    }
    if (options?.class) {
      filtered = filtered.filter((r) => r.doClass === options.class)
    }

    return filtered.map((r) => this.toEntity(r))
  }

  async shards(key: string): Promise<DOObjectEntity[]> {
    const all = await this.list()
    // Note: shardKey is not in the current schema, this is a placeholder
    return all.filter((o) => o.shardKey === key)
  }

  async primary(ns: string): Promise<DOObjectEntity | null> {
    const obj = await this.get(ns)
    if (!obj) return null
    if (obj.primary) return obj
    return null
  }

  async update(ns: string, data: Partial<DOObjectEntity>): Promise<DOObjectEntity> {
    const existing = await this.get(ns)
    if (!existing) {
      throw new Error(`DO with namespace ${ns} not found`)
    }

    // Note: In production use proper Drizzle update
    // await this.db.update(schema.objects)
    //   .set({ ... })
    //   .where(eq(schema.objects.ns, ns))

    return {
      ...existing,
      ...data,
      ns: existing.ns, // ns cannot be changed
    }
  }

  async delete(ns: string): Promise<void> {
    const existing = await this.get(ns)
    if (!existing) {
      throw new Error(`DO with namespace ${ns} not found`)
    }

    // Note: In production use proper Drizzle delete
    // await this.db.delete(schema.objects).where(eq(schema.objects.ns, ns))
  }

  async resolve(ns: string): Promise<unknown> {
    const obj = await this.get(ns)
    if (!obj) {
      throw new Error(`DO with namespace ${ns} not found`)
    }

    if (!this.doNamespace) {
      throw new Error('DO namespace not configured')
    }

    // Cast to DurableObjectNamespace interface
    const doNs = this.doNamespace as {
      idFromString(id: string): unknown
      get(id: unknown): unknown
    }
    const id = doNs.idFromString(obj.id)
    return doNs.get(id)
  }

  private toEntity(row: typeof schema.objects.$inferSelect): DOObjectEntity {
    return {
      ns: row.ns,
      id: row.doId,
      class: row.doClass,
      relation: row.relationType ?? null,
      shardKey: null, // Not in current schema
      shardIndex: null, // Not in current schema
      region: null, // Not in current schema
      primary: null, // Not in current schema
      cached: null, // Not in current schema
      createdAt: row.createdAt,
    }
  }
}
