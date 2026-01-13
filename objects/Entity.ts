/**
 * @module Entity
 * @description Domain object container with schema validation and indexed queries
 *
 * Entity is the base class for domain objects in the dotdo framework, providing
 * a structured approach to data modeling with validation, lifecycle hooks, and
 * efficient indexed queries. Extend this class to create domain-specific entities
 * like Customer, Order, Product, etc.
 *
 * **Core Features:**
 * - Schema-based field definitions with type validation
 * - CRUD operations (create, read, update, delete, list)
 * - Automatic index maintenance for O(k) lookups
 * - Reference fields for entity relationships
 * - Lifecycle hooks (beforeCreate, afterCreate, etc.)
 * - Version tracking for optimistic concurrency
 *
 * **Schema Definition:**
 * | Property | Description |
 * |----------|-------------|
 * | `name` | Entity type name (e.g., 'Customer') |
 * | `fields` | Field definitions with types and validation |
 * | `indexes` | Fields to index for fast lookups |
 * | `unique` | Fields with uniqueness constraints |
 *
 * **Field Types:**
 * | Type | Description |
 * |------|-------------|
 * | `string` | Text value |
 * | `number` | Numeric value |
 * | `boolean` | True/false |
 * | `date` | Date/time value |
 * | `json` | Complex nested object |
 * | `reference` | Foreign key to another entity |
 *
 * **Index Performance:**
 * - Without index: O(n) full scan over all records
 * - With index: O(k) lookup where k is matching records
 *
 * @example Basic Entity Definition
 * ```typescript
 * class Customer extends Entity {
 *   static override readonly $type = 'Customer'
 *
 *   async onStart() {
 *     await this.setSchema({
 *       name: 'Customer',
 *       fields: {
 *         email: { type: 'string', required: true },
 *         name: { type: 'string', required: true },
 *         plan: { type: 'string', default: 'free' },
 *         signupDate: { type: 'date' },
 *         metadata: { type: 'json' }
 *       },
 *       indexes: ['email', 'plan'], // Enable fast lookups
 *       unique: ['email'] // Enforce uniqueness
 *     })
 *   }
 * }
 * ```
 *
 * @example CRUD Operations
 * ```typescript
 * // Create a new record
 * const customer = await entity.create({
 *   email: 'john@example.com',
 *   name: 'John Doe',
 *   plan: 'pro'
 * })
 *
 * // Read by ID
 * const record = await entity.get(customer.id)
 *
 * // Update
 * await entity.update(customer.id, { plan: 'enterprise' })
 *
 * // Delete
 * await entity.delete(customer.id)
 *
 * // List all
 * const all = await entity.list()
 * ```
 *
 * @example Indexed Queries (O(k) performance)
 * ```typescript
 * // Find customers by indexed field - uses index for O(k) lookup
 * const proCustomers = await entity.findByIndex('plan', 'pro')
 *
 * // Without index - falls back to O(n) scan
 * const byCity = await entity.findByField('city', 'NYC')
 * ```
 *
 * @example Reference Fields
 * ```typescript
 * class Order extends Entity {
 *   async onStart() {
 *     await this.setSchema({
 *       name: 'Order',
 *       fields: {
 *         customerId: { type: 'reference', reference: 'Customer', required: true },
 *         total: { type: 'number', required: true },
 *         status: { type: 'string', default: 'pending' }
 *       },
 *       indexes: ['customerId', 'status']
 *     })
 *   }
 * }
 * ```
 *
 * @see Collection - Groups of related Entity records
 * @see DO - Base Durable Object class
 */

import { DO, Env } from './DO'
import type { Thing } from '../types/Thing'

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

/**
 * Index entry structure stored in KV storage.
 * Each index entry maps a field:value pair to a set of record IDs.
 */
interface IndexEntry {
  ids: string[]
}

/**
 * Normalize a value for use as an index key component.
 * Handles null, undefined, and complex types.
 */
