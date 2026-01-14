/**
 * @dotdo/pinecone - Pinecone SDK compat
 *
 * Drop-in replacement for @pinecone-database/pinecone backed by DO SQLite
 * with tiered vector storage. This in-memory implementation matches
 * the Pinecone TypeScript SDK API.
 *
 * @see https://docs.pinecone.io/reference/typescript-sdk
 */
import type {
  PineconeConfiguration,
  ExtendedPineconeConfiguration,
  IndexModel,
  IndexList,
  CreateIndexOptions,
  ConfigureIndexOptions,
  Metric,
  RecordMetadata,
  PineconeRecord,
  ScoredPineconeRecord,
  QueryOptions,
  QueryResponse,
  UpsertResponse,
  FetchResponse,
  DeleteOptions,
  DeleteResponse,
  UpdateOptions,
  UpdateResponse,
  ListOptions,
  ListResponse,
  DescribeIndexStatsResponse,
  NamespaceStats,
  MetadataFilter,
  MetadataFilterOperators,
  RecordMetadataValue,
  CollectionModel,
  CollectionList,
  CreateCollectionOptions,
  Index as IIndex,
  IndexNamespace as IIndexNamespace,
  PineconeClient as IPineconeClient,
} from './types'

import {
  PineconeError,
  PineconeConfigurationError,
  PineconeNotFoundError,
  PineconeConflictError,
  PineconeValidationError,
} from './types'

// Re-export types and error classes
export {
  PineconeError,
  PineconeConfigurationError,
  PineconeConnectionError,
  PineconeNotFoundError,
  PineconeConflictError,
  PineconeValidationError,
  PineconeRequestError,
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * Storage for a single namespace
 */
interface NamespaceStorage<T extends RecordMetadata = RecordMetadata> {
  vectors: Map<string, PineconeRecord<T>>
}

/**
 * Storage for an index
 */
interface IndexStorage {
  model: IndexModel
  namespaces: Map<string, NamespaceStorage>
}

/**
 * Global in-memory storage for all indexes
 */
const globalIndexStorage = new Map<string, IndexStorage>()

/**
 * Global storage for collections
 */
const globalCollectionStorage = new Map<string, CollectionModel>()

/**
 * Get or create namespace storage
 */
function getNamespaceStorage<T extends RecordMetadata = RecordMetadata>(
  indexName: string,
  namespace: string
): NamespaceStorage<T> {
  const indexStorage = globalIndexStorage.get(indexName)
  if (!indexStorage) {
    throw new PineconeNotFoundError(`Index '${indexName}' not found`)
  }

  let nsStorage = indexStorage.namespaces.get(namespace) as NamespaceStorage<T> | undefined
  if (!nsStorage) {
    nsStorage = { vectors: new Map() }
    indexStorage.namespaces.set(namespace, nsStorage as NamespaceStorage)
  }

  return nsStorage
}

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
 * Calculate Euclidean distance between two vectors
 * Returns a similarity score (higher is more similar)
 */
function euclideanSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }

  // Convert distance to similarity (smaller distance = higher score)
  // Using 1 / (1 + distance) formula
  return 1 / (1 + Math.sqrt(sum))
}

/**
 * Calculate dot product of two vectors
 */
function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i]
  }
  return sum
}

/**
 * Calculate similarity based on metric
 */
function calculateSimilarity(
  a: number[],
  b: number[],
  metric: Metric
): number {
  switch (metric) {
    case 'euclidean':
      return euclideanSimilarity(a, b)
    case 'dotproduct':
      return dotProduct(a, b)
    case 'cosine':
    default:
      return cosineSimilarity(a, b)
  }
}

// ============================================================================
// METADATA FILTERING
// ============================================================================

/**
 * Check if a value matches a filter operator
 */
