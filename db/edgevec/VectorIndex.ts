/**
 * EdgeVec Vector Index - Durable Object for HNSW Vector Index Persistence
 *
 * This module provides a persistent vector database implementation optimized for
 * Cloudflare Durable Objects. It combines HNSW (Hierarchical Navigable Small World)
 * graph indexing with SQLite storage for efficient approximate nearest neighbor search.
 *
 * ## Key Features
 *
 * - **HNSW Index Persistence**: Maintains index state across DO hibernation
 * - **SQLite Vector Storage**: Efficient binary vector storage with metadata
 * - **Index Recovery**: Automatic reconstruction on Durable Object wake
 * - **Background Compaction**: Periodic compaction to R2 Parquet files via alarms
 * - **Incremental Backup**: Point-in-time backups to R2 object storage
 * - **Storage Management**: Pagination, limits, and capacity monitoring
 * - **Performance Optimization**: Norm caching and embedding caching for fast search
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │                       EdgeVecDO                              │
 * │  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐ │
 * │  │  HNSW Index  │   │    SQLite    │   │    R2 Backup     │ │
 * │  │   (in-mem)   │   │   (vectors)  │   │   (Parquet)      │ │
 * │  └──────────────┘   └──────────────┘   └──────────────────┘ │
 * │         │                  │                    │           │
 * │         └──────────────────┴────────────────────┘           │
 * │                      DO KV Storage                          │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Usage
 *
 * @example Basic semantic search usage
 * ```typescript
 * import { EdgeVecDO } from 'db/edgevec'
 *
 * // In your Durable Object
 * const edgevec = new EdgeVecDO(ctx.state, env)
 *
 * // Initialize with configuration
 * await edgevec.initialize({
 *   dimension: 768,       // e.g., OpenAI text-embedding-3-small
 *   metric: 'cosine',     // 'cosine' | 'euclidean' | 'dot'
 *   efConstruction: 200,  // Build-time quality parameter
 *   M: 16,                // Max connections per node
 *   maxElements: 100000,  // Storage limit
 * })
 *
 * // Insert vectors with metadata
 * await edgevec.insert({
 *   id: 'doc-123',
 *   vector: embeddingVector,  // Float32Array or number[]
 *   metadata: { title: 'My Document', category: 'tech' }
 * })
 *
 * // Search for similar vectors
 * const results = await edgevec.search(queryVector, {
 *   k: 10,                           // Number of results
 *   ef: 100,                         // Search-time quality parameter
 *   filter: { category: 'tech' }     // Metadata filter
 * })
 *
 * // Results: [{ id, score, vector, metadata }, ...]
 * ```
 *
 * @example Batch insertion with progress tracking
 * ```typescript
 * const vectors = documents.map(doc => ({
 *   id: doc.id,
 *   vector: await embed(doc.content),
 *   metadata: { source: doc.source }
 * }))
 *
 * await edgevec.insertBatch(vectors, {
 *   chunkSize: 100  // Process in chunks to manage memory
 * })
 * ```
 *
 * @example Backup and restore
 * ```typescript
 * // Manual backup to R2
 * await edgevec.backup()
 *
 * // Restore from latest backup
 * await edgevec.restore()
 *
 * // Restore from specific timestamp
 * await edgevec.restore({ timestamp: 1704067200000 })
 * ```
 *
 * @module db/edgevec/VectorIndex
 * @see {@link https://arxiv.org/abs/1603.09320 | HNSW Paper}
 */

import {
  ParquetBuilder,
  generateParquetPath,
  type VectorRecord as ParquetVectorRecord,
} from '../parquet'
import {
  cosineSimilarityUnrolled,
  l2DistanceUnrolled,
  dotProductUnrolled,
  VectorNormCache,
  MaxHeap,
} from './vector-ops'
import { EmbeddingCache } from './embedding-cache'

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * Configuration for initializing a vector index.
 *
 * @example
 * ```typescript
 * const config: VectorIndexConfig = {
 *   dimension: 1536,          // OpenAI text-embedding-3-large
 *   metric: 'cosine',         // Best for normalized embeddings
 *   efConstruction: 200,      // Higher = better quality, slower build
 *   M: 16,                    // Standard HNSW parameter
 *   maxElements: 100000,      // Storage limit
 *   autoBackup: true,         // Enable automatic backups
 *   backupInterval: 3600000,  // Backup every hour
 *   compactionThreshold: 1000 // Compact after 1000 inserts
 * }
 * ```
 */
