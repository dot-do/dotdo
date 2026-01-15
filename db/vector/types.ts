/**
 * VectorStore Types
 *
 * TypeScript type definitions for VectorStore, HybridSearch, and related functionality.
 *
 * @module db/vector/types
 */

import type { CDCEmitter } from '../cdc'

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface VectorStoreOptions {
  dimension?: number
  matryoshkaDims?: number[]
  useBinaryPrefilter?: boolean
  lazyInit?: boolean
  onCDC?: (event: CDCEvent) => void
  /** Optional unified CDC emitter for pipeline integration */
  cdcEmitter?: CDCEmitter
  /** Tiered storage configuration */
  tieredStorage?: TieredStorageOptions
  /** Index configuration for accelerated search */
  indexConfig?: IndexConfig
  /** Cache configuration for search optimization */
  cacheConfig?: Partial<CacheConfig>
}

/**
 * Cache configuration for VectorStore search optimization caches
 */
export interface CacheConfig {
  /** Maximum number of entries in the cache */
  maxSize: number
  /** Maximum memory in bytes for the cache */
  memoryLimitBytes?: number
  /** Eviction threshold (0-1) for memory-based eviction */
  evictionThreshold?: number
  /** Separate max size for binary hash cache */
  binaryHashMaxSize?: number
  /** Separate max size for matryoshka cache */
  matryoshkaMaxSize?: number
  /** Auto-populate cache when documents are promoted to hot tier */
  autoPopulateOnPromote?: boolean
}

export interface InsertOptions {
  partition?: string
}

/**
 * Filter value types supported in metadata filtering
 */
export type FilterValue = string | number | boolean | null | undefined

export interface SearchOptions {
  embedding: Float32Array
  limit: number
  filter?: Record<string, FilterValue>
  useBinaryPrefilter?: boolean
}

export interface HybridSearchOptions {
  query?: string
  embedding?: Float32Array
  limit: number
  ftsWeight?: number
  vectorWeight?: number
  fusion?: 'rrf' | 'linear'
}

export interface ProgressiveSearchOptions {
  embedding: Float32Array
  limit: number
  stages?: ProgressiveSearchStage[]
  returnTiming?: boolean
}

export interface ProgressiveSearchStage {
  type: 'binary' | 'matryoshka' | 'exact'
  dim?: number
  candidates: number
}

export interface ProgressiveSearchResult {
  results: SearchResult[]
  timing?: ProgressiveTiming
}

export interface ProgressiveTiming {
  total: number
  stages: { name: string; duration: number }[]
}

// ============================================================================
// DATA TYPES
// ============================================================================

export interface VectorDocument<M extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  content: string
  embedding: Float32Array
  metadata?: M
}

export interface StoredDocument<M extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  content: string
  embedding: Float32Array
  metadata: M
  mat_64?: Float32Array
  mat_256?: Float32Array
  binary_hash?: ArrayBuffer
}

export interface SearchResult<M extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  content: string
  metadata: M
  similarity: number
  distance: number
  rrfScore?: number
  ftsRank?: number | null
  vectorRank?: number | null
}

// ============================================================================
// RRF TYPES
// ============================================================================

export interface RRFRankInput {
  rank: number | null
  weight: number
}

export interface RRFOptions {
  k?: number
}

// ============================================================================
// CDC EVENT TYPES
// ============================================================================

export interface CDCEvent {
  type: string
  op: 'c' | 'u' | 'd'
  store: string
  table?: string
  key?: string
  count?: number
  partition?: string
  timestamp: number
  after?: {
    dimension?: number
    matryoshkaDims?: number[]
    hasContent?: boolean
  }
}

// ============================================================================
// HYBRID SEARCH TYPES
// ============================================================================

export interface HybridQueryOptions {
  query: string
  embedding: Float32Array
  limit: number
  ftsWeight?: number
  vectorWeight?: number
  vectorDim?: number
  where?: Record<string, FilterValue>
}

// ============================================================================
// SUBSCRIPTION TYPES
// ============================================================================

export interface Subscription {
  unsubscribe: () => void
}

// ============================================================================
// STORAGE TIERING TYPES
// ============================================================================

/**
 * Storage tier names
 */
export type StorageTier = 'hot' | 'warm' | 'cold'

/**
 * Configuration for tiered storage
 */
export interface TierConfig {
  /** Maximum number of documents in this tier before promotion/demotion */
  maxDocuments?: number
  /** Maximum age in milliseconds before document is demoted */
  maxAgeMs?: number
  /** Minimum access count to stay in tier */
  minAccessCount?: number
  /** Whether this tier is enabled */
  enabled: boolean
}

/**
 * Options for tiered vector storage
 */
