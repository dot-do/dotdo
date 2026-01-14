/**
 * Vector Search for Agent Memory
 *
 * Provides semantic memory search capabilities for agents using vector embeddings.
 * This integrates with the existing memory systems:
 * - agents/memory.ts: ConversationMemory with FIFO/summarize
 * - agents/unified-memory.ts: Graph-backed AgentMemory
 * - db/edgevec/: HNSW vector index
 * - lib/cloudflare/ai.ts: Workers AI embeddings
 *
 * ## Architecture Decision: Hybrid Embedding Generation
 *
 * After evaluating options, we recommend a **hybrid approach**:
 * 1. **API-based (Workers AI)**: Primary for quality - BGE-Base-EN v1.5 (768 dims)
 * 2. **Matryoshka truncation**: 256 dims for hot tier, 768 for warm tier
 * 3. **Edge caching**: EmbeddingCache for repeated context lookups
 *
 * ## Vector Storage Decision: EdgeVec (DO-native)
 *
 * Selected **EdgeVec** (in-DO HNSW) for memory search because:
 * 1. Co-located with DO state - no external service latency
 * 2. SQLite persistence via DO storage
 * 3. HNSW for fast ANN search
 * 4. Existing integration with EmbeddingCache
 *
 * Alternative: Vectorize for cross-DO search (future enhancement)
 *
 * @see docs/spikes/embedding-memory-search.md - Full spike documentation
 * @module agents/memory/vector-search
 */

import type { AgentMemory, MemoryThing, MemoryType, StoreMemoryOptions, MemorySearchOptions } from '../unified-memory'
import { cosineSimilarityUnrolled, l2DistanceUnrolled, dotProductUnrolled } from '../../db/edgevec/vector-ops'

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for vector-enabled memory
 */
export interface VectorMemoryConfig {
  /** Vector dimensions (256 for hot tier, 768 for full quality) */
  dimensions: 256 | 768
  /** Distance metric for similarity */
  metric: 'cosine' | 'euclidean' | 'dot'
  /** Maximum vectors to store (affects memory usage) */
  maxVectors: number
  /** HNSW M parameter (connections per node, default: 16) */
  hnswM?: number
  /** HNSW efConstruction (build quality, default: 200) */
  efConstruction?: number
  /** Minimum similarity score (0-1) for search results */
  minSimilarity?: number
}

/**
 * Embedding provider interface
 */
export interface EmbeddingProvider {
  /**
   * Generate embedding for a single text
   */
  embed(text: string): Promise<Float32Array>

  /**
   * Generate embeddings for multiple texts (batch)
   */
  embedBatch(texts: string[]): Promise<Float32Array[]>

  /**
   * Get embedding dimensions
   */
  getDimensions(): number
}

/**
 * Vector search result with similarity score
 */
export interface VectorSearchResult {
  /** Memory ID */
  id: string
  /** Similarity score (0-1 for cosine) */
  score: number
  /** Memory content */
  content: string
  /** Memory type */
  type: MemoryType
  /** Optional metadata */
  metadata?: Record<string, unknown>
  /** When the memory was created */
  createdAt: Date
}

/**
 * Options for semantic memory search
 */
export interface SemanticSearchOptions extends MemorySearchOptions {
  /** Number of approximate neighbors to consider (HNSW ef) */
  ef?: number
  /** Whether to rerank results using full embeddings */
  rerank?: boolean
}

// ============================================================================
// Workers AI Embedding Provider
// ============================================================================

/**
 * Workers AI embedding provider using BGE-Base-EN v1.5
 *
 * Generates 768-dim embeddings with optional Matryoshka truncation to 256-dim.
 *
 * @example
 * ```typescript
 * const provider = new WorkersAIEmbeddingProvider(env.AI, { truncateTo: 256 })
 * const embedding = await provider.embed('Hello, world!')
 * ```
 */
