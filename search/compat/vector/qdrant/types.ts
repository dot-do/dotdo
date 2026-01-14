/**
 * @dotdo/qdrant types
 *
 * Qdrant-compatible type definitions for vector search
 * @see https://qdrant.tech/documentation/
 */

// ============================================================================
// CLIENT CONFIGURATION
// ============================================================================

/**
 * Qdrant client configuration
 */
export interface QdrantClientConfig {
  /** Qdrant server URL */
  url?: string
  /** API key for authentication */
  apiKey?: string
  /** Host (alternative to url) */
  host?: string
  /** Port number */
  port?: number
  /** Use HTTPS */
  https?: boolean
  /** Request timeout in ms */
  timeout?: number
}

// ============================================================================
// DISTANCE METRICS
// ============================================================================

/**
 * Distance metric for vector comparison
 */
export type Distance = 'Cosine' | 'Euclid' | 'Dot'

// ============================================================================
// COLLECTION TYPES
// ============================================================================

/**
 * Vector parameters configuration
 */
export interface VectorParams {
  /** Vector dimensionality */
  size: number
  /** Distance metric */
  distance: Distance
  /** Enable HNSW index */
  hnsw_config?: HnswConfig
  /** Quantization config */
  quantization_config?: QuantizationConfig
  /** Store vectors on disk */
  on_disk?: boolean
}

/**
 * HNSW index configuration
 */
export interface HnswConfig {
  /** Number of edges per node */
  m?: number
  /** Size of the dynamic list during construction */
  ef_construct?: number
  /** Full scan threshold */
  full_scan_threshold?: number
  /** Max indexing threads */
  max_indexing_threads?: number
  /** Store index on disk */
  on_disk?: boolean
  /** Payload index schema */
  payload_m?: number
}

/**
 * Quantization configuration
 */
export interface QuantizationConfig {
  /** Scalar quantization */
  scalar?: {
    type: 'int8'
    quantile?: number
    always_ram?: boolean
  }
  /** Product quantization */
  product?: {
    compression: 'x4' | 'x8' | 'x16' | 'x32' | 'x64'
    always_ram?: boolean
  }
  /** Binary quantization */
  binary?: {
    always_ram?: boolean
  }
}

/**
 * Collection configuration
 */
export interface CollectionConfig {
  /** Vector parameters */
  vectors?: VectorParams | Record<string, VectorParams>
  /** Shard number */
  shard_number?: number
  /** Replication factor */
  replication_factor?: number
  /** Write consistency factor */
  write_consistency_factor?: number
  /** On disk payload */
  on_disk_payload?: boolean
  /** HNSW config (deprecated, use vectors.hnsw_config) */
  hnsw_config?: HnswConfig
  /** WAL config */
  wal_config?: {
    wal_capacity_mb?: number
    wal_segments_ahead?: number
  }
  /** Optimizers config */
  optimizers_config?: {
    deleted_threshold?: number
    vacuum_min_vector_number?: number
    default_segment_number?: number
    max_segment_size?: number
    memmap_threshold?: number
    indexing_threshold?: number
    flush_interval_sec?: number
    max_optimization_threads?: number
  }
}

/**
 * Collection info
 */
export interface CollectionInfo {
  /** Collection status */
  status: 'green' | 'yellow' | 'red'
  /** Optimizer status */
  optimizer_status: 'ok' | 'error'
  /** Number of vectors */
  vectors_count: number
  /** Number of indexed vectors */
  indexed_vectors_count: number
  /** Number of points */
  points_count: number
  /** Number of segments */
  segments_count: number
  /** Collection configuration */
  config: CollectionConfig & { params: { vectors: VectorParams | Record<string, VectorParams> } }
  /** Payload schema */
  payload_schema: Record<string, PayloadSchemaInfo>
}

/**
 * Payload schema info
 */
