/**
 * Collection - Named collection of entities
 *
 * Groups related Entity records with shared configuration.
 * Examples: 'customers', 'orders', 'products'
 */

import { Entity, EntitySchema, EntityRecord } from './Entity'
import { Env } from './DO'

export interface CollectionConfig {
  name: string
  schema: EntitySchema
  indexes?: string[]
  hooks?: {
    beforeCreate?: string
    afterCreate?: string
    beforeUpdate?: string
    afterUpdate?: string
    beforeDelete?: string
    afterDelete?: string
  }
}

export class Collection extends Entity {
  private collectionConfig: CollectionConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get collection configuration
   */
  async getCollectionConfig(): Promise<CollectionConfig | null> {
    if (!this.collectionConfig) {
      this.collectionConfig = (await this.ctx.storage.get('collection_config')) as CollectionConfig | null
    }
    return this.collectionConfig
  }

  /**
   * Configure the collection
   */
  async configure(config: CollectionConfig): Promise<void> {
    this.collectionConfig = config
    await this.ctx.storage.put('collection_config', config)

    // Also set the entity schema
    await this.setSchema(config.schema)

    await this.emit('collection.configured', { config })
  }

  /**
   * Count records in collection
   */
  async count(): Promise<number> {
    const records = await this.list()
    return records.length
  }

  /**
   * Query records with filters
   */
  async query(filters: Record<string, unknown>): Promise<EntityRecord[]> {
    const all = await this.list()

    return all.filter((record) => {
      for (const [field, value] of Object.entries(filters)) {
        if (record.data[field] !== value) {
          return false
        }
      }
      return true
    })
  }

  /**
   * Aggregate records
   */
  async aggregate(
    groupBy: string,
    aggregations: { field: string; op: 'count' | 'sum' | 'avg' | 'min' | 'max' }[],
  ): Promise<Record<string, Record<string, number>>> {
    const records = await this.list()
    const groups: Record<string, EntityRecord[]> = {}

    // Group records
    for (const record of records) {
      const key = String(record.data[groupBy] || 'null')
      if (!groups[key]) groups[key] = []
      groups[key].push(record)
    }

    // Calculate aggregations
    const result: Record<string, Record<string, number>> = {}

    for (const [key, groupRecords] of Object.entries(groups)) {
      result[key] = {}

      for (const agg of aggregations) {
        const values = groupRecords.map((r) => r.data[agg.field]).filter((v) => typeof v === 'number') as number[]

        switch (agg.op) {
          case 'count':
            result[key][`${agg.field}_count`] = groupRecords.length
            break
          case 'sum':
            result[key][`${agg.field}_sum`] = values.reduce((a, b) => a + b, 0)
            break
          case 'avg':
            result[key][`${agg.field}_avg`] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
            break
          case 'min':
            result[key][`${agg.field}_min`] = values.length > 0 ? Math.min(...values) : 0
            break
          case 'max':
            result[key][`${agg.field}_max`] = values.length > 0 ? Math.max(...values) : 0
            break
        }
      }
    }

    return result
  }

  /**
   * Bulk create records
   */
  async bulkCreate(records: Record<string, unknown>[]): Promise<EntityRecord[]> {
    const created: EntityRecord[] = []

    for (const data of records) {
      const record = await this.create(data)
      created.push(record)
    }

    await this.emit('collection.bulkCreated', { count: created.length })
    return created
  }

  /**
   * Bulk delete records
   */
  async bulkDelete(ids: string[]): Promise<number> {
    let deleted = 0

    for (const id of ids) {
      if (await this.delete(id)) {
        deleted++
      }
    }

    await this.emit('collection.bulkDeleted', { count: deleted })
    return deleted
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/config') {
      if (request.method === 'GET') {
        const config = await this.getCollectionConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as CollectionConfig
        await this.configure(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/count') {
      const count = await this.count()
      return new Response(JSON.stringify({ count }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/query' && request.method === 'POST') {
      const filters = (await request.json()) as Record<string, unknown>
      const records = await this.query(filters)
      return new Response(JSON.stringify(records), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/bulk' && request.method === 'POST') {
      const records = (await request.json()) as Record<string, unknown>[]
      const created = await this.bulkCreate(records)
      return new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default Collection
