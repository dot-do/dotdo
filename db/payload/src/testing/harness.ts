/**
 * Payload Adapter Test Harness
 *
 * Provides mock adapter creation, operation tracking, seeding, and reset
 * functionality for testing the Payload database adapter.
 *
 * @module @dotdo/payload/testing/harness
 */

import type {
  PayloadDatabaseAdapter,
  PayloadDocument,
  PayloadCollection,
  PayloadField,
  PayloadAdapterConfig,
} from '../adapter/types'
import { slugToNounName, fieldNameToVerb } from '../adapter/types'
import type { NounData } from '../../../../types/Noun'
import type { ThingData } from '../../../../types/Thing'
import { create as createOperation } from '../adapter/operations/create'
import {
  find as findOperation,
  findOne as findOneOperation,
  type FindArgs,
  type FindOneArgs,
  type FindContext,
} from '../adapter/operations/find'
import {
  createVersion as createVersionOp,
  findVersions as findVersionsOp,
  findVersion as findVersionOp,
  restoreVersion as restoreVersionOp,
  deleteVersions as deleteVersionsOp,
  deleteAllVersions,
  updateVersion as updateVersionOp,
  type CreateVersionArgs,
  type FindVersionsArgs,
  type FindVersionArgs,
  type RestoreVersionArgs,
  type DeleteVersionsArgs,
  type VersionContext,
} from '../adapter/operations/versions'
import {
  updateOne as updateOneOperation,
  updateMany as updateManyOperation,
  type UpdateOneArgs,
  type UpdateManyArgs,
  type UpdateContext,
} from '../adapter/operations/update'
import {
  deleteOne as deleteOneOperation,
  deleteMany as deleteManyOperation,
  type DeleteOneArgs,
  type DeleteManyArgs,
  type DeleteContext,
} from '../adapter/operations/delete'
import {
  findGlobal as findGlobalOp,
  updateGlobal as updateGlobalOp,
  createGlobalVersion as createGlobalVersionOp,
  findGlobalVersions as findGlobalVersionsOp,
  restoreGlobalVersion as restoreGlobalVersionOp,
  getGlobals as getGlobalsOp,
  type FindGlobalArgs,
  type UpdateGlobalArgs,
  type CreateGlobalVersionArgs,
  type FindGlobalVersionsArgs,
  type RestoreGlobalVersionArgs,
  type GlobalContext,
} from '../adapter/operations/globals'
import {
  createTransactionManager,
  type Transaction,
  type Savepoint,
  type TransactionManager,
  type TransactionState_Internal,
} from '../adapter/operations/transactions'
import {
  createMigrationStore,
  registerMigrations,
  migrate as migrateOp,
  migrateStatus as migrateStatusOp,
  migrateDown as migrateDownOp,
  migrateRefresh as migrateRefreshOp,
  migrateFresh as migrateFreshOp,
  migrateCreate as migrateCreateOp,
  getMigrationHistory,
  getMigrationDir,
  setMigrationDir,
  getMigrationSearchPaths,
  setMigrationFiles,
  discoverMigrations,
  initSchema,
  isInTransaction,
  setLockHeld,
  on as onMigrationEvent,
  setMode,
  setSeedFunction,
  push,
  type Migration,
  type MigrationStore,
  type MigrateOptions,
  type MigrateDownOptions,
  type MigrateFreshOptions,
  type MigrateCreateOptions,
  type PushOptions,
  type MigrationFileInfo,
} from '../adapter/operations/migrations'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Tracked adapter operation
 */
export interface AdapterOperation {
  type: 'create' | 'find' | 'findOne' | 'update' | 'delete' | 'deleteMany' | 'updateMany' | 'count' | 'createVersion' | 'findVersions' | 'findVersion' | 'restoreVersion' | 'deleteVersions'
  collection: string
  data?: unknown
  where?: unknown
  id?: string
  error?: string
  timestamp: number
}

/**
 * Seed data structure - collection name to array of documents
 */
export type SeedData = Record<string, Array<Record<string, unknown>>>

/**
 * Configuration for creating a test harness
 */
export interface PayloadAdapterHarnessConfig {
  /** dotdo namespace URL */
  namespace?: string
  /** Optional branch context */
  branch?: string
  /** Initial seed data */
  seed?: SeedData
  /** Reset behavior: 'clear' removes all data, 'restore-seed' restores to seed state */
  resetBehavior?: 'clear' | 'restore-seed'
}

/**
 * Simple in-memory ThingsStore for testing
 */
export interface ThingsStore {
  get(id: string): ThingData | undefined
  list(options?: { type?: string }): ThingData[]
  create(data: Partial<ThingData> & { $id: string; $type: string }): ThingData
  update(id: string, data: Partial<ThingData>): ThingData | undefined
  delete(id: string): boolean
  clear(): void
}

/**
 * Simple in-memory RelationshipsStore for testing
 */
export interface RelationshipsStore {
  add(rel: { from: string; to: string; verb: string; data?: Record<string, unknown> }): void
  list(options?: { from?: string; to?: string; verb?: string }): Array<{
    from: string
    to: string
    verb: string
    data?: Record<string, unknown>
  }>
  remove(from: string, to: string, verb: string): boolean
  removeAll(from: string, verb?: string): number
  clear(): void
}

/**
 * Simple in-memory NounsStore for testing
 */
export interface NounsStore {
  get(noun: string): NounData | undefined
  set(noun: string, data: NounData): void
  list(): NounData[]
  clear(): void
}

/**
 * The test harness result
 */
export interface PayloadAdapterHarness {
  /** The mock Payload adapter instance */
  adapter: MockPayloadAdapter
  /** The underlying ThingsStore */
  things: ThingsStore
  /** The relationships store */
  relationships: RelationshipsStore
  /** The nouns store */
  nouns: NounsStore
  /** All tracked operations */
  operations: AdapterOperation[]
  /** The harness configuration */
  config: PayloadAdapterHarnessConfig
  /** Reset harness state */
  reset(options?: { hard?: boolean }): void
}

// ============================================================================
// MOCK STORES
// ============================================================================