export interface PayloadSchemaInfo {
  /** Data type */
  data_type: 'keyword' | 'integer' | 'float' | 'geo' | 'text' | 'bool' | 'datetime'
  /** Payload index parameters */
  params?: Record<string, unknown>
  /** Number of indexed points */
  points?: number
}

/**
 * Collections list response
 */
export interface CollectionsResponse {
  collections: Array<{ name: string }>
}

// ============================================================================
// POINT TYPES
// ============================================================================

/**
 * Point ID (string or number)
 */
export type PointId = string | number

/**
 * Payload (metadata) for a point
 */
export type Payload = Record<string, unknown>

/**
 * Point struct for upsert
 */
export interface PointStruct {
  /** Point ID */
  id: PointId
  /** Vector or named vectors */
  vector: number[] | Record<string, number[]>
  /** Payload (metadata) */
  payload?: Payload
}

/**
 * Point with payload and vector for retrieval
 */
export interface Record {
  /** Point ID */
  id: PointId
  /** Payload */
  payload?: Payload | null
  /** Vector */
  vector?: number[] | Record<string, number[]> | null
}

/**
 * Scored point from search
 */
export interface ScoredPoint {
  /** Point ID */
  id: PointId
  /** Version */
  version: number
  /** Similarity score */
  score: number
  /** Payload */
  payload?: Payload | null
  /** Vector */
  vector?: number[] | Record<string, number[]> | null
}

// ============================================================================
// FILTER TYPES
// ============================================================================

/**
 * Field condition for filtering
 */
export interface FieldCondition {
  key: string
  match?: MatchValue
  range?: RangeCondition
  geo_bounding_box?: GeoBoundingBox
  geo_radius?: GeoRadius
  geo_polygon?: GeoPolygon
  values_count?: ValuesCount
}

/**
 * Match value condition
 */
export interface MatchValue {
  value?: string | number | boolean
  text?: string
  any?: (string | number)[]
  except?: (string | number)[]
}

/**
 * Range condition
 */
export interface RangeCondition {
  lt?: number
  gt?: number
  lte?: number
  gte?: number
}

/**
 * Geo bounding box
 */
export interface GeoBoundingBox {
  top_left: GeoPoint
  bottom_right: GeoPoint
}

/**
 * Geo radius
 */
export interface GeoRadius {
  center: GeoPoint
  radius: number
}

/**
 * Geo polygon
 */
export interface GeoPolygon {
  exterior: { points: GeoPoint[] }
  interiors?: Array<{ points: GeoPoint[] }>
}

/**
 * Geo point
 */
export interface GeoPoint {
  lat: number
  lon: number
}

/**
 * Values count condition
 */
export interface ValuesCount {
  lt?: number
  gt?: number
  lte?: number
  gte?: number
}

/**
 * Has ID condition
 */
export interface HasIdCondition {
  has_id: PointId[]
}

/**
 * Is empty condition
 */
export interface IsEmptyCondition {
  is_empty: { key: string }
}

/**
 * Is null condition
 */
export interface IsNullCondition {
  is_null: { key: string }
}

/**
 * Nested filter condition
 */
export interface NestedCondition {
  nested: {
    key: string
    filter: Filter
  }
}

/**
 * Filter condition types
 */
export type Condition =
  | FieldCondition
  | HasIdCondition
  | IsEmptyCondition
  | IsNullCondition
  | NestedCondition
  | { filter: Filter }

/**
 * Filter for search and scroll operations
 */
