/**
 * Pinecone Compat Types
 *
 * Type definitions matching the official Pinecone SDK.
 * These types enable drop-in replacement of @pinecone-database/pinecone.
 *
 * @see https://docs.pinecone.io/reference/api/introduction
 */

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base error class for Pinecone operations
 */
export class PineconeError extends Error {
  constructor(
    message: string,
    public code?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'PineconeError'
  }
}

/**
 * Error when index is not found
 */
export class IndexNotFoundError extends PineconeError {
  constructor(indexName: string) {
    super(`Index '${indexName}' not found`, 'INDEX_NOT_FOUND')
    this.name = 'IndexNotFoundError'
  }
}

/**
 * Error when index already exists
 */
export class IndexAlreadyExistsError extends PineconeError {
  constructor(indexName: string) {
    super(`Index '${indexName}' already exists`, 'INDEX_ALREADY_EXISTS')
    this.name = 'IndexAlreadyExistsError'
  }
}

/**
 * Error when namespace is not found
 */
export class NamespaceNotFoundError extends PineconeError {
  constructor(namespace: string) {
    super(`Namespace '${namespace}' not found`, 'NAMESPACE_NOT_FOUND')
    this.name = 'NamespaceNotFoundError'
  }
}

/**
 * Error when vector dimension mismatch occurs
 */
export class DimensionMismatchError extends PineconeError {
  constructor(expected: number, actual: number) {
    super(
      `Vector dimension mismatch: expected ${expected}, got ${actual}`,
      'DIMENSION_MISMATCH'
    )
    this.name = 'DimensionMismatchError'
  }
}

/**
 * Error for invalid API key
 */
export class InvalidApiKeyError extends PineconeError {
  constructor() {
    super('Invalid API key', 'INVALID_API_KEY')
    this.name = 'InvalidApiKeyError'
  }
}

// ============================================================================
// INDEX CONFIGURATION
// ============================================================================

/**
 * Distance metric for vector similarity
 */
export type DistanceMetric = 'cosine' | 'euclidean' | 'dotproduct'

/**
 * Pod type for index deployment (for compatibility)
 */
export type PodType = 'p1.x1' | 'p1.x2' | 'p1.x4' | 'p1.x8' | 's1.x1' | 's1.x2' | 's1.x4' | 's1.x8'

/**
 * Index status
 */
export type IndexStatus = 'Initializing' | 'ScalingUp' | 'ScalingDown' | 'Terminating' | 'Ready'

/**
 * Pod-based index configuration
 */
export interface PodSpec {
  /** Pod type and size */
  pod_type: PodType
  /** Number of pods */
  pods?: number
  /** Number of replicas */
  replicas?: number
  /** Shards per pod */
  shards?: number
  /** Metadata config for selective indexing */
  metadata_config?: {
    indexed?: string[]
  }
  /** Source collection for seeding (optional) */
  source_collection?: string
}

/**
 * Serverless index configuration
 */
export interface ServerlessSpec {
  /** Cloud provider */
  cloud: 'aws' | 'gcp' | 'azure'
  /** Region */
  region: string
}

/**
 * Configuration for creating an index
 */
export interface CreateIndexOptions {
  /** Index name */
  name: string
  /** Vector dimensions */
  dimension: number
  /** Distance metric (default: cosine) */
  metric?: DistanceMetric
  /** Pod specification (mutually exclusive with serverless) */
  spec?: {
    pod?: PodSpec
    serverless?: ServerlessSpec
  }
  /** Deletion protection */
  deletion_protection?: 'enabled' | 'disabled'
}

/**
 * Index description
 */
export interface IndexDescription {
  /** Index name */
  name: string
  /** Vector dimensions */
  dimension: number
  /** Distance metric */
  metric: DistanceMetric
  /** Host URL */
  host: string
  /** Index specification */
  spec: {
    pod?: PodSpec
    serverless?: ServerlessSpec
  }
  /** Index status */
  status: {
    ready: boolean
    state: IndexStatus
  }
  /** Deletion protection */
  deletion_protection?: 'enabled' | 'disabled'
}

/**
 * Index statistics
 */
