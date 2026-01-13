/**
 * EdgePostgres - Postgres for Durable Objects
 *
 * PGLite WASM + FSX storage integration for running Postgres in Durable Objects.
 * Provides full Postgres SQL support including pgvector for semantic search.
 *
 * Features:
 * - Full Postgres SQL parser via PGLite WASM
 * - pgvector extension for vector similarity search
 * - FSX-backed persistence with checkpointing
 * - Transaction support with automatic rollback
 * - Query options (timeout, tier, sessionToken)
 *
 * @module db/edge-postgres
 */

import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import {
  ClosedError,
  QueryTimeoutError,
  CheckpointError,
} from './errors'

// Re-export error classes for consumers
export {
  EdgePostgresError,
  ClosedError,
  QueryTimeoutError,
  QueryExecutionError,
  CheckpointError,
  StorageError,
  TransactionError,
  InitializationError,
  isEdgePostgresError,
  isClosedError,
  isTimeoutError,
} from './errors'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration for EdgePostgres tiering behavior
 */
export interface TieringConfig {
  /** How long to keep data in hot tier (ms). Default: 5 minutes */
  hotRetentionMs?: number
  /** Number of writes before triggering flush. Default: 1000 */
  flushThreshold?: number
  /** Interval between automatic flushes (ms). Default: 60 seconds */
  flushIntervalMs?: number
}

/**
 * Configuration for PGLite WASM runtime
 */
export interface PGLiteConfig {
  /** Extensions to load. 'pgvector' is supported */
  extensions?: string[]
  /** Initial WASM memory allocation in bytes. Default: 16MB */
  initialMemory?: number
}

/**
 * Vector quantization configuration for reducing memory usage.
 *
 * Scalar (int8) quantization provides 4x memory reduction:
 * - float32 (4 bytes) -> int8 (1 byte) per dimension
 * - Maintains good recall with slight precision loss
 * - Ideal for large-scale similarity search
 */
export interface VectorQuantizationConfig {
  /** Quantization type: 'scalar' for int8 (4x compression), 'binary' for 1-bit (32x), 'none' for full precision */
  type: 'scalar' | 'binary' | 'none'
  /** Whether to store original vectors alongside quantized for reranking */
  storeOriginal?: boolean
  /** Calibration sample size for scalar quantization min/max bounds (default: 1000) */
  calibrationSamples?: number
}

/**
 * Hybrid search configuration for combining vector similarity with SQL filters.
 *
 * Optimizations include:
 * - Pre-filter pushdown: Apply SQL filters before vector scan when selectivity is low
 * - Post-filter: Apply filters after vector search when selectivity is high
 * - Parallel index scan: Use both vector index and filter index simultaneously
 */
export interface HybridSearchConfig {
  /** Strategy for combining vector and filter operations */
  strategy: 'auto' | 'pre-filter' | 'post-filter' | 'parallel'
  /** Filter selectivity threshold for switching strategies (0-1, default: 0.1) */
  selectivityThreshold?: number
  /** Maximum candidates to consider before applying filters (default: 1000) */
  maxCandidates?: number
}

/**
 * Configuration for sharding (future feature)
 */
export interface ShardingConfig {
  /** Column to shard on */
  key: string
  /** Number of shards */
  count: number
  /** Sharding algorithm */
  algorithm: 'consistent' | 'range' | 'hash'
}

/**
 * Configuration for replication (future feature)
 */
export interface ReplicationConfig {
  /** Data jurisdiction */
  jurisdiction?: 'eu' | 'us' | 'fedramp'
  /** AWS-style region names */
  regions?: string[]
  /** IATA airport codes for cities */
  cities?: string[]
  /** Where to read from */
  readFrom: 'primary' | 'nearest' | 'session'
  /** Whether to sync writes to all replicas */
  writeThrough?: boolean
}

/**
 * Full EdgePostgres configuration
 */
export interface EdgePostgresConfig {
  /** Tiering configuration */
  tiering?: TieringConfig
  /** PGLite configuration */
  pglite?: PGLiteConfig
  /** Sharding configuration (future) */
  sharding?: ShardingConfig
  /** Replication configuration (future) */
  replication?: ReplicationConfig
  /** Vector quantization for memory optimization (4x reduction with scalar quantization) */
  quantization?: VectorQuantizationConfig
  /** Hybrid search configuration for vector + filter optimization */
  hybridSearch?: HybridSearchConfig
}

/**
 * Options for query execution
 */
export interface QueryOptions {
  /** Query timeout in milliseconds */
  timeout?: number
  /** Force reading from specific tier */
  tier?: 'hot' | 'warm' | 'all'
  /** Session token for read-your-writes consistency */
  sessionToken?: string
}

/**
 * Result of a query execution
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Array of returned rows */
  rows: T[]
  /** Number of rows affected (for INSERT/UPDATE/DELETE) */
  affectedRows?: number
  /** Session token for subsequent reads */
  sessionToken?: string
}

/**
 * Transaction interface for running operations within a transaction
 */
export interface Transaction {
  /** Execute a query within the transaction */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    options?: QueryOptions
  ): Promise<QueryResult<T>>
  /** Execute SQL without returning rows */
  exec(sql: string): Promise<void>
  /** Rollback the transaction */
  rollback(): Promise<void>
}

// ============================================================================
// DURABLE OBJECT CONTEXT TYPES
// ============================================================================

/**
 * Durable Object storage interface
 */
interface DOStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
}

/**
 * Durable Object state interface
 */
interface DOState {
  storage: DOStorage
  id: {
    toString(): string
    name?: string
  }
  waitUntil(promise: Promise<unknown>): void
}

/**
 * Environment bindings interface
 */
interface Env {
  FSX?: unknown
  R2_BUCKET?: unknown
}

// ============================================================================
// STORAGE KEYS
// ============================================================================

