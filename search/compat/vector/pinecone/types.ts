/**
 * @dotdo/pinecone types
 *
 * Pinecone SDK-compatible type definitions
 * for the Pinecone vector database API backed by Durable Objects
 *
 * @see https://docs.pinecone.io/reference/typescript-sdk
 */

// ============================================================================
// CLIENT OPTIONS
// ============================================================================

/**
 * Configuration for the Pinecone client
 */
export interface PineconeConfiguration {
  /** API key for authentication */
  apiKey: string
  /** Optional environment (e.g., 'us-east1-gcp') */
  environment?: string
  /** Optional controller host override */
  controllerHostUrl?: string
  /** Optional fetch implementation */
  fetchApi?: typeof fetch
  /** Optional additional headers */
  additionalHeaders?: Record<string, string>
}

/**
 * Extended client options for DO backing
 */
export interface ExtendedPineconeConfiguration extends PineconeConfiguration {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
  /** Shard configuration */
  shard?: {
    algorithm?: 'consistent' | 'range' | 'hash'
    count?: number
  }
  /** Replica configuration */
  replica?: {
    readPreference?: 'primary' | 'secondary' | 'nearest'
    jurisdiction?: 'eu' | 'us' | 'fedramp'
  }
}

// ============================================================================
// INDEX TYPES
// ============================================================================

/**
 * Metric types for similarity calculation
 */
export type Metric = 'cosine' | 'euclidean' | 'dotproduct'

/**
 * Pod type for serverless indexes
 */
export type PodType = 'p1.x1' | 'p1.x2' | 'p1.x4' | 'p1.x8' | 's1.x1' | 's1.x2' | 's1.x4' | 's1.x8'

/**
 * Index status
 */
export type IndexStatus = 'Initializing' | 'ScalingUp' | 'ScalingDown' | 'Terminating' | 'Ready'

/**
 * Deletion protection status
 */
export type DeletionProtection = 'enabled' | 'disabled'

/**
 * Cloud provider
 */
export type Cloud = 'aws' | 'gcp' | 'azure'

/**
 * Spec for serverless indexes
 */
export interface ServerlessSpec {
  cloud: Cloud
  region: string
}

/**
 * Spec for pod-based indexes
 */
export interface PodSpec {
  environment: string
  replicas?: number
  shards?: number
  podType: PodType
  pods?: number
  metadataConfig?: {
    indexed?: string[]
  }
  sourceCollection?: string
}

/**
 * Index spec - either serverless or pod
 */
export interface IndexSpec {
  serverless?: ServerlessSpec
  pod?: PodSpec
}

/**
 * Index status details
 */
export interface IndexStatusDetails {
  ready: boolean
  state: IndexStatus
}

/**
 * Index model - represents a Pinecone index
 */
export interface IndexModel {
  name: string
  dimension: number
  metric: Metric
  host: string
  spec: IndexSpec
  status: IndexStatusDetails
  deletionProtection?: DeletionProtection
}

/**
 * Options for creating an index
 */
export interface CreateIndexOptions {
  name: string
  dimension: number
  metric?: Metric
  spec?: IndexSpec
  deletionProtection?: DeletionProtection
  /** Wait for index to be ready */
  waitUntilReady?: boolean
  /** Suppress conflicts if index already exists */
  suppressConflicts?: boolean
}

/**
 * Options for configuring an existing index
 */
export interface ConfigureIndexOptions {
  deletionProtection?: DeletionProtection
  replicas?: number
  podType?: PodType
}

/**
 * Index list response
 */
export interface IndexList {
  indexes?: IndexModel[]
}

// ============================================================================
// VECTOR TYPES
// ============================================================================

/**
 * Vector values - can be dense array or sparse representation
 */
export type RecordValues = number[]

/**
 * Sparse vector representation
 */
export interface RecordSparseValues {
  indices: number[]
  values: number[]
}

/**
 * Metadata for a vector record
 */
export type RecordMetadata = Record<string, RecordMetadataValue>

/**
 * Valid metadata value types
 */
export type RecordMetadataValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | null

/**
 * A vector record in Pinecone
 */
export interface PineconeRecord<T extends RecordMetadata = RecordMetadata> {
  id: string
  values: RecordValues
  sparseValues?: RecordSparseValues
  metadata?: T
}

/**
 * Scored vector returned from query
 */
