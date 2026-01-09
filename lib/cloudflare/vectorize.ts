/**
 * Vectorize Integration Layer
 *
 * Comprehensive Vectorize integration for dotdo providing:
 * - Vector embedding storage
 * - Similarity search with metadata filtering
 * - Batch operations (insert, upsert, delete)
 * - Namespace support for multi-tenant isolation
 * - Integration with Workers AI for embedding generation
 *
 * @module lib/cloudflare/vectorize
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Environment bindings for Vectorize
 */
export interface VectorizeEnv {
  /** Vectorize index binding */
  VECTORS?: VectorizeIndex
  /** Workers AI binding for embedding generation */
  AI?: Ai
}

/**
 * Configuration options for VectorizeClient
 */
export interface VectorizeConfig {
  /** Default namespace for vector operations */
  namespace?: string
  /** Default number of results for queries */
  defaultTopK?: number
  /** Whether to return vector values by default */
  returnValues?: boolean
  /** Whether to return metadata by default */
  returnMetadata?: boolean | 'all' | 'indexed' | 'none'
  /** Batch size for bulk operations */
  batchSize?: number
}

/**
 * Vector to be inserted or upserted
 */
export interface Vector {
  /** Unique identifier for the vector */
  id: string
  /** Vector values (embedding) */
  values: number[] | Float32Array | Float64Array
  /** Optional namespace */
  namespace?: string
  /** Optional metadata associated with the vector */
  metadata?: VectorMetadata
}

/**
 * Metadata associated with a vector
 */
export type VectorMetadata = Record<string, VectorMetadataValue>

/**
 * Valid metadata value types
 */
export type VectorMetadataValue = string | number | boolean | string[]

/**
 * Query options for similarity search
 */
export interface QueryOptions {
  /** Number of results to return (default: 10) */
  topK?: number
  /** Namespace to search in */
  namespace?: string
  /** Whether to return vector values */
  returnValues?: boolean
  /** Whether to return metadata */
  returnMetadata?: boolean | 'all' | 'indexed' | 'none'
  /** Metadata filter criteria */
  filter?: MetadataFilter
}

/**
 * Metadata filter for queries
 */
export type MetadataFilter = {
  [field: string]:
    | Exclude<VectorMetadataValue, string[]>
    | null
    | {
        $eq?: Exclude<VectorMetadataValue, string[]> | null
        $ne?: Exclude<VectorMetadataValue, string[]> | null
        $lt?: Exclude<VectorMetadataValue, string[]> | null
        $lte?: Exclude<VectorMetadataValue, string[]> | null
        $gt?: Exclude<VectorMetadataValue, string[]> | null
        $gte?: Exclude<VectorMetadataValue, string[]> | null
      }
    | {
        $in?: Exclude<VectorMetadataValue, string[]>[]
        $nin?: Exclude<VectorMetadataValue, string[]>[]
      }
}

/**
 * Query result with matched vectors
 */
export interface QueryResult {
  /** Matched vectors with scores */
  matches: VectorMatch[]
  /** Total count of matches */
  count: number
}

/**
 * A matched vector from a query
 */
export interface VectorMatch {
  /** Vector ID */
  id: string
  /** Similarity score */
  score: number
  /** Vector values (if requested) */
  values?: number[]
  /** Namespace */
  namespace?: string
  /** Metadata (if requested) */
  metadata?: VectorMetadata
}

/**
 * Result of a mutation operation
 */
export interface MutationResult {
  /** IDs of vectors that were successfully processed */
  ids: string[]
  /** Count of vectors processed */
  count: number
}

/**
 * Index information
 */
export interface IndexInfo {
  /** Unique index ID */
  id: string
  /** Index name */
  name: string
  /** Optional description */
  description?: string
  /** Index configuration */
  config: IndexConfig
  /** Number of vectors in the index */
  vectorsCount: number
}

/**
 * Index configuration
 */
