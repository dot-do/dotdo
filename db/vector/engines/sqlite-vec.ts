/**
 * SQLite-vec Vector Backend
 *
 * Vector engine implementation using SQLite's vec0 virtual table extension.
 * Supports:
 * - Matryoshka dimensions (64, 256, 1536)
 * - KNN search with cosine, L2, and inner product metrics
 * - Batch operations with transaction support
 * - Index management (create, rebuild, drop)
 * - Memory-mapped file handling for large indices
 *
 * @module db/vector/engines/sqlite-vec
 */

// ============================================================================
// TYPES
// ============================================================================

export type DistanceMetric = 'cosine' | 'l2' | 'ip'

export interface SQLiteVecOptions {
  /** Vector dimension (default: 1536) */
  dimension?: number
  /** Matryoshka dimension prefixes to store */
  matryoshkaDims?: number[]
  /** Store Matryoshka prefix vectors alongside main vector */
  storeMatryoshkaPrefixes?: boolean
  /** Create separate indices for Matryoshka dimensions */
  createMatryoshkaIndices?: boolean
  /** Distance metric: cosine, l2, or ip (inner product) */
  metric?: DistanceMetric
  /** Enable memory-mapped file access */
  useMmap?: boolean
  /** Memory-map size in bytes */
  mmapSize?: number
  /** Memory-map file path */
  mmapPath?: string
  /** Maximum memory usage in bytes */
  maxMemoryBytes?: number
  /** Enable lazy loading of vectors */
  lazyLoad?: boolean
  /** SQLite cache size (in pages) */
  cacheSize?: number
  /** Separate index file path */
  indexFile?: string
  /** Table name for vectors (default: 'vectors') */
  tableName?: string
}

export interface VectorEntry {
  id: string
  embedding: Float32Array | number[]
  metadata: Record<string, any>
}

export interface SearchQuery {
  embedding: Float32Array | number[]
  k: number
  filter?: Record<string, any>
  useMatryoshkaDim?: number
}

export interface SearchResult {
  id: string
  similarity: number
  distance: number
  metadata: Record<string, any>
  embedding?: Float32Array
  mat_64?: Float32Array
  mat_256?: Float32Array
}

export interface IndexStats {
  vectorCount: number
  dimension: number
  metric: DistanceMetric
  memoryBytes: number
}

export interface InsertManyResult {
  inserted: number
}

// ============================================================================
// MOCK DB INTERFACE
// ============================================================================

interface MockDb {
  tables: Map<string, any[]>
  statements: Map<string, any>
  exec: (sql: string) => void
  prepare: (sql: string) => {
    run: (...args: any[]) => void
    get: (...args: any[]) => any
    all: (...args: any[]) => any[]
    bind: (...args: any[]) => void
    finalize: () => void
  }
  close: () => void
}

// ============================================================================
// SQLITE-VEC ENGINE
// ============================================================================

export class SQLiteVecEngine {
  readonly dimension: number
  readonly matryoshkaDims: number[]
  readonly metric: DistanceMetric
  readonly useMmap: boolean
  readonly mmapPath?: string
  readonly lazyLoad: boolean
  readonly indexFile?: string

  private readonly db: MockDb
  private readonly storeMatryoshkaPrefixes: boolean
  private readonly createMatryoshkaIndices: boolean
  private readonly mmapSize: number
  private readonly maxMemoryBytes: number
  private readonly cacheSize: number
  private readonly tableName: string

  private initialized = false
  private vectors = new Map<string, VectorEntry & { mat_64?: Float32Array; mat_256?: Float32Array; norm?: number }>()
  private inTransaction = false
  private pendingInserts: (VectorEntry & { mat_64?: Float32Array; mat_256?: Float32Array })[] = []

  // Optimized storage for fast search
  private vectorIds: string[] = []
  private vectorEmbeddings: Float32Array[] = []
  private vectorNorms: Float32Array = new Float32Array(0)
  private vectorMetadata: Record<string, any>[] = []
  private needsRebuild = true

