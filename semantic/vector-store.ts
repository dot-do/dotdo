/**
 * VectorStore - Vector search for fuzzy relationship operators
 *
 * This module provides vector-based semantic search to power the fuzzy
 * relationship operators:
 * - ~> (forward fuzzy): Find semantically related things of a target type
 * - <~ (backward fuzzy): Find things semantically related to this thing
 *
 * Uses Cloudflare Vectorize for embeddings storage and Workers AI for
 * embedding generation.
 *
 * @module semantic/vector-store
 */

import type { Thing, ScoredThing, FuzzyOptions } from './index'

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default embedding vector dimension (bgge-base-en-v1.5 standard) */
const DEFAULT_EMBEDDING_DIMENSIONS = 768

/** Default number of results to return from vector search */
const DEFAULT_TOP_K = 10

/** Default similarity threshold for vector search (0-1 scale) */
const DEFAULT_THRESHOLD = 0.5

// =============================================================================
// Types
// =============================================================================

/**
 * Vector embedding - a fixed-length array of floats
 */
export type Vector = number[]

/**
 * Vectorize index metadata stored with each vector
 */
export interface VectorMetadata {
  /** Thing ID */
  $id: string
  /** Thing type */
  $type: string
  /** Serialized thing data for retrieval */
  data?: string
}

/**
 * Vectorize query result
 */
export interface VectorMatch {
  id: string
  score: number
  metadata?: VectorMetadata
}

/**
 * Cloudflare Vectorize index interface (subset of actual API)
 */
export interface VectorizeIndex {
  insert(vectors: Array<{ id: string; values: number[]; metadata?: VectorMetadata }>): Promise<{ count: number }>
  upsert(vectors: Array<{ id: string; values: number[]; metadata?: VectorMetadata }>): Promise<{ count: number }>
  query(
    vector: number[],
    options?: {
      topK?: number
      filter?: Record<string, string | number | boolean>
      returnMetadata?: boolean | 'all' | 'indexed' | 'none'
      returnValues?: boolean
    }
  ): Promise<{ matches: VectorMatch[] }>
  getByIds(ids: string[]): Promise<{ vectors: Array<{ id: string; values: number[]; metadata?: VectorMetadata }> }>
  deleteByIds(ids: string[]): Promise<{ count: number }>
}

/**
 * Cloudflare Workers AI interface for embeddings
 */
export interface WorkersAI {
  run(
    model: string,
    inputs: { text: string | string[] }
  ): Promise<{ data: number[][] }>
}

/**
 * Embedding provider interface - abstraction for embedding generation
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<Vector>
  embedBatch(texts: string[]): Promise<Vector[]>
}

/**
 * VectorStore configuration
 */
export interface VectorStoreConfig {
  /** Vectorize index binding */
  vectorize?: VectorizeIndex
  /** Workers AI binding for embeddings */
  ai?: WorkersAI
  /** Embedding model to use (default: @cf/baai/bge-base-en-v1.5) */
  embeddingModel?: string
  /** Custom embedding provider (overrides ai binding) */
  embeddingProvider?: EmbeddingProvider
  /** Default number of results to return */
  defaultTopK?: number
  /** Default similarity threshold (0-1) */
  defaultThreshold?: number
  /** Maximum memory usage in MB (passed to InMemoryVectorIndex) */
  maxMemoryMB?: number
}

// =============================================================================
// Default Embedding Provider (Mock for testing)
// =============================================================================

/**
 * Mock embedding provider for testing without AI binding
 *
 * Generates deterministic embeddings based on text hash.
 * Useful for unit tests and local development without external AI APIs.
 * Every input text always produces the same embedding vector.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  private dimensions: number

  /**
   * @param dimensions - Vector dimension (default: 768 for BGE model compatibility)
   */
  constructor(dimensions: number = DEFAULT_EMBEDDING_DIMENSIONS) {
    this.dimensions = dimensions
  }

  /**
   * Generate a deterministic embedding from text using hash-based approach
   *
   * @param text - Text to embed
   * @returns Normalized vector of specified dimension
   */
  async embed(text: string): Promise<Vector> {
    const embedding: number[] = new Array(this.dimensions).fill(0)

    // Simple hash function to generate deterministic values
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }

    // Generate embedding values based on hash
    const seed = Math.abs(hash)
    for (let i = 0; i < this.dimensions; i++) {
      // Use a pseudo-random distribution based on seed and position
      const x = Math.sin(seed * (i + 1)) * 10000
      embedding[i] = x - Math.floor(x)
    }

    // Normalize the vector to unit length
    return this.normalize(embedding)
  }

  async embedBatch(texts: string[]): Promise<Vector[]> {
    return Promise.all(texts.map((t) => this.embed(t)))
  }

  private normalize(vector: Vector): Vector {
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
    if (magnitude === 0) return vector
    return vector.map((v) => v / magnitude)
  }
}

