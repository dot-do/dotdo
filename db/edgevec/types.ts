/**
 * EdgeVec Service Types
 *
 * Type definitions for the EdgeVec HNSW vector search service.
 * EdgeVec runs as a separate worker with WASM for efficient vector search.
 *
 * @see db/edgevec/service.ts for implementation
 * @see docs/plans/2026-01-09-compat-layer-design.md
 */

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for EdgeVec operations
 */
export type EdgeVecErrorCode =
  | 'INVALID_DIMENSIONS'
  | 'INVALID_INDEX_NAME'
  | 'INVALID_NAMESPACE'
  | 'INVALID_VECTOR_ID'
  | 'INVALID_VALUES'
  | 'INVALID_PARAMETERS'
  | 'INVALID_HNSW_PARAMS'
  | 'INVALID_METRIC'
  | 'INDEX_EXISTS'
  | 'INDEX_NOT_FOUND'
  | 'NAMESPACE_NOT_FOUND'
  | 'VECTORS_NOT_FOUND'
  | 'DUPLICATE_IDS'
  | 'EMPTY_VECTORS'
  | 'EMPTY_VALUES'
  | 'EMPTY_IDS'
  | 'EMPTY_QUERY'
  | 'EMPTY_QUERIES'
  | 'DIMENSION_MISMATCH'
  | 'NO_PERSISTED_DATA'
  | 'PERSIST_FAILED'
  | 'LOAD_FAILED'

/**
 * Structured error from EdgeVec operations
 */
export interface EdgeVecError {
  /** Error code for programmatic handling */
  code: EdgeVecErrorCode
  /** Human-readable error message */
  message: string
  /** Additional context (e.g., expected vs actual dimensions) */
  details?: Record<string, unknown>
}

// ============================================================================
// Index Configuration
// ============================================================================

/**
 * Distance metric for vector similarity
 */
export type DistanceMetric = 'cosine' | 'euclidean' | 'dot'

/**
 * Configuration for creating an HNSW index
 */
export interface IndexConfig {
  /** Number of dimensions in vectors */
  dimensions: number
  /** Distance metric (default: cosine) */
  metric?: DistanceMetric
  /** HNSW parameter: max connections per node (default: 16) */
  m?: number
  /** HNSW parameter: size of dynamic candidate list during construction (default: 200) */
  efConstruction?: number
}

/**
 * Full index configuration with defaults applied
 */
export interface ResolvedIndexConfig {
  dimensions: number
  metric: DistanceMetric
  m: number
  efConstruction: number
}

/**
 * Index information and statistics
 */
export interface IndexInfo {
  /** Index name */
  name: string
  /** Namespace the index belongs to */
  namespace: string
  /** Vector dimensions */
  dimensions: number
  /** Distance metric */
  metric: DistanceMetric
  /** Number of vectors in the index */
  vectorCount: number
  /** HNSW configuration */
  config: ResolvedIndexConfig
  /** Creation timestamp */
  createdAt?: string
  /** Last modified timestamp */
  updatedAt?: string
}

// ============================================================================
// Vector Types
// ============================================================================

/**
 * Vector for insertion
 */
