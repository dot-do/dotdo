/**
 * @dotdo/pinecone - Pinecone SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for @pinecone-database/pinecone backed by
 * dotdo's edgevec HNSW vector search primitives.
 *
 * This in-memory implementation matches the Pinecone JavaScript SDK API.
 * Production version routes to Durable Objects based on config.
 *
 * @example
 * ```typescript
 * import { Pinecone } from '@dotdo/pinecone'
 *
 * const client = new Pinecone({ apiKey: 'your-api-key' })
 *
 * // Create an index
 * await client.createIndex({
 *   name: 'my-index',
 *   dimension: 768,
 *   metric: 'cosine',
 * })
 *
 * // Get an index
 * const index = client.index('my-index')
 *
 * // Upsert vectors
 * await index.upsert([
 *   { id: 'vec1', values: [0.1, 0.2, ...], metadata: { genre: 'comedy' } },
 *   { id: 'vec2', values: [0.3, 0.4, ...], metadata: { genre: 'drama' } },
 * ])
 *
 * // Query for similar vectors
 * const results = await index.query({
 *   vector: [0.1, 0.2, ...],
 *   topK: 10,
 *   filter: { genre: 'comedy' },
 *   includeMetadata: true,
 * })
 * ```
 *
 * @see https://docs.pinecone.io/reference/api/introduction
 */

import {
  createHNSWIndex,
  type HNSWIndex,
  type HNSWConfig,
} from '../../db/edgevec/hnsw'

import type {
  PineconeClient,
  PineconeClientConfig,
  Index,
  IndexNamespace,
  CreateIndexOptions,
  IndexDescription,
  IndexStats,
  NamespaceStats,
  Vector,
  ScoredVector,
  FetchedVector,
  UpsertOptions,
  UpsertResponse,
  QueryOptions,
  QueryResponse,
  FetchOptions,
  FetchResponse,
  DeleteOptions,
  DeleteResponse,
  UpdateOptions,
  UpdateResponse,
  ListOptions,
  ListResponse,
  DistanceMetric,
  RecordMetadata,
  MetadataFilter,
  MetadataFilterValue,
} from './types'

import {
  PineconeError,
  IndexNotFoundError,
  IndexAlreadyExistsError,
  DimensionMismatchError,
} from './types'

// Re-export types and errors
export * from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * Storage for a single index
 */
interface IndexStorage {
  /** Index configuration */
  config: CreateIndexOptions
  /** Namespaced HNSW indices */
  namespaces: Map<string, HNSWIndex>
  /** Metadata storage (id -> metadata) per namespace */
  metadata: Map<string, Map<string, RecordMetadata>>
  /** Creation time */
  createdAt: Date
  /** Host URL */
  host: string
  /** Deletion protection */
  deletionProtection: 'enabled' | 'disabled'
}

/**
 * Global in-memory storage for all indices
 */
const globalStorage = new Map<string, IndexStorage>()

/**
 * Clear all indices (for testing)
 */
export function clearAllIndices(): void {
  globalStorage.clear()
}

/**
 * Get storage for an index
 */
function getIndexStorage(indexName: string): IndexStorage {
  const storage = globalStorage.get(indexName)
  if (!storage) {
    throw new IndexNotFoundError(indexName)
  }
  return storage
}

/**
 * Get or create namespace within an index
 */
function getOrCreateNamespace(storage: IndexStorage, namespace: string): HNSWIndex {
  let index = storage.namespaces.get(namespace)
  if (!index) {
    // Convert Pinecone metric to HNSW metric
    const metric = storage.config.metric === 'dotproduct' ? 'dot' :
                   storage.config.metric === 'euclidean' ? 'l2' : 'cosine'

    const hnswConfig: HNSWConfig = {
      dimensions: storage.config.dimension,
      metric,
      M: 16,
      efConstruction: 200,
    }
    index = createHNSWIndex(hnswConfig)
    storage.namespaces.set(namespace, index)
    storage.metadata.set(namespace, new Map())
  }
  return index
}