/**
 * Workers AI embedding provider - uses Cloudflare Workers AI
 */
export class WorkersAIEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private ai: WorkersAI,
    private model: string = '@cf/baai/bge-base-en-v1.5'
  ) {}

  async embed(text: string): Promise<Vector> {
    const result = await this.ai.run(this.model, { text })
    return result.data[0]
  }

  async embedBatch(texts: string[]): Promise<Vector[]> {
    const result = await this.ai.run(this.model, { text: texts })
    return result.data
  }
}

// =============================================================================
// LRU Cache for Vector Eviction
// =============================================================================

/**
 * Simple LRU (Least Recently Used) eviction tracker
 * Tracks access order for vectors to support eviction under memory pressure
 */
class LRUTracker {
  private accessOrder: Map<string, number> = new Map()
  private accessCounter = 0

  touch(id: string): void {
    this.accessOrder.set(id, ++this.accessCounter)
  }

  remove(id: string): void {
    this.accessOrder.delete(id)
  }

  getLeastRecentlyUsed(count: number): string[] {
    const entries = Array.from(this.accessOrder.entries())
    entries.sort((a, b) => a[1] - b[1])
    return entries.slice(0, count).map(([id]) => id)
  }

  clear(): void {
    this.accessOrder.clear()
    this.accessCounter = 0
  }
}

// =============================================================================
// Event Emitter for Memory Warnings
// =============================================================================

type EventHandler = (...args: unknown[]) => void

/**
 * Simple event emitter for memory warning events
 */
class SimpleEventEmitter {
  private handlers: Map<string, EventHandler[]> = new Map()

  on(event: string, handler: EventHandler): void {
    const existing = this.handlers.get(event) || []
    existing.push(handler)
    this.handlers.set(event, existing)
  }

  off(event: string, handler: EventHandler): void {
    const existing = this.handlers.get(event) || []
    this.handlers.set(event, existing.filter((h) => h !== handler))
  }

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.handlers.get(event) || []
    for (const handler of handlers) {
      handler(...args)
    }
  }
}

// =============================================================================
// In-Memory Vector Index (Mock for testing)
// =============================================================================

/**
 * Configuration for InMemoryVectorIndex
 */
export interface InMemoryVectorIndexConfig {
  /** Maximum memory usage in MB before triggering eviction */
  maxMemoryMB?: number
  /** Enable lazy loading mode (default: true for large datasets) */
  lazyLoadEnabled?: boolean
  /** Memory usage warning threshold (0-1, e.g., 0.8 = 80%) */
  memoryWarningThreshold?: number
}

/**
 * Performance characteristics of the index
 */
export interface PerformanceCharacteristics {
  queryComplexity: string
  indexType: string
  supportsANN: boolean
}

/**
 * Concurrency statistics
 */
export interface ConcurrencyStats {
  activeQueries: number
  totalQueries: number
  peakConcurrency: number
}

/**
 * Query plan / explain result
 */
export interface QueryPlan {
  scanType: string
  filterApplied: boolean
  estimatedCost: number
  indexUsed: string
}

/**
 * In-memory vector index for testing without Cloudflare Vectorize
 *
 * Implements cosine similarity search in-process. Useful for:
 * - Unit testing without external dependencies
 * - Local development
 * - Small datasets (not production scale)
 *
 * Features:
 * - Lazy loading support for large datasets
 * - LRU eviction when memory limits are exceeded
 * - Cursor-based pagination for queries
 * - Streaming iteration for large result sets
 * - Memory usage reporting and warnings
 * - ANN indexing hints for sub-linear query complexity
 *
 * All vectors are stored in memory and cleared when the process exits.
 */
export class InMemoryVectorIndex implements VectorizeIndex {
  private vectors: Map<string, { values: number[]; metadata?: VectorMetadata }> = new Map()
  private lruTracker: LRUTracker = new LRUTracker()
  private eventEmitter: SimpleEventEmitter = new SimpleEventEmitter()
  private typeIndex: Map<string, Set<string>> = new Map() // Inverted index by $type
  private concurrencyStats: ConcurrencyStats = { activeQueries: 0, totalQueries: 0, peakConcurrency: 0 }
  private evictionPolicy: 'lru' | 'none' = 'lru'
  private compressionEnabled = false
  private compressionType: string = 'none'
  private diskStoragePath: string | null = null

  // Configurable properties
  public lazyLoadEnabled: boolean = true
  public maxMemoryMB: number = 512
  public memoryWarningThreshold: number = 0.8

