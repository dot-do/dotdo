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

// ============================================================================
// TYPES
// ============================================================================

/**
 * Tracked adapter operation
 */
export interface AdapterOperation {
  type: 'create' | 'find' | 'findOne' | 'update' | 'delete' | 'count' | 'createVersion' | 'findVersions' | 'findVersion' | 'restoreVersion' | 'deleteVersions'
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
]

/**
 * Default schema for pages collection
 */
const pagesSchema: PayloadField[] = [
  { type: 'text', name: 'title', required: true },
  { type: 'text', name: 'slug', required: true },
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

      // Extract known fields, rest goes to data
      const { id, createdAt, updatedAt, _status, title, name: docName, ...rest } = doc

      return {
        $id,
        $type,
        name: (title as string) ?? (docName as string) ?? undefined,
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

  // Alias methods to match Payload Local API style
  const adapterWithAliases = adapter as MockPayloadAdapter & {
    create: (args: { collection: string; data: Record<string, unknown> }) => Promise<PayloadDocument>
    find: (args: { collection: string; where?: Record<string, unknown>; limit?: number; page?: number; sort?: string; depth?: number }) => Promise<{ docs: Record<string, unknown>[]; totalDocs: number; hasNextPage: boolean; hasPrevPage: boolean; page: number; totalPages: number; limit: number }>
    findOne: (args: { collection: string; id?: string; where?: Record<string, unknown>; depth?: number }) => Promise<Record<string, unknown> | null>
    update: (args: { collection: string; id: string; data: Record<string, unknown> }) => Promise<PayloadDocument>
    delete: (args: { collection: string; id: string }) => Promise<PayloadDocument>
    count: (args: { collection: string; where?: Record<string, unknown> }) => Promise<{ totalDocs: number }>
    createVersion: (args: CreateVersionArgs) => Promise<any>
    findVersions: (args: FindVersionsArgs) => Promise<any>
    findVersion: (args: FindVersionArgs) => Promise<any>
    restoreVersion: (args: RestoreVersionArgs) => Promise<any>
    deleteVersions: (args: DeleteVersionsArgs) => Promise<void>
    updateVersion: (args: any) => Promise<never>
    hooks?: any
  }

  // Use the createOperation function for create
  adapterWithAliases.create = async (args: { collection: string; data: Record<string, unknown> }) => {
    const namespace = config.namespace ?? 'https://test.do'

    // Get fields schema for the collection (for now, use postFields as default schema)
    // In real implementation, this would be fetched from collection config
    const schema = getCollectionSchema(args.collection)

    // Build the context for create operation
    const ctx = {
      namespace,
      things,
      relationships,
      nouns,
      schema,
      hooks: adapterWithAliases.hooks,
    }

    // Track the operation
    trackOperation('create', args.collection, { data: args.data })

    // Call the create operation
    const doc = await createOperation(args, ctx)

    // Store in collections map
    const col = getCollection(args.collection)
    col.set(doc.id, doc)

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

  adapterWithAliases.findOne = async (args: { collection: string; id?: string; where?: Record<string, unknown>; depth?: number }) => {
    trackOperation('findOne', args.collection, { id: args.id, where: args.where })

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
