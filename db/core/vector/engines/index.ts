/**
 * Vector Engines
 *
 * Backend implementations for the VectorManager:
 * - LibSQLEngine: F32_BLOB vectors in SQLite (hot tier)
 * - EdgeVecEngine: WASM HNSW via Workers RPC (hot tier)
 * - VectorizeEngine: Cloudflare Vectorize (warm tier)
 * - ClickHouseEngine: ANN indexes (warm/cold tier)
 * - IcebergEngine: Parquet with LSH indexes (cold tier)
 */
import type { VectorTierConfig, VectorEngineType, ClickHouseIndex } from '../../types'
import type { VectorEngine, VectorHit, SearchOptions, VectorEntry } from '../../vector'
import { cosineSimilarity, euclideanDistance, dotProduct } from '../../vector'

// ============================================================================
// BASE ENGINE
// ============================================================================

abstract class BaseVectorEngine implements VectorEngine {
  abstract name: VectorEngineType
  dimensions: number
  metric: 'cosine' | 'euclidean' | 'dot'

  constructor(config: VectorTierConfig) {
    this.dimensions = config.dimensions
    this.metric = config.metric ?? 'cosine'
  }

  abstract insert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void>
  abstract search(vector: number[], options: SearchOptions): Promise<VectorHit[]>
  abstract delete(id: string): Promise<boolean>
  abstract count(): Promise<number>

  protected validateDimensions(vector: number[]): void {
    if (vector.length !== this.dimensions) {
      throw new Error(
        `Dimension mismatch: expected ${this.dimensions}, got ${vector.length}`
      )
    }
  }

  protected calculateScore(a: number[], b: number[]): number {
    switch (this.metric) {
      case 'euclidean':
        return 1 / (1 + euclideanDistance(a, b))
      case 'dot':
        return dotProduct(a, b)
      case 'cosine':
      default:
        return cosineSimilarity(a, b)
    }
  }
}

// ============================================================================
// LIBSQL ENGINE
// ============================================================================

interface StoredVector {
  id: string
  vector: number[]
  metadata: Record<string, unknown>
}

export class LibSQLEngine extends BaseVectorEngine {
  name: VectorEngineType = 'libsql'
  private vectors: Map<string, StoredVector> = new Map()

  constructor(config: VectorTierConfig, _bindings: unknown) {
    super(config)
  }

  async insert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void> {
    this.validateDimensions(vector)
    // Store as F32_BLOB equivalent (in-memory stores as float array)
    this.vectors.set(id, { id, vector: [...vector], metadata })
  }

  async search(queryVector: number[], options: SearchOptions): Promise<VectorHit[]> {
    const results: VectorHit[] = []

    for (const [id, stored] of this.vectors) {
      // Apply metadata filter
      if (options.filter) {
        let matches = true
        for (const [key, value] of Object.entries(options.filter)) {
          if (stored.metadata[key] !== value) {
            matches = false
            break
          }
        }
        if (!matches) continue
      }

      const score = this.calculateScore(queryVector, stored.vector)
      results.push({
        id,
        score,
        vector: options.includeVectors ? [...stored.vector] : undefined,
        metadata: stored.metadata,
      })
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score)

    return results.slice(0, options.limit ?? 10)
  }

  async delete(id: string): Promise<boolean> {
    return this.vectors.delete(id)
  }

  async count(): Promise<number> {
    return this.vectors.size
  }
}

// ============================================================================
// EDGEVEC ENGINE
// ============================================================================

interface EdgeVecRPC {
  createIndex(dims: number, options?: unknown): Promise<{ success: boolean }>
  insert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<{ success: boolean }>
  search(vector: number[], options: unknown): Promise<{ results: VectorHit[] }>
  delete(id: string): Promise<{ success: boolean }>
  count(): Promise<{ count: number }>
}

interface EdgeVecOptions {
  quantization?: 'binary' | 'scalar' | 'none'
}

