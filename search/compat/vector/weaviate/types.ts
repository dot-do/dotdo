/**
 * @dotdo/weaviate types
 *
 * Weaviate-compatible type definitions for vector database operations
 * @see https://weaviate.io/developers/weaviate/client-libraries/typescript
 */

// ============================================================================
// CLIENT TYPES
// ============================================================================

/**
 * Weaviate client configuration
 */
export interface WeaviateClientConfig {
  /** URL scheme (http/https) */
  scheme?: string
  /** Weaviate host */
  host: string
  /** API key for authentication */
  apiKey?: string
  /** Headers to include in requests */
  headers?: Record<string, string>
}

// ============================================================================
// SCHEMA TYPES
// ============================================================================

/**
 * Weaviate data types
 */
export type WeaviateDataType =
  | 'text'
  | 'text[]'
  | 'int'
  | 'int[]'
  | 'number'
  | 'number[]'
  | 'boolean'
  | 'boolean[]'
  | 'date'
  | 'date[]'
  | 'uuid'
  | 'uuid[]'
  | 'blob'
  | 'geoCoordinates'
  | 'phoneNumber'

/**
 * Property definition in a class schema
 */
export interface WeaviateProperty {
  /** Property name */
  name: string
  /** Data type */
  dataType: WeaviateDataType[]
  /** Property description */
  description?: string
  /** Index settings */
  indexFilterable?: boolean
  indexSearchable?: boolean
  /** Tokenization for text fields */
  tokenization?: 'word' | 'lowercase' | 'whitespace' | 'field' | 'trigram' | 'gse'
  /** Module-specific config */
  moduleConfig?: Record<string, unknown>
}

/**
 * Vectorizer configuration
 */
export type WeaviateVectorizer =
  | 'none'
  | 'text2vec-openai'
  | 'text2vec-cohere'
  | 'text2vec-huggingface'
  | 'text2vec-palm'
  | 'text2vec-transformers'
  | 'img2vec-neural'
  | 'multi2vec-clip'
  | 'ref2vec-centroid'

/**
 * Vector index configuration
 */
export interface VectorIndexConfig {
  /** Distance metric */
  distance?: 'cosine' | 'dot' | 'l2-squared' | 'hamming' | 'manhattan'
  /** HNSW-specific config */
  ef?: number
  efConstruction?: number
  maxConnections?: number
  /** PQ config */
  pq?: {
    enabled?: boolean
    segments?: number
    centroids?: number
    encoder?: { type: string; distribution: string }
  }
}

/**
 * Inverted index configuration
 */
export interface InvertedIndexConfig {
  bm25?: {
    b?: number
    k1?: number
  }
  cleanupIntervalSeconds?: number
  indexNullState?: boolean
  indexPropertyLength?: boolean
  indexTimestamps?: boolean
  stopwords?: {
    preset?: string
    additions?: string[]
    removals?: string[]
  }
}

/**
 * Class definition for schema
 */
export interface WeaviateClass {
  /** Class name (PascalCase) */
  class: string
  /** Class description */
  description?: string
  /** Vectorizer module */
  vectorizer?: WeaviateVectorizer
  /** Module configuration */
  moduleConfig?: Record<string, unknown>
  /** Vector index type */
  vectorIndexType?: 'hnsw' | 'flat' | 'dynamic'
  /** Vector index configuration */
  vectorIndexConfig?: VectorIndexConfig
  /** Inverted index configuration */
  invertedIndexConfig?: InvertedIndexConfig
  /** Properties (fields) */
  properties?: WeaviateProperty[]
  /** Replication configuration */
  replicationConfig?: {
    factor?: number
  }
  /** Sharding configuration */
  shardingConfig?: {
    virtualPerPhysical?: number
    desiredCount?: number
    desiredVirtualCount?: number
  }
  /** Multi-tenancy configuration */
  multiTenancyConfig?: {
    enabled?: boolean
  }
}

/**
 * Schema response
 */
export interface WeaviateSchema {
  classes: WeaviateClass[]
}

// ============================================================================
// DATA OBJECT TYPES
// ============================================================================

/**
 * Weaviate data object
 */
export interface WeaviateObject {
  /** Object ID (UUID) */
  id?: string
  /** Class name */
  class: string
  /** Object properties */
  properties: Record<string, unknown>
  /** Vector embedding */
  vector?: number[]
  /** Tenant name (for multi-tenancy) */
  tenant?: string
  /** Creation timestamp */
  creationTimeUnix?: number
  /** Last update timestamp */
  lastUpdateTimeUnix?: number
  /** Additional metadata */
  additional?: WeaviateAdditional
}

/**
 * Additional metadata returned with objects
 */