function matchesOperator(
  value: RecordMetadataValue | undefined,
  operator: MetadataFilterOperators
): boolean {
  if (operator.$exists !== undefined) {
    const exists = value !== undefined && value !== null
    return operator.$exists === exists
  }

  if (value === undefined || value === null) {
    return false
  }

  if (operator.$eq !== undefined) {
    return deepEquals(value, operator.$eq)
  }

  if (operator.$ne !== undefined) {
    return !deepEquals(value, operator.$ne)
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
    return operator.$in.some((v) => deepEquals(value, v))
  }

  if (operator.$nin !== undefined) {
    return !operator.$nin.some((v) => deepEquals(value, v))
  }

  return true
}

/**
 * Deep equality check for metadata values
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (a === undefined || b === undefined) return a === b

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((val, i) => deepEquals(val, b[i]))
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object)
    const keysB = Object.keys(b as object)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) =>
      deepEquals((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    )
  }

  return false
}

/**
 * Check if a value is a filter operator object
 */
function isOperator(value: unknown): value is MetadataFilterOperators {
  if (typeof value !== 'object' || value === null) return false
  const keys = Object.keys(value)
  return keys.some((k) =>
    ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists'].includes(k)
  )
}

/**
 * Get nested value from metadata
 */
function getNestedValue(obj: RecordMetadata, path: string): RecordMetadataValue | undefined {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current as RecordMetadataValue | undefined
}

/**
 * Check if metadata matches a filter
 */
function matchesFilter(
  metadata: RecordMetadata | undefined,
  filter: MetadataFilter
): boolean {
  if (!filter || Object.keys(filter).length === 0) {
    return true
  }

  // Handle $and
  if ('$and' in filter && filter.$and) {
    return filter.$and.every((f) => matchesFilter(metadata, f))
  }

  // Handle $or
  if ('$or' in filter && filter.$or) {
    return filter.$or.some((f) => matchesFilter(metadata, f))
  }

  // Handle field filters
  for (const [key, condition] of Object.entries(filter)) {
    if (key === '$and' || key === '$or') continue

    const value = metadata ? getNestedValue(metadata, key) : undefined

    if (isOperator(condition)) {
      if (!matchesOperator(value, condition)) {
        return false
      }
    } else if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
      // Nested filter - recursively check
      if (!matchesFilter(metadata, condition as MetadataFilter)) {
        return false
      }
    } else {
      // Direct equality
      if (!deepEquals(value, condition)) {
        return false
      }
    }
  }

  return true
}

// ============================================================================
// INDEX NAMESPACE IMPLEMENTATION
// ============================================================================

