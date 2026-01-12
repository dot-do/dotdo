/**
 * DrizzleStorageStrategy
 *
 * D1-SQLite-style storage strategy that stores Payload collections as typed
 * SQLite tables. Each collection becomes its own table with typed columns
 * (not JSON blobs), relationships via foreign keys or join tables, and
 * versions stored in separate _versions tables.
 *
 * Key benefits:
 * - Typed columns with proper SQLite types
 * - Standard relational queries with JOINs
 * - Full Drizzle migration support
 * - Compatible with DO SQLite (not just D1)
 *
 * @module @dotdo/payload/strategies/drizzle
 */

import { sql, eq, and, desc, count as drizzleCount, asc } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core'
import type { PayloadDocument, PayloadField, PayloadCollection } from '../../adapter/types'
import type {
  StorageStrategy,
  Payload,
  CreateArgs,
  FindArgs,
  FindOneArgs,
  UpdateOneArgs,
  UpdateManyArgs,
  DeleteOneArgs,
  DeleteManyArgs,
  CountArgs,
  CreateVersionArgs,
  FindVersionsArgs,
  FindGlobalArgs,
  CreateGlobalArgs,
  UpdateGlobalArgs,
  PaginatedDocs,
  BulkResult,
  Version,
  WhereClause,
} from '../types'
import {
  SchemaBuilder,
  createSchemaBuilder,
  type CollectionSchema,
  type SchemaBuilderConfig,
} from './schema-builder'
import {
  QueryBuilder,
  createQueryBuilder,
  calculateOffset,
  buildPaginationMeta,
  parseSort,
} from './query-builder'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Database interface for DrizzleStrategy.
 * Can be Drizzle with better-sqlite3, D1, or DO SQLite.
 */
export interface DrizzleDb {
  select(fields?: any): any
  insert(table: any): any
  update(table: any): any
  delete(table: any): any
  run?(query: any): Promise<any>
  all?(query: any): Promise<any[]>
  $client?: any
}

/**
 * Configuration for DrizzleStorageStrategy
 */
export interface DrizzleStrategyConfig {
  /** Drizzle database instance */
  db: DrizzleDb
  /** Table name prefix (e.g., 'payload_') */
  tablePrefix?: string
  /** ID type for documents */
  idType?: 'text' | 'integer'
  /** Migration directory path */
  migrationDir?: string
  /** Auto-create tables on init */
  autoCreate?: boolean
}

/**
 * Transaction state
 */
interface TransactionState {
  id: string
  active: boolean
  startedAt: number
}

/**
 * Global document table name
 */
const GLOBALS_TABLE = '_payload_globals'

// ============================================================================
// DRIZZLE STORAGE STRATEGY
// ============================================================================

export class DrizzleStorageStrategy implements StorageStrategy {
  private db: DrizzleDb
  private schemaBuilder: SchemaBuilder
  private schemas: Map<string, CollectionSchema> = new Map()
  private globalsSchema?: CollectionSchema
  private tablePrefix: string
  private idType: 'text' | 'integer'
  private migrationDir: string
  private autoCreate: boolean

  /** Cache: collection slug -> field definitions */
  private fieldMap: Map<string, PayloadField[]> = new Map()
  /** Active transactions */
  private transactions: Map<string, TransactionState> = new Map()
  private transactionCounter = 0

