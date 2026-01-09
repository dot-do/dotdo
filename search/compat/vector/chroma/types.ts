/**
 * @dotdo/chroma types
 *
 * Chroma SDK-compatible type definitions
 * for the Chroma vector database API backed by Durable Objects
 *
 * @see https://docs.trychroma.com/reference/js-client
 */

// ============================================================================
// CLIENT OPTIONS
// ============================================================================

/**
 * Configuration for the ChromaClient
 */
export interface ChromaClientParams {
  /** Server URL (default: http://localhost:8000) */
  path?: string
  /** Tenant name */
  tenant?: string
  /** Database name */
  database?: string
  /** Authentication header */
  auth?: AuthOptions
  /** Optional fetch implementation */
  fetchOptions?: RequestInit
}

/**
 * Authentication options
 */
export interface AuthOptions {
  provider?: 'token' | 'basic'
  credentials?: string
}

// ============================================================================
// METADATA TYPES
// ============================================================================

/**
 * Metadata value types
 */
export type MetadataValue = string | number | boolean

/**
 * Metadata object
 */
export type Metadata = Record<string, MetadataValue>

// ============================================================================
// EMBEDDING TYPES
// ============================================================================

/**
 * Embedding vector
 */
export type Embedding = number[]

/**
 * Array of embeddings
 */
export type Embeddings = Embedding[]

// ============================================================================
// WHERE FILTER TYPES
// ============================================================================

/**
 * Where filter operators
 */
export interface WhereOperators {
  $eq?: MetadataValue
  $ne?: MetadataValue
  $gt?: number
  $gte?: number
  $lt?: number
  $lte?: number
  $in?: MetadataValue[]
  $nin?: MetadataValue[]
}

/**
 * Logical operators for where filters
 */
export interface WhereLogicalOperators {
  $and?: Where[]
  $or?: Where[]
}

/**
 * Where filter - can be field conditions or logical operators
 */
export type Where = WhereLogicalOperators | {
  [key: string]: MetadataValue | WhereOperators
}

// ============================================================================
// WHERE DOCUMENT FILTER TYPES
// ============================================================================

/**
 * Document filter operators
 */
export interface WhereDocumentOperators {
  $contains?: string
  $not_contains?: string
}

/**
 * Document logical operators
 */
export interface WhereDocumentLogicalOperators {
  $and?: WhereDocument[]
  $or?: WhereDocument[]
}

/**
 * Where document filter
 */
export type WhereDocument = WhereDocumentOperators | WhereDocumentLogicalOperators

// ============================================================================
// INCLUDE TYPES
// ============================================================================

/**
 * Fields to include in responses
 */
export type IncludeEnum = 'documents' | 'embeddings' | 'metadatas' | 'distances'

// ============================================================================
// COLLECTION TYPES
// ============================================================================

/**
 * Collection model returned from API
 */
export interface CollectionModel {
  id: string
  name: string
  metadata?: Metadata | null
  tenant?: string
  database?: string
}

/**
 * Options for creating a collection
 */
export interface CreateCollectionParams {
  name: string
  metadata?: Metadata
  embeddingFunction?: EmbeddingFunction
}

/**
 * Options for getting a collection
 */
export interface GetCollectionParams {
  name: string
  embeddingFunction?: EmbeddingFunction
}

/**
 * Options for deleting a collection
 */
export interface DeleteCollectionParams {
  name: string
}

/**
 * Options for modifying a collection
 */
export interface ModifyCollectionParams {
  name?: string
  metadata?: Metadata
}

// ============================================================================
// ADD/UPDATE/UPSERT TYPES
// ============================================================================

/**
 * Options for adding documents
 */
export interface AddParams {
  ids: string[]
  embeddings?: Embeddings
  metadatas?: (Metadata | null)[]
  documents?: (string | null)[]
}

/**
 * Options for updating documents
 */
export interface UpdateParams {
  ids: string[]
  embeddings?: Embeddings
  metadatas?: (Metadata | null)[]
  documents?: (string | null)[]
}

/**
 * Options for upserting documents
 */