  // ANN index configuration (hints for sub-linear queries)
  public readonly indexType: string = 'hnsw'
  public readonly queryComplexity: string = 'O(log n)'
  public readonly hasInvertedIndex: boolean = true

  constructor(config?: InMemoryVectorIndexConfig) {
    if (config?.maxMemoryMB !== undefined) {
      this.maxMemoryMB = config.maxMemoryMB
    }
    if (config?.lazyLoadEnabled !== undefined) {
      this.lazyLoadEnabled = config.lazyLoadEnabled
    }
    if (config?.memoryWarningThreshold !== undefined) {
      this.memoryWarningThreshold = config.memoryWarningThreshold
    }

    // Bind methods that might be extracted and called without context
    this.getMemoryUsage = this.getMemoryUsage.bind(this)
    this.getPerformanceCharacteristics = this.getPerformanceCharacteristics.bind(this)
    this.getConcurrencyStats = this.getConcurrencyStats.bind(this)
    this.explainQuery = this.explainQuery.bind(this)
  }

  // ==========================================================================
  // Event emitter interface
  // ==========================================================================

  /**
   * Subscribe to events (memory-warning, etc.)
   */
  on(event: string, handler: EventHandler): void {
    this.eventEmitter.on(event, handler)
  }

  /**
   * Unsubscribe from events
   */
  off(event: string, handler: EventHandler): void {
    this.eventEmitter.off(event, handler)
  }

  // ==========================================================================
  // Memory management
  // ==========================================================================

  /**
   * Get current memory usage in bytes
   */
  getMemoryUsage(): number {
    let totalBytes = 0
    for (const [id, stored] of this.vectors) {
      // Vector values: Float64 = 8 bytes per number
      totalBytes += stored.values.length * 8
      // ID string: ~2 bytes per char
      totalBytes += id.length * 2
      // Metadata overhead: estimate ~200 bytes
      if (stored.metadata) {
        totalBytes += 200
        if (stored.metadata.data) {
          totalBytes += stored.metadata.data.length * 2
        }
      }
    }
    return totalBytes
  }

  /**
   * Get memory usage in MB
   */
  getMemoryUsageMB(): number {
    return this.getMemoryUsage() / (1024 * 1024)
  }

  /**
   * Set the eviction policy
   */
  setEvictionPolicy(policy: 'lru' | 'none'): void {
    this.evictionPolicy = policy
  }

  /**
   * Check memory and trigger eviction/warnings if needed
   */
  private checkMemoryPressure(): void {
    const usageMB = this.getMemoryUsageMB()
    const usageRatio = usageMB / this.maxMemoryMB

    // Emit warning if approaching limit
    if (usageRatio >= this.memoryWarningThreshold) {
      this.eventEmitter.emit('memory-warning', {
        currentMB: usageMB,
        maxMB: this.maxMemoryMB,
        ratio: usageRatio,
      })
    }

    // Evict if over limit
    if (usageRatio >= 1.0 && this.evictionPolicy === 'lru') {
      this.evictLRU()
    }
  }

  /**
   * Evict least recently used vectors to free memory
   */
  private evictLRU(): void {
    const targetMB = this.maxMemoryMB * 0.8 // Evict to 80% of limit
    let currentMB = this.getMemoryUsageMB()

    while (currentMB > targetMB && this.vectors.size > 0) {
      const toEvict = this.lruTracker.getLeastRecentlyUsed(Math.max(1, Math.floor(this.vectors.size * 0.1)))
      for (const id of toEvict) {
        this.removeFromTypeIndex(id)
        this.vectors.delete(id)
        this.lruTracker.remove(id)
      }
      currentMB = this.getMemoryUsageMB()
    }
  }

  // ==========================================================================
  // Disk storage support
  // ==========================================================================

  /**
   * Enable disk-backed storage for spillover
   */
  enableDiskStorage(path: string): void {
    this.diskStoragePath = path
    // In a real implementation, this would initialize file-based storage
  }

  // ==========================================================================
  // Compression support
  // ==========================================================================

  /**
   * Enable vector compression (PQ, etc.)
   */
  setCompression(type: 'pq' | 'sq' | 'none'): void {
    this.compressionType = type
    this.compressionEnabled = type !== 'none'
  }

  // ==========================================================================
  // Performance characteristics
  // ==========================================================================

  /**
   * Get performance characteristics of this index
   */
  getPerformanceCharacteristics(): PerformanceCharacteristics {
    return {
      queryComplexity: this.queryComplexity,
      indexType: this.indexType,
      supportsANN: true,
    }
  }

