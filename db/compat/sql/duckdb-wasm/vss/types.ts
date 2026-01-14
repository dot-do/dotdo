/**
 * Type definitions for DuckDB VSS (Vector Similarity Search) extension
 *
 * @module @dotdo/duckdb-wasm/vss/types
 *
 * @see https://duckdb.org/docs/extensions/vss
 */

// ============================================================================
// DISTANCE METRICS
// ============================================================================

/**
 * Distance metric for vector similarity calculations
 *
 * - 'l2sq': Squared Euclidean distance (L2^2) - default
 * - 'l2': Euclidean distance (L2)
 * - 'cosine': Cosine distance (1 - cosine similarity)
 * - 'ip': Inner product (negative for similarity)
 */
export type DistanceMetric = 'l2sq' | 'l2' | 'cosine' | 'ip'

// ============================================================================
// INDEX CONFIGURATION
// ============================================================================

/**
 * Configuration options for creating a vector index
 */
export interface VectorIndexConfig {
  /**
   * Number of dimensions for vectors stored in this column
   * Must match the dimension of vectors being indexed
   */
  dimensions: number

  /**
   * Distance metric for similarity calculations
   * @default 'l2sq'
   */
  metric?: DistanceMetric

  /**
   * HNSW M parameter - max connections per node in each layer
   * Higher values = better recall but more memory
   * @default 16
   */
  M?: number

  /**
   * HNSW efConstruction - size of dynamic candidate list during index building
   * Higher values = better index quality but slower builds
   * @default 200
   */
  efConstruction?: number

  /**
   * HNSW efSearch - size of dynamic candidate list during search
   * Higher values = better recall but slower searches
   * @default 64
   */
  efSearch?: number
}

/**
 * Options for creating a vector index
 */
export interface CreateVectorIndexOptions extends VectorIndexConfig {
  /**
   * Index name (optional, auto-generated if not provided)
   */
  indexName?: string

  /**
   * Whether to fail if index already exists
   * @default false (use IF NOT EXISTS)
   */
  failIfExists?: boolean
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/**
 * A single search result with ID, distance, and optional row data
 */
export interface SearchResult<T = Record<string, unknown>> {
  /**
   * The ID or primary key of the matched row
   */
  id: string | number

  /**
   * Distance from the query vector
   * Interpretation depends on metric:
   * - l2sq/l2: lower is more similar
   * - cosine: lower is more similar (0 = identical)
   * - ip: higher is more similar (more negative = less similar)
   */
  distance: number

  /**
   * Optional row data if requested
   */
  data?: T
}

/**
 * Options for k-NN search
 */
export interface SearchOptions {
  /**
   * Number of nearest neighbors to return
   * @default 10
   */
  k?: number

  /**
   * HNSW efSearch parameter for this query
   * Higher values = better recall but slower
   * Overrides index default
   */
  efSearch?: number

  /**
   * SQL WHERE clause to filter results before vector search
   * Example: "category = 'electronics'"
   */
  filter?: string

  /**
   * Additional columns to return with results
   * Example: ['title', 'description']
   */
  select?: string[]

  /**
   * Name of the ID/primary key column
   * @default 'id'
   */
  idColumn?: string
}

// ============================================================================
// INDEX STATS
// ============================================================================

/**
 * Statistics about a vector index
 */
export interface IndexStats {
  /**
   * Index name
   */
  name: string

  /**
   * Table the index is on
   */
  table: string

  /**
   * Column containing vectors
   */
  column: string

  /**
   * Number of vectors in the index
   */
  vectorCount: number

  /**
   * Vector dimensions
   */
  dimensions: number

  /**
   * Distance metric
   */
  metric: DistanceMetric

  /**
   * HNSW M parameter
   */
  M: number

  /**
   * HNSW efConstruction parameter
   */
  efConstruction: number

  /**
   * HNSW efSearch parameter (default for queries)
   */
  efSearch: number

  /**
   * Estimated memory usage in bytes
   */
  memoryBytes: number
}

// ============================================================================
// MEMORY ESTIMATION
// ============================================================================

/**
 * Parameters for memory estimation
 */
export interface MemoryEstimationParams {
  /**
   * Number of vectors
   */
  vectorCount: number

  /**
   * Vector dimensions
   */
  dimensions: number

  /**
   * HNSW M parameter
   * @default 16
   */
  M?: number
}

/**
 * Result of memory estimation
 */
export interface MemoryEstimation {
  /**
   * Estimated total memory in bytes
   */
  totalBytes: number

  /**
   * Estimated memory for vectors only
   */
  vectorBytes: number

  /**
   * Estimated memory for HNSW graph
   */
  graphBytes: number

  /**
   * Human-readable memory string (e.g., "1.5 GB")
   */
  humanReadable: string
}

// ============================================================================
// EXTENSION STATE
// ============================================================================

/**
 * State of the VSS extension
 */
export interface VSSExtensionState {
  /**
   * Whether the extension is loaded
   */
  loaded: boolean

  /**
   * Extension version if loaded
   */
  version?: string

  /**
   * Error if loading failed
   */
  error?: Error
}