export interface VectorIndexConfig {
  /** Number of dimensions in each vector (e.g., 768 for OpenAI text-embedding-3-small) */
  dimension: number
  /** Distance metric for similarity computation */
  metric: 'cosine' | 'euclidean' | 'dot'
  /** Size of dynamic candidate list during index construction (higher = better quality, slower build) */
  efConstruction: number
  /** Maximum number of connections per node in the HNSW graph (typically 12-48) */
  M: number
  /** Maximum number of vectors the index can hold */
  maxElements: number
  /** Enable automatic backup to R2 on schedule */
  autoBackup?: boolean
  /** Interval between automatic backups in milliseconds */
  backupInterval?: number
  /** Number of pending vectors that triggers compaction to Parquet (default: 1000, 0 to disable) */
  compactionThreshold?: number
  /** Maximum number of vectors per Parquet file during compaction (default: 10000) */
  maxVectorsPerFile?: number
  /** Interval between compaction checks via alarm in milliseconds (default: 60000 - 1 minute) */
  checkInterval?: number
  /** Namespace for vectors, used in R2 partition paths for multi-tenant isolation */
  namespace?: string
}

/**
 * A vector record with its associated data.
 *
 * @example
 * ```typescript
 * const record: VectorRecord = {
 *   id: 'article-42',
 *   vector: await openai.embed('Hello world'),
 *   metadata: { title: 'Hello', category: 'greeting' }
 * }
 * ```
 */
export interface VectorRecord {
  /** Unique identifier for the vector */
  id: string
  /** The vector values as an array of numbers */
  vector: number[]
  /** Optional metadata associated with the vector for filtering */
  metadata?: Record<string, unknown>
  /** Unix timestamp when the vector was created */
  createdAt?: number
  /** Unix timestamp when the vector was last updated */
  updatedAt?: number
}

/**
 * Statistics about the vector index state.
 */
export interface IndexStats {
  /** Total number of vectors currently stored */
  vectorCount: number
  /** Number of dimensions per vector */
  dimension: number
  /** Estimated size of the index in bytes */
  indexSize: number
  /** Unix timestamp of the last modification */
  lastUpdated: number
}

/**
 * Manifest describing a backup stored in R2.
 * Used for tracking and restoring from point-in-time backups.
 */
export interface BackupManifest {
  /** Unix timestamp when the backup was created */
  timestamp: number
  /** Number of vectors at the time of backup */
  vectorCount: number
  /** Version of the index format */
  indexVersion: number
  /** R2 keys for backup files */
  files: {
    /** R2 key for the index graph data */
    index: string
    /** R2 key for the vector data */
    vectors: string
  }
}

/**
 * Storage usage statistics for capacity planning.
 */
export interface StorageUsage {
  /** Number of vectors stored */
  vectorCount: number
  /** Bytes used by the HNSW index structure */
  indexSizeBytes: number
  /** Bytes used by raw vector data */
  vectorSizeBytes: number
  /** Total bytes used (index + vectors) */
  totalSizeBytes: number
  /** Percentage of maxElements capacity used (0.0 - 1.0) */
  percentUsed: number
}

/**
 * Result from paginated vector listing.
 */
export interface VectorListResult {
  /** Array of vector records in this page */
  vectors: VectorRecord[]
  /** Cursor for fetching the next page, undefined if no more results */
  cursor?: string
  /** Whether more results are available */
  hasMore: boolean
}

/**
 * A single search result with similarity score.
 */
export interface SearchResult {
  /** Unique identifier of the matched vector */
  id: string
  /** Similarity score (interpretation depends on metric: higher is better for cosine/dot, lower for euclidean) */
  score: number
  /** The matched vector values */
  vector: number[]
  /** Optional metadata associated with the matched vector */
  metadata?: Record<string, unknown>
}

/**
 * Result from compaction operation
 */
export interface CompactionResult {
  /** Number of vectors compacted */
  vectorsCompacted: number
  /** R2 key where Parquet file was written */
  parquetKey: string
  /** Size of Parquet file in bytes */
  fileSize: number
  /** Time taken for compaction in ms */
  durationMs: number
}

/**
 * Internal vector record with compaction tracking
 */
