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
// In-Memory Vector Index (Mock for testing)
// =============================================================================

/**
 * In-memory vector index for testing without Cloudflare Vectorize
 *
 * Implements cosine similarity search in-process. Useful for:
 * - Unit testing without external dependencies
 * - Local development
 * - Small datasets (not production scale)
 *
 * All vectors are stored in memory and cleared when the process exits.
 */
export class InMemoryVectorIndex implements VectorizeIndex {
  private vectors: Map<string, { values: number[]; metadata?: VectorMetadata }> = new Map()

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
        count++
      }
    }
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
      this.vectors.set(v.id, { values: v.values, metadata: v.metadata })
    }
    return { count: vectors.length }
  }

  /**
   * Query for vectors similar to the given vector
   *
   * Uses cosine similarity (0-1 scale) to find similar vectors.
   * Results are sorted by similarity score descending and limited by topK.
   *
   * @param vector - Query vector to find matches for
   * @param options - Query options
   * @returns Sorted matches with scores and optional metadata
   */
  async query(
    vector: number[],
    options?: {
      topK?: number
      filter?: Record<string, string | number | boolean>
      returnMetadata?: boolean | 'all' | 'indexed' | 'none'
      returnValues?: boolean
    }
  ): Promise<{ matches: VectorMatch[] }> {
    const topK = options?.topK ?? DEFAULT_TOP_K
    const filter = options?.filter
    const returnMetadata = options?.returnMetadata ?? true

    // Calculate cosine similarity for all vectors
    const matches: VectorMatch[] = []

    for (const [id, stored] of Array.from(this.vectors.entries())) {
      // Apply type filter if specified
      if (filter) {
        if (filter.$type && stored.metadata?.$type !== filter.$type) {
          continue
        }
      }

      const score = this.cosineSimilarity(vector, stored.values)
      matches.push({
        id,
        score,
        metadata: returnMetadata && returnMetadata !== 'none' ? stored.metadata : undefined,
      })
    }

    // Sort by score descending and take topK
    matches.sort((a, b) => b.score - a.score)
    return { matches: matches.slice(0, topK) }
  }

  async getByIds(
    ids: string[]
  ): Promise<{ vectors: Array<{ id: string; values: number[]; metadata?: VectorMetadata }> }> {
    const vectors: Array<{ id: string; values: number[]; metadata?: VectorMetadata }> = []
    for (const id of ids) {
      const stored = this.vectors.get(id)
      if (stored) {
        vectors.push({ id, values: stored.values, metadata: stored.metadata })
      }
    }
    return { vectors }
  }

  async deleteByIds(ids: string[]): Promise<{ count: number }> {
    let count = 0
    for (const id of ids) {
      if (this.vectors.delete(id)) {
        count++
      }
    }
    return { count }
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
   */
  constructor(config?: VectorStoreConfig) {
    // Use provided Vectorize or create in-memory index
    this.vectorize = config?.vectorize ?? new InMemoryVectorIndex()

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