/**
 * Get metadata map for a namespace
 */
function getMetadataMap(storage: IndexStorage, namespace: string): Map<string, RecordMetadata> {
  let metaMap = storage.metadata.get(namespace)
  if (!metaMap) {
    metaMap = new Map()
    storage.metadata.set(namespace, metaMap)
  }
  return metaMap
}

// ============================================================================
// METADATA FILTERING
// ============================================================================

/**
 * Check if metadata matches a filter
 */
function matchesFilter(metadata: RecordMetadata | undefined, filter: MetadataFilter): boolean {
  if (!filter || Object.keys(filter).length === 0) {
    return true
  }

  if (!metadata) {
    return false
  }

  for (const [key, filterValue] of Object.entries(filter)) {
    // Handle logical operators
    if (key === '$and') {
      const andFilters = filterValue as MetadataFilter[]
      if (!andFilters.every(f => matchesFilter(metadata, f))) {
        return false
      }
      continue
    }

    if (key === '$or') {
      const orFilters = filterValue as MetadataFilter[]
      if (!orFilters.some(f => matchesFilter(metadata, f))) {
        return false
      }
      continue
    }

    const metaValue = metadata[key]

    if (!matchesSingleFilter(metaValue, filterValue as MetadataFilterValue)) {
      return false
    }
  }

  return true
}

/**
 * Match a single metadata value against a filter
 */
function matchesSingleFilter(
  metaValue: unknown,
  filterValue: MetadataFilterValue
): boolean {
  // Direct value comparison
  if (typeof filterValue === 'string' ||
      typeof filterValue === 'number' ||
      typeof filterValue === 'boolean') {
    return metaValue === filterValue
  }

  // Object operators
  if (typeof filterValue === 'object' && filterValue !== null) {
    const op = filterValue as Record<string, unknown>

    if ('$eq' in op) {
      return metaValue === op.$eq
    }

    if ('$ne' in op) {
      return metaValue !== op.$ne
    }

    if ('$gt' in op) {
      return typeof metaValue === 'number' && metaValue > (op.$gt as number)
    }

    if ('$gte' in op) {
      return typeof metaValue === 'number' && metaValue >= (op.$gte as number)
    }

    if ('$lt' in op) {
      return typeof metaValue === 'number' && metaValue < (op.$lt as number)
    }

    if ('$lte' in op) {
      return typeof metaValue === 'number' && metaValue <= (op.$lte as number)
    }

    if ('$in' in op) {
      const inValues = op.$in as unknown[]
      return inValues.includes(metaValue)
    }

    if ('$nin' in op) {
      const ninValues = op.$nin as unknown[]
      return !ninValues.includes(metaValue)
    }

    if ('$exists' in op) {
      const exists = metaValue !== undefined && metaValue !== null
      return op.$exists ? exists : !exists
    }
  }

  return false
}

// ============================================================================
// INDEX NAMESPACE IMPLEMENTATION
// ============================================================================

/**
 * Implementation of namespaced index operations
 */
class IndexNamespaceImpl implements IndexNamespace {
  constructor(
    private storage: IndexStorage,
    private namespace: string
  ) {}

  async upsert(vectors: Vector[]): Promise<UpsertResponse> {
    const index = getOrCreateNamespace(this.storage, this.namespace)
    const metaMap = getMetadataMap(this.storage, this.namespace)

    let upsertedCount = 0

    for (const vec of vectors) {
      // Validate dimension
      if (vec.values.length !== this.storage.config.dimension) {
        throw new DimensionMismatchError(this.storage.config.dimension, vec.values.length)
      }

      const float32Values = new Float32Array(vec.values)
      index.insert(vec.id, float32Values)

      // Store metadata separately
      if (vec.metadata) {
        metaMap.set(vec.id, vec.metadata)
      }

      upsertedCount++
    }

    return { upsertedCount }
  }

