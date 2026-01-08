/**
 * Entity - Domain object container
 *
 * Base class for domain entities like Customer, Order, Product.
 * Provides CRUD operations, validation, and lifecycle hooks.
 */

import { DO, Env, Thing } from './DO'

export interface EntitySchema {
  name: string
  fields: Record<string, FieldDefinition>
  indexes?: string[]
  unique?: string[]
}

export interface FieldDefinition {
  type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'reference'
  required?: boolean
  default?: unknown
  reference?: string
  validate?: (value: unknown) => boolean
}

export interface EntityRecord {
  id: string
  type: string
  data: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  version: number
}

export class Entity extends DO {
  private schema: EntitySchema | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get entity schema
   */
  async getSchema(): Promise<EntitySchema | null> {
    if (!this.schema) {
      this.schema = (await this.ctx.storage.get('schema')) as EntitySchema | null
    }
    return this.schema
  }

  /**
   * Set entity schema
   */
  async setSchema(schema: EntitySchema): Promise<void> {
    this.schema = schema
    await this.ctx.storage.put('schema', schema)
    await this.emit('schema.updated', { schema })
  }

  /**
   * Validate data against schema
   */
  protected validate(data: Record<string, unknown>): { valid: boolean; errors: string[] } {
    if (!this.schema) {
      return { valid: true, errors: [] }
    }

    const errors: string[] = []

    for (const [field, def] of Object.entries(this.schema.fields)) {
      const value = data[field]

      if (def.required && value === undefined) {
        errors.push(`${field} is required`)
        continue
      }

      if (value !== undefined && def.type) {
        switch (def.type) {
          case 'string':
            if (typeof value !== 'string') errors.push(`${field} must be a string`)
            break
          case 'number':
            if (typeof value !== 'number') errors.push(`${field} must be a number`)
            break
          case 'boolean':
            if (typeof value !== 'boolean') errors.push(`${field} must be a boolean`)
            break
          case 'date':
            if (!(value instanceof Date) && typeof value !== 'string') errors.push(`${field} must be a date`)
            break
        }
      }

      if (value !== undefined && def.validate && !def.validate(value)) {
        errors.push(`${field} failed custom validation`)
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Apply defaults to data
   */
  protected applyDefaults(data: Record<string, unknown>): Record<string, unknown> {
    if (!this.schema) return data

    const result = { ...data }

    for (const [field, def] of Object.entries(this.schema.fields)) {
      if (result[field] === undefined && def.default !== undefined) {
        result[field] = typeof def.default === 'function' ? def.default() : def.default
      }
    }

    return result
  }

  /**
   * Create a new entity record
   */
  async create(data: Record<string, unknown>): Promise<EntityRecord> {
    const withDefaults = this.applyDefaults(data)
    const validation = this.validate(withDefaults)

    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`)
    }

    const record: EntityRecord = {
      id: crypto.randomUUID(),
      type: this.schema?.name || 'entity',
      data: withDefaults,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    }

    await this.ctx.storage.put(`record:${record.id}`, record)
    await this.emit('entity.created', { record })

    return record
  }

  /**
   * Get entity record by ID
   */
  async get(id: string): Promise<EntityRecord | null> {
    return (await this.ctx.storage.get(`record:${id}`)) as EntityRecord | null
  }

  /**
   * Update entity record
   */
  async update(id: string, data: Partial<Record<string, unknown>>): Promise<EntityRecord | null> {
    const record = await this.get(id)
    if (!record) return null

    const merged = { ...record.data, ...data }
    const validation = this.validate(merged)

    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`)
    }

    const updated: EntityRecord = {
      ...record,
      data: merged,
      updatedAt: new Date(),
      version: record.version + 1,
    }

    await this.ctx.storage.put(`record:${id}`, updated)
    await this.emit('entity.updated', { record: updated, changes: data })

    return updated
  }

  /**
   * Delete entity record
   */
  async delete(id: string): Promise<boolean> {
    const record = await this.get(id)
    if (!record) return false

    await this.ctx.storage.delete(`record:${id}`)
    await this.emit('entity.deleted', { id, record })

    return true
  }

  /**
   * List all records
   */
  async list(options?: { limit?: number; offset?: number }): Promise<EntityRecord[]> {
    const map = await this.ctx.storage.list({ prefix: 'record:' })
    let records = Array.from(map.values()) as EntityRecord[]

    records = records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    if (options?.offset) {
      records = records.slice(options.offset)
    }
    if (options?.limit) {
      records = records.slice(0, options.limit)
    }

    return records
  }

  /**
   * Find records by field value
   */
  async find(field: string, value: unknown): Promise<EntityRecord[]> {
    const all = await this.list()
    return all.filter((r) => r.data[field] === value)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/schema') {
      if (request.method === 'GET') {
        const schema = await this.getSchema()
        return new Response(JSON.stringify(schema), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const schema = (await request.json()) as EntitySchema
        await this.setSchema(schema)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/records') {
      if (request.method === 'GET') {
        const records = await this.list()
        return new Response(JSON.stringify(records), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'POST') {
        const data = (await request.json()) as Record<string, unknown>
        const record = await this.create(data)
        return new Response(JSON.stringify(record), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname.startsWith('/record/')) {
      const id = url.pathname.split('/')[2]

      if (request.method === 'GET') {
        const record = await this.get(id)
        if (!record) {
          return new Response('Not Found', { status: 404 })
        }
        return new Response(JSON.stringify(record), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (request.method === 'PUT') {
        const data = (await request.json()) as Record<string, unknown>
        const record = await this.update(id, data)
        if (!record) {
          return new Response('Not Found', { status: 404 })
        }
        return new Response(JSON.stringify(record), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (request.method === 'DELETE') {
        const deleted = await this.delete(id)
        if (!deleted) {
          return new Response('Not Found', { status: 404 })
        }
        return new Response(JSON.stringify({ deleted: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return super.fetch(request)
  }
}

export default Entity
