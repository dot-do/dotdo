/**
 * @dotdo/chroma - Chroma SDK compat
 *
 * Drop-in replacement for chromadb backed by DO SQLite
 * with tiered vector storage. This in-memory implementation matches
 * the Chroma TypeScript SDK API.
 *
 * @see https://docs.trychroma.com/reference/js-client
 */
import type {
  ChromaClientParams,
  CollectionModel,
  CreateCollectionParams,
  GetCollectionParams,
  DeleteCollectionParams,
  ModifyCollectionParams,
  AddParams,
  UpdateParams,
  UpsertParams,
  QueryParams,
  QueryResponse,
  GetParams,
  GetResponse,
  DeleteParams,
  PeekParams,
  Metadata,
  MetadataValue,
  Embedding,
  Where,
  WhereDocument,
  WhereOperators,
  IncludeEnum,
  Collection as ICollection,
  ChromaClientInterface,
} from './types'

import {
  ChromaError,
  ChromaNotFoundError,
  ChromaConflictError,
  ChromaValidationError,
} from './types'

// Re-export types and error classes
export {
  ChromaError,
  ChromaConfigurationError,
  ChromaConnectionError,
  ChromaNotFoundError,
  ChromaConflictError,
  ChromaValidationError,
  ChromaRequestError,
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * Document record in storage
 */
interface DocumentRecord {
  id: string
  embedding: Embedding
  metadata: Metadata | null
  document: string | null
}

/**
 * Collection storage
 */
interface CollectionStorage {
  model: CollectionModel
  documents: Map<string, DocumentRecord>
}

/**
 * Global in-memory storage for all collections
 */
const globalCollectionStorage = new Map<string, CollectionStorage>()

// ============================================================================
// VECTOR SIMILARITY
// ============================================================================

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProd = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProd += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProd / denominator
}

/**
 * Convert cosine similarity to distance
 * Chroma uses distance (lower is more similar)
 */
function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b)
}

// ============================================================================
// METADATA FILTERING
// ============================================================================

/**
 * Check if a value matches a filter operator
 */
function matchesOperator(
  value: MetadataValue | undefined,
  operator: WhereOperators
): boolean {
  if (value === undefined) {
    return false
  }

  if (operator.$eq !== undefined) {
    return value === operator.$eq
  }

  if (operator.$ne !== undefined) {
    return value !== operator.$ne
  }

  if (operator.$gt !== undefined) {
    return typeof value === 'number' && value > operator.$gt
  }

  if (operator.$gte !== undefined) {
    return typeof value === 'number' && value >= operator.$gte
  }

  if (operator.$lt !== undefined) {
    return typeof value === 'number' && value < operator.$lt
  }

  if (operator.$lte !== undefined) {
    return typeof value === 'number' && value <= operator.$lte
  }

  if (operator.$in !== undefined) {
    return operator.$in.includes(value)
  }

  if (operator.$nin !== undefined) {
    return !operator.$nin.includes(value)
  }

  return true
}

/**
 * Check if a value is a filter operator object
 */
function isOperator(value: unknown): value is WhereOperators {
  if (typeof value !== 'object' || value === null) return false
  const keys = Object.keys(value)
  return keys.some((k) =>
    ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin'].includes(k)
  )
}

/**
 * Check if metadata matches a where filter
 */
function matchesWhere(
  metadata: Metadata | null | undefined,
  where: Where
): boolean {
  if (!where || Object.keys(where).length === 0) {
    return true
  }

  // Handle $and
  if ('$and' in where && where.$and) {
    return where.$and.every((w) => matchesWhere(metadata, w))
  }

  // Handle $or
  if ('$or' in where && where.$or) {
    return where.$or.some((w) => matchesWhere(metadata, w))
  }

  // Handle field filters
  for (const [key, condition] of Object.entries(where)) {
    if (key === '$and' || key === '$or') continue

    const value = metadata ? metadata[key] : undefined

    if (isOperator(condition)) {
      if (!matchesOperator(value, condition)) {
        return false
      }
    } else {
      // Direct equality
      if (value !== condition) {
        return false
      }
    }
  }

  return true
}