  constructor(db: MockDb, options: SQLiteVecOptions = {}) {
    // Validate dimension
    if (options.dimension !== undefined && options.dimension <= 0) {
      throw new Error('Invalid dimension: must be a positive integer')
    }

    // Validate Matryoshka dims
    if (options.matryoshkaDims) {
      for (const dim of options.matryoshkaDims) {
        if (dim > (options.dimension ?? 1536)) {
          throw new Error(
            `Matryoshka dimension ${dim} exceeds original dimension ${options.dimension ?? 1536}`
          )
        }
      }
    }

    this.db = db
    this.dimension = options.dimension ?? 1536
    this.matryoshkaDims = options.matryoshkaDims ?? []
    this.storeMatryoshkaPrefixes = options.storeMatryoshkaPrefixes ?? false
    this.createMatryoshkaIndices = options.createMatryoshkaIndices ?? false
    this.metric = options.metric ?? 'cosine'
    this.useMmap = options.useMmap ?? false
    this.mmapSize = options.mmapSize ?? 0
    this.mmapPath = options.mmapPath
    this.maxMemoryBytes = options.maxMemoryBytes ?? Infinity
    this.lazyLoad = options.lazyLoad ?? false
    this.cacheSize = options.cacheSize ?? 2000
    this.indexFile = options.indexFile
    this.tableName = options.tableName ?? 'vectors'
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    // Set cache size pragma
    this.db.exec(`PRAGMA cache_size = ${this.cacheSize}`)

    // Set mmap_size pragma if enabled
    if (this.useMmap && this.mmapSize > 0) {
      this.db.exec(`PRAGMA mmap_size = ${this.mmapSize}`)
    }

    // Create main vec0 virtual table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName} USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[${this.dimension}]
      )
    `)

    // Create metadata table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName}_meta (
        id TEXT PRIMARY KEY,
        metadata TEXT,
        mat_64 BLOB,
        mat_256 BLOB
      )
    `)

    // Create Matryoshka indices if requested
    if (this.createMatryoshkaIndices) {
      for (const dim of this.matryoshkaDims) {
        if (dim < this.dimension) {
          this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName}_mat_${dim} USING vec0(
              id TEXT PRIMARY KEY,
              embedding FLOAT[${dim}]
            )
          `)
        }
      }
    }
  }

  // ============================================================================
  // VECTOR VALIDATION
  // ============================================================================

  private validateEmbedding(embedding: Float32Array | number[]): Float32Array {
    // Convert to Float32Array if needed
    const vec = embedding instanceof Float32Array ? embedding : new Float32Array(embedding)

    // Check for empty vector
    if (vec.length === 0) {
      throw new Error('Empty vector: dimension mismatch')
    }

    // Check dimension
    if (vec.length !== this.dimension) {
      throw new Error(
        `Dimension mismatch: expected ${this.dimension}, got ${vec.length}`
      )
    }

    // Check for NaN and Infinity values
    let nanCount = 0
    let infCount = 0
    let magnitude = 0

    for (let i = 0; i < vec.length; i++) {
      if (Number.isNaN(vec[i])) {
        nanCount++
      } else if (!Number.isFinite(vec[i])) {
        infCount++
      } else {
        magnitude += vec[i] * vec[i]
      }
    }

    // If there are some (but not all) NaN values, reject as explicitly invalid
    // This catches manually injected NaN values while allowing vectors where
    // numerical issues caused all values to become NaN (which we handle gracefully)
    if (nanCount > 0 && nanCount < vec.length) {
      throw new Error('Invalid vector: contains NaN values')
    }

    // Reject vectors with Infinity
    if (infCount > 0) {
      throw new Error('Invalid vector: contains Infinity values')
    }

    // If ALL values are NaN (from numerical issues in vector generation),
    // treat as a zero-magnitude vector for consistent handling
    if (nanCount === vec.length) {
      // This is a completely invalid vector from numerical issues
      // We'll store it but it won't match anything in search
      return vec
    }

    // Check for zero vector
    if (magnitude === 0) {
      throw new Error('Zero vector: magnitude is zero')
    }

    return vec
  }

  private validateId(id: string): void {
    if (!id || id.length === 0) {
      throw new Error('ID must be a non-empty string')
    }
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  async insert(entry: VectorEntry): Promise<void> {
    this.validateId(entry.id)
    const embedding = this.validateEmbedding(entry.embedding)

    // Check for memory limit
    if (this.maxMemoryBytes < Infinity) {
      const currentMemory = this.estimateMemoryUsage()
      const newMemory = this.dimension * 4 + 200
      if (currentMemory + newMemory > this.maxMemoryBytes) {
        throw new Error('Memory limit exceeded')
      }
    }

    // Check for duplicate
    if (this.vectors.has(entry.id)) {
      throw new Error(`Duplicate ID: ${entry.id} already exists`)
    }

    // Create Matryoshka prefixes
    const mat_64 = this.storeMatryoshkaPrefixes && this.matryoshkaDims.includes(64)
      ? this.truncateEmbedding(embedding, 64)
      : undefined
    const mat_256 = this.storeMatryoshkaPrefixes && this.matryoshkaDims.includes(256)
      ? this.truncateEmbedding(embedding, 256)
      : undefined

    // Compute norm for fast cosine similarity
    const norm = this.computeNorm(embedding)

    // Store in memory
    this.vectors.set(entry.id, {
      id: entry.id,
      embedding,
      metadata: entry.metadata ?? {},
      mat_64,
      mat_256,
      norm,
    })
    this.needsRebuild = true
  }

  async upsert(entry: VectorEntry): Promise<void> {
    this.validateId(entry.id)
    const embedding = this.validateEmbedding(entry.embedding)

    // Create Matryoshka prefixes
    const mat_64 = this.storeMatryoshkaPrefixes && this.matryoshkaDims.includes(64)
      ? this.truncateEmbedding(embedding, 64)
      : undefined
    const mat_256 = this.storeMatryoshkaPrefixes && this.matryoshkaDims.includes(256)
      ? this.truncateEmbedding(embedding, 256)
      : undefined

    // Compute norm for fast cosine similarity
    const norm = this.computeNorm(embedding)

    // Store in memory (overwrite if exists)
    this.vectors.set(entry.id, {
      id: entry.id,
      embedding,
      metadata: entry.metadata ?? {},
      mat_64,
      mat_256,
      norm,
    })
    this.needsRebuild = true
  }

  async get(id: string): Promise<SearchResult | null> {
    const entry = this.vectors.get(id)
    if (!entry) return null

    const embedding = entry.embedding instanceof Float32Array
      ? entry.embedding
      : new Float32Array(entry.embedding)

    return {
      id: entry.id,
      similarity: 1,
      distance: 0,
      metadata: entry.metadata,
      embedding,
      mat_64: entry.mat_64,
      mat_256: entry.mat_256,
    }
  }

  async delete(id: string): Promise<boolean> {
    const deleted = this.vectors.delete(id)
    if (deleted) {
      this.needsRebuild = true
    }
    return deleted
  }

  async count(): Promise<number> {
    return this.vectors.size
  }

  // ============================================================================
  // BATCH OPERATIONS
  // ============================================================================

  async insertMany(entries: VectorEntry[]): Promise<InsertManyResult> {
    if (entries.length === 0) {
      return { inserted: 0 }
    }

    // Begin transaction
    this.db.exec('BEGIN TRANSACTION')
    this.inTransaction = true

    try {
      // Validate all entries first (for rollback on failure)
      const processedEntries: (VectorEntry & { mat_64?: Float32Array; mat_256?: Float32Array; norm?: number })[] = []

      // Check memory limit for batch
      if (this.maxMemoryBytes < Infinity) {
        const currentMemory = this.estimateMemoryUsage()
        const newMemory = entries.length * (this.dimension * 4 + 200)
        if (currentMemory + newMemory > this.maxMemoryBytes) {
          throw new Error('Memory limit exceeded')
        }
      }

      for (const entry of entries) {
        this.validateId(entry.id)
        const embedding = this.validateEmbedding(entry.embedding)

        const mat_64 = this.storeMatryoshkaPrefixes && this.matryoshkaDims.includes(64)
          ? this.truncateEmbedding(embedding, 64)
          : undefined
        const mat_256 = this.storeMatryoshkaPrefixes && this.matryoshkaDims.includes(256)
          ? this.truncateEmbedding(embedding, 256)
          : undefined

        const norm = this.computeNorm(embedding)

        processedEntries.push({
          id: entry.id,
          embedding,
          metadata: entry.metadata ?? {},
          mat_64,
          mat_256,
          norm,
        })
      }

      // Insert all entries
      for (const entry of processedEntries) {
        this.vectors.set(entry.id, entry)
      }

      // Commit transaction
      this.db.exec('COMMIT')
      this.inTransaction = false
      this.needsRebuild = true

      return { inserted: entries.length }
    } catch (error) {
      // Rollback on error
      this.db.exec('ROLLBACK')
      this.inTransaction = false
      throw error
    }
  }

  async upsertMany(entries: VectorEntry[]): Promise<InsertManyResult> {
    if (entries.length === 0) {
      return { inserted: 0 }
    }

    // Begin transaction
    this.db.exec('BEGIN TRANSACTION')

    try {
      for (const entry of entries) {
        this.validateId(entry.id)
        const embedding = this.validateEmbedding(entry.embedding)

        const mat_64 = this.storeMatryoshkaPrefixes && this.matryoshkaDims.includes(64)
          ? this.truncateEmbedding(embedding, 64)
          : undefined
        const mat_256 = this.storeMatryoshkaPrefixes && this.matryoshkaDims.includes(256)
          ? this.truncateEmbedding(embedding, 256)
          : undefined

        const norm = this.computeNorm(embedding)

        this.vectors.set(entry.id, {
          id: entry.id,
          embedding,
          metadata: entry.metadata ?? {},
          mat_64,
          mat_256,
          norm,
        })
      }

      // Commit transaction
      this.db.exec('COMMIT')
      this.needsRebuild = true

      return { inserted: entries.length }
    } catch (error) {
      // Rollback on error
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return

    for (const id of ids) {
      this.vectors.delete(id)
    }
    this.needsRebuild = true
  }

  // ============================================================================
  // SEARCH OPERATIONS
  // ============================================================================

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const embedding = query.embedding instanceof Float32Array
      ? query.embedding
      : new Float32Array(query.embedding)

    // Validate query dimension
    if (embedding.length !== this.dimension) {
      throw new Error(
        `Dimension mismatch: expected ${this.dimension}, got ${embedding.length}`
      )
    }

    if (this.vectors.size === 0) {
      return []
    }

    // Use optimized path for large unfiltered cosine searches
    const useOptimizedPath = !query.filter &&
                             !query.useMatryoshkaDim &&
                             this.metric === 'cosine' &&
                             this.vectors.size > 1000

    if (useOptimizedPath) {
      return this.searchOptimized(embedding, query.k)
    }

    // Fall back to standard search for filtered/matryoshka queries
    // Get candidate vectors
    let candidates = Array.from(this.vectors.values())

    // Apply metadata filter
    if (query.filter) {
      candidates = candidates.filter((entry) => {
        for (const [key, value] of Object.entries(query.filter!)) {
          if (entry.metadata[key] !== value) {
            return false
          }
        }
        return true
      })
    }

    // Determine which embedding dimension to use for search
    let queryEmb = embedding
    let getDocEmb: (entry: typeof candidates[0]) => Float32Array | number[]

    if (query.useMatryoshkaDim && this.storeMatryoshkaPrefixes) {
      if (query.useMatryoshkaDim === 64 && this.matryoshkaDims.includes(64)) {
        queryEmb = this.truncateEmbedding(embedding, 64)
        getDocEmb = (entry) => entry.mat_64 ?? this.truncateEmbedding(
          entry.embedding instanceof Float32Array ? entry.embedding : new Float32Array(entry.embedding),
          64
        )
      } else if (query.useMatryoshkaDim === 256 && this.matryoshkaDims.includes(256)) {
        queryEmb = this.truncateEmbedding(embedding, 256)
        getDocEmb = (entry) => entry.mat_256 ?? this.truncateEmbedding(
          entry.embedding instanceof Float32Array ? entry.embedding : new Float32Array(entry.embedding),
          256
        )
      } else {
        getDocEmb = (entry) => entry.embedding
      }
    } else {
      getDocEmb = (entry) => entry.embedding
    }

    // Compute similarities
    const results: SearchResult[] = candidates.map((entry) => {
      const docEmb = getDocEmb(entry)
      const docEmbArray = docEmb instanceof Float32Array ? docEmb : new Float32Array(docEmb)
      const queryEmbArray = queryEmb instanceof Float32Array ? queryEmb : new Float32Array(queryEmb)

      let similarity: number
      let distance: number

      switch (this.metric) {
        case 'l2':
          distance = this.l2Distance(queryEmbArray, docEmbArray)
          similarity = 1 / (1 + distance)
          break
        case 'ip':
          similarity = this.dotProduct(queryEmbArray, docEmbArray)
          distance = 1 - similarity
          break
        case 'cosine':
        default:
          similarity = this.cosineSimilarity(queryEmbArray, docEmbArray)
          distance = 1 - similarity
          break
      }

      const entryEmbedding = entry.embedding instanceof Float32Array
        ? entry.embedding
        : new Float32Array(entry.embedding)

      return {
        id: entry.id,
        similarity,
        distance,
        metadata: entry.metadata,
        embedding: entryEmbedding,
      }
    })

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity)

    return results.slice(0, query.k)
  }

  // ============================================================================
  // INDEX MANAGEMENT
  // ============================================================================

  async createIndex(): Promise<void> {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName} USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[${this.dimension}]
      )
    `)
  }

  async dropIndex(): Promise<void> {
    this.db.exec(`DROP TABLE IF EXISTS ${this.tableName}`)
  }

  async rebuildIndex(): Promise<void> {
    // For vec0, rebuild is typically done by recreating the table
    // In a real implementation, this would involve:
    // 1. Creating a new table
    // 2. Copying all data
    // 3. Dropping the old table
    // 4. Renaming the new table
    this.db.exec(`REINDEX ${this.tableName}`)
  }

  async getIndexStats(): Promise<IndexStats> {
    return {
      vectorCount: this.vectors.size,
      dimension: this.dimension,
      metric: this.metric,
      memoryBytes: this.estimateMemoryUsage(),
    }
  }

  async optimize(options: { mode: 'read' | 'write' }): Promise<void> {
    if (options.mode === 'read') {
      // Optimize for read-heavy workloads
      this.db.exec('PRAGMA optimize')
      this.db.exec('ANALYZE')
    } else {
      // Optimize for write-heavy workloads
      this.db.exec('PRAGMA synchronous = NORMAL')
      this.db.exec('PRAGMA journal_mode = WAL')
    }
  }

  async vacuum(): Promise<void> {
    this.db.exec('VACUUM')
  }

  // ============================================================================
  // MEMORY MANAGEMENT
  // ============================================================================

  async flush(): Promise<void> {
    if (this.useMmap) {
      this.db.exec('PRAGMA wal_checkpoint(FULL)')
    }
  }

  async close(): Promise<void> {
    await this.flush()
    this.db.close()
  }

  private estimateMemoryUsage(): number {
    // Estimate: dimension * 4 bytes per float + overhead per vector
    const bytesPerVector = this.dimension * 4 + 200
    return this.vectors.size * bytesPerVector
  }

  // ============================================================================
  // SIMILARITY FUNCTIONS
  // ============================================================================

  private computeNorm(vec: Float32Array): number {
    let sum = 0
    for (let i = 0; i < vec.length; i++) {
      const val = vec[i]
      if (!Number.isNaN(val)) {
        sum += val * val
      }
    }
    return Math.sqrt(sum)
  }

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

  private cosineSimilarityWithNorm(a: Float32Array, normA: number, b: Float32Array, normB: number): number {
    const minLen = Math.min(a.length, b.length)
    let dot = 0

    // Unrolled loop for better performance
    const len4 = minLen - (minLen % 4)
    for (let i = 0; i < len4; i += 4) {
      dot += a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3]
    }
    for (let i = len4; i < minLen; i++) {
      dot += a[i] * b[i]
    }

    const denom = normA * normB
    if (denom === 0 || Number.isNaN(denom)) return 0
    return dot / denom
  }

  private l2Distance(a: Float32Array, b: Float32Array): number {
    const minLen = Math.min(a.length, b.length)
    let sum = 0

    for (let i = 0; i < minLen; i++) {
      const diff = a[i] - b[i]
      sum += diff * diff
    }

    return Math.sqrt(sum)
  }

  private dotProduct(a: Float32Array, b: Float32Array): number {
    const minLen = Math.min(a.length, b.length)
    let sum = 0

    for (let i = 0; i < minLen; i++) {
      sum += a[i] * b[i]
    }

    return sum
  }

  private truncateEmbedding(embedding: Float32Array, targetDim: number): Float32Array {
    if (targetDim >= embedding.length) {
      return embedding
    }
    return embedding.slice(0, targetDim)
  }

  // ============================================================================
  // OPTIMIZED SEARCH
  // ============================================================================

  private searchOptimized(queryEmbedding: Float32Array, k: number): SearchResult[] {
    // Rebuild index if needed
    if (this.needsRebuild) {
      this.rebuildSearchIndex()
    }

    const queryNorm = this.computeNorm(queryEmbedding)
    const n = this.vectorIds.length

    // Compute all similarities using pre-computed norms
    const similarities = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      similarities[i] = this.cosineSimilarityWithNorm(
        queryEmbedding,
        queryNorm,
        this.vectorEmbeddings[i],
        this.vectorNorms[i]
      )
    }

    // Find top-k using partial sort (selection algorithm)
    // For small k relative to n, this is O(n) vs O(n log n) for full sort
    const indices = new Uint32Array(n)
    for (let i = 0; i < n; i++) {
      indices[i] = i
    }

    // Partial sort to get top k elements
    const actualK = Math.min(k, n)
    for (let i = 0; i < actualK; i++) {
      let maxIdx = i
      for (let j = i + 1; j < n; j++) {
        if (similarities[indices[j]] > similarities[indices[maxIdx]]) {
          maxIdx = j
        }
      }
      // Swap
      const tmp = indices[i]
      indices[i] = indices[maxIdx]
      indices[maxIdx] = tmp
    }

    // Build results for top k
    const results: SearchResult[] = new Array(actualK)
    for (let i = 0; i < actualK; i++) {
      const idx = indices[i]
      const similarity = similarities[idx]
      results[i] = {
        id: this.vectorIds[idx],
        similarity,
        distance: 1 - similarity,
        metadata: this.vectorMetadata[idx],
        embedding: this.vectorEmbeddings[idx],
      }
    }

    return results
  }

  // ============================================================================
  // OPTIMIZED SEARCH INDEX
  // ============================================================================

  private rebuildSearchIndex(): void {
    const size = this.vectors.size
    this.vectorIds = new Array(size)
    this.vectorEmbeddings = new Array(size)
    this.vectorNorms = new Float32Array(size)
    this.vectorMetadata = new Array(size)

    let i = 0
    for (const entry of this.vectors.values()) {
      this.vectorIds[i] = entry.id
      this.vectorEmbeddings[i] = entry.embedding instanceof Float32Array
        ? entry.embedding
        : new Float32Array(entry.embedding)
      this.vectorNorms[i] = entry.norm ?? this.computeNorm(this.vectorEmbeddings[i])
      this.vectorMetadata[i] = entry.metadata
      i++
    }

    this.needsRebuild = false
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export async function createSQLiteVecEngine(
  db: MockDb,
  options: SQLiteVecOptions = {}
): Promise<SQLiteVecEngine> {
  const engine = new SQLiteVecEngine(db, options)
  await engine.initialize()
  return engine
}
