/**
 * Vector Types - Core types for vector similarity search operations
 *
 * This module provides type definitions for the VectorShardDO system,
 * which implements distributed vector similarity search using:
 * - Float32Array for memory-efficient vector storage
 * - Cosine similarity and L2 distance metrics
 * - Min-heap for efficient top-K selection
 *
 * @module types/vector
 */

// ============================================================================
// DISTANCE METRICS
// ============================================================================

/**
 * Supported distance metrics for vector similarity search
 */
export type DistanceMetric = 'cosine' | 'l2'

// ============================================================================
// SEARCH TYPES
// ============================================================================

/**
 * Result of a vector similarity search
 */
export interface SearchResult {
  /** The ID of the matching vector */
  id: string
  /** The similarity/distance score (lower is better for L2, higher for cosine) */
  score: number
}

/**
 * Request for a vector search operation
 */
export interface VectorSearchRequest {
  /** The query vector as Float32Array */
  query: Float32Array
  /** Number of results to return */
  k: number
  /** Distance metric to use (default: 'cosine') */
  metric?: DistanceMetric
  /** Optional filter function to filter results */
  filter?: (id: string) => boolean
}

/**
 * Response from a vector search operation
 */
export interface VectorSearchResponse {
  /** The top-K results sorted by score */
  results: SearchResult[]
  /** Number of vectors scanned during the search */
  vectorsScanned: number
  /** Time taken for the search in milliseconds */
  searchTimeMs: number
}

// ============================================================================
// SHARD TYPES
// ============================================================================

/**
 * Statistics about a vector shard
 */
export interface ShardStats {
  /** Total number of vectors in the shard */
  vectorCount: number
  /** Dimension of each vector */
  dimensions: number
  /** Approximate memory usage in bytes */
  memoryBytes: number
  /** Whether vectors have been loaded from storage */
  loaded: boolean
  /** Last time vectors were loaded (ISO string) */
  loadedAt?: string
}

/**
 * Configuration for a vector shard
 */
export interface ShardConfig {
  /** Unique index of this shard in the cluster */
  shardIndex: number
  /** Number of dimensions for vectors in this shard */
  dimensions: number
  /** Optional maximum number of vectors to store */
  maxVectors?: number
  /** Path prefix for R2 storage */
  storagePath?: string
}

/**
 * Metadata about a vector stored in the shard
 */
export interface VectorMetadata {
  /** The vector's unique ID */
  id: string
  /** Index of this vector in the shard's storage */
  index: number
  /** Optional additional metadata */
  data?: Record<string, unknown>
}

// ============================================================================
// STORAGE TYPES
// ============================================================================

/**
 * Format for storing vectors in R2
 *
 * File structure:
 * - Header (32 bytes):
 *   - Magic bytes: "VEC1" (4 bytes)
 *   - Version: uint32 (4 bytes)
 *   - Vector count: uint32 (4 bytes)
 *   - Dimensions: uint32 (4 bytes)
 *   - Reserved: 16 bytes
 * - IDs section:
 *   - ID length: uint16 per ID
 *   - ID strings: UTF-8 encoded
 * - Vectors section:
 *   - Float32Array data (count * dimensions * 4 bytes)
 */
export interface VectorStorageFormat {
  /** Magic bytes for file identification */
  magic: 'VEC1'
  /** Format version */
  version: number
  /** Number of vectors stored */
  count: number
  /** Dimensions per vector */
  dimensions: number
  /** Vector IDs */
  ids: string[]
  /** Raw vector data */
  vectors: Float32Array
}

/**
 * Options for loading vectors from R2
 */
export interface LoadOptions {
  /** Path to the vector file in R2 */
  path: string
  /** Whether to validate the file format */
  validate?: boolean
  /** Maximum number of vectors to load (for partial loading) */
  limit?: number
}

/**
 * Options for saving vectors to R2
 */
export interface SaveOptions {
  /** Path to save the vector file in R2 */
  path: string
  /** Whether to overwrite existing file */
  overwrite?: boolean
}

// ============================================================================
// INDEX TYPES (for future IVF-PQ implementation)
// ============================================================================

/**
 * Centroid for IVF (Inverted File Index)
 */
export interface Centroid {
  /** Centroid ID */
  id: number
  /** Centroid vector */
  vector: Float32Array
  /** Number of vectors assigned to this centroid */
  count: number
}

/**
 * Product Quantization codebook
 */
export interface PQCodebook {
  /** Number of subquantizers */
  numSubquantizers: number
  /** Number of centroids per subquantizer (typically 256) */
  numCentroids: number
  /** Dimensions per subquantizer */
  subvectorDimension: number
  /** Codebook data: [subquantizer][centroid][dimension] */
  centroids: Float32Array[]
}

/**
 * Configuration for IVF-PQ index
 */
export interface IVFPQConfig {
  /** Number of IVF clusters */
  nlist: number
  /** Number of clusters to probe during search */
  nprobe: number
  /** PQ configuration */
  pq: {
    /** Number of subquantizers (typically 32) */
    m: number
    /** Bits per subquantizer (typically 8 = 256 centroids) */
    nbits: number
  }
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Request for batch vector insertion
 */
export interface BatchInsertRequest {
  /** Vector IDs */
  ids: string[]
  /** Vectors as Float32Array (flattened: count * dimensions) */
  vectors: Float32Array
  /** Expected dimensions per vector */
  dimensions: number
}

/**
 * Response from batch vector insertion
 */
export interface BatchInsertResponse {
  /** Number of vectors successfully inserted */
  inserted: number
  /** IDs of vectors that failed to insert */
  failed: string[]
  /** Error messages for failed insertions */
  errors?: Record<string, string>
}

/**
 * Request for batch vector deletion
 */
export interface BatchDeleteRequest {
  /** IDs of vectors to delete */
  ids: string[]
}

/**
 * Response from batch vector deletion
 */
export interface BatchDeleteResponse {
  /** Number of vectors successfully deleted */
  deleted: number
  /** IDs of vectors not found */
  notFound: string[]
}

// ============================================================================
// HEAP TYPES (for top-K selection)
// ============================================================================

/**
 * Entry in a min-heap for top-K selection
 */
export interface HeapEntry {
  /** Vector ID */
  id: string
  /** Distance/similarity score */
  score: number
}

/**
 * Min-heap interface for efficient top-K selection
 */
export interface MinHeap {
  /** Add an entry to the heap */
  push(entry: HeapEntry): void
  /** Remove and return the minimum entry */
  pop(): HeapEntry | undefined
  /** Peek at the minimum entry without removing */
  peek(): HeapEntry | undefined
  /** Current size of the heap */
  size: number
  /** Maximum capacity of the heap */
  capacity: number
  /** Get all entries as an array (sorted by score ascending) */
  toArray(): HeapEntry[]
}