export interface ScoredPineconeRecord<T extends RecordMetadata = RecordMetadata> {
  id: string
  score: number
  values?: RecordValues
  sparseValues?: RecordSparseValues
  metadata?: T
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Metadata filter operators
 */
export interface MetadataFilterOperators {
  $eq?: RecordMetadataValue
  $ne?: RecordMetadataValue
  $gt?: number
  $gte?: number
  $lt?: number
  $lte?: number
  $in?: RecordMetadataValue[]
  $nin?: RecordMetadataValue[]
  $exists?: boolean
}

/**
 * Metadata filter - can be a value, operators, or logical combination
 */
export type MetadataFilter = {
  [key: string]: RecordMetadataValue | MetadataFilterOperators | MetadataFilter
} | {
  $and?: MetadataFilter[]
  $or?: MetadataFilter[]
}

/**
 * Query options for vector search
 */
export interface QueryOptions<T extends RecordMetadata = RecordMetadata> {
  /** Query vector */
  vector?: RecordValues
  /** Sparse query vector */
  sparseVector?: RecordSparseValues
  /** Number of results to return */
  topK: number
  /** Metadata filter */
  filter?: MetadataFilter
  /** Include vector values in response */
  includeValues?: boolean
  /** Include metadata in response */
  includeMetadata?: boolean
  /** Query by ID instead of vector */
  id?: string
}

/**
 * Query response
 */
export interface QueryResponse<T extends RecordMetadata = RecordMetadata> {
  matches: ScoredPineconeRecord<T>[]
  namespace: string
  usage?: {
    readUnits: number
  }
}

// ============================================================================
// UPSERT TYPES
// ============================================================================

/**
 * Upsert response
 */
export interface UpsertResponse {
  upsertedCount: number
}

// ============================================================================
// FETCH TYPES
// ============================================================================

/**
 * Fetch response
 */
export interface FetchResponse<T extends RecordMetadata = RecordMetadata> {
  records: Record<string, PineconeRecord<T>>
  namespace: string
  usage?: {
    readUnits: number
  }
}

// ============================================================================
// DELETE TYPES
// ============================================================================

/**
 * Delete options
 */
export interface DeleteOptions {
  /** Delete specific IDs */
  ids?: string[]
  /** Delete all vectors in namespace */
  deleteAll?: boolean
  /** Delete vectors matching filter */
  filter?: MetadataFilter
}

/**
 * Delete response (empty on success)
 */
export type DeleteResponse = Record<string, never>

// ============================================================================
// UPDATE TYPES
// ============================================================================

/**
 * Update options
 */
export interface UpdateOptions<T extends RecordMetadata = RecordMetadata> {
  id: string
  values?: RecordValues
  sparseValues?: RecordSparseValues
  metadata?: T
}

/**
 * Update response (empty on success)
 */
export type UpdateResponse = Record<string, never>

// ============================================================================
// LIST TYPES
// ============================================================================

/**
 * List vectors options
 */
export interface ListOptions {
  /** Pagination token */
  paginationToken?: string
  /** Maximum number of IDs to return */
  limit?: number
  /** ID prefix filter */
  prefix?: string
}

/**
 * Vector ID in list response
 */
export interface VectorId {
  id: string
}

/**
 * List vectors response
 */
export interface ListResponse {
  vectors?: VectorId[]
  pagination?: {
    next?: string
  }
  namespace: string
  usage?: {
    readUnits: number
  }
}

// ============================================================================
// STATS TYPES
// ============================================================================

/**
 * Namespace statistics
 */
export interface NamespaceStats {
  vectorCount: number
}

/**
 * Index statistics
 */
export interface IndexStats {
  namespaces: Record<string, NamespaceStats>
  dimension: number
  indexFullness: number
  totalVectorCount: number
}

/**
 * Describe index stats response
 */
export interface DescribeIndexStatsResponse {
  namespaces: Record<string, NamespaceStats>
  dimension: number
  indexFullness: number
  totalVectorCount: number
}

// ============================================================================
// COLLECTION TYPES
// ============================================================================

/**
 * Collection status
 */
export type CollectionStatus = 'Initializing' | 'Ready' | 'Terminating'

/**
 * Collection model
 */
export interface CollectionModel {
  name: string
  size: number
  status: CollectionStatus
  dimension: number
  vectorCount: number
  environment: string
}

/**
 * Create collection options
 */
export interface CreateCollectionOptions {
  name: string
  source: string
}

/**
 * Collection list
 */
export interface CollectionList {
  collections?: CollectionModel[]
}

// ============================================================================
// NAMESPACE INTERFACE
// ============================================================================

/**
 * Namespace operations interface
 */
export interface IndexNamespace<T extends RecordMetadata = RecordMetadata> {
  /** Namespace name */
  readonly namespace: string