  async query(options: Omit<QueryOptions, 'namespace'>): Promise<QueryResponse> {
    // Handle query by ID
    let queryVector = options.vector

    if (options.id && !queryVector) {
      const index = this.storage.namespaces.get(this.namespace)
      if (index) {
        const vec = index.getVector(options.id)
        if (vec) {
          queryVector = Array.from(vec)
        }
      }
    }

    if (!queryVector) {
      throw new PineconeError('Either vector or id must be provided for query')
    }

    // Validate dimension
    if (queryVector.length !== this.storage.config.dimension) {
      throw new DimensionMismatchError(this.storage.config.dimension, queryVector.length)
    }

    const index = this.storage.namespaces.get(this.namespace)
    const metaMap = this.storage.metadata.get(this.namespace)

    if (!index || index.size() === 0) {
      return {
        matches: [],
        namespace: this.namespace,
        usage: { readUnits: 1 },
      }
    }

    // Search in HNSW index
    const results = index.search(new Float32Array(queryVector), {
      k: options.topK * 2, // Fetch extra for filtering
      ef: Math.max(options.topK * 2, 100),
    })

    // Apply metadata filter
    let matches: ScoredVector[] = []

    for (const result of results) {
      const metadata = metaMap?.get(result.id)

      // Apply filter
      if (options.filter && !matchesFilter(metadata, options.filter)) {
        continue
      }

      const match: ScoredVector = {
        id: result.id,
        score: result.score,
      }

      if (options.includeValues) {
        const vec = index.getVector(result.id)
        if (vec) {
          match.values = Array.from(vec)
        }
      }

      if (options.includeMetadata && metadata) {
        match.metadata = metadata
      }

      matches.push(match)

      if (matches.length >= options.topK) {
        break
      }
    }

    return {
      matches,
      namespace: this.namespace,
      usage: { readUnits: 1 },
    }
  }

  async fetch(ids: string[]): Promise<FetchResponse> {
    const index = this.storage.namespaces.get(this.namespace)
    const metaMap = this.storage.metadata.get(this.namespace)

    const vectors: Record<string, FetchedVector> = {}

    if (index) {
      for (const id of ids) {
        const vec = index.getVector(id)
        if (vec) {
          vectors[id] = {
            id,
            values: Array.from(vec),
            metadata: metaMap?.get(id),
          }
        }
      }
    }

    return {
      vectors,
      namespace: this.namespace,
      usage: { readUnits: 1 },
    }
  }

  async delete(options: Omit<DeleteOptions, 'namespace'>): Promise<DeleteResponse> {
    const index = this.storage.namespaces.get(this.namespace)
    const metaMap = this.storage.metadata.get(this.namespace)

    if (!index) {
      return {}
    }

    if (options.deleteAll) {
      // Delete entire namespace
      this.storage.namespaces.delete(this.namespace)
      this.storage.metadata.delete(this.namespace)
      return {}
    }

    if (options.ids) {
      // Delete specific IDs
      for (const id of options.ids) {
        index.delete(id)
        metaMap?.delete(id)
      }
    }

    if (options.filter) {
      // Delete by filter - need to iterate all vectors
      const toDelete: string[] = []

      // Iterate through metadata to find matching vectors
      if (metaMap) {
        for (const [id, metadata] of metaMap.entries()) {
          if (matchesFilter(metadata, options.filter)) {
            toDelete.push(id)
          }
        }
      }

      for (const id of toDelete) {
        index.delete(id)
        metaMap?.delete(id)
      }
    }

    return {}
  }