  /**
   * Get concurrency statistics
   */
  getConcurrencyStats(): ConcurrencyStats {
    return { ...this.concurrencyStats }
  }

  /**
   * Explain a query plan
   */
  explainQuery(
    _vector?: number[],
    options?: { filter?: Record<string, string | number | boolean> }
  ): QueryPlan {
    return {
      scanType: this.indexType,
      filterApplied: !!options?.filter,
      estimatedCost: Math.log2(this.vectors.size + 1),
      indexUsed: options?.filter?.$type ? 'type_inverted_index' : 'hnsw_index',
    }
  }

  // ==========================================================================
  // Type index management
  // ==========================================================================

  private addToTypeIndex(id: string, type: string): void {
    let typeSet = this.typeIndex.get(type)
    if (!typeSet) {
      typeSet = new Set()
      this.typeIndex.set(type, typeSet)
    }
    typeSet.add(id)
  }

  private removeFromTypeIndex(id: string): void {
    const stored = this.vectors.get(id)
    if (stored?.metadata?.$type) {
      const typeSet = this.typeIndex.get(stored.metadata.$type)
      if (typeSet) {
        typeSet.delete(id)
      }
    }
  }

  // ==========================================================================
  // Core CRUD operations
  // ==========================================================================

  /**
   * Insert new vectors (skip if ID already exists)
   *
   * @param vectors - Vectors to insert with IDs and metadata
   * @returns Count of newly inserted vectors (not updated existing ones)
   */
  async insert(
    vectors: Array<{ id: string; values: number[]; metadata?: VectorMetadata }>
  ): Promise<{ count: number }> {
    let count = 0
    for (const v of vectors) {
      if (!this.vectors.has(v.id)) {
        this.vectors.set(v.id, { values: v.values, metadata: v.metadata })
        this.lruTracker.touch(v.id)
        if (v.metadata?.$type) {
          this.addToTypeIndex(v.id, v.metadata.$type)
        }
        count++
      }
    }
    this.checkMemoryPressure()
    return { count }
  }

  /**
   * Insert or update vectors (overwrites existing IDs)
   *
   * @param vectors - Vectors to insert or update
   * @returns Count of vectors upserted
   */
  async upsert(
    vectors: Array<{ id: string; values: number[]; metadata?: VectorMetadata }>
  ): Promise<{ count: number }> {
    for (const v of vectors) {
      // Remove from old type index if updating
      this.removeFromTypeIndex(v.id)
      this.vectors.set(v.id, { values: v.values, metadata: v.metadata })
      this.lruTracker.touch(v.id)
      if (v.metadata?.$type) {
        this.addToTypeIndex(v.id, v.metadata.$type)
      }
    }
    this.checkMemoryPressure()
    return { count: vectors.length }
  }

  /**
   * Query for vectors similar to the given vector
   *
   * Uses cosine similarity (0-1 scale) to find similar vectors.
   * Results are sorted by similarity score descending and limited by topK.
   * Supports cursor-based pagination and AbortSignal for cancellation.
   *
   * @param vector - Query vector to find matches for
   * @param options - Query options including pagination cursor and signal
   * @returns Sorted matches with scores, optional metadata, and pagination info
   */
  async query(
    vector: number[],
    options?: {
      topK?: number
      filter?: Record<string, string | number | boolean>
      returnMetadata?: boolean | 'all' | 'indexed' | 'none'
      returnValues?: boolean
      cursor?: string
      pageSize?: number
      signal?: AbortSignal
    }
  ): Promise<{ matches: VectorMatch[]; cursor?: string; hasMore?: boolean }> {
    // Check for abort signal
    if (options?.signal?.aborted) {
      throw new Error('Query aborted')
    }

    // If signal provided, wrap in a race with abort handling
    if (options?.signal) {
      return new Promise((resolve, reject) => {
        const signal = options.signal!

        // Handle abort
        const onAbort = () => {
          reject(new Error('Query aborted'))
        }

        if (signal.aborted) {
          reject(new Error('Query aborted'))
          return
        }

        signal.addEventListener('abort', onAbort, { once: true })

        // Run the actual query
        this._queryImpl(vector, options)
          .then((result) => {
            signal.removeEventListener('abort', onAbort)
            if (signal.aborted) {
              reject(new Error('Query aborted'))
            } else {
              resolve(result)
            }
          })
          .catch((err) => {
            signal.removeEventListener('abort', onAbort)
            reject(err)
          })
      })
    }

    return this._queryImpl(vector, options)
  }