  /** Upsert vectors */
  upsert(vectors: PineconeRecord<T>[]): Promise<UpsertResponse>

  /** Query vectors */
  query(options: QueryOptions<T>): Promise<QueryResponse<T>>

  /** Fetch vectors by ID */
  fetch(ids: string[]): Promise<FetchResponse<T>>

  /** Update a vector */
  update(options: UpdateOptions<T>): Promise<UpdateResponse>

  /** Delete vectors */
  delete(options: DeleteOptions): Promise<DeleteResponse>

  /** Delete one vector by ID (convenience method) */
  deleteOne(id: string): Promise<DeleteResponse>

  /** Delete many vectors by IDs (convenience method) */
  deleteMany(ids: string[]): Promise<DeleteResponse>

  /** Delete all vectors in namespace */
  deleteAll(): Promise<DeleteResponse>

  /** List vector IDs */
  listPaginated(options?: ListOptions): Promise<ListResponse>

  /** Describe index stats for this namespace */
  describeIndexStats(filter?: MetadataFilter): Promise<DescribeIndexStatsResponse>
}

// ============================================================================
// INDEX INTERFACE
// ============================================================================

/**
 * Index operations interface - the main interface for vector operations
 */
export interface Index<T extends RecordMetadata = RecordMetadata> extends IndexNamespace<T> {
  /** Get a namespace handle */
  namespace(name: string): IndexNamespace<T>

  /** Describe index stats */
  describeIndexStats(filter?: MetadataFilter): Promise<DescribeIndexStatsResponse>
}

// ============================================================================
// PINECONE CLIENT INTERFACE
// ============================================================================

/**
 * Pinecone client interface
 */
export interface PineconeClient {
  /** Get an index handle */
  index<T extends RecordMetadata = RecordMetadata>(name: string): Index<T>

  /** Create a new index */
  createIndex(options: CreateIndexOptions): Promise<IndexModel>

  /** Delete an index */
  deleteIndex(name: string): Promise<void>

  /** List all indexes */
  listIndexes(): Promise<IndexList>

  /** Describe an index */
  describeIndex(name: string): Promise<IndexModel>

  /** Configure an index */
  configureIndex(name: string, options: ConfigureIndexOptions): Promise<IndexModel>

  /** Create a collection from an index */
  createCollection(options: CreateCollectionOptions): Promise<CollectionModel>

  /** List all collections */
  listCollections(): Promise<CollectionList>

  /** Describe a collection */
  describeCollection(name: string): Promise<CollectionModel>

  /** Delete a collection */
  deleteCollection(name: string): Promise<void>
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base Pinecone error
 */
export class PineconeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PineconeError'
  }
}

/**
 * Configuration error
 */
export class PineconeConfigurationError extends PineconeError {
  constructor(message: string) {
    super(message)
    this.name = 'PineconeConfigurationError'
  }
}

/**
 * Connection error
 */
export class PineconeConnectionError extends PineconeError {
  constructor(message: string) {
    super(message)
    this.name = 'PineconeConnectionError'
  }
}

/**
 * Not found error
 */
export class PineconeNotFoundError extends PineconeError {
  constructor(message: string) {
    super(message)
    this.name = 'PineconeNotFoundError'
  }
}

/**
 * Conflict error (e.g., index already exists)
 */
export class PineconeConflictError extends PineconeError {
  constructor(message: string) {
    super(message)
    this.name = 'PineconeConflictError'
  }
}

/**
 * Validation error
 */
export class PineconeValidationError extends PineconeError {
  constructor(message: string) {
    super(message)
    this.name = 'PineconeValidationError'
  }
}

/**
 * Request failed error
 */
export class PineconeRequestError extends PineconeError {
  status?: number
  body?: unknown

  constructor(message: string, status?: number, body?: unknown) {
    super(message)
    this.name = 'PineconeRequestError'
    this.status = status
    this.body = body
  }
}
