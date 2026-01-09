/**
 * @dotdo/typesense - Typesense SDK compat
 *
 * Drop-in replacement for Typesense backed by DO SQLite with FTS5.
 * This in-memory implementation matches the Typesense JavaScript API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://typesense.org/docs/
 */

// Types
export type {
  // Field types
  FieldType,
  Field,
  // Collection types
  CollectionSchema,
  Collection,
  CollectionUpdateSchema,
  // Document types
  Document,
  IndexedDocument,
  ImportResponse,
  ExportOptions,
  // Search types
  SearchParams,
  SearchHighlight,
  SearchHit,
  FacetCount,
  FacetStats,
  FacetResult,
  SearchResult,
  MultiSearchRequest,
  MultiSearchResult,
  // Geo types
  GeoPoint,
  GeoDistanceUnit,
  // Client types
  NodeConfiguration,
  ClientConfig,
  // API interfaces
  DocumentsApi,
  DocumentApi,
  CollectionApi,
  CollectionsApi,
  TypesenseClient,
} from './types'

// Errors
export {
  TypesenseError,
  ObjectNotFound,
  ObjectAlreadyExists,
  ObjectUnprocessable,
  RequestMalformed,
  RequestUnauthorized,
  ServerError,
  MissingConfigurationError,
} from './types'

// Core functions
export {
  clearAllCollections,
} from './typesense'

// Default export for compatibility
export { default } from './typesense'