class IndexNamespaceImpl<T extends RecordMetadata = RecordMetadata>
  implements IIndexNamespace<T>
{
  private indexName: string
  private _namespace: string
  private metric: Metric
  private dimension: number

  constructor(
    indexName: string,
    namespace: string,
    metric: Metric,
    dimension: number
  ) {
    this.indexName = indexName
    this._namespace = namespace
    this.metric = metric
    this.dimension = dimension
  }

  get namespace(): string {
    return this._namespace
  }

  private getStorage(): NamespaceStorage<T> {
    return getNamespaceStorage<T>(this.indexName, this._namespace)
  }

  async upsert(vectors: PineconeRecord<T>[]): Promise<UpsertResponse> {
    const storage = this.getStorage()

    for (const vector of vectors) {
      // Validate dimension
      if (vector.values.length !== this.dimension) {
        throw new PineconeValidationError(
          `Vector dimension ${vector.values.length} does not match index dimension ${this.dimension}`
        )
      }

      storage.vectors.set(vector.id, {
        id: vector.id,
        values: [...vector.values],
        sparseValues: vector.sparseValues
          ? {
              indices: [...vector.sparseValues.indices],
              values: [...vector.sparseValues.values],
            }
          : undefined,
        metadata: vector.metadata ? { ...vector.metadata } : undefined,
      })
    }

    return { upsertedCount: vectors.length }
  }

  async query(options: QueryOptions<T>): Promise<QueryResponse<T>> {
    const storage = this.getStorage()
    const results: ScoredPineconeRecord<T>[] = []

    // Handle query by ID
    let queryVector = options.vector
    if (options.id && !queryVector) {
      const record = storage.vectors.get(options.id)
      if (record) {
        queryVector = record.values
      } else {
        // ID not found, return empty results
        return {
          matches: [],
          namespace: this._namespace,
          usage: { readUnits: 1 },
        }
      }
    }

    if (!queryVector) {
      throw new PineconeValidationError('Query must include either vector or id')
    }

    // Search all vectors
    for (const [id, record] of storage.vectors) {
      // Apply metadata filter
      if (options.filter && !matchesFilter(record.metadata, options.filter)) {
        continue
      }

      const score = calculateSimilarity(queryVector, record.values, this.metric)

      const scoredRecord: ScoredPineconeRecord<T> = {
        id,
        score,
      }

      if (options.includeValues) {
        scoredRecord.values = [...record.values]
        if (record.sparseValues) {
          scoredRecord.sparseValues = {
            indices: [...record.sparseValues.indices],
            values: [...record.sparseValues.values],
          }
        }
      }

      if (options.includeMetadata && record.metadata) {
        scoredRecord.metadata = { ...record.metadata } as T
      }

      results.push(scoredRecord)
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score)

    // Apply topK limit
    const topResults = results.slice(0, options.topK)

    return {
      matches: topResults,
      namespace: this._namespace,
      usage: { readUnits: 1 },
    }
  }

  async fetch(ids: string[]): Promise<FetchResponse<T>> {
    const storage = this.getStorage()
    const records: Record<string, PineconeRecord<T>> = {}

    for (const id of ids) {
      const record = storage.vectors.get(id)
      if (record) {
        records[id] = {
          id: record.id,
          values: [...record.values],
          sparseValues: record.sparseValues
            ? {
                indices: [...record.sparseValues.indices],
                values: [...record.sparseValues.values],
              }
            : undefined,
          metadata: record.metadata ? { ...record.metadata } as T : undefined,
        }
      }
    }

    return {
      records,
      namespace: this._namespace,
      usage: { readUnits: ids.length },
    }
  }

  async update(options: UpdateOptions<T>): Promise<UpdateResponse> {
    const storage = this.getStorage()
    const record = storage.vectors.get(options.id)

    if (!record) {
      throw new PineconeNotFoundError(`Vector '${options.id}' not found`)
    }

    if (options.values) {
      if (options.values.length !== this.dimension) {
        throw new PineconeValidationError(
          `Vector dimension ${options.values.length} does not match index dimension ${this.dimension}`
        )
      }
      record.values = [...options.values]
    }

    if (options.sparseValues) {
      record.sparseValues = {
        indices: [...options.sparseValues.indices],
        values: [...options.sparseValues.values],
      }
    }

    if (options.metadata) {
      record.metadata = {
        ...(record.metadata ?? {}),
        ...options.metadata,
      } as T
    }

    return {}
  }

  async delete(options: DeleteOptions): Promise<DeleteResponse> {
    const storage = this.getStorage()

    if (options.deleteAll) {
      storage.vectors.clear()
      return {}
    }

    if (options.ids) {
      for (const id of options.ids) {
        storage.vectors.delete(id)
      }
      return {}
    }

    if (options.filter) {
      const toDelete: string[] = []
      for (const [id, record] of storage.vectors) {
        if (matchesFilter(record.metadata, options.filter)) {
          toDelete.push(id)
        }
      }
      for (const id of toDelete) {
        storage.vectors.delete(id)
      }
      return {}
    }

    return {}
  }

  async deleteOne(id: string): Promise<DeleteResponse> {
    return this.delete({ ids: [id] })
  }

  async deleteMany(ids: string[]): Promise<DeleteResponse> {
    return this.delete({ ids })
  }

  async deleteAll(): Promise<DeleteResponse> {
    return this.delete({ deleteAll: true })
  }

  async listPaginated(options?: ListOptions): Promise<ListResponse> {
    const storage = this.getStorage()
    const limit = options?.limit ?? 100
    const prefix = options?.prefix

    let ids = Array.from(storage.vectors.keys())

    // Apply prefix filter
    if (prefix) {
      ids = ids.filter((id) => id.startsWith(prefix))
    }

    // Sort for consistent pagination
    ids.sort()

    // Apply pagination token
    let startIndex = 0
    if (options?.paginationToken) {
      const tokenIndex = ids.indexOf(options.paginationToken)
      if (tokenIndex >= 0) {
        startIndex = tokenIndex + 1
      }
    }

    const pageIds = ids.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < ids.length

    return {
      vectors: pageIds.map((id) => ({ id })),
      pagination: hasMore ? { next: pageIds[pageIds.length - 1] } : undefined,
      namespace: this._namespace,
      usage: { readUnits: 1 },
    }
  }

  async describeIndexStats(filter?: MetadataFilter): Promise<DescribeIndexStatsResponse> {
    const storage = this.getStorage()

    let count = 0
    if (filter) {
      for (const [_, record] of storage.vectors) {
        if (matchesFilter(record.metadata, filter)) {
          count++
        }
      }
    } else {
      count = storage.vectors.size
    }

    return {
      namespaces: {
        [this._namespace]: { vectorCount: count },
      },
      dimension: this.dimension,
      indexFullness: 0,
      totalVectorCount: count,
    }
  }
}

