/**
 * @dotdo/payload - Test Harness for Payload Adapter
 *
 * Test utilities following the testing/do.ts pattern for TDD workflow
 * with the Payload database adapter.
 *
 * @module compat/payload/testing
 */

import { vi } from 'vitest'
import type {
  PayloadAdapter,
  PayloadAdapterConfig,
  PayloadThingData,
  PayloadFieldDefinition,
  PayloadWhereClause,
  ThingsQuery,
  PayloadDocument,
  PayloadTransaction,
  TransactionOperation,
  PaginatedDocs,
} from './types'
import type { ThingData } from '../../types/Thing'
import type { MockDurableObjectStorage, MockSqlStorage, SqlOperation } from '../../tests/harness/do'
import { createMockStorage, createMockId, createMockState } from '../../tests/harness/do'

// ============================================================================
// MOCK PAYLOAD CONFIGURATION
// ============================================================================

/**
 * Default test configuration for the adapter
 */
export const DEFAULT_TEST_CONFIG: PayloadAdapterConfig = {
  ns: 'https://test.payload.do',
  softDelete: true,
  defaultVisibility: 'user',
  versioning: true,
  typePrefix: '',
  gitSync: false,
}

/**
 * Options for creating a mock adapter
 */
export interface MockAdapterOptions {
  /** Custom configuration overrides */
  config?: Partial<PayloadAdapterConfig>

  /** Pre-populated collections data */
  collections?: Record<string, PayloadDocument[]>

  /** Pre-populated globals data */
  globals?: Record<string, PayloadDocument>

  /** Pre-populated versions data */
  versions?: PayloadDocument[]

  /** Initial SQL data for Things tables */
  sqlData?: Map<string, unknown[]>
}

// ============================================================================
// MOCK ADAPTER RESULT
// ============================================================================

/**
 * Result of creating a mock adapter
 */
export interface MockAdapterResult {
  /** The mock adapter instance */
  adapter: MockPayloadAdapter

  /** Direct access to mock storage */
  storage: MockDurableObjectStorage

  /** SQL data tables */
  sqlData: Map<string, unknown[]>

  /** Tracked operations for assertions */
  operations: AdapterOperation[]

  /** Reset all tracking and optionally clear data */
  reset: (options?: { clearData?: boolean }) => void

  /** Assert an operation occurred */
  expectOperation: (type: string, collection?: string, id?: string) => void

  /** Get all operations of a specific type */
  getOperations: (type: string) => AdapterOperation[]
}

/**
 * Tracked adapter operation
 */
export interface AdapterOperation {
  type: string
  collection?: string
  id?: string | number
  data?: Record<string, unknown>
  where?: PayloadWhereClause
  timestamp: number
}

// ============================================================================
// MOCK ADAPTER IMPLEMENTATION
// ============================================================================

/**
 * Mock Payload adapter for testing
 *
 * Provides a fully functional mock of the PayloadAdapter interface
 * with operation tracking for test assertions.
 */
export class MockPayloadAdapter implements Partial<PayloadAdapter> {
  name = 'dotdo' as const
  packageName = '@dotdo/payload' as const
  defaultIDType = 'text' as const
  allowIDOnCreate = true as const

  config: PayloadAdapterConfig
  collections = new Map<string, MockThingsStore>()
  globals: MockThingsStore
  versions: MockThingsStore

  // Internal tracking
  private _operations: AdapterOperation[] = []
  private _storage: MockDurableObjectStorage
  private _sqlData: Map<string, unknown[]>
  private _transactions = new Map<string, PayloadTransaction>()
  private _idCounter = 0

  // Payload instance reference
  payload: unknown = null
  sessions: Record<string, unknown> = {}
  migrationDir = './migrations'

  constructor(
    storage: MockDurableObjectStorage,
    sqlData: Map<string, unknown[]>,
    options: MockAdapterOptions = {}
  ) {
    this._storage = storage
    this._sqlData = sqlData
    this.config = { ...DEFAULT_TEST_CONFIG, ...options.config }

    // Initialize stores
    this.globals = new MockThingsStore('_globals', this)
    this.versions = new MockThingsStore('_versions', this)

    // Pre-populate collections
    if (options.collections) {
      Object.entries(options.collections).forEach(([name, docs]) => {
        const store = new MockThingsStore(name, this)
        docs.forEach((doc) => store._data.set(String(doc.id), doc))
        this.collections.set(name, store)
      })
    }

    // Pre-populate globals
    if (options.globals) {
      Object.entries(options.globals).forEach(([slug, doc]) => {
        this.globals._data.set(slug, doc)
      })
    }

    // Pre-populate versions
    if (options.versions) {
      options.versions.forEach((v) => {
        this.versions._data.set(String(v.id), v)
      })
    }
  }