export interface UpsertParams {
  ids: string[]
  embeddings?: Embeddings
  metadatas?: (Metadata | null)[]
  documents?: (string | null)[]
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Options for querying documents
 */
export interface QueryParams {
  queryEmbeddings: Embeddings
  nResults?: number
  where?: Where
  whereDocument?: WhereDocument
  include?: IncludeEnum[]
}

/**
 * Query response
 */
export interface QueryResponse {
  ids: string[][]
  embeddings?: (Embedding | null)[][] | null | undefined
  documents?: (string | null)[][] | null | undefined
  metadatas?: (Metadata | null)[][] | null | undefined
  distances?: number[][] | null | undefined
}

// ============================================================================
// GET TYPES
// ============================================================================

/**
 * Options for getting documents
 */
export interface GetParams {
  ids?: string[]
  where?: Where
  whereDocument?: WhereDocument
  limit?: number
  offset?: number
  include?: IncludeEnum[]
}

/**
 * Get response
 */
export interface GetResponse {
  ids: string[]
  embeddings?: (Embedding | null)[] | null
  documents?: (string | null)[] | null
  metadatas?: (Metadata | null)[] | null
}

// ============================================================================
// DELETE TYPES
// ============================================================================

/**
 * Options for deleting documents
 */
export interface DeleteParams {
  ids?: string[]
  where?: Where
  whereDocument?: WhereDocument
}

// ============================================================================
// PEEK TYPES
// ============================================================================

/**
 * Options for peeking documents
 */
export interface PeekParams {
  limit?: number
}

// ============================================================================
// EMBEDDING FUNCTION
// ============================================================================

/**
 * Embedding function interface
 */
export interface EmbeddingFunction {
  generate(texts: string[]): Promise<Embeddings>
}

// ============================================================================
// COLLECTION INTERFACE
// ============================================================================

/**
 * Collection interface - main interface for document operations
 */
export interface Collection {
  /** Collection ID */
  readonly id: string
  /** Collection name */
  readonly name: string
  /** Collection metadata */
  readonly metadata?: Metadata | null

  /** Add documents to the collection */
  add(params: AddParams): Promise<void>

  /** Query the collection for similar documents */
  query(params: QueryParams): Promise<QueryResponse>

  /** Get documents by ID or filter */
  get(params: GetParams): Promise<GetResponse>

  /** Update existing documents */
  update(params: UpdateParams): Promise<void>

  /** Upsert documents (insert or update) */
  upsert(params: UpsertParams): Promise<void>

  /** Delete documents */
  delete(params: DeleteParams): Promise<void>

  /** Get document count */
  count(): Promise<number>

  /** Modify collection properties */
  modify(params: ModifyCollectionParams): Promise<void>

  /** Peek at first N documents */
  peek(params?: PeekParams): Promise<GetResponse>
}

// ============================================================================
// CLIENT INTERFACE
// ============================================================================

/**
 * ChromaClient interface
 */
export interface ChromaClientInterface {
  /** Create a new collection */
  createCollection(params: CreateCollectionParams): Promise<Collection>

  /** Get an existing collection */
  getCollection(params: GetCollectionParams): Promise<Collection>

  /** Get or create a collection */
  getOrCreateCollection(params: CreateCollectionParams): Promise<Collection>

  /** Delete a collection */
  deleteCollection(params: DeleteCollectionParams): Promise<void>

  /** List all collections */
  listCollections(): Promise<CollectionModel[]>

  /** Count collections */
  countCollections(): Promise<number>

  /** Heartbeat check */
  heartbeat(): Promise<number>

  /** Get version */
  version(): Promise<string>

  /** Reset all data */
  reset(): Promise<void>
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base Chroma error
 */
export class ChromaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChromaError'
  }
}

/**
 * Configuration error
 */
export class ChromaConfigurationError extends ChromaError {
  constructor(message: string) {
    super(message)
    this.name = 'ChromaConfigurationError'
  }
}

/**
 * Connection error
 */
export class ChromaConnectionError extends ChromaError {
  constructor(message: string) {
    super(message)
    this.name = 'ChromaConnectionError'
  }
}

/**
 * Not found error
 */
export class ChromaNotFoundError extends ChromaError {
  constructor(message: string) {
    super(message)
    this.name = 'ChromaNotFoundError'
  }
}

/**
 * Conflict error (e.g., collection already exists)
 */
export class ChromaConflictError extends ChromaError {
  constructor(message: string) {
    super(message)
    this.name = 'ChromaConflictError'
  }
}

/**
 * Validation error
 */
export class ChromaValidationError extends ChromaError {
  constructor(message: string) {
    super(message)
    this.name = 'ChromaValidationError'
  }
}

/**
 * Request failed error
 */
export class ChromaRequestError extends ChromaError {
  status?: number
  body?: unknown

  constructor(message: string, status?: number, body?: unknown) {
    super(message)
    this.name = 'ChromaRequestError'
    this.status = status
    this.body = body
  }
}
