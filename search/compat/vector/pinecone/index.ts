/**
 * @dotdo/pinecone
 *
 * Pinecone SDK-compatible vector database
 * backed by Durable Objects with tiered storage
 *
 * @see https://docs.pinecone.io/reference/typescript-sdk
 */

// Main client export
export { Pinecone, _resetStorage, _getStorageStats } from './pinecone'

// Error exports
export {
  PineconeError,
  PineconeConfigurationError,
  PineconeConnectionError,
  PineconeNotFoundError,
  PineconeConflictError,
  PineconeValidationError,
  PineconeRequestError,
} from './types'

// Type exports
export type {
  // Configuration
  PineconeConfiguration,
  ExtendedPineconeConfiguration,

  // Index types
  IndexModel,
  IndexList,
  CreateIndexOptions,
  ConfigureIndexOptions,
  Metric,
  PodType,
  IndexStatus,
  DeletionProtection,
  Cloud,
  ServerlessSpec,
  PodSpec,
  IndexSpec,
  IndexStatusDetails,

  // Vector types
  RecordValues,
  RecordSparseValues,
  RecordMetadata,
  RecordMetadataValue,
  PineconeRecord,
  ScoredPineconeRecord,

  // Query types
  MetadataFilter,
  MetadataFilterOperators,
  QueryOptions,
  QueryResponse,

  // Operation types
  UpsertResponse,
  FetchResponse,
  DeleteOptions,
  DeleteResponse,
  UpdateOptions,
  UpdateResponse,
  ListOptions,
  ListResponse,
  VectorId,

  // Stats types
  NamespaceStats,
  IndexStats,
  DescribeIndexStatsResponse,

  // Collection types
  CollectionStatus,
  CollectionModel,
  CreateCollectionOptions,
  CollectionList,

  // Interface types
  IndexNamespace,
  Index,
  PineconeClient,
} from './types'
