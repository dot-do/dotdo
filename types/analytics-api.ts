/**
 * Analytics API Types
 *
 * Type definitions for the unified analytics API including:
 * - Vector search
 * - Point lookups (Iceberg)
 * - SQL queries (browser analytics)
 *
 * @module types/analytics-api
 * @see docs/plans/unified-analytics-architecture.md
 */

// ============================================================================
// QUERY CLASSIFICATION
// ============================================================================

/**
 * Query types supported by the analytics router
 */
export type QueryType = 'point_lookup' | 'vector_search' | 'analytics' | 'federated'

/**
 * Execution path for analytics queries
 * @see unified-analytics-architecture.md Part 3.1
 */
export type ExecutionPath =
  | 'point_lookup'      // Path A: Single record by ID (60-120ms)
  | 'browser_execute'   // Path B: DuckDB-WASM in browser (zero server compute)
  | 'federated_query'   // Path C: Multi-worker fan-out (300-500ms)

/**
 * Distance metric for vector similarity search
 */
export type DistanceMetric = 'cosine' | 'euclidean' | 'dot_product'

// ============================================================================
// VECTOR SEARCH TYPES
// ============================================================================

/**
 * Filter condition for vector search
 */
export interface VectorFilter {
  field: string
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin'
  value: string | number | boolean | (string | number | boolean)[]
}

/**
 * Vector search request
 * POST /v1/search
 */
export interface VectorSearchRequest {
  /** Query vector (required) - typically 768 or 1536 dimensions */
  query: number[]

  /** Number of results to return (default: 10, max: 1000) */
  k?: number

  /** Distance metric (default: cosine) */
  metric?: DistanceMetric

  /** Optional filters to apply before search */
  filters?: VectorFilter[]

  /** Optional namespace to search within */
  namespace?: string

  /** Include vector values in response (default: false) */
  includeVectors?: boolean

  /** Include metadata in response (default: true) */
  includeMetadata?: boolean

  /** Number of clusters to probe (default: 20, higher = more recall) */
  nprobe?: number
}

/**
 * Single vector search result
 */
export interface VectorSearchResult {
  /** Unique vector ID */
  id: string

  /** Distance/similarity score */
  score: number

  /** Associated metadata */
  metadata?: Record<string, unknown>

  /** Vector values (if includeVectors was true) */
  vector?: number[]
}

/**
 * Vector search response
 */
export interface VectorSearchResponse {
  /** Search results sorted by relevance */
  results: VectorSearchResult[]

  /** Query timing breakdown (ms) */
  timing: {
    total: number
    centroidSearch?: number
    clusterLoad?: number
    rerank?: number
  }

  /** Search statistics */
  stats: {
    clustersSearched: number
    vectorsScanned: number
    cacheHitRate: number
  }
}

// ============================================================================
// POINT LOOKUP TYPES
// ============================================================================

/**
 * Partition filter for point lookups
 */
export interface PartitionFilter {
  /** Namespace (tenant/org) */
  ns?: string

  /** Entity type */
  type?: string

  /** Date-based partition (YYYY-MM-DD) */
  date?: string

  /** Additional partition columns */
  [key: string]: string | number | undefined
}

/**
 * Point lookup request
 * GET /v1/lookup/:table/:key
 */
export interface PointLookupRequest {
  /** Table name */
  table: string

  /** Primary key value */
  key: string

  /** Optional partition hints for faster lookup */
  partition?: PartitionFilter

  /** Columns to return (default: all) */
  columns?: string[]
}

/**
 * Point lookup response
 */
export interface PointLookupResponse {
  /** Whether record was found */
  found: boolean

  /** Record data (if found) */
  data?: Record<string, unknown>

  /** Query timing (ms) */
  timing: {
    total: number
    metadataLookup: number
    partitionPrune: number
    dataFetch: number
  }

  /** Source information */
  source: {
    table: string
    partition: string
    file: string
  }
}

// ============================================================================
// SQL QUERY TYPES
// ============================================================================

/**
 * Client capabilities for browser execution
 */
export interface ClientCapabilities {
  /** DuckDB-WASM available */
  duckdbWasm: boolean

  /** Maximum memory available (MB) */
  maxMemoryMB: number

  /** OPFS available for caching */
  opfsAvailable: boolean

  /** WebWorker available */
  webWorkerAvailable?: boolean
}

/**
 * SQL query request
 * POST /v1/query
 */
export interface SQLQueryRequest {
  /** SQL query string */
  sql: string

  /** Execution hint (client-side or server-side) */
  executionHint?: 'client' | 'server' | 'auto'

