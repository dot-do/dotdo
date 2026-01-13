/**
 * MongoDO - Database Coordinator
 *
 * Coordinates MongoDB operations across CollectionDO instances.
 * Handles database-level operations and routes collection requests.
 */

import { DurableObject } from 'cloudflare:workers'
import type { CollectionDO, InsertOneResult, InsertManyResult, UpdateResult, DeleteResult, FindOptions, IndexInfo, BulkOperation, BulkWriteResult } from './CollectionDO'
import type { MongoFilter, MongoUpdate, SortSpec } from './query-parser'
import type { AggregationStage, Document, LookupResolver } from './aggregation'

// ============================================================================
// Types
// ============================================================================

export interface Env {
  MONGO_DO: DurableObjectNamespace
  COLLECTION_DO: DurableObjectNamespace
}

/** Database info */
export interface DbInfo {
  name: string
  sizeOnDisk: number
  empty: boolean
  collections: number
}

/** Collection info */
export interface CollectionInfo {
  name: string
  type: 'collection'
  options: Record<string, unknown>
  info: { readOnly: boolean }
}

/** Server info */
export interface ServerInfo {
  version: string
  gitVersion: string
  modules: string[]
  allocator: string
  javascriptEngine: string
  sysInfo: string
  versionArray: number[]
  ok: number
}

// ============================================================================
// MongoDO - Database Coordinator
// ============================================================================