export interface WeaviateAdditional {
  /** Object ID */
  id?: string
  /** Vector embedding */
  vector?: number[]
  /** Creation time */
  creationTimeUnix?: number
  /** Last update time */
  lastUpdateTimeUnix?: number
  /** Distance/certainty scores */
  distance?: number
  certainty?: number
  score?: number
  /** Explanation (for BM25) */
  explainScore?: string
  /** Feature projection */
  featureProjection?: {
    vector?: number[]
  }
  /** Classification info */
  classification?: {
    basedOn?: string[]
    classifiedFields?: string[]
    completed?: string
    id?: string
    scope?: string[]
  }
  /** Generate module output */
  generate?: {
    singleResult?: string
    groupedResult?: string
    error?: string
  }
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/**
 * Near vector search parameters
 */
export interface NearVectorParams {
  /** Vector to search near */
  vector: number[]
  /** Minimum certainty (0-1) */
  certainty?: number
  /** Maximum distance */
  distance?: number
}

/**
 * Near text search parameters
 */
export interface NearTextParams {
  /** Text concepts to search for */
  concepts: string[]
  /** Move towards concepts */
  moveTo?: {
    concepts?: string[]
    objects?: Array<{ id: string; beacon?: string }>
    force?: number
  }
  /** Move away from concepts */
  moveAwayFrom?: {
    concepts?: string[]
    objects?: Array<{ id: string; beacon?: string }>
    force?: number
  }
  /** Minimum certainty */
  certainty?: number
  /** Maximum distance */
  distance?: number
}

/**
 * Near object search parameters
 */
export interface NearObjectParams {
  /** Object ID to search near */
  id: string
  /** Object beacon */
  beacon?: string
  /** Minimum certainty */
  certainty?: number
  /** Maximum distance */
  distance?: number
}

/**
 * BM25 keyword search parameters
 */
export interface Bm25Params {
  /** Search query */
  query: string
  /** Properties to search in */
  properties?: string[]
}

/**
 * Hybrid search parameters
 */
export interface HybridParams {
  /** Search query */
  query: string
  /** Vector for dense search */
  vector?: number[]
  /** Weighting factor (0=pure keyword, 1=pure vector) */
  alpha?: number
  /** Fusion algorithm */
  fusionType?: 'rankedFusion' | 'relativeScoreFusion'
  /** Properties for keyword search */
  properties?: string[]
}

/**
 * Where filter operators
 */
export type WhereOperator =
  | 'And'
  | 'Or'
  | 'Equal'
  | 'NotEqual'
  | 'GreaterThan'
  | 'GreaterThanEqual'
  | 'LessThan'
  | 'LessThanEqual'
  | 'Like'
  | 'WithinGeoRange'
  | 'IsNull'
  | 'ContainsAny'
  | 'ContainsAll'

/**
 * Where filter clause
 */
export interface WhereFilter {
  operator: WhereOperator
  operands?: WhereFilter[]
  path?: string[]
  valueInt?: number
  valueNumber?: number
  valueBoolean?: boolean
  valueString?: string
  valueText?: string
  valueDate?: string
  valueGeoRange?: {
    geoCoordinates: { latitude: number; longitude: number }
    distance: { max: number }
  }
  valueIntArray?: number[]
  valueNumberArray?: number[]
  valueBooleanArray?: boolean[]
  valueStringArray?: string[]
  valueTextArray?: string[]
  valueDateArray?: string[]
}

/**
 * Sort specification
 */
export interface SortSpec {
  path: string[]
  order?: 'asc' | 'desc'
}

/**
 * GraphQL response wrapper
 */
export interface GraphQLResponse<T = unknown> {
  data?: {
    Get?: Record<string, T[]>
    Aggregate?: Record<string, unknown>
  }
  errors?: Array<{
    message: string
    path?: string[]
    locations?: Array<{ line: number; column: number }>
  }>
}

// ============================================================================
// BATCH TYPES
// ============================================================================

/**
 * Batch import result
 */
export interface BatchResult {
  id: string
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  errors?: Array<{ message: string }>
}

/**
 * Batch delete result
 */
export interface BatchDeleteResult {
  matches: number
  limit: number
  successful: number
  failed: number
  objects?: Array<{
    id: string
    status: 'SUCCESS' | 'FAILED'
    errors?: Array<{ message: string }>
  }>
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

/**
 * Internal storage for classes
 */
export interface InternalClass extends WeaviateClass {
  objects: Map<string, WeaviateObject>
}

/**
 * Internal database state
 */
export interface WeaviateDB {
  classes: Map<string, InternalClass>
  config: WeaviateClientConfig
}