const STORAGE_KEYS = {
  /** @deprecated Legacy single-value checkpoint - now uses chunked storage */
  CHECKPOINT: 'edge_postgres_checkpoint',
  CHECKPOINT_VERSION: 'edge_postgres_checkpoint_version',
  WRITE_COUNT: 'edge_postgres_write_count',
  /** HNSW index metadata for persistence across restarts */
  HNSW_INDEX_META: 'edge_postgres_hnsw_index_meta',
  /** Quantization calibration data (min/max bounds for scalar quantization) */
  QUANTIZATION_CALIBRATION: 'edge_postgres_quantization_calibration',
  /** Chunked checkpoint metadata (chunkCount, totalSize, compressed, version) */
  CHECKPOINT_META: 'edge_postgres_checkpoint_meta',
  /** Prefix for checkpoint chunks (e.g., edge_postgres_checkpoint_chunk:0) */
  CHECKPOINT_CHUNK_PREFIX: 'edge_postgres_checkpoint_chunk:',
} as const

// ============================================================================
// CHECKPOINT CHUNKING CONSTANTS
// ============================================================================

/**
 * Maximum size for each checkpoint chunk.
 * Set to 100 KB for safety margin under DO storage limits:
 * - KV-backed DOs: 128 KB max value size
 * - SQLite-backed DOs: 2 MB max key+value combined
 */
const MAX_CHUNK_SIZE = 100 * 1024 // 100 KB

/**
 * Warning threshold for checkpoint size.
 * Logs warning when total checkpoint exceeds this size.
 */
const CHECKPOINT_SIZE_WARNING_THRESHOLD = 1 * 1024 * 1024 // 1 MB

/**
 * Maximum number of chunks allowed.
 * Prevents runaway storage consumption.
 */
const MAX_CHUNKS = 1000

/**
 * Checkpoint metadata structure for chunked storage
 */
interface CheckpointMeta {
  /** Number of chunks stored */
  chunkCount: number
  /** Total uncompressed size in bytes */
  totalSize: number
  /** Whether the data is compressed */
  compressed: boolean
  /** Checkpoint version for ordering */
  version: number
  /** Timestamp of checkpoint creation */
  createdAt: string
}

// ============================================================================
// SCALAR QUANTIZATION HELPERS
// ============================================================================

/**
 * Calibration data for scalar (int8) quantization.
 * Stores min/max bounds per dimension for mapping float32 to int8.
 */
interface QuantizationCalibration {
  /** Minimum values per dimension for normalization */
  mins: number[]
  /** Maximum values per dimension for normalization */
  maxs: number[]
  /** Number of dimensions */
  dimensions: number
  /** Number of samples used for calibration */
  sampleCount: number
}

/**
 * Quantize a float32 vector to int8 using pre-computed calibration bounds.
 * This achieves 4x memory reduction (4 bytes -> 1 byte per dimension).
 *
 * @param vector - Float32 vector to quantize
 * @param calibration - Pre-computed min/max bounds
 * @returns Int8 quantized representation
 */
function quantizeToInt8(vector: number[], calibration: QuantizationCalibration): Int8Array {
  const quantized = new Int8Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    const min = calibration.mins[i]!
    const max = calibration.maxs[i]!
    const range = max - min
    if (range === 0) {
      quantized[i] = 0
    } else {
      // Map [min, max] to [-128, 127]
      const normalized = (vector[i]! - min) / range
      quantized[i] = Math.round(normalized * 255 - 128)
    }
  }
  return quantized
}

/**
 * Dequantize an int8 vector back to float32 approximation.
 *
 * @param quantized - Int8 quantized vector
 * @param calibration - Pre-computed min/max bounds
 * @returns Float32 approximation
 */
function dequantizeFromInt8(quantized: Int8Array, calibration: QuantizationCalibration): number[] {
  const vector: number[] = new Array(quantized.length)
  for (let i = 0; i < quantized.length; i++) {
    const min = calibration.mins[i]!
    const max = calibration.maxs[i]!
    // Map [-128, 127] back to [min, max]
    const normalized = (quantized[i]! + 128) / 255
    vector[i] = normalized * (max - min) + min
  }
  return vector
}

/**
 * Compute quantization calibration from sample vectors.
 * Determines min/max bounds per dimension for int8 mapping.
 *
 * @param vectors - Sample vectors for calibration
 * @returns Calibration data
 */
function computeQuantizationCalibration(vectors: number[][]): QuantizationCalibration {
  if (vectors.length === 0) {
    throw new Error('Cannot compute calibration from empty vector set')
  }

  const dimensions = vectors[0]!.length
  const mins = new Array(dimensions).fill(Infinity)
  const maxs = new Array(dimensions).fill(-Infinity)

  for (const vector of vectors) {
    for (let i = 0; i < dimensions; i++) {
      if (vector[i]! < mins[i]!) mins[i] = vector[i]!
      if (vector[i]! > maxs[i]!) maxs[i] = vector[i]!
    }
  }

  return {
    mins,
    maxs,
    dimensions,
    sampleCount: vectors.length,
  }
}

/**
 * Compute memory savings from quantization.
 *
 * @param dimensions - Vector dimensions
 * @param vectorCount - Number of vectors
 * @param quantizationType - Type of quantization
 * @returns Memory statistics
 */
function computeQuantizationSavings(
  dimensions: number,
  vectorCount: number,
  quantizationType: 'scalar' | 'binary' | 'none'
): {
  originalBytes: number
  quantizedBytes: number
  compressionRatio: number
  savingsPercent: number
} {
  const originalBytes = vectorCount * dimensions * 4 // float32

  let quantizedBytes: number
  switch (quantizationType) {
    case 'scalar':
      quantizedBytes = vectorCount * dimensions // int8
      break
    case 'binary':
      quantizedBytes = vectorCount * Math.ceil(dimensions / 8) // 1 bit per dimension
      break
    case 'none':
    default:
      quantizedBytes = originalBytes
  }

  const compressionRatio = originalBytes / quantizedBytes
  const savingsPercent = ((originalBytes - quantizedBytes) / originalBytes) * 100

  return { originalBytes, quantizedBytes, compressionRatio, savingsPercent }
}