export class MongoDO extends DurableObject {
  private dbName = ''
  private initialized = false

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
  }

  /**
   * Initialize the database
   */
  private async init(): Promise<void> {
    if (this.initialized) return

    const sql = this.ctx.storage.sql

    // Create collections registry
    sql.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        name TEXT PRIMARY KEY,
        options TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `)

    // Create metadata table
    sql.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)

    this.initialized = true
  }

  /**
   * Set database name
   */
  async setDbName(name: string): Promise<void> {
    this.dbName = name
    await this.init()

    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
      'dbName',
      name
    )
  }

  /**
   * Get database name
   */
  async getDbName(): Promise<string> {
    await this.init()

    if (this.dbName) return this.dbName

    const result = this.ctx.storage.sql.exec(
      'SELECT value FROM metadata WHERE key = ?',
      'dbName'
    )
    const rows = result.toArray()
    if (rows.length > 0) {
      this.dbName = rows[0].value as string
    }

    return this.dbName || 'test'
  }

  /**
   * Get a collection DO stub
   */
  private getCollectionStub(collectionName: string): DurableObjectStub {
    const ns = this.env.COLLECTION_DO as DurableObjectNamespace
    const id = ns.idFromName(`${this.dbName}:${collectionName}`)
    return ns.get(id)
  }

  /**
   * Ensure collection exists in registry
   */
  private async ensureCollection(name: string, options?: Record<string, unknown>): Promise<void> {
    await this.init()

    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO collections (name, options) VALUES (?, ?)',
      name,
      JSON.stringify(options ?? {})
    )

    // Initialize the collection DO
    const stub = this.getCollectionStub(name) as unknown as CollectionDO
    await stub.setMetadata(this.dbName, name)
  }

  // ============================================================================
  // Database Operations
  // ============================================================================

  /**
   * List all collections
   */
  async listCollections(filter?: Record<string, unknown>): Promise<CollectionInfo[]> {
    await this.init()

    let query = 'SELECT name, options FROM collections'
    const params: unknown[] = []

    if (filter?.name) {
      query += ' WHERE name = ?'
      params.push(filter.name)
    }

    const result = this.ctx.storage.sql.exec(query, ...params)

    return result.toArray().map(row => ({
      name: row.name as string,
      type: 'collection' as const,
      options: JSON.parse(row.options as string),
      info: { readOnly: false },
    }))
  }

  /**
   * Create a collection
   */
  async createCollection(name: string, options?: Record<string, unknown>): Promise<void> {
    await this.ensureCollection(name, options)
  }

  /**
   * Drop a collection
   */
  async dropCollection(name: string): Promise<boolean> {
    await this.init()

    const result = this.ctx.storage.sql.exec(
      'SELECT name FROM collections WHERE name = ?',
      name
    )
    if (result.toArray().length === 0) {
      return false
    }

    // Drop from collection DO
    const stub = this.getCollectionStub(name) as unknown as CollectionDO
    await stub.drop()

    // Remove from registry
    this.ctx.storage.sql.exec('DELETE FROM collections WHERE name = ?', name)

    return true
  }

  /**
   * Rename a collection
   */
  async renameCollection(fromName: string, toName: string): Promise<void> {
    await this.init()

    // Get all documents from source
    const sourceStub = this.getCollectionStub(fromName) as unknown as CollectionDO
    const docs = await sourceStub.find()

    // Create target collection and copy documents
    await this.ensureCollection(toName)
    const targetStub = this.getCollectionStub(toName) as unknown as CollectionDO
    if (docs.length > 0) {
      await targetStub.insertMany(docs)
    }

    // Drop source
    await this.dropCollection(fromName)
  }

  /**
   * Get database stats
   */
  async stats(): Promise<{
    db: string
    collections: number
    views: number
    objects: number
    avgObjSize: number
    dataSize: number
    storageSize: number
    indexes: number
    indexSize: number
  }> {
    await this.init()

    const collections = await this.listCollections()
    let objects = 0
    let dataSize = 0
    let indexes = 0

    for (const coll of collections) {
      const stub = this.getCollectionStub(coll.name) as unknown as CollectionDO
      const collStats = await stub.stats()
      objects += collStats.count
      dataSize += collStats.size
      indexes += collStats.nindexes
    }

    return {
      db: this.dbName,
      collections: collections.length,
      views: 0,
      objects,
      avgObjSize: objects > 0 ? dataSize / objects : 0,
      dataSize,
      storageSize: dataSize,
      indexes,
      indexSize: indexes * 100,
    }
  }

  /**
   * Run a database command
   */
  async command(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
    if ('ping' in cmd) {
      return { ok: 1 }
    }
    if ('listCollections' in cmd) {
      const collections = await this.listCollections()
      return { ok: 1, cursor: { firstBatch: collections } }
    }
    if ('create' in cmd) {
      await this.createCollection(cmd.create as string)
      return { ok: 1 }
    }
    if ('drop' in cmd) {
      const result = await this.dropCollection(cmd.drop as string)
      return { ok: result ? 1 : 0 }
    }
    if ('serverStatus' in cmd) {
      return {
        ok: 1,
        host: 'cloudflare-do',
        version: '7.0.0-compat',
        process: 'workers',
        uptime: 1000,
      }
    }

    return { ok: 0, errmsg: 'Unknown command' }
  }

  // ============================================================================
  // Collection Operations (forwarded to CollectionDO)
  // ============================================================================

  /**
   * Insert one document
   */
  async insertOne(collection: string, doc: Document): Promise<InsertOneResult> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.insertOne(doc)
  }

  /**
   * Insert many documents
   */
  async insertMany(collection: string, docs: Document[], options?: { ordered?: boolean }): Promise<InsertManyResult> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.insertMany(docs, options)
  }

  /**
   * Find one document
   */
  async findOne(collection: string, filter?: MongoFilter, options?: FindOptions): Promise<Document | null> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.findOne(filter, options)
  }

  /**
   * Find documents
   */
  async find(collection: string, options?: FindOptions): Promise<Document[]> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.find(options)
  }

  /**
   * Update one document
   */
  async updateOne(
    collection: string,
    filter: MongoFilter,
    update: MongoUpdate,
    options?: { upsert?: boolean }
  ): Promise<UpdateResult> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.updateOne(filter, update, options)
  }

  /**
   * Update many documents
   */
  async updateMany(
    collection: string,
    filter: MongoFilter,
    update: MongoUpdate,
    options?: { upsert?: boolean }
  ): Promise<UpdateResult> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.updateMany(filter, update, options)
  }

  /**
   * Replace one document
   */
  async replaceOne(
    collection: string,
    filter: MongoFilter,
    replacement: Document,
    options?: { upsert?: boolean }
  ): Promise<UpdateResult> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.replaceOne(filter, replacement, options)
  }

  /**
   * Delete one document
   */
  async deleteOne(collection: string, filter: MongoFilter): Promise<DeleteResult> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.deleteOne(filter)
  }

  /**
   * Delete many documents
   */
  async deleteMany(collection: string, filter: MongoFilter): Promise<DeleteResult> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.deleteMany(filter)
  }

  /**
   * Find and update
   */
  async findOneAndUpdate(
    collection: string,
    filter: MongoFilter,
    update: MongoUpdate,
    options?: { upsert?: boolean; returnDocument?: 'before' | 'after' }
  ): Promise<Document | null> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.findOneAndUpdate(filter, update, options)
  }

  /**
   * Find and delete
   */
  async findOneAndDelete(collection: string, filter: MongoFilter): Promise<Document | null> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.findOneAndDelete(filter)
  }

  /**
   * Find and replace
   */
  async findOneAndReplace(
    collection: string,
    filter: MongoFilter,
    replacement: Document,
    options?: { upsert?: boolean; returnDocument?: 'before' | 'after' }
  ): Promise<Document | null> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.findOneAndReplace(filter, replacement, options)
  }

  /**
   * Aggregate
   */
  async aggregate(collection: string, pipeline: AggregationStage[]): Promise<Document[]> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO

    // Create lookup resolver for cross-collection lookups
    const lookupResolver: LookupResolver = async (fromCollection: string, filter: MongoFilter) => {
      await this.ensureCollection(fromCollection)
      const fromStub = this.getCollectionStub(fromCollection) as unknown as CollectionDO
      return fromStub.find({ filter })
    }

    return stub.aggregate(pipeline, lookupResolver)
  }

  /**
   * Count documents
   */
  async countDocuments(collection: string, filter?: MongoFilter): Promise<number> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.countDocuments(filter)
  }

  /**
   * Estimated document count
   */
  async estimatedDocumentCount(collection: string): Promise<number> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.estimatedDocumentCount()
  }

  /**
   * Distinct values
   */
  async distinct(collection: string, field: string, filter?: MongoFilter): Promise<unknown[]> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.distinct(field, filter)
  }

  /**
   * Create index
   */
  async createIndex(
    collection: string,
    keys: Record<string, 1 | -1>,
    options?: { name?: string; unique?: boolean; sparse?: boolean }
  ): Promise<string> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.createIndex(keys, options)
  }

  /**
   * Drop index
   */
  async dropIndex(collection: string, name: string): Promise<void> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.dropIndex(name)
  }

  /**
   * List indexes
   */
  async listIndexes(collection: string): Promise<IndexInfo[]> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.listIndexes()
  }

  /**
   * Bulk write
   */
  async bulkWrite(collection: string, operations: BulkOperation[]): Promise<BulkWriteResult> {
    await this.ensureCollection(collection)
    const stub = this.getCollectionStub(collection) as unknown as CollectionDO
    return stub.bulkWrite(operations)
  }
}

// ============================================================================
// Admin Operations
// ============================================================================

export class Admin {
  private env: Env
  private dbNamespaces: Map<string, DurableObjectStub> = new Map()

  constructor(env: Env) {
    this.env = env
  }

  /**
   * Get database stub
   */
  private getDbStub(dbName: string): DurableObjectStub {
    if (!this.dbNamespaces.has(dbName)) {
      const ns = this.env.MONGO_DO as DurableObjectNamespace
      const id = ns.idFromName(dbName)
      this.dbNamespaces.set(dbName, ns.get(id))
    }
    return this.dbNamespaces.get(dbName)!
  }

  /**
   * List databases
   */
  async listDatabases(): Promise<{
    databases: DbInfo[]
    totalSize: number
    ok: number
  }> {
    // In a real implementation, we'd need to track databases
    // For now, return empty list
    return {
      databases: [],
      totalSize: 0,
      ok: 1,
    }
  }

  /**
   * Server info
   */
  async serverInfo(): Promise<ServerInfo> {
    return {
      version: '7.0.0-compat',
      gitVersion: 'dotdo-compat-layer',
      modules: [],
      allocator: 'cloudflare',
      javascriptEngine: 'v8',
      sysInfo: 'Cloudflare Workers + Durable Objects',
      versionArray: [7, 0, 0, 0],
      ok: 1,
    }
  }

  /**
   * Ping
   */
  async ping(): Promise<{ ok: number }> {
    return { ok: 1 }
  }
}