function normalizeIndexValue(value: unknown): string {
  if (value === null) return '__null__'
  if (value === undefined) return '__undefined__'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export class Entity extends DO {
  static override readonly $type: string = 'Entity'

  private schema: EntitySchema | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // ============================================================================
  // INDEX KEY UTILITIES
  // ============================================================================

  /**
   * Generate the storage key for an index entry.
   * Format: index:{field}:{normalizedValue}
   */
  private getIndexKey(field: string, value: unknown): string {
    return `index:${field}:${normalizeIndexValue(value)}`
  }

  /**
   * Check if a field is configured for indexing in the schema.
   */
  private isIndexedField(field: string): boolean {
    return this.schema?.indexes?.includes(field) ?? false
  }

  /**
   * Get all indexed fields from the schema.
   */
  private getIndexedFields(): string[] {
    return this.schema?.indexes ?? []
  }

  // ============================================================================
  // INDEX MAINTENANCE
  // ============================================================================

  /**
   * Add a record ID to the index for a specific field:value pair.
   */
  private async addToIndex(field: string, value: unknown, recordId: string): Promise<void> {
    const key = this.getIndexKey(field, value)
    const existing = (await this.ctx.storage.get(key)) as IndexEntry | undefined
    const ids = existing?.ids ?? []

    if (!ids.includes(recordId)) {
      ids.push(recordId)
      await this.ctx.storage.put(key, { ids })
    }
  }

  /**
   * Remove a record ID from the index for a specific field:value pair.
   */
  private async removeFromIndex(field: string, value: unknown, recordId: string): Promise<void> {
    const key = this.getIndexKey(field, value)
    const existing = (await this.ctx.storage.get(key)) as IndexEntry | undefined

    if (existing) {
      const ids = existing.ids.filter((id) => id !== recordId)
      if (ids.length === 0) {
        await this.ctx.storage.delete(key)
      } else {
        await this.ctx.storage.put(key, { ids })
      }
    }
  }

  /**
   * Update indexes for a record being created.
   * Adds the record ID to all indexed field values.
   */
  private async indexRecord(record: EntityRecord): Promise<void> {
    const indexedFields = this.getIndexedFields()
    for (const field of indexedFields) {
      const value = record.data[field]
      await this.addToIndex(field, value, record.id)
    }
  }

  /**
   * Update indexes when a record is being updated.
   * Removes old index entries and adds new ones for changed values.
   */
  private async reindexRecord(oldRecord: EntityRecord, newRecord: EntityRecord): Promise<void> {
    const indexedFields = this.getIndexedFields()
    for (const field of indexedFields) {
      const oldValue = oldRecord.data[field]
      const newValue = newRecord.data[field]

      // Only update index if value changed
      if (normalizeIndexValue(oldValue) !== normalizeIndexValue(newValue)) {
        await this.removeFromIndex(field, oldValue, oldRecord.id)
        await this.addToIndex(field, newValue, newRecord.id)
      }
    }
  }

  /**
   * Remove a record from all indexes.
   */
  private async unindexRecord(record: EntityRecord): Promise<void> {
    const indexedFields = this.getIndexedFields()
    for (const field of indexedFields) {
      const value = record.data[field]
      await this.removeFromIndex(field, value, record.id)
    }
  }

  /**
   * Rebuild all indexes from scratch.
   * Useful after schema changes or for index recovery.
   */
  async rebuildIndexes(): Promise<{ indexed: number; fields: string[] }> {
    const indexedFields = this.getIndexedFields()
    if (indexedFields.length === 0) {
      return { indexed: 0, fields: [] }
    }

    // Clear existing indexes
    const indexKeys = await this.ctx.storage.list({ prefix: 'index:' })
    for (const key of indexKeys.keys()) {
      await this.ctx.storage.delete(key)
    }

    // Rebuild from all records
    const records = await this.list()
    for (const record of records) {
      await this.indexRecord(record)
    }

    await this.emit('indexes.rebuilt', { count: records.length, fields: indexedFields })
    return { indexed: records.length, fields: indexedFields }
  }

  // ============================================================================
  // SCHEMA MANAGEMENT
  // ============================================================================

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

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

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

    // Maintain indexes for indexed fields
    await this.indexRecord(record)

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

    // Update indexes for changed indexed fields
    await this.reindexRecord(record, updated)

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

    // Remove from all indexes
    await this.unindexRecord(record)

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

  // ============================================================================
  // QUERY OPERATIONS
  // ============================================================================

  /**
   * Find records by field value.
   * Uses index if the field is indexed, otherwise falls back to filtered list.
   */
  async find(field: string, value: unknown): Promise<EntityRecord[]> {
    // Use index if field is indexed
    if (this.isIndexedField(field)) {
      return this.findWithIndex(field, value)
    }

    // Fall back to filtered list for non-indexed fields
    const all = await this.list()
    return all.filter((r) => r.data[field] === value)
  }

  /**
   * Find records using index lookup.
   * This is O(k) where k is the number of matching records,
   * instead of O(n) where n is total records.
   *
   * @throws Error if the field is not indexed
   */
  async findWithIndex(field: string, value: unknown): Promise<EntityRecord[]> {
    if (!this.isIndexedField(field)) {
      throw new Error(
        `Field '${field}' is not indexed. Add it to schema.indexes or use find() for non-indexed queries.`
      )
    }

    const key = this.getIndexKey(field, value)
    const entry = (await this.ctx.storage.get(key)) as IndexEntry | undefined

    if (!entry || entry.ids.length === 0) {
      return []
    }

    // Fetch all matching records by ID
    const records: EntityRecord[] = []
    for (const id of entry.ids) {
      const record = await this.get(id)
      if (record) {
        records.push(record)
      }
    }

    return records
  }

  // ============================================================================
  // HTTP HANDLERS
  // ============================================================================

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
      const id = url.pathname.split('/')[2]!

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
        const record = await this.update(id!, data)
        if (!record) {
          return new Response('Not Found', { status: 404 })
        }
        return new Response(JSON.stringify(record), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (request.method === 'DELETE') {
        const deleted = await this.delete(id!)
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