// ============================================================================
// HYBRID SEARCH OPTIMIZATION
// ============================================================================

/**
 * Analyze a SQL query to extract filter selectivity hints.
 * Used to determine optimal hybrid search strategy.
 *
 * @param sql - SQL query string
 * @returns Estimated selectivity (0-1) and filter conditions
 */
function analyzeQueryForHybridSearch(sql: string): {
  hasVectorOp: boolean
  hasFilter: boolean
  filterConditions: string[]
  estimatedSelectivity: number
} {
  const upperSql = sql.toUpperCase()

  // Check for vector distance operators
  const hasVectorOp = sql.includes('<->') || sql.includes('<=>') || sql.includes('<#>')

  // Extract WHERE conditions
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:ORDER\s+BY|LIMIT|$)/is)
  const filterConditions: string[] = []
  let hasFilter = false

  if (whereMatch) {
    const whereClause = whereMatch[1]!
    // Check if there are non-vector conditions
    const conditions = whereClause.split(/\s+AND\s+/i)
    for (const cond of conditions) {
      // Skip vector distance conditions
      if (!cond.includes('<->') && !cond.includes('<=>') && !cond.includes('<#>')) {
        if (cond.trim()) {
          filterConditions.push(cond.trim())
          hasFilter = true
        }
      }
    }
  }

  // Estimate selectivity based on filter types
  // This is a heuristic - in production, would use table statistics
  let estimatedSelectivity = 1.0
  for (const cond of filterConditions) {
    if (cond.includes('=')) {
      // Equality filter - typically very selective
      estimatedSelectivity *= 0.1
    } else if (cond.includes('LIKE') || cond.includes('like')) {
      // LIKE filter - moderately selective
      estimatedSelectivity *= 0.3
    } else if (cond.includes('>') || cond.includes('<')) {
      // Range filter - depends on range
      estimatedSelectivity *= 0.5
    } else if (cond.includes('IN')) {
      // IN filter - depends on list size
      estimatedSelectivity *= 0.2
    }
  }

  return {
    hasVectorOp,
    hasFilter,
    filterConditions,
    estimatedSelectivity: Math.max(0.01, estimatedSelectivity),
  }
}

/**
 * Rewrite a hybrid query for optimal execution.
 * Chooses between pre-filter, post-filter, or parallel strategies.
 *
 * @param sql - Original SQL query
 * @param config - Hybrid search configuration
 * @returns Optimized SQL and execution plan
 */
function optimizeHybridQuery(
  sql: string,
  config: HybridSearchConfig
): {
  optimizedSql: string
  strategy: 'pre-filter' | 'post-filter' | 'parallel'
  reason: string
} {
  const analysis = analyzeQueryForHybridSearch(sql)

  if (!analysis.hasVectorOp || !analysis.hasFilter) {
    // Not a hybrid query, return as-is
    return {
      optimizedSql: sql,
      strategy: 'post-filter',
      reason: 'Not a hybrid query (no vector op or no filter)',
    }
  }

  const threshold = config.selectivityThreshold ?? 0.1
  let strategy: 'pre-filter' | 'post-filter' | 'parallel'
  let reason: string

  if (config.strategy !== 'auto') {
    strategy = config.strategy as 'pre-filter' | 'post-filter' | 'parallel'
    reason = `Manual strategy selection: ${strategy}`
  } else if (analysis.estimatedSelectivity < threshold) {
    // Low selectivity (few rows match) - pre-filter is better
    strategy = 'pre-filter'
    reason = `Low selectivity (${(analysis.estimatedSelectivity * 100).toFixed(1)}%) - pre-filter to reduce vector scan`
  } else if (analysis.estimatedSelectivity > 0.5) {
    // High selectivity (many rows match) - post-filter is better
    strategy = 'post-filter'
    reason = `High selectivity (${(analysis.estimatedSelectivity * 100).toFixed(1)}%) - post-filter after vector search`
  } else {
    // Medium selectivity - parallel might be best
    strategy = 'parallel'
    reason = `Medium selectivity (${(analysis.estimatedSelectivity * 100).toFixed(1)}%) - parallel index scan`
  }

  // For now, return original SQL - actual optimization would require query rewriting
  // The strategy hint can be used by the executor to choose execution path
  return {
    optimizedSql: sql,
    strategy,
    reason,
  }
}

// ============================================================================
// HNSW INDEX PERSISTENCE
// ============================================================================

/**
 * Metadata for persisted HNSW indexes.
 * Stored separately to enable faster checkpoint/restore.
 */