// ============================================================================
// INDEX IMPLEMENTATION
// ============================================================================

class IndexImpl<T extends RecordMetadata = RecordMetadata>
  extends IndexNamespaceImpl<T>
  implements IIndex<T>
{
  private indexName_: string
  private metric_: Metric
  private dimension_: number

  constructor(indexName: string, metric: Metric, dimension: number) {
    super(indexName, '', metric, dimension)
    this.indexName_ = indexName
    this.metric_ = metric
    this.dimension_ = dimension
  }

  namespace(name: string): IIndexNamespace<T> {
    return new IndexNamespaceImpl<T>(
      this.indexName_,
      name,
      this.metric_,
      this.dimension_
    )
  }

  async describeIndexStats(filter?: MetadataFilter): Promise<DescribeIndexStatsResponse> {
    const indexStorage = globalIndexStorage.get(this.indexName_)
    if (!indexStorage) {
      throw new PineconeNotFoundError(`Index '${this.indexName_}' not found`)
    }

    const namespaces: Record<string, NamespaceStats> = {}
    let totalCount = 0

    for (const [nsName, nsStorage] of indexStorage.namespaces) {
      let count = 0
      if (filter) {
        for (const [_, record] of nsStorage.vectors) {
          if (matchesFilter(record.metadata, filter)) {
            count++
          }
        }
      } else {
        count = nsStorage.vectors.size
      }
      namespaces[nsName] = { vectorCount: count }
      totalCount += count
    }

    return {
      namespaces,
      dimension: this.dimension_,
      indexFullness: 0,
      totalVectorCount: totalCount,
    }
  }
}

// ============================================================================
// PINECONE CLIENT IMPLEMENTATION
// ============================================================================

class PineconeImpl implements IPineconeClient {
  private config: ExtendedPineconeConfiguration

  constructor(config?: PineconeConfiguration | ExtendedPineconeConfiguration) {
    if (!config?.apiKey) {
      // Allow empty apiKey for local/testing mode
      this.config = { apiKey: '', ...config } as ExtendedPineconeConfiguration
    } else {
      this.config = config as ExtendedPineconeConfiguration
    }
  }