export interface IndexStats {
  /** Total vector count */
  totalVectorCount: number
  /** Namespace statistics */
  namespaces: Record<string, NamespaceStats>
  /** Vector dimensions */
  dimension: number
  /** Percentage of index fullness */
  indexFullness: number
}

/**
 * Namespace statistics
 */
export interface NamespaceStats {
  /** Vector count in namespace */
  vectorCount: number
}

// ============================================================================
// VECTOR TYPES
// ============================================================================

/**
 * Vector for upsert operations
 */
export interface Vector {
  /** Unique vector ID */
  id: string
  /** Vector values (embedding) */
  values: number[]
  /** Sparse vector values (optional) */
  sparseValues?: SparseValues
  /** Metadata associated with vector */
  metadata?: RecordMetadata
}

/**
 * Sparse vector representation
 */
export interface SparseValues {
  /** Indices of non-zero values */
  indices: number[]
  /** Non-zero values */
  values: number[]
}

/**
 * Vector metadata (flexible key-value pairs)
 */
export type RecordMetadata = Record<string, MetadataValue>

/**
 * Allowed metadata value types
 */
export type MetadataValue =
  | string
  | number
  | boolean
  | string[]
  | null

/**
 * Scored vector from query results
 */
export interface ScoredVector {
  /** Vector ID */
  id: string
  /** Similarity score */
  score: number
  /** Vector values (if includeValues is true) */
  values?: number[]
  /** Sparse vector values (if applicable) */
  sparseValues?: SparseValues
  /** Metadata (if includeMetadata is true) */
  metadata?: RecordMetadata
}

/**
 * Fetched vector record
 */
export interface FetchedVector {
  /** Vector ID */
  id: string
  /** Vector values */
  values: number[]
  /** Sparse vector values */
  sparseValues?: SparseValues
  /** Metadata */
  metadata?: RecordMetadata
}

// ============================================================================
// OPERATION OPTIONS
// ============================================================================

/**
 * Options for upsert operation
 */
export interface UpsertOptions {
  /** Namespace to upsert into (default: '') */
  namespace?: string
}

/**
 * Options for query operation
 */
export interface QueryOptions {
  /** Query vector values */
  vector?: number[]
  /** Query sparse vector values */
  sparseVector?: SparseValues
  /** Number of results to return */
  topK: number
  /** Filter by metadata */
  filter?: MetadataFilter
  /** Include vector values in response */
  includeValues?: boolean
  /** Include metadata in response */
  includeMetadata?: boolean
  /** Namespace to query */
  namespace?: string
  /** ID to use as query (alternative to vector) */
  id?: string
}

/**
 * Metadata filter for queries
 */
export type MetadataFilter = Record<string, MetadataFilterValue>

/**
 * Filter value types
 */
export type MetadataFilterValue =
  | string
  | number
  | boolean
  | { $eq?: MetadataValue }
  | { $ne?: MetadataValue }
  | { $gt?: number }
  | { $gte?: number }
  | { $lt?: number }
  | { $lte?: number }
  | { $in?: MetadataValue[] }
  | { $nin?: MetadataValue[] }
  | { $exists?: boolean }
  | { $and?: MetadataFilter[] }
  | { $or?: MetadataFilter[] }

/**
 * Options for fetch operation
 */
export interface FetchOptions {
  /** Vector IDs to fetch */
  ids: string[]
  /** Namespace to fetch from */
  namespace?: string
}

/**
 * Options for delete operation
 */
export interface DeleteOptions {
  /** Delete specific IDs */
  ids?: string[]
  /** Delete all vectors matching filter */
  filter?: MetadataFilter
  /** Delete all vectors in namespace */
  deleteAll?: boolean
  /** Namespace to delete from */
  namespace?: string
}

/**
 * Options for update operation
 */
export interface UpdateOptions {
  /** Vector ID to update */
  id: string
  /** New vector values */
  values?: number[]
  /** New sparse vector values */
  sparseValues?: SparseValues
  /** Metadata to set (replaces existing) */
  setMetadata?: RecordMetadata
  /** Namespace */
  namespace?: string
}

/**
 * Options for list operation
 */
