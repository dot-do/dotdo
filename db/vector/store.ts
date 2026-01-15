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
import { IVFIndex, type IVFConfig, type IVFTrainingOptions } from './ivf'
import {
  BoundedLRUCache,
  binaryHashSizeCalculator,
  matryoshkaSizeCalculator,
  validateCacheConfig,
  DEFAULT_CACHE_CONFIG,
  type CacheConfig,
  type CacheStats,
} from './cache'
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
  StorageTier,
  TieredStorageOptions,
  TieredDocument,
  TierStats,
  AdaptiveProgressiveOptions,
  ProgressiveSearchStats,
  EnhancedProgressiveResult,
  IndexConfig,
  FilterValue,
} from './types'

// ============================================================================
// DATABASE INTERFACE
// ============================================================================

/**
 * Database interface for VectorStore storage
 * Compatible with SQLite-based databases (SqlStorage, D1, etc.)
 */
export interface SqlStorageInterface {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    run: (...params: unknown[]) => void
    get: (...params: unknown[]) => unknown
    all: (...params: unknown[]) => unknown[]
  }
}

// ============================================================================
// VECTOR STORE CLASS
// ============================================================================

import type { CDCEmitter } from '../cdc'

export class VectorStore {
  readonly dimension: number
  readonly matryoshkaDims: number[]
  private readonly useBinaryPrefilter: boolean
  private readonly lazyInit: boolean
  private readonly onCDCCallback?: (event: CDCEvent) => void
  private readonly cdcEmitter?: CDCEmitter

  private db: SqlStorageInterface
  private initialized = false
  private documents = new Map<string, StoredDocument>()
  private ftsIndex = new Map<string, string>()
  private subscribers: Set<(event: CDCEvent) => void> = new Set()
  private matryoshkaHandler: MatryoshkaHandler

  // Tiering support
  private readonly tieredStorage: TieredStorageOptions
  private tieredDocuments = new Map<string, TieredDocument>()
  private hotTier = new Set<string>()
  private warmTier = new Set<string>()
  private coldTier = new Set<string>()

  // Index support
  private readonly indexConfig?: IndexConfig
  private ivfIndex?: IVFIndex
  private ivfTrained = false

  // Search optimization caches (bounded LRU)
  private readonly _cacheConfig: CacheConfig
  private readonly binaryHashCache: BoundedLRUCache<string, Uint8Array>
  private readonly matryoshkaCache: BoundedLRUCache<string, Map<number, Float32Array>>

  /**
   * Get the cache configuration
   */
  get cacheConfig(): CacheConfig {
    return { ...this._cacheConfig }
  }