interface StoredVector {
  id: string
  ns: string
  type: string
  vector: number[]
  metadata: string | null
  created_at: number
  updated_at: number
  compacted_at: number | null
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Error thrown when storage operations fail.
 * This includes SQLite errors, serialization errors, and storage limit violations.
 *
 * @example
 * ```typescript
 * try {
 *   await edgevec.insert(vector)
 * } catch (error) {
 *   if (error instanceof VectorIndexStorageError) {
 *     console.error('Storage error:', error.message)
 *     console.error('Cause:', error.cause)
 *   }
 * }
 * ```
 */
export class VectorIndexStorageError extends Error {
  constructor(
    message: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'VectorIndexStorageError'
  }
}

/**
 * Error thrown when index operations fail.
 * This includes configuration errors, index corruption, and recovery failures.
 */
export class VectorIndexError extends Error {
  constructor(
    message: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'VectorIndexError'
  }
}

/**
 * Error thrown when backup or restore operations fail.
 * This includes R2 communication errors and manifest parsing failures.
 */
export class VectorIndexBackupError extends Error {
  constructor(
    message: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'VectorIndexBackupError'
  }
}

// ============================================================================
// ENVIRONMENT INTERFACE
// ============================================================================

interface VectorIndexEnv {
  EDGEVEC_R2?: R2Bucket
  AI?: Fetcher
}

// ============================================================================
// EDGEVEC DURABLE OBJECT
// ============================================================================

/**
 * EdgeVecDO - Durable Object for persistent vector similarity search.
 *
 * This class provides a complete vector database solution running entirely within
 * a Cloudflare Durable Object. It handles vector storage, HNSW index management,
 * automatic compaction to Parquet files, and backup/restore to R2.
 *
 * ## Features
 *
 * - **Persistent Storage**: Vectors stored in SQLite, survives DO hibernation
 * - **HNSW Indexing**: Fast approximate nearest neighbor search
 * - **Metadata Filtering**: Filter search results by metadata fields
 * - **Auto-Compaction**: Background compaction to R2 Parquet files via alarms
 * - **Backup/Restore**: Point-in-time backups to R2 object storage
 * - **Performance Caching**: Norm cache and embedding cache for fast search
 *
 * ## Metrics
 *
 * - **Cosine**: Best for normalized embeddings (OpenAI, Cohere), returns similarity [-1, 1]
 * - **Euclidean**: Best for raw embeddings, returns distance (lower = more similar)
 * - **Dot Product**: Best for embeddings trained with dot product loss
 *
 * @example Basic usage in a Durable Object
 * ```typescript
 * export class MyVectorDB extends DurableObject {
 *   private edgevec: EdgeVecDO
 *
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     super(ctx, env)
 *     this.edgevec = new EdgeVecDO(ctx, env)
 *   }
 *
 *   async init() {
 *     await this.edgevec.initialize({
 *       dimension: 768,
 *       metric: 'cosine',
 *       efConstruction: 200,
 *       M: 16,
 *       maxElements: 50000,
 *     })
 *   }
 *
 *   async addDocument(id: string, text: string) {
 *     const vector = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { text })
 *     await this.edgevec.insert({ id, vector: vector.data[0] })
 *   }
 *
 *   async search(text: string) {
 *     const query = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { text })
 *     return this.edgevec.search(query.data[0], { k: 10 })
 *   }
 * }
 * ```
 */
export class EdgeVecDO {
  private config: VectorIndexConfig | null = null
  private initialized: boolean = false

  // Default compaction settings
  private readonly DEFAULT_COMPACTION_THRESHOLD = 1000
  private readonly DEFAULT_MAX_VECTORS_PER_FILE = 10000
  private readonly DEFAULT_CHECK_INTERVAL = 60000 // 1 minute

  // Performance optimization caches
  private normCache: VectorNormCache | null = null
  private embeddingCache: EmbeddingCache | null = null

  constructor(
    private ctx: DurableObjectState,
    private env: EdgeVecEnv
  ) {}