function createThingsStore(): ThingsStore {
  const store = new Map<string, ThingData>()

  return {
    get(id: string): ThingData | undefined {
      return store.get(id)
    },

    list(options?: { type?: string }): ThingData[] {
      const all = Array.from(store.values())
      if (options?.type) {
        return all.filter((t) => t.$type === options.type)
      }
      return all
    },

    create(data: Partial<ThingData> & { $id: string; $type: string }): ThingData {
      const now = new Date()
      const thing: ThingData = {
        $id: data.$id,
        $type: data.$type,
        name: data.name,
        data: data.data,
        meta: data.meta,
        visibility: data.visibility,
        createdAt: data.createdAt ?? now,
        updatedAt: data.updatedAt ?? now,
      }
      store.set(data.$id, thing)
      return thing
    },

    update(id: string, data: Partial<ThingData>): ThingData | undefined {
      const existing = store.get(id)
      if (!existing) return undefined

      const updated: ThingData = {
        ...existing,
        ...data,
        $id: existing.$id,
        $type: existing.$type,
        updatedAt: new Date(),
      }
      store.set(id, updated)
      return updated
    },

    delete(id: string): boolean {
      return store.delete(id)
    },

    clear(): void {
      store.clear()
    },
  }
}

function createRelationshipsStore(): RelationshipsStore {
  const store: Array<{
    from: string
    to: string
    verb: string
    data?: Record<string, unknown>
  }> = []

  return {
    add(rel) {
      store.push({ ...rel })
    },

    list(options) {
      return store.filter((r) => {
        if (options?.from && r.from !== options.from) return false
        if (options?.to && r.to !== options.to) return false
        if (options?.verb && r.verb !== options.verb) return false
        return true
      })
    },

    remove(from, to, verb) {
      const idx = store.findIndex((r) => r.from === from && r.to === to && r.verb === verb)
      if (idx >= 0) {
        store.splice(idx, 1)
        return true
      }
      return false
    },

    removeAll(from, verb?) {
      let removed = 0
      for (let i = store.length - 1; i >= 0; i--) {
        if (store[i].from === from && (!verb || store[i].verb === verb)) {
          store.splice(i, 1)
          removed++
        }
      }
      return removed
    },

    clear() {
      store.length = 0
    },
  }
}

function createNounsStore(): NounsStore {
  const store = new Map<string, NounData>()

  return {
    get(noun: string): NounData | undefined {
      return store.get(noun)
    },

    set(noun: string, data: NounData): void {
      store.set(noun, data)
    },

    list(): NounData[] {
      return Array.from(store.values())
    },

    clear(): void {
      store.clear()
    },
  }
}

// ============================================================================
// MOCK ADAPTER
// ============================================================================

/**
 * Hooks for adapter operations
 */
export interface AdapterHooks {
  beforeCreate?: (args: { collection: string; data: Record<string, unknown>; operation: string }) => Promise<Record<string, unknown>>
  afterCreate?: (args: { collection: string; doc: Record<string, unknown> }) => Promise<void>
}

// ============================================================================
// DEFAULT SCHEMA DEFINITIONS
// ============================================================================

/**
 * Default schema for posts collection (used in tests)
 */
const postsSchema: PayloadField[] = [
  { type: 'text', name: 'title', required: true },
  { type: 'text', name: 'slug', required: true },
  { type: 'richText', name: 'content' },
  { type: 'textarea', name: 'excerpt' },
  { type: 'date', name: 'publishedAt' },
  { type: 'number', name: 'views' },
  { type: 'checkbox', name: 'featured' },
  { type: 'select', name: 'status', options: ['draft', 'published', 'archived'] },
  { type: 'relationship', name: 'author', relationTo: 'users' },
  { type: 'relationship', name: 'categories', relationTo: 'categories', hasMany: true },
  { type: 'upload', name: 'featuredImage', relationTo: 'media' },
  {
    type: 'array',
    name: 'tags',
    fields: [{ type: 'text', name: 'tag' }],
  },
  {
    type: 'group',
    name: 'metadata',
    fields: [
      { type: 'text', name: 'seoTitle' },
      { type: 'textarea', name: 'seoDescription' },
    ],
  },
  { type: 'blocks', name: 'layout' },
  // Polymorphic relationship for parent field
  { type: 'relationship', name: 'parent', relationTo: ['pages', 'posts'] },
  // Related posts (same collection relationship)
  { type: 'relationship', name: 'relatedPosts', relationTo: 'posts', hasMany: true },
]

/**
 * Default schema for articles collection
 */
const articlesSchema: PayloadField[] = [
  { type: 'text', name: 'title', required: true },
  { type: 'text', name: 'slug', required: true },
  { type: 'richText', name: 'body' },
]

/**
 * Default schema for users collection
 */
const usersSchema: PayloadField[] = [
  { type: 'text', name: 'name', required: true },
  { type: 'email', name: 'email', required: true },
  { type: 'relationship', name: 'organization', relationTo: 'organizations' },
  { type: 'relationship', name: 'manager', relationTo: 'users' },
  { type: 'relationship', name: 'team', relationTo: 'users', hasMany: true },
]

/**
 * Default schema for organizations collection
 */
const organizationsSchema: PayloadField[] = [
  { type: 'text', name: 'name', required: true },
  { type: 'text', name: 'slug', required: true },
]

/**
 * Default schema for categories collection
 */
const categoriesSchema: PayloadField[] = [
  { type: 'text', name: 'name', required: true },
  { type: 'text', name: 'slug', required: true },
  { type: 'relationship', name: 'parent', relationTo: 'categories' },
]

/**
 * Default schema for pages collection (with polymorphic relationships)
 */
const pagesSchema: PayloadField[] = [
  { type: 'text', name: 'title', required: true },
  { type: 'text', name: 'slug', required: true },
  { type: 'relationship', name: 'content', relationTo: ['posts', 'categories', 'media'] },
  { type: 'relationship', name: 'items', relationTo: ['posts', 'categories'], hasMany: true },
]

/**
 * Default schema for media collection
 */
const mediaSchema: PayloadField[] = [
  { type: 'text', name: 'filename', required: true },
  { type: 'text', name: 'mimeType' },
  { type: 'text', name: 'url' },
  { type: 'number', name: 'filesize' },
  { type: 'number', name: 'width' },
  { type: 'number', name: 'height' },
  { type: 'text', name: 'alt' },
]