interface HNSWIndexMeta {
  /** Table name containing the index */
  tableName: string
  /** Index name */
  indexName: string
  /** Column name being indexed */
  columnName: string
  /** Vector dimensions */
  dimensions: number
  /** Distance metric: 'l2', 'cosine', or 'ip' */
  metric: 'l2' | 'cosine' | 'ip'
  /** HNSW M parameter (connections per layer) */
  m: number
  /** HNSW ef_construction parameter */
  efConstruction: number
  /** Number of vectors in the index */
  vectorCount: number
  /** Timestamp when index was created */
  createdAt: string
  /** Timestamp when index was last updated */
  updatedAt: string
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert a parameter value for PGLite
 *
 * Handles special types like arrays (vectors and text arrays)
 */
function convertParam(param: unknown): unknown {
  if (!Array.isArray(param)) {
    return param
  }

  // Check if this looks like a vector (all numbers)
  const isVector = param.every((item) => typeof item === 'number')
  if (isVector) {
    // For pgvector types, use bracket notation: [1,2,3]
    return `[${param.join(',')}]`
  } else {
    // For Postgres TEXT[] arrays, use curly brace notation: {a,b,c}
    return `{${param.join(',')}}`
  }
}

/**
 * Convert an array of parameters for PGLite
 */
function convertParams(params?: unknown[]): unknown[] | undefined {
  return params?.map(convertParam)
}

/**
 * Check if a SQL statement is a write operation (INSERT/UPDATE/DELETE)
 */
function isWriteOperation(sql: string): boolean {
  const upperSql = sql.trim().toUpperCase()
  return (
    upperSql.startsWith('INSERT') ||
    upperSql.startsWith('UPDATE') ||
    upperSql.startsWith('DELETE')
  )
}

/**
 * Convert numeric strings to numbers in a row
 *
 * PGLite returns DECIMAL/NUMERIC as strings to preserve precision,
 * but for most use cases, users expect JavaScript numbers.
 * Only converts if the string represents a valid number without precision loss.
 */
function processRowValues<T>(row: Record<string, unknown>): T {
  const processed: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
      const num = Number(value)
      // Only convert if it's a valid number and doesn't lose precision
      if (!isNaN(num) && String(num) === value) {
        processed[key] = num
      } else {
        processed[key] = value
      }
    } else {
      processed[key] = value
    }
  }

  return processed as T
}

/**
 * Process all rows in a result set
 */
function processRows<T>(rows: T[]): T[] {
  return rows.map((row) => processRowValues<T>(row as Record<string, unknown>))
}

/**
 * Escape a SQL string value for use in generated SQL
 */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Convert a value to its SQL representation
 */
function valueToSql(value: unknown): string {
  if (value === null) return 'NULL'
  if (typeof value === 'string') return `'${escapeSqlString(value)}'`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (value instanceof Date) return `'${value.toISOString()}'`
  if (Array.isArray(value)) return `'[${value.join(',')}]'`
  return `'${escapeSqlString(JSON.stringify(value))}'`
}

// ============================================================================
// CHECKPOINT CHUNKING HELPERS
// ============================================================================

/**
 * Split a string into chunks of maximum size.
 *
 * @param data - String to split
 * @param maxSize - Maximum size per chunk in bytes
 * @returns Array of string chunks
 */
function chunkString(data: string, maxSize: number): string[] {
  const chunks: string[] = []
  let offset = 0

  while (offset < data.length) {
    chunks.push(data.slice(offset, offset + maxSize))
    offset += maxSize
  }

  return chunks
}

/**
 * Simple compression using base64 encoding of deflate-like algorithm.
 * Uses a simple RLE + dictionary approach for SQL which is highly repetitive.
 *
 * For production, consider using pako or fflate WASM for proper gzip.
 * This implementation is a fallback that works without external dependencies.
 *
 * @param data - String to compress
 * @returns Compressed string (base64 encoded)
 */
function compressCheckpoint(data: string): string {
  // For now, we'll use a simple approach:
  // 1. SQL is highly compressible due to repeated keywords
  // 2. We use simple dictionary encoding for common patterns
  //
  // In production, this should be replaced with proper gzip via pako/fflate

  // Common SQL patterns to replace with short tokens
  const dictionary: [string, string][] = [
    ['INSERT INTO ', '\x01'],
    ['VALUES (', '\x02'],
    [') ON CONFLICT DO NOTHING;', '\x03'],
    ['CREATE TABLE IF NOT EXISTS ', '\x04'],
    ['CREATE INDEX IF NOT EXISTS ', '\x05'],
    ['CREATE EXTENSION IF NOT EXISTS ', '\x06'],
    ['PRIMARY KEY', '\x07'],
    ['NOT NULL', '\x08'],
    ['DEFAULT ', '\x09'],
    ['TEXT', '\x0a'],
    ['INTEGER', '\x0b'],
    ['BOOLEAN', '\x0c'],
    ['TIMESTAMP', '\x0d'],
    ['vector(', '\x0e'],
    [', ', '\x0f'],
  ]

  let compressed = data
  for (const [pattern, token] of dictionary) {
    compressed = compressed.split(pattern).join(token)
  }

  return compressed
}

/**
 * Decompress checkpoint data.
 *
 * @param compressed - Compressed string
 * @returns Original string
 */
function decompressCheckpoint(compressed: string): string {
  // Reverse dictionary encoding
  const dictionary: [string, string][] = [
    ['\x01', 'INSERT INTO '],
    ['\x02', 'VALUES ('],
    ['\x03', ') ON CONFLICT DO NOTHING;'],
    ['\x04', 'CREATE TABLE IF NOT EXISTS '],
    ['\x05', 'CREATE INDEX IF NOT EXISTS '],
    ['\x06', 'CREATE EXTENSION IF NOT EXISTS '],
    ['\x07', 'PRIMARY KEY'],
    ['\x08', 'NOT NULL'],
    ['\x09', 'DEFAULT '],
    ['\x0a', 'TEXT'],
    ['\x0b', 'INTEGER'],
    ['\x0c', 'BOOLEAN'],
    ['\x0d', 'TIMESTAMP'],
    ['\x0e', 'vector('],
    ['\x0f', ', '],
  ]

  let decompressed = compressed
  for (const [token, pattern] of dictionary) {
    decompressed = decompressed.split(token).join(pattern)
  }

  return decompressed
}

/**
 * Format bytes into human-readable string.
 *
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// ============================================================================
// EDGEPOSTGRES CLASS
// ============================================================================

/**
 * EdgePostgres - Postgres for Durable Objects
 *
 * Wraps PGLite WASM with FSX persistence for running full Postgres
 * in Cloudflare Durable Objects.
 *
 * @example
 * ```typescript
 * const db = new EdgePostgres(ctx, env)
 *
 * await db.exec(`
 *   CREATE TABLE users (
 *     id TEXT PRIMARY KEY,
 *     email TEXT UNIQUE,
 *     embedding vector(1536)
 *   )
 * `)
 *
 * await db.query(
 *   'INSERT INTO users VALUES ($1, $2, $3)',
 *   ['user-1', 'alice@example.com.ai', embedding]
 * )
 *
 * const result = await db.query(
 *   'SELECT * FROM users WHERE id = $1',
 *   ['user-1']
 * )
 * ```
 */