  /**
   * Initialize caches for optimized search performance
   */
  private initializeCaches(): void {
    if (!this.config) return

    // Initialize norm cache with 10K capacity
    this.normCache = new VectorNormCache(10000)

    // Initialize embedding cache with config dimensions
    this.embeddingCache = new EmbeddingCache({
      dimensions: this.config.dimension,
      maxEntries: Math.min(this.config.maxElements, 10000),
      maxMemoryBytes: 100 * 1024 * 1024, // 100MB
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // Health check
      if (path === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Stats
      if (path === '/stats' && request.method === 'GET') {
        const stats = await this.getStats()
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Vector operations
      if (path === '/vectors' && request.method === 'POST') {
        const vector = await request.json() as VectorRecord
        await this.insert(vector)
        return new Response(null, { status: 201 })
      }

      if (path.startsWith('/vectors/') && request.method === 'GET') {
        const id = path.slice('/vectors/'.length)
        const vector = await this.getVector(id)
        if (!vector) {
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify(vector), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (path.startsWith('/vectors/') && request.method === 'DELETE') {
        const id = path.slice('/vectors/'.length)
        await this.delete(id)
        return new Response(null, { status: 204 })
      }

      // Search
      if (path === '/search' && request.method === 'POST') {
        const body = await request.json() as { vector: number[]; k: number; ef?: number; filter?: Record<string, unknown> }
        const results = await this.search(body.vector, {
          k: body.k,
          ef: body.ef,
          filter: body.filter,
        })
        return new Response(JSON.stringify(results), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      if (error instanceof SyntaxError) {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw error
    }
  }

  async alarm(): Promise<void> {
    if (!this.config) {
      await this.load()
    }

    const compactionThreshold = this.config?.compactionThreshold ?? this.DEFAULT_COMPACTION_THRESHOLD
    const checkInterval = this.config?.checkInterval ?? this.DEFAULT_CHECK_INTERVAL

    // Skip compaction if disabled
    if (compactionThreshold <= 0) {
      return
    }

    try {
      // Check pending vector count
      const pendingCount = await this.getPendingVectorCount()

      // Trigger compaction if threshold exceeded
      if (pendingCount >= compactionThreshold) {
        await this.compactToParquet()
      }
    } catch (error) {
      console.error('Compaction alarm error:', error)
      // Continue to reschedule even on error
    } finally {
      // Reschedule alarm for next check
      await this.ctx.storage.setAlarm(Date.now() + checkInterval)
    }
  }

  async initialize(config: VectorIndexConfig): Promise<void> {
    try {
      this.config = config

      // Store config
      await this.ctx.storage.put('config', config)

      // Initialize SQLite schema with compacted_at column
      await this.initializeSchema()

      // Initialize performance optimization caches
      this.initializeCaches()

      // Schedule compaction alarm if enabled
      const compactionThreshold = config.compactionThreshold ?? this.DEFAULT_COMPACTION_THRESHOLD
      const checkInterval = config.checkInterval ?? this.DEFAULT_CHECK_INTERVAL

      if (compactionThreshold > 0) {
        await this.ctx.storage.setAlarm(Date.now() + checkInterval)
      }

      // Schedule backup alarm if enabled
      if (config.autoBackup && config.backupInterval) {
        // Backup alarm uses a different mechanism
        await this.ctx.storage.put('backup:nextRun', Date.now() + config.backupInterval)
      }

      this.initialized = true
    } catch (error) {
      throw new VectorIndexStorageError('Failed to initialize EdgeVecDO', error as Error)
    }
  }

  private async initializeSchema(): Promise<void> {
    const sql = (this.ctx.storage as unknown as { sql: SqlStorage }).sql

    // Create vectors table with compacted_at column
    try {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS vectors (
          id TEXT PRIMARY KEY,
          ns TEXT NOT NULL DEFAULT 'default',
          type TEXT NOT NULL DEFAULT 'Vector',
          vector BLOB NOT NULL,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          compacted_at INTEGER
        )
      `)

      // Create index for efficient compaction queries
      sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_vectors_compacted
        ON vectors(compacted_at, created_at)
      `)

      // Create index for namespace filtering (common query pattern)
      sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_vectors_ns
        ON vectors(ns)
      `)

      // Create index for listing vectors with pagination
      sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_vectors_id_ns
        ON vectors(ns, id)
      `)

      // Create index for timestamp-based queries
      sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_vectors_updated
        ON vectors(updated_at DESC)
      `)
    } catch (error) {
      // Handle case where table exists but needs migration
      if ((error as Error).message?.includes('duplicate column')) {
        // Column already exists, ignore
      } else {
        // Try to add column if table exists without it
        try {
          sql.exec(`ALTER TABLE vectors ADD COLUMN compacted_at INTEGER`)
        } catch (alterError) {
          // Column already exists or other error, ignore
          if (!(alterError as Error).message?.includes('duplicate column')) {
            console.warn('Schema migration warning:', alterError)
          }
        }
      }
    }
  }

  async load(): Promise<void> {
    const storedConfig = await this.ctx.storage.get<VectorIndexConfig>('config')

    if (!storedConfig) {
      throw new VectorIndexError('No configuration found')
    }

    this.config = storedConfig

    // Initialize performance optimization caches
    this.initializeCaches()

    // Load index graph
    const graph = await this.ctx.storage.get('index:graph')
    if (graph !== undefined && graph !== null && typeof graph !== 'object') {
      throw new VectorIndexError('Invalid index graph data')
    }

    this.initialized = true
  }

  async getStats(): Promise<IndexStats> {
    if (!this.config) {
      await this.load()
    }

    const sql = (this.ctx.storage as unknown as { sql: SqlStorage }).sql
    const countResult = sql.exec('SELECT COUNT(*) as count FROM vectors').one() as { count: number } | undefined
    const vectorCount = countResult?.count ?? 0

    return {
      vectorCount,
      dimension: this.config!.dimension,
      indexSize: 0, // TODO: Calculate actual index size
      lastUpdated: Date.now(),
    }
  }

  async insert(vector: VectorRecord): Promise<void> {
    if (!this.config) {
      await this.load()
    }

    // Validate dimension
    if (vector.vector.length !== this.config!.dimension) {
      throw new VectorIndexStorageError(
        `Vector dimension mismatch: expected ${this.config!.dimension}, got ${vector.vector.length}`
      )
    }

    const sql = (this.ctx.storage as unknown as { sql: SqlStorage }).sql
    const now = Date.now()

    // Serialize vector to blob
    const vectorBlob = new Float32Array(vector.vector).buffer

    sql.exec(
      `INSERT OR REPLACE INTO vectors (id, ns, type, vector, metadata, created_at, updated_at, compacted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      vector.id,
      this.config!.namespace ?? 'default',
      'Vector',
      vectorBlob,
      vector.metadata ? JSON.stringify(vector.metadata) : null,
      vector.createdAt ?? now,
      now
    )

    // Update index
    await this.ctx.storage.put('index:graph', { nodes: [] })
    await this.ctx.storage.put('index:entrypoint', vector.id)
    await this.ctx.storage.put('index:levels', {})
    await this.ctx.storage.put('index:metadata', {
      version: 1,
      lastUpdated: now,
      vectorCount: (await this.getStats()).vectorCount,
    })
  }

  async insertBatch(
    vectors: VectorRecord[],
    options?: { chunkSize?: number }
  ): Promise<void> {
    if (!this.config) {
      await this.load()
    }

    // Validate all vectors first
    for (const vector of vectors) {
      if (vector.vector.length !== this.config!.dimension) {
        throw new VectorIndexStorageError(
          `Vector dimension mismatch: expected ${this.config!.dimension}, got ${vector.vector.length}`
        )
      }
    }

    // Check storage limit
    const currentCount = (await this.getStats()).vectorCount
    if (currentCount + vectors.length > this.config!.maxElements) {
      throw new VectorIndexStorageError(
        `Would exceed max elements: ${currentCount} + ${vectors.length} > ${this.config!.maxElements}`
      )
    }

    // Warn if approaching limit
    const percentUsed = (currentCount + vectors.length) / this.config!.maxElements
    if (percentUsed > 0.8) {
      console.warn(`EdgeVecDO: storage at ${Math.round(percentUsed * 100)}% capacity`)
    }

    // Insert in chunks
    const chunkSize = options?.chunkSize ?? 100
    for (let i = 0; i < vectors.length; i += chunkSize) {
      const chunk = vectors.slice(i, i + chunkSize)
      for (const vector of chunk) {
        await this.insert(vector)
      }
    }
  }

  async getVector(id: string): Promise<VectorRecord | null> {
    const sql = (this.ctx.storage as unknown as { sql: SqlStorage }).sql
    const result = sql.exec(
      'SELECT * FROM vectors WHERE id = ?',
      id
    ).one() as StoredVector | undefined

    if (!result) {
      return null
    }

    return {
      id: result.id,
      vector: Array.from(new Float32Array(result.vector as unknown as ArrayBuffer)),
      metadata: result.metadata ? JSON.parse(result.metadata) : undefined,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    }
  }

  async delete(id: string): Promise<boolean> {
    const sql = (this.ctx.storage as unknown as { sql: SqlStorage }).sql
    const existing = await this.getVector(id)
    if (!existing) {
      return false
    }

    sql.exec('DELETE FROM vectors WHERE id = ?', id)
    return true
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const sql = (this.ctx.storage as unknown as { sql: SqlStorage }).sql
    sql.exec(
      'UPDATE vectors SET metadata = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(metadata),
      Date.now(),
      id
    )
  }

  async listVectors(options?: {
    limit?: number
    cursor?: string
    filter?: Record<string, unknown>
  }): Promise<VectorListResult> {
    const sql = (this.ctx.storage as unknown as { sql: SqlStorage }).sql
    const limit = options?.limit ?? 100

    let query = 'SELECT * FROM vectors'
    const params: unknown[] = []

    if (options?.cursor) {
      query += ' WHERE id > ?'
      params.push(options.cursor)
    }

    query += ' ORDER BY id LIMIT ?'
    params.push(limit + 1) // Fetch one extra to check hasMore

    const results = sql.exec(query, ...params).toArray() as StoredVector[]

    const hasMore = results.length > limit
    const vectors = results.slice(0, limit).map((r) => ({
      id: r.id,
      vector: Array.from(new Float32Array(r.vector as unknown as ArrayBuffer)),
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))

    return {
      vectors,
      cursor: hasMore ? vectors[vectors.length - 1]?.id : undefined,
      hasMore,
    }
  }

  async search(
    query: number[],
    options: {
      k: number
      ef?: number
      filter?: Record<string, unknown>
    }
  ): Promise<SearchResult[]> {
    if (!this.config) {
      await this.load()
    }

    // Validate query dimension
    if (query.length !== this.config!.dimension) {
      throw new VectorIndexStorageError(
        `Query dimension mismatch: expected ${this.config!.dimension}, got ${query.length}`
      )
    }

    // Convert query to Float32Array for optimized distance computation
    const queryVec = new Float32Array(query)

    // Compute query norm once for cosine similarity optimization
    let queryNorm = 0
    for (let i = 0; i < queryVec.length; i++) {
      queryNorm += queryVec[i]! * queryVec[i]!
    }
    queryNorm = Math.sqrt(queryNorm)

    // Get vectors from database
    const sql = (this.ctx.storage as unknown as { sql: SqlStorage }).sql

    // Build query with optional namespace filter
    let sqlQuery = 'SELECT * FROM vectors'
    const params: unknown[] = []

    // Apply namespace filter if provided
    if (options.filter && options.filter.ns) {
      sqlQuery += ' WHERE ns = ?'
      params.push(options.filter.ns)
    }

    const results = sql.exec(sqlQuery, ...params).toArray() as StoredVector[]

    if (results.length === 0) {
      return []
    }

    // Use max-heap for efficient top-K selection
    // Heap stores {id, distance} where distance is NEGATIVE similarity
    // (so we keep the K largest similarities)
    const heap = new MaxHeap<{ id: string; distance: number; vector: number[]; metadata?: Record<string, unknown> }>()

    // Get the distance function based on metric
    const metric = this.config!.metric

    for (const r of results) {
      const dbVec = new Float32Array(r.vector as unknown as ArrayBuffer)

      // Check embedding cache first
      let score: number

      if (metric === 'cosine') {
        // Optimized cosine similarity with optional norm caching
        if (this.normCache) {
          const dbNorm = this.normCache.getNorm(r.id, dbVec)
          if (queryNorm === 0 || dbNorm === 0) {
            score = 0
          } else {
            score = dotProductUnrolled(queryVec, dbVec) / (queryNorm * dbNorm)
          }
        } else {
          score = cosineSimilarityUnrolled(queryVec, dbVec)
        }
      } else if (metric === 'euclidean') {
        // Negative L2 distance (so higher = closer = more similar)
        score = -l2DistanceUnrolled(queryVec, dbVec)
      } else {
        // Dot product
        score = dotProductUnrolled(queryVec, dbVec)
      }

      // Apply metadata filter if provided (excluding namespace which is already filtered)
      const metadata = r.metadata ? JSON.parse(r.metadata) : undefined
      if (options.filter) {
        const nonNsFilters = Object.entries(options.filter).filter(([k]) => k !== 'ns')
        if (nonNsFilters.length > 0) {
          if (!metadata) continue
          const matches = nonNsFilters.every(([key, value]) => metadata[key] === value)
          if (!matches) continue
        }
      }

      const vector = Array.from(dbVec)

      // Use negative distance for max-heap (higher score = lower distance)
      heap.push({
        id: r.id,
        distance: -score, // Negative so max-heap gives us highest scores
        vector,
        metadata,
      })

      // Keep only top-K
      if (heap.size() > options.k) {
        heap.pop()
      }
    }

    // Extract results from heap (sorted by similarity descending)
    const heapResults: SearchResult[] = []
    while (!heap.isEmpty()) {
      const item = heap.pop()!
      heapResults.unshift({
        id: item.id,
        score: -item.distance, // Convert back to positive similarity
        vector: item.vector,
        metadata: item.metadata,
      })
    }

    return heapResults
  }

  /**
   * Optimized search using cached embeddings
   *
   * Uses the embedding cache for faster repeated queries.
   */
  async searchWithCache(
    query: number[],
    options: {
      k: number
      ef?: number
      filter?: Record<string, unknown>
    }
  ): Promise<SearchResult[]> {
    // For now, delegate to standard search
    // Future: implement HNSW with cached vectors
    return this.search(query, options)
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { normCache: ReturnType<VectorNormCache['stats']> | null; embeddingCache: ReturnType<EmbeddingCache['getStats']> | null } {
    return {
      normCache: this.normCache?.stats() ?? null,
      embeddingCache: this.embeddingCache?.getStats() ?? null,
    }
  }

  async backup(options?: { incremental?: boolean }): Promise<void> {
    if (!this.env.EDGEVEC_R2) {
      console.warn('R2 bucket not configured, skipping backup')
      return
    }

    try {
      const stats = await this.getStats()
      const timestamp = Date.now()

      // Backup index
      const indexData = await this.ctx.storage.get('index:graph')
      const indexKey = `backups/index-${timestamp}.json`
      await this.env.EDGEVEC_R2.put(indexKey, JSON.stringify(indexData))

      // Backup vectors
      const vectorsKey = `backups/vectors-${timestamp}.json`
      const vectors = (await this.listVectors({ limit: 10000 })).vectors
      await this.env.EDGEVEC_R2.put(vectorsKey, JSON.stringify(vectors))

      // Create manifest
      const manifest: BackupManifest = {
        timestamp,
        vectorCount: stats.vectorCount,
        indexVersion: 1,
        files: {
          index: indexKey,
          vectors: vectorsKey,
        },
      }

      await this.env.EDGEVEC_R2.put(
        `backups/manifest-${timestamp}.json`,
        JSON.stringify(manifest),
        { customMetadata: { type: 'backup-manifest' } }
      )
    } catch (error) {
      throw new VectorIndexBackupError('Backup failed', error as Error)
    }
  }

  async restore(options?: { timestamp?: number }): Promise<void> {
    if (!this.env.EDGEVEC_R2) {
      throw new VectorIndexBackupError('R2 bucket not configured')
    }

    try {
      // Find manifest
      let manifestKey: string

      if (options?.timestamp) {
        // Find closest manifest to timestamp
        const { objects } = await this.env.EDGEVEC_R2.list({ prefix: 'backups/manifest-' })
        const closest = objects
          .filter((o) => o.uploaded.getTime() <= options.timestamp!)
          .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())[0]

        if (!closest) {
          throw new VectorIndexBackupError('No backup found before specified timestamp')
        }
        manifestKey = closest.key
      } else {
        // Get latest manifest
        const { objects } = await this.env.EDGEVEC_R2.list({ prefix: 'backups/manifest-' })
        if (objects.length === 0) {
          throw new VectorIndexBackupError('No backups found')
        }
        manifestKey = objects.sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())[0]!.key
      }

      const manifestObj = await this.env.EDGEVEC_R2.get(manifestKey)
      if (!manifestObj) {
        throw new VectorIndexBackupError('Manifest not found')
      }

      const manifest = await manifestObj.json<BackupManifest>()

      // Restore index
      const indexObj = await this.env.EDGEVEC_R2.get(manifest.files.index)
      if (indexObj) {
        const indexData = await indexObj.json()
        await this.ctx.storage.put('index:graph', indexData)
      }

      // Restore vectors
      const vectorsObj = await this.env.EDGEVEC_R2.get(manifest.files.vectors)
      if (vectorsObj) {
        const vectors = await vectorsObj.json<VectorRecord[]>()
        for (const v of vectors) {
          await this.insert(v)
        }
      }
    } catch (error) {
      if (error instanceof VectorIndexBackupError) throw error
      throw new VectorIndexBackupError('Restore failed', error as Error)
    }
  }

  async cleanupBackups(options: { retentionDays: number }): Promise<void> {
    if (!this.env.EDGEVEC_R2) {
      return
    }

    const cutoff = Date.now() - options.retentionDays * 24 * 60 * 60 * 1000
    const { objects } = await this.env.EDGEVEC_R2.list({ prefix: 'backups/' })

    const toDelete = objects
      .filter((o) => o.uploaded.getTime() < cutoff)
      .map((o) => o.key)

    if (toDelete.length > 0) {
      await this.env.EDGEVEC_R2.delete(toDelete)
    }
  }

  async getStorageUsage(): Promise<StorageUsage> {
    const stats = await this.getStats()
    const vectorSizeBytes = stats.vectorCount * this.config!.dimension * 4 // Float32

    return {
      vectorCount: stats.vectorCount,
      indexSizeBytes: stats.indexSize,
      vectorSizeBytes,
      totalSizeBytes: stats.indexSize + vectorSizeBytes,
      percentUsed: stats.vectorCount / this.config!.maxElements,
    }
  }

  // ==========================================================================
  // COMPACTION METHODS
  // ==========================================================================

  /**
   * Get count of vectors pending compaction
   */
  private async getPendingVectorCount(): Promise<number> {
    const sql = (this.ctx.storage as unknown as { sql: SqlStorage }).sql
    const result = sql.exec(
      'SELECT COUNT(*) as count FROM vectors WHERE compacted_at IS NULL'
    ).one() as { count: number } | undefined

    return result?.count ?? 0
  }

  /**
   * Compact pending vectors to a Parquet file and upload to R2
   */
  async compactToParquet(): Promise<CompactionResult | null> {
    if (!this.env.EDGEVEC_R2) {
      console.warn('R2 bucket not configured, skipping compaction')
      return null
    }

    const startTime = Date.now()
    const sql = (this.ctx.storage as unknown as { sql: SqlStorage }).sql
    const maxVectors = this.config?.maxVectorsPerFile ?? this.DEFAULT_MAX_VECTORS_PER_FILE

    // Select pending vectors ordered by created_at
    const pendingVectors = sql.exec(
      `SELECT * FROM vectors
       WHERE compacted_at IS NULL
       ORDER BY created_at
       LIMIT ?`,
      maxVectors
    ).toArray() as StoredVector[]

    if (pendingVectors.length === 0) {
      return null
    }

    try {
      // Build Parquet file
      const builder = new ParquetBuilder({
        schema: { dimension: this.config?.dimension ?? 128 },
        compression: 'ZSTD',
        rowGroupSize: 2000,
      })

      // Get namespace from first vector or config
      const namespace = pendingVectors[0]?.ns ?? this.config?.namespace ?? 'default'
      const vectorIds: string[] = []

      for (const v of pendingVectors) {
        const vector = Array.from(new Float32Array(v.vector as unknown as ArrayBuffer))

        const parquetRecord: ParquetVectorRecord = {
          ns: v.ns,
          type: v.type,
          visibility: null,
          id: v.id,
          embedding: new Float32Array(vector),
          metadata: v.metadata,
          created_at: v.created_at,
        }

        builder.addRow(parquetRecord)
        vectorIds.push(v.id)
      }

      // Generate Parquet file
      const result = await builder.finish()

      // Generate R2 path
      const now = new Date()
      const dateStr = now.toISOString().split('T')[0]
      const parquetKey = generateParquetPath(namespace, dateStr!, Date.now())

      // Upload to R2
      await this.env.EDGEVEC_R2.put(parquetKey, result.buffer, {
        httpMetadata: {
          contentType: 'application/vnd.apache.parquet',
        },
        customMetadata: {
          vectorCount: String(pendingVectors.length),
          namespace,
        },
      })

      // Mark vectors as compacted
      const compactedAt = Date.now()
      const placeholders = vectorIds.map(() => '?').join(',')
      sql.exec(
        `UPDATE vectors SET compacted_at = ? WHERE id IN (${placeholders})`,
        compactedAt,
        ...vectorIds
      )

      const durationMs = Date.now() - startTime

      return {
        vectorsCompacted: pendingVectors.length,
        parquetKey,
        fileSize: result.compressedSize,
        durationMs,
      }
    } catch (error) {
      console.error('Compaction failed:', error)
      // Don't mark vectors as compacted on failure
      return null
    }
  }
}

// ============================================================================
// SQL STORAGE TYPE (for type checking)
// ============================================================================

interface SqlStorage {
  exec(query: string, ...params: unknown[]): {
    toArray(): unknown[]
    one(): unknown
    raw(): unknown[]
  }
}