/**
 * Default schema for comments collection
 */
const commentsSchema: PayloadField[] = [
  { type: 'text', name: 'body', required: true },
  { type: 'relationship', name: 'author', relationTo: 'users' },
  { type: 'relationship', name: 'post', relationTo: 'posts' },
  { type: 'relationship', name: 'parent', relationTo: 'comments' },
  { type: 'relationship', name: 'replies', relationTo: 'comments', hasMany: true },
]

/**
 * Schema registry for collections
 */
const collectionSchemas: Record<string, PayloadField[]> = {
  posts: postsSchema,
  articles: articlesSchema,
  users: usersSchema,
  organizations: organizationsSchema,
  categories: categoriesSchema,
  pages: pagesSchema,
  media: mediaSchema,
  comments: commentsSchema,
}

/**
 * Get schema for a collection, falls back to empty array
 */
function getCollectionSchema(collection: string): PayloadField[] {
  return collectionSchemas[collection] || []
}

/**
 * Mock Payload adapter for testing
 */
export interface MockPayloadAdapter extends PayloadDatabaseAdapter {
  /** In-memory document storage by collection */
  _collections: Map<string, Map<string, PayloadDocument>>
  /** Hooks for adapter operations */
  hooks?: AdapterHooks
}

function createMockAdapter(
  config: PayloadAdapterHarnessConfig,
  things: ThingsStore,
  relationships: RelationshipsStore,
  nouns: NounsStore,
  operations: AdapterOperation[]
): MockPayloadAdapter {
  const collections = new Map<string, Map<string, PayloadDocument>>()

  const trackOperation = (
    type: AdapterOperation['type'],
    collection: string,
    options?: { data?: unknown; where?: unknown; id?: string; error?: string }
  ): void => {
    operations.push({
      type,
      collection,
      data: options?.data,
      where: options?.where,
      timestamp: Date.now(),
      error: options?.error,
    })
  }

  const getCollection = (name: string): Map<string, PayloadDocument> => {
    if (!collections.has(name)) {
      collections.set(name, new Map())
    }
    return collections.get(name)!
  }

  const adapter: MockPayloadAdapter = {
    _collections: collections,

    // Lifecycle
    async init(): Promise<void> {},
    async connect(): Promise<void> {},
    async disconnect(): Promise<void> {},

    // Collection sync
    async syncCollection(collection: PayloadCollection): Promise<NounData> {
      const noun: NounData = {
        noun: collection.labels?.singular ?? collection.slug,
        plural: collection.labels?.plural ?? collection.slug + 's',
        description: collection.admin?.description,
      }
      nouns.set(noun.noun, noun)
      return noun
    },

    async syncDocument(collection: string, doc: PayloadDocument): Promise<ThingData> {
      const thing = this.documentToThing(collection, doc)
      things.create(thing)
      return thing
    },

    async getCollections(): Promise<PayloadCollection[]> {
      return Array.from(collections.keys()).map((slug) => ({
        slug,
        fields: [],
      }))
    },

    // Document CRUD
    async findDocument(collection: string, id: string): Promise<PayloadDocument | null> {
      trackOperation('findOne', collection, { id })
      const col = getCollection(collection)
      return col.get(id) ?? null
    },

    async findDocuments(collection: string, query?: {
      where?: Record<string, unknown>
      limit?: number
      page?: number
      sort?: string
    }): Promise<{
      docs: PayloadDocument[]
      totalDocs: number
      hasNextPage: boolean
      hasPrevPage: boolean
      page: number
      totalPages: number
    }> {
      trackOperation('find', collection, { where: query?.where })
      const col = getCollection(collection)
      let docs = Array.from(col.values())

      // Apply where filters
      if (query?.where) {
        docs = docs.filter((doc) => {
          for (const [key, value] of Object.entries(query.where!)) {
            if (doc[key] !== value) return false
          }
          return true
        })
      }

      // Apply sorting
      if (query?.sort) {
        const sortKey = query.sort.startsWith('-') ? query.sort.slice(1) : query.sort
        const sortDir = query.sort.startsWith('-') ? -1 : 1
        docs.sort((a, b) => {
          const aVal = a[sortKey]
          const bVal = b[sortKey]
          if (typeof aVal === 'string' && typeof bVal === 'string') {
            return aVal.localeCompare(bVal) * sortDir
          }
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return (aVal - bVal) * sortDir
          }
          return 0
        })
      }

      const totalDocs = docs.length
      const page = query?.page ?? 1
      const limit = query?.limit ?? 10
      const totalPages = Math.ceil(totalDocs / limit)
      const hasNextPage = page < totalPages
      const hasPrevPage = page > 1

      // Apply pagination
      const start = (page - 1) * limit
      docs = docs.slice(start, start + limit)

      return { docs, totalDocs, hasNextPage, hasPrevPage, page, totalPages }
    },

    async createDocument(collection: string, data: Record<string, unknown>): Promise<PayloadDocument> {
      const id = data.id as string ?? crypto.randomUUID()
      const now = new Date().toISOString()
      const doc: PayloadDocument = {
        id,
        createdAt: now,
        updatedAt: now,
        ...data,
      }
      trackOperation('create', collection, { data })
      const col = getCollection(collection)
      col.set(id, doc)

      // Sync to things store
      const thing = this.documentToThing(collection, doc)
      things.create(thing)

      return doc
    },

    async updateDocument(collection: string, id: string, data: Record<string, unknown>): Promise<PayloadDocument> {
      const col = getCollection(collection)
      const existing = col.get(id)

      if (!existing) {
        trackOperation('update', collection, { data, error: `Document ${id} not found` })
        throw new Error(`Document ${id} not found in collection ${collection}`)
      }

      const now = new Date().toISOString()
      const updated: PayloadDocument = {
        ...existing,
        ...data,
        id,
        updatedAt: now,
      }
      trackOperation('update', collection, { data })
      col.set(id, updated)

      // Sync to things store
      const thingId = `${config.namespace ?? 'https://test.do'}/${collection}/${id}`
      things.update(thingId, { data: data as Record<string, unknown> })

      return updated
    },

    async deleteDocument(collection: string, id: string): Promise<PayloadDocument> {
      const col = getCollection(collection)
      const existing = col.get(id)

      if (!existing) {
        trackOperation('delete', collection, { error: `Document ${id} not found` })
        throw new Error(`Document ${id} not found in collection ${collection}`)
      }

      trackOperation('delete', collection)
      col.delete(id)

      // Sync to things store
      const thingId = `${config.namespace ?? 'https://test.do'}/${collection}/${id}`
      things.delete(thingId)

      return existing
    },

    // Relationships
    async resolveRelationship(
      collection: string,
      docId: string,
      fieldName: string
    ): Promise<PayloadDocument | PayloadDocument[] | null> {
      const doc = await this.findDocument(collection, docId)
      if (!doc) return null

      const fieldValue = doc[fieldName]
      if (!fieldValue) return null

      // For now, just return the raw value
      return null
    },

    async syncRelationships(collection: string, doc: PayloadDocument): Promise<void> {
      // Would iterate over relationship fields and sync to relationships store
    },

    // Type conversion
    collectionToNoun(collection: PayloadCollection): NounData {
      return {
        noun: collection.labels?.singular ?? collection.slug,
        plural: collection.labels?.plural ?? collection.slug + 's',
        description: collection.admin?.description,
      }
    },

    documentToThing(collection: string, doc: PayloadDocument): ThingData {
      const namespace = config.namespace ?? 'https://test.do'
      const $id = `${namespace}/${collection}/${doc.id}`
      const $type = `${namespace}/${collection}`

      // Extract system fields only, keep all data fields (including title)
      const { id, createdAt, updatedAt, _status, ...rest } = doc

      // Get name from title or name field for display purposes
      const name = (rest.title as string) ?? (rest.name as string) ?? undefined

      return {
        $id,
        $type,
        name,
        data: Object.keys(rest).length > 0 ? rest as Record<string, unknown> : undefined,
        visibility: _status === 'published' ? 'public' : 'user',
        createdAt: createdAt ? new Date(createdAt) : new Date(),
        updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
      }
    },

    fieldToData(field: PayloadField, value: unknown): unknown {
      switch (field.type) {
        case 'text':
        case 'textarea':
        case 'email':
        case 'code':
        case 'richText':
          return String(value ?? '')
        case 'number':
          return Number(value ?? 0)
        case 'checkbox':
          return Boolean(value)
        case 'date':
          return value ? new Date(value as string) : null
        default:
          return value
      }
    },
  }

  // Create transaction manager for this adapter instance
  const txManager = createTransactionManager()

  // Create migration store for this adapter instance
  const migrationStore = createMigrationStore()

  // Alias methods to match Payload Local API style
  const adapterWithAliases = adapter as MockPayloadAdapter & {
    create: (args: { collection: string; data: Record<string, unknown>; transaction?: Transaction }) => Promise<PayloadDocument>
    find: (args: { collection: string; where?: Record<string, unknown>; limit?: number; page?: number; sort?: string; depth?: number; transaction?: Transaction }) => Promise<{ docs: Record<string, unknown>[]; totalDocs: number; hasNextPage: boolean; hasPrevPage: boolean; page: number; totalPages: number; limit: number }>
    findOne: (args: { collection: string; id?: string; where?: Record<string, unknown>; depth?: number; transaction?: Transaction }) => Promise<Record<string, unknown> | null>
    update: (args: { collection: string; id: string; data: Record<string, unknown> }) => Promise<PayloadDocument>
    updateOne: (args: { collection: string; id: string; data: Record<string, unknown>; transaction?: Transaction }) => Promise<PayloadDocument>
    updateMany: (args: { collection: string; where?: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ updatedCount: number }>
    delete: (args: { collection: string; id: string }) => Promise<PayloadDocument>
    deleteOne: (args: { collection: string; id: string; transaction?: Transaction }) => Promise<PayloadDocument>
    deleteMany: (args: { collection: string; where?: Record<string, unknown> }) => Promise<{ deletedCount: number }>
    count: (args: { collection: string; where?: Record<string, unknown> }) => Promise<{ totalDocs: number }>
    createVersion: (args: CreateVersionArgs) => Promise<any>
    findVersions: (args: FindVersionsArgs) => Promise<any>
    findVersion: (args: FindVersionArgs) => Promise<any>
    restoreVersion: (args: RestoreVersionArgs) => Promise<any>
    deleteVersions: (args: DeleteVersionsArgs) => Promise<void>
    updateVersion: (args: any) => Promise<never>
    hooks?: any
    // Globals methods
    findGlobal: (args: FindGlobalArgs) => Promise<Record<string, unknown>>
    updateGlobal: (args: UpdateGlobalArgs) => Promise<Record<string, unknown>>
    createGlobalVersion: (args: CreateGlobalVersionArgs) => Promise<any>
    findGlobalVersions: (args: FindGlobalVersionsArgs) => Promise<any>
    restoreGlobalVersion: (args: RestoreGlobalVersionArgs) => Promise<Record<string, unknown>>
    getGlobals: () => Promise<Array<{ slug: string } & Record<string, unknown>>>
    // Transaction methods
    activeTransaction: Transaction | undefined
    beginTransaction: (options?: { timeout?: number }) => Promise<Transaction>
    commitTransaction: (tx: Transaction) => Promise<void>
    rollbackTransaction: (tx: Transaction) => Promise<void>
    transaction: <T>(callback: (tx: Transaction) => Promise<T>) => Promise<T>
    savepoint: (tx: Transaction, name: string) => Promise<Savepoint>
    rollbackToSavepoint: (tx: Transaction, sp: Savepoint | string) => Promise<void>
    releaseSavepoint: (tx: Transaction, sp: Savepoint | string) => Promise<void>
    // Migration methods
    registerMigrations: (migrations: Migration[]) => void
    migrate: (options?: MigrateOptions) => Promise<any>
    migrateStatus: () => Promise<any>
    migrateDown: (options?: MigrateDownOptions) => Promise<any>
    migrateRefresh: () => Promise<any>
    migrateFresh: (options?: MigrateFreshOptions) => Promise<any>
    migrateCreate: (options: MigrateCreateOptions) => Promise<any>
    getMigrationHistory: () => Promise<any[]>
    getMigrationDir: () => string
    setMigrationDir: (dir: string) => void
    getMigrationSearchPaths: () => string[]
    setMigrationFiles: (files: MigrationFileInfo[]) => void
    discoverMigrations: () => Promise<MigrationFileInfo[]>
    initSchema: () => Promise<void>
    isInTransaction: () => boolean
    setLockHeld: (held: boolean) => void
    on: (event: string, listener: (...args: any[]) => void) => void
    setMode: (mode: 'development' | 'production') => void
    setSeedFunction: (fn: () => Promise<void>) => void
    push: (options: PushOptions) => Promise<any>
  }

  // Use the createOperation function for create
  adapterWithAliases.create = async (args: { collection: string; data: Record<string, unknown>; transaction?: Transaction }) => {
    const namespace = config.namespace ?? 'https://test.do'

    // Get fields schema for the collection (for now, use postFields as default schema)
    // In real implementation, this would be fetched from collection config
    const schema = getCollectionSchema(args.collection)

    // Check if using an invalid/closed transaction
    if (args.transaction && !txManager.isValidTransaction(args.transaction)) {
      throw new Error('Cannot use transaction: transaction is invalid, expired, or already committed')
    }

    // Build the context for create operation
    const ctx = {
      namespace,
      things: args.transaction ? {
        ...things,
        create: (data: any) => {
          txManager.addPendingThing(data.$id, data)
          return data
        },
      } : things,
      relationships: args.transaction ? {
        ...relationships,
        add: (rel: any) => {
          txManager.addPendingRelationship({ action: 'add', ...rel })
        },
      } : relationships,
      nouns,
      schema,
      hooks: adapterWithAliases.hooks,
    }

    // Track the operation
    trackOperation('create', args.collection, { data: args.data })

    // Call the create operation
    const doc = await createOperation(args, ctx)

    if (args.transaction) {
      // Store in pending collection docs
      txManager.addPendingCollectionDoc(args.collection, doc.id, doc)
      // Record the operation in the transaction
      txManager.recordOperation({
        type: 'create',
        collection: args.collection,
        id: doc.id,
        data: args.data,
        timestamp: Date.now(),
      })
    } else {
      // Store in collections map immediately
      const col = getCollection(args.collection)
      col.set(doc.id, doc)
    }

    return doc
  }

  // Build find context for find operations
  const buildFindContext = (): FindContext => {
    const namespace = config.namespace ?? 'https://test.do'
    // Build schemas map
    const schemas = new Map<string, PayloadField[]>()
    for (const [collection, schema] of Object.entries(collectionSchemas)) {
      schemas.set(collection, schema)
    }
    return {
      namespace,
      things,
      relationships,
      schema: undefined,
      schemas,
    }
  }

  adapterWithAliases.find = async (args: {
    collection: string
    where?: Record<string, unknown>
    limit?: number
    page?: number
    sort?: string
    depth?: number
  }) => {
    trackOperation('find', args.collection, { where: args.where })

    const ctx = buildFindContext()
    ctx.schema = getCollectionSchema(args.collection)

    const result = await findOperation({
      collection: args.collection,
      where: args.where as any,
      limit: args.limit,
      page: args.page,
      sort: args.sort,
      depth: args.depth,
    }, ctx)

    return result
  }

  adapterWithAliases.findOne = async (args: { collection: string; id?: string; where?: Record<string, unknown>; depth?: number; transaction?: Transaction }) => {
    trackOperation('findOne', args.collection, { id: args.id, where: args.where })

    // If within a transaction, check pending docs first
    if (args.transaction && args.id) {
      const pendingDoc = txManager.getPendingCollectionDoc(args.collection, args.id)
      if (pendingDoc) {
        if (pendingDoc.__deleted) {
          return null
        }
        return pendingDoc
      }
      // Also check if deleted in transaction
      if (txManager.isPendingDeleted(args.collection, args.id)) {
        return null
      }
    }

    const ctx = buildFindContext()
    ctx.schema = getCollectionSchema(args.collection)

    const result = await findOneOperation({
      collection: args.collection,
      id: args.id,
      where: args.where as any,
      depth: args.depth,
    }, ctx)

    return result
  }

  adapterWithAliases.update = async (args: { collection: string; id: string; data: Record<string, unknown> }) => {
    return adapter.updateDocument(args.collection, args.id, args.data)
  }

  adapterWithAliases.delete = async (args: { collection: string; id: string }) => {
    return adapter.deleteDocument(args.collection, args.id)
  }

  adapterWithAliases.count = async (args: { collection: string; where?: Record<string, unknown> }) => {
    trackOperation('count', args.collection, { where: args.where })
    const result = await adapter.findDocuments(args.collection, { where: args.where })
    return { totalDocs: result.totalDocs }
  }

  // Build update/delete context helper
  const buildUpdateDeleteContext = (): UpdateContext & DeleteContext => {
    const namespace = config.namespace ?? 'https://test.do'
    return {
      namespace,
      things,
      relationships,
      nouns,
      schema: undefined,
      findDocument: async (collection: string, id: string) => {
        const col = getCollection(collection)
        return col.get(id) ?? null
      },
      findDocuments: async (collection: string, query?: { where?: Record<string, unknown> }) => {
        const col = getCollection(collection)
        let docs = Array.from(col.values())

        // Apply where filters
        if (query?.where) {
          docs = docs.filter((doc) => {
            for (const [key, value] of Object.entries(query.where!)) {
              // Handle nested filter objects like { status: { equals: 'draft' } }
              if (typeof value === 'object' && value !== null) {
                const filterObj = value as Record<string, unknown>
                if ('equals' in filterObj) {
                  if (doc[key] !== filterObj.equals) return false
                }
              } else {
                if (doc[key] !== value) return false
              }
            }
            return true
          })
        }

        return { docs }
      },
      deleteFromCollection: (collection: string, id: string) => {
        const col = getCollection(collection)
        col.delete(id)
      },
      hooks: adapterWithAliases.hooks,
    }
  }

  // updateOne operation
  adapterWithAliases.updateOne = async (args: { collection: string; id: string; data: Record<string, unknown>; transaction?: Transaction }) => {
    const namespace = config.namespace ?? 'https://test.do'
    const schema = getCollectionSchema(args.collection)
    const ctx = buildUpdateDeleteContext()
    ctx.schema = schema

    // Track the operation
    trackOperation('update', args.collection, { data: args.data, id: args.id })

    if (args.transaction) {
      // Check if transaction is valid
      if (!txManager.isValidTransaction(args.transaction)) {
        throw new Error('Cannot use transaction: transaction is invalid or already committed')
      }

      // Get the existing document (either from pending or from store)
      let existingDoc = txManager.getPendingCollectionDoc(args.collection, args.id)
      if (!existingDoc) {
        const col = getCollection(args.collection)
        existingDoc = col.get(args.id)
      }

      if (!existingDoc) {
        throw new Error(`Document ${args.id} not found in collection ${args.collection}`)
      }

      // Create updated document
      const now = new Date().toISOString()
      const updatedDoc = {
        ...existingDoc,
        ...args.data,
        id: args.id,
        updatedAt: now,
      }

      // Store in pending
      txManager.addPendingCollectionDoc(args.collection, args.id, updatedDoc)
      txManager.recordOperation({
        type: 'update',
        collection: args.collection,
        id: args.id,
        data: args.data,
        previousData: existingDoc,
        timestamp: Date.now(),
      })

      return updatedDoc
    }

    // Call the update operation
    const doc = await updateOneOperation({
      collection: args.collection,
      id: args.id,
      data: args.data,
    }, ctx)

    // Update in collections map
    const col = getCollection(args.collection)
    col.set(doc.id, doc)

    return doc
  }

  // updateMany operation
  adapterWithAliases.updateMany = async (args: { collection: string; where?: Record<string, unknown>; data: Record<string, unknown> }) => {
    const namespace = config.namespace ?? 'https://test.do'
    const schema = getCollectionSchema(args.collection)
    const ctx = buildUpdateDeleteContext()
    ctx.schema = schema

    // Track the operation
    trackOperation('updateMany' as any, args.collection, { data: args.data, where: args.where })

    // Call the updateMany operation
    const result = await updateManyOperation({
      collection: args.collection,
      where: args.where,
      data: args.data,
    }, ctx)

    return result
  }

  // deleteOne operation
  adapterWithAliases.deleteOne = async (args: { collection: string; id: string; transaction?: Transaction }) => {
    const namespace = config.namespace ?? 'https://test.do'
    const schema = getCollectionSchema(args.collection)
    const ctx = buildUpdateDeleteContext()
    ctx.schema = schema

    // Track the operation
    trackOperation('delete', args.collection, { id: args.id })

    if (args.transaction) {
      // Check if transaction is valid
      if (!txManager.isValidTransaction(args.transaction)) {
        throw new Error('Cannot use transaction: transaction is invalid or already committed')
      }

      // Get the existing document (either from pending or from store)
      let existingDoc = txManager.getPendingCollectionDoc(args.collection, args.id)
      if (!existingDoc) {
        const col = getCollection(args.collection)
        existingDoc = col.get(args.id)
      }

      if (!existingDoc) {
        throw new Error(`Document ${args.id} not found in collection ${args.collection}`)
      }

      // Mark as deleted in pending
      txManager.markPendingDeleted(args.collection, args.id)
      txManager.recordOperation({
        type: 'delete',
        collection: args.collection,
        id: args.id,
        previousData: existingDoc,
        timestamp: Date.now(),
      })

      return existingDoc
    }

    // Call the delete operation
    const doc = await deleteOneOperation({
      collection: args.collection,
      id: args.id,
    }, ctx)

    return doc
  }

  // deleteMany operation
  adapterWithAliases.deleteMany = async (args: { collection: string; where?: Record<string, unknown> }) => {
    const namespace = config.namespace ?? 'https://test.do'
    const schema = getCollectionSchema(args.collection)
    const ctx = buildUpdateDeleteContext()
    ctx.schema = schema

    // Track the operation
    trackOperation('deleteMany' as any, args.collection, { where: args.where })

    // Call the deleteMany operation
    const result = await deleteManyOperation({
      collection: args.collection,
      where: args.where,
    }, ctx)

    return result
  }

  // Build version context for versioning operations
  const buildVersionContext = (): VersionContext => {
    const namespace = config.namespace ?? 'https://test.do'
    return {
      namespace,
      things,
      getDocument: async (collection: string, id: string) => {
        const col = getCollection(collection)
        return col.get(id) ?? null
      },
      updateDocument: async (collection: string, id: string, data: Record<string, unknown>) => {
        return adapter.updateDocument(collection, id, data)
      },
      deleteDocument: async (collection: string, id: string) => {
        return adapter.deleteDocument(collection, id)
      },
    }
  }

  // Versioning operations
  adapterWithAliases.createVersion = async (args: CreateVersionArgs) => {
    trackOperation('createVersion' as any, args.collection, { id: args.id, data: args })
    const ctx = buildVersionContext()
    return createVersionOp(args, ctx)
  }

  adapterWithAliases.findVersions = async (args: FindVersionsArgs) => {
    trackOperation('findVersions' as any, args.collection, { id: args.id, where: args.where })
    const ctx = buildVersionContext()
    return findVersionsOp(args, ctx)
  }

  adapterWithAliases.findVersion = async (args: FindVersionArgs) => {
    trackOperation('findVersion' as any, args.collection, { id: args.id })
    const ctx = buildVersionContext()
    return findVersionOp(args, ctx)
  }

  adapterWithAliases.restoreVersion = async (args: RestoreVersionArgs) => {
    trackOperation('restoreVersion' as any, args.collection, { id: args.id })
    const ctx = buildVersionContext()
    return restoreVersionOp(args, ctx)
  }

  adapterWithAliases.deleteVersions = async (args: DeleteVersionsArgs) => {
    trackOperation('deleteVersions' as any, args.collection, { id: args.id })
    const ctx = buildVersionContext()
    return deleteVersionsOp(args, ctx)
  }

  adapterWithAliases.updateVersion = async () => {
    return updateVersionOp()
  }

  // Override delete to also delete versions
  const originalDelete = adapterWithAliases.delete
  adapterWithAliases.delete = async (args: { collection: string; id: string }) => {
    const ctx = buildVersionContext()
    // Delete all versions first
    await deleteAllVersions(args.collection, args.id, ctx)
    // Then delete the document
    return originalDelete(args)
  }

  // ============================================================================
  // GLOBALS OPERATIONS
  // ============================================================================

  // Build global context helper
  const buildGlobalContext = (): GlobalContext => {
    const namespace = config.namespace ?? 'https://test.do'
    return {
      namespace,
      things,
      relationships,
      hooks: adapterWithAliases.hooks,
      schemas: new Map(Object.entries(collectionSchemas)),
      getDocument: async (collection: string, id: string) => {
        const col = getCollection(collection)
        return col.get(id) ?? null
      },
    }
  }

  adapterWithAliases.findGlobal = async (args: FindGlobalArgs) => {
    trackOperation('findGlobal' as any, args.slug, { id: args.slug })
    const ctx = buildGlobalContext()
    return findGlobalOp(args, ctx)
  }

  adapterWithAliases.updateGlobal = async (args: UpdateGlobalArgs) => {
    trackOperation('updateGlobal' as any, args.slug, { data: args.data })
    const ctx = buildGlobalContext()
    return updateGlobalOp(args, ctx)
  }

  adapterWithAliases.createGlobalVersion = async (args: CreateGlobalVersionArgs) => {
    trackOperation('createGlobalVersion' as any, args.slug, { id: args.slug })
    const ctx = buildGlobalContext()
    return createGlobalVersionOp(args, ctx)
  }

  adapterWithAliases.findGlobalVersions = async (args: FindGlobalVersionsArgs) => {
    trackOperation('findGlobalVersions' as any, args.slug, { id: args.slug, where: args.where })
    const ctx = buildGlobalContext()
    return findGlobalVersionsOp(args, ctx)
  }

  adapterWithAliases.restoreGlobalVersion = async (args: RestoreGlobalVersionArgs) => {
    trackOperation('restoreGlobalVersion' as any, args.slug, { id: args.slug })
    const ctx = buildGlobalContext()
    return restoreGlobalVersionOp(args, ctx)
  }

  adapterWithAliases.getGlobals = async () => {
    const ctx = buildGlobalContext()
    return getGlobalsOp(ctx)
  }

  // ============================================================================
  // TRANSACTION OPERATIONS
  // ============================================================================

  // Getter for activeTransaction
  Object.defineProperty(adapterWithAliases, 'activeTransaction', {
    get: () => txManager.activeTransaction,
  })

  adapterWithAliases.beginTransaction = async (options?: { timeout?: number }) => {
    return txManager.beginTransaction(options)
  }

  adapterWithAliases.commitTransaction = async (tx: Transaction) => {
    return txManager.commitTransaction(tx, async (state: TransactionState_Internal) => {
      // Apply all pending Things
      for (const [id, thing] of state.pendingThings) {
        things.create(thing)
      }

      // Apply all pending relationships
      for (const rel of state.pendingRelationships) {
        if (rel.action === 'add') {
          relationships.add({ from: rel.from, to: rel.to, verb: rel.verb, data: rel.data })
        } else {
          relationships.remove(rel.from, rel.to, rel.verb)
        }
      }

      // Apply all pending collection documents
      const namespace = config.namespace ?? 'https://test.do'
      for (const [collectionName, docs] of state.pendingCollectionDocs) {
        const col = getCollection(collectionName)
        for (const [id, doc] of docs) {
          if (doc.__deleted) {
            col.delete(id)
            // Also delete from things store
            const thingId = `${namespace}/${collectionName}/${id}`
            things.delete(thingId)
          } else {
            col.set(id, doc)
            // Also update in things store - convert doc to Thing format
            const thingId = `${namespace}/${collectionName}/${id}`
            const existingThing = things.get(thingId)
            if (existingThing) {
              // Update existing thing
              const { id: docId, createdAt, updatedAt, ...rest } = doc
              things.update(thingId, {
                data: rest,
                updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
              })
            } else {
              // Create new thing
              const thing = adapter.documentToThing(collectionName, doc)
              things.create(thing)
            }
          }
        }
      }
    })
  }

  adapterWithAliases.rollbackTransaction = async (tx: Transaction) => {
    return txManager.rollbackTransaction(tx)
  }

  adapterWithAliases.transaction = async <T>(callback: (tx: Transaction) => Promise<T>): Promise<T> => {
    return txManager.transaction(callback, async (state: TransactionState_Internal) => {
      // Apply all pending Things
      for (const [id, thing] of state.pendingThings) {
        things.create(thing)
      }

      // Apply all pending relationships
      for (const rel of state.pendingRelationships) {
        if (rel.action === 'add') {
          relationships.add({ from: rel.from, to: rel.to, verb: rel.verb, data: rel.data })
        } else {
          relationships.remove(rel.from, rel.to, rel.verb)
        }
      }

      // Apply all pending collection documents
      const namespace = config.namespace ?? 'https://test.do'
      for (const [collectionName, docs] of state.pendingCollectionDocs) {
        const col = getCollection(collectionName)
        for (const [id, doc] of docs) {
          if (doc.__deleted) {
            col.delete(id)
            const thingId = `${namespace}/${collectionName}/${id}`
            things.delete(thingId)
          } else {
            col.set(id, doc)
            // Also update in things store - convert doc to Thing format
            const thingId = `${namespace}/${collectionName}/${id}`
            const existingThing = things.get(thingId)
            if (existingThing) {
              // Update existing thing
              const { id: docId, createdAt, updatedAt, ...rest } = doc
              things.update(thingId, {
                data: rest,
                updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
              })
            } else {
              // Create new thing
              const thing = adapter.documentToThing(collectionName, doc)
              things.create(thing)
            }
          }
        }
      }
    })
  }

  adapterWithAliases.savepoint = async (tx: Transaction, name: string) => {
    return txManager.savepoint(tx, name)
  }

  adapterWithAliases.rollbackToSavepoint = async (tx: Transaction, sp: Savepoint | string) => {
    return txManager.rollbackToSavepoint(tx, sp)
  }

  adapterWithAliases.releaseSavepoint = async (tx: Transaction, sp: Savepoint | string) => {
    return txManager.releaseSavepoint(tx, sp)
  }

  // ============================================================================
  // MIGRATION OPERATIONS
  // ============================================================================

  adapterWithAliases.registerMigrations = (migrations: Migration[]) => {
    registerMigrations(migrationStore, migrations)
  }

  adapterWithAliases.migrate = async (options?: MigrateOptions) => {
    // Initialize schema hooks if defined
    if (adapterWithAliases.hooks?.beforeSchemaInit || adapterWithAliases.hooks?.afterSchemaInit) {
      migrationStore.hooks = {
        beforeSchemaInit: adapterWithAliases.hooks?.beforeSchemaInit,
        afterSchemaInit: adapterWithAliases.hooks?.afterSchemaInit,
        beforeFresh: adapterWithAliases.hooks?.beforeFresh,
      }
      await initSchema(migrationStore)
    }
    const result = await migrateOp(migrationStore, options)
    trackOperation('migrate' as any, 'migrations', { data: { migrations: Array.from(migrationStore.migrations.keys()) } })
    return result
  }

  adapterWithAliases.migrateStatus = async () => {
    return migrateStatusOp(migrationStore)
  }

  adapterWithAliases.migrateDown = async (options?: MigrateDownOptions) => {
    trackOperation('migrateDown' as any, 'migrations', { data: options })
    return migrateDownOp(migrationStore, options)
  }

  adapterWithAliases.migrateRefresh = async () => {
    return migrateRefreshOp(migrationStore)
  }

  adapterWithAliases.migrateFresh = async (options?: MigrateFreshOptions) => {
    // Copy hooks from adapter to migration store
    if (adapterWithAliases.hooks) {
      migrationStore.hooks = {
        beforeSchemaInit: adapterWithAliases.hooks.beforeSchemaInit,
        afterSchemaInit: adapterWithAliases.hooks.afterSchemaInit,
        beforeFresh: adapterWithAliases.hooks.beforeFresh,
      }
    }
    return migrateFreshOp(migrationStore, options, () => {
      // Clear all collections
      collections.clear()
      things.clear()
      relationships.clear()
      nouns.clear()
    })
  }

  adapterWithAliases.migrateCreate = async (options: MigrateCreateOptions) => {
    return migrateCreateOp(migrationStore, options)
  }

  adapterWithAliases.getMigrationHistory = async () => {
    return getMigrationHistory(migrationStore)
  }

  adapterWithAliases.getMigrationDir = () => {
    return getMigrationDir(migrationStore)
  }

  adapterWithAliases.setMigrationDir = (dir: string) => {
    setMigrationDir(migrationStore, dir)
  }

  adapterWithAliases.getMigrationSearchPaths = () => {
    return getMigrationSearchPaths()
  }

  adapterWithAliases.setMigrationFiles = (files: MigrationFileInfo[]) => {
    setMigrationFiles(migrationStore, files)
  }

  adapterWithAliases.discoverMigrations = async () => {
    return discoverMigrations(migrationStore)
  }

  adapterWithAliases.initSchema = async () => {
    if (adapterWithAliases.hooks) {
      migrationStore.hooks = {
        beforeSchemaInit: adapterWithAliases.hooks.beforeSchemaInit,
        afterSchemaInit: adapterWithAliases.hooks.afterSchemaInit,
        beforeFresh: adapterWithAliases.hooks.beforeFresh,
      }
    }
    return initSchema(migrationStore)
  }

  adapterWithAliases.isInTransaction = () => {
    return isInTransaction(migrationStore)
  }

  adapterWithAliases.setLockHeld = (held: boolean) => {
    setLockHeld(migrationStore, held)
  }

  adapterWithAliases.on = (event: string, listener: (...args: any[]) => void) => {
    onMigrationEvent(migrationStore, event, listener)
  }

  adapterWithAliases.setMode = (mode: 'development' | 'production') => {
    setMode(migrationStore, mode)
  }

  adapterWithAliases.setSeedFunction = (fn: () => Promise<void>) => {
    setSeedFunction(migrationStore, fn)
  }

  adapterWithAliases.push = async (options: PushOptions) => {
    return push(migrationStore, options)
  }

  return adapterWithAliases as MockPayloadAdapter
}

