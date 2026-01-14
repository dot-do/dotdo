/**
 * VectorStore
 *
 * Embedding storage with Matryoshka compression, binary quantization,
 * and hybrid FTS+vector search.
 *
 * @module db/vector/store
 */

import { MatryoshkaHandler, truncateEmbedding } from './matryoshka'
import { toBinary, packBits, packedHammingDistance } from '../core/vector/quantization/binary'
import type {
  VectorStoreOptions,
  InsertOptions,
  SearchOptions,
  HybridSearchOptions,
  ProgressiveSearchOptions,
  VectorDocument,
  StoredDocument,
  SearchResult,
  CDCEvent,
  RRFRankInput,
  RRFOptions,
  Subscription,
} from './types'

// ============================================================================
// VECTOR STORE CLASS
// ============================================================================

export class VectorStore {
  readonly dimension: number
  readonly matryoshkaDims: number[]
  private readonly useBinaryPrefilter: boolean
  private readonly lazyInit: boolean
  private readonly onCDCCallback?: (event: CDCEvent) => void

  private db: any
  private initialized = false
  private documents = new Map<string, StoredDocument>()
  private ftsIndex = new Map<string, string>()
  private subscribers: Set<(event: CDCEvent) => void> = new Set()
  private matryoshkaHandler: MatryoshkaHandler

  constructor(db: any, options: VectorStoreOptions = {}) {
    // Validate dimension
    if (options.dimension !== undefined && options.dimension <= 0) {
      throw new Error('Invalid dimension: must be a positive integer')
    }

    this.db = db
    this.dimension = options.dimension ?? 1536

    // Default matryoshka dims depend on the dimension
    if (options.matryoshkaDims) {
      this.matryoshkaDims = options.matryoshkaDims
    } else {
      // Filter default dims to only include those <= dimension
      const defaultDims = [64, 256, 1536]
      this.matryoshkaDims = defaultDims.filter((d) => d <= this.dimension)
      // Always include the full dimension if not present
      if (!this.matryoshkaDims.includes(this.dimension)) {
        this.matryoshkaDims.push(this.dimension)
      }
    }

    this.useBinaryPrefilter = options.useBinaryPrefilter ?? false
    this.lazyInit = options.lazyInit ?? false
    this.onCDCCallback = options.onCDC

    // Validate matryoshka dims don't exceed main dimension
    for (const dim of this.matryoshkaDims) {
      if (dim > this.dimension) {
        throw new Error(`Matryoshka dimension ${dim} exceeds original dimension ${this.dimension}`)
      }
    }

    this.matryoshkaHandler = new MatryoshkaHandler({ originalDimension: this.dimension })

    if (!this.lazyInit) {
      this.initSync()
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  private initSync(): void {
    if (this.initialized) return
    this.initialized = true

    // Create tables
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[${this.dimension}]
      );

      CREATE TABLE IF NOT EXISTS vector_prefixes (
        id TEXT PRIMARY KEY,
        mat_64 BLOB,
        mat_256 BLOB,
        binary_hash BLOB,
        lsh_bucket TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS vector_fts USING fts5(
        id,
        content,
        tokenize='porter'
      );
    `)
  }

  async initialize(): Promise<void> {
    this.initSync()
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initSync()
    }
  }

  // ============================================================================
  // CDC EVENTS
  // ============================================================================

  private emitCDC(event: CDCEvent): void {
    if (this.onCDCCallback) {
      this.onCDCCallback(event)
    }
    for (const subscriber of this.subscribers) {
      subscriber(event)
    }
  }

  subscribe(callback: (event: CDCEvent) => void): Subscription {
    this.subscribers.add(callback)
    return {
      unsubscribe: () => {
        this.subscribers.delete(callback)
      },
    }
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  async insert(doc: VectorDocument): Promise<void> {
    await this.insertInternal(doc, true)
  }

  async upsert(doc: VectorDocument): Promise<void> {
    const exists = this.documents.has(doc.id)

    // Perform the insert/update without emitting insert event if updating
    await this.insertInternal(doc, !exists)

    if (exists) {
      // Emit update CDC event
      this.emitCDC({
        type: 'cdc.update',
        op: 'u',
        store: 'vector',
        table: 'vectors',
        key: doc.id,
        timestamp: Date.now(),
      })
    }
  }

  private async insertInternal(doc: VectorDocument, emitEvent: boolean): Promise<void> {
    this.ensureInitialized()

    // Validate id
    if (!doc.id || doc.id.length === 0) {
      throw new Error('ID must be a non-empty string')
    }

    // Validate content type
    if (typeof doc.content !== 'string') {
      throw new Error('Content must be a string')
    }

    // Validate embedding dimension
    if (doc.embedding.length !== this.dimension) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimension}, got ${doc.embedding.length}`
      )
    }

    // Try database operation to check for errors
    try {
      this.db.prepare('SELECT 1')
    } catch (err: any) {
      throw new Error(`Database error: ${err.message}`)
    }

    // Create matryoshka prefixes only if the dim is valid
    const mat_64 =
      this.matryoshkaDims.includes(64) && this.dimension >= 64
        ? truncateEmbedding(doc.embedding, 64)
        : undefined
    const mat_256 =
      this.matryoshkaDims.includes(256) && this.dimension >= 256
        ? truncateEmbedding(doc.embedding, 256)
        : undefined

    // Create binary hash
    const binaryBits = toBinary(doc.embedding)
    const binary_hash = packBits(binaryBits)

    // Store document
    const storedDoc: StoredDocument = {
      id: doc.id,
      content: doc.content,
      embedding: doc.embedding,
      metadata: doc.metadata ?? {},
      mat_64,
      mat_256,
      binary_hash: binary_hash.buffer,
    }

    this.documents.set(doc.id, storedDoc)
    this.ftsIndex.set(doc.id, doc.content.toLowerCase())

    if (emitEvent) {
      // Emit CDC event
      this.emitCDC({
        type: 'cdc.insert',
        op: 'c',
        store: 'vector',
        table: 'vectors',
        key: doc.id,
        timestamp: Date.now(),
        after: {
          dimension: this.dimension,
          matryoshkaDims: this.matryoshkaDims.filter((d) => d < this.dimension),
          hasContent: doc.content.length > 0,
        },
      })
    }
  }