export class WorkersAIEmbeddingProvider implements EmbeddingProvider {
  private ai: Ai
  private model: string
  private targetDimensions: number
  private fullDimensions: number = 768

  constructor(
    ai: Ai,
    options?: {
      /** Model to use (default: BGE-Base-EN v1.5) */
      model?: string
      /** Target dimensions after Matryoshka truncation */
      truncateTo?: 256 | 768
    }
  ) {
    this.ai = ai
    this.model = options?.model ?? '@cf/baai/bge-base-en-v1.5'
    this.targetDimensions = options?.truncateTo ?? 768
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await this.ai.run(this.model as any, { text })
    const embedding = (response as { data: number[][] }).data[0]

    if (!embedding) {
      throw new Error('No embedding returned from Workers AI')
    }

    // Convert to Float32Array
    const fullEmbedding = new Float32Array(embedding)

    // Apply Matryoshka truncation if needed
    if (this.targetDimensions < this.fullDimensions) {
      return this.truncate(fullEmbedding, this.targetDimensions)
    }

    return fullEmbedding
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []

    // Workers AI supports batch embedding
    const response = await this.ai.run(this.model as any, { text: texts })
    const embeddings = (response as { data: number[][] }).data

    return embeddings.map((embedding) => {
      const full = new Float32Array(embedding)
      if (this.targetDimensions < this.fullDimensions) {
        return this.truncate(full, this.targetDimensions)
      }
      return full
    })
  }

  getDimensions(): number {
    return this.targetDimensions
  }

  /**
   * Truncate embedding using Matryoshka principle
   */
  private truncate(embedding: Float32Array, targetDim: number): Float32Array {
    const truncated = new Float32Array(targetDim)
    for (let i = 0; i < targetDim; i++) {
      truncated[i] = embedding[i]!
    }

    // L2 normalize after truncation
    let norm = 0
    for (let i = 0; i < targetDim; i++) {
      norm += truncated[i]! * truncated[i]!
    }
    norm = Math.sqrt(norm)

    if (norm > 0) {
      for (let i = 0; i < targetDim; i++) {
        truncated[i] = truncated[i]! / norm
      }
    }

    return truncated
  }
}

// ============================================================================
// In-Memory HNSW Index (for testing and lightweight deployments)
// ============================================================================

/**
 * Simple in-memory vector index using brute-force search
 *
 * Optimizations:
 * - Uses SIMD-friendly loop-unrolled distance functions
 * - Pre-computes and caches norms for cosine similarity
 * - Avoids redundant sqrt operations during search
 *
 * For production, use EdgeVec (db/edgevec/) which provides:
 * - HNSW for O(log n) search
 * - DO persistence
 * - R2 backup
 */
export class SimpleVectorIndex {
  private vectors: Map<string, { embedding: Float32Array; metadata: Record<string, unknown>; norm: number }> = new Map()
  private metric: 'cosine' | 'euclidean' | 'dot'
  private dimensions: number

  constructor(config: { dimensions: number; metric: 'cosine' | 'euclidean' | 'dot' }) {
    this.dimensions = config.dimensions
    this.metric = config.metric
  }

  /**
   * Insert or update a vector
   */
  insert(id: string, embedding: Float32Array, metadata: Record<string, unknown> = {}): void {
    if (embedding.length !== this.dimensions) {
      throw new Error(`Dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`)
    }
    // Pre-compute norm for cosine similarity optimization
    const norm = this.computeNorm(embedding)
    this.vectors.set(id, { embedding, metadata, norm })
  }

  /**
   * Delete a vector
   */
  delete(id: string): boolean {
    return this.vectors.delete(id)
  }