export interface Vector {
  /** Unique identifier */
  id: string
  /** Vector values (embedding) */
  values: number[] | Float32Array
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Vector metadata filter for search
 */
export interface MetadataFilter {
  [key: string]: unknown
}

// ============================================================================
// Search Types
// ============================================================================

/**
 * Options for search queries
 */
export interface SearchOptions {
  /** Number of results to return (default: 10) */
  k?: number
  /** HNSW search parameter: size of dynamic candidate list (default: 40) */
  ef?: number
  /** Metadata filter */
  filter?: MetadataFilter
}

/**
 * Single search result
 */
export interface SearchMatch {
  /** Vector ID */
  id: string
  /** Similarity score */
  score: number
  /** Vector metadata if available */
  metadata?: Record<string, unknown>
}

/**
 * Search result with matches
 */
export interface SearchResult {
  success: true
  results: SearchMatch[]
  queryTimeMs: number
}

/**
 * Failed search result
 */
export interface SearchError {
  success: false
  error: EdgeVecError
}

// ============================================================================
// Operation Results
// ============================================================================

/**
 * Result of createIndex operation
 */
export type CreateIndexResult =
  | {
      success: true
      name: string
      namespace: string
      config: ResolvedIndexConfig
    }
  | {
      success: false
      error: EdgeVecError
    }

/**
 * Result of insert operation
 */
export type InsertResult =
  | {
      success: true
      inserted: number
      updated?: number
      failed?: number
      ids: string[]
    }
  | {
      success: false
      error: EdgeVecError
      inserted?: number
      failed?: number
    }

/**
 * Result of delete operation
 */
export type DeleteResult =
  | {
      success: true
      deleted: number
      ids: string[]
      notFound?: string[]
    }
  | {
      success: false
      error: EdgeVecError
    }

/**
 * Result of describeIndex operation
 */
export type DescribeIndexResult =
  | {
      success: true
      info: IndexInfo
    }
  | {
      success: false
      error: EdgeVecError
    }

/**
 * Result of listIndexes operation
 */
export type ListIndexesResult =
  | {
      success: true
      indexes: Array<{
        name: string
        dimensions: number
        vectorCount: number
      }>
    }
  | {
      success: false
      error: EdgeVecError
    }

/**
 * Result of deleteIndex operation
 */
export type DeleteIndexResult =
  | {
      success: true
    }
  | {
      success: false
      error: EdgeVecError
    }

/**
 * Result of persist operation
 */
export type PersistResult =
  | {
      success: true
      bytesWritten: number
    }
  | {
      success: false
      error: EdgeVecError
    }

/**
 * Result of persistAll operation
 */
export type PersistAllResult =
  | {
      success: true
      persisted: number
    }
  | {
      success: false
      error: EdgeVecError
    }

/**
 * Result of load operation
 */
export type LoadResult =
  | {
      success: true
      vectorCount: number
    }
  | {
      success: false
      error: EdgeVecError
    }

/**
 * Result of loadAll operation
 */
export type LoadAllResult =
  | {
      success: true
      loaded: number
    }
  | {
      success: false
      error: EdgeVecError
    }

/**
 * Individual batch search result
 */
export type BatchSearchItem =
  | {
      success: true
      results: SearchMatch[]
    }
  | {
      success: false
      error: EdgeVecError
    }

/**
 * Result of batchSearch operation
 */
export type BatchSearchResult =
  | {
      success: true
      results: BatchSearchItem[]
    }
  | {
      success: false
      error: EdgeVecError
    }

// ============================================================================
// Service Interface
// ============================================================================

/**
 * EdgeVec Service interface
 *
 * Implemented by EdgeVecServiceImpl as a WorkerEntrypoint for RPC access.
 */
export interface EdgeVecService {
  // Index management
  createIndex(namespace: string, name: string, config: IndexConfig): Promise<CreateIndexResult>
  deleteIndex(namespace: string, name: string): Promise<DeleteIndexResult>
  describeIndex(namespace: string, name: string): Promise<DescribeIndexResult>
  listIndexes(namespace: string): Promise<ListIndexesResult>

  // Vector operations
  insert(namespace: string, indexName: string, vectors: Vector[]): Promise<InsertResult>
  delete(namespace: string, indexName: string, ids: string[]): Promise<DeleteResult>
  search(
    namespace: string,
    indexName: string,
    query: number[] | Float32Array,
    options?: SearchOptions
  ): Promise<SearchResult | SearchError>
  batchSearch(
    namespace: string,
    indexName: string,
    queries: Array<number[] | Float32Array>,
    options?: SearchOptions
  ): Promise<BatchSearchResult>

  // Persistence
  persist(namespace: string, indexName: string): Promise<PersistResult>
  persistAll(): Promise<PersistAllResult>
  load(namespace: string, indexName: string): Promise<LoadResult>
  loadAll(): Promise<LoadAllResult>
}