  // -------------------------------------------------------------------------
  // Operation tracking
  // -------------------------------------------------------------------------

  get operations(): AdapterOperation[] {
    return this._operations
  }

  private track(op: Omit<AdapterOperation, 'timestamp'>): void {
    this._operations.push({ ...op, timestamp: Date.now() })
  }

  clearTracking(): void {
    this._operations = []
  }

  // -------------------------------------------------------------------------
  // ID generation
  // -------------------------------------------------------------------------

  generateId(): string {
    if (this.config.idGenerator) {
      return this.config.idGenerator()
    }
    return `test-${++this._idCounter}`
  }

  // -------------------------------------------------------------------------
  // Type URL helpers
  // -------------------------------------------------------------------------

  getTypeUrl(collection: string): string {
    const prefix = this.config.typePrefix || ''
    const ns = this.config.ns || 'https://payload.do'
    return `${ns}/${prefix}${collection}`
  }

  getThingId(collection: string, id: string | number): string {
    const ns = this.config.ns || 'https://payload.do'
    return `${ns}/${collection}/${id}`
  }

  // -------------------------------------------------------------------------
  // Transform helpers
  // -------------------------------------------------------------------------

  toThing(collection: string, doc: Record<string, unknown>): PayloadThingData {
    const id = doc.id as string | number
    const now = new Date()

    return {
      $id: this.getThingId(collection, id),
      $type: this.getTypeUrl(collection),
      name: (doc.title as string) || (doc.name as string) || String(id),
      data: { ...doc },
      visibility: this.config.defaultVisibility || 'user',
      createdAt: doc.createdAt ? new Date(doc.createdAt as string) : now,
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt as string) : now,
      _collection: collection,
      _payloadId: id,
    }
  }

  fromThing(thing: PayloadThingData): Record<string, unknown> {
    const doc = { ...thing.data }
    doc.id = thing._payloadId || thing.$id.split('/').pop()
    doc.createdAt = thing.createdAt?.toISOString()
    doc.updatedAt = thing.updatedAt?.toISOString()
    return doc
  }

  translateWhere(where: PayloadWhereClause, _collection: string): import('./types').ThingsWhereClause {
    // Basic translation for testing
    const firstKey = Object.keys(where).find((k) => k !== 'and' && k !== 'or')
    if (!firstKey) {
      return { field: 'id', operator: 'eq', value: null }
    }

    const condition = where[firstKey] as Record<string, unknown>
    if (typeof condition === 'object' && condition !== null) {
      if ('equals' in condition) {
        return { field: firstKey, operator: 'eq', value: condition.equals }
      }
      if ('not_equals' in condition) {
        return { field: firstKey, operator: 'ne', value: condition.not_equals }
      }
      if ('greater_than' in condition) {
        return { field: firstKey, operator: 'gt', value: condition.greater_than }
      }
      if ('less_than' in condition) {
        return { field: firstKey, operator: 'lt', value: condition.less_than }
      }
      if ('in' in condition) {
        return { field: firstKey, operator: 'in', value: condition.in }
      }
      if ('like' in condition) {
        return { field: firstKey, operator: 'like', value: condition.like }
      }
      if ('contains' in condition) {
        return { field: firstKey, operator: 'ilike', value: `%${condition.contains}%` }
      }
    }

    return { field: firstKey, operator: 'eq', value: condition }
  }

  // -------------------------------------------------------------------------
  // Connection methods
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    this.track({ type: 'connect' })
  }

  async destroy(): Promise<void> {
    this.track({ type: 'destroy' })
    this.collections.clear()
  }

  async init(): Promise<void> {
    this.track({ type: 'init' })
  }

  // -------------------------------------------------------------------------
  // Transaction methods
  // -------------------------------------------------------------------------

  async beginTransaction(): Promise<string> {
    const id = `tx-${Date.now()}`
    this._transactions.set(id, {
      id,
      operations: [],
      state: 'pending',
      startedAt: new Date(),
    })
    this.track({ type: 'beginTransaction', id })
    return id
  }

  async commitTransaction(id: string | number | Promise<string | number>): Promise<void> {
    const txId = String(await id)
    const tx = this._transactions.get(txId)
    if (tx) {
      tx.state = 'committed'
    }
    this.track({ type: 'commitTransaction', id: txId })
  }

  async rollbackTransaction(id: string | number | Promise<string | number>): Promise<void> {
    const txId = String(await id)
    const tx = this._transactions.get(txId)
    if (tx) {
      tx.state = 'rolled_back'
      // Rollback operations in reverse order
      for (let i = tx.operations.length - 1; i >= 0; i--) {
        const op = tx.operations[i]!
        if (op.type === 'create' && op.previousData === undefined) {
          // Delete created document
          const store = this.collections.get(op.collection)
          store?._data.delete(op.id)
        } else if (op.type === 'update' && op.previousData) {
          // Restore previous data
          const store = this.collections.get(op.collection)
          store?._data.set(op.id, op.previousData as PayloadDocument)
        } else if (op.type === 'delete' && op.previousData) {
          // Restore deleted document
          const store = this.collections.get(op.collection)
          store?._data.set(op.id, op.previousData as PayloadDocument)
        }
      }
    }
    this.track({ type: 'rollbackTransaction', id: txId })
  }

  // -------------------------------------------------------------------------
  // CRUD operations
  // -------------------------------------------------------------------------

  async create(args: import('./types').CreateArgs): Promise<PayloadDocument> {
    const { collection, data } = args
    const id = (data.id as string) || this.generateId()

    const doc: PayloadDocument = {
      ...data,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    let store = this.collections.get(collection)
    if (!store) {
      store = new MockThingsStore(collection, this)
      this.collections.set(collection, store)
    }
    store._data.set(String(id), doc)

    this.track({ type: 'create', collection, id, data: doc })
    return doc
  }

  async findOne(args: import('./types').FindOneArgs): Promise<PayloadDocument | null> {
    const { collection, where } = args
    this.track({ type: 'findOne', collection, where })

    const store = this.collections.get(collection)
    if (!store) return null

    if (where) {
      // Simple ID lookup
      const idField = where.id as Record<string, unknown> | undefined
      if (idField?.equals) {
        return store._data.get(String(idField.equals)) || null
      }

      // Filter through all documents
      for (const doc of store._data.values()) {
        if (this.matchesWhere(doc, where)) {
          return doc
        }
      }
    }

    return null
  }

  async find(args: import('./types').FindArgs): Promise<PaginatedDocs<PayloadDocument>> {
    const { collection, where, limit = 10, page = 1 } = args
    this.track({ type: 'find', collection, where })

    const store = this.collections.get(collection)
    const allDocs = store ? Array.from(store._data.values()) : []

    let docs = allDocs
    if (where) {
      docs = allDocs.filter((doc) => this.matchesWhere(doc, where))
    }

    const totalDocs = docs.length
    const totalPages = Math.ceil(totalDocs / limit)
    const offset = (page - 1) * limit
    const paginatedDocs = docs.slice(offset, offset + limit)

    return {
      docs: paginatedDocs,
      totalDocs,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      pagingCounter: offset + 1,
    }
  }

  async count(args: import('./types').CountArgs): Promise<{ totalDocs: number }> {
    const { collection, where } = args
    this.track({ type: 'count', collection, where })

    const store = this.collections.get(collection)
    if (!store) return { totalDocs: 0 }

    if (!where) {
      return { totalDocs: store._data.size }
    }

    let count = 0
    for (const doc of store._data.values()) {
      if (this.matchesWhere(doc, where)) count++
    }

    return { totalDocs: count }
  }

  async updateOne(args: import('./types').UpdateOneArgs): Promise<PayloadDocument> {
    const { collection, data, id, where } = args

    let docId: string | undefined
    if (id !== undefined) {
      docId = String(id)
    } else if (where) {
      const found = await this.findOne({ collection, where })
      if (found) docId = String(found.id)
    }

    if (!docId) {
      throw new Error(`Document not found in ${collection}`)
    }

    const store = this.collections.get(collection)
    const existing = store?._data.get(docId)

    if (!existing) {
      throw new Error(`Document ${docId} not found in ${collection}`)
    }

    const updated: PayloadDocument = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }

    store!._data.set(docId, updated)
    this.track({ type: 'updateOne', collection, id: docId, data: updated })

    return updated
  }

  async updateMany(args: import('./types').UpdateManyArgs): Promise<PayloadDocument[] | null> {
    const { collection, data, where, limit } = args
    this.track({ type: 'updateMany', collection, where })

    const store = this.collections.get(collection)
    if (!store) return null

    const updated: PayloadDocument[] = []
    let count = 0

    for (const [id, doc] of store._data.entries()) {
      if (limit && count >= limit) break

      if (this.matchesWhere(doc, where)) {
        const updatedDoc: PayloadDocument = {
          ...doc,
          ...data,
          id: doc.id,
          createdAt: doc.createdAt,
          updatedAt: new Date().toISOString(),
        }
        store._data.set(id, updatedDoc)
        updated.push(updatedDoc)
        count++
      }
    }

    return updated
  }

  async deleteOne(args: import('./types').DeleteOneArgs): Promise<PayloadDocument> {
    const { collection, where } = args
    this.track({ type: 'deleteOne', collection, where })

    const store = this.collections.get(collection)
    if (!store) {
      throw new Error(`Collection ${collection} not found`)
    }

    for (const [id, doc] of store._data.entries()) {
      if (this.matchesWhere(doc, where)) {
        if (this.config.softDelete) {
          const deleted: PayloadDocument = {
            ...doc,
            _deleted: true,
            updatedAt: new Date().toISOString(),
          }
          store._data.set(id, deleted)
          return deleted
        } else {
          store._data.delete(id)
          return doc
        }
      }
    }

    throw new Error(`Document not found in ${collection}`)
  }

  async deleteMany(args: import('./types').DeleteManyArgs): Promise<void> {
    const { collection, where } = args
    this.track({ type: 'deleteMany', collection, where })

    const store = this.collections.get(collection)
    if (!store) return

    const toDelete: string[] = []
    for (const [id, doc] of store._data.entries()) {
      if (this.matchesWhere(doc, where)) {
        toDelete.push(id)
      }
    }

    for (const id of toDelete) {
      if (this.config.softDelete) {
        const doc = store._data.get(id)!
        store._data.set(id, { ...doc, _deleted: true })
      } else {
        store._data.delete(id)
      }
    }
  }

  async upsert(args: import('./types').UpsertArgs): Promise<PayloadDocument> {
    const { collection, data, where } = args
    this.track({ type: 'upsert', collection, where })

    const existing = await this.findOne({ collection, where })
    if (existing) {
      return this.updateOne({ collection, data, id: existing.id })
    } else {
      return this.create({ collection, data })
    }
  }

  // -------------------------------------------------------------------------
  // Query drafts
  // -------------------------------------------------------------------------

  async queryDrafts(args: import('./types').QueryDraftsArgs): Promise<PaginatedDocs<PayloadDocument>> {
    this.track({ type: 'queryDrafts', collection: args.collection, where: args.where })
    // For now, return regular find results filtered by _draft
    const result = await this.find(args)
    result.docs = result.docs.filter((d) => (d as Record<string, unknown>)._draft === true)
    return result
  }

  async findDistinct(args: import('./types').FindDistinctArgs): Promise<import('./types').PaginatedDistinctDocs<Record<string, unknown>>> {
    const { collection, field, where, limit = 10, page = 1 } = args
    this.track({ type: 'findDistinct', collection })

    const store = this.collections.get(collection)
    if (!store) {
      return {
        values: [],
        totalDocs: 0,
        totalPages: 0,
        page: 1,
        limit,
        hasNextPage: false,
        hasPrevPage: false,
        pagingCounter: 1,
      }
    }

    const distinctValues = new Set<unknown>()
    for (const doc of store._data.values()) {
      if (!where || this.matchesWhere(doc, where)) {
        const value = (doc as Record<string, unknown>)[field]
        if (value !== undefined) {
          distinctValues.add(value)
        }
      }
    }

    const allValues = Array.from(distinctValues).map((v) => ({ [field]: v }))
    const totalDocs = allValues.length
    const totalPages = Math.ceil(totalDocs / limit)
    const offset = (page - 1) * limit

    return {
      values: allValues.slice(offset, offset + limit),
      totalDocs,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      pagingCounter: offset + 1,
    }
  }

  // -------------------------------------------------------------------------
  // Version operations
  // -------------------------------------------------------------------------

  async findVersions(args: import('./types').FindVersionsArgs): Promise<PaginatedDocs<import('./types').PayloadVersionMeta & { version: PayloadDocument }>> {
    const { collection, where, limit = 10, page = 1 } = args
    this.track({ type: 'findVersions', collection, where })

    // Filter versions by collection
    const allVersions = Array.from(this.versions._data.values())
      .filter((v) => (v as Record<string, unknown>)._collection === collection)

    let versions = allVersions
    if (where) {
      versions = allVersions.filter((v) => this.matchesWhere(v, where))
    }

    const totalDocs = versions.length
    const totalPages = Math.ceil(totalDocs / limit)
    const offset = (page - 1) * limit

    return {
      docs: versions.slice(offset, offset + limit).map((v) => ({
        id: String((v as Record<string, unknown>).id),
        parent: (v as Record<string, unknown>)._parent as string,
        versionNumber: (v as Record<string, unknown>)._version as number,
        createdAt: String((v as Record<string, unknown>).createdAt),
        updatedAt: String((v as Record<string, unknown>).updatedAt),
        version: v as PayloadDocument,
      })) as Array<import('./types').PayloadVersionMeta & { version: PayloadDocument }>,
      totalDocs,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      pagingCounter: offset + 1,
    }
  }

  async createVersion(args: import('./types').CreateVersionArgs<Record<string, unknown>>): Promise<import('./types').PayloadVersionMeta & { version: Record<string, unknown> }> {
    const { collectionSlug, parent, versionData, autosave, createdAt, updatedAt } = args
    this.track({ type: 'createVersion', collection: collectionSlug, id: parent })

    const id = this.generateId()
    const version: PayloadDocument = {
      id,
      _collection: collectionSlug,
      _parent: String(parent),
      _autosave: autosave,
      ...versionData,
      createdAt,
      updatedAt,
    }

    this.versions._data.set(id, version)

    return {
      id,
      parent: String(parent),
      createdAt,
      updatedAt,
      autosave,
      version: versionData,
    }
  }

  async updateVersion(args: import('./types').UpdateVersionArgs<Record<string, unknown>>): Promise<import('./types').PayloadVersionMeta & { version: Record<string, unknown> }> {
    const { collection, versionData, id } = args
    this.track({ type: 'updateVersion', collection, id })

    const existing = this.versions._data.get(String(id))
    if (!existing) {
      throw new Error(`Version ${id} not found`)
    }

    const updated: PayloadDocument = {
      ...existing,
      ...versionData.version,
      updatedAt: new Date().toISOString(),
    }
    this.versions._data.set(String(id), updated)

    return {
      id: String(id),
      parent: String(versionData.parent || (existing as Record<string, unknown>)._parent),
      version: versionData.version as Record<string, unknown>,
      createdAt: String((existing as Record<string, unknown>).createdAt),
      updatedAt: new Date().toISOString(),
    }
  }

  async deleteVersions(args: import('./types').DeleteVersionsArgs): Promise<void> {
    const { collection, where } = args
    this.track({ type: 'deleteVersions', collection, where })

    const toDelete: string[] = []
    for (const [id, v] of this.versions._data.entries()) {
      const rec = v as Record<string, unknown>
      if (rec._collection === collection && (!where || this.matchesWhere(v, where))) {
        toDelete.push(id)
      }
    }

    for (const id of toDelete) {
      this.versions._data.delete(id)
    }
  }

  async countVersions(args: import('./types').CountArgs): Promise<{ totalDocs: number }> {
    const { collection, where } = args
    this.track({ type: 'countVersions', collection, where })

    let count = 0
    for (const v of this.versions._data.values()) {
      const rec = v as Record<string, unknown>
      if (rec._collection === collection && (!where || this.matchesWhere(v, where))) {
        count++
      }
    }

    return { totalDocs: count }
  }

  // -------------------------------------------------------------------------
  // Global operations
  // -------------------------------------------------------------------------

  async findGlobal(args: import('./types').FindGlobalArgs): Promise<PayloadDocument> {
    const { slug } = args
    this.track({ type: 'findGlobal', id: slug })

    const global = this.globals._data.get(slug)
    if (!global) {
      // Return empty global
      return { id: slug, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    }
    return global
  }

  async createGlobal(args: import('./types').CreateGlobalArgs): Promise<PayloadDocument> {
    const { slug, data } = args
    this.track({ type: 'createGlobal', id: slug })

    const doc: PayloadDocument = {
      ...data,
      id: slug,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.globals._data.set(slug, doc)
    return doc
  }

  async updateGlobal(args: import('./types').UpdateGlobalArgs): Promise<PayloadDocument> {
    const { slug, data } = args
    this.track({ type: 'updateGlobal', id: slug })

    const existing = this.globals._data.get(slug) || {
      id: slug,
      createdAt: new Date().toISOString(),
    }

    const updated: PayloadDocument = {
      ...existing,
      ...data,
      id: slug,
      updatedAt: new Date().toISOString(),
    }

    this.globals._data.set(slug, updated)
    return updated
  }

  async findGlobalVersions(args: import('./types').FindGlobalVersionsArgs): Promise<PaginatedDocs<import('./types').PayloadVersionMeta & { version: PayloadDocument }>> {
    const { global } = args
    this.track({ type: 'findGlobalVersions', id: global })

    // Filter global versions
    const versions = Array.from(this.versions._data.values())
      .filter((v) => (v as Record<string, unknown>)._global === global)

    return {
      docs: versions.map((v) => ({
        id: String((v as Record<string, unknown>).id),
        parent: global,
        versionNumber: (v as Record<string, unknown>)._version as number,
        createdAt: String((v as Record<string, unknown>).createdAt),
        updatedAt: String((v as Record<string, unknown>).updatedAt),
        version: v as PayloadDocument,
      })) as Array<import('./types').PayloadVersionMeta & { version: PayloadDocument }>,
      totalDocs: versions.length,
      totalPages: 1,
      page: 1,
      limit: versions.length,
      hasNextPage: false,
      hasPrevPage: false,
      pagingCounter: 1,
    }
  }

  async createGlobalVersion(args: import('./types').CreateGlobalVersionArgs<Record<string, unknown>>): Promise<Omit<import('./types').PayloadVersionMeta, 'parent'> & { version: Record<string, unknown> }> {
    const { globalSlug, versionData, autosave, createdAt, updatedAt } = args
    this.track({ type: 'createGlobalVersion', id: globalSlug })

    const id = this.generateId()
    const version: PayloadDocument = {
      id,
      _global: globalSlug,
      _autosave: autosave,
      ...versionData,
      createdAt,
      updatedAt,
    }

    this.versions._data.set(id, version)

    return {
      id,
      createdAt,
      updatedAt,
      autosave,
      version: versionData,
    }
  }

  async updateGlobalVersion(args: import('./types').UpdateGlobalVersionArgs<Record<string, unknown>>): Promise<import('./types').PayloadVersionMeta & { version: Record<string, unknown> }> {
    const { global, versionData, id } = args
    this.track({ type: 'updateGlobalVersion', id: global })

    const existing = this.versions._data.get(String(id))
    if (!existing) {
      throw new Error(`Global version ${id} not found`)
    }

    const updated: PayloadDocument = {
      ...existing,
      ...versionData.version,
      updatedAt: new Date().toISOString(),
    }
    this.versions._data.set(String(id), updated)

    return {
      id: String(id),
      parent: global,
      version: versionData.version as Record<string, unknown>,
      createdAt: String((existing as Record<string, unknown>).createdAt),
      updatedAt: new Date().toISOString(),
    }
  }

  async countGlobalVersions(args: import('./types').CountGlobalVersionArgs): Promise<{ totalDocs: number }> {
    const { global, where } = args
    this.track({ type: 'countGlobalVersions', id: global })

    let count = 0
    for (const v of this.versions._data.values()) {
      const rec = v as Record<string, unknown>
      if (rec._global === global && (!where || this.matchesWhere(v, where))) {
        count++
      }
    }

    return { totalDocs: count }
  }

  // -------------------------------------------------------------------------
  // Migration operations (stubs for testing)
  // -------------------------------------------------------------------------

  async migrate(): Promise<void> {
    this.track({ type: 'migrate' })
  }

  async migrateDown(): Promise<void> {
    this.track({ type: 'migrateDown' })
  }

  async migrateFresh(): Promise<void> {
    this.track({ type: 'migrateFresh' })
    // Clear all data
    this.collections.clear()
    this.globals._data.clear()
    this.versions._data.clear()
  }

  async migrateRefresh(): Promise<void> {
    this.track({ type: 'migrateRefresh' })
  }

  async migrateReset(): Promise<void> {
    this.track({ type: 'migrateReset' })
  }

  async migrateStatus(): Promise<void> {
    this.track({ type: 'migrateStatus' })
  }

  async createMigration(): Promise<void> {
    this.track({ type: 'createMigration' })
  }

  async updateJobs(): Promise<null> {
    this.track({ type: 'updateJobs' })
    return null
  }

  // -------------------------------------------------------------------------
  // Helper: match WHERE clause
  // -------------------------------------------------------------------------

  private matchesWhere(doc: PayloadDocument, where: PayloadWhereClause): boolean {
    // Handle AND
    if (where.and) {
      return where.and.every((clause) => this.matchesWhere(doc, clause))
    }

    // Handle OR
    if (where.or) {
      return where.or.some((clause) => this.matchesWhere(doc, clause))
    }

    // Handle field conditions
    for (const [field, condition] of Object.entries(where)) {
      if (field === 'and' || field === 'or') continue

      const value = (doc as Record<string, unknown>)[field]
      const cond = condition as Record<string, unknown>

      if (cond.equals !== undefined && value !== cond.equals) return false
      if (cond.not_equals !== undefined && value === cond.not_equals) return false
      if (cond.greater_than !== undefined && !(Number(value) > Number(cond.greater_than))) return false
      if (cond.less_than !== undefined && !(Number(value) < Number(cond.less_than))) return false
      if (cond.greater_than_equal !== undefined && !(Number(value) >= Number(cond.greater_than_equal))) return false
      if (cond.less_than_equal !== undefined && !(Number(value) <= Number(cond.less_than_equal))) return false
      if (cond.in !== undefined && !Array.isArray(cond.in)) return false
      if (cond.in !== undefined && !(cond.in as unknown[]).includes(value)) return false
      if (cond.not_in !== undefined && (cond.not_in as unknown[]).includes(value)) return false
      if (cond.like !== undefined && typeof value === 'string' && !value.includes(String(cond.like))) return false
      if (cond.contains !== undefined && typeof value === 'string' && !value.toLowerCase().includes(String(cond.contains).toLowerCase())) return false
      if (cond.exists !== undefined && (cond.exists ? value === undefined : value !== undefined)) return false
    }

    return true
  }
}

/**
 * Mock Things store for adapter testing
 */
class MockThingsStore {
  _data = new Map<string, PayloadDocument>()

  constructor(
    public name: string,
    private adapter: MockPayloadAdapter
  ) {}
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a mock Payload adapter for testing
 *
 * @param options - Configuration options
 * @returns Mock adapter with testing utilities
 *
 * @example
 * ```typescript
 * import { createMockPayloadAdapter } from '@dotdo/payload/testing'
 *
 * describe('Payload Adapter', () => {
 *   it('should create documents', async () => {
 *     const { adapter, expectOperation } = createMockPayloadAdapter()
 *
 *     const doc = await adapter.create({
 *       collection: 'posts',
 *       data: { title: 'Hello World' }
 *     })
 *
 *     expect(doc.id).toBeDefined()
 *     expect(doc.title).toBe('Hello World')
 *     expectOperation('create', 'posts')
 *   })
 * })
 * ```
 */
export function createMockPayloadAdapter(options: MockAdapterOptions = {}): MockAdapterResult {
  // Initialize SQL data with defaults
  const sqlData = options.sqlData ?? new Map<string, unknown[]>()
  const defaultTables = ['things', 'relationships', 'branches', 'actions', 'events']
  for (const table of defaultTables) {
    if (!sqlData.has(table)) {
      sqlData.set(table, [])
    }
  }

  // Create mock storage
  const storage = createMockStorage(undefined, sqlData)

  // Create adapter
  const adapter = new MockPayloadAdapter(storage, sqlData, options)

  // Helper functions
  function reset(opts?: { clearData?: boolean }): void {
    adapter.clearTracking()
    storage.clearTracking()

    if (opts?.clearData) {
      adapter.collections.clear()
      adapter.globals._data.clear()
      adapter.versions._data.clear()
    }
  }

  function expectOperation(type: string, collection?: string, id?: string): void {
    const found = adapter.operations.some(
      (op) =>
        op.type === type &&
        (collection === undefined || op.collection === collection) &&
        (id === undefined || String(op.id) === id)
    )

    if (!found) {
      const actual = adapter.operations.map((op) => `${op.type}:${op.collection || ''}:${op.id || ''}`).join(', ')
      throw new Error(
        `Expected operation "${type}"${collection ? ` on "${collection}"` : ''}${id ? ` with id "${id}"` : ''} not found. ` +
          `Actual operations: [${actual}]`
      )
    }
  }

  function getOperations(type: string): AdapterOperation[] {
    return adapter.operations.filter((op) => op.type === type)
  }

  return {
    adapter,
    storage,
    sqlData,
    operations: adapter.operations,
    reset,
    expectOperation,
    getOperations,
  }
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Standard test fixtures for Payload adapter tests
 */
export const FIXTURES = {
  /**
   * Simple post document
   */
  simplePost: {
    id: 'post-1',
    title: 'Test Post',
    content: 'This is test content',
    status: 'draft',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as PayloadDocument,

  /**
   * User document with relationships
   */
  user: {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as PayloadDocument,

  /**
   * Post with relationship to user
   */
  postWithAuthor: {
    id: 'post-2',
    title: 'Post with Author',
    content: 'Content here',
    author: 'user-1',
    status: 'published',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as PayloadDocument,

  /**
   * Multiple posts for pagination tests
   */
  manyPosts: Array.from({ length: 25 }, (_, i) => ({
    id: `post-${i + 1}`,
    title: `Post ${i + 1}`,
    content: `Content for post ${i + 1}`,
    status: i % 3 === 0 ? 'draft' : 'published',
    order: i,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  })) as PayloadDocument[],

  /**
   * Global settings document
   */
  settings: {
    id: 'settings',
    siteName: 'Test Site',
    siteUrl: 'https://test.example.com',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as PayloadDocument,
} as const

/**
 * Create a collection with fixtures pre-loaded
 */
export function createCollectionWithFixtures(
  fixtureName: keyof typeof FIXTURES
): Record<string, PayloadDocument[]> {
  const fixture = FIXTURES[fixtureName]
  if (Array.isArray(fixture)) {
    return { posts: fixture }
  }
  if (fixtureName === 'user') {
    return { users: [fixture] }
  }
  if (fixtureName === 'settings') {
    return {} // Settings is a global, not a collection
  }
  return { posts: [fixture] }
}

// ============================================================================
// FIELD DEFINITION HELPERS
// ============================================================================

/**
 * Create a simple field definition for testing
 */
export function createFieldDefinition(
  name: string,
  type: import('./types').PayloadFieldType,
  options: Partial<PayloadFieldDefinition> = {}
): PayloadFieldDefinition {
  return {
    name,
    type,
    ...options,
  }
}

/**
 * Create a relationship field definition
 */
export function createRelationshipField(
  name: string,
  relationTo: string | string[],
  hasMany = false
): PayloadFieldDefinition {
  return {
    name,
    type: 'relationship',
    relationTo,
    hasMany,
  }
}

/**
 * Standard collection field definitions for testing
 */
export const FIELD_DEFINITIONS = {
  posts: [
    createFieldDefinition('title', 'text', { required: true }),
    createFieldDefinition('content', 'richText'),
    createFieldDefinition('status', 'select'),
    createRelationshipField('author', 'users'),
    createFieldDefinition('publishedAt', 'date'),
  ],

  users: [
    createFieldDefinition('email', 'email', { required: true, unique: true }),
    createFieldDefinition('name', 'text'),
    createFieldDefinition('role', 'select'),
    createRelationshipField('posts', 'posts', true),
  ],

  media: [
    createFieldDefinition('filename', 'text', { required: true }),
    createFieldDefinition('mimeType', 'text'),
    createFieldDefinition('url', 'text'),
    createFieldDefinition('alt', 'text'),
  ],
} as const

export default createMockPayloadAdapter
