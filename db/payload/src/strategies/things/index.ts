/**
 * ThingsStorageStrategy
 *
 * MongoDB-style storage strategy that stores Payload collections as Things
 * with JSON data. Collections map to Noun types, documents stored with JSON
 * data field, and relationships stored as edges.
 *
 * Key benefits:
 * - No DDL migrations needed - schema changes just work
 * - Versions are native (append-only thing rows)
 * - Relationships stored as edges in relationships table
 * - Full support for JSON path indexing
 *
 * @module @dotdo/payload/strategies/things
 */

import { sql, eq, and, desc, isNull, inArray } from 'drizzle-orm'
import type { PayloadDocument, PayloadField, PayloadCollection } from '../../adapter/types'
import { slugToNounName, fieldNameToVerb } from '../../adapter/types'
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
  WhereOperator,
} from '../types'
import {
  payloadToThing,
  thingToPayload,
  extractRelationships,
  getThingId,
  parseThingId,
  getNounName,
  getVersionThingId,
  getVersionType,
  getGlobalThingId,
  getGlobalsType,
  type ThingRecord,
  type ExtractedRelationship,
} from './transforms'
import { createJsonIndex, syncNounIndexes } from '../../../../../db/json-indexes'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Database interface for ThingsStrategy.
 * Can be Drizzle, better-sqlite3, or D1.
 */
export interface ThingsDb {
  select(): any
  insert(table: any): any
  update?(table: any): any
  delete?(table: any): any
  run?(query: any): Promise<any>
  all?(query: any): Promise<any[]>
  $client?: any
}

/**
 * Schema tables required by ThingsStrategy
 */
export interface ThingsSchema {
  things: any
  nouns: any
  relationships: any
}

/**
 * Configuration for ThingsStorageStrategy
 */
export interface ThingsStrategyConfig {
  /** Drizzle database instance */
  db: ThingsDb
  /** Database schema with things, nouns, relationships tables */
  schema: ThingsSchema
  /** Namespace URL (e.g., 'https://example.do') */
  namespace: string
  /** Enable JSON path index creation for indexed fields */
  autoIndex?: boolean
}

/**
 * Transaction state
 */
interface TransactionState {
  id: string
  active: boolean
  startedAt: number
}

// ============================================================================
// THINGS STORAGE STRATEGY
// ============================================================================

export class ThingsStorageStrategy implements StorageStrategy {
  private db: ThingsDb
  private schema: ThingsSchema
  private namespace: string
  private autoIndex: boolean

  /** Cache: collection slug -> noun type ID */
  private nounMap: Map<string, number> = new Map()
  /** Cache: noun type ID -> collection slug */
  private reverseNounMap: Map<number, string> = new Map()
  /** Cache: collection slug -> field definitions */
  private fieldMap: Map<string, PayloadField[]> = new Map()
  /** Active transactions */
  private transactions: Map<string, TransactionState> = new Map()
  private transactionCounter = 0