  async update(options: Omit<UpdateOptions, 'namespace'>): Promise<UpdateResponse> {
    const index = this.storage.namespaces.get(this.namespace)
    const metaMap = getMetadataMap(this.storage, this.namespace)

    if (!index) {
      throw new PineconeError(`Vector ${options.id} not found`)
    }

    if (!index.has(options.id)) {
      throw new PineconeError(`Vector ${options.id} not found`)
    }

    // Update values if provided
    if (options.values) {
      if (options.values.length !== this.storage.config.dimension) {
        throw new DimensionMismatchError(this.storage.config.dimension, options.values.length)
      }
      index.insert(options.id, new Float32Array(options.values))
    }

    // Update metadata if provided
    if (options.setMetadata) {
      metaMap.set(options.id, options.setMetadata)
    }

    return {}
  }

  async listPaginated(options?: Omit<ListOptions, 'namespace'>): Promise<ListResponse> {
    const index = this.storage.namespaces.get(this.namespace)

    if (!index || index.size() === 0) {
      return {
        vectors: [],
        namespace: this.namespace,
        usage: { readUnits: 1 },
      }
    }

    // Collect all IDs
    const allIds: string[] = []
    const stats = index.getStats()

    // We need to iterate through the index to get IDs
    // This is a limitation - HNSW doesn't have a natural listing method
    // For now, use metadata map as source of truth for IDs
    const metaMap = this.storage.metadata.get(this.namespace)
    if (metaMap) {
      for (const id of metaMap.keys()) {
        if (index.has(id)) {
          allIds.push(id)
        }
      }
    }

    // Also check for IDs in the index that might not have metadata
    // This is a workaround - in production we'd track IDs separately

    // Apply prefix filter
    let filteredIds = allIds
    if (options?.prefix) {
      filteredIds = allIds.filter(id => id.startsWith(options.prefix!))
    }

    // Sort for consistent pagination
    filteredIds.sort()

    // Apply pagination
    const limit = options?.limit ?? 100
    let startIndex = 0

    if (options?.paginationToken) {
      startIndex = parseInt(options.paginationToken, 10) || 0
    }

    const endIndex = startIndex + limit
    const pageIds = filteredIds.slice(startIndex, endIndex)

    const hasMore = endIndex < filteredIds.length
    const nextToken = hasMore ? String(endIndex) : undefined

    return {
      vectors: pageIds.map(id => ({ id })),
      pagination: nextToken ? { next: nextToken } : undefined,
      namespace: this.namespace,
      usage: { readUnits: 1 },
    }
  }
}

// ============================================================================
// INDEX IMPLEMENTATION
// ============================================================================

/**
 * Implementation of index operations
 */
class IndexImpl implements Index {
  private storage: IndexStorage

  constructor(indexName: string) {
    this.storage = getIndexStorage(indexName)
  }

  namespace(namespace: string): IndexNamespace {
    return new IndexNamespaceImpl(this.storage, namespace)
  }

  async describeIndexStats(): Promise<IndexStats> {
    const namespaces: Record<string, NamespaceStats> = {}
    let totalVectorCount = 0

    for (const [ns, index] of this.storage.namespaces) {
      const count = index.size()
      namespaces[ns] = { vectorCount: count }
      totalVectorCount += count
    }

    // Include default namespace even if empty
    if (!namespaces['']) {
      namespaces[''] = { vectorCount: 0 }
    }

    return {
      totalVectorCount,
      namespaces,
      dimension: this.storage.config.dimension,
      indexFullness: 0, // Would need max capacity info
    }
  }

  async upsert(vectors: Vector[], options?: UpsertOptions): Promise<UpsertResponse> {
    const ns = options?.namespace ?? ''
    return this.namespace(ns).upsert(vectors)
  }

  async query(options: QueryOptions): Promise<QueryResponse> {
    const ns = options.namespace ?? ''
    return this.namespace(ns).query(options)
  }

  async fetch(ids: string[], options?: Omit<FetchOptions, 'ids'>): Promise<FetchResponse> {
    const ns = options?.namespace ?? ''
    return this.namespace(ns).fetch(ids)
  }