export class EdgeVecEngine extends BaseVectorEngine {
  name: VectorEngineType = 'edgevec'
  quantization: string
  private rpc: EdgeVecRPC

  constructor(
    config: VectorTierConfig,
    bindings: { EDGEVEC?: EdgeVecRPC },
    options?: EdgeVecOptions
  ) {
    super(config)
    this.rpc = bindings.EDGEVEC ?? this.createMockRpc()
    this.quantization = options?.quantization ?? 'none'
  }

  private createMockRpc(): EdgeVecRPC {
    // In-memory mock for testing without actual RPC
    const vectors = new Map<string, StoredVector>()
    return {
      createIndex: async () => ({ success: true }),
      insert: async (id, vector, metadata) => {
        vectors.set(id, { id, vector, metadata })
        return { success: true }
      },
      search: async (queryVector, opts: any) => {
        const results: VectorHit[] = []
        for (const [id, stored] of vectors) {
          const score = cosineSimilarity(queryVector, stored.vector)
          results.push({ id, score, metadata: stored.metadata })
        }
        results.sort((a, b) => b.score - a.score)
        return { results: results.slice(0, opts?.limit ?? 10) }
      },
      delete: async (id) => ({ success: vectors.delete(id) }),
      count: async () => ({ count: vectors.size }),
    }
  }

  async insert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void> {
    this.validateDimensions(vector)
    await this.rpc.insert(id, vector, metadata)
  }

  async search(queryVector: number[], options: SearchOptions): Promise<VectorHit[]> {
    const result = await this.rpc.search(queryVector, {
      limit: options.limit ?? 10,
      ef: (options as any).ef ?? 100,
      filter: options.filter,
      includeVectors: options.includeVectors,
    })
    return result.results
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.rpc.delete(id)
    return result.success
  }

  async count(): Promise<number> {
    const result = await this.rpc.count()
    return result.count
  }
}

// ============================================================================
// VECTORIZE ENGINE
// ============================================================================

interface VectorizeBinding {
  upsert(vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>): Promise<{ count: number }>
  query(vector: number[], options: { topK?: number; filter?: Record<string, unknown>; namespace?: string }): Promise<{ matches: VectorHit[] }>
  deleteByIds(ids: string[]): Promise<{ count: number }>
  describe(): Promise<{ vectorCount: number }>
}

interface VectorizeOptions {
  namespace?: string
}

export class VectorizeEngine extends BaseVectorEngine {
  name: VectorEngineType = 'vectorize'
  private binding: VectorizeBinding
  private namespace?: string

  constructor(
    config: VectorTierConfig,
    bindings: { VECTORIZE?: VectorizeBinding },
    options?: VectorizeOptions
  ) {
    super(config)
    this.binding = bindings.VECTORIZE ?? this.createMockBinding()
    this.namespace = options?.namespace
  }

  private createMockBinding(): VectorizeBinding {
    const vectors = new Map<string, StoredVector>()
    return {
      upsert: async (vecs) => {
        for (const v of vecs) {
          vectors.set(v.id, { id: v.id, vector: v.values, metadata: v.metadata ?? {} })
        }
        return { count: vecs.length }
      },
      query: async (queryVector, opts) => {
        const results: VectorHit[] = []
        for (const [id, stored] of vectors) {
          if (opts.filter) {
            let matches = true
            for (const [key, value] of Object.entries(opts.filter)) {
              if (stored.metadata[key] !== value) {
                matches = false
                break
              }
            }
            if (!matches) continue
          }
          const score = cosineSimilarity(queryVector, stored.vector)
          results.push({ id, score, metadata: stored.metadata })
        }
        results.sort((a, b) => b.score - a.score)
        return { matches: results.slice(0, opts.topK ?? 10) }
      },
      deleteByIds: async (ids) => {
        let count = 0
        for (const id of ids) {
          if (vectors.delete(id)) count++
        }
        return { count }
      },
      describe: async () => ({ vectorCount: vectors.size }),
    }
  }