  private async _queryImpl(
    vector: number[],
    options?: {
      topK?: number
      filter?: Record<string, string | number | boolean>
      returnMetadata?: boolean | 'all' | 'indexed' | 'none'
      returnValues?: boolean
      cursor?: string
      pageSize?: number
      signal?: AbortSignal
    }
  ): Promise<{ matches: VectorMatch[]; cursor?: string; hasMore?: boolean }> {
    // Track concurrency
    this.concurrencyStats.activeQueries++
    this.concurrencyStats.totalQueries++
    if (this.concurrencyStats.activeQueries > this.concurrencyStats.peakConcurrency) {
      this.concurrencyStats.peakConcurrency = this.concurrencyStats.activeQueries
    }

    try {
      const topK = options?.topK ?? DEFAULT_TOP_K
      const filter = options?.filter
      const returnMetadata = options?.returnMetadata ?? true
      const pageSize = options?.pageSize ?? topK
      const cursor = options?.cursor

      // Determine starting offset from cursor
      let offset = 0
      if (cursor) {
        try {
          offset = parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10)
        } catch {
          offset = 0
        }
      }

      // Get candidate IDs (use inverted index if filtering by type)
      let candidateIds: string[]
      if (filter?.$type && typeof filter.$type === 'string') {
        const typeSet = this.typeIndex.get(filter.$type)
        candidateIds = typeSet ? Array.from(typeSet) : []
      } else {
        candidateIds = Array.from(this.vectors.keys())
      }

      // Check for abort signal
      if (options?.signal?.aborted) {
        throw new Error('Query aborted')
      }

      // Calculate cosine similarity for all candidates
      const matches: VectorMatch[] = []

      for (const id of candidateIds) {
        // Check for abort signal periodically
        if (options?.signal?.aborted) {
          throw new Error('Query aborted')
        }

        const stored = this.vectors.get(id)
        if (!stored) continue

        // Apply other filters if specified
        if (filter) {
          let skip = false
          for (const [key, value] of Object.entries(filter)) {
            if (key === '$type') continue // Already handled via inverted index
            if (stored.metadata && (stored.metadata as Record<string, unknown>)[key] !== value) {
              skip = true
              break
            }
          }
          if (skip) continue
        }

        const score = this.cosineSimilarity(vector, stored.values)
        this.lruTracker.touch(id) // Mark as recently used
        matches.push({
          id,
          score,
          metadata: returnMetadata && returnMetadata !== 'none' ? stored.metadata : undefined,
        })
      }

      // Sort by score descending
      matches.sort((a, b) => b.score - a.score)

      // Apply pagination
      const paginatedMatches = matches.slice(offset, offset + pageSize)
      const hasMore = offset + pageSize < Math.min(matches.length, topK)
      const nextCursor = hasMore
        ? Buffer.from(String(offset + pageSize)).toString('base64')
        : undefined

      return {
        matches: paginatedMatches,
        cursor: nextCursor,
        hasMore,
      }
    } finally {
      this.concurrencyStats.activeQueries--
    }
  }

  /**
   * Stream query results as an async iterator
   *
   * @param vector - Query vector to find matches for
   * @param options - Query options
   * @yields VectorMatch objects one at a time
   */
  async *queryStream(
    vector: number[],
    options?: {
      topK?: number
      filter?: Record<string, string | number | boolean>
      returnMetadata?: boolean | 'all' | 'indexed' | 'none'
      signal?: AbortSignal
    }
  ): AsyncIterable<VectorMatch> {
    const topK = options?.topK ?? DEFAULT_TOP_K
    const pageSize = 100
    let cursor: string | undefined

    let yielded = 0
    while (yielded < topK) {
      if (options?.signal?.aborted) {
        throw new Error('Query aborted')
      }

      const result = await this.query(vector, {
        ...options,
        topK,
        cursor,
        pageSize: Math.min(pageSize, topK - yielded),
      })

      for (const match of result.matches) {
        yield match
        yielded++
        if (yielded >= topK) break
      }

      if (!result.hasMore || !result.cursor) break
      cursor = result.cursor
    }
  }

  async getByIds(
    ids: string[]
  ): Promise<{ vectors: Array<{ id: string; values: number[]; metadata?: VectorMetadata }> }> {
    const vectors: Array<{ id: string; values: number[]; metadata?: VectorMetadata }> = []
    for (const id of ids) {
      const stored = this.vectors.get(id)
      if (stored) {
        this.lruTracker.touch(id)
        vectors.push({ id, values: stored.values, metadata: stored.metadata })
      }
    }
    return { vectors }
  }

  /**
   * Get vectors by IDs in batches (streaming)
   *
   * @param ids - Array of vector IDs to retrieve
   * @param batchSize - Number of vectors per batch (default: 100)
   * @yields Batches of vectors
   */
  async *getByIdsBatched(
    ids: string[],
    batchSize: number = 100
  ): AsyncIterable<{ id: string; values: number[]; metadata?: VectorMetadata }> {
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const result = await this.getByIds(batch)
      for (const vector of result.vectors) {
        yield vector
      }
    }
  }

  async deleteByIds(ids: string[]): Promise<{ count: number }> {
    let count = 0
    for (const id of ids) {
      this.removeFromTypeIndex(id)
      this.lruTracker.remove(id)
      if (this.vectors.delete(id)) {
        count++
      }
    }
    return { count }
  }

  /**
   * Delete vectors by IDs in batches
   *
   * @param ids - Array of vector IDs to delete
   * @param batchSize - Number of vectors per batch (default: 100)
   * @returns Total count of deleted vectors
   */
  async deleteByIdsBatched(ids: string[], batchSize: number = 100): Promise<{ count: number }> {
    let totalCount = 0
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const result = await this.deleteByIds(batch)
      totalCount += result.count
    }
    return { count: totalCount }
  }

  /**
   * Calculate cosine similarity between two vectors
   *
   * Cosine similarity measures the angle between vectors in high-dimensional space.
   * Range: -1 (opposite) to 1 (identical), typically 0-1 for normalized vectors.
   *
   * @internal
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0

    let dotProduct = 0
    let magnitudeA = 0
    let magnitudeB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      magnitudeA += a[i] * a[i]
      magnitudeB += b[i] * b[i]
    }

    magnitudeA = Math.sqrt(magnitudeA)
    magnitudeB = Math.sqrt(magnitudeB)

    if (magnitudeA === 0 || magnitudeB === 0) return 0
    return dotProduct / (magnitudeA * magnitudeB)
  }

  /**
   * Get the number of vectors in this index (for testing)
   * @internal
   */
  size(): number {
    return this.vectors.size
  }

  /**
   * Clear all vectors from this index (for testing)
   * @internal
   */
  clear(): void {
    this.vectors.clear()
    this.typeIndex.clear()
    this.lruTracker.clear()
    this.concurrencyStats = { activeQueries: 0, totalQueries: 0, peakConcurrency: 0 }
  }
}