  /**
   * Search for similar vectors
   *
   * Optimized with pre-computed norms for cosine similarity.
   */
  search(query: Float32Array, k: number, filter?: (metadata: Record<string, unknown>) => boolean): Array<{ id: string; score: number; metadata: Record<string, unknown> }> {
    const results: Array<{ id: string; score: number; metadata: Record<string, unknown> }> = []

    // Pre-compute query norm for cosine similarity (only once per search)
    const queryNorm = this.metric === 'cosine' ? this.computeNorm(query) : 0

    for (const [id, { embedding, metadata, norm }] of this.vectors) {
      // Apply optional filter
      if (filter && !filter(metadata)) continue

      const score = this.computeScore(query, queryNorm, embedding, norm)
      results.push({ id, score, metadata })
    }

    // Sort by score descending (higher = more similar)
    results.sort((a, b) => b.score - a.score)

    return results.slice(0, k)
  }

  /**
   * Get index size
   */
  size(): number {
    return this.vectors.size
  }

  /**
   * Clear all vectors
   */
  clear(): void {
    this.vectors.clear()
  }

  /**
   * Compute similarity score using optimized SIMD-friendly functions
   * Uses pre-computed norms for cosine similarity to avoid redundant sqrt operations
   */
  private computeScore(query: Float32Array, queryNorm: number, embedding: Float32Array, embeddingNorm: number): number {
    switch (this.metric) {
      case 'cosine':
        // Optimized cosine: use pre-computed norms, just compute dot product
        if (queryNorm === 0 || embeddingNorm === 0) return 0
        return dotProductUnrolled(query, embedding) / (queryNorm * embeddingNorm)
      case 'euclidean':
        // Convert distance to similarity (higher is better)
        return 1 / (1 + l2DistanceUnrolled(query, embedding))
      case 'dot':
        return dotProductUnrolled(query, embedding)
    }
  }

  /**
   * Compute L2 norm with loop unrolling for efficiency
   */
  private computeNorm(v: Float32Array): number {
    const len = v.length
    const remainder = len % 4
    const unrolledLen = len - remainder

    let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0

    for (let i = 0; i < unrolledLen; i += 4) {
      const v0 = v[i]!, v1 = v[i + 1]!, v2 = v[i + 2]!, v3 = v[i + 3]!
      sum0 += v0 * v0
      sum1 += v1 * v1
      sum2 += v2 * v2
      sum3 += v3 * v3
    }

    let sumR = 0
    for (let i = unrolledLen; i < len; i++) {
      sumR += v[i]! * v[i]!
    }

    return Math.sqrt(sum0 + sum1 + sum2 + sum3 + sumR)
  }
}

// ============================================================================
// Vector-Enabled Memory Implementation
// ============================================================================

/**
 * VectorMemory wraps an AgentMemory with vector search capabilities
 *
 * @example
 * ```typescript
 * // Create with Workers AI embeddings
 * const vectorMemory = new VectorMemory(
 *   baseMemory,
 *   new WorkersAIEmbeddingProvider(env.AI, { truncateTo: 256 }),
 *   { dimensions: 256, metric: 'cosine', maxVectors: 10000 }
 * )
 *
 * // Store memory with automatic embedding
 * await vectorMemory.remember('User prefers dark mode', { type: 'long-term' })
 *
 * // Semantic search
 * const results = await vectorMemory.semanticSearch('What are the user preferences?')
 * ```
 */
export class VectorMemory {
  private memory: AgentMemory
  private embedder: EmbeddingProvider
  private index: SimpleVectorIndex
  private config: VectorMemoryConfig

  // Cache for memory ID -> embedding
  private embeddingCache: Map<string, Float32Array> = new Map()

  constructor(memory: AgentMemory, embedder: EmbeddingProvider, config: VectorMemoryConfig) {
    this.memory = memory
    this.embedder = embedder
    this.config = config
    this.index = new SimpleVectorIndex({
      dimensions: config.dimensions,
      metric: config.metric,
    })
  }