export interface IndexConfig {
  /** Number of dimensions */
  dimensions?: number
  /** Distance metric */
  metric?: 'euclidean' | 'cosine' | 'dot-product'
  /** Preset configuration */
  preset?: string
}

/**
 * Semantic search options with text input
 */
export interface SemanticSearchOptions extends Omit<QueryOptions, 'filter'> {
  /** Metadata filter criteria */
  filter?: MetadataFilter
  /** AI model to use for embedding generation */
  model?: string
}

/**
 * Semantic search result
 */
export interface SemanticSearchResult extends QueryResult {
  /** The query embedding used */
  queryEmbedding: number[]
}

// ============================================================================
// VectorizeClient Class
// ============================================================================

/**
 * Vectorize client for dotdo
 *
 * Provides a unified interface for vector operations with:
 * - Insert, upsert, delete, and query operations
 * - Namespace support for multi-tenant isolation
 * - Metadata filtering for refined searches
 * - Batch operations for efficiency
 * - Optional Workers AI integration for semantic search
 *
 * @example
 * ```typescript
 * const vectorize = new VectorizeClient(env)
 *
 * // Insert vectors
 * await vectorize.insert([
 *   { id: 'doc-1', values: [0.1, 0.2, ...], metadata: { title: 'Document 1' } },
 *   { id: 'doc-2', values: [0.3, 0.4, ...], metadata: { title: 'Document 2' } },
 * ])
 *
 * // Query similar vectors
 * const results = await vectorize.query([0.1, 0.2, ...], {
 *   topK: 10,
 *   filter: { category: 'articles' },
 * })
 *
 * // Semantic search (requires AI binding)
 * const semanticResults = await vectorize.semanticSearch('What is machine learning?', {
 *   topK: 5,
 *   filter: { type: 'documentation' },
 * })
 * ```
 */
export class VectorizeClient {
  private index: VectorizeIndex
  private ai?: Ai
  private config: Required<Omit<VectorizeConfig, 'namespace'>> & Pick<VectorizeConfig, 'namespace'>

  constructor(env: VectorizeEnv, config: VectorizeConfig = {}) {
    if (!env.VECTORS) {
      throw new Error('Vectorize binding (VECTORS) is required')
    }

    this.index = env.VECTORS
    this.ai = env.AI
    this.config = {
      namespace: config.namespace,
      defaultTopK: config.defaultTopK ?? 10,
      returnValues: config.returnValues ?? false,
      returnMetadata: config.returnMetadata ?? 'indexed',
      batchSize: config.batchSize ?? 1000,
    }
  }

  // ============================================================================
  // Insert Operations
  // ============================================================================

  /**
   * Insert vectors into the index
   *
   * Inserts new vectors. Throws an error if any vector ID already exists.
   *
   * @param vectors - Vectors to insert
   * @returns Mutation result with processed IDs
   * @throws Error if vector IDs already exist
   *
   * @example
   * ```typescript
   * const result = await vectorize.insert([
   *   { id: 'doc-1', values: [0.1, 0.2, 0.3], metadata: { title: 'Doc 1' } },
   *   { id: 'doc-2', values: [0.4, 0.5, 0.6], metadata: { title: 'Doc 2' } },
   * ])
   * console.log(result.count) // 2
   * ```
   */
  async insert(vectors: Vector[]): Promise<MutationResult> {
    if (vectors.length === 0) {
      return { ids: [], count: 0 }
    }

    // Validate vectors
    this.validateVectors(vectors)

    // Process in batches
    const allIds: string[] = []
    let totalCount = 0

    for (let i = 0; i < vectors.length; i += this.config.batchSize) {
      const batch = vectors.slice(i, i + this.config.batchSize)
      const vectorizeVectors = this.convertToVectorizeVectors(batch)

      const result = await this.index.insert(vectorizeVectors)
      allIds.push(...result.ids)
      totalCount += result.count
    }

    return { ids: allIds, count: totalCount }
  }

