/**
 * CollectionDO - Per-Collection Storage with SQLite
 *
 * Each MongoDB collection is backed by a dedicated Durable Object.
 * Documents are stored in SQLite with JSON columns and GIN-like indexes.
 */

import { DurableObject } from 'cloudflare:workers'
import { QueryParser, UpdateParser, type MongoFilter, type MongoUpdate, type SortSpec, type ProjectionSpec } from './query-parser'
import { AggregationPipeline, type AggregationStage, type Document, type LookupResolver } from './aggregation'

// ============================================================================
// Types
// ============================================================================

export interface Env {
  COLLECTION_DO: DurableObjectNamespace
  MONGO_DO: DurableObjectNamespace
}

/** Insert result */
export interface InsertOneResult {
  acknowledged: boolean
  insertedId: string
}

/** Insert many result */
export interface InsertManyResult {
  acknowledged: boolean
  insertedCount: number
  insertedIds: string[]
}

/** Update result */
export interface UpdateResult {
  acknowledged: boolean
  matchedCount: number
  modifiedCount: number
  upsertedId?: string
  upsertedCount: number
}

/** Delete result */
export interface DeleteResult {
  acknowledged: boolean
  deletedCount: number
}

/** Index specification */
export interface IndexSpec {
  key: Record<string, 1 | -1>
  name?: string
  unique?: boolean
  sparse?: boolean
  expireAfterSeconds?: number
}

/** Index info */
export interface IndexInfo {
  name: string
  key: Record<string, 1 | -1>
  unique?: boolean
  sparse?: boolean
  v: number
}

/** Find options */
export interface FindOptions {
  filter?: MongoFilter
  projection?: ProjectionSpec
  sort?: SortSpec
  limit?: number
  skip?: number
}

/** Cursor for iteration */
export interface Cursor<T> {
  toArray(): Promise<T[]>
  forEach(callback: (doc: T) => void | Promise<void>): Promise<void>
  count(): Promise<number>
  limit(n: number): Cursor<T>
  skip(n: number): Cursor<T>
  sort(spec: SortSpec): Cursor<T>
}

// ============================================================================
// CollectionDO
// ============================================================================