  constructor(config: DrizzleStrategyConfig) {
    this.db = config.db
    this.tablePrefix = config.tablePrefix ?? ''
    this.idType = config.idType ?? 'text'
    this.migrationDir = config.migrationDir ?? './src/migrations'
    this.autoCreate = config.autoCreate ?? true

    this.schemaBuilder = createSchemaBuilder({
      tablePrefix: this.tablePrefix,
      idType: this.idType,
      timestamps: true,
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────────────────────

  async init(payload: Payload, collections: PayloadCollection[]): Promise<void> {
    // Build schemas for all collections
    this.schemas = this.schemaBuilder.buildSchemas(collections)

    // Cache field definitions
    for (const collection of collections) {
      this.fieldMap.set(collection.slug, collection.fields)
    }

    // Auto-create tables if enabled
    if (this.autoCreate) {
      await this.createTables()
    }

    // Initialize globals table
    await this.initGlobalsTable()
  }

  /**
   * Create all tables from schemas.
   */
  private async createTables(): Promise<void> {
    const ddl = this.schemaBuilder.generateDDL()

    for (const statement of ddl) {
      try {
        await this.runQuery(sql.raw(statement))
      } catch (error) {
        // Table may already exist - that's ok
        const message = (error as Error).message || ''
        if (!message.includes('already exists')) {
          console.warn('Failed to create table:', error)
        }
      }
    }
  }

  /**
   * Initialize the globals table.
   */
  private async initGlobalsTable(): Promise<void> {
    const createGlobals = `
      CREATE TABLE IF NOT EXISTS "${GLOBALS_TABLE}" (
        "slug" TEXT PRIMARY KEY,
        "data" TEXT NOT NULL,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      )
    `

    try {
      await this.runQuery(sql.raw(createGlobals))
    } catch (error) {
      // Table may already exist
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async create(args: CreateArgs): Promise<PayloadDocument> {
    const { collection, data } = args
    const schema = this.schemas.get(collection)

    if (!schema) {
      throw new Error(`Collection '${collection}' not found in schema`)
    }

    // Generate ID if not provided
    const id = (data.id as string) || crypto.randomUUID()

    // Create timestamps
    const now = new Date().toISOString()
    const docWithTimestamps: PayloadDocument = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    }

    // Check for duplicate
    const existing = await this.findOne({ collection, id })
    if (existing) {
      throw new Error(`Document with id '${id}' already exists in collection '${collection}'`)
    }

    // Build insert values
    const values = this.buildInsertValues(docWithTimestamps, schema)

    // Insert into main table
    await (this.db as any).insert(schema.table).values(values)

    // Handle many-to-many relationships
    await this.insertRelationships(id, docWithTimestamps, schema)

    // Handle complex arrays
    await this.insertArrays(id, docWithTimestamps, schema)

    return docWithTimestamps
  }

  async find(args: FindArgs): Promise<PaginatedDocs> {
    const { collection, where, sort, limit = 10, page = 1, depth = 1 } = args
    const schema = this.schemas.get(collection)

    if (!schema) {
      throw new Error(`Collection '${collection}' not found in schema`)
    }

    const fields = this.fieldMap.get(collection) || []

    // Build query
    const queryBuilder = createQueryBuilder({
      table: schema.table,
      fields,
      relationTables: schema.relationTables,
      arrayTables: schema.arrayTables,
    })

    const { conditions, orderBy } = queryBuilder.build(where, sort)

    // Get total count first
    const totalDocs = await this.countDocuments(schema.table, conditions)

    // Calculate pagination
    const effectiveLimit = limit === 0 ? totalDocs || 1 : limit
    const offset = calculateOffset(page, effectiveLimit)

    // Execute main query
    let query = (this.db as any).select().from(schema.table)

    if (conditions) {
      query = query.where(conditions)
    }

    if (orderBy) {
      query = query.orderBy(orderBy)
    } else {
      // Default sort by createdAt descending
      const createdAtCol = (schema.table as any).createdAt
      if (createdAtCol) {
        query = query.orderBy(desc(createdAtCol))
      }
    }

    query = query.limit(effectiveLimit).offset(offset)

    const results = await query

    // Transform results to PayloadDocument
    const docs = await Promise.all(
      results.map(async (row: any) => {
        const doc = this.rowToDocument(row, schema)

        // Load many-to-many relationships
        await this.loadRelationships(doc, schema)

        // Load complex arrays
        await this.loadArrays(doc, schema)

        // Populate relationships if depth > 0
        if (depth > 0) {
          return this.populateRelationships(doc, depth, collection, fields)
        }

        return doc
      })
    )

    // Build pagination metadata
    const meta = buildPaginationMeta(page, effectiveLimit, totalDocs)

    return {
      docs,
      ...meta,
    }
  }

  async findOne(args: FindOneArgs): Promise<PayloadDocument | null> {
    const { collection, id, where, depth = 1 } = args
    const schema = this.schemas.get(collection)

    if (!schema) {
      throw new Error(`Collection '${collection}' not found in schema`)
    }

    const fields = this.fieldMap.get(collection) || []

    // If ID is provided, look up directly
    if (id) {
      const idCol = (schema.table as any).id
      const results = await (this.db as any)
        .select()
        .from(schema.table)
        .where(eq(idCol, id))
        .limit(1)

      if (!results || results.length === 0) {
        return null
      }

      const doc = this.rowToDocument(results[0], schema)

      // Load relationships and arrays
      await this.loadRelationships(doc, schema)
      await this.loadArrays(doc, schema)

      if (depth > 0) {
        return this.populateRelationships(doc, depth, collection, fields)
      }

      return doc
    }

    // Use find with limit 1 for where queries
    const result = await this.find({ collection, where, limit: 1, page: 1, depth })
    return result.docs[0] ?? null
  }

  async updateOne(args: UpdateOneArgs): Promise<PayloadDocument> {
    const { collection, id, data } = args
    const schema = this.schemas.get(collection)

    if (!schema) {
      throw new Error(`Collection '${collection}' not found in schema`)
    }

    // Get existing document
    const existing = await this.findOne({ collection, id, depth: 0 })
    if (!existing) {
      throw new Error(`Document with id '${id}' not found in collection '${collection}'`)
    }

    // Merge data
    const now = new Date().toISOString()
    const updatedDoc: PayloadDocument = {
      ...existing,
      ...data,
      id,
      createdAt: existing.createdAt,
      updatedAt: now,
    }

    // Build update values
    const values = this.buildUpdateValues(updatedDoc, schema)

    // Update main table
    const idCol = (schema.table as any).id
    await (this.db as any).update(schema.table).set(values).where(eq(idCol, id))

    // Update relationships
    await this.deleteRelationships(id, schema)
    await this.insertRelationships(id, updatedDoc, schema)

    // Update arrays
    await this.deleteArrays(id, schema)
    await this.insertArrays(id, updatedDoc, schema)

    return updatedDoc
  }

  async updateMany(args: UpdateManyArgs): Promise<BulkResult> {
    const { collection, where, data } = args

    // Find all matching documents
    const result = await this.find({ collection, where, limit: 0, depth: 0 })

    let count = 0
    for (const doc of result.docs) {
      await this.updateOne({ collection, id: doc.id, data })
      count++
    }

    return { count }
  }

  async deleteOne(args: DeleteOneArgs): Promise<PayloadDocument> {
    const { collection, id } = args
    const schema = this.schemas.get(collection)

    if (!schema) {
      throw new Error(`Collection '${collection}' not found in schema`)
    }

    // Get existing document
    const existing = await this.findOne({ collection, id, depth: 0 })
    if (!existing) {
      throw new Error(`Document with id '${id}' not found in collection '${collection}'`)
    }

    // Delete relationships first
    await this.deleteRelationships(id, schema)

    // Delete arrays
    await this.deleteArrays(id, schema)

    // Delete from main table
    const idCol = (schema.table as any).id
    await (this.db as any).delete(schema.table).where(eq(idCol, id))

    return existing
  }

  async deleteMany(args: DeleteManyArgs): Promise<BulkResult> {
    const { collection, where } = args

    // Find all matching documents
    const result = await this.find({ collection, where, limit: 0, depth: 0 })

    let count = 0
    for (const doc of result.docs) {
      await this.deleteOne({ collection, id: doc.id })
      count++
    }

    return { count }
  }

  async count(args: CountArgs): Promise<number> {
    const { collection, where } = args
    const schema = this.schemas.get(collection)

    if (!schema) {
      throw new Error(`Collection '${collection}' not found in schema`)
    }

    const fields = this.fieldMap.get(collection) || []

    // Build where conditions
    const queryBuilder = createQueryBuilder({
      table: schema.table,
      fields,
    })

    const { conditions } = queryBuilder.build(where)

    return this.countDocuments(schema.table, conditions)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VERSION OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async createVersion(args: CreateVersionArgs): Promise<Version> {
    const { collection, id, type = 'draft', label, createdBy } = args
    const schema = this.schemas.get(collection)

    if (!schema || !schema.versionsTable) {
      throw new Error(`Collection '${collection}' does not support versions`)
    }

    // Get current document
    const doc = await this.findOne({ collection, id, depth: 0 })
    if (!doc) {
      throw new Error(`Document '${id}' not found in collection '${collection}'`)
    }

    // Get next version number
    const parentCol = (schema.versionsTable as any).parentId
    const versionNumCol = (schema.versionsTable as any).versionNumber

    const existingVersions = await (this.db as any)
      .select({ maxVersion: sql`MAX(${versionNumCol})` })
      .from(schema.versionsTable)
      .where(eq(parentCol, id))

    const maxVersion = existingVersions[0]?.maxVersion ?? 0
    const versionNumber = maxVersion + 1

    // Create version snapshot
    const now = new Date()
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...snapshotData } = doc
    const versionId = `${id}:v${versionNumber}`

    const versionRecord = {
      id: versionId,
      parentId: id,
      versionNumber,
      type,
      label: label ?? null,
      createdBy: createdBy ?? null,
      createdAt: now.toISOString(),
      snapshot: JSON.stringify(snapshotData),
    }

    await (this.db as any).insert(schema.versionsTable).values(versionRecord)

    return {
      id: versionId,
      parent: id,
      versionNumber,
      type,
      label,
      createdBy,
      createdAt: now,
      version: snapshotData,
    }
  }

  async findVersions(args: FindVersionsArgs): Promise<PaginatedDocs<Version>> {
    const { collection, id, sort = '-versionNumber', page = 1, limit = 10 } = args
    const schema = this.schemas.get(collection)

    if (!schema || !schema.versionsTable) {
      throw new Error(`Collection '${collection}' does not support versions`)
    }

    // Query versions
    const parentCol = (schema.versionsTable as any).parentId
    const versionNumCol = (schema.versionsTable as any).versionNumber

    let query = (this.db as any)
      .select()
      .from(schema.versionsTable)
      .where(eq(parentCol, id))

    // Apply sort
    const { direction } = parseSort(sort)
    query = query.orderBy(direction === 'desc' ? desc(versionNumCol) : asc(versionNumCol))

    // Get total count
    const countResult = await (this.db as any)
      .select({ count: drizzleCount() })
      .from(schema.versionsTable)
      .where(eq(parentCol, id))

    const totalDocs = countResult[0]?.count ?? 0

    // Apply pagination
    const offset = calculateOffset(page, limit)
    query = query.limit(limit).offset(offset)

    const results = await query

    // Transform to Version records
    const versions: Version[] = results.map((row: any) => ({
      id: row.id,
      parent: row.parentId,
      versionNumber: row.versionNumber,
      type: row.type || 'draft',
      label: row.label,
      createdBy: row.createdBy,
      createdAt: new Date(row.createdAt),
      version: JSON.parse(row.snapshot || '{}'),
    }))

    const meta = buildPaginationMeta(page, limit, totalDocs)

    return {
      docs: versions,
      ...meta,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GLOBAL OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async findGlobal(args: FindGlobalArgs): Promise<PayloadDocument> {
    const { slug } = args

    const results = await this.runQuery(
      sql`SELECT * FROM "${sql.raw(GLOBALS_TABLE)}" WHERE slug = ${slug} LIMIT 1`
    )

    if (!results || results.length === 0) {
      return { id: slug }
    }

    const row = results[0] as any
    const data = JSON.parse(row.data || '{}')

    return {
      ...data,
      id: slug,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  async createGlobal(args: CreateGlobalArgs): Promise<PayloadDocument> {
    const { slug, data } = args
    const now = new Date().toISOString()

    await this.runQuery(sql`
      INSERT INTO "${sql.raw(GLOBALS_TABLE)}" (slug, data, "createdAt", "updatedAt")
      VALUES (${slug}, ${JSON.stringify(data)}, ${now}, ${now})
    `)

    return {
      ...data,
      id: slug,
      createdAt: now,
      updatedAt: now,
    }
  }

  async updateGlobal(args: UpdateGlobalArgs): Promise<PayloadDocument> {
    const { slug, data } = args

    // Get existing global
    const existing = await this.findGlobal({ slug, depth: 0 })
    const now = new Date().toISOString()

    // Merge data
    const { id, createdAt, updatedAt, ...existingData } = existing
    const mergedData = { ...existingData, ...data }

    // Check if global exists
    const results = await this.runQuery(
      sql`SELECT 1 FROM "${sql.raw(GLOBALS_TABLE)}" WHERE slug = ${slug} LIMIT 1`
    )

    if (!results || results.length === 0) {
      // Create new
      return this.createGlobal({ slug, data: mergedData })
    }

    // Update existing
    await this.runQuery(sql`
      UPDATE "${sql.raw(GLOBALS_TABLE)}"
      SET data = ${JSON.stringify(mergedData)}, "updatedAt" = ${now}
      WHERE slug = ${slug}
    `)

    return {
      ...mergedData,
      id: slug,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRANSACTION OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async beginTransaction(): Promise<string> {
    const id = `tx_${++this.transactionCounter}_${Date.now()}`

    try {
      await this.runQuery(sql`BEGIN TRANSACTION`)
    } catch {
      // Already in transaction or not supported
    }

    this.transactions.set(id, {
      id,
      active: true,
      startedAt: Date.now(),
    })

    return id
  }

  async commitTransaction(id: string): Promise<void> {
    const tx = this.transactions.get(id)
    if (!tx || !tx.active) {
      throw new Error(`Transaction '${id}' not found or not active`)
    }

    try {
      await this.runQuery(sql`COMMIT`)
    } catch {
      // Not in transaction
    }

    tx.active = false
    this.transactions.delete(id)
  }

  async rollbackTransaction(id: string): Promise<void> {
    const tx = this.transactions.get(id)
    if (!tx || !tx.active) {
      throw new Error(`Transaction '${id}' not found or not active`)
    }

    try {
      await this.runQuery(sql`ROLLBACK`)
    } catch {
      // Not in transaction
    }

    tx.active = false
    this.transactions.delete(id)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPER METHODS - ROW CONVERSION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Convert a database row to a PayloadDocument.
   */
  private rowToDocument(row: any, schema: CollectionSchema): PayloadDocument {
    const doc: PayloadDocument = {
      id: row.id,
    }

    // Copy all columns as document fields
    for (const [key, value] of Object.entries(row)) {
      if (key === 'id') continue

      // Parse JSON fields
      if (value && typeof value === 'string') {
        const field = this.findField(schema.config.fields, key)
        if (field && (field.type === 'json' || field.type === 'richText' || field.type === 'blocks' || field.type === 'group')) {
          try {
            doc[key] = JSON.parse(value)
            continue
          } catch {
            // Not JSON, use as-is
          }
        }
      }

      // Convert checkbox integers to booleans
      if (typeof value === 'number') {
        const field = this.findField(schema.config.fields, key)
        if (field && field.type === 'checkbox') {
          doc[key] = value === 1
          continue
        }
      }

      doc[key] = value
    }

    return doc
  }

  /**
   * Find a field definition by name.
   */
  private findField(fields: PayloadField[], name: string): PayloadField | undefined {
    for (const field of fields) {
      if (field.name === name) {
        return field
      }
      // Check nested fields
      if (field.fields) {
        const nested = this.findField(field.fields, name)
        if (nested) return nested
      }
    }
    return undefined
  }

  /**
   * Build insert values from a document.
   */
  private buildInsertValues(doc: PayloadDocument, schema: CollectionSchema): Record<string, any> {
    const values: Record<string, any> = {
      id: doc.id,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }

    if (doc._status) {
      values._status = doc._status
    }

    // Add field values
    for (const field of schema.config.fields) {
      const value = doc[field.name]

      // Skip many-to-many relationships (stored in separate table)
      if ((field.type === 'relationship' || field.type === 'upload') && field.hasMany) {
        continue
      }

      // Skip complex arrays (stored in separate table)
      if (field.type === 'array' && this.isComplexArray(field)) {
        continue
      }

      // Skip undefined values
      if (value === undefined) {
        continue
      }

      // Transform value for storage
      values[field.name] = this.transformValueForStorage(value, field)
    }

    return values
  }

  /**
   * Build update values from a document.
   */
  private buildUpdateValues(doc: PayloadDocument, schema: CollectionSchema): Record<string, any> {
    const values: Record<string, any> = {
      updatedAt: doc.updatedAt,
    }

    if (doc._status !== undefined) {
      values._status = doc._status
    }

    // Add field values
    for (const field of schema.config.fields) {
      const value = doc[field.name]

      // Skip many-to-many relationships
      if ((field.type === 'relationship' || field.type === 'upload') && field.hasMany) {
        continue
      }

      // Skip complex arrays
      if (field.type === 'array' && this.isComplexArray(field)) {
        continue
      }

      // Skip undefined values
      if (value === undefined) {
        continue
      }

      values[field.name] = this.transformValueForStorage(value, field)
    }

    return values
  }

  /**
   * Transform a value for SQLite storage.
   */
  private transformValueForStorage(value: unknown, field: PayloadField): unknown {
    if (value === null || value === undefined) {
      return null
    }

    switch (field.type) {
      case 'checkbox':
        return value ? 1 : 0

      case 'json':
      case 'richText':
      case 'blocks':
      case 'group':
        return typeof value === 'object' ? JSON.stringify(value) : value

      case 'array':
        // Simple arrays stored as JSON
        return JSON.stringify(value)

      case 'date':
        if (value instanceof Date) {
          return value.toISOString()
        }
        return value

      case 'relationship':
      case 'upload':
        // Single relationship - just store ID
        if (typeof value === 'object' && value !== null && 'id' in value) {
          return (value as any).id
        }
        return value

      default:
        return value
    }
  }

  /**
   * Check if an array field is complex.
   */
  private isComplexArray(field: PayloadField): boolean {
    if (!field.fields || field.fields.length === 0) {
      return false
    }
    if (field.fields.length === 1 && field.fields[0]?.type === 'text') {
      return false
    }
    return true
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPER METHODS - RELATIONSHIPS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Insert many-to-many relationships for a document.
   */
  private async insertRelationships(
    docId: string,
    doc: PayloadDocument,
    schema: CollectionSchema
  ): Promise<void> {
    for (const [fieldName, relTable] of schema.relationTables) {
      const field = this.findField(schema.config.fields, fieldName)
      if (!field) continue

      const value = doc[fieldName]
      if (!Array.isArray(value)) continue

      for (let i = 0; i < value.length; i++) {
        const relatedId = this.extractRelatedId(value[i])
        if (!relatedId) continue

        const relRecord: any = {
          id: crypto.randomUUID(),
          parentId: docId,
          path: fieldName,
          order: i,
          relatedId,
        }

        // Handle polymorphic relationships
        if (Array.isArray(field.relationTo) && typeof value[i] === 'object' && 'relationTo' in value[i]) {
          relRecord.relationTo = value[i].relationTo
        }

        await (this.db as any).insert(relTable).values(relRecord)
      }
    }
  }

  /**
   * Delete many-to-many relationships for a document.
   */
  private async deleteRelationships(docId: string, schema: CollectionSchema): Promise<void> {
    for (const [fieldName, relTable] of schema.relationTables) {
      const parentCol = (relTable as any).parentId
      await (this.db as any).delete(relTable).where(eq(parentCol, docId))
    }
  }

  /**
   * Load many-to-many relationships into a document.
   */
  private async loadRelationships(doc: PayloadDocument, schema: CollectionSchema): Promise<void> {
    for (const [fieldName, relTable] of schema.relationTables) {
      const parentCol = (relTable as any).parentId
      const orderCol = (relTable as any).order

      const rels = await (this.db as any)
        .select()
        .from(relTable)
        .where(eq(parentCol, doc.id))
        .orderBy(asc(orderCol))

      const field = this.findField(schema.config.fields, fieldName)

      if (Array.isArray(field?.relationTo)) {
        // Polymorphic - return objects with relationTo and value
        doc[fieldName] = rels.map((r: any) => ({
          relationTo: r.relationTo,
          value: r.relatedId,
        }))
      } else {
        // Simple - return array of IDs
        doc[fieldName] = rels.map((r: any) => r.relatedId)
      }
    }
  }

  /**
   * Extract a related document ID from a value.
   */
  private extractRelatedId(value: unknown): string | null {
    if (typeof value === 'string') {
      return value
    }
    if (typeof value === 'object' && value !== null) {
      if ('id' in value) {
        return String((value as any).id)
      }
      if ('value' in value) {
        return String((value as any).value)
      }
    }
    return null
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPER METHODS - ARRAYS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Insert complex array values for a document.
   */
  private async insertArrays(
    docId: string,
    doc: PayloadDocument,
    schema: CollectionSchema
  ): Promise<void> {
    for (const [fieldName, arrayTable] of schema.arrayTables) {
      const field = this.findField(schema.config.fields, fieldName)
      if (!field) continue

      const value = doc[fieldName]
      if (!Array.isArray(value)) continue

      for (let i = 0; i < value.length; i++) {
        const item = value[i]
        if (typeof item !== 'object' || item === null) continue

        const arrayRecord: any = {
          id: crypto.randomUUID(),
          parentId: docId,
          path: fieldName,
          order: i,
        }

        // Add subfield values
        if (field.fields) {
          for (const subfield of field.fields) {
            if (subfield.name in item) {
              arrayRecord[subfield.name] = this.transformValueForStorage(
                (item as any)[subfield.name],
                subfield
              )
            }
          }
        }

        await (this.db as any).insert(arrayTable).values(arrayRecord)
      }
    }
  }

  /**
   * Delete complex array values for a document.
   */
  private async deleteArrays(docId: string, schema: CollectionSchema): Promise<void> {
    for (const [fieldName, arrayTable] of schema.arrayTables) {
      const parentCol = (arrayTable as any).parentId
      await (this.db as any).delete(arrayTable).where(eq(parentCol, docId))
    }
  }

  /**
   * Load complex array values into a document.
   */
  private async loadArrays(doc: PayloadDocument, schema: CollectionSchema): Promise<void> {
    for (const [fieldName, arrayTable] of schema.arrayTables) {
      const parentCol = (arrayTable as any).parentId
      const orderCol = (arrayTable as any).order

      const items = await (this.db as any)
        .select()
        .from(arrayTable)
        .where(eq(parentCol, doc.id))
        .orderBy(asc(orderCol))

      const field = this.findField(schema.config.fields, fieldName)

      doc[fieldName] = items.map((item: any) => {
        const obj: Record<string, unknown> = {}

        if (field?.fields) {
          for (const subfield of field.fields) {
            if (subfield.name in item) {
              obj[subfield.name] = item[subfield.name]
            }
          }
        }

        return obj
      })
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPER METHODS - RELATIONSHIPS POPULATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Populate relationships in a document.
   */
  private async populateRelationships(
    doc: PayloadDocument,
    depth: number,
    collection: string,
    fields: PayloadField[]
  ): Promise<PayloadDocument> {
    if (depth <= 0) return doc

    const result = { ...doc }

    for (const field of fields) {
      if (field.type !== 'relationship' && field.type !== 'upload') continue

      const value = doc[field.name]
      if (value == null) continue

      const relationTo = field.relationTo

      // Skip polymorphic relationships for now
      if (Array.isArray(relationTo)) {
        continue
      }

      if (field.hasMany && Array.isArray(value)) {
        // Populate array of relationships
        const populated = await Promise.all(
          value.map((relId: unknown) => {
            const id = typeof relId === 'object' && relId !== null && 'value' in relId
              ? String((relId as any).value)
              : String(relId)

            return this.findOne({
              collection: relationTo || '',
              id,
              depth: depth - 1,
            })
          })
        )
        result[field.name] = populated.filter((d) => d !== null)
      } else {
        // Populate single relationship
        const id = typeof value === 'object' && value !== null && 'id' in value
          ? String((value as any).id)
          : String(value)

        const populated = await this.findOne({
          collection: relationTo || '',
          id,
          depth: depth - 1,
        })
        result[field.name] = populated
      }
    }

    return result
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPER METHODS - QUERY EXECUTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Run a raw SQL query.
   */
  private async runQuery(query: SQL): Promise<any[]> {
    const connection = (this.db as any).$client || this.db

    // Try different execution methods
    if (typeof connection.prepare === 'function') {
      // better-sqlite3
      const { sql: sqlString, params } = this.extractSqlAndParams(query)
      const stmt = connection.prepare(sqlString)
      return stmt.all(...params)
    }

    if (typeof connection.all === 'function') {
      // D1 or other async sqlite
      const { sql: sqlString, params } = this.extractSqlAndParams(query)
      return connection.all(sqlString, params)
    }

    if (typeof (this.db as any).all === 'function') {
      // Drizzle db.all()
      return (this.db as any).all(query)
    }

    return []
  }

  /**
   * Extract SQL string and parameters from a Drizzle SQL object.
   */
  private extractSqlAndParams(query: any): { sql: string; params: any[] } {
    if (typeof query?.sql === 'string') {
      return { sql: query.sql, params: query.params || [] }
    }

    if (query?.queryChunks) {
      const sqlParts: string[] = []
      const params: any[] = []

      for (const chunk of query.queryChunks) {
        if (chunk && typeof chunk === 'object' && 'value' in chunk) {
          const value = (chunk as { value: string[] }).value
          sqlParts.push(Array.isArray(value) ? value.join('') : String(value))
        } else {
          sqlParts.push('?')
          params.push(chunk)
        }
      }

      return { sql: sqlParts.join(''), params }
    }

    if (typeof query === 'string') {
      return { sql: query, params: [] }
    }

    return { sql: '', params: [] }
  }

  /**
   * Count documents matching conditions.
   */
  private async countDocuments(
    table: SQLiteTableWithColumns<any>,
    conditions?: SQL
  ): Promise<number> {
    let query = (this.db as any).select({ count: drizzleCount() }).from(table)

    if (conditions) {
      query = query.where(conditions)
    }

    const result = await query
    return result[0]?.count ?? 0
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC UTILITIES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the schema for a collection.
   */
  getSchema(collection: string): CollectionSchema | undefined {
    return this.schemas.get(collection)
  }

  /**
   * Get all schemas.
   */
  getAllSchemas(): Map<string, CollectionSchema> {
    return this.schemas
  }

  /**
   * Get the schema builder.
   */
  getSchemaBuilder(): SchemaBuilder {
    return this.schemaBuilder
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a DrizzleStorageStrategy instance.
 *
 * @param config - Strategy configuration
 * @returns Configured DrizzleStorageStrategy
 *
 * @example
 * ```typescript
 * import { createDrizzleStrategy } from '@dotdo/payload/strategies/drizzle'
 *
 * const strategy = createDrizzleStrategy({
 *   db,
 *   tablePrefix: 'payload_',
 *   idType: 'text',
 * })
 * ```
 */
export function createDrizzleStrategy(config: DrizzleStrategyConfig): DrizzleStorageStrategy {
  return new DrizzleStorageStrategy(config)
}

// ============================================================================
// EXPORTS
// ============================================================================

export { SchemaBuilder, createSchemaBuilder, getColumnType, requiresSeparateTable } from './schema-builder'
export { QueryBuilder, createQueryBuilder, buildPaginationMeta, parseSort, calculateOffset, calculateTotalPages, buildWhereConditions, buildOrderBy } from './query-builder'
export {
  generateCreateTableDDL,
  generateDropTableDDL,
  generateAddColumnDDL,
  generateCreateIndexDDL,
  generateDropIndexDDL,
  generateVersionsTableDDL,
  generateRelationTableDDL,
  diffSchemas,
  generateDrizzleMigrationTemplate,
  generateMigrationFromDiff,
  createDrizzleMigrationHelpers,
  createDrizzleMigration,
} from './migrations'
export type { CollectionSchema, SchemaBuilderConfig, ColumnDefinition } from './schema-builder'
export type { QueryBuilderConfig, BuiltQuery, ParsedSort, SortDirection } from './query-builder'
export type { DDLStatement, SchemaDiff, DrizzleMigrationHelpers } from './migrations'