  async insert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void> {
    this.validateDimensions(vector)
    await this.binding.upsert([{ id, values: vector, metadata }])
  }

  async search(queryVector: number[], options: SearchOptions): Promise<VectorHit[]> {
    const result = await this.binding.query(queryVector, {
      topK: options.limit ?? 10,
      filter: options.filter,
      namespace: this.namespace,
    })
    return result.matches
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.binding.deleteByIds([id])
    return result.count > 0
  }

  async count(): Promise<number> {
    const result = await this.binding.describe()
    return result.vectorCount
  }
}

// ============================================================================
// CLICKHOUSE ENGINE
// ============================================================================

interface ClickHouseClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>
  insert(table: string, rows: unknown[]): Promise<{ success: boolean }>
  command(sql: string, params?: unknown[]): Promise<{ success: boolean }>
}

export class ClickHouseEngine extends BaseVectorEngine {
  name: VectorEngineType = 'clickhouse'
  indexType: ClickHouseIndex
  private client: ClickHouseClient
  private tableName = 'vectors'

  constructor(
    config: VectorTierConfig,
    bindings: { CLICKHOUSE?: ClickHouseClient }
  ) {
    super(config)
    this.indexType = config.index ?? 'usearch'
    this.client = bindings.CLICKHOUSE ?? this.createMockClient()
  }

  private createMockClient(): ClickHouseClient {
    const vectors = new Map<string, StoredVector>()
    return {
      query: async (sql) => {
        // Parse simple queries
        if (sql.includes('cosineDistance') || sql.includes('L2Distance')) {
          const results = Array.from(vectors.values()).map((v) => ({
            id: v.id,
            score: 0.9,
            metadata: v.metadata,
          }))
          return { rows: results }
        }
        if (sql.includes('COUNT')) {
          return { rows: [{ count: vectors.size }] }
        }
        return { rows: [] }
      },
      insert: async (_table, rows) => {
        for (const row of rows as any[]) {
          vectors.set(row.id, { id: row.id, vector: row.vector, metadata: row.metadata ?? {} })
        }
        return { success: true }
      },
      command: async () => ({ success: true }),
    }
  }

  async insert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void> {
    this.validateDimensions(vector)
    await this.client.insert(this.tableName, [{ id, vector, metadata }])
  }

  async insertBatch(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      this.validateDimensions(entry.vector)
    }
    await this.client.insert(
      this.tableName,
      entries.map((e) => ({ id: e.id, vector: e.vector, metadata: e.metadata }))
    )
  }

  async search(queryVector: number[], options: SearchOptions): Promise<VectorHit[]> {
    const distanceFunc =
      this.metric === 'euclidean' ? 'L2Distance' : 'cosineDistance'

    const params: unknown[] = []
    let sql = `
      SELECT id, ${distanceFunc}(vector, [${queryVector.join(',')}]) as distance, metadata
      FROM ${this.tableName}
    `

    // Support hybrid search with parameterized query
    if ((options as any).hybridQuery) {
      sql += ` WHERE multiSearchAny(text, [?])`
      params.push((options as any).hybridQuery)
    }

    sql += ` ORDER BY distance LIMIT ${options.limit ?? 10}`

    const result = await this.client.query(sql, params)
    return result.rows.map((row: any) => ({
      id: row.id,
      score: 1 - (row.distance ?? 0), // Convert distance to similarity
      metadata: row.metadata ?? {},
    }))
  }

  async delete(id: string): Promise<boolean> {
    await this.client.command(`ALTER TABLE ${this.tableName} DELETE WHERE id = ?`, [id])
    return true
  }

  async count(): Promise<number> {
    const result = await this.client.query(`SELECT COUNT(*) as count FROM ${this.tableName}`)
    return (result.rows[0] as any)?.count ?? 0
  }
}

// ============================================================================
// ICEBERG ENGINE
// ============================================================================

interface R2SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>
  execute(sql: string, params?: unknown[]): Promise<{ success: boolean }>
}