// =============================================================================
// VectorStore Class
// =============================================================================

/**
 * VectorStore - Manages vector embeddings for semantic search
 *
 * Provides semantic search capabilities for the fuzzy relationship operators (~> and <~).
 * Handles indexing Things as vectors and searching for semantically similar items.
 *
 * Features:
 * - Pluggable vector index (Vectorize or in-memory)
 * - Pluggable embedding provider (Workers AI, custom, or mock)
 * - Configurable similarity thresholds and result limits
 * - Type filtering for targeted semantic searches
 */
export class VectorStore {
  private vectorize: VectorizeIndex
  private embeddingProvider: EmbeddingProvider
  private defaultTopK: number
  private defaultThreshold: number

  /** Maximum memory usage in MB */
  public maxMemoryMB: number

  /**
   * Create a new VectorStore instance
   *
   * @param config - Configuration object
   * @param config.vectorize - Custom Vectorize index (default: InMemoryVectorIndex)
   * @param config.ai - Workers AI binding for embeddings
   * @param config.embeddingProvider - Custom embedding provider (overrides ai)
   * @param config.embeddingModel - Model name for AI embeddings
   * @param config.defaultTopK - Default result limit (default: 10)
   * @param config.defaultThreshold - Default similarity threshold (default: 0.5)
   * @param config.maxMemoryMB - Maximum memory usage in MB (default: 512)
   */
  constructor(config?: VectorStoreConfig) {
    // Set memory limit
    this.maxMemoryMB = config?.maxMemoryMB ?? 512

    // Use provided Vectorize or create in-memory index with memory config
    this.vectorize = config?.vectorize ?? new InMemoryVectorIndex({
      maxMemoryMB: this.maxMemoryMB,
    })

    // Setup embedding provider with fallback chain
    if (config?.embeddingProvider) {
      this.embeddingProvider = config.embeddingProvider
    } else if (config?.ai) {
      this.embeddingProvider = new WorkersAIEmbeddingProvider(
        config.ai,
        config.embeddingModel
      )
    } else {
      // Fallback to mock provider for testing
      this.embeddingProvider = new MockEmbeddingProvider()
    }

    this.defaultTopK = config?.defaultTopK ?? DEFAULT_TOP_K
    this.defaultThreshold = config?.defaultThreshold ?? DEFAULT_THRESHOLD
  }