  /**
   * Store a memory with automatic embedding generation
   */
  async remember(content: string, options?: StoreMemoryOptions): Promise<MemoryThing> {
    // Generate embedding
    const embedding = await this.embedder.embed(content)

    // Store in base memory
    const memory = await this.memory.remember(content, {
      ...options,
      embedding: Array.from(embedding),
    })

    // Index for vector search
    this.index.insert(memory.id, embedding, {
      type: memory.type,
      createdAt: memory.createdAt.toISOString(),
      ...options?.metadata,
    })

    // Cache embedding
    this.embeddingCache.set(memory.id, embedding)

    return memory
  }

  /**
   * Semantic search using vector similarity
   */
  async semanticSearch(query: string, options?: SemanticSearchOptions): Promise<VectorSearchResult[]> {
    const limit = options?.limit ?? 10
    const minSimilarity = options?.minSimilarity ?? this.config.minSimilarity ?? 0.5

    // Generate query embedding
    const queryEmbedding = await this.embedder.embed(query)

    // Search index
    const results = this.index.search(queryEmbedding, limit * 2, (metadata) => {
      // Apply type filter if specified
      if (options?.type && metadata.type !== options.type) return false
      return true
    })

    // Filter by minimum similarity and fetch full memories
    const searchResults: VectorSearchResult[] = []

    for (const result of results) {
      if (result.score < minSimilarity) continue

      const memory = await this.memory.getMemory(result.id)
      if (!memory) continue

      searchResults.push({
        id: memory.id,
        score: result.score,
        content: memory.content,
        type: memory.type,
        metadata: memory.metadata,
        createdAt: memory.createdAt,
      })

      if (searchResults.length >= limit) break
    }

    return searchResults
  }