// ============================================================================
// DOCUMENT FILTERING
// ============================================================================

/**
 * Check if document matches a whereDocument filter
 */
function matchesWhereDocument(
  document: string | null | undefined,
  whereDoc: WhereDocument
): boolean {
  if (!whereDoc || Object.keys(whereDoc).length === 0) {
    return true
  }

  // Handle $and
  if ('$and' in whereDoc && whereDoc.$and) {
    return whereDoc.$and.every((w) => matchesWhereDocument(document, w))
  }

  // Handle $or
  if ('$or' in whereDoc && whereDoc.$or) {
    return whereDoc.$or.some((w) => matchesWhereDocument(document, w))
  }

  // Handle $contains
  if ('$contains' in whereDoc && whereDoc.$contains !== undefined) {
    if (!document) return false
    return document.includes(whereDoc.$contains)
  }

  // Handle $not_contains
  if ('$not_contains' in whereDoc && whereDoc.$not_contains !== undefined) {
    if (!document) return true
    return !document.includes(whereDoc.$not_contains)
  }

  return true
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate collection name
 */
function validateCollectionName(name: string): void {
  if (!name || name.trim() === '') {
    throw new ChromaValidationError('Collection name cannot be empty')
  }

  // Chroma collection names must match: ^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$
  const validNameRegex = /^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/
  if (!validNameRegex.test(name)) {
    throw new ChromaValidationError(
      `Invalid collection name: ${name}. Names must start and end with alphanumeric characters and can only contain alphanumeric characters, dots, dashes, and underscores.`
    )
  }
}

/**
 * Validate add/update params
 */
function validateAddParams(params: AddParams | UpdateParams | UpsertParams): void {
  if (!params.ids || params.ids.length === 0) {
    throw new ChromaValidationError('IDs array cannot be empty')
  }

  // Check for duplicate IDs in the batch
  const uniqueIds = new Set(params.ids)
  if (uniqueIds.size !== params.ids.length) {
    throw new ChromaValidationError('Duplicate IDs in batch')
  }

  // Validate embeddings length
  if (params.embeddings && params.embeddings.length !== params.ids.length) {
    throw new ChromaValidationError(
      `Embeddings count (${params.embeddings.length}) must match IDs count (${params.ids.length})`
    )
  }

  // Validate metadatas length
  if (params.metadatas && params.metadatas.length !== params.ids.length) {
    throw new ChromaValidationError(
      `Metadatas count (${params.metadatas.length}) must match IDs count (${params.ids.length})`
    )
  }

  // Validate documents length
  if (params.documents && params.documents.length !== params.ids.length) {
    throw new ChromaValidationError(
      `Documents count (${params.documents.length}) must match IDs count (${params.ids.length})`
    )
  }

  // Validate embedding dimensions
  if (params.embeddings) {
    const firstDim = params.embeddings[0]?.length
    if (firstDim === 0) {
      throw new ChromaValidationError('Embedding dimension cannot be 0')
    }

    for (let i = 0; i < params.embeddings.length; i++) {
      if (params.embeddings[i].length !== firstDim) {
        throw new ChromaValidationError(
          `Inconsistent embedding dimensions: expected ${firstDim}, got ${params.embeddings[i].length} at index ${i}`
        )
      }
    }
  }
}

// ============================================================================
// COLLECTION IMPLEMENTATION
// ============================================================================

class CollectionImpl implements ICollection {
  private _id: string
  private _name: string
  private _metadata: Metadata | null

  constructor(id: string, name: string, metadata?: Metadata | null) {
    this._id = id
    this._name = name
    this._metadata = metadata ?? null
  }

  get id(): string {
    return this._id
  }

  get name(): string {
    return this._name
  }

  get metadata(): Metadata | null {
    return this._metadata
  }

  private getStorage(): CollectionStorage {
    const storage = globalCollectionStorage.get(this._id)
    if (!storage) {
      throw new ChromaNotFoundError(`Collection '${this._name}' not found`)
    }
    return storage
  }

  async add(params: AddParams): Promise<void> {
    validateAddParams(params)

    const storage = this.getStorage()

    // Check for existing IDs
    for (const id of params.ids) {
      if (storage.documents.has(id)) {
        throw new ChromaValidationError(`ID '${id}' already exists in collection`)
      }
    }

    // Add documents
    for (let i = 0; i < params.ids.length; i++) {
      const record: DocumentRecord = {
        id: params.ids[i],
        embedding: params.embeddings?.[i] ?? [],
        metadata: params.metadatas?.[i] ?? null,
        document: params.documents?.[i] ?? null,
      }
      storage.documents.set(params.ids[i], record)
    }
  }

  async query(params: QueryParams): Promise<QueryResponse> {
    if (!params.queryEmbeddings || params.queryEmbeddings.length === 0) {
      throw new ChromaValidationError('queryEmbeddings cannot be empty')
    }

    const storage = this.getStorage()
    const nResults = params.nResults ?? 10
    const include = params.include ?? ['distances']

    const results: QueryResponse = {
      ids: [],
      distances: include.includes('distances') ? [] : undefined,
      embeddings: include.includes('embeddings') ? [] : undefined,
      documents: include.includes('documents') ? [] : undefined,
      metadatas: include.includes('metadatas') ? [] : undefined,
    }

    // Process each query embedding
    for (const queryEmbedding of params.queryEmbeddings) {
      const scored: Array<{ record: DocumentRecord; distance: number }> = []

      // Score all documents
      for (const [_, record] of storage.documents) {
        // Apply filters
        if (params.where && !matchesWhere(record.metadata, params.where)) {
          continue
        }
        if (params.whereDocument && !matchesWhereDocument(record.document, params.whereDocument)) {
          continue
        }

        const distance = cosineDistance(queryEmbedding, record.embedding)
        scored.push({ record, distance })
      }

      // Sort by distance (ascending - lower is more similar)
      scored.sort((a, b) => a.distance - b.distance)

      // Take top N
      const topN = scored.slice(0, nResults)

      // Build result arrays
      results.ids.push(topN.map((s) => s.record.id))

      if (results.distances !== undefined) {
        results.distances.push(topN.map((s) => s.distance))
      }

      if (results.embeddings !== undefined) {
        results.embeddings.push(topN.map((s) => s.record.embedding))
      }

      if (results.documents !== undefined) {
        results.documents.push(topN.map((s) => s.record.document))
      }

      if (results.metadatas !== undefined) {
        results.metadatas.push(topN.map((s) => s.record.metadata))
      }
    }

    return results
  }

  async get(params: GetParams): Promise<GetResponse> {
    const storage = this.getStorage()
    const include = params.include ?? []

    const result: GetResponse = {
      ids: [],
      embeddings: include.includes('embeddings') ? [] : undefined,
      documents: include.includes('documents') ? [] : undefined,
      metadatas: include.includes('metadatas') ? [] : undefined,
    }

    let records: DocumentRecord[] = []

    // Get by IDs or get all
    if (params.ids) {
      for (const id of params.ids) {
        const record = storage.documents.get(id)
        if (record) {
          records.push(record)
        }
      }
    } else {
      records = Array.from(storage.documents.values())
    }

    // Apply filters
    if (params.where) {
      records = records.filter((r) => matchesWhere(r.metadata, params.where!))
    }
    if (params.whereDocument) {
      records = records.filter((r) => matchesWhereDocument(r.document, params.whereDocument!))
    }

    // Apply offset and limit
    const offset = params.offset ?? 0
    const limit = params.limit ?? records.length
    records = records.slice(offset, offset + limit)

    // Build result
    for (const record of records) {
      result.ids.push(record.id)

      if (result.embeddings !== undefined) {
        result.embeddings.push(record.embedding)
      }

      if (result.documents !== undefined) {
        result.documents.push(record.document)
      }

      if (result.metadatas !== undefined) {
        result.metadatas.push(record.metadata)
      }
    }

    return result
  }

  async update(params: UpdateParams): Promise<void> {
    validateAddParams(params)

    const storage = this.getStorage()

    // Check all IDs exist
    for (const id of params.ids) {
      if (!storage.documents.has(id)) {
        throw new ChromaNotFoundError(`ID '${id}' not found in collection`)
      }
    }

    // Update documents
    for (let i = 0; i < params.ids.length; i++) {
      const record = storage.documents.get(params.ids[i])!

      if (params.embeddings?.[i]) {
        record.embedding = params.embeddings[i]
      }

      if (params.metadatas !== undefined) {
        record.metadata = params.metadatas[i]
      }

      if (params.documents !== undefined) {
        record.document = params.documents[i]
      }
    }
  }

  async upsert(params: UpsertParams): Promise<void> {
    validateAddParams(params)

    const storage = this.getStorage()

    // Upsert documents
    for (let i = 0; i < params.ids.length; i++) {
      const existing = storage.documents.get(params.ids[i])

      if (existing) {
        // Update
        if (params.embeddings?.[i]) {
          existing.embedding = params.embeddings[i]
        }
        if (params.metadatas !== undefined) {
          existing.metadata = params.metadatas[i]
        }
        if (params.documents !== undefined) {
          existing.document = params.documents[i]
        }
      } else {
        // Insert
        const record: DocumentRecord = {
          id: params.ids[i],
          embedding: params.embeddings?.[i] ?? [],
          metadata: params.metadatas?.[i] ?? null,
          document: params.documents?.[i] ?? null,
        }
        storage.documents.set(params.ids[i], record)
      }
    }
  }

  async delete(params: DeleteParams): Promise<void> {
    const storage = this.getStorage()

    if (params.ids) {
      // Delete by IDs
      for (const id of params.ids) {
        storage.documents.delete(id)
      }
    } else {
      // Delete by filter
      const toDelete: string[] = []

      for (const [id, record] of storage.documents) {
        let shouldDelete = true

        if (params.where && !matchesWhere(record.metadata, params.where)) {
          shouldDelete = false
        }
        if (params.whereDocument && !matchesWhereDocument(record.document, params.whereDocument)) {
          shouldDelete = false
        }

        if (shouldDelete) {
          toDelete.push(id)
        }
      }

      for (const id of toDelete) {
        storage.documents.delete(id)
      }
    }
  }

  async count(): Promise<number> {
    const storage = this.getStorage()
    return storage.documents.size
  }

  async modify(params: ModifyCollectionParams): Promise<void> {
    const storage = this.getStorage()

    if (params.name && params.name !== this._name) {
      // Check for name conflict
      for (const [_, s] of globalCollectionStorage) {
        if (s.model.name === params.name && s.model.id !== this._id) {
          throw new ChromaConflictError(`Collection '${params.name}' already exists`)
        }
      }

      this._name = params.name
      storage.model.name = params.name
    }

    if (params.metadata !== undefined) {
      this._metadata = params.metadata
      storage.model.metadata = params.metadata
    }
  }

  async peek(params?: PeekParams): Promise<GetResponse> {
    const limit = params?.limit ?? 10
    return this.get({ limit })
  }
}

// ============================================================================
// CHROMA CLIENT IMPLEMENTATION
// ============================================================================

class ChromaClientImpl implements ChromaClientInterface {
  private config: ChromaClientParams

  constructor(config?: ChromaClientParams) {
    this.config = config ?? {}
  }

  async createCollection(params: CreateCollectionParams): Promise<ICollection> {
    validateCollectionName(params.name)

    // Check for existing collection
    for (const [_, storage] of globalCollectionStorage) {
      if (storage.model.name === params.name) {
        throw new ChromaConflictError(`Collection '${params.name}' already exists`)
      }
    }

    const id = generateId()
    const model: CollectionModel = {
      id,
      name: params.name,
      metadata: params.metadata ?? null,
      tenant: this.config.tenant,
      database: this.config.database,
    }

    globalCollectionStorage.set(id, {
      model,
      documents: new Map(),
    })

    return new CollectionImpl(id, params.name, params.metadata)
  }

  async getCollection(params: GetCollectionParams): Promise<ICollection> {
    for (const [id, storage] of globalCollectionStorage) {
      if (storage.model.name === params.name) {
        return new CollectionImpl(id, storage.model.name, storage.model.metadata)
      }
    }

    throw new ChromaNotFoundError(`Collection '${params.name}' not found`)
  }

  async getOrCreateCollection(params: CreateCollectionParams): Promise<ICollection> {
    try {
      return await this.getCollection({ name: params.name })
    } catch (err) {
      if (err instanceof ChromaNotFoundError) {
        return await this.createCollection(params)
      }
      throw err
    }
  }

  async deleteCollection(params: DeleteCollectionParams): Promise<void> {
    for (const [id, storage] of globalCollectionStorage) {
      if (storage.model.name === params.name) {
        globalCollectionStorage.delete(id)
        return
      }
    }

    throw new ChromaNotFoundError(`Collection '${params.name}' not found`)
  }

  async listCollections(): Promise<CollectionModel[]> {
    const collections: CollectionModel[] = []
    for (const [_, storage] of globalCollectionStorage) {
      collections.push({ ...storage.model })
    }
    return collections
  }

  async countCollections(): Promise<number> {
    return globalCollectionStorage.size
  }

  async heartbeat(): Promise<number> {
    return Date.now()
  }

  async version(): Promise<string> {
    return '0.4.0-dotdo'
  }

  async reset(): Promise<void> {
    globalCollectionStorage.clear()
  }
}

// ============================================================================
// ID GENERATION
// ============================================================================

let idCounter = 0

function generateId(): string {
  idCounter++
  return `col-${idCounter.toString(36)}-${Date.now().toString(36)}`
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new ChromaClient
 *
 * The ChromaClient class is the main entry point for the SDK.
 * It provides methods for managing collections and performing document operations.
 *
 * @example
 * ```typescript
 * import { ChromaClient } from '@dotdo/chroma'
 *
 * const client = new ChromaClient()
 *
 * // Create a collection
 * const collection = await client.createCollection({ name: 'my-collection' })
 *
 * // Add documents
 * await collection.add({
 *   ids: ['id1', 'id2'],
 *   embeddings: [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
 *   metadatas: [{ source: 'doc1' }, { source: 'doc2' }],
 *   documents: ['This is document 1', 'This is document 2']
 * })
 *
 * // Query similar documents
 * const results = await collection.query({
 *   queryEmbeddings: [[1.0, 2.0, 3.0]],
 *   nResults: 5,
 * })
 * ```
 */
export class ChromaClient implements ChromaClientInterface {
  private impl: ChromaClientImpl

  constructor(config?: ChromaClientParams) {
    this.impl = new ChromaClientImpl(config)
  }

  async createCollection(params: CreateCollectionParams): Promise<ICollection> {
    return this.impl.createCollection(params)
  }

  async getCollection(params: GetCollectionParams): Promise<ICollection> {
    return this.impl.getCollection(params)
  }

  async getOrCreateCollection(params: CreateCollectionParams): Promise<ICollection> {
    return this.impl.getOrCreateCollection(params)
  }

  async deleteCollection(params: DeleteCollectionParams): Promise<void> {
    return this.impl.deleteCollection(params)
  }

  async listCollections(): Promise<CollectionModel[]> {
    return this.impl.listCollections()
  }

  async countCollections(): Promise<number> {
    return this.impl.countCollections()
  }

  async heartbeat(): Promise<number> {
    return this.impl.heartbeat()
  }

  async version(): Promise<string> {
    return this.impl.version()
  }

  async reset(): Promise<void> {
    return this.impl.reset()
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Clear all in-memory storage (useful for testing)
 */
export function _resetStorage(): void {
  globalCollectionStorage.clear()
  idCounter = 0
}

/**
 * Get storage stats (useful for debugging)
 */
export function _getStorageStats(): {
  collectionCount: number
  collections: Record<string, { documentCount: number }>
} {
  const collections: Record<string, { documentCount: number }> = {}

  for (const [id, storage] of globalCollectionStorage) {
    collections[storage.model.name] = {
      documentCount: storage.documents.size,
    }
  }

  return {
    collectionCount: globalCollectionStorage.size,
    collections,
  }
}