export interface Filter {
  /** All conditions must match */
  must?: Condition[]
  /** At least one condition must match */
  should?: Condition[]
  /** No condition must match */
  must_not?: Condition[]
  /** Minimum should match count */
  min_should?: {
    conditions: Condition[]
    min_count: number
  }
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/**
 * Search request parameters
 */
export interface SearchRequest {
  /** Query vector */
  vector: number[] | { name: string; vector: number[] }
  /** Filter conditions */
  filter?: Filter
  /** Number of results to return */
  limit: number
  /** Offset for pagination */
  offset?: number
  /** Include payload in response */
  with_payload?: boolean | string[] | { include?: string[]; exclude?: string[] }
  /** Include vector in response */
  with_vector?: boolean | string[]
  /** Score threshold */
  score_threshold?: number
  /** Search parameters */
  params?: SearchParams
}

/**
 * Search parameters
 */
export interface SearchParams {
  /** HNSW ef parameter */
  hnsw_ef?: number
  /** Exact search (no ANN) */
  exact?: boolean
  /** Quantization parameters */
  quantization?: {
    ignore?: boolean
    rescore?: boolean
    oversampling?: number
  }
  /** Indexed only */
  indexed_only?: boolean
}

// ============================================================================
// RETRIEVE TYPES
// ============================================================================

/**
 * Retrieve request parameters
 */
export interface RetrieveRequest {
  /** Point IDs to retrieve */
  ids: PointId[]
  /** Include payload */
  with_payload?: boolean | string[] | { include?: string[]; exclude?: string[] }
  /** Include vector */
  with_vector?: boolean | string[]
}

// ============================================================================
// SCROLL TYPES
// ============================================================================

/**
 * Scroll request parameters
 */
export interface ScrollRequest {
  /** Filter conditions */
  filter?: Filter
  /** Number of results per page */
  limit?: number
  /** Offset point ID for pagination */
  offset?: PointId | null
  /** Include payload */
  with_payload?: boolean | string[] | { include?: string[]; exclude?: string[] }
  /** Include vector */
  with_vector?: boolean | string[]
  /** Order by field */
  order_by?: {
    key: string
    direction?: 'asc' | 'desc'
    start_from?: number | string
  }
}

/**
 * Scroll response
 */
export interface ScrollResponse {
  /** Retrieved points */
  points: Record[]
  /** Next page offset */
  next_page_offset: PointId | null
}

// ============================================================================
// COUNT TYPES
// ============================================================================

/**
 * Count request parameters
 */
export interface CountRequest {
  /** Filter conditions */
  filter?: Filter
  /** Exact count (slower but accurate) */
  exact?: boolean
}

/**
 * Count response
 */
export interface CountResponse {
  /** Number of points */
  count: number
}

// ============================================================================
// DELETE TYPES
// ============================================================================

/**
 * Points selector for delete
 */
export interface PointsSelector {
  /** Point IDs */
  points?: PointId[]
  /** Filter */
  filter?: Filter
}

// ============================================================================
// UPSERT TYPES
// ============================================================================

/**
 * Upsert request parameters
 */
export interface UpsertRequest {
  /** Points to upsert */
  points: PointStruct[]
  /** Wait for index update */
  wait?: boolean
  /** Ordering */
  ordering?: 'weak' | 'medium' | 'strong'
}

// ============================================================================
// OPERATION RESULT
// ============================================================================

/**
 * Operation result
 */
export interface OperationResult {
  /** Operation ID */
  operation_id?: number
  /** Status */
  status: 'acknowledged' | 'completed'
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Batch search request
 */
export interface BatchSearchRequest {
  searches: SearchRequest[]
}

// ============================================================================
// RECOMMEND TYPES
// ============================================================================

/**
 * Recommend request parameters
 */
export interface RecommendRequest {
  /** Positive examples (look for similar) */
  positive: PointId[]
  /** Negative examples (look for dissimilar) */
  negative?: PointId[]
  /** Filter conditions */
  filter?: Filter
  /** Number of results */
  limit: number
  /** Offset */
  offset?: number
  /** Include payload */
  with_payload?: boolean | string[]
  /** Include vector */
  with_vector?: boolean | string[]
  /** Score threshold */
  score_threshold?: number
  /** Using named vector */
  using?: string
  /** Lookup from another collection */
  lookup_from?: {
    collection: string
    vector?: string
  }
}