  /** Client capabilities (for client-side execution) */
  clientCapabilities?: ClientCapabilities

  /** Query parameters for prepared statements */
  params?: (string | number | boolean | null)[]

  /** Maximum rows to return (default: 10000) */
  limit?: number

  /** Timeout in ms (default: 30000) */
  timeout?: number
}

/**
 * Data file reference for browser execution
 */
export interface DataFileRef {
  /** File identifier/name */
  name: string

  /** Presigned URL for direct download */
  url: string

  /** File size in bytes */
  size: number

  /** Row count estimate */
  rowCount: number

  /** Columns included */
  columns: string[]

  /** Cache key for OPFS */
  cacheKey: string
}

/**
 * Query plan for client-side execution
 */
export interface QueryPlan {
  /** Execution type */
  type: 'client_execute' | 'server_execute'

  /** Data files to download (for client execution) */
  dataFiles?: DataFileRef[]

  /** Optimized SQL with pushdown applied */
  optimizedSql?: string

  /** Estimated costs */
  estimates: {
    rowCount: number
    dataSizeBytes: number
    executionTimeMs: number
  }

  /** Pushdown filters applied */
  pushdownFilters?: string[]
}

/**
 * SQL query response (for server execution)
 */
export interface SQLQueryResponse {
  /** Query results */
  data: Record<string, unknown>[]

  /** Column metadata */
  columns: Array<{
    name: string
    type: string
  }>

  /** Row count returned */
  rowCount: number

  /** Whether results were truncated */
  truncated: boolean

  /** Query timing (ms) */
  timing: {
    total: number
    planning: number
    execution: number
    serialization: number
  }
}

/**
 * Query plan response (for client execution)
 */
export interface QueryPlanResponse {
  /** Execution plan */
  plan: QueryPlan

  /** Query timing (ms) */
  timing: {
    total: number
    planning: number
  }
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Error codes for analytics API
 */
export type AnalyticsErrorCode =
  | 'INVALID_QUERY'
  | 'INVALID_VECTOR'
  | 'TABLE_NOT_FOUND'
  | 'RECORD_NOT_FOUND'
  | 'QUERY_TIMEOUT'
  | 'QUERY_TOO_COMPLEX'
  | 'RESOURCE_EXHAUSTED'
  | 'INTERNAL_ERROR'

/**
 * Analytics API error response
 */
export interface AnalyticsError {
  code: AnalyticsErrorCode
  message: string
  details?: Record<string, unknown>
}

// ============================================================================
// TIMING & METRICS
// ============================================================================

/**
 * Search metrics for Analytics Engine
 */
export interface SearchMetrics {
  /** Total query latency (ms) */
  queryLatencyMs: number

  /** Centroid search phase (ms) */
  centroidSearchMs?: number

  /** Cluster loading phase (ms) */
  clusterLoadMs?: number

  /** Re-ranking phase (ms) */
  rerankMs?: number

  /** Number of clusters searched */
  clustersSearched: number

  /** Total vectors scanned */
  vectorsScanned: number

  /** Cache hit rate (0-1) */
  cacheHitRate: number

  /** Active shards queried */
  activeShardsQueried: number

  /** Total vectors in index */
  totalVectorsIndexed?: number
}

// ============================================================================
// DO STUB INTERFACES
// ============================================================================

/**
 * Vector Search Coordinator DO interface
 */
export interface VectorSearchCoordinatorStub {
  search(request: VectorSearchRequest): Promise<VectorSearchResponse>
}

/**
 * Iceberg Metadata DO interface
 */
export interface IcebergMetadataStub {
  getMetadata(table: string): Promise<IcebergTableMetadata>
  planQuery(sql: string): Promise<QueryPlan>
}

/**
 * Iceberg table metadata (simplified)
 */
export interface IcebergTableMetadata {
  tableUuid: string
  currentSnapshotId: number
  schemas: Array<{
    schemaId: number
    fields: Array<{
      id: number
      name: string
      type: string
    }>
  }>
  partitionSpecs: Array<{
    specId: number
    fields: Array<{
      name: string
      transform: string
      sourceId: number
    }>
  }>
  manifests: Array<{
    path: string
    partitionBounds: Record<string, { min: unknown; max: unknown }>
  }>
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Request validation result
 */
export interface ValidationResult<T> {
  valid: boolean
  data?: T
  errors?: string[]
}

/**
 * Query classification result
 */
export interface QueryClassification {
  type: QueryType
  executionPath: ExecutionPath
  estimatedCost: {
    computeMs: number
    dataSizeBytes: number
    monetaryCost: number
  }
}