  // ============================================================================
  // Upsert Operations
  // ============================================================================

  /**
   * Upsert vectors into the index
   *
   * Inserts new vectors or updates existing ones by ID.
   *
   * @param vectors - Vectors to upsert
   * @returns Mutation result with processed IDs
   *
   * @example
   * ```typescript
   * const result = await vectorize.upsert([
   *   { id: 'doc-1', values: [0.1, 0.2, 0.3], metadata: { title: 'Updated Doc 1' } },
   * ])
   * ```
   */
  async upsert(vectors: Vector[]): Promise<MutationResult> {
    if (vectors.length === 0) {
      return { ids: [], count: 0 }
    }

    // Validate vectors
    this.validateVectors(vectors)

    // Process in batches
    const allIds: string[] = []
    let totalCount = 0

    for (let i = 0; i < vectors.length; i += this.config.batchSize) {
      const batch = vectors.slice(i, i + this.config.batchSize)
      const vectorizeVectors = this.convertToVectorizeVectors(batch)

      const result = await this.index.upsert(vectorizeVectors)
      allIds.push(...result.ids)
      totalCount += result.count
    }

    return { ids: allIds, count: totalCount }
  }

  // ============================================================================
  // Delete Operations
  // ============================================================================

  /**
   * Delete vectors by ID
   *
   * @param ids - Vector IDs to delete
   * @returns Mutation result with deleted IDs
   *
   * @example
   * ```typescript
   * const result = await vectorize.delete(['doc-1', 'doc-2'])
   * console.log(result.count) // 2
   * ```
   */
  async delete(ids: string[]): Promise<MutationResult> {
    if (ids.length === 0) {
      return { ids: [], count: 0 }
    }

    // Validate IDs
    for (const id of ids) {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new Error('Vector IDs must be non-empty strings')
      }
    }

    // Process in batches
    const allIds: string[] = []
    let totalCount = 0

    for (let i = 0; i < ids.length; i += this.config.batchSize) {
      const batch = ids.slice(i, i + this.config.batchSize)
      const result = await this.index.deleteByIds(batch)
      allIds.push(...result.ids)
      totalCount += result.count
    }