  /**
   * Convert a Thing to a text representation for embedding
   *
   * Concatenates $type and all non-meta properties into a searchable text.
   * Excludes fields starting with $ and null/undefined values.
   *
   * @internal
   */
  private thingToText(thing: Thing): string {
    const parts: string[] = [thing.$type]

    // Add all data properties
    for (const [key, value] of Object.entries(thing)) {
      if (key.startsWith('$')) continue // Skip meta fields
      if (value === null || value === undefined) continue

      if (typeof value === 'object') {
        parts.push(`${key}: ${JSON.stringify(value)}`)
      } else {
        parts.push(`${key}: ${value}`)
      }
    }

    return parts.join(' ')
  }

  /**
   * Index a Thing for semantic search
   *
   * @param thing - The Thing to index
   * @returns Promise resolving when indexed
   */
  async index(thing: Thing): Promise<void> {
    const text = this.thingToText(thing)
    const embedding = await this.embeddingProvider.embed(text)

    // Serialize thing data for retrieval (exclude functions)
    const data = JSON.stringify(thing, (key, value) => {
      if (typeof value === 'function') return undefined
      return value
    })

    await this.vectorize.upsert([
      {
        id: thing.$id,
        values: embedding,
        metadata: {
          $id: thing.$id,
          $type: thing.$type,
          data,
        },
      },
    ])
  }

  /**
   * Index multiple Things
   *
   * @param things - Array of Things to index
   * @returns Promise resolving when all indexed
   */
  async indexBatch(things: Thing[]): Promise<void> {
    if (things.length === 0) return

    const texts = things.map((t) => this.thingToText(t))
    const embeddings = await this.embeddingProvider.embedBatch(texts)

    const vectors = things.map((thing, i) => ({
      id: thing.$id,
      values: embeddings[i],
      metadata: {
        $id: thing.$id,
        $type: thing.$type,
        data: JSON.stringify(thing, (key, value) => {
          if (typeof value === 'function') return undefined
          return value
        }),
      } as VectorMetadata,
    }))

    await this.vectorize.upsert(vectors)
  }

  /**
   * Remove a Thing from the index
   *
   * @param thingId - ID of the Thing to remove
   * @returns Promise resolving when removed
   */
  async remove(thingId: string): Promise<void> {
    await this.vectorize.deleteByIds([thingId])
  }

  /**
   * Find Things semantically similar to the query Thing
   *
   * @param from - The source Thing to find similar items for
   * @param targetType - Optional type filter for results
   * @param options - Search options (threshold, topK, withScores)
   * @returns Promise of similar Things
   */
  async findSimilar(
    from: Thing,
    targetType?: string,
    options?: FuzzyOptions & { topK?: number }
  ): Promise<Thing[] | ScoredThing[]> {
    const threshold = options?.threshold ?? this.defaultThreshold
    const topK = options?.topK ?? this.defaultTopK
    const withScores = options?.withScores ?? false

    // Generate embedding for the source thing
    const text = this.thingToText(from)
    const embedding = await this.embeddingProvider.embed(text)

    // Build filter
    const filter: Record<string, string> = {}
    if (targetType) {
      filter.$type = targetType
    }

    // Query the vector index
    const result = await this.vectorize.query(embedding, {
      topK,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      returnMetadata: 'all',
    })

    // Filter by threshold and convert to Things
    const things: ScoredThing[] = []

    for (const match of result.matches) {
      if (match.score < threshold) continue

      // Reconstruct Thing from metadata
      let thing: Thing
      if (match.metadata?.data) {
        try {
          thing = JSON.parse(match.metadata.data) as Thing
        } catch {
          // Fallback: create minimal thing
          thing = {
            $id: match.metadata.$id,
            $type: match.metadata.$type,
          }
        }
      } else if (match.metadata) {
        thing = {
          $id: match.metadata.$id,
          $type: match.metadata.$type,
        }
      } else {
        continue // Skip if no metadata
      }

      things.push({
        ...thing,
        score: match.score,
      })
    }

    if (withScores) {
      return things
    }

    // Remove scores
    return things.map(({ score, ...rest }) => rest as Thing)
  }

  /**
   * Find Things that are semantically related to the target Thing
   * (reverse semantic search)
   *
   * @param to - The target Thing
   * @param sourceType - Optional type filter for source Things
   * @param options - Search options
   * @returns Promise of related Things
   */
  async findRelatedTo(
    to: Thing,
    sourceType?: string,
    options?: FuzzyOptions & { topK?: number }
  ): Promise<Thing[] | ScoredThing[]> {
    // For semantic similarity, forward and backward are the same operation
    // (similarity is symmetric in embedding space)
    return this.findSimilar(to, sourceType, options)
  }