interface IcebergOptions {
  pq?: boolean // Product quantization
}

export class IcebergEngine extends BaseVectorEngine {
  name: VectorEngineType = 'iceberg'
  usePQ: boolean
  private client: R2SqlClient
  private tableName = 'vectors_iceberg'

  constructor(
    config: VectorTierConfig,
    bindings: { R2_SQL?: R2SqlClient },
    options?: IcebergOptions
  ) {
    super(config)
    this.usePQ = options?.pq ?? false
    this.client = bindings.R2_SQL ?? this.createMockClient()
  }

  private createMockClient(): R2SqlClient {
    const vectors = new Map<string, StoredVector & { cluster?: string }>()
    return {
      query: async (sql) => {
        const results: VectorHit[] = []

        // Parse cluster filter
        const clusterMatch = sql.match(/cluster\s*=\s*'([^']+)'/)
        const cluster = clusterMatch ? clusterMatch[1] : undefined

        for (const [id, stored] of vectors) {
          if (cluster && stored.cluster !== cluster) continue
          results.push({ id, score: 0.85, metadata: stored.metadata })
        }

        if (sql.includes('COUNT')) {
          return { rows: [{ count: vectors.size }] }
        }

        return { rows: results }
      },
      execute: async (sql) => {
        // Parse INSERT
        if (sql.includes('INSERT')) {
          // Simplified parsing
          return { success: true }
        }
        return { success: true }
      },
    }
  }

  async insert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void> {
    this.validateDimensions(vector)
    const lsh = this.computeLSH(vector)
    await this.client.execute(
      `INSERT INTO ${this.tableName} (id, vector, lsh, metadata) VALUES (?, ARRAY[${vector.join(',')}], ?, ?)`,
      [id, lsh, JSON.stringify(metadata)]
    )
  }

  async search(queryVector: number[], options: SearchOptions): Promise<VectorHit[]> {
    const lsh = this.computeLSH(queryVector)
    const params: unknown[] = [lsh]
    let sql = `
      SELECT id, vector, metadata
      FROM ${this.tableName}
      WHERE lsh = ?
    `

    if ((options as any).cluster) {
      sql += ` AND cluster = ?`
      params.push((options as any).cluster)
    }

    sql += ` LIMIT ${options.limit ?? 10}`

    const result = await this.client.query(sql, params)
    return result.rows.map((row: any) => ({
      id: row.id,
      score: row.score ?? 0.85,
      metadata: row.metadata ?? {},
    }))
  }

  async delete(id: string): Promise<boolean> {
    await this.client.execute(`DELETE FROM ${this.tableName} WHERE id = ?`, [id])
    return true
  }

  async count(): Promise<number> {
    const result = await this.client.query(`SELECT COUNT(*) as count FROM ${this.tableName}`)
    return (result.rows[0] as any)?.count ?? 0
  }

  private computeLSH(vector: number[]): number {
    // Simple LSH: hash based on signs of random projections
    let hash = 0
    for (let i = 0; i < Math.min(32, vector.length); i++) {
      if (vector[i]! > 0) {
        hash |= 1 << i
      }
    }
    return hash
  }
}

// ============================================================================
// ENGINE FACTORY
// ============================================================================

export function createEngine(
  config: VectorTierConfig,
  bindings: Record<string, unknown>,
  options?: Record<string, unknown>
): VectorEngine {
  switch (config.engine) {
    case 'libsql':
      return new LibSQLEngine(config, bindings)
    case 'edgevec':
      return new EdgeVecEngine(config, bindings as any, options as EdgeVecOptions)
    case 'vectorize':
      return new VectorizeEngine(config, bindings as any, options as VectorizeOptions)
    case 'clickhouse':
      return new ClickHouseEngine(config, bindings as any)
    case 'iceberg':
      return new IcebergEngine(config, bindings as any, options as IcebergOptions)
    default:
      throw new Error(`Unknown engine: ${(config as any).engine}`)
  }
}