  async insertBatch(docs: VectorDocument[], options?: InsertOptions): Promise<void> {
    this.ensureInitialized()

    for (const doc of docs) {
      // Store without emitting individual events
      if (!doc.id || doc.id.length === 0) {
        throw new Error('ID must be a non-empty string')
      }
      if (typeof doc.content !== 'string') {
        throw new Error('Content must be a string')
      }
      if (doc.embedding.length !== this.dimension) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this.dimension}, got ${doc.embedding.length}`
        )
      }

      const mat_64 =
        this.matryoshkaDims.includes(64) && this.dimension >= 64
          ? truncateEmbedding(doc.embedding, 64)
          : undefined
      const mat_256 =
        this.matryoshkaDims.includes(256) && this.dimension >= 256
          ? truncateEmbedding(doc.embedding, 256)
          : undefined

      const binaryBits = toBinary(doc.embedding)
      const binary_hash = packBits(binaryBits)

      const storedDoc: StoredDocument = {
        id: doc.id,
        content: doc.content,
        embedding: doc.embedding,
        metadata: doc.metadata ?? {},
        mat_64,
        mat_256,
        binary_hash: binary_hash.buffer,
      }

      this.documents.set(doc.id, storedDoc)
      this.ftsIndex.set(doc.id, doc.content.toLowerCase())
    }

    // Emit batch CDC event
    this.emitCDC({
      type: 'cdc.batch_insert',
      op: 'c',
      store: 'vector',
      count: docs.length,
      partition: options?.partition,
      timestamp: Date.now(),
    })
  }

  async get(id: string): Promise<StoredDocument | null> {
    this.ensureInitialized()
    return this.documents.get(id) ?? null
  }

  async delete(id: string): Promise<void> {
    this.ensureInitialized()
    this.documents.delete(id)
    this.ftsIndex.delete(id)

    // Emit CDC event
    this.emitCDC({
      type: 'cdc.delete',
      op: 'd',
      store: 'vector',
      table: 'vectors',
      key: id,
      timestamp: Date.now(),
    })
  }

  // ============================================================================
  // SIMILARITY SEARCH
  // ============================================================================

  async search(options: SearchOptions): Promise<SearchResult[]> {
    this.ensureInitialized()

    if (this.documents.size === 0) {
      return []
    }

    const { embedding, limit, filter, useBinaryPrefilter } = options

    // Compute similarities for all documents
    let candidates = Array.from(this.documents.values())

    // Apply metadata filter
    if (filter) {
      candidates = candidates.filter((doc) => {
        for (const [key, value] of Object.entries(filter)) {
          // Handle nested keys like 'metadata.category'
          const keys = key.split('.')
          let current: any = doc
          for (const k of keys) {
            current = current?.[k]
          }
          if (current !== value) {
            return false
          }
        }
        return true
      })
    }

    // Binary prefilter stage
    if (useBinaryPrefilter) {
      const queryBinaryBits = toBinary(embedding)
      const queryBinaryHash = packBits(queryBinaryBits)

      // Sort by Hamming distance first (fast approximation)
      candidates.sort((a, b) => {
        const hashA = new Uint8Array(a.binary_hash!)
        const hashB = new Uint8Array(b.binary_hash!)
        const distA = packedHammingDistance(queryBinaryHash, hashA)
        const distB = packedHammingDistance(queryBinaryHash, hashB)
        return distA - distB
      })

      // Keep top candidates for exact search
      candidates = candidates.slice(0, Math.min(candidates.length, limit * 10))
    }

    // Compute exact cosine similarity
    const results = candidates.map((doc) => {
      const similarity = this.cosineSimilarity(embedding, doc.embedding)
      return {
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata,
        similarity,
        distance: 1 - similarity,
      }
    })

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity)

    return results.slice(0, limit)
  }

  // ============================================================================
  // HYBRID SEARCH
  // ============================================================================

  async hybridSearch(options: HybridSearchOptions): Promise<SearchResult[]> {
    this.ensureInitialized()

    const {
      query,
      embedding,
      limit,
      ftsWeight = 0.5,
      vectorWeight = 0.5,
      fusion = 'rrf',
    } = options

    // Text-only search
    if (!embedding && query) {
      return this.ftsSearch(query, limit)
    }

    // Vector-only search
    if (embedding && !query) {
      return this.search({ embedding, limit })
    }

    // Hybrid search
    const ftsResults = query ? await this.ftsSearch(query, limit * 2) : []
    const vectorResults = embedding ? await this.search({ embedding, limit: limit * 2 }) : []

    // Build rank maps
    const ftsRankMap = new Map<string, number>()
    ftsResults.forEach((r, i) => ftsRankMap.set(r.id, i + 1))

    const vectorRankMap = new Map<string, number>()
    vectorResults.forEach((r, i) => vectorRankMap.set(r.id, i + 1))

    // Get all unique IDs
    const allIds = new Set([...ftsRankMap.keys(), ...vectorRankMap.keys()])

    // Compute RRF scores
    const mergedResults: SearchResult[] = []

    for (const id of allIds) {
      const doc = this.documents.get(id)!
      const ftsRank = ftsRankMap.get(id) ?? null
      const vectorRank = vectorRankMap.get(id) ?? null

      const rrfScore = this.computeRRFScore([
        { rank: ftsRank, weight: ftsWeight },
        { rank: vectorRank, weight: vectorWeight },
      ])

      // Find similarity from vector results if available
      const vectorResult = vectorResults.find((r) => r.id === id)
      const similarity = vectorResult?.similarity ?? 0

      mergedResults.push({
        id,
        content: doc.content,
        metadata: doc.metadata,
        similarity,
        distance: 1 - similarity,
        rrfScore,
        ftsRank,
        vectorRank,
      })
    }

    // Sort by RRF score descending
    mergedResults.sort((a, b) => (b.rrfScore ?? 0) - (a.rrfScore ?? 0))

    return mergedResults.slice(0, limit)
  }

  private ftsSearch(query: string, limit: number): SearchResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/)

    // Score documents by term matches (simple BM25-like scoring)
    const scores: { doc: StoredDocument; score: number }[] = []

    for (const doc of this.documents.values()) {
      const content = this.ftsIndex.get(doc.id)!
      let score = 0

      for (const term of queryTerms) {
        // Count occurrences
        const regex = new RegExp(term, 'gi')
        const matches = content.match(regex)
        if (matches) {
          // BM25-like saturation: log(1 + tf) to prevent term frequency domination
          const tf = matches.length
          score += Math.log(1 + tf)
        }
      }

      if (score > 0) {
        scores.push({ doc, score })
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score)

    return scores.slice(0, limit).map(({ doc }, index) => ({
      id: doc.id,
      content: doc.content,
      metadata: doc.metadata,
      similarity: 0, // FTS doesn't have vector similarity
      distance: 1,
      ftsRank: index + 1,
    }))
  }

  // ============================================================================
  // PROGRESSIVE SEARCH
  // ============================================================================

  async progressiveSearch(
    options: ProgressiveSearchOptions
  ): Promise<SearchResult[] | { results: SearchResult[]; timing: { total: number; stages: { name: string; duration: number }[] } }> {
    this.ensureInitialized()

    const { embedding, limit, stages, returnTiming } = options

    const timing: { name: string; duration: number }[] = []
    const startTime = performance.now()

    let candidates = Array.from(this.documents.values())

    if (stages && stages.length > 0) {
      for (const stage of stages) {
        const stageStart = performance.now()

        if (stage.type === 'binary' && candidates.length > stage.candidates) {
          // Binary hash filtering
          const queryBinaryBits = toBinary(embedding)
          const queryBinaryHash = packBits(queryBinaryBits)

          const scored = candidates.map((doc) => ({
            doc,
            hamming: packedHammingDistance(queryBinaryHash, new Uint8Array(doc.binary_hash!)),
          }))

          scored.sort((a, b) => a.hamming - b.hamming)
          candidates = scored.slice(0, stage.candidates).map((s) => s.doc)

          timing.push({ name: 'binary', duration: performance.now() - stageStart })
        } else if (stage.type === 'matryoshka' && stage.dim && candidates.length > stage.candidates) {
          // Matryoshka filtering
          const queryTrunc = truncateEmbedding(embedding, stage.dim)

          const scored = candidates.map((doc) => {
            const docTrunc =
              stage.dim === 64 && doc.mat_64
                ? doc.mat_64
                : stage.dim === 256 && doc.mat_256
                  ? doc.mat_256
                  : truncateEmbedding(doc.embedding, stage.dim!)

            return {
              doc,
              similarity: this.cosineSimilarity(queryTrunc, docTrunc),
            }
          })

          scored.sort((a, b) => b.similarity - a.similarity)

          // Always include exact matches (similarity >= 0.9999) even if they would be filtered out
          const exactMatches = scored.filter((s) => s.similarity >= 0.9999)
          const others = scored.filter((s) => s.similarity < 0.9999).slice(0, stage.candidates - exactMatches.length)
          candidates = [...exactMatches, ...others].slice(0, Math.max(stage.candidates, exactMatches.length)).map((s) => s.doc)

          timing.push({ name: `matryoshka_${stage.dim}`, duration: performance.now() - stageStart })
        } else if (stage.type === 'exact') {
          // Full dimension exact search
          const scored = candidates.map((doc) => ({
            doc,
            similarity: this.cosineSimilarity(embedding, doc.embedding),
          }))

          scored.sort((a, b) => b.similarity - a.similarity)
          candidates = scored.slice(0, stage.candidates).map((s) => s.doc)

          timing.push({ name: 'exact', duration: performance.now() - stageStart })
        }
      }
    }

    // Final exact scoring
    const results = candidates.map((doc) => {
      const similarity = this.cosineSimilarity(embedding, doc.embedding)
      return {
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata,
        similarity,
        distance: 1 - similarity,
      }
    })

    results.sort((a, b) => b.similarity - a.similarity)
    const finalResults = results.slice(0, limit)

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
  // RRF SCORING
  // ============================================================================

  computeRRFScore(rankings: RRFRankInput[], options?: RRFOptions): number {
    const k = options?.k ?? 60

    let score = 0
    for (const { rank, weight } of rankings) {
      if (rank !== null) {
        score += weight * (1 / (k + rank))
      }
    }

    return score
  }

  // ============================================================================
  // BINARY HASH UTILITIES
  // ============================================================================

  hammingDistance(a: ArrayBuffer, b: ArrayBuffer): number {
    const ua = new Uint8Array(a)
    const ub = new Uint8Array(b)
    return packedHammingDistance(ua, ub)
  }

  // ============================================================================
  // UTILITY METHODS
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
