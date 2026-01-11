/**
 * EdgeVecDO - Durable Object for HNSW vector index persistence
 *
 * Provides:
 * - HNSW index persistence to DO KV storage
 * - Vector storage in SQLite
 * - Index recovery on DO wake
 * - Background compaction to R2 Parquet files
 * - Incremental backup to R2
 * - Storage limits and pagination
 */

import {
  ParquetBuilder,
  generateParquetPath,
  type VectorRecord as ParquetVectorRecord,
} from '../parquet'

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export interface EdgeVecConfig {
  dimension: number
  metric: 'cosine' | 'euclidean' | 'dot'
  efConstruction: number
  M: number
  maxElements: number
  autoBackup?: boolean
  backupInterval?: number
  /** Threshold for triggering compaction (default: 1000, 0 to disable) */
  compactionThreshold?: number
  /** Maximum vectors per Parquet file (default: 10000) */
  maxVectorsPerFile?: number
  /** Alarm check interval in ms (default: 60000 - 1 minute) */
  checkInterval?: number
  /** Namespace for vectors (used in partition path) */
  namespace?: string
}

export interface VectorRecord {
  id: string
  vector: number[]
  metadata?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
}

export interface IndexStats {
  vectorCount: number
  dimension: number
  indexSize: number
  lastUpdated: number
}

export interface BackupManifest {
  timestamp: number
  vectorCount: number
  indexVersion: number
  files: {
    index: string
    vectors: string
  }
}

export interface StorageUsage {
  vectorCount: number
  indexSizeBytes: number
  vectorSizeBytes: number
  totalSizeBytes: number
  percentUsed: number
}

export interface VectorListResult {
  vectors: VectorRecord[]
  cursor?: string
  hasMore: boolean
}

export interface SearchResult {
  id: string
  score: number
  vector: number[]
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

export class EdgeVecStorageError extends Error {
  constructor(
    message: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'EdgeVecStorageError'
  }
}

export class EdgeVecIndexError extends Error {
  constructor(
    message: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'EdgeVecIndexError'
  }
}

export class EdgeVecBackupError extends Error {
  constructor(
    message: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'EdgeVecBackupError'
  }
}

// ============================================================================
// ENVIRONMENT INTERFACE
// ============================================================================

interface EdgeVecEnv {
  EDGEVEC_R2?: R2Bucket
  AI?: Fetcher
}

// ============================================================================
// EDGEVEC DURABLE OBJECT
// ============================================================================

export class EdgeVecDO {
  private config: EdgeVecConfig | null = null
  private initialized: boolean = false

  // Default compaction settings
  private readonly DEFAULT_COMPACTION_THRESHOLD = 1000
  private readonly DEFAULT_MAX_VECTORS_PER_FILE = 10000
  private readonly DEFAULT_CHECK_INTERVAL = 60000 // 1 minute

  constructor(
    private ctx: DurableObjectState,
    private env: EdgeVecEnv
  ) {}

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

  async initialize(config: EdgeVecConfig): Promise<void> {
    try {
      this.config = config

      // Store config
      await this.ctx.storage.put('config', config)

      // Initialize SQLite schema with compacted_at column
      await this.initializeSchema()

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
      throw new EdgeVecStorageError('Failed to initialize EdgeVecDO', error as Error)
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
    const storedConfig = await this.ctx.storage.get<EdgeVecConfig>('config')

    if (!storedConfig) {
      throw new EdgeVecIndexError('No configuration found')
    }

    this.config = storedConfig

    // Load index graph
    const graph = await this.ctx.storage.get('index:graph')
    if (graph !== undefined && graph !== null && typeof graph !== 'object') {
      throw new EdgeVecIndexError('Invalid index graph data')
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
      throw new EdgeVecStorageError(
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
        throw new EdgeVecStorageError(
          `Vector dimension mismatch: expected ${this.config!.dimension}, got ${vector.vector.length}`
        )
      }
    }

    // Check storage limit
    const currentCount = (await this.getStats()).vectorCount
    if (currentCount + vectors.length > this.config!.maxElements) {
      throw new EdgeVecStorageError(
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
      throw new EdgeVecStorageError(
        `Query dimension mismatch: expected ${this.config!.dimension}, got ${query.length}`
      )
    }

    // Get all vectors for brute force search (TODO: implement HNSW)
    const sql = (this.ctx.storage as unknown as { sql: SqlStorage }).sql
    const results = sql.exec('SELECT * FROM vectors').toArray() as StoredVector[]

    if (results.length === 0) {
      return []
    }

    // Calculate distances and sort
    const scored = results
      .map((r) => {
        const vector = Array.from(new Float32Array(r.vector as unknown as ArrayBuffer))
        const score = this.cosineSimilarity(query, vector)
        return {
          id: r.id,
          score,
          vector,
          metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, options.k)

    // Apply metadata filter if provided
    if (options.filter) {
      return scored.filter((r) => {
        if (!r.metadata) return false
        return Object.entries(options.filter!).every(
          ([key, value]) => r.metadata![key] === value
        )
      })
    }

    return scored
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
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
      throw new EdgeVecBackupError('Backup failed', error as Error)
    }
  }

  async restore(options?: { timestamp?: number }): Promise<void> {
    if (!this.env.EDGEVEC_R2) {
      throw new EdgeVecBackupError('R2 bucket not configured')
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
          throw new EdgeVecBackupError('No backup found before specified timestamp')
        }
        manifestKey = closest.key
      } else {
        // Get latest manifest
        const { objects } = await this.env.EDGEVEC_R2.list({ prefix: 'backups/manifest-' })
        if (objects.length === 0) {
          throw new EdgeVecBackupError('No backups found')
        }
        manifestKey = objects.sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())[0].key
      }

      const manifestObj = await this.env.EDGEVEC_R2.get(manifestKey)
      if (!manifestObj) {
        throw new EdgeVecBackupError('Manifest not found')
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
      if (error instanceof EdgeVecBackupError) throw error
      throw new EdgeVecBackupError('Restore failed', error as Error)
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
      const parquetKey = generateParquetPath(namespace, dateStr, Date.now())

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