export class CollectionDO extends DurableObject {
  private queryParser = new QueryParser()
  private updateParser = new UpdateParser()
  private aggregationPipeline = new AggregationPipeline()
  private initialized = false
  private collectionName = ''
  private dbName = ''

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
  }

  /**
   * Initialize the collection schema
   */
  private async init(): Promise<void> {
    if (this.initialized) return

    const sql = this.ctx.storage.sql

    // Create documents table with JSON storage
    sql.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        doc TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `)

    // Create indexes table
    sql.exec(`
      CREATE TABLE IF NOT EXISTS indexes (
        name TEXT PRIMARY KEY,
        key_spec TEXT NOT NULL,
        unique_flag INTEGER DEFAULT 0,
        sparse INTEGER DEFAULT 0,
        expire_after INTEGER
      )
    `)

    // Create default _id index
    sql.exec(`
      INSERT OR IGNORE INTO indexes (name, key_spec, unique_flag)
      VALUES ('_id_', '{"_id":1}', 1)
    `)

    this.initialized = true
  }

  /**
   * Set collection metadata
   */
  async setMetadata(dbName: string, collectionName: string): Promise<void> {
    this.dbName = dbName
    this.collectionName = collectionName
  }

  /**
   * Generate a unique document ID (similar to MongoDB ObjectId)
   */
  private generateId(): string {
    const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0')
    const random = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    return timestamp + random
  }

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  /**
   * Insert a single document
   */
  async insertOne(doc: Document): Promise<InsertOneResult> {
    await this.init()

    const id = (doc._id as string) ?? this.generateId()
    const docWithId = { ...doc, _id: id }

    // Check for duplicate _id
    const existing = this.ctx.storage.sql.exec(
      'SELECT id FROM documents WHERE id = ?',
      id
    )
    if (existing.toArray().length > 0) {
      throw new Error(`E11000 duplicate key error: _id: ${id}`)
    }

    // Check unique indexes
    await this.checkUniqueIndexes(docWithId)

    // Insert document
    this.ctx.storage.sql.exec(
      'INSERT INTO documents (id, doc) VALUES (?, ?)',
      id,
      JSON.stringify(docWithId)
    )

    return { acknowledged: true, insertedId: id }
  }

  /**
   * Insert multiple documents
   */
  async insertMany(docs: Document[], options?: { ordered?: boolean }): Promise<InsertManyResult> {
    await this.init()

    const ordered = options?.ordered !== false
    const insertedIds: string[] = []

    for (const doc of docs) {
      try {
        const result = await this.insertOne(doc)
        insertedIds.push(result.insertedId)
      } catch (error) {
        if (ordered) throw error
        // Continue for unordered inserts
      }
    }

    return {
      acknowledged: true,
      insertedCount: insertedIds.length,
      insertedIds,
    }
  }

  /**
   * Find a single document
   */
  async findOne(filter?: MongoFilter, options?: FindOptions): Promise<Document | null> {
    const docs = await this.find({ ...options, filter, limit: 1 })
    return docs[0] ?? null
  }

  /**
   * Find documents
   */
  async find(options?: FindOptions): Promise<Document[]> {
    await this.init()

    const filter = options?.filter ?? {}
    const projection = options?.projection
    const sort = options?.sort
    const limit = options?.limit
    const skip = options?.skip ?? 0

    // Parse filter to SQL
    const { sql: whereSql, params } = this.queryParser.parseFilter(filter)
    const orderSql = this.queryParser.parseSort(sort ?? null)

    // Build query
    let query = `SELECT id, doc FROM documents WHERE ${whereSql} ${orderSql}`

    if (limit !== undefined) {
      query += ` LIMIT ${limit}`
    }
    if (skip > 0) {
      query += ` OFFSET ${skip}`
    }

    const result = this.ctx.storage.sql.exec(query, ...params)
    const rows = result.toArray()

    // Parse documents
    let docs = rows.map(row => {
      const doc = JSON.parse(row.doc as string) as Document
      return doc
    })

    // Apply projection
    if (projection) {
      docs = this.applyProjection(docs, projection)
    }

    return docs
  }

  /**
   * Update a single document
   */
  async updateOne(
    filter: MongoFilter,
    update: MongoUpdate,
    options?: { upsert?: boolean }
  ): Promise<UpdateResult> {
    await this.init()

    // Find matching document
    const { sql: whereSql, params } = this.queryParser.parseFilter(filter)
    const result = this.ctx.storage.sql.exec(
      `SELECT id, doc FROM documents WHERE ${whereSql} LIMIT 1`,
      ...params
    )
    const rows = result.toArray()

    if (rows.length === 0) {
      if (options?.upsert) {
        // Create new document from filter and update
        const newDoc = this.buildUpsertDoc(filter, update)
        const insertResult = await this.insertOne(newDoc)
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedId: insertResult.insertedId,
          upsertedCount: 1,
        }
      }
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
    }

    const row = rows[0]
    const doc = JSON.parse(row.doc as string) as Document
    const updatedDoc = this.updateParser.applyUpdate(doc, update)

    // Check unique indexes
    await this.checkUniqueIndexes(updatedDoc, row.id as string)

    // Update document
    this.ctx.storage.sql.exec(
      `UPDATE documents SET doc = ?, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(updatedDoc),
      row.id
    )

    return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
  }

  /**
   * Update multiple documents
   */
  async updateMany(
    filter: MongoFilter,
    update: MongoUpdate,
    options?: { upsert?: boolean }
  ): Promise<UpdateResult> {
    await this.init()

    // Find all matching documents
    const { sql: whereSql, params } = this.queryParser.parseFilter(filter)
    const result = this.ctx.storage.sql.exec(
      `SELECT id, doc FROM documents WHERE ${whereSql}`,
      ...params
    )
    const rows = result.toArray()

    if (rows.length === 0) {
      if (options?.upsert) {
        const newDoc = this.buildUpsertDoc(filter, update)
        const insertResult = await this.insertOne(newDoc)
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedId: insertResult.insertedId,
          upsertedCount: 1,
        }
      }
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
    }

    let modifiedCount = 0
    for (const row of rows) {
      const doc = JSON.parse(row.doc as string) as Document
      const updatedDoc = this.updateParser.applyUpdate(doc, update)

      this.ctx.storage.sql.exec(
        `UPDATE documents SET doc = ?, updated_at = datetime('now') WHERE id = ?`,
        JSON.stringify(updatedDoc),
        row.id
      )
      modifiedCount++
    }

    return { acknowledged: true, matchedCount: rows.length, modifiedCount, upsertedCount: 0 }
  }

  /**
   * Replace a single document
   */
  async replaceOne(
    filter: MongoFilter,
    replacement: Document,
    options?: { upsert?: boolean }
  ): Promise<UpdateResult> {
    await this.init()

    const { sql: whereSql, params } = this.queryParser.parseFilter(filter)
    const result = this.ctx.storage.sql.exec(
      `SELECT id FROM documents WHERE ${whereSql} LIMIT 1`,
      ...params
    )
    const rows = result.toArray()

    if (rows.length === 0) {
      if (options?.upsert) {
        const id = (replacement._id as string) ?? this.generateId()
        const docWithId = { ...replacement, _id: id }
        this.ctx.storage.sql.exec(
          'INSERT INTO documents (id, doc) VALUES (?, ?)',
          id,
          JSON.stringify(docWithId)
        )
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedId: id,
          upsertedCount: 1,
        }
      }
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
    }

    const id = rows[0].id as string
    const docWithId = { ...replacement, _id: id }

    // Check unique indexes
    await this.checkUniqueIndexes(docWithId, id)

    this.ctx.storage.sql.exec(
      `UPDATE documents SET doc = ?, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(docWithId),
      id
    )

    return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
  }

  /**
   * Delete a single document
   */
  async deleteOne(filter: MongoFilter): Promise<DeleteResult> {
    await this.init()

    const { sql: whereSql, params } = this.queryParser.parseFilter(filter)
    const result = this.ctx.storage.sql.exec(
      `SELECT id FROM documents WHERE ${whereSql} LIMIT 1`,
      ...params
    )
    const rows = result.toArray()

    if (rows.length === 0) {
      return { acknowledged: true, deletedCount: 0 }
    }

    this.ctx.storage.sql.exec('DELETE FROM documents WHERE id = ?', rows[0].id)

    return { acknowledged: true, deletedCount: 1 }
  }

  /**
   * Delete multiple documents
   */
  async deleteMany(filter: MongoFilter): Promise<DeleteResult> {
    await this.init()

    const { sql: whereSql, params } = this.queryParser.parseFilter(filter)

    // Count before delete
    const countResult = this.ctx.storage.sql.exec(
      `SELECT COUNT(*) as count FROM documents WHERE ${whereSql}`,
      ...params
    )
    const count = countResult.toArray()[0].count as number

    if (count === 0) {
      return { acknowledged: true, deletedCount: 0 }
    }

    this.ctx.storage.sql.exec(
      `DELETE FROM documents WHERE ${whereSql}`,
      ...params
    )

    return { acknowledged: true, deletedCount: count }
  }

  /**
   * Find and update a document
   */
  async findOneAndUpdate(
    filter: MongoFilter,
    update: MongoUpdate,
    options?: { upsert?: boolean; returnDocument?: 'before' | 'after' }
  ): Promise<Document | null> {
    await this.init()

    const { sql: whereSql, params } = this.queryParser.parseFilter(filter)
    const result = this.ctx.storage.sql.exec(
      `SELECT id, doc FROM documents WHERE ${whereSql} LIMIT 1`,
      ...params
    )
    const rows = result.toArray()

    if (rows.length === 0) {
      if (options?.upsert) {
        const newDoc = this.buildUpsertDoc(filter, update)
        await this.insertOne(newDoc)
        return options.returnDocument === 'after' ? newDoc : null
      }
      return null
    }

    const row = rows[0]
    const doc = JSON.parse(row.doc as string) as Document
    const updatedDoc = this.updateParser.applyUpdate(doc, update)

    this.ctx.storage.sql.exec(
      `UPDATE documents SET doc = ?, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(updatedDoc),
      row.id
    )

    return options?.returnDocument === 'after' ? updatedDoc : doc
  }

  /**
   * Find and delete a document
   */
  async findOneAndDelete(filter: MongoFilter): Promise<Document | null> {
    await this.init()

    const { sql: whereSql, params } = this.queryParser.parseFilter(filter)
    const result = this.ctx.storage.sql.exec(
      `SELECT id, doc FROM documents WHERE ${whereSql} LIMIT 1`,
      ...params
    )
    const rows = result.toArray()

    if (rows.length === 0) {
      return null
    }

    const doc = JSON.parse(rows[0].doc as string) as Document
    this.ctx.storage.sql.exec('DELETE FROM documents WHERE id = ?', rows[0].id)

    return doc
  }

  /**
   * Find and replace a document
   */
  async findOneAndReplace(
    filter: MongoFilter,
    replacement: Document,
    options?: { upsert?: boolean; returnDocument?: 'before' | 'after' }
  ): Promise<Document | null> {
    await this.init()

    const { sql: whereSql, params } = this.queryParser.parseFilter(filter)
    const result = this.ctx.storage.sql.exec(
      `SELECT id, doc FROM documents WHERE ${whereSql} LIMIT 1`,
      ...params
    )
    const rows = result.toArray()

    if (rows.length === 0) {
      if (options?.upsert) {
        const id = (replacement._id as string) ?? this.generateId()
        const docWithId = { ...replacement, _id: id }
        await this.insertOne(docWithId)
        return options.returnDocument === 'after' ? docWithId : null
      }
      return null
    }

    const row = rows[0]
    const doc = JSON.parse(row.doc as string) as Document
    const id = row.id as string
    const docWithId = { ...replacement, _id: id }

    this.ctx.storage.sql.exec(
      `UPDATE documents SET doc = ?, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(docWithId),
      id
    )

    return options?.returnDocument === 'after' ? docWithId : doc
  }

  // ============================================================================
  // Aggregation
  // ============================================================================

  /**
   * Execute an aggregation pipeline
   */
  async aggregate(pipeline: AggregationStage[], lookupResolver?: LookupResolver): Promise<Document[]> {
    await this.init()

    // Get all documents (could optimize for $match at start of pipeline)
    const allDocs = await this.find()

    // Execute pipeline
    return this.aggregationPipeline.execute(allDocs, pipeline, lookupResolver)
  }

  // ============================================================================
  // Count Operations
  // ============================================================================

  /**
   * Count documents matching filter
   */
  async countDocuments(filter?: MongoFilter): Promise<number> {
    await this.init()

    const { sql: whereSql, params } = this.queryParser.parseFilter(filter ?? {})
    const result = this.ctx.storage.sql.exec(
      `SELECT COUNT(*) as count FROM documents WHERE ${whereSql}`,
      ...params
    )

    return result.toArray()[0].count as number
  }

  /**
   * Estimated document count (faster but may be approximate)
   */
  async estimatedDocumentCount(): Promise<number> {
    await this.init()

    const result = this.ctx.storage.sql.exec('SELECT COUNT(*) as count FROM documents')
    return result.toArray()[0].count as number
  }

  /**
   * Get distinct values for a field
   */
  async distinct(field: string, filter?: MongoFilter): Promise<unknown[]> {
    const docs = await this.find({ filter })
    const values = new Set<string>()

    for (const doc of docs) {
      const value = this.getNestedValue(doc, field)
      if (value !== undefined) {
        values.add(JSON.stringify(value))
      }
    }

    return Array.from(values).map(v => JSON.parse(v))
  }

  // ============================================================================
  // Index Operations
  // ============================================================================

  /**
   * Create an index
   */
  async createIndex(keys: Record<string, 1 | -1>, options?: { name?: string; unique?: boolean; sparse?: boolean }): Promise<string> {
    await this.init()

    const name = options?.name ?? Object.entries(keys).map(([k, v]) => `${k}_${v}`).join('_')

    // Check if index exists
    const existing = this.ctx.storage.sql.exec(
      'SELECT name FROM indexes WHERE name = ?',
      name
    )
    if (existing.toArray().length > 0) {
      return name
    }

    // Create index record
    this.ctx.storage.sql.exec(
      'INSERT INTO indexes (name, key_spec, unique_flag, sparse) VALUES (?, ?, ?, ?)',
      name,
      JSON.stringify(keys),
      options?.unique ? 1 : 0,
      options?.sparse ? 1 : 0
    )

    // Create SQLite index for single-field indexes
    if (Object.keys(keys).length === 1) {
      const field = Object.keys(keys)[0]
      const direction = keys[field] === 1 ? 'ASC' : 'DESC'

      try {
        if (field === '_id') {
          // _id already has an index via PRIMARY KEY
        } else {
          this.ctx.storage.sql.exec(`
            CREATE INDEX IF NOT EXISTS idx_${name} ON documents (
              json_extract(doc, '$.${field}') ${direction}
            )
          `)
        }
      } catch {
        // Index creation might fail for complex fields
      }
    }

    return name
  }

  /**
   * Create multiple indexes
   */
  async createIndexes(indexes: IndexSpec[]): Promise<string[]> {
    const names: string[] = []
    for (const idx of indexes) {
      names.push(await this.createIndex(idx.key, {
        name: idx.name,
        unique: idx.unique,
        sparse: idx.sparse,
      }))
    }
    return names
  }

  /**
   * Drop an index
   */
  async dropIndex(name: string): Promise<void> {
    await this.init()

    if (name === '_id_') {
      throw new Error('Cannot drop _id index')
    }

    this.ctx.storage.sql.exec('DELETE FROM indexes WHERE name = ?', name)

    try {
      this.ctx.storage.sql.exec(`DROP INDEX IF EXISTS idx_${name}`)
    } catch {
      // Ignore errors
    }
  }

  /**
   * Drop all indexes (except _id)
   */
  async dropIndexes(): Promise<void> {
    await this.init()

    const indexes = await this.listIndexes()
    for (const idx of indexes) {
      if (idx.name !== '_id_') {
        await this.dropIndex(idx.name)
      }
    }
  }

  /**
   * List all indexes
   */
  async listIndexes(): Promise<IndexInfo[]> {
    await this.init()

    const result = this.ctx.storage.sql.exec(
      'SELECT name, key_spec, unique_flag, sparse FROM indexes'
    )

    return result.toArray().map(row => ({
      name: row.name as string,
      key: JSON.parse(row.key_spec as string),
      unique: (row.unique_flag as number) === 1,
      sparse: (row.sparse as number) === 1,
      v: 2,
    }))
  }

  /**
   * Check if index exists
   */
  async indexExists(name: string | string[]): Promise<boolean> {
    const indexes = await this.listIndexes()
    const names = Array.isArray(name) ? name : [name]
    return names.every(n => indexes.some(idx => idx.name === n))
  }

  // ============================================================================
  // Collection Operations
  // ============================================================================

  /**
   * Drop the collection
   */
  async drop(): Promise<boolean> {
    await this.init()

    this.ctx.storage.sql.exec('DELETE FROM documents')
    this.ctx.storage.sql.exec('DELETE FROM indexes WHERE name != ?', '_id_')

    return true
  }

  /**
   * Get collection stats
   */
  async stats(): Promise<{
    ns: string
    count: number
    size: number
    avgObjSize: number
    storageSize: number
    nindexes: number
  }> {
    await this.init()

    const count = await this.estimatedDocumentCount()
    const indexes = await this.listIndexes()

    // Estimate size
    const result = this.ctx.storage.sql.exec('SELECT SUM(LENGTH(doc)) as size FROM documents')
    const size = (result.toArray()[0].size as number) ?? 0

    return {
      ns: `${this.dbName}.${this.collectionName}`,
      count,
      size,
      avgObjSize: count > 0 ? size / count : 0,
      storageSize: size,
      nindexes: indexes.length,
    }
  }

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  /**
   * Execute bulk write operations
   */
  async bulkWrite(operations: BulkOperation[]): Promise<BulkWriteResult> {
    await this.init()

    let insertedCount = 0
    let matchedCount = 0
    let modifiedCount = 0
    let deletedCount = 0
    let upsertedCount = 0
    const insertedIds: string[] = []
    const upsertedIds: { index: number; _id: string }[] = []

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]

      if ('insertOne' in op) {
        const result = await this.insertOne(op.insertOne.document)
        insertedCount++
        insertedIds.push(result.insertedId)
      } else if ('updateOne' in op) {
        const result = await this.updateOne(op.updateOne.filter, op.updateOne.update, { upsert: op.updateOne.upsert })
        matchedCount += result.matchedCount
        modifiedCount += result.modifiedCount
        if (result.upsertedId) {
          upsertedCount++
          upsertedIds.push({ index: i, _id: result.upsertedId })
        }
      } else if ('updateMany' in op) {
        const result = await this.updateMany(op.updateMany.filter, op.updateMany.update, { upsert: op.updateMany.upsert })
        matchedCount += result.matchedCount
        modifiedCount += result.modifiedCount
        if (result.upsertedId) {
          upsertedCount++
          upsertedIds.push({ index: i, _id: result.upsertedId })
        }
      } else if ('deleteOne' in op) {
        const result = await this.deleteOne(op.deleteOne.filter)
        deletedCount += result.deletedCount
      } else if ('deleteMany' in op) {
        const result = await this.deleteMany(op.deleteMany.filter)
        deletedCount += result.deletedCount
      } else if ('replaceOne' in op) {
        const result = await this.replaceOne(op.replaceOne.filter, op.replaceOne.replacement, { upsert: op.replaceOne.upsert })
        matchedCount += result.matchedCount
        modifiedCount += result.modifiedCount
        if (result.upsertedId) {
          upsertedCount++
          upsertedIds.push({ index: i, _id: result.upsertedId })
        }
      }
    }

    return {
      acknowledged: true,
      insertedCount,
      insertedIds,
      matchedCount,
      modifiedCount,
      deletedCount,
      upsertedCount,
      upsertedIds,
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Check unique indexes for a document
   */
  private async checkUniqueIndexes(doc: Document, excludeId?: string): Promise<void> {
    const indexes = await this.listIndexes()

    for (const idx of indexes) {
      if (!idx.unique || idx.name === '_id_') continue

      // Build filter for duplicate check
      const filter: MongoFilter = {}
      for (const field of Object.keys(idx.key)) {
        const value = this.getNestedValue(doc, field)
        if (value !== undefined) {
          filter[field] = value
        }
      }

      if (Object.keys(filter).length === 0) continue

      // Check for existing document
      const { sql: whereSql, params } = this.queryParser.parseFilter(filter)
      let query = `SELECT id FROM documents WHERE ${whereSql}`
      const queryParams = [...params]

      if (excludeId) {
        query += ' AND id != ?'
        queryParams.push(excludeId)
      }

      const result = this.ctx.storage.sql.exec(query + ' LIMIT 1', ...queryParams)
      if (result.toArray().length > 0) {
        throw new Error(`E11000 duplicate key error: ${idx.name}`)
      }
    }
  }

  /**
   * Build document for upsert from filter and update
   */
  private buildUpsertDoc(filter: MongoFilter, update: MongoUpdate): Document {
    const doc: Document = {}

    // Extract equality conditions from filter
    for (const [key, value] of Object.entries(filter)) {
      if (key.startsWith('$')) continue
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Check for $eq operator
        const ops = value as Record<string, unknown>
        if ('$eq' in ops) {
          doc[key] = ops.$eq
        }
      } else {
        doc[key] = value
      }
    }

    // Apply update operators
    return this.updateParser.applyUpdate(doc, update)
  }

  /**
   * Apply projection to documents
   */
  private applyProjection(docs: Document[], projection: ProjectionSpec): Document[] {
    const entries = Object.entries(projection)
    const hasInclusion = entries.some(([, v]) => v === 1)
    const hasExclusion = entries.some(([k, v]) => v === 0 && k !== '_id')

    return docs.map(doc => {
      const result: Document = {}

      if (hasInclusion && !hasExclusion) {
        // Inclusion mode
        for (const [field, value] of entries) {
          if (value === 1) {
            const val = this.getNestedValue(doc, field)
            if (val !== undefined) {
              this.setNestedValue(result, field, val)
            }
          }
        }
        // Always include _id unless excluded
        if (projection._id !== 0) {
          result._id = doc._id
        }
      } else {
        // Exclusion mode
        Object.assign(result, JSON.parse(JSON.stringify(doc)))
        for (const [field, value] of entries) {
          if (value === 0) {
            delete result[field]
          }
        }
      }

      return result
    })
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj
    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      if (typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  /**
   * Set nested value in object
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let current: Record<string, unknown> = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (current[part] === undefined || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }
    current[parts[parts.length - 1]] = value
  }
}

// ============================================================================
// Bulk Operation Types
// ============================================================================

export type BulkOperation =
  | { insertOne: { document: Document } }
  | { updateOne: { filter: MongoFilter; update: MongoUpdate; upsert?: boolean } }
  | { updateMany: { filter: MongoFilter; update: MongoUpdate; upsert?: boolean } }
  | { deleteOne: { filter: MongoFilter } }
  | { deleteMany: { filter: MongoFilter } }
  | { replaceOne: { filter: MongoFilter; replacement: Document; upsert?: boolean } }

export interface BulkWriteResult {
  acknowledged: boolean
  insertedCount: number
  insertedIds: string[]
  matchedCount: number
  modifiedCount: number
  deletedCount: number
  upsertedCount: number
  upsertedIds: { index: number; _id: string }[]
}
