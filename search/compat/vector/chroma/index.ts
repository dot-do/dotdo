/**
 * @dotdo/chroma
 *
 * Chroma SDK-compatible vector database
 * backed by Durable Objects with tiered storage
 *
 * @see https://docs.trychroma.com/reference/js-client
 */

// Main client export
export { ChromaClient, _resetStorage, _getStorageStats } from './chroma'

// Error exports
export {
  ChromaError,
  ChromaConfigurationError,
  ChromaConnectionError,
  ChromaNotFoundError,
  ChromaConflictError,
  ChromaValidationError,
  ChromaRequestError,
} from './types'

// Type exports
export type {
  // Configuration
  ChromaClientParams,
  AuthOptions,

  // Metadata types
  MetadataValue,
  Metadata,

  // Embedding types
  Embedding,
  Embeddings,

  // Filter types
  WhereOperators,
  WhereLogicalOperators,
  Where,
  WhereDocumentOperators,
  WhereDocumentLogicalOperators,
  WhereDocument,

  // Include types
  IncludeEnum,

  // Collection types
  CollectionModel,
  CreateCollectionParams,
  GetCollectionParams,
  DeleteCollectionParams,
  ModifyCollectionParams,

  // Document operation types
  AddParams,
  UpdateParams,
  UpsertParams,
  QueryParams,
  QueryResponse,
  GetParams,
  GetResponse,
  DeleteParams,
  PeekParams,

  // Function types
  EmbeddingFunction,

  // Interface types
  Collection,
  ChromaClientInterface,
} from './types'