  /**
   * Hybrid search combining text and semantic matching
   */
  async hybridSearch(
    query: string,
    options?: SemanticSearchOptions & { textWeight?: number }
  ): Promise<VectorSearchResult[]> {
    const textWeight = options?.textWeight ?? 0.3
    const semanticWeight = 1 - textWeight

    // Get semantic results
    const semanticResults = await this.semanticSearch(query, { ...options, limit: (options?.limit ?? 10) * 2 })

    // Get text search results from base memory
    const textResults = await this.memory.searchMemories(query, options)

    // Combine and score
    const combined = new Map<string, { semantic: number; text: number; memory: MemoryThing }>()

    for (const result of semanticResults) {
      const memory = await this.memory.getMemory(result.id)
      if (memory) {
        combined.set(result.id, {
          semantic: result.score,
          text: 0,
          memory,
        })
      }
    }

    for (const memory of textResults) {
      if (combined.has(memory.id)) {
        combined.get(memory.id)!.text = 1 // Full match for text search
      } else {
        combined.set(memory.id, {
          semantic: 0,
          text: 1,
          memory,
        })
      }
    }

    // Compute hybrid scores and sort
    const results = Array.from(combined.entries())
      .map(([id, { semantic, text, memory }]) => ({
        id,
        score: semantic * semanticWeight + text * textWeight,
        content: memory.content,
        type: memory.type,
        metadata: memory.metadata,
        createdAt: memory.createdAt,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options?.limit ?? 10)

    return results
  }

  /**
   * Delete a memory and its embedding
   */
  async deleteMemory(id: string): Promise<boolean> {
    this.index.delete(id)
    this.embeddingCache.delete(id)
    return this.memory.deleteMemory(id)
  }

  /**
   * Get the underlying AgentMemory
   */
  getBaseMemory(): AgentMemory {
    return this.memory
  }

  /**
   * Get index statistics
   */
  getStats(): { vectorCount: number; cacheSize: number; dimensions: number } {
    return {
      vectorCount: this.index.size(),
      cacheSize: this.embeddingCache.size,
      dimensions: this.config.dimensions,
    }
  }

  /**
   * Warm the vector index from existing memories
   *
   * Call this on agent startup to load existing memories into the index.
   */
  async warmIndex(): Promise<number> {
    const memories = await this.memory.getRecentMemories(this.config.maxVectors)
    let indexed = 0

    // Batch embed for efficiency
    const textsToEmbed: string[] = []
    const memoriesToIndex: MemoryThing[] = []

    for (const memory of memories) {
      // Skip if already has embedding in metadata
      if (memory.embedding && memory.embedding.length === this.config.dimensions) {
        const embedding = new Float32Array(memory.embedding)
        this.index.insert(memory.id, embedding, {
          type: memory.type,
          createdAt: memory.createdAt.toISOString(),
        })
        this.embeddingCache.set(memory.id, embedding)
        indexed++
      } else {
        textsToEmbed.push(memory.content)
        memoriesToIndex.push(memory)
      }
    }

    // Batch embed remaining
    if (textsToEmbed.length > 0) {
      const embeddings = await this.embedder.embedBatch(textsToEmbed)

      for (let i = 0; i < embeddings.length; i++) {
        const memory = memoriesToIndex[i]!
        const embedding = embeddings[i]!

        this.index.insert(memory.id, embedding, {
          type: memory.type,
          createdAt: memory.createdAt.toISOString(),
        })
        this.embeddingCache.set(memory.id, embedding)
        indexed++
      }
    }

    return indexed
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a vector-enabled memory with Workers AI embeddings
 *
 * @param baseMemory - The underlying AgentMemory
 * @param ai - Workers AI binding
 * @param options - Configuration options
 */
export function createVectorMemory(
  baseMemory: AgentMemory,
  ai: Ai,
  options?: Partial<VectorMemoryConfig>
): VectorMemory {
  const config: VectorMemoryConfig = {
    dimensions: options?.dimensions ?? 256,
    metric: options?.metric ?? 'cosine',
    maxVectors: options?.maxVectors ?? 10000,
    hnswM: options?.hnswM ?? 16,
    efConstruction: options?.efConstruction ?? 200,
    minSimilarity: options?.minSimilarity ?? 0.5,
  }

  const embedder = new WorkersAIEmbeddingProvider(ai, {
    truncateTo: config.dimensions,
  })

  return new VectorMemory(baseMemory, embedder, config)
}

/**
 * Create a vector memory for testing (no Workers AI required)
 */
export function createTestVectorMemory(
  baseMemory: AgentMemory,
  options?: Partial<VectorMemoryConfig>
): VectorMemory {
  const config: VectorMemoryConfig = {
    dimensions: options?.dimensions ?? 256,
    metric: options?.metric ?? 'cosine',
    maxVectors: options?.maxVectors ?? 1000,
    minSimilarity: options?.minSimilarity ?? 0.5,
  }

  // Mock embedder that generates random embeddings
  const mockEmbedder: EmbeddingProvider = {
    embed: async (text: string) => {
      // Generate deterministic "embedding" based on text hash
      const embedding = new Float32Array(config.dimensions)
      let hash = 0
      for (let i = 0; i < text.length; i++) {
        hash = (hash << 5) - hash + text.charCodeAt(i)
        hash |= 0
      }

      for (let i = 0; i < config.dimensions; i++) {
        hash = (hash * 1103515245 + 12345) & 0x7fffffff
        embedding[i] = (hash / 0x7fffffff) * 2 - 1
      }

      // Normalize
      let norm = 0
      for (let i = 0; i < config.dimensions; i++) {
        norm += embedding[i]! * embedding[i]!
      }
      norm = Math.sqrt(norm)
      for (let i = 0; i < config.dimensions; i++) {
        embedding[i] = embedding[i]! / norm
      }

      return embedding
    },
    embedBatch: async (texts: string[]) => {
      return Promise.all(texts.map((t) => mockEmbedder.embed(t)))
    },
    getDimensions: () => config.dimensions,
  }

  return new VectorMemory(baseMemory, mockEmbedder, config)
}

// ============================================================================
// Re-exports
// ============================================================================

export type { AgentMemory, MemoryThing, MemoryType, StoreMemoryOptions, MemorySearchOptions }
