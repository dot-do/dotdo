/**
 * DocumentStore
 *
 * Schema-free JSON document storage with JSONPath queries.
 */

import { sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type Database from 'better-sqlite3'
import {
  buildWhereClause,
  buildOrderByClause,
  getFieldExpr,
} from './queries'
import type {
  Document,
  CreateInput,
  UpdateInput,
  CDCEvent,
  DocumentStoreOptions,
  DocumentRow,
  QueryOptions,
  CountOptions,
  BloomFilter,
  UpsertFilter,
} from './types'

/**
 * Simple bloom filter implementation
 */
class SimpleBloomFilter implements BloomFilter {
  private bits: Set<number>
  private size: number
  private hashCount: number

  constructor(size = 1000, hashCount = 3) {
    this.bits = new Set()
    this.size = size
    this.hashCount = hashCount
  }

  private hash(value: string, seed: number): number {
    let h = seed
    for (let i = 0; i < value.length; i++) {
      h = (h * 31 + value.charCodeAt(i)) >>> 0
    }
    return h % this.size
  }

  add(value: string): void {
    for (let i = 0; i < this.hashCount; i++) {
      this.bits.add(this.hash(value, i))
    }
  }

  mightContain(value: string): boolean {
    for (let i = 0; i < this.hashCount; i++) {
      if (!this.bits.has(this.hash(value, i))) {
        return false
      }
    }
    return true
  }
}

/**
 * Get the underlying SQLite database from a drizzle instance
 */
function getUnderlyingDb(db: BetterSQLite3Database): Database.Database {
  // Access the underlying better-sqlite3 database
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (db as any).session
  if (session && session.client) {
    return session.client
  }
  // Fallback - try direct access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any)._client || (db as any).client
}

/**
 * DocumentStore class
 */
export class DocumentStore<T extends Record<string, unknown>> {
  private db: BetterSQLite3Database
  private sqlite: Database.Database
  private type: string
  private onEvent?: (event: CDCEvent) => void
  private bloomFilters: Map<string, SimpleBloomFilter> = new Map()

  constructor(db: BetterSQLite3Database, options: DocumentStoreOptions) {
    this.db = db
    this.sqlite = getUnderlyingDb(db)
    this.type = options.type
    this.onEvent = options.onEvent
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    // Simple ID generation using crypto.randomUUID or fallback
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 21)
    }
    // Fallback for environments without crypto.randomUUID
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 11)}`
  }

  /**
   * Emit a CDC event
   */
  private emit(event: CDCEvent): void {
    if (this.onEvent) {
      this.onEvent(event)
    }
  }

  /**
   * Convert a row to a document
   */
  private rowToDocument(row: DocumentRow): Document<T> {
    const data = JSON.parse(row.data) as T
    return {
      ...data,
      $id: row.$id,
      $type: row.$type,
      $createdAt: row.$createdAt,
      $updatedAt: row.$updatedAt,
      $version: row.$version,
    } as Document<T>
  }

  /**
   * Update bloom filter for a field
   */
  private updateBloomFilter(field: string, value: string): void {
    if (!this.bloomFilters.has(field)) {
      this.bloomFilters.set(field, new SimpleBloomFilter(10000, 5))
    }
    this.bloomFilters.get(field)!.add(value)
  }

  /**
   * Set a nested value in an object using dot notation
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]
      if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
        current[key] = {}
      }
      current = current[key] as Record<string, unknown>
    }

    current[parts[parts.length - 1]] = value
  }

  /**
   * Get a nested value from an object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  /**
   * Create a document
   */
  async create(input: CreateInput<T>): Promise<Document<T>> {
    // Check for circular references
    try {
      JSON.stringify(input)
    } catch (e) {
      throw new Error('Cannot create document with circular reference')
    }

    const now = Date.now()
    const $id = (input as Record<string, unknown>).$id as string || this.generateId()

    // Extract data (without $id if provided)
    const { $id: _, ...data } = input as Record<string, unknown>

    const row: DocumentRow = {
      $id,
      $type: this.type,
      data: JSON.stringify(data),
      $createdAt: now,
      $updatedAt: now,
      $version: 1,
    }

    try {
      this.db.run(sql`
        INSERT INTO documents ("$id", "$type", data, "$createdAt", "$updatedAt", "$version")
        VALUES (${row.$id}, ${row.$type}, ${row.data}, ${row.$createdAt}, ${row.$updatedAt}, ${row.$version})
      `)
    } catch (e) {
      const error = e as Error
      if (error.message.includes('UNIQUE constraint failed') || error.message.includes('PRIMARY KEY')) {
        throw new Error(`Document with $id "${$id}" already exists`)
      }
      throw e
    }

    // Update bloom filter for common fields
    if (typeof (data as Record<string, unknown>).email === 'string') {
      this.updateBloomFilter('email', (data as Record<string, unknown>).email as string)
    }

    const document = this.rowToDocument(row)

    // Emit CDC event
    this.emit({
      type: 'cdc.insert',
      op: 'c',
      store: 'document',
      table: this.type,
      key: $id,
      after: { ...data },
    })

    return document
  }

  /**
   * Get a document by ID
   */
  async get($id: string): Promise<Document<T> | null> {
    const result = this.db.all<DocumentRow>(sql`
      SELECT "$id", "$type", data, "$createdAt", "$updatedAt", "$version"
      FROM documents
      WHERE "$id" = ${$id} AND "$type" = ${this.type}
    `)

    if (result.length === 0) {
      return null
    }

    return this.rowToDocument(result[0])
  }

  /**
   * Update a document
   */
  async update($id: string, updates: UpdateInput): Promise<Document<T>> {
    // Get existing document
    const existing = await this.get($id)
    if (!existing) {
      throw new Error(`Document with $id "${$id}" not found`)
    }

    const now = Date.now()
    const { $id: _, $type: __, $createdAt, $updatedAt: ___, $version, ...existingData } = existing

    // Apply updates (handle dot notation)
    const newData = { ...existingData } as Record<string, unknown>
    const changedFields: Record<string, { before: unknown; after: unknown }> = {}

    for (const [key, value] of Object.entries(updates)) {
      const beforeValue = this.getNestedValue(newData, key)
      this.setNestedValue(newData, key, value)
      changedFields[key] = { before: beforeValue, after: value }
    }

    const newVersion = $version + 1

    this.db.run(sql`
      UPDATE documents
      SET data = ${JSON.stringify(newData)},
          "$updatedAt" = ${now},
          "$version" = ${newVersion}
      WHERE "$id" = ${$id}
    `)

    // Build before/after for CDC event with only changed fields
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const [key, { before: b, after: a }] of Object.entries(changedFields)) {
      before[key] = b
      after[key] = a
    }

    // Emit CDC event
    this.emit({
      type: 'cdc.update',
      op: 'u',
      store: 'document',
      table: this.type,
      key: $id,
      before,
      after,
    })

    return {
      ...newData,
      $id,
      $type: this.type,
      $createdAt,
      $updatedAt: now,
      $version: newVersion,
    } as Document<T>
  }

  /**
   * Delete a document
   */
  async delete($id: string): Promise<boolean> {
    // Get document for CDC event
    const existing = await this.get($id)
    if (!existing) {
      return false
    }

    const { $id: _, $type: __, $createdAt: ___, $updatedAt: ____, $version: _____, ...data } = existing

    this.db.run(sql`
      DELETE FROM documents
      WHERE "$id" = ${$id} AND "$type" = ${this.type}
    `)

    // Emit CDC event
    this.emit({
      type: 'cdc.delete',
      op: 'd',
      store: 'document',
      table: this.type,
      key: $id,
      before: { ...data },
    })

    return true
  }

  /**
   * Query documents
   */
  async query(options: QueryOptions): Promise<Document<T>[]> {
    const params: unknown[] = []

    // Build WHERE clause
    const whereClause = buildWhereClause(options.where, params)

    // Build ORDER BY clause
    let orderByClause = buildOrderByClause(options.orderBy)

    // Always add $id as tie-breaker for consistent ordering (needed for cursor pagination)
    if (orderByClause) {
      orderByClause = `${orderByClause}, "$id" ASC`
    } else {
      orderByClause = `ORDER BY "$id" ASC`
    }

    // Build LIMIT/OFFSET
    let limitClause = ''
    if (options.limit !== undefined) {
      limitClause = `LIMIT ${options.limit}`
      if (options.offset !== undefined) {
        limitClause += ` OFFSET ${options.offset}`
      }
    }

    // Handle cursor-based pagination
    // Cursor params are added to a separate array and appended after where params
    const cursorParams: unknown[] = []
    let cursorCondition = ''
    if (options.cursor) {
      // Get the cursor document to find its position
      const cursorDoc = await this.get(options.cursor)
      if (cursorDoc) {
        // Add condition to get documents after cursor
        // Uses $createdAt as primary key, $id as tie-breaker
        cursorParams.push(cursorDoc.$createdAt, cursorDoc.$createdAt, options.cursor)
        cursorCondition = `AND ("$createdAt" > ? OR ("$createdAt" = ? AND "$id" > ?))`
      }
    }

    // Build the raw SQL string with parameters
    const sqlStr = `
      SELECT "$id", "$type", data, "$createdAt", "$updatedAt", "$version"
      FROM documents
      WHERE "$type" = ? AND (${whereClause}) ${cursorCondition}
      ${orderByClause}
      ${limitClause}
    `

    // Execute with type as first param using the underlying SQLite driver
    const allParams = [this.type, ...params, ...cursorParams]
    const stmt = this.sqlite.prepare(sqlStr)
    const result = stmt.all(...allParams) as DocumentRow[]

    return result.map((row) => this.rowToDocument(row))
  }

  /**
   * Count documents
   */
  async count(options?: CountOptions): Promise<number> {
    const params: unknown[] = []
    const whereClause = buildWhereClause(options?.where, params)

    const sqlStr = `
      SELECT COUNT(*) as count
      FROM documents
      WHERE "$type" = ? AND (${whereClause})
    `

    const stmt = this.sqlite.prepare(sqlStr)
    const result = stmt.all(this.type, ...params) as { count: number }[]
    return result[0]?.count ?? 0
  }

  /**
   * List all documents
   */
  async list(): Promise<Document<T>[]> {
    return this.query({})
  }

  /**
   * Create multiple documents
   */
  async createMany(inputs: CreateInput<T>[]): Promise<Document<T>[]> {
    const documents: Document<T>[] = []

    // Use a transaction for atomicity
    // Since drizzle doesn't expose transaction easily for raw SQL,
    // we'll collect errors and throw after checking for duplicates

    // First check for duplicate $ids within the batch
    const ids = inputs.map((i) => (i as Record<string, unknown>).$id).filter(Boolean)
    const uniqueIds = new Set(ids)
    if (ids.length !== uniqueIds.size) {
      throw new Error('Duplicate $id in batch')
    }

    // Create each document
    for (const input of inputs) {
      try {
        const doc = await this.create(input)
        documents.push(doc)
      } catch (e) {
        // If any fails, we need to rollback (delete created docs)
        // Since we don't have proper transactions, do manual cleanup
        for (const doc of documents) {
          await this.delete(doc.$id)
        }
        throw e
      }
    }

    return documents
  }

  /**
   * Update multiple documents matching filter
   */
  async updateMany(
    filter: QueryOptions,
    updates: UpdateInput
  ): Promise<number> {
    // Find matching documents
    const docs = await this.query(filter)

    // Update each
    for (const doc of docs) {
      await this.update(doc.$id, updates)
    }

    return docs.length
  }

  /**
   * Delete multiple documents matching filter
   */
  async deleteMany(filter: QueryOptions): Promise<number> {
    // Find matching documents
    const docs = await this.query(filter)

    // Delete each
    for (const doc of docs) {
      await this.delete(doc.$id)
    }

    return docs.length
  }

  /**
   * Upsert a document
   */
  async upsert(
    filter: UpsertFilter,
    data: CreateInput<T> | UpdateInput
  ): Promise<Document<T>> {
    const existing = await this.get(filter.$id)

    if (existing) {
      // Update
      return this.update(filter.$id, data as UpdateInput)
    } else {
      // Create
      return this.create({
        ...data,
        $id: filter.$id,
      } as CreateInput<T>)
    }
  }

  /**
   * Get document as of a specific timestamp (time travel)
   */
  async getAsOf($id: string, timestamp: string): Promise<Document<T> | null> {
    const ts = new Date(timestamp).getTime()

    const result = this.db.all<DocumentRow>(sql`
      SELECT "$id", "$type", data, "$createdAt", "$updatedAt", "$version"
      FROM documents
      WHERE "$id" = ${$id} AND "$type" = ${this.type} AND "$createdAt" <= ${ts}
    `)

    if (result.length === 0) {
      return null
    }

    // For now, return the current document if it existed at that time
    // Full time travel would require event sourcing
    return this.rowToDocument(result[0])
  }

  /**
   * Get bloom filter for a field
   */
  getBloomFilter(field: string): BloomFilter {
    if (!this.bloomFilters.has(field)) {
      // Create new bloom filter and populate from existing data
      const bloom = new SimpleBloomFilter(10000, 5)
      this.bloomFilters.set(field, bloom)

      // Populate from existing documents
      const fieldExpr = getFieldExpr(field)
      const sqlStr = `
        SELECT ${fieldExpr} as value
        FROM documents
        WHERE "$type" = ?
      `
      const stmt = this.sqlite.prepare(sqlStr)
      const results = stmt.all(this.type) as { value: string }[]
      for (const row of results) {
        if (row.value) {
          bloom.add(row.value)
        }
      }
    }

    return this.bloomFilters.get(field)!
  }
}