export interface TieredStorageOptions {
  /** Hot tier: frequently accessed, full precision */
  hot?: TierConfig
  /** Warm tier: moderately accessed, may use matryoshka compression */
  warm?: TierConfig
  /** Cold tier: rarely accessed, archived to Parquet */
  cold?: TierConfig
  /** Auto-promote from cold to hot on access */
  autoPromote?: boolean
  /** Auto-demote from hot to warm after maxAgeMs */
  autoDemote?: boolean
}

/**
 * Stored document with tier metadata
 */
export interface TieredDocument extends StoredDocument {
  /** Current storage tier */
  tier: StorageTier
  /** Last access timestamp */
  lastAccessedAt: number
  /** Number of times document was accessed */
  accessCount: number
  /** When document was inserted/updated */
  updatedAt: number
}

/**
 * Statistics for a storage tier
 */
export interface TierStats {
  /** Tier name */
  tier: StorageTier
  /** Number of documents in tier */
  documentCount: number
  /** Total memory usage in bytes (approximate) */
  memoryBytes: number
  /** Average access count */
  avgAccessCount: number
  /** Average age in milliseconds */
  avgAgeMs: number
}

// ============================================================================
// PROGRESSIVE SEARCH OPTIMIZATIONS
// ============================================================================

/**
 * Adaptive progressive search options
 */
export interface AdaptiveProgressiveOptions extends ProgressiveSearchOptions {
  /** Target recall rate (0-1), will adjust stages to achieve */
  targetRecall?: number
  /** Maximum latency in milliseconds */
  maxLatencyMs?: number
  /** Whether to use early termination when threshold met */
  earlyTermination?: boolean
  /** Similarity threshold for early termination */
  earlyTerminationThreshold?: number
  /** Scale factor for candidate expansion (default: 2x) */
  expansionFactor?: number
}

/**
 * Progressive search statistics
 */
export interface ProgressiveSearchStats {
  /** Total documents in store */
  totalDocuments: number
  /** Documents scanned at each stage */
  scannedByStage: number[]
  /** Whether early termination was triggered */
  earlyTerminated: boolean
  /** Stage at which early termination occurred */
  terminatedAtStage?: number
  /** Estimated recall based on candidates examined */
  estimatedRecall: number
}

/**
 * Enhanced progressive search result with stats
 */
export interface EnhancedProgressiveResult {
  results: SearchResult[]
  timing: ProgressiveTiming
  stats: ProgressiveSearchStats
}

// ============================================================================
// INDEX INTEGRATION TYPES
// ============================================================================

/**
 * Index type for acceleration
 */
export type IndexType = 'none' | 'ivf' | 'hnsw' | 'lsh'

/**
 * Configuration for index-based acceleration
 */
export interface IndexConfig {
  /** Type of index to use */
  type: IndexType
  /** For IVF: number of clusters */
  nlist?: number
  /** For IVF: number of clusters to probe */
  nprobe?: number
  /** For HNSW: number of connections per layer */
  M?: number
  /** For HNSW: size of dynamic candidate list during construction */
  efConstruction?: number
  /** For HNSW: size of dynamic candidate list during search */
  efSearch?: number
  /** For LSH: number of hash tables */
  numTables?: number
  /** For LSH: number of hash bits per table */
  numBits?: number
}

// ============================================================================
// MOCK DB TYPE
// ============================================================================

/**
 * Prepared statement result interface
 */
export interface PreparedStatement {
  run: (...params: unknown[]) => void
  get: (...params: unknown[]) => unknown
  all: (...params: unknown[]) => unknown[]
}

/**
 * Stored data value type for MockDb
 */
export interface MockDbStoredValue {
  id: string
  embedding?: Float32Array
  content?: string
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export interface MockDb {
  data: Map<string, MockDbStoredValue>
  ftsData: Map<string, string>
  events: CDCEvent[]
  exec: (sql: string) => void
  prepare: (sql: string) => PreparedStatement
  onCDC?: (handler: (event: CDCEvent) => void) => { unsubscribe: () => void }
  _emitCDC?: (event: CDCEvent) => void
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a value is a SearchResult
 */
export function isSearchResult(value: unknown): value is SearchResult<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.content === 'string' &&
    typeof obj.similarity === 'number' &&
    typeof obj.distance === 'number' &&
    (typeof obj.metadata === 'object' || obj.metadata === undefined)
  )
}

/**
 * Type guard to check if a value is a VectorDocument
 */
export function isVectorDocument(value: unknown): value is VectorDocument<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.content === 'string' &&
    obj.embedding instanceof Float32Array &&
    (typeof obj.metadata === 'object' || obj.metadata === undefined)
  )
}