  index<T extends RecordMetadata = RecordMetadata>(name: string): IIndex<T> {
    const indexStorage = globalIndexStorage.get(name)
    if (!indexStorage) {
      throw new PineconeNotFoundError(`Index '${name}' not found`)
    }

    return new IndexImpl<T>(
      name,
      indexStorage.model.metric,
      indexStorage.model.dimension
    )
  }

  async createIndex(options: CreateIndexOptions): Promise<IndexModel> {
    // Check for existing index
    if (globalIndexStorage.has(options.name)) {
      if (options.suppressConflicts) {
        return globalIndexStorage.get(options.name)!.model
      }
      throw new PineconeConflictError(`Index '${options.name}' already exists`)
    }

    // Validate dimension
    if (options.dimension <= 0) {
      throw new PineconeValidationError('Dimension must be a positive integer')
    }

    const model: IndexModel = {
      name: options.name,
      dimension: options.dimension,
      metric: options.metric ?? 'cosine',
      host: `${options.name}-local.pinecone.io`,
      spec: options.spec ?? {
        serverless: {
          cloud: 'aws',
          region: 'us-east-1',
        },
      },
      status: {
        ready: true,
        state: 'Ready',
      },
      deletionProtection: options.deletionProtection ?? 'disabled',
    }

    globalIndexStorage.set(options.name, {
      model,
      namespaces: new Map(),
    })

    return model
  }

  async deleteIndex(name: string): Promise<void> {
    const indexStorage = globalIndexStorage.get(name)
    if (!indexStorage) {
      throw new PineconeNotFoundError(`Index '${name}' not found`)
    }

    if (indexStorage.model.deletionProtection === 'enabled') {
      throw new PineconeError(`Cannot delete index '${name}' - deletion protection is enabled`)
    }

    globalIndexStorage.delete(name)
  }

  async listIndexes(): Promise<IndexList> {
    const indexes: IndexModel[] = []
    for (const [_, storage] of globalIndexStorage) {
      indexes.push({ ...storage.model })
    }
    return { indexes }
  }

  async describeIndex(name: string): Promise<IndexModel> {
    const indexStorage = globalIndexStorage.get(name)
    if (!indexStorage) {
      throw new PineconeNotFoundError(`Index '${name}' not found`)
    }
    return { ...indexStorage.model }
  }

  async configureIndex(
    name: string,
    options: ConfigureIndexOptions
  ): Promise<IndexModel> {
    const indexStorage = globalIndexStorage.get(name)
    if (!indexStorage) {
      throw new PineconeNotFoundError(`Index '${name}' not found`)
    }

    if (options.deletionProtection !== undefined) {
      indexStorage.model.deletionProtection = options.deletionProtection
    }

    if (options.replicas !== undefined && indexStorage.model.spec.pod) {
      indexStorage.model.spec.pod.replicas = options.replicas
    }

    if (options.podType !== undefined && indexStorage.model.spec.pod) {
      indexStorage.model.spec.pod.podType = options.podType
    }

    return { ...indexStorage.model }
  }

  async createCollection(options: CreateCollectionOptions): Promise<CollectionModel> {
    if (globalCollectionStorage.has(options.name)) {
      throw new PineconeConflictError(`Collection '${options.name}' already exists`)
    }

    const sourceIndex = globalIndexStorage.get(options.source)
    if (!sourceIndex) {
      throw new PineconeNotFoundError(`Source index '${options.source}' not found`)
    }

    // Calculate total vectors in source
    let vectorCount = 0
    for (const ns of sourceIndex.namespaces.values()) {
      vectorCount += ns.vectors.size
    }

    const collection: CollectionModel = {
      name: options.name,
      size: vectorCount * 100, // Approximate size
      status: 'Ready',
      dimension: sourceIndex.model.dimension,
      vectorCount,
      environment: 'local',
    }

    globalCollectionStorage.set(options.name, collection)
    return collection
  }