// ============================================================================
// HARNESS FACTORY
// ============================================================================

/**
 * Create a test harness for the Payload adapter
 *
 * @example
 * ```typescript
 * const harness = createPayloadAdapterHarness({
 *   namespace: 'https://test.do',
 *   seed: {
 *     posts: [{ id: '1', title: 'Hello World' }],
 *   },
 * })
 *
 * const result = await harness.adapter.find({ collection: 'posts' })
 * expect(result.docs).toHaveLength(1)
 * ```
 */
export function createPayloadAdapterHarness(
  config: PayloadAdapterHarnessConfig = {}
): PayloadAdapterHarness {
  const operations: AdapterOperation[] = []
  const things = createThingsStore()
  const relationships = createRelationshipsStore()
  const nouns = createNounsStore()

  const adapter = createMockAdapter(config, things, relationships, nouns, operations)

  // Seed initial data (without tracking operations)
  const seedData = (seed?: SeedData): void => {
    if (!seed) return

    for (const [collection, docs] of Object.entries(seed)) {
      const col = adapter._collections
      if (!col.has(collection)) {
        col.set(collection, new Map())
      }
      const collectionMap = col.get(collection)!

      for (const doc of docs) {
        const id = (doc.id as string) ?? crypto.randomUUID()
        const now = new Date().toISOString()
        const payloadDoc: PayloadDocument = {
          id,
          createdAt: (doc.createdAt as string) ?? now,
          updatedAt: (doc.updatedAt as string) ?? now,
          ...doc,
        }
        collectionMap.set(id, payloadDoc)

        // Also sync to things store
        const thing = adapter.documentToThing(collection, payloadDoc)
        things.create(thing)
      }
    }
  }

  // Initial seed
  seedData(config.seed)

  // Reset function
  const reset = (options?: { hard?: boolean }): void => {
    // Clear operations
    operations.length = 0

    // Clear all data
    adapter._collections.clear()
    things.clear()
    relationships.clear()
    nouns.clear()

    // Restore seed if not hard reset and behavior is restore-seed
    if (!options?.hard && config.resetBehavior === 'restore-seed') {
      seedData(config.seed)
    }
  }

  return {
    adapter,
    things,
    relationships,
    nouns,
    operations,
    config,
    reset,
  }
}