  constructor(db: SqlStorageInterface, options: VectorStoreOptions = {}) {
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
    this.cdcEmitter = options.cdcEmitter

    // Validate matryoshka dims don't exceed main dimension
    for (const dim of this.matryoshkaDims) {
      if (dim > this.dimension) {
        throw new Error(`Matryoshka dimension ${dim} exceeds original dimension ${this.dimension}`)
      }
    }

    this.matryoshkaHandler = new MatryoshkaHandler({ originalDimension: this.dimension })

    // Initialize tiering with defaults
    this.tieredStorage = options.tieredStorage ?? {
      hot: { enabled: true, maxDocuments: 10000, maxAgeMs: 3600000 }, // 1 hour
      warm: { enabled: true, maxDocuments: 100000, maxAgeMs: 86400000 }, // 1 day
      cold: { enabled: true },
      autoPromote: true,
      autoDemote: true,
    }

    // Index configuration
    this.indexConfig = options.indexConfig

    // Cache configuration - validate and initialize
    const cacheConfig = options.cacheConfig
    if (cacheConfig) {
      validateCacheConfig(cacheConfig)
    }

    this._cacheConfig = {
      ...DEFAULT_CACHE_CONFIG,
      ...cacheConfig,
    }

    // Determine cache sizes
    const binaryHashMaxSize = this._cacheConfig.binaryHashMaxSize ?? this._cacheConfig.maxSize
    const matryoshkaMaxSize = this._cacheConfig.matryoshkaMaxSize ?? this._cacheConfig.maxSize

    // Initialize bounded LRU caches
    this.binaryHashCache = new BoundedLRUCache<string, Uint8Array>(
      binaryHashMaxSize,
      binaryHashSizeCalculator,
      {
        memoryLimitBytes: this._cacheConfig.memoryLimitBytes,
        evictionThreshold: this._cacheConfig.evictionThreshold,
      }
    )

    this.matryoshkaCache = new BoundedLRUCache<string, Map<number, Float32Array>>(
      matryoshkaMaxSize,
      matryoshkaSizeCalculator,
      {
        memoryLimitBytes: this._cacheConfig.memoryLimitBytes,
        evictionThreshold: this._cacheConfig.evictionThreshold,
      }
    )

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
    // Also emit to unified CDC pipeline if configured
    if (this.cdcEmitter) {
      this.cdcEmitter.emit({
        op: event.op,
        store: 'vector',
        table: event.table,
        key: event.key,
        after: event.after as Record<string, unknown> | undefined,
      }).catch(() => {
        // Don't block on CDC pipeline errors
      })
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Database error: ${message}`)
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

    // Track tiering metadata
    const now = Date.now()
    const tieredDoc: TieredDocument = {
      ...storedDoc,
      tier: 'hot',
      lastAccessedAt: now,
      accessCount: 0,
      updatedAt: now,
    }
    this.tieredDocuments.set(doc.id, tieredDoc)
    this.hotTier.add(doc.id)

    // Note: Don't cache during insert - cache is populated lazily during search
    // This allows hit/miss metrics to reflect actual search patterns

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

      // Track tiering metadata
      const now = Date.now()
      const tieredDoc: TieredDocument = {
        ...storedDoc,
        tier: 'hot',
        lastAccessedAt: now,
        accessCount: 0,
        updatedAt: now,
      }
      this.tieredDocuments.set(doc.id, tieredDoc)
      this.hotTier.add(doc.id)

      // Note: Don't cache during insert - cache is populated lazily during search
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

    // Clean up tiering data
    this.tieredDocuments.delete(id)
    this.hotTier.delete(id)
    this.warmTier.delete(id)
    this.coldTier.delete(id)

    // Clean up caches
    this.binaryHashCache.delete(id)
    this.matryoshkaCache.delete(id)

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
          let current: unknown = doc as unknown
          for (const k of keys) {
            if (current && typeof current === 'object' && k in current) {
              current = (current as Record<string, unknown>)[k]
            } else {
              current = undefined
            }
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

      // Pre-compute hamming distances with cache tracking
      // Use peek() to track hit/miss without affecting LRU order
      // LRU order is only updated for final results
      const scored = candidates.map((doc) => {
        // Use peek() for internal access (tracks metrics, doesn't update LRU order)
        let hash = this.binaryHashCache.peek(doc.id)
        if (!hash && doc.binary_hash) {
          hash = new Uint8Array(doc.binary_hash)
          this.binaryHashCache.set(doc.id, hash)
        }
        const hamming = hash ? packedHammingDistance(queryBinaryHash, hash) : Infinity
        return { doc, hamming }
      })

      // Sort by Hamming distance first (fast approximation)
      scored.sort((a, b) => a.hamming - b.hamming)

      // Keep top candidates for exact search
      candidates = scored.slice(0, Math.min(scored.length, limit * 10)).map((s) => s.doc)
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

    const finalResults = results.slice(0, limit)

    // Update cache access times for returned results to reflect "usage" in LRU
    // This ensures the most relevant results are kept in cache longer
    for (const result of finalResults) {
      // Re-access cache entries for returned results to update their LRU position
      const hash = this.binaryHashCache.get(result.id)
      if (hash) {
        // Touch the cache entry to move it to most recently used
        this.binaryHashCache.set(result.id, hash)
      }

      // Record access for tiering (triggers promotion if enabled)
      if (this.tieredStorage.autoPromote) {
        this.recordAccess(result.id)
      }
    }

    return finalResults
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
  // OPTIMIZED PROGRESSIVE SEARCH (Adaptive with Early Termination)
  // ============================================================================

  /**
   * Adaptive progressive search with optimizations:
   * - Starts with small candidate set and expands if needed
   * - Early termination when high-confidence matches found
   * - Uses cached binary hashes and matryoshka embeddings
   * - Respects tier boundaries (hot first, then warm, then cold)
   */
  async adaptiveProgressiveSearch(
    options: AdaptiveProgressiveOptions
  ): Promise<EnhancedProgressiveResult> {
    this.ensureInitialized()

    const {
      embedding,
      limit,
      stages,
      earlyTermination = true,
      earlyTerminationThreshold = 0.95,
      expansionFactor = 2,
      maxLatencyMs = 100,
      targetRecall = 0.99,
    } = options

    const startTime = performance.now()
    const timing: { name: string; duration: number }[] = []
    const scannedByStage: number[] = []
    let earlyTerminated = false
    let terminatedAtStage: number | undefined

    // Prepare query binary hash once (cached)
    const queryBinaryBits = toBinary(embedding)
    const queryBinaryHash = packBits(queryBinaryBits)

    // Start with hot tier, expand to warm/cold if needed
    let candidates = this.getHotTierDocuments()
    let currentTier: StorageTier = 'hot'

    // Default stages if not provided - optimized for performance
    const effectiveStages = stages ?? this.computeOptimalStages(candidates.length, limit)

    for (let stageIdx = 0; stageIdx < effectiveStages.length; stageIdx++) {
      const stage = effectiveStages[stageIdx]
      const stageStart = performance.now()

      // Check latency budget
      if (performance.now() - startTime > maxLatencyMs * 0.8) {
        // Low on time budget, skip to final exact scoring
        timing.push({ name: 'budget_exceeded', duration: 0 })
        break
      }

      // Adaptive candidate count based on current pool size
      let targetCandidates = stage.candidates
      if (candidates.length < targetCandidates * 2) {
        // Expand to next tier if current tier is small
        if (currentTier === 'hot' && this.warmTier.size > 0) {
          candidates = [...candidates, ...this.getWarmTierDocuments()]
          currentTier = 'warm'
        } else if (currentTier === 'warm' && this.coldTier.size > 0) {
          candidates = [...candidates, ...this.getColdTierDocuments()]
          currentTier = 'cold'
        }
      }

      if (stage.type === 'binary' && candidates.length > targetCandidates) {
        // Use cached binary hashes when available
        // Use peek() for internal access to not affect LRU order
        const scored = candidates.map((doc) => {
          let binaryHash = this.binaryHashCache.peek(doc.id)
          if (!binaryHash && doc.binary_hash) {
            binaryHash = new Uint8Array(doc.binary_hash)
            this.binaryHashCache.set(doc.id, binaryHash)
          }
          return {
            doc,
            hamming: binaryHash ? packedHammingDistance(queryBinaryHash, binaryHash) : Infinity,
          }
        })

        scored.sort((a, b) => a.hamming - b.hamming)
        candidates = scored.slice(0, targetCandidates).map((s) => s.doc)
        scannedByStage.push(scored.length)
        timing.push({ name: 'binary', duration: performance.now() - stageStart })

      } else if (stage.type === 'matryoshka' && stage.dim && candidates.length > targetCandidates) {
        const queryTrunc = truncateEmbedding(embedding, stage.dim)

        const scored = candidates.map((doc) => {
          // Check cache first - use peek() for internal access
          let cache = this.matryoshkaCache.peek(doc.id)
          let docTrunc: Float32Array

          if (cache?.has(stage.dim!)) {
            docTrunc = cache.get(stage.dim!)!
          } else {
            docTrunc =
              stage.dim === 64 && doc.mat_64
                ? doc.mat_64
                : stage.dim === 256 && doc.mat_256
                  ? doc.mat_256
                  : truncateEmbedding(doc.embedding, stage.dim!)

            // Cache for future use
            if (!cache) {
              cache = new Map()
              this.matryoshkaCache.set(doc.id, cache)
            }
            cache.set(stage.dim!, docTrunc)
          }

          return {
            doc,
            similarity: this.cosineSimilarity(queryTrunc, docTrunc),
          }
        })

        scored.sort((a, b) => b.similarity - a.similarity)

        // Early termination check: if top results have very high similarity
        if (earlyTermination && scored.length >= limit) {
          const topSimilarity = scored[0]?.similarity ?? 0
          if (topSimilarity >= earlyTerminationThreshold) {
            // Check if we have enough high-quality candidates
            const highQualityCount = scored.filter(
              (s) => s.similarity >= earlyTerminationThreshold * 0.95
            ).length
            if (highQualityCount >= limit) {
              candidates = scored.slice(0, limit).map((s) => s.doc)
              earlyTerminated = true
              terminatedAtStage = stageIdx
              scannedByStage.push(scored.length)
              timing.push({ name: `matryoshka_${stage.dim}_early`, duration: performance.now() - stageStart })
              break
            }
          }
        }

        // Keep enough candidates with adaptive expansion
        const keepCount = Math.min(
          targetCandidates * expansionFactor,
          scored.length
        )
        candidates = scored.slice(0, keepCount).map((s) => s.doc)
        scannedByStage.push(scored.length)
        timing.push({ name: `matryoshka_${stage.dim}`, duration: performance.now() - stageStart })

      } else if (stage.type === 'exact') {
        const scored = candidates.map((doc) => ({
          doc,
          similarity: this.cosineSimilarity(embedding, doc.embedding),
        }))

        scored.sort((a, b) => b.similarity - a.similarity)
        candidates = scored.slice(0, targetCandidates).map((s) => s.doc)
        scannedByStage.push(scored.length)
        timing.push({ name: 'exact', duration: performance.now() - stageStart })
      }
    }

    // Final exact scoring
    const finalStart = performance.now()
    const results = candidates.map((doc) => {
      const similarity = this.cosineSimilarity(embedding, doc.embedding)

      // Update access tracking for tiering
      if (this.tieredStorage.autoPromote) {
        this.recordAccess(doc.id)
      }

      // Populate matryoshka cache for all candidates (ensures cache population even for small collections)
      // Use peek() to not affect LRU order during internal access
      if (this.matryoshkaDims.length > 0) {
        let cache = this.matryoshkaCache.peek(doc.id)
        if (!cache) {
          cache = new Map()
          // Cache available matryoshka embeddings
          if (doc.mat_64) cache.set(64, doc.mat_64)
          if (doc.mat_256) cache.set(256, doc.mat_256)
          if (cache.size > 0) {
            this.matryoshkaCache.set(doc.id, cache)
          }
        }
      }

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
    timing.push({ name: 'final_score', duration: performance.now() - finalStart })

    // Calculate estimated recall
    const totalDocs = this.documents.size
    const scannedTotal = scannedByStage.reduce((a, b) => a + b, 0)
    const estimatedRecall = Math.min(1, (scannedTotal / totalDocs) * (1 + (targetRecall - 0.5)))

    return {
      results: finalResults,
      timing: {
        total: performance.now() - startTime,
        stages: timing,
      },
      stats: {
        totalDocuments: totalDocs,
        scannedByStage,
        earlyTerminated,
        terminatedAtStage,
        estimatedRecall,
      },
    }
  }

  /**
   * Compute optimal stages based on collection size and target limit
   */
  private computeOptimalStages(
    collectionSize: number,
    limit: number
  ): { type: 'binary' | 'matryoshka' | 'exact'; dim?: number; candidates: number }[] {
    if (collectionSize <= 100) {
      // Small collection: just exact search
      return [{ type: 'exact', candidates: limit }]
    }

    if (collectionSize <= 1000) {
      // Medium collection: 64-dim + exact
      return [
        { type: 'matryoshka', dim: 64, candidates: Math.min(100, collectionSize) },
        { type: 'exact', candidates: limit },
      ]
    }

    if (collectionSize <= 10000) {
      // Large collection: binary + 64-dim + 256-dim + exact
      return [
        { type: 'binary', candidates: Math.min(1000, collectionSize) },
        { type: 'matryoshka', dim: 64, candidates: 200 },
        { type: 'matryoshka', dim: 256, candidates: 50 },
        { type: 'exact', candidates: limit },
      ]
    }

    // Very large collection: binary + 64-dim + 256-dim + 512-dim + exact
    return [
      { type: 'binary', candidates: Math.min(5000, collectionSize) },
      { type: 'matryoshka', dim: 64, candidates: 500 },
      { type: 'matryoshka', dim: 256, candidates: 100 },
      { type: 'exact', candidates: limit * 2 },
    ]
  }

  // ============================================================================
  // TIERING OPERATIONS
  // ============================================================================

  /**
   * Get documents from hot tier
   */
  private getHotTierDocuments(): StoredDocument[] {
    const docs: StoredDocument[] = []
    for (const id of this.hotTier) {
      const doc = this.documents.get(id)
      if (doc) docs.push(doc)
    }
    return docs
  }

  /**
   * Get documents from warm tier
   */
  private getWarmTierDocuments(): StoredDocument[] {
    const docs: StoredDocument[] = []
    for (const id of this.warmTier) {
      const doc = this.documents.get(id)
      if (doc) docs.push(doc)
    }
    return docs
  }

  /**
   * Get documents from cold tier
   */
  private getColdTierDocuments(): StoredDocument[] {
    const docs: StoredDocument[] = []
    for (const id of this.coldTier) {
      const doc = this.documents.get(id)
      if (doc) docs.push(doc)
    }
    return docs
  }

  /**
   * Record an access for tiering purposes
   */
  private recordAccess(id: string): void {
    const tieredDoc = this.tieredDocuments.get(id)
    if (tieredDoc) {
      tieredDoc.accessCount++
      tieredDoc.lastAccessedAt = Date.now()

      // Auto-promote from cold/warm to hot if frequently accessed
      if (this.tieredStorage.autoPromote && tieredDoc.tier !== 'hot') {
        const hotConfig = this.tieredStorage.hot
        if (hotConfig?.enabled && tieredDoc.accessCount >= (hotConfig.minAccessCount ?? 3)) {
          this.promoteToHot(id)
        }
      }
    }
  }

  /**
   * Promote a document to hot tier
   */
  private promoteToHot(id: string): void {
    this.warmTier.delete(id)
    this.coldTier.delete(id)
    this.hotTier.add(id)

    const tieredDoc = this.tieredDocuments.get(id)
    if (tieredDoc) {
      tieredDoc.tier = 'hot'
    }

    // Auto-populate cache on promotion if configured
    if (this._cacheConfig.autoPopulateOnPromote) {
      const doc = this.documents.get(id)
      if (doc) {
        // Populate binary hash cache
        if (doc.binary_hash && !this.binaryHashCache.has(id)) {
          this.binaryHashCache.set(id, new Uint8Array(doc.binary_hash))
        }
        // Populate matryoshka cache
        if (!this.matryoshkaCache.has(id)) {
          const cache = new Map<number, Float32Array>()
          if (doc.mat_64) cache.set(64, doc.mat_64)
          if (doc.mat_256) cache.set(256, doc.mat_256)
          if (cache.size > 0) {
            this.matryoshkaCache.set(id, cache)
          }
        }
      }
    }
  }

  /**
   * Demote a document to warm tier
   */
  private demoteToWarm(id: string): void {
    this.hotTier.delete(id)
    this.coldTier.delete(id)
    this.warmTier.add(id)

    const tieredDoc = this.tieredDocuments.get(id)
    if (tieredDoc) {
      tieredDoc.tier = 'warm'
    }
  }

  /**
   * Demote a document to cold tier (public for manual tier management)
   */
  demoteToCold(id: string): void {
    this.hotTier.delete(id)
    this.warmTier.delete(id)
    this.coldTier.add(id)

    const tieredDoc = this.tieredDocuments.get(id)
    if (tieredDoc) {
      tieredDoc.tier = 'cold'
    }

    // Clear caches for cold tier to save memory
    this.binaryHashCache.delete(id)
    this.matryoshkaCache.delete(id)
  }

  /**
   * Run tier maintenance (demote old documents)
   */
  async runTierMaintenance(): Promise<{ demoted: number; promoted: number }> {
    const now = Date.now()
    let demoted = 0
    let promoted = 0

    // Check hot tier for demotion
    const hotConfig = this.tieredStorage.hot
    if (hotConfig?.enabled && hotConfig.maxAgeMs) {
      for (const id of [...this.hotTier]) {
        const tieredDoc = this.tieredDocuments.get(id)
        if (tieredDoc && now - tieredDoc.lastAccessedAt > hotConfig.maxAgeMs) {
          this.demoteToWarm(id)
          demoted++
        }
      }
    }

    // Check warm tier for demotion
    const warmConfig = this.tieredStorage.warm
    if (warmConfig?.enabled && warmConfig.maxAgeMs) {
      for (const id of [...this.warmTier]) {
        const tieredDoc = this.tieredDocuments.get(id)
        if (tieredDoc && now - tieredDoc.lastAccessedAt > warmConfig.maxAgeMs) {
          this.demoteToCold(id)
          demoted++
        }
      }
    }

    return { demoted, promoted }
  }

  /**
   * Get tier statistics
   */
  getTierStats(): TierStats[] {
    const now = Date.now()
    const stats: TierStats[] = []

    for (const [tier, tierSet] of [
      ['hot', this.hotTier],
      ['warm', this.warmTier],
      ['cold', this.coldTier],
    ] as const) {
      let totalAccessCount = 0
      let totalAge = 0
      let memoryBytes = 0

      for (const id of tierSet) {
        const tieredDoc = this.tieredDocuments.get(id)
        if (tieredDoc) {
          totalAccessCount += tieredDoc.accessCount
          totalAge += now - tieredDoc.updatedAt
          // Approximate memory: embedding * 4 bytes + overhead
          memoryBytes += this.dimension * 4 + 200
        }
      }

      const count = tierSet.size
      stats.push({
        tier: tier as StorageTier,
        documentCount: count,
        memoryBytes,
        avgAccessCount: count > 0 ? totalAccessCount / count : 0,
        avgAgeMs: count > 0 ? totalAge / count : 0,
      })
    }

    return stats
  }

  // ============================================================================
  // IVF INDEX INTEGRATION
  // ============================================================================

  /**
   * Initialize IVF index for accelerated search
   */
  async initializeIVFIndex(config?: Partial<IVFConfig>): Promise<void> {
    const nlist = config?.nlist ?? Math.max(16, Math.ceil(Math.sqrt(this.documents.size)))
    const nprobe = config?.nprobe ?? Math.max(1, Math.ceil(nlist / 10))

    this.ivfIndex = new IVFIndex({
      dimensions: this.dimension,
      nlist,
      nprobe,
      metric: config?.metric ?? 'cosine',
      relocateEmptyClusters: config?.relocateEmptyClusters ?? true,
    })

    // Add all existing documents to the index
    for (const [id, doc] of this.documents) {
      await this.ivfIndex.add(id, doc.embedding)
    }

    this.ivfTrained = false
  }

  /**
   * Train the IVF index (required before search)
   */
  async trainIVFIndex(options?: IVFTrainingOptions): Promise<{
    converged: boolean
    iterations: number
    finalError: number
    warnings: string[]
  }> {
    if (!this.ivfIndex) {
      throw new Error('IVF index not initialized. Call initializeIVFIndex() first.')
    }

    if (this.documents.size < (this.ivfIndex.config.nlist ?? 16)) {
      throw new Error(
        `Not enough documents for training. Have ${this.documents.size}, need at least ${this.ivfIndex.config.nlist}.`
      )
    }

    const result = await this.ivfIndex.train(options)
    this.ivfTrained = true

    return result
  }

  /**
   * Check if IVF index needs retraining
   */
  ivfNeedsRetraining(): boolean {
    if (!this.ivfIndex) return false
    return this.ivfIndex.needsRetraining()
  }

  /**
   * Search using IVF index (faster for large collections)
   */
  async searchWithIVF(options: {
    embedding: Float32Array
    limit: number
    nprobe?: number
  }): Promise<SearchResult[]> {
    if (!this.ivfIndex) {
      throw new Error('IVF index not initialized. Call initializeIVFIndex() first.')
    }

    if (!this.ivfTrained) {
      throw new Error('IVF index not trained. Call trainIVFIndex() first.')
    }

    const { embedding, limit, nprobe } = options

    const ivfResults = await this.ivfIndex.search(embedding, limit * 2, { nprobe })

    // Enrich with full document data
    const results: SearchResult[] = []
    for (const hit of ivfResults) {
      const doc = this.documents.get(hit.id)
      if (doc) {
        // Record access for tiering
        if (this.tieredStorage.autoPromote) {
          this.recordAccess(hit.id)
        }

        results.push({
          id: hit.id,
          content: doc.content,
          metadata: doc.metadata,
          similarity: hit.score,
          distance: 1 - hit.score,
        })
      }
    }

    return results.slice(0, limit)
  }

  /**
   * Get IVF index statistics
   */
  getIVFStats(): {
    vectorCount: number
    nlist: number
    nprobe: number
    trained: boolean
    clusterBalance?: {
      minSize: number
      maxSize: number
      mean: number
      emptyClusters: number
    }
  } | null {
    if (!this.ivfIndex) return null

    const stats = this.ivfIndex.getStats()
    const balance = this.ivfTrained ? this.ivfIndex.getClusterBalance() : undefined

    return {
      vectorCount: stats.vectorCount,
      nlist: stats.nlist,
      nprobe: stats.nprobe,
      trained: stats.trained,
      clusterBalance: balance
        ? {
            minSize: balance.minSize,
            maxSize: balance.maxSize,
            mean: balance.mean,
            emptyClusters: balance.emptyClusters,
          }
        : undefined,
    }
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

  // ============================================================================
  // CACHE MANAGEMENT API
  // ============================================================================

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const binaryStats = this.binaryHashCache.getStats()
    const matryoshkaStats = this.matryoshkaCache.getStats()
    const totalMemoryBytes = binaryStats.memoryBytes + matryoshkaStats.memoryBytes
    const memoryLimitBytes = this._cacheConfig.memoryLimitBytes ?? Infinity

    return {
      binaryHashCache: binaryStats,
      matryoshkaCache: matryoshkaStats,
      totalMemoryBytes,
      memoryBytes: totalMemoryBytes,
      memoryLimitBytes: memoryLimitBytes === Infinity ? 0 : memoryLimitBytes,
      memoryUsagePercent: memoryLimitBytes !== Infinity
        ? (totalMemoryBytes / memoryLimitBytes) * 100
        : 0,
    }
  }

  /**
   * Clear cache (optionally by type)
   */
  clearCache(type?: 'binaryHash' | 'matryoshka'): void {
    if (!type || type === 'binaryHash') {
      this.binaryHashCache.clear()
    }
    if (!type || type === 'matryoshka') {
      this.matryoshkaCache.clear()
    }
  }

  /**
   * Reset cache metrics without clearing cache data
   */
  resetCacheMetrics(): void {
    this.binaryHashCache.resetMetrics()
    this.matryoshkaCache.resetMetrics()
  }

  /**
   * Resize cache with new configuration
   */
  resizeCache(config: { maxSize?: number; memoryLimitBytes?: number }): void {
    if (config.maxSize !== undefined) {
      validateCacheConfig({ maxSize: config.maxSize })
      this._cacheConfig.maxSize = config.maxSize
      this.binaryHashCache.resize(config.maxSize, config.memoryLimitBytes)
      this.matryoshkaCache.resize(config.maxSize, config.memoryLimitBytes)
    }
    if (config.memoryLimitBytes !== undefined) {
      this._cacheConfig.memoryLimitBytes = config.memoryLimitBytes
    }
  }

  /**
   * Warm cache with specific document IDs
   */
  async warmCache(ids: string[]): Promise<void> {
    for (const id of ids) {
      const doc = this.documents.get(id)
      if (doc) {
        // Cache binary hash
        if (doc.binary_hash && !this.binaryHashCache.has(id)) {
          this.binaryHashCache.set(id, new Uint8Array(doc.binary_hash))
        }

        // Cache matryoshka embeddings
        if (!this.matryoshkaCache.has(id)) {
          const cache = new Map<number, Float32Array>()
          if (doc.mat_64) cache.set(64, doc.mat_64)
          if (doc.mat_256) cache.set(256, doc.mat_256)
          if (cache.size > 0) {
            this.matryoshkaCache.set(id, cache)
          }
        }
      }
    }
  }
}