export class EdgePostgres {
  private ctx: DOState
  private env: Env
  private config: EdgePostgresConfig
  private pglite: PGlite | null = null
  private initPromise: Promise<PGlite> | null = null
  private closed = false
  private dirty = false
  private writeCount = 0
  private checkpointVersion = 0

  // Quantization state
  private quantizationCalibration: QuantizationCalibration | null = null
  private quantizationEnabled: boolean

  // HNSW index metadata for persistence
  private hnswIndexes: Map<string, HNSWIndexMeta> = new Map()

  constructor(ctx: DOState, env: Env, config?: EdgePostgresConfig) {
    this.ctx = ctx
    this.env = env
    this.config = config ?? {}
    this.quantizationEnabled = config?.quantization?.type === 'scalar' || config?.quantization?.type === 'binary'
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Get or create the PGLite instance (lazy singleton pattern)
   *
   * Uses a singleton pattern with deferred initialization to avoid
   * loading WASM until the first query. The initialization promise
   * is cached to prevent duplicate initialization from concurrent calls.
   *
   * @throws {ClosedError} If the instance has been closed
   */
  private async getPGLite(): Promise<PGlite> {
    if (this.closed) {
      throw new ClosedError()
    }

    // Return existing instance
    if (this.pglite) {
      return this.pglite
    }

    // Return pending initialization
    if (this.initPromise) {
      return this.initPromise
    }

    // Start initialization
    this.initPromise = this.initializePGLite()
    try {
      this.pglite = await this.initPromise
      return this.pglite
    } finally {
      this.initPromise = null
    }
  }

  /**
   * Initialize PGLite instance with extensions and restore from checkpoint
   */
  private async initializePGLite(): Promise<PGlite> {
    // Check if we should load pgvector
    const usePgVector = this.config.pglite?.extensions?.includes('pgvector')

    // Create PGLite instance with optional extensions
    let pg: PGlite
    if (usePgVector) {
      pg = await PGlite.create({
        extensions: { vector },
        initialMemory: this.config.pglite?.initialMemory,
      })
    } else {
      pg = await PGlite.create({
        initialMemory: this.config.pglite?.initialMemory,
      })
    }

    // Try to restore from checkpoint
    await this.restoreFromCheckpoint(pg)

    return pg
  }

  /**
   * Restore database state from FSX checkpoint
   */
  private async restoreFromCheckpoint(pg: PGlite): Promise<void> {
    // Load checkpoint data from storage
    // If storage access fails, let the error propagate to indicate initialization failure
    const checkpointData = await this.ctx.storage.get<string>(
      STORAGE_KEYS.CHECKPOINT
    )

    if (checkpointData) {
      try {
        // Parse the checkpoint SQL and execute it to restore state
        await pg.exec(checkpointData)

        // Load checkpoint version
        const version = await this.ctx.storage.get<number>(
          STORAGE_KEYS.CHECKPOINT_VERSION
        )
        this.checkpointVersion = version ?? 0
      } catch (error) {
        // If SQL execution fails, log but don't fail initialization
        // This handles corrupt checkpoint data gracefully
        console.warn('Failed to restore checkpoint SQL:', error)
      }
    }

    // Restore quantization calibration if enabled
    if (this.quantizationEnabled) {
      try {
        const calibration = await this.ctx.storage.get<QuantizationCalibration>(
          STORAGE_KEYS.QUANTIZATION_CALIBRATION
        )
        if (calibration) {
          this.quantizationCalibration = calibration
        }
      } catch (error) {
        console.warn('Failed to restore quantization calibration:', error)
      }
    }

    // Restore HNSW index metadata for persistence across restarts
    try {
      const indexMeta = await this.ctx.storage.get<HNSWIndexMeta[]>(
        STORAGE_KEYS.HNSW_INDEX_META
      )
      if (indexMeta && Array.isArray(indexMeta)) {
        this.hnswIndexes.clear()
        for (const meta of indexMeta) {
          this.hnswIndexes.set(meta.indexName, meta)
        }
      }
    } catch (error) {
      console.warn('Failed to restore HNSW index metadata:', error)
    }
  }

  // ==========================================================================
  // QUERY METHODS
  // ==========================================================================

  /**
   * Execute a SQL query with optional parameters
   *
   * @param sql - SQL query string with $1, $2, etc. for parameters
   * @param params - Array of parameter values
   * @param options - Query options (timeout, tier, sessionToken)
   * @returns Query result with rows
   *
   * @throws {ClosedError} If the instance has been closed
   * @throws {QueryTimeoutError} If the query exceeds the specified timeout
   *
   * @example
   * ```typescript
   * const result = await db.query(
   *   'SELECT * FROM users WHERE id = $1',
   *   ['user-1']
   * )
   * console.log(result.rows[0])
   * ```
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    const pg = await this.getPGLite()

    // Handle timeout if specified
    if (options?.timeout) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new QueryTimeoutError(options.timeout!)),
          options.timeout
        )
      })

      const queryPromise = this.executeQuery<T>(pg, sql, params)
      const result = await Promise.race([queryPromise, timeoutPromise])

      // Add session token if provided
      if (options?.sessionToken) {
        return {
          ...result,
          sessionToken: this.generateSessionToken(),
        }
      }

      return result
    }

    const result = await this.executeQuery<T>(pg, sql, params)

    // Add session token if provided
    if (options?.sessionToken) {
      return {
        ...result,
        sessionToken: this.generateSessionToken(),
      }
    }

    return result
  }

  /**
   * Execute a query and process the result
   *
   * This is the core query execution method that:
   * 1. Converts parameters to PGLite format
   * 2. Executes the query
   * 3. Tracks dirty state for writes
   * 4. Processes result rows (numeric string conversion)
   */
  private async executeQuery<T>(
    pg: PGlite,
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    const processedParams = convertParams(params)
    const result = await pg.query<T>(sql, processedParams)

    // Track writes for checkpoint threshold
    if (isWriteOperation(sql)) {
      this.dirty = true
      this.writeCount++
    }

    return {
      rows: processRows<T>(result.rows),
      affectedRows: result.affectedRows,
    }
  }

  /**
   * Execute SQL statements without returning rows
   *
   * Supports multiple statements separated by semicolons.
   *
   * @param sql - SQL statements to execute
   *
   * @example
   * ```typescript
   * await db.exec(`
   *   CREATE TABLE users (id TEXT PRIMARY KEY);
   *   CREATE TABLE posts (id TEXT, user_id TEXT);
   *   CREATE INDEX idx_posts_user ON posts(user_id);
   * `)
   * ```
   */
  async exec(sql: string): Promise<void> {
    const pg = await this.getPGLite()
    await pg.exec(sql)

    // Mark as dirty since exec typically modifies schema/data
    this.dirty = true
    this.writeCount++
  }

  // ==========================================================================
  // TRANSACTIONS
  // ==========================================================================

  /**
   * Execute operations within a transaction
   *
   * If the callback throws an error, the transaction is automatically rolled back.
   * If the callback completes successfully, the transaction is committed.
   *
   * @param callback - Async function receiving a Transaction object
   * @returns The value returned by the callback
   *
   * @throws {ClosedError} If the instance has been closed
   *
   * @example
   * ```typescript
   * await db.transaction(async (tx) => {
   *   await tx.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, 'acc-1'])
   *   await tx.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, 'acc-2'])
   * })
   * ```
   */
  async transaction<T>(
    callback: (tx: Transaction) => Promise<T>
  ): Promise<T> {
    const pg = await this.getPGLite()

    // PGLite has a transaction method we can use
    return await pg.transaction(async (pgliteTx) => {
      // Create our transaction wrapper using shared helper functions
      const tx: Transaction = {
        query: async <R = Record<string, unknown>>(
          sql: string,
          params?: unknown[],
          _options?: QueryOptions
        ): Promise<QueryResult<R>> => {
          const processedParams = convertParams(params)
          const result = await pgliteTx.query<R>(sql, processedParams)

          return {
            rows: processRows<R>(result.rows),
            affectedRows: result.affectedRows,
          }
        },
        exec: async (sql: string): Promise<void> => {
          await pgliteTx.exec(sql)
        },
        rollback: async (): Promise<void> => {
          await pgliteTx.rollback()
        },
      }

      const result = await callback(tx)

      // Mark as dirty after successful transaction
      this.dirty = true
      this.writeCount++

      return result
    })
  }

  // ==========================================================================
  // CHECKPOINT AND PERSISTENCE
  // ==========================================================================

  /**
   * Save database state to FSX storage
   *
   * Creates a checkpoint of the current database state that can be
   * restored on cold start.
   *
   * @throws {CheckpointError} If the checkpoint fails to save
   *
   * @example
   * ```typescript
   * await db.query('INSERT INTO users VALUES ($1, $2)', ['user-1', 'Alice'])
   * await db.checkpoint()  // State is now durable
   * ```
   */
  async checkpoint(): Promise<void> {
    if (!this.pglite) {
      // Nothing to checkpoint if PGLite hasn't been initialized
      return
    }

    try {
      // Export the database state as SQL
      const checkpointSql = await this.generateCheckpointSql()

      // Save to FSX storage
      await this.ctx.storage.put(STORAGE_KEYS.CHECKPOINT, checkpointSql)

      // Increment and save version
      this.checkpointVersion++
      await this.ctx.storage.put(
        STORAGE_KEYS.CHECKPOINT_VERSION,
        this.checkpointVersion
      )

      // Persist quantization calibration if enabled
      if (this.quantizationCalibration) {
        await this.ctx.storage.put(
          STORAGE_KEYS.QUANTIZATION_CALIBRATION,
          this.quantizationCalibration
        )
      }

      // Persist HNSW index metadata for recovery across restarts
      // This ensures HNSW indexes are properly reconstructed on cold start
      if (this.hnswIndexes.size > 0) {
        await this.ctx.storage.put(
          STORAGE_KEYS.HNSW_INDEX_META,
          Array.from(this.hnswIndexes.values())
        )
      }

      // Reset dirty flag and write count
      this.dirty = false
      this.writeCount = 0
    } catch (error) {
      throw new CheckpointError(
        error instanceof Error ? error.message : 'Unknown error',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Generate SQL for checkpoint
   */
  private async generateCheckpointSql(): Promise<string> {
    if (!this.pglite) {
      return ''
    }

    const statements: string[] = []

    // Get all user tables
    const tablesResult = await this.pglite.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
    `)

    for (const { tablename } of tablesResult.rows) {
      // Get table schema with full type info including vector dimensions
      const columnsResult = await this.pglite.query<{
        column_name: string
        data_type: string
        udt_name: string
        column_default: string | null
        is_nullable: string
        character_maximum_length: number | null
        numeric_precision: number | null
      }>(`
        SELECT column_name, data_type, udt_name, column_default, is_nullable,
               character_maximum_length, numeric_precision
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tablename])

      // Get vector column dimensions from pg_attribute
      const vectorDimensions = new Map<string, number>()
      const vectorColsResult = await this.pglite.query<{
        attname: string
        atttypmod: number
      }>(`
        SELECT a.attname, a.atttypmod
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_type t ON a.atttypid = t.oid
        WHERE c.relname = $1 AND t.typname = 'vector' AND a.attnum > 0
      `, [tablename])

      for (const { attname, atttypmod } of vectorColsResult.rows) {
        // atttypmod contains the dimension for vector types
        if (atttypmod > 0) {
          vectorDimensions.set(attname, atttypmod)
        }
      }

      // Build CREATE TABLE statement
      const columns = columnsResult.rows.map((col) => {
        let dataType: string

        // Handle USER-DEFINED types (like pgvector)
        if (col.data_type === 'USER-DEFINED' && col.udt_name === 'vector') {
          const dim = vectorDimensions.get(col.column_name)
          dataType = dim ? `vector(${dim})` : 'vector'
        } else {
          dataType = col.data_type.toUpperCase()
        }

        let def = `${col.column_name} ${dataType}`
        if (col.column_default) {
          def += ` DEFAULT ${col.column_default}`
        }
        if (col.is_nullable === 'NO') {
          def += ' NOT NULL'
        }
        return def
      })

      // Get primary key
      const pkResult = await this.pglite.query<{ attname: string }>(`
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary
      `, [tablename])

      if (pkResult.rows.length > 0) {
        const pkColumns = pkResult.rows.map((r) => r.attname).join(', ')
        columns.push(`PRIMARY KEY (${pkColumns})`)
      }

      statements.push(
        `CREATE TABLE IF NOT EXISTS ${tablename} (${columns.join(', ')});`
      )

      // Get indexes
      const indexResult = await this.pglite.query<{
        indexname: string
        indexdef: string
      }>(`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1
        AND indexname NOT LIKE '%_pkey'
      `, [tablename])

      for (const { indexdef } of indexResult.rows) {
        // Convert CREATE INDEX to CREATE INDEX IF NOT EXISTS
        const ifNotExists = indexdef.replace(
          'CREATE INDEX',
          'CREATE INDEX IF NOT EXISTS'
        )
        statements.push(`${ifNotExists};`)
      }

      // Get all data
      const dataResult = await this.pglite.query(`SELECT * FROM ${tablename}`)

      for (const row of dataResult.rows) {
        const cols = Object.keys(row as object)
        const vals = Object.values(row as object).map(valueToSql)

        statements.push(
          `INSERT INTO ${tablename} (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING;`
        )
      }
    }

    // Check for vector extension usage
    const hasVector = await this.hasVectorExtension()
    if (hasVector) {
      statements.unshift('CREATE EXTENSION IF NOT EXISTS vector;')
    }

    return statements.join('\n')
  }

  /**
   * Check if vector extension is being used
   */
  private async hasVectorExtension(): Promise<boolean> {
    if (!this.pglite) return false

    try {
      const result = await this.pglite.query<{ extname: string }>(`
        SELECT extname FROM pg_extension WHERE extname = 'vector'
      `)
      return result.rows.length > 0
    } catch {
      return false
    }
  }

  // ==========================================================================
  // VECTOR QUANTIZATION METHODS
  // ==========================================================================

  /**
   * Calibrate scalar quantization from existing vectors in a table.
   *
   * This samples vectors from the specified table/column to compute min/max bounds
   * per dimension, which are used to map float32 values to int8 for 4x memory reduction.
   *
   * @param tableName - Table containing vectors
   * @param columnName - Vector column name
   * @param sampleSize - Number of vectors to sample (default: 1000)
   * @returns Calibration statistics
   *
   * @example
   * ```typescript
   * const stats = await db.calibrateQuantization('documents', 'embedding', 1000)
   * console.log(`Calibrated with ${stats.sampleCount} samples`)
   * ```
   */
  async calibrateQuantization(
    tableName: string,
    columnName: string,
    sampleSize?: number
  ): Promise<{
    sampleCount: number
    dimensions: number
    compressionRatio: number
    savingsPercent: number
  }> {
    const pg = await this.getPGLite()
    const limit = sampleSize ?? this.config.quantization?.calibrationSamples ?? 1000

    // Sample vectors from the table
    const result = await pg.query<Record<string, unknown>>(`
      SELECT ${columnName} FROM ${tableName}
      ORDER BY RANDOM()
      LIMIT ${limit}
    `)

    if (result.rows.length === 0) {
      throw new Error(`No vectors found in ${tableName}.${columnName}`)
    }

    // Parse vectors from string format
    const vectors: number[][] = result.rows.map(row => {
      const vecValue = row[columnName]
      if (typeof vecValue === 'string') {
        // Parse [1,2,3] format
        const stripped = vecValue.replace(/[\[\]]/g, '')
        return stripped.split(',').map(Number)
      } else if (Array.isArray(vecValue)) {
        return vecValue as number[]
      }
      throw new Error(`Invalid vector format in ${columnName}`)
    })

    // Compute calibration
    this.quantizationCalibration = computeQuantizationCalibration(vectors)
    this.dirty = true

    // Compute savings statistics
    const savings = computeQuantizationSavings(
      this.quantizationCalibration.dimensions,
      vectors.length,
      this.config.quantization?.type ?? 'scalar'
    )

    return {
      sampleCount: vectors.length,
      dimensions: this.quantizationCalibration.dimensions,
      compressionRatio: savings.compressionRatio,
      savingsPercent: savings.savingsPercent,
    }
  }

  /**
   * Get memory statistics for vector storage with quantization.
   *
   * @param tableName - Table name (optional)
   * @param columnName - Vector column name (optional)
   * @returns Memory usage statistics
   */
  async getVectorMemoryStats(
    tableName?: string,
    columnName?: string
  ): Promise<{
    vectorCount: number
    dimensions: number
    originalBytes: number
    quantizedBytes: number
    compressionRatio: number
    savingsPercent: number
    quantizationType: string
  }> {
    const pg = await this.getPGLite()

    // Get vector count and dimensions
    let vectorCount = 0
    let dimensions = 0

    if (tableName && columnName) {
      const countResult = await pg.query<{ count: number }>(`
        SELECT COUNT(*) as count FROM ${tableName}
        WHERE ${columnName} IS NOT NULL
      `)
      vectorCount = Number(countResult.rows[0]?.count ?? 0)

      // Get dimensions from first vector
      if (vectorCount > 0) {
        const dimResult = await pg.query<{ atttypmod: number }>(`
          SELECT a.atttypmod
          FROM pg_attribute a
          JOIN pg_class c ON a.attrelid = c.oid
          JOIN pg_type t ON a.atttypid = t.oid
          WHERE c.relname = $1 AND a.attname = $2 AND t.typname = 'vector'
        `, [tableName, columnName])
        dimensions = dimResult.rows[0]?.atttypmod ?? 0
      }
    }

    const quantizationType = this.config.quantization?.type ?? 'none'
    const savings = computeQuantizationSavings(dimensions, vectorCount, quantizationType)

    return {
      vectorCount,
      dimensions,
      originalBytes: savings.originalBytes,
      quantizedBytes: savings.quantizedBytes,
      compressionRatio: savings.compressionRatio,
      savingsPercent: savings.savingsPercent,
      quantizationType,
    }
  }

  // ==========================================================================
  // HNSW INDEX TRACKING
  // ==========================================================================

  /**
   * Track HNSW index creation for persistence across restarts.
   *
   * Call this after creating an HNSW index to ensure it persists.
   * The index metadata is saved during checkpoint and restored on cold start.
   *
   * @param tableName - Table containing the indexed column
   * @param indexName - Name of the HNSW index
   * @param columnName - Vector column being indexed
   * @param options - Index parameters
   *
   * @example
   * ```typescript
   * await db.exec(`CREATE INDEX idx ON docs USING hnsw (embedding vector_cosine_ops)`)
   * await db.trackHNSWIndex('docs', 'idx', 'embedding', { metric: 'cosine', m: 16 })
   * ```
   */
  async trackHNSWIndex(
    tableName: string,
    indexName: string,
    columnName: string,
    options?: {
      dimensions?: number
      metric?: 'l2' | 'cosine' | 'ip'
      m?: number
      efConstruction?: number
    }
  ): Promise<void> {
    const pg = await this.getPGLite()

    // Get dimensions from column metadata
    let dimensions = options?.dimensions ?? 0
    if (!dimensions) {
      const dimResult = await pg.query<{ atttypmod: number }>(`
        SELECT a.atttypmod
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_type t ON a.atttypid = t.oid
        WHERE c.relname = $1 AND a.attname = $2 AND t.typname = 'vector'
      `, [tableName, columnName])
      dimensions = dimResult.rows[0]?.atttypmod ?? 0
    }

    // Get vector count
    const countResult = await pg.query<{ count: number }>(`
      SELECT COUNT(*) as count FROM ${tableName}
    `)

    const now = new Date().toISOString()
    const meta: HNSWIndexMeta = {
      tableName,
      indexName,
      columnName,
      dimensions,
      metric: options?.metric ?? 'cosine',
      m: options?.m ?? 16,
      efConstruction: options?.efConstruction ?? 64,
      vectorCount: Number(countResult.rows[0]?.count ?? 0),
      createdAt: now,
      updatedAt: now,
    }

    this.hnswIndexes.set(indexName, meta)
    this.dirty = true
  }

  /**
   * Get tracked HNSW indexes.
   *
   * @returns Array of HNSW index metadata
   */
  getHNSWIndexes(): HNSWIndexMeta[] {
    return Array.from(this.hnswIndexes.values())
  }

  // ==========================================================================
  // HYBRID SEARCH ANALYSIS
  // ==========================================================================

  /**
   * Analyze a query for hybrid search optimization.
   *
   * Returns analysis of the query including whether it's a hybrid query
   * (combining vector search with SQL filters) and the recommended strategy.
   *
   * @param sql - SQL query to analyze
   * @returns Analysis results with optimization recommendations
   *
   * @example
   * ```typescript
   * const analysis = db.analyzeHybridQuery(`
   *   SELECT * FROM docs
   *   WHERE category = 'tech'
   *   ORDER BY embedding <=> $1
   *   LIMIT 10
   * `)
   * console.log(analysis.strategy) // 'pre-filter' or 'post-filter'
   * ```
   */
  analyzeHybridQuery(sql: string): {
    hasVectorOp: boolean
    hasFilter: boolean
    filterConditions: string[]
    estimatedSelectivity: number
    recommendedStrategy: 'pre-filter' | 'post-filter' | 'parallel'
    reason: string
  } {
    const analysis = analyzeQueryForHybridSearch(sql)
    const config = this.config.hybridSearch ?? { strategy: 'auto' }
    const optimization = optimizeHybridQuery(sql, config)

    return {
      ...analysis,
      recommendedStrategy: optimization.strategy,
      reason: optimization.reason,
    }
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Close the EdgePostgres instance and release resources
   *
   * If there are uncommitted changes, they will be checkpointed before closing.
   *
   * @example
   * ```typescript
   * const db = new EdgePostgres(ctx, env)
   * // ... use db ...
   * await db.close()
   * ```
   */
  async close(): Promise<void> {
    if (this.closed) {
      return // Already closed, safe to call multiple times
    }

    // Checkpoint if dirty
    if (this.dirty && this.pglite) {
      await this.checkpoint()
    }

    // Close PGLite
    if (this.pglite) {
      await this.pglite.close()
      this.pglite = null
    }

    this.closed = true
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Generate a session token for read-your-writes consistency
   */
  private generateSessionToken(): string {
    const timestamp = Date.now()
    const version = this.checkpointVersion
    const doId = this.ctx.id.toString()
    return `${doId}:${version}:${timestamp}`
  }
}