  async listCollections(): Promise<CollectionList> {
    const collections: CollectionModel[] = []
    for (const [_, collection] of globalCollectionStorage) {
      collections.push({ ...collection })
    }
    return { collections }
  }

  async describeCollection(name: string): Promise<CollectionModel> {
    const collection = globalCollectionStorage.get(name)
    if (!collection) {
      throw new PineconeNotFoundError(`Collection '${name}' not found`)
    }
    return { ...collection }
  }

  async deleteCollection(name: string): Promise<void> {
    if (!globalCollectionStorage.has(name)) {
      throw new PineconeNotFoundError(`Collection '${name}' not found`)
    }
    globalCollectionStorage.delete(name)
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new Pinecone client
 *
 * The Pinecone class is the main entry point for the SDK.
 * It provides methods for managing indexes and performing vector operations.
 *
 * @example
 * ```typescript
 * import { Pinecone } from '@dotdo/pinecone'
 *
 * const pinecone = new Pinecone({ apiKey: 'your-api-key' })
 *
 * // Create an index
 * await pinecone.createIndex({
 *   name: 'my-index',
 *   dimension: 1536,
 *   metric: 'cosine',
 * })
 *
 * // Get index handle and upsert vectors
 * const index = pinecone.index('my-index')
 * await index.upsert([
 *   { id: 'vec1', values: [0.1, 0.2, ...] },
 *   { id: 'vec2', values: [0.3, 0.4, ...] },
 * ])
 *
 * // Query similar vectors
 * const results = await index.query({
 *   vector: [0.1, 0.2, ...],
 *   topK: 10,
 *   includeMetadata: true,
 * })
 * ```
 */
export class Pinecone implements IPineconeClient {
  private impl: PineconeImpl

  constructor(config?: PineconeConfiguration | ExtendedPineconeConfiguration) {
    this.impl = new PineconeImpl(config)
  }

  index<T extends RecordMetadata = RecordMetadata>(name: string): IIndex<T> {
    return this.impl.index<T>(name)
  }

  async createIndex(options: CreateIndexOptions): Promise<IndexModel> {
    return this.impl.createIndex(options)
  }

  async deleteIndex(name: string): Promise<void> {
    return this.impl.deleteIndex(name)
  }

  async listIndexes(): Promise<IndexList> {
    return this.impl.listIndexes()
  }

  async describeIndex(name: string): Promise<IndexModel> {
    return this.impl.describeIndex(name)
  }

  async configureIndex(
    name: string,
    options: ConfigureIndexOptions
  ): Promise<IndexModel> {
    return this.impl.configureIndex(name, options)
  }

  async createCollection(options: CreateCollectionOptions): Promise<CollectionModel> {
    return this.impl.createCollection(options)
  }

  async listCollections(): Promise<CollectionList> {
    return this.impl.listCollections()
  }

  async describeCollection(name: string): Promise<CollectionModel> {
    return this.impl.describeCollection(name)
  }

  async deleteCollection(name: string): Promise<void> {
    return this.impl.deleteCollection(name)
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Clear all in-memory storage (useful for testing)
 */
export function _resetStorage(): void {
  globalIndexStorage.clear()
  globalCollectionStorage.clear()
}

/**
 * Get storage stats (useful for debugging)
 */
export function _getStorageStats(): {
  indexCount: number
  collectionCount: number
  indexes: Record<string, { namespaces: number; vectors: number }>
} {
  const indexes: Record<string, { namespaces: number; vectors: number }> = {}

  for (const [name, storage] of globalIndexStorage) {
    let totalVectors = 0
    for (const ns of storage.namespaces.values()) {
      totalVectors += ns.vectors.size
    }
    indexes[name] = {
      namespaces: storage.namespaces.size,
      vectors: totalVectors,
    }
  }

  return {
    indexCount: globalIndexStorage.size,
    collectionCount: globalCollectionStorage.size,
    indexes,
  }
}