    return { ids: allIds, count: totalCount }
  }

  // ============================================================================
  // Query Operations
  // ============================================================================

  /**
   * Query for similar vectors
   *
   * Performs similarity search using the provided vector.
   *
   * @param vector - Query vector
   * @param options - Query options
   * @returns Query result with matches
   *
   * @example
   * ```typescript
   * const results = await vectorize.query([0.1, 0.2, 0.3], {
   *   topK: 10,
   *   filter: { category: 'articles' },
   *   returnMetadata: true,
   * })
   *
   * for (const match of results.matches) {
   *   console.log(`${match.id}: ${match.score}`)
   * }
   * ```
   */
  async query(
    vector: number[] | Float32Array | Float64Array,
    options: QueryOptions = {}
  ): Promise<QueryResult> {
    // Validate vector
    if (!vector || (Array.isArray(vector) && vector.length === 0)) {
      throw new Error('Query vector cannot be empty')
    }

    // Convert typed arrays to number array for validation
    const vectorArray = Array.isArray(vector) ? vector : Array.from(vector)

    for (const val of vectorArray) {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new Error('Vector values must be finite numbers')
      }
    }

    const queryOptions: VectorizeQueryOptions = {
      topK: options.topK ?? this.config.defaultTopK,
      namespace: options.namespace ?? this.config.namespace,
      returnValues: options.returnValues ?? this.config.returnValues,
      returnMetadata: options.returnMetadata ?? this.config.returnMetadata,
      filter: options.filter as VectorizeVectorMetadataFilter | undefined,
    }

    const result = await this.index.query(vector, queryOptions)

    return {
      matches: result.matches.map((m) => ({
        id: m.id,
        score: m.score,
        values: m.values ? (Array.isArray(m.values) ? m.values : Array.from(m.values)) : undefined,
        namespace: m.namespace,
        metadata: m.metadata as VectorMetadata | undefined,
      })),
      count: result.count,
    }
  }

  // ============================================================================
  // Get By IDs
  // ============================================================================

  /**
   * Get vectors by their IDs
   *
   * @param ids - Vector IDs to retrieve
   * @returns Retrieved vectors
   *
   * @example
   * ```typescript
   * const vectors = await vectorize.getByIds(['doc-1', 'doc-2'])
   * for (const v of vectors) {
   *   console.log(v.id, v.values.length)
   * }
   * ```
   */
  async getByIds(ids: string[]): Promise<Vector[]> {
    if (ids.length === 0) {
      return []
    }

    // Validate IDs
    for (const id of ids) {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new Error('Vector IDs must be non-empty strings')
      }
    }

    // Process in batches and collect results
    const allVectors: Vector[] = []

    for (let i = 0; i < ids.length; i += this.config.batchSize) {
      const batch = ids.slice(i, i + this.config.batchSize)
      const results = await this.index.getByIds(batch)

      for (const v of results) {
        allVectors.push({
          id: v.id,
          values: Array.isArray(v.values) ? v.values : Array.from(v.values),
          namespace: v.namespace,
          metadata: v.metadata as VectorMetadata | undefined,
        })
      }
    }

    return allVectors
  }

  // ============================================================================
  // Semantic Search (requires AI binding)
  // ============================================================================

  /**
   * Perform semantic search using text query
   *
   * Converts text to embedding using Workers AI, then performs similarity search.
   * Requires the AI binding to be available.
   *
   * @param text - Text query
   * @param options - Search options
   * @returns Search result with matches and query embedding
   * @throws Error if AI binding is not available
   *
   * @example
   * ```typescript
   * const results = await vectorize.semanticSearch('What is machine learning?', {
   *   topK: 5,
   *   filter: { type: 'documentation' },
   * })
   *
   * console.log('Query embedding dimension:', results.queryEmbedding.length)
   * for (const match of results.matches) {
   *   console.log(`${match.id}: ${match.score}`)
   * }
   * ```
   */
  async semanticSearch(
    text: string,
    options: SemanticSearchOptions = {}
  ): Promise<SemanticSearchResult> {
    if (!this.ai) {
      throw new Error('AI binding is required for semantic search')
    }

    if (!text || text.trim() === '') {
      throw new Error('Search text cannot be empty')
    }

    const model = options.model ?? '@cf/baai/bge-base-en-v1.5'

    // Generate embedding for the query text
    // Cast to the expected model type for text embeddings
    const embeddingResponse = await this.ai.run(model as Parameters<Ai['run']>[0], {
      text: text,
    })

    const embedding = (embeddingResponse as { data: number[][] }).data[0]

    // Perform vector query
    const queryResult = await this.query(embedding, {
      topK: options.topK,
      namespace: options.namespace,
      returnValues: options.returnValues,
      returnMetadata: options.returnMetadata,
      filter: options.filter,
    })

    return {
      ...queryResult,
      queryEmbedding: embedding,
    }
  }

  // ============================================================================
  // Index Information
  // ============================================================================

  /**
   * Get index information and statistics
   *
   * @returns Index information
   *
   * @example
   * ```typescript
   * const info = await vectorize.describe()
   * console.log(`Index has ${info.vectorsCount} vectors`)
   * ```
   */
  async describe(): Promise<IndexInfo> {
    const details = await this.index.describe()

    return {
      id: details.id,
      name: details.name,
      description: details.description,
      config: details.config as IndexConfig,
      vectorsCount: details.vectorsCount,
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Set the default namespace for operations
   *
   * @param namespace - Namespace to use
   */
  setNamespace(namespace: string | undefined): void {
    this.config.namespace = namespace
  }

  /**
   * Get the current default namespace
   *
   * @returns Current namespace or undefined
   */
  getNamespace(): string | undefined {
    return this.config.namespace
  }

  /**
   * Create a namespaced client
   *
   * Returns a new client configured with the specified namespace.
   *
   * @param namespace - Namespace for the new client
   * @returns New VectorizeClient with namespace
   *
   * @example
   * ```typescript
   * const tenantClient = vectorize.withNamespace('tenant-123')
   * await tenantClient.insert([...]) // All operations in tenant-123 namespace
   * ```
   */
  withNamespace(namespace: string): VectorizeClient {
    const newEnv: VectorizeEnv = {
      VECTORS: this.index,
      AI: this.ai,
    }

    return new VectorizeClient(newEnv, {
      ...this.config,
      namespace,
    })
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private validateVectors(vectors: Vector[]): void {
    for (const v of vectors) {
      if (!v.id || typeof v.id !== 'string' || v.id.trim() === '') {
        throw new Error('Vector ID must be a non-empty string')
      }

      if (!v.values) {
        throw new Error(`Vector ${v.id} must have values`)
      }

      const valuesArray = Array.isArray(v.values) ? v.values : Array.from(v.values)

      if (valuesArray.length === 0) {
        throw new Error(`Vector ${v.id} values cannot be empty`)
      }

      for (const val of valuesArray) {
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          throw new Error(`Vector ${v.id} values must be finite numbers`)
        }
      }
    }
  }

  private convertToVectorizeVectors(vectors: Vector[]): VectorizeVector[] {
    return vectors.map((v) => ({
      id: v.id,
      values: v.values,
      namespace: v.namespace ?? this.config.namespace,
      metadata: v.metadata as Record<string, VectorizeVectorMetadata> | undefined,
    }))
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a VectorizeClient from environment bindings
 *
 * @param env - Environment bindings with VECTORS
 * @param config - Optional configuration
 * @returns VectorizeClient instance
 *
 * @example
 * ```typescript
 * // In a Worker
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const vectorize = createVectorizeClient(env)
 *     const results = await vectorize.query([0.1, 0.2, ...])
 *     return Response.json(results)
 *   }
 * }
 * ```
 */
export function createVectorizeClient(env: VectorizeEnv, config?: VectorizeConfig): VectorizeClient {
  return new VectorizeClient(env, config)
}

/**
 * Create a namespaced VectorizeClient
 *
 * Convenience function for creating a client with a specific namespace.
 *
 * @param env - Environment bindings with VECTORS
 * @param namespace - Namespace for vector operations
 * @param config - Optional additional configuration
 * @returns VectorizeClient instance with namespace
 *
 * @example
 * ```typescript
 * const tenantVectorize = createNamespacedVectorizeClient(env, 'tenant-123')
 * ```
 */
export function createNamespacedVectorizeClient(
  env: VectorizeEnv,
  namespace: string,
  config?: Omit<VectorizeConfig, 'namespace'>
): VectorizeClient {
  return new VectorizeClient(env, { ...config, namespace })
}

/**
 * Create a VectorizeClient with AI integration
 *
 * Creates a client configured for semantic search operations.
 *
 * @param env - Environment bindings with VECTORS and AI
 * @param config - Optional configuration
 * @returns VectorizeClient instance with AI support
 * @throws Error if AI binding is not available
 *
 * @example
 * ```typescript
 * const semanticSearch = createSemanticSearchClient(env)
 * const results = await semanticSearch.semanticSearch('Find documents about AI')
 * ```
 */
export function createSemanticSearchClient(
  env: VectorizeEnv,
  config?: VectorizeConfig
): VectorizeClient {
  if (!env.AI) {
    throw new Error('AI binding is required for semantic search client')
  }
  return new VectorizeClient(env, config)
}