  async delete(options: DeleteOptions): Promise<DeleteResponse> {
    const ns = options.namespace ?? ''
    return this.namespace(ns).delete(options)
  }

  async update(options: UpdateOptions): Promise<UpdateResponse> {
    const ns = options.namespace ?? ''
    return this.namespace(ns).update(options)
  }

  async listPaginated(options?: ListOptions): Promise<ListResponse> {
    const ns = options?.namespace ?? ''
    return this.namespace(ns).listPaginated(options)
  }
}

// ============================================================================
// PINECONE CLIENT IMPLEMENTATION
// ============================================================================

/**
 * Pinecone client implementation
 *
 * Provides a drop-in replacement for the official Pinecone SDK,
 * backed by dotdo's edgevec HNSW vector search.
 *
 * @example
 * ```typescript
 * const client = new Pinecone({ apiKey: 'your-api-key' })
 *
 * // Create index
 * await client.createIndex({
 *   name: 'my-index',
 *   dimension: 768,
 *   metric: 'cosine',
 * })
 *
 * // Use index
 * const index = client.index('my-index')
 * await index.upsert([...])
 * const results = await index.query({ vector: [...], topK: 10 })
 * ```
 */
export class Pinecone implements PineconeClient {
  private config: PineconeClientConfig

  constructor(config: PineconeClientConfig) {
    this.config = config
  }

  async createIndex(options: CreateIndexOptions): Promise<void> {
    // Check if index already exists
    if (globalStorage.has(options.name)) {
      throw new IndexAlreadyExistsError(options.name)
    }

    // Validate dimension
    if (options.dimension <= 0) {
      throw new PineconeError('Dimension must be positive')
    }

    // Create storage for the index
    const storage: IndexStorage = {
      config: {
        ...options,
        metric: options.metric ?? 'cosine',
      },
      namespaces: new Map(),
      metadata: new Map(),
      createdAt: new Date(),
      host: `${options.name}-dotdo.pinecone.io`,
      deletionProtection: options.deletion_protection ?? 'disabled',
    }

    globalStorage.set(options.name, storage)
  }

  async deleteIndex(indexName: string): Promise<void> {
    const storage = globalStorage.get(indexName)
    if (!storage) {
      throw new IndexNotFoundError(indexName)
    }

    if (storage.deletionProtection === 'enabled') {
      throw new PineconeError('Index has deletion protection enabled')
    }

    globalStorage.delete(indexName)
  }

  async describeIndex(indexName: string): Promise<IndexDescription> {
    const storage = getIndexStorage(indexName)

    return {
      name: indexName,
      dimension: storage.config.dimension,
      metric: storage.config.metric ?? 'cosine',
      host: storage.host,
      spec: storage.config.spec ?? { serverless: { cloud: 'aws', region: 'us-east-1' } },
      status: {
        ready: true,
        state: 'Ready',
      },
      deletion_protection: storage.deletionProtection,
    }
  }

  async listIndexes(): Promise<{ indexes: Array<{ name: string; dimension: number; metric: DistanceMetric; host: string }> }> {
    const indexes: Array<{ name: string; dimension: number; metric: DistanceMetric; host: string }> = []

    for (const [name, storage] of globalStorage) {
      indexes.push({
        name,
        dimension: storage.config.dimension,
        metric: storage.config.metric ?? 'cosine',
        host: storage.host,
      })
    }

    return { indexes }
  }

  index(indexName: string): Index {
    // Verify index exists
    getIndexStorage(indexName)
    return new IndexImpl(indexName)
  }

  async configureIndex(indexName: string, options: { deletionProtection?: 'enabled' | 'disabled' }): Promise<void> {
    const storage = getIndexStorage(indexName)

    if (options.deletionProtection !== undefined) {
      storage.deletionProtection = options.deletionProtection
    }
  }
}

/**
 * Default export for CommonJS compatibility
 */
export default Pinecone