  constructor(config: ThingsStrategyConfig) {
    this.db = config.db
    this.schema = config.schema
    this.namespace = config.namespace
    this.autoIndex = config.autoIndex ?? true
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────────────────────

  async init(payload: Payload, collections: PayloadCollection[]): Promise<void> {
    // Register a Noun for each collection
    for (const collection of collections) {
      await this.ensureNounExists(collection.slug, collection.fields)
      this.fieldMap.set(collection.slug, collection.fields)
    }
  }

  /**
   * Ensure a Noun exists for the collection, creating if needed.
   * Also creates JSON path indexes for indexed fields.
   */
  private async ensureNounExists(collection: string, fields: PayloadField[]): Promise<number> {
    // Check cache first
    if (this.nounMap.has(collection)) {
      return this.nounMap.get(collection)!
    }

    const nounName = getNounName(collection)

    // Check if noun exists in database
    const existing = await (this.db as any)
      .select()
      .from(this.schema.nouns)
      .where(eq(this.schema.nouns.noun, nounName))
      .limit(1)

    let typeId: number

    if (existing && existing.length > 0) {
      // Get rowid
      const result = await this.runQuery(
        sql`SELECT rowid FROM nouns WHERE noun = ${nounName} LIMIT 1`
      )
      const row = (result as any[])[0]
      typeId = row?.rowid ?? 0
    } else {
      // Create new noun
      await (this.db as any).insert(this.schema.nouns).values({
        noun: nounName,
        plural: collection,
        description: `${nounName} from ${collection} collection`,
      })

      // Get its rowid
      const result = await this.runQuery(
        sql`SELECT rowid FROM nouns WHERE noun = ${nounName} LIMIT 1`
      )
      const row = (result as any[])[0]
      typeId = row?.rowid ?? 0
    }

    // Update caches
    this.nounMap.set(collection, typeId)
    this.reverseNounMap.set(typeId, collection)

    // Create JSON path indexes for indexed fields
    if (this.autoIndex && typeId > 0) {
      await this.createFieldIndexes(typeId, fields)
    }

    return typeId
  }

  /**
   * Create JSON path indexes for fields marked with index: true
   */
  private async createFieldIndexes(typeId: number, fields: PayloadField[]): Promise<void> {
    const indexedFields: Record<string, { type: string; index: boolean }> = {}

    for (const field of fields) {
      if (field.index) {
        indexedFields[field.name] = {
          type: field.type,
          index: true,
        }
      }
    }

    if (Object.keys(indexedFields).length > 0) {
      try {
        await syncNounIndexes(this.db, {
          nounName: '', // Not used in sync
          typeId,
          schema: indexedFields,
        })
      } catch (error) {
        // Index creation is best-effort
        console.warn('Failed to create JSON indexes:', error)
      }
    }
  }

  /**
   * Get the type ID for a collection, ensuring noun exists.
   */
  private async getTypeId(collection: string): Promise<number> {
    if (this.nounMap.has(collection)) {
      return this.nounMap.get(collection)!
    }

    const fields = this.fieldMap.get(collection) || []
    return this.ensureNounExists(collection, fields)
  }

  /**
   * Get collection slug from type ID.
   */
  private getCollectionFromTypeId(typeId: number): string | undefined {
    return this.reverseNounMap.get(typeId)
  }

  /**
   * Run a raw SQL query.
   */
  private async runQuery(query: any): Promise<any[]> {
    // Extract SQL string and params from Drizzle SQL object
    const { sql: sqlString, params } = this.extractSqlAndParams(query)

    const connection = (this.db as any).$client || this.db
    if (typeof connection.prepare === 'function') {
      // better-sqlite3
      const stmt = connection.prepare(sqlString)
      return stmt.all(...params)
    } else if (typeof connection.all === 'function') {
      // D1 or other async sqlite
      return connection.all(sqlString, params)
    } else if (typeof (this.db as any).all === 'function') {
      // Drizzle or mock - pass both raw query and extracted values
      return (this.db as any).all({ sql: sqlString, params, raw: query })
    }
    return []
  }

  /**
   * Extract SQL string and parameters from a Drizzle SQL object.
   */
  private extractSqlAndParams(query: any): { sql: string; params: any[] } {
    // If already has sql/params (e.g., already extracted)
    if (typeof query?.sql === 'string') {
      return { sql: query.sql, params: query.params || [] }
    }

    // Handle Drizzle SQL template tag objects
    if (query?.queryChunks) {
      const sqlParts: string[] = []
      const params: any[] = []

      for (const chunk of query.queryChunks) {
        if (chunk && typeof chunk === 'object' && 'value' in chunk) {
          // StringChunk - value is an array of strings
          const value = (chunk as { value: string[] }).value
          sqlParts.push(Array.isArray(value) ? value.join('') : String(value))
        } else {
          // Parameter value
          sqlParts.push('?')
          params.push(chunk)
        }
      }

      return { sql: sqlParts.join(''), params }
    }

    // Fallback for raw string
    if (typeof query === 'string') {
      return { sql: query, params: [] }
    }

    return { sql: '', params: [] }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async create(args: CreateArgs): Promise<PayloadDocument> {
    const { collection, data } = args

    // Generate ID if not provided
    const id = (data.id as string) || crypto.randomUUID()
    const typeId = await this.getTypeId(collection)
    const fields = this.fieldMap.get(collection) || []

    // Check for duplicate
    const existing = await this.findOne({ collection, id })
    if (existing) {
      throw new Error(`Document with id '${id}' already exists in collection '${collection}'`)
    }

    // Create timestamps
    const now = new Date()
    const docWithTimestamps: PayloadDocument = {
      ...data,
      id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }

    // Transform to Thing
    const thing = payloadToThing(docWithTimestamps, typeId, {
      collection,
      namespace: this.namespace,
      fields,
    })

    // Insert Thing
    await (this.db as any).insert(this.schema.things).values(thing)

    // Create relationships
    const relationships = extractRelationships(docWithTimestamps, {
      collection,
      namespace: this.namespace,
      fields,
    })

    for (const rel of relationships) {
      await this.createRelationship(rel)
    }

    return docWithTimestamps
  }

  async find(args: FindArgs): Promise<PaginatedDocs> {
    const { collection, where, sort, limit = 10, page = 1, depth = 1 } = args

    const typeId = await this.getTypeId(collection)
    const fields = this.fieldMap.get(collection) || []

    // Build base query for latest versions
    let query = sql`
      SELECT t.rowid as version, t.*
      FROM things t
      INNER JOIN (
        SELECT id, MAX(rowid) as max_rowid
        FROM things
        WHERE type = ${typeId}
          AND (branch IS NULL OR branch = 'main')
          AND (deleted = 0 OR deleted IS NULL)
        GROUP BY id
      ) latest ON t.id = latest.id AND t.rowid = latest.max_rowid
    `

    // Apply where filters
    const whereConditions = this.buildWhereConditions(where)
    if (whereConditions.length > 0) {
      query = sql`${query} WHERE ${sql.join(whereConditions, sql` AND `)}`
    }

    // Apply sorting
    if (sort) {
      const isDesc = sort.startsWith('-')
      const field = isDesc ? sort.slice(1) : sort
      const direction = isDesc ? 'DESC' : 'ASC'

      // Handle special fields
      if (field === 'createdAt' || field === 'updatedAt' || field === 'id') {
        query = sql`${query} ORDER BY t.${sql.raw(field)} ${sql.raw(direction)}`
      } else {
        // JSON path for data fields
        query = sql`${query} ORDER BY json_extract(t.data, ${`$.${field}`}) ${sql.raw(direction)}`
      }
    } else {
      // Default sort by rowid descending (newest first)
      query = sql`${query} ORDER BY t.rowid DESC`
    }

    // Get total count first
    const countQuery = sql`
      SELECT COUNT(DISTINCT t.id) as count
      FROM things t
      WHERE t.type = ${typeId}
        AND (t.branch IS NULL OR t.branch = 'main')
        AND (t.deleted = 0 OR t.deleted IS NULL)
    `
    const countResult = await this.runQuery(countQuery)
    const totalDocs = (countResult[0] as any)?.count ?? 0

    // Apply pagination
    const effectiveLimit = limit === 0 ? totalDocs || 1 : limit
    const offset = (page - 1) * effectiveLimit
    query = sql`${query} LIMIT ${effectiveLimit} OFFSET ${offset}`

    // Execute query
    const results = await this.runQuery(query)

    // Transform results to Payload documents
    const docs = await Promise.all(
      (results as ThingRecord[]).map(async (row) => {
        const doc = thingToPayload(row, {
          collection,
          namespace: this.namespace,
          fields,
        })

        // Populate relationships if depth > 0
        if (depth > 0) {
          return this.populateRelationships(doc, depth, collection, fields)
        }

        return doc
      })
    )

    // Calculate pagination metadata
    const totalPages = Math.max(1, Math.ceil(totalDocs / effectiveLimit))

    return {
      docs,
      totalDocs,
      limit: effectiveLimit,
      page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    }
  }

  async findOne(args: FindOneArgs): Promise<PayloadDocument | null> {
    const { collection, id, where, depth = 1 } = args

    const typeId = await this.getTypeId(collection)
    const fields = this.fieldMap.get(collection) || []

    // If ID is provided, look up directly
    if (id) {
      const query = sql`
        SELECT rowid as version, *
        FROM things
        WHERE id = ${id}
          AND type = ${typeId}
          AND (branch IS NULL OR branch = 'main')
          AND (deleted = 0 OR deleted IS NULL)
        ORDER BY rowid DESC
        LIMIT 1
      `

      const results = await this.runQuery(query)
      if (results.length === 0) {
        return null
      }

      const doc = thingToPayload(results[0] as ThingRecord, {
        collection,
        namespace: this.namespace,
        fields,
      })

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

    const typeId = await this.getTypeId(collection)
    const fields = this.fieldMap.get(collection) || []

    // Get existing document
    const existing = await this.findOne({ collection, id, depth: 0 })
    if (!existing) {
      throw new Error(`Document with id '${id}' not found in collection '${collection}'`)
    }

    // Merge data
    const now = new Date()
    const updatedDoc: PayloadDocument = {
      ...existing,
      ...data,
      id,
      createdAt: existing.createdAt,
      updatedAt: now.toISOString(),
    }

    // Transform to Thing
    const thing = payloadToThing(updatedDoc, typeId, {
      collection,
      namespace: this.namespace,
      fields,
    })

    // Insert new version (append-only)
    await (this.db as any).insert(this.schema.things).values(thing)

    // Update relationships
    await this.updateRelationships(id, updatedDoc, collection, fields)

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

    const typeId = await this.getTypeId(collection)
    const fields = this.fieldMap.get(collection) || []

    // Get existing document
    const existing = await this.findOne({ collection, id, depth: 0 })
    if (!existing) {
      throw new Error(`Document with id '${id}' not found in collection '${collection}'`)
    }

    // Get current thing to preserve data
    const currentQuery = sql`
      SELECT * FROM things
      WHERE id = ${id} AND type = ${typeId}
      ORDER BY rowid DESC LIMIT 1
    `
    const currentResults = await this.runQuery(currentQuery)
    const currentThing = currentResults[0] as any

    // Soft delete: insert new version with deleted = true
    await (this.db as any).insert(this.schema.things).values({
      id,
      type: typeId,
      branch: currentThing?.branch ?? null,
      name: currentThing?.name,
      data: currentThing?.data,
      deleted: true,
    })

    // Remove relationships
    await this.removeRelationships(id, collection)

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

    const typeId = await this.getTypeId(collection)

    // Build count query
    let query = sql`
      SELECT COUNT(DISTINCT t.id) as count
      FROM things t
      WHERE t.type = ${typeId}
        AND (t.branch IS NULL OR t.branch = 'main')
        AND (t.deleted = 0 OR t.deleted IS NULL)
    `

    // Apply where filters (simplified for count)
    // For complex where, would need subquery

    const results = await this.runQuery(query)
    return (results[0] as any)?.count ?? 0
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VERSION OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async createVersion(args: CreateVersionArgs): Promise<Version> {
    const { collection, id, type = 'draft', label, createdBy } = args

    const fields = this.fieldMap.get(collection) || []

    // Get current document
    const doc = await this.findOne({ collection, id, depth: 0 })
    if (!doc) {
      throw new Error(`Document '${id}' not found in collection '${collection}'`)
    }

    // Get existing versions to determine number
    const versionType = getVersionType(this.namespace, collection)
    const versionTypeId = await this.ensureNounExists(`_versions_${collection}`, [])

    const existingVersionsQuery = sql`
      SELECT COUNT(*) as count
      FROM things
      WHERE type = ${versionTypeId}
        AND json_extract(data, '$.parent') = ${id}
    `
    const countResult = await this.runQuery(existingVersionsQuery)
    const versionNumber = ((countResult[0] as any)?.count ?? 0) + 1

    // Create version Thing
    const now = new Date()
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...snapshotData } = doc

    const versionThingId = getVersionThingId(this.namespace, collection, id, versionNumber)
    const versionData: Record<string, unknown> = {
      parent: id,
      versionNumber,
      type,
      version: snapshotData,
    }

    if (label) versionData.label = label
    if (createdBy) versionData.createdBy = createdBy

    await (this.db as any).insert(this.schema.things).values({
      id: versionThingId,
      type: versionTypeId,
      branch: null,
      name: `Version ${versionNumber}`,
      data: versionData,
      deleted: false,
    })

    return {
      id: versionThingId,
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

    const versionTypeId = await this.ensureNounExists(`_versions_${collection}`, [])

    // Query versions
    const query = sql`
      SELECT rowid as version, *
      FROM things
      WHERE type = ${versionTypeId}
        AND json_extract(data, '$.parent') = ${id}
        AND (deleted = 0 OR deleted IS NULL)
      ORDER BY json_extract(data, '$.versionNumber') DESC
    `

    const results = await this.runQuery(query)

    // Transform to Version records
    let versions: Version[] = (results as any[]).map((row) => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
      return {
        id: row.id,
        parent: data.parent,
        versionNumber: data.versionNumber,
        type: data.type || 'draft',
        label: data.label,
        createdBy: data.createdBy,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        version: data.version,
      }
    })

    // Apply sort
    const isDesc = sort.startsWith('-')
    const sortField = isDesc ? sort.slice(1) : sort
    versions.sort((a, b) => {
      const aVal = (a as any)[sortField]
      const bVal = (b as any)[sortField]
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      return isDesc ? -cmp : cmp
    })

    // Paginate
    const totalDocs = versions.length
    const totalPages = Math.max(1, Math.ceil(totalDocs / limit))
    const offset = (page - 1) * limit
    const paginatedVersions = versions.slice(offset, offset + limit)

    return {
      docs: paginatedVersions,
      totalDocs,
      limit,
      page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GLOBAL OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async findGlobal(args: FindGlobalArgs): Promise<PayloadDocument> {
    const { slug, depth = 1 } = args

    const globalsType = getGlobalsType(this.namespace)
    const globalsTypeId = await this.ensureNounExists('globals', [])
    const thingId = getGlobalThingId(this.namespace, slug)

    const query = sql`
      SELECT rowid as version, *
      FROM things
      WHERE id = ${thingId}
        AND type = ${globalsTypeId}
        AND (deleted = 0 OR deleted IS NULL)
      ORDER BY rowid DESC
      LIMIT 1
    `

    const results = await this.runQuery(query)

    if (results.length === 0) {
      // Return minimal document for non-existent global
      return { id: slug }
    }

    const row = results[0] as any
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {})

    const doc: PayloadDocument = {
      ...data,
      id: slug,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }

    return doc
  }

  async createGlobal(args: CreateGlobalArgs): Promise<PayloadDocument> {
    const { slug, data } = args

    const globalsTypeId = await this.ensureNounExists('globals', [])
    const thingId = getGlobalThingId(this.namespace, slug)
    const now = new Date()

    await (this.db as any).insert(this.schema.things).values({
      id: thingId,
      type: globalsTypeId,
      branch: null,
      name: slug,
      data,
      deleted: false,
    })

    return {
      ...data,
      id: slug,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
  }

  async updateGlobal(args: UpdateGlobalArgs): Promise<PayloadDocument> {
    const { slug, data } = args

    const globalsTypeId = await this.ensureNounExists('globals', [])
    const thingId = getGlobalThingId(this.namespace, slug)

    // Get existing global
    const existing = await this.findGlobal({ slug, depth: 0 })
    const now = new Date()

    // Merge data
    const mergedData = { ...existing, ...data }
    delete mergedData.id
    delete mergedData.createdAt
    delete mergedData.updatedAt

    // Insert new version (append-only)
    await (this.db as any).insert(this.schema.things).values({
      id: thingId,
      type: globalsTypeId,
      branch: null,
      name: slug,
      data: mergedData,
      deleted: false,
    })

    return {
      ...mergedData,
      id: slug,
      createdAt: existing.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRANSACTION OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async beginTransaction(): Promise<string> {
    const id = `tx_${++this.transactionCounter}_${Date.now()}`

    // For SQLite, BEGIN transaction
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
  // HELPER METHODS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build SQL conditions from where clause.
   */
  private buildWhereConditions(where?: WhereClause): any[] {
    if (!where) return []

    const conditions: any[] = []

    // Handle AND
    if (where.and && Array.isArray(where.and)) {
      for (const clause of where.and) {
        conditions.push(...this.buildWhereConditions(clause))
      }
    }

    // Handle OR
    if (where.or && Array.isArray(where.or)) {
      const orConditions = where.or
        .map((clause) => this.buildWhereConditions(clause))
        .filter((c) => c.length > 0)
      if (orConditions.length > 0) {
        // Would need proper OR handling in Drizzle
        // Simplified: just add all conditions
        for (const ors of orConditions) {
          conditions.push(...ors)
        }
      }
    }

    // Handle field operators
    for (const [field, operators] of Object.entries(where)) {
      if (field === 'and' || field === 'or') continue
      if (!operators || typeof operators !== 'object') continue

      const fieldConditions = this.buildFieldConditions(field, operators as WhereOperator)
      conditions.push(...fieldConditions)
    }

    return conditions
  }

  /**
   * Build conditions for a single field.
   */
  private buildFieldConditions(field: string, ops: WhereOperator): any[] {
    const conditions: any[] = []
    const jsonPath = `$.${field}`

    for (const [op, value] of Object.entries(ops)) {
      switch (op) {
        case 'equals':
          if (value === null) {
            conditions.push(sql`json_extract(t.data, ${jsonPath}) IS NULL`)
          } else {
            conditions.push(sql`json_extract(t.data, ${jsonPath}) = ${JSON.stringify(value)}`)
          }
          break

        case 'not_equals':
          if (value === null) {
            conditions.push(sql`json_extract(t.data, ${jsonPath}) IS NOT NULL`)
          } else {
            conditions.push(sql`json_extract(t.data, ${jsonPath}) != ${JSON.stringify(value)}`)
          }
          break

        case 'in':
          if (Array.isArray(value) && value.length > 0) {
            const vals = value.map((v) => JSON.stringify(v))
            conditions.push(
              sql`json_extract(t.data, ${jsonPath}) IN (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`
            )
          }
          break

        case 'greater_than':
          conditions.push(sql`json_extract(t.data, ${jsonPath}) > ${value}`)
          break

        case 'greater_than_equal':
          conditions.push(sql`json_extract(t.data, ${jsonPath}) >= ${value}`)
          break

        case 'less_than':
          conditions.push(sql`json_extract(t.data, ${jsonPath}) < ${value}`)
          break

        case 'less_than_equal':
          conditions.push(sql`json_extract(t.data, ${jsonPath}) <= ${value}`)
          break

        case 'like':
          conditions.push(sql`json_extract(t.data, ${jsonPath}) LIKE ${value}`)
          break

        case 'contains':
          conditions.push(sql`json_extract(t.data, ${jsonPath}) LIKE ${`%${value}%`}`)
          break

        case 'exists':
          if (value === true) {
            conditions.push(sql`json_extract(t.data, ${jsonPath}) IS NOT NULL`)
          } else {
            conditions.push(sql`json_extract(t.data, ${jsonPath}) IS NULL`)
          }
          break
      }
    }

    return conditions
  }

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
    const thingId = getThingId(this.namespace, collection, doc.id)

    for (const field of fields) {
      if (field.type !== 'relationship' && field.type !== 'upload') continue

      const value = doc[field.name]
      if (value == null) {
        result[field.name] = null
        continue
      }

      const verb = fieldNameToVerb(field.name)
      const relationTo = field.relationTo

      // Get relationships from edges
      const rels = await this.getRelationships(thingId, verb)

      if (Array.isArray(relationTo)) {
        // Polymorphic relationship - keep as-is for now
        continue
      }

      if (field.hasMany && Array.isArray(value)) {
        // Populate array of relationships
        const populated = await Promise.all(
          value.map((relId) =>
            this.findOne({
              collection: relationTo || '',
              id: String(relId),
              depth: depth - 1,
            })
          )
        )
        result[field.name] = populated.filter((d) => d !== null)
      } else {
        // Populate single relationship
        const populated = await this.findOne({
          collection: relationTo || '',
          id: String(value),
          depth: depth - 1,
        })
        result[field.name] = populated
      }
    }

    return result
  }

  /**
   * Create a relationship edge.
   */
  private async createRelationship(rel: ExtractedRelationship): Promise<void> {
    const id = crypto.randomUUID()
    const now = new Date()

    try {
      await (this.db as any).insert(this.schema.relationships).values({
        id,
        verb: rel.verb,
        from: rel.from,
        to: rel.to,
        data: rel.data || null,
        createdAt: now,
      })
    } catch (error) {
      // Duplicate relationship - ignore
      if (!(error as Error).message?.includes('UNIQUE constraint')) {
        throw error
      }
    }
  }

  /**
   * Get relationships from a thing.
   */
  private async getRelationships(from: string, verb?: string): Promise<any[]> {
    let query
    if (verb) {
      query = sql`
        SELECT * FROM relationships
        WHERE "from" = ${from} AND verb = ${verb}
      `
    } else {
      query = sql`
        SELECT * FROM relationships
        WHERE "from" = ${from}
      `
    }

    return this.runQuery(query)
  }

  /**
   * Update relationships for a document.
   */
  private async updateRelationships(
    docId: string,
    doc: PayloadDocument,
    collection: string,
    fields: PayloadField[]
  ): Promise<void> {
    const thingId = getThingId(this.namespace, collection, docId)

    // Remove existing relationships
    for (const field of fields) {
      if (field.type === 'relationship' || field.type === 'upload') {
        const verb = fieldNameToVerb(field.name)
        await this.runQuery(
          sql`DELETE FROM relationships WHERE "from" = ${thingId} AND verb = ${verb}`
        )
      }
    }

    // Create new relationships
    const relationships = extractRelationships(doc, {
      collection,
      namespace: this.namespace,
      fields,
    })

    for (const rel of relationships) {
      await this.createRelationship(rel)
    }
  }

  /**
   * Remove all relationships from a document.
   */
  private async removeRelationships(docId: string, collection: string): Promise<void> {
    const thingId = getThingId(this.namespace, collection, docId)
    await this.runQuery(sql`DELETE FROM relationships WHERE "from" = ${thingId}`)
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a ThingsStorageStrategy instance.
 *
 * @param config - Strategy configuration
 * @returns Configured ThingsStorageStrategy
 *
 * @example
 * ```typescript
 * import { createThingsStrategy } from '@dotdo/payload/strategies/things'
 * import * as schema from './db'
 *
 * const strategy = createThingsStrategy({
 *   db,
 *   schema,
 *   namespace: 'https://example.do',
 * })
 * ```
 */
export function createThingsStrategy(config: ThingsStrategyConfig): ThingsStorageStrategy {
  return new ThingsStorageStrategy(config)
}