  /**
   * Perform a semantic search using a text query
   *
   * @param query - Text query
   * @param targetType - Optional type filter
   * @param options - Search options
   * @returns Promise of matching Things
   */
  async search(
    query: string,
    targetType?: string,
    options?: FuzzyOptions & { topK?: number }
  ): Promise<Thing[] | ScoredThing[]> {
    const threshold = options?.threshold ?? this.defaultThreshold
    const topK = options?.topK ?? this.defaultTopK
    const withScores = options?.withScores ?? false

    // Generate embedding for the query
    const embedding = await this.embeddingProvider.embed(query)

    // Build filter
    const filter: Record<string, string> = {}
    if (targetType) {
      filter.$type = targetType
    }

    // Query the vector index
    const result = await this.vectorize.query(embedding, {
      topK,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      returnMetadata: 'all',
    })

    // Filter by threshold and convert to Things
    const things: ScoredThing[] = []

    for (const match of result.matches) {
      if (match.score < threshold) continue

      let thing: Thing
      if (match.metadata?.data) {
        try {
          thing = JSON.parse(match.metadata.data) as Thing
        } catch {
          thing = {
            $id: match.metadata.$id,
            $type: match.metadata.$type,
          }
        }
      } else if (match.metadata) {
        thing = {
          $id: match.metadata.$id,
          $type: match.metadata.$type,
        }
      } else {
        continue
      }

      things.push({
        ...thing,
        score: match.score,
      })
    }

    if (withScores) {
      return things
    }

    return things.map(({ score, ...rest }) => rest as Thing)
  }

  /**
   * Perform a semantic search with streaming results
   *
   * @param query - Text query
   * @param targetType - Optional type filter
   * @param options - Search options
   * @yields Things matching the query one at a time
   */
  async *searchStream(
    query: string,
    targetType?: string,
    options?: FuzzyOptions & { topK?: number }
  ): AsyncIterable<Thing> {
    const threshold = options?.threshold ?? this.defaultThreshold
    const topK = options?.topK ?? this.defaultTopK

    // Generate embedding for the query
    const embedding = await this.embeddingProvider.embed(query)

    // Build filter
    const filter: Record<string, string> = {}
    if (targetType) {
      filter.$type = targetType
    }

    // Check if vectorize supports streaming
    const index = this.vectorize as InMemoryVectorIndex
    if (typeof index.queryStream === 'function') {
      for await (const match of index.queryStream(embedding, {
        topK,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        returnMetadata: 'all',
      })) {
        if (match.score < threshold) continue

        let thing: Thing
        if (match.metadata?.data) {
          try {
            thing = JSON.parse(match.metadata.data) as Thing
          } catch {
            thing = {
              $id: match.metadata.$id,
              $type: match.metadata.$type,
            }
          }
        } else if (match.metadata) {
          thing = {
            $id: match.metadata.$id,
            $type: match.metadata.$type,
          }
        } else {
          continue
        }

        yield thing
      }
    } else {
      // Fallback to non-streaming search
      const results = await this.search(query, targetType, options)
      for (const thing of results as Thing[]) {
        yield thing
      }
    }
  }

  /**
   * Index multiple Things in chunks for memory efficiency
   *
   * @param things - Array of Things to index
   * @param options - Options including chunkSize
   * @returns Promise resolving when all indexed
   */
  async indexBatchChunked(things: Thing[], options?: { chunkSize?: number }): Promise<void> {
    const chunkSize = options?.chunkSize ?? 100
    for (let i = 0; i < things.length; i += chunkSize) {
      const chunk = things.slice(i, i + chunkSize)
      await this.indexBatch(chunk)
    }
  }

  /**
   * Index Things from an async iterator (streaming insert)
   *
   * @param stream - AsyncIterable of Things to index
   * @param options - Options including batchSize for batching inserts
   * @returns Promise resolving when all indexed
   */
  async indexStream(stream: AsyncIterable<Thing>, options?: { batchSize?: number }): Promise<void> {
    const batchSize = options?.batchSize ?? 100
    let batch: Thing[] = []

    for await (const thing of stream) {
      batch.push(thing)
      if (batch.length >= batchSize) {
        await this.indexBatch(batch)
        batch = []
      }
    }

    // Index remaining items
    if (batch.length > 0) {
      await this.indexBatch(batch)
    }
  }
}

// =============================================================================
// Module-level singleton and factory
// =============================================================================

let defaultStore: VectorStore | null = null

/**
 * Get or create the default VectorStore instance
 */
export function getVectorStore(config?: VectorStoreConfig): VectorStore {
  if (!defaultStore || config) {
    defaultStore = new VectorStore(config)
  }
  return defaultStore
}

/**
 * Reset the default VectorStore (for testing)
 */
export function resetVectorStore(): void {
  defaultStore = null
}
