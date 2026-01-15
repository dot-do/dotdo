/**
 * HybridVectorStore
 *
 * Advanced hybrid search combining FTS5 and vector similarity with RRF fusion.
 * Provides a complete vector store with Matryoshka compression, binary quantization,
 * and multi-stage progressive search.
 *
 * @module db/vector/hybrid
 */

import { truncateEmbedding } from './matryoshka'
import { toBinary, packBits, packedHammingDistance } from '../core/vector/quantization/binary'
import type { CDCEvent } from './types'
import type { SqlStorageInterface } from './store'

// ============================================================================
// TYPES
// ============================================================================

export interface HybridVectorStoreOptions {
  dimension?: number
  matryoshkaDims?: number[]
  useBinaryPrefilter?: boolean
  onCDC?: (event: CDCEvent) => void
}

export interface VectorResult {
  $id: string
  embedding: Float32Array
  metadata: Record<string, unknown>
  mat_64?: Float32Array
  mat_256?: Float32Array
  binaryHash?: ArrayBuffer
}

export interface SearchResultItem {
  $id: string
  similarity: number
  distance: number
  metadata: Record<string, unknown>
}

export interface HybridSearchResultItem extends SearchResultItem {
  rrfScore?: number
  vectorRank?: number | null
  ftsRank?: number | null
}

export interface HybridSearchOptions {
  ftsWeight?: number
  vectorWeight?: number
  filters?: Record<string, unknown>
}

export interface ProgressiveSearchOptions {
  stages?: ProgressiveSearchStage[]
  returnTiming?: boolean
}

export interface ProgressiveSearchStage {
  type: 'binary' | 'matryoshka' | 'exact'
  dim?: number
  candidates: number
}

export interface BatchVectorInput {
  id: string | null
  embedding: Float32Array
  metadata: Record<string, unknown>
}

export interface BatchOptions {
  partition?: string
}

// ============================================================================
// INTERNAL STORAGE TYPES
// ============================================================================

interface StoredVector {
  $id: string
  embedding: Float32Array
  metadata: Record<string, unknown>
  mat_64?: Float32Array
  mat_256?: Float32Array
  binaryHash?: ArrayBuffer
}

// ============================================================================
// HYBRID VECTOR STORE CLASS
// ============================================================================

export class HybridVectorStore {
  readonly dimension: number
  readonly matryoshkaDims: number[]
  private readonly useBinaryPrefilter: boolean
  private readonly onCDCCallback?: (event: CDCEvent) => void

  private db: SqlStorageInterface
  private vectors = new Map<string, StoredVector>()
  private ftsIndex = new Map<string, string>()
  private idCounter = 0

  constructor(db: SqlStorageInterface, options: HybridVectorStoreOptions = {}) {
    this.db = db
    this.dimension = options.dimension ?? 1536
    this.matryoshkaDims = options.matryoshkaDims ?? []
    this.useBinaryPrefilter = options.useBinaryPrefilter ?? false
    this.onCDCCallback = options.onCDC
  }

  // ============================================================================
  // CDC EVENTS
  // ============================================================================

  private emitCDC(event: CDCEvent): void {
    if (this.onCDCCallback) {
      this.onCDCCallback(event)
    }
  }

  // ============================================================================
  // ID GENERATION
  // ============================================================================

  private generateId(): string {
    this.idCounter++
    return `vec_auto_${Date.now()}_${this.idCounter}`
  }

  // ============================================================================
  // addVector
  // ============================================================================