export interface ListOptions {
  /** Pagination token */
  paginationToken?: string
  /** Limit results */
  limit?: number
  /** ID prefix filter */
  prefix?: string
  /** Namespace to list from */
  namespace?: string
}

// ============================================================================
// OPERATION RESPONSES
// ============================================================================

/**
 * Response from upsert operation
 */
export interface UpsertResponse {
  /** Number of vectors upserted */
  upsertedCount: number
}

/**
 * Response from query operation
 */
export interface QueryResponse {
  /** Matching vectors with scores */
  matches: ScoredVector[]
  /** Namespace queried */
  namespace: string
  /** Usage statistics */
  usage?: {
    readUnits: number
  }
}

/**
 * Response from fetch operation
 */
export interface FetchResponse {
  /** Fetched vectors by ID */
  vectors: Record<string, FetchedVector>
  /** Namespace */
  namespace: string
  /** Usage statistics */
  usage?: {
    readUnits: number
  }
}

/**
 * Response from delete operation
 */
export interface DeleteResponse {
  /** Empty response on success */
}

/**
 * Response from list operation
 */
export interface ListResponse {
  /** Vector summaries (id only) */
  vectors?: Array<{ id: string }>
  /** Pagination info */
  pagination?: {
    next?: string
  }
  /** Namespace */
  namespace: string
  /** Usage statistics */
  usage?: {
    readUnits: number
  }
}

/**
 * Response from update operation
 */
export interface UpdateResponse {
  /** Empty response on success */
}

// ============================================================================
// CLIENT INTERFACES
// ============================================================================

/**
 * Configuration options for Pinecone client
 */
export interface PineconeClientConfig {
  /** API key (required) */
  apiKey: string
  /** Controller host URL (optional, for self-hosted) */
  controllerHostUrl?: string
}

/**
 * Index operations interface
 */
export interface Index {
  /** Namespace targeting */
  namespace(namespace: string): IndexNamespace
  /** Get index description */
  describeIndexStats(): Promise<IndexStats>
  /** Upsert vectors */
  upsert(vectors: Vector[], options?: UpsertOptions): Promise<UpsertResponse>
  /** Query vectors */
  query(options: QueryOptions): Promise<QueryResponse>
  /** Fetch vectors by ID */
  fetch(ids: string[], options?: Omit<FetchOptions, 'ids'>): Promise<FetchResponse>
  /** Delete vectors */
  delete(options: DeleteOptions): Promise<DeleteResponse>
  /** Update a vector */
  update(options: UpdateOptions): Promise<UpdateResponse>
  /** List vector IDs */
  listPaginated(options?: ListOptions): Promise<ListResponse>
}

/**
 * Namespaced index operations
 */
export interface IndexNamespace {
  /** Upsert vectors */
  upsert(vectors: Vector[]): Promise<UpsertResponse>
  /** Query vectors */
  query(options: Omit<QueryOptions, 'namespace'>): Promise<QueryResponse>
  /** Fetch vectors by ID */
  fetch(ids: string[]): Promise<FetchResponse>
  /** Delete vectors */
  delete(options: Omit<DeleteOptions, 'namespace'>): Promise<DeleteResponse>
  /** Update a vector */
  update(options: Omit<UpdateOptions, 'namespace'>): Promise<UpdateResponse>
  /** List vector IDs */
  listPaginated(options?: Omit<ListOptions, 'namespace'>): Promise<ListResponse>
}

/**
 * Pinecone client interface
 */
export interface PineconeClient {
  /** Create a new index */
  createIndex(options: CreateIndexOptions): Promise<void>
  /** Delete an index */
  deleteIndex(indexName: string): Promise<void>
  /** Describe an index */
  describeIndex(indexName: string): Promise<IndexDescription>
  /** List all indices */
  listIndexes(): Promise<{ indexes: Array<{ name: string; dimension: number; metric: DistanceMetric; host: string }> }>
  /** Get an index for operations */
  index(indexName: string): Index
  /** Configure index (for compatibility) */
  configureIndex(indexName: string, options: { deletionProtection?: 'enabled' | 'disabled' }): Promise<void>
}