  async addVector(
    id: string | null,
    embedding: Float32Array,
    metadata: Record<string, unknown>
  ): Promise<{ $id: string }> {
    // Validate embedding dimension
    if (embedding.length !== this.dimension) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimension}, got ${embedding.length}`
      )
    }

    const vectorId = id ?? this.generateId()

    // Create matryoshka prefixes
    const mat_64 =
      this.matryoshkaDims.includes(64) && this.dimension >= 64
        ? truncateEmbedding(embedding, 64)
        : undefined

    const mat_256 =
      this.matryoshkaDims.includes(256) && this.dimension >= 256
        ? truncateEmbedding(embedding, 256)
        : undefined

    // Create binary hash
    const binaryBits = toBinary(embedding)
    const binaryHash = packBits(binaryBits).buffer

    const storedVector: StoredVector = {
      $id: vectorId,
      embedding,
      metadata,
      mat_64,
      mat_256,
      binaryHash,
    }

    this.vectors.set(vectorId, storedVector)

    // Index content in FTS
    if (metadata.content) {
      this.ftsIndex.set(vectorId, metadata.content.toLowerCase())
    }

    // Emit CDC event
    this.emitCDC({
      type: 'cdc.insert',
      op: 'c',
      store: 'vector',
      key: vectorId,
      timestamp: Date.now(),
    })

    return { $id: vectorId }
  }

  // ============================================================================
  // getVector
  // ============================================================================

  async getVector(id: string): Promise<VectorResult | null> {
    const stored = this.vectors.get(id)
    if (!stored) return null

    return {
      $id: stored.$id,
      embedding: stored.embedding,
      metadata: stored.metadata,
      mat_64: stored.mat_64,
      mat_256: stored.mat_256,
      binaryHash: stored.binaryHash,
    }
  }

  // ============================================================================
  // deleteVector
  // ============================================================================

  async deleteVector(id: string): Promise<void> {
    const existed = this.vectors.has(id)
    this.vectors.delete(id)
    this.ftsIndex.delete(id)

    if (existed) {
      this.emitCDC({
        type: 'cdc.delete',
        op: 'd',
        store: 'vector',
        key: id,
        timestamp: Date.now(),
      })
    }
  }

  // ============================================================================
  // updateMetadata
  // ============================================================================

  async updateMetadata(id: string, newMetadata: Record<string, unknown>): Promise<void> {
    const stored = this.vectors.get(id)
    if (!stored) {
      throw new Error(`Vector with id '${id}' not found`)
    }

    // Merge metadata (partial update)
    stored.metadata = { ...stored.metadata, ...newMetadata }

    // Update FTS index if content changed
    if (newMetadata.content !== undefined) {
      this.ftsIndex.set(id, newMetadata.content.toLowerCase())
    }

    // Emit CDC event
    this.emitCDC({
      type: 'cdc.update',
      op: 'u',
      store: 'vector',
      key: id,
      timestamp: Date.now(),
    })
  }

  // ============================================================================
  // search (k-NN)
  // ============================================================================

  async search(
    queryVector: Float32Array,
    k: number,
    filters?: Record<string, unknown>
  ): Promise<SearchResultItem[]> {
    if (this.vectors.size === 0) {
      return []
    }

    let candidates = Array.from(this.vectors.values())

    // Apply metadata filters
    if (filters) {
      candidates = candidates.filter((vec) => {
        for (const [key, value] of Object.entries(filters)) {
          if (vec.metadata[key] !== value) {
            return false
          }
        }
        return true
      })
    }

    // Binary prefilter stage
    if (this.useBinaryPrefilter && candidates.length > k * 10) {
      const queryBinaryBits = toBinary(queryVector)
      const queryBinaryHash = packBits(queryBinaryBits)

      candidates.sort((a, b) => {
        const hashA = new Uint8Array(a.binaryHash!)
        const hashB = new Uint8Array(b.binaryHash!)
        const distA = packedHammingDistance(queryBinaryHash, hashA)
        const distB = packedHammingDistance(queryBinaryHash, hashB)
        return distA - distB
      })

      candidates = candidates.slice(0, Math.min(candidates.length, k * 10))
    }

    // Compute exact cosine similarity
    const results = candidates.map((vec) => {
      const similarity = this.cosineSimilarity(queryVector, vec.embedding)
      return {
        $id: vec.$id,
        similarity,
        distance: 1 - similarity,
        metadata: vec.metadata,
      }
    })

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity)

    return results.slice(0, k)
  }

  // ============================================================================
  // hybridSearch (vector + FTS with RRF)
  // ============================================================================

  async hybridSearch(
    queryVector: Float32Array | null,
    queryText: string | null,
    k: number,
    options?: HybridSearchOptions
  ): Promise<HybridSearchResultItem[]> {
    const ftsWeight = options?.ftsWeight ?? 0.5
    const vectorWeight = options?.vectorWeight ?? 0.5
    const filters = options?.filters

    // Vector-only search
    if (queryVector && !queryText) {
      const vectorResults = await this.search(queryVector, k, filters)
      return vectorResults.map((r, idx) => ({
        ...r,
        rrfScore: 1 / (60 + (idx + 1)),
        vectorRank: idx + 1,
        ftsRank: null,
      }))
    }

    // Text-only search
    if (!queryVector && queryText) {
      const ftsResults = this.ftsSearch(queryText, k, filters)
      return ftsResults.map((r, idx) => ({
        ...r,
        rrfScore: 1 / (60 + (idx + 1)),
        vectorRank: null,
        ftsRank: idx + 1,
      }))
    }

    // Hybrid search with RRF fusion
    const expandedK = k * 2

    let vectorResults: SearchResultItem[] = []
    let ftsResults: SearchResultItem[] = []

    if (queryVector) {
      vectorResults = await this.search(queryVector, expandedK, filters)
    }

    if (queryText) {
      ftsResults = this.ftsSearch(queryText, expandedK, filters)
    }

    // Build rank maps
    const vectorRankMap = new Map<string, number>()
    vectorResults.forEach((r, i) => vectorRankMap.set(r.$id, i + 1))

    const ftsRankMap = new Map<string, number>()
    ftsResults.forEach((r, i) => ftsRankMap.set(r.$id, i + 1))

    // Get all unique IDs
    const allIds = new Set([...vectorRankMap.keys(), ...ftsRankMap.keys()])

    // Compute RRF scores
    const mergedResults: HybridSearchResultItem[] = []
    const RRF_K = 60

    // Normalize weights to sum to 1 for proper RRF scoring
    const totalWeight = ftsWeight + vectorWeight
    const normalizedFtsWeight = ftsWeight / totalWeight
    const normalizedVectorWeight = vectorWeight / totalWeight

    for (const id of allIds) {
      const vec = this.vectors.get(id)!
      const vectorRank = vectorRankMap.get(id) ?? null
      const ftsRank = ftsRankMap.get(id) ?? null

      // RRF score = sum(1/(k + rank_i)) for each ranking system
      // Standard RRF doesn't use weights - each ranking contributes equally
      let rrfScore = 0
      if (vectorRank !== null) {
        rrfScore += 1 / (RRF_K + vectorRank)
      }
      if (ftsRank !== null) {
        rrfScore += 1 / (RRF_K + ftsRank)
      }

      // Find similarity from vector results
      const vectorResult = vectorResults.find((r) => r.$id === id)
      const similarity = vectorResult?.similarity ?? 0

      mergedResults.push({
        $id: id,
        similarity,
        distance: 1 - similarity,
        metadata: vec.metadata,
        rrfScore,
        vectorRank,
        ftsRank,
      })
    }

    // Sort by RRF score descending
    mergedResults.sort((a, b) => (b.rrfScore ?? 0) - (a.rrfScore ?? 0))

    return mergedResults.slice(0, k)
  }

  // ============================================================================
  // FTS Search (internal)
  // ============================================================================

  private ftsSearch(
    query: string,
    limit: number,
    filters?: Record<string, unknown>
  ): SearchResultItem[] {
    const queryTerms = query.toLowerCase().split(/\s+/)

    let candidates = Array.from(this.vectors.values())

    // Apply metadata filters
    if (filters) {
      candidates = candidates.filter((vec) => {
        for (const [key, value] of Object.entries(filters)) {
          if (vec.metadata[key] !== value) {
            return false
          }
        }
        return true
      })
    }

    // Score documents by term matches (BM25-like scoring)
    const scores: { vec: StoredVector; score: number }[] = []

    for (const vec of candidates) {
      const content = this.ftsIndex.get(vec.$id)
      if (!content) continue

      let score = 0
      for (const term of queryTerms) {
        const regex = new RegExp(term, 'gi')
        const matches = content.match(regex)
        if (matches) {
          // BM25-like saturation: log(1 + tf)
          const tf = matches.length
          score += Math.log(1 + tf)
        }
      }

      if (score > 0) {
        scores.push({ vec, score })
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score)

    return scores.slice(0, limit).map(({ vec }) => ({
      $id: vec.$id,
      similarity: 0,
      distance: 1,
      metadata: vec.metadata,
    }))
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  async addVectors(
    vectors: BatchVectorInput[],
    options?: BatchOptions
  ): Promise<{ $id: string }[]> {
    if (vectors.length === 0) {
      return []
    }

    const results: { $id: string }[] = []

    for (const vec of vectors) {
      // Validate embedding dimension
      if (vec.embedding.length !== this.dimension) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this.dimension}, got ${vec.embedding.length}`
        )
      }

      const vectorId = vec.id ?? this.generateId()

      // Create matryoshka prefixes
      const mat_64 =
        this.matryoshkaDims.includes(64) && this.dimension >= 64
          ? truncateEmbedding(vec.embedding, 64)
          : undefined

      const mat_256 =
        this.matryoshkaDims.includes(256) && this.dimension >= 256
          ? truncateEmbedding(vec.embedding, 256)
          : undefined

      // Create binary hash
      const binaryBits = toBinary(vec.embedding)
      const binaryHash = packBits(binaryBits).buffer

      const storedVector: StoredVector = {
        $id: vectorId,
        embedding: vec.embedding,
        metadata: vec.metadata,
        mat_64,
        mat_256,
        binaryHash,
      }

      this.vectors.set(vectorId, storedVector)

      // Index content in FTS
      if (vec.metadata.content) {
        this.ftsIndex.set(vectorId, vec.metadata.content.toLowerCase())
      }

      results.push({ $id: vectorId })
    }

    // Emit batch CDC event
    this.emitCDC({
      type: 'cdc.batch_insert',
      op: 'c',
      store: 'vector',
      count: vectors.length,
      partition: options?.partition,
      timestamp: Date.now(),
    })

    return results
  }

  async deleteVectors(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return
    }

    let deletedCount = 0
    for (const id of ids) {
      if (this.vectors.has(id)) {
        this.vectors.delete(id)
        this.ftsIndex.delete(id)
        deletedCount++
      }
    }

    // Emit batch CDC event
    if (deletedCount > 0) {
      this.emitCDC({
        type: 'cdc.batch_delete',
        op: 'd',
        store: 'vector',
        count: deletedCount,
        timestamp: Date.now(),
      })
    }
  }

  // ============================================================================
  // Progressive Search
  // ============================================================================

  async progressiveSearch(
    queryVector: Float32Array,
    k: number,
    options?: ProgressiveSearchOptions
  ): Promise<
    SearchResultItem[] | { results: SearchResultItem[]; timing: { total: number; stages: { name: string; duration: number }[] } }
  > {
    const stages = options?.stages
    const returnTiming = options?.returnTiming

    const timing: { name: string; duration: number }[] = []
    const startTime = performance.now()

    let candidates = Array.from(this.vectors.values())

    if (stages && stages.length > 0) {
      for (const stage of stages) {
        const stageStart = performance.now()

        if (stage.type === 'binary' && candidates.length > stage.candidates) {
          // Binary hash filtering
          const queryBinaryBits = toBinary(queryVector)
          const queryBinaryHash = packBits(queryBinaryBits)

          const scored = candidates.map((vec) => ({
            vec,
            hamming: packedHammingDistance(queryBinaryHash, new Uint8Array(vec.binaryHash!)),
          }))

          scored.sort((a, b) => a.hamming - b.hamming)
          candidates = scored.slice(0, stage.candidates).map((s) => s.vec)

          timing.push({ name: 'binary', duration: performance.now() - stageStart })
        } else if (stage.type === 'matryoshka' && stage.dim && candidates.length > stage.candidates) {
          // Matryoshka filtering
          const queryTrunc = truncateEmbedding(queryVector, stage.dim)

          const scored = candidates.map((vec) => {
            const vecTrunc =
              stage.dim === 64 && vec.mat_64
                ? vec.mat_64
                : stage.dim === 256 && vec.mat_256
                  ? vec.mat_256
                  : truncateEmbedding(vec.embedding, stage.dim!)

            return {
              vec,
              similarity: this.cosineSimilarity(queryTrunc, vecTrunc),
            }
          })

          scored.sort((a, b) => b.similarity - a.similarity)

          // Keep exact matches and top candidates
          const exactMatches = scored.filter((s) => s.similarity >= 0.9999)
          const others = scored
            .filter((s) => s.similarity < 0.9999)
            .slice(0, stage.candidates - exactMatches.length)
          candidates = [...exactMatches, ...others]
            .slice(0, Math.max(stage.candidates, exactMatches.length))
            .map((s) => s.vec)

          timing.push({ name: `matryoshka_${stage.dim}`, duration: performance.now() - stageStart })
        } else if (stage.type === 'exact') {
          // Full dimension exact search
          const scored = candidates.map((vec) => ({
            vec,
            similarity: this.cosineSimilarity(queryVector, vec.embedding),
          }))

          scored.sort((a, b) => b.similarity - a.similarity)
          candidates = scored.slice(0, stage.candidates).map((s) => s.vec)

          timing.push({ name: 'exact', duration: performance.now() - stageStart })
        }
      }
    }

    // Final exact scoring
    const results = candidates.map((vec) => {
      const similarity = this.cosineSimilarity(queryVector, vec.embedding)
      return {
        $id: vec.$id,
        similarity,
        distance: 1 - similarity,
        metadata: vec.metadata,
      }
    })

    results.sort((a, b) => b.similarity - a.similarity)
    const finalResults = results.slice(0, k)

    if (returnTiming) {
      return {
        results: finalResults,
        timing: {
          total: performance.now() - startTime,
          stages: timing,
        },
      }
    }

    return finalResults
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    const minLen = Math.min(a.length, b.length)
    let dot = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < minLen; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    if (denom === 0) return 0
    return dot / denom
  }
}

// ============================================================================
// LEGACY HYBRID SEARCH CLASS (for backwards compatibility)
// ============================================================================

import { VectorStore } from './store'
import type { HybridQueryOptions, SearchResult } from './types'

export class HybridSearch {
  private db: SqlStorageInterface
  private vectorStore: VectorStore

  constructor(db: SqlStorageInterface) {
    this.db = db
    this.vectorStore = new VectorStore(db, { lazyInit: true })
  }

  /**
   * Perform hybrid search with FTS5 and vector similarity.
   */
  async query(options: HybridQueryOptions): Promise<SearchResult[]> {
    const {
      query,
      embedding,
      limit,
      ftsWeight = 0.5,
      vectorWeight = 0.5,
      vectorDim,
      where,
    } = options

    return this.vectorStore.hybridSearch({
      query,
      embedding,
      limit,
      ftsWeight,
      vectorWeight,
      fusion: 'rrf',
    })
  }
}
