/**
 * @dotdo/algolia - Algolia SDK compat
 *
 * Drop-in replacement for algoliasearch backed by DO SQLite with FTS5.
 * This in-memory implementation matches the Algolia JavaScript API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://www.algolia.com/doc/api-client/getting-started/install/javascript/
 */

// Types
export type {
  // Search hits
  Hit,
  SearchHit,
  HighlightResult,
  SnippetResult,
  RankingInfo,
  // Facets
  FacetHit,
  FacetStats,
  Facets,
  FacetsStats,
  // Search options
  SearchOptions,
  BrowseOptions,
  SearchForFacetValuesOptions,
  // Search responses
  SearchResponse,
  BrowseResponse,
  SearchForFacetValuesResponse,
  // Objects
  AlgoliaObject,
  SaveObjectResponse,
  SaveObjectsResponse,
  DeleteObjectResponse,
  DeleteObjectsResponse,
  GetObjectOptions,
  GetObjectsOptions,
  GetObjectsResponse,
  PartialUpdateObjectOptions,
  ClearObjectsResponse,
  // Settings
  Settings,
  SetSettingsOptions,
  GetSettingsResponse,
  TaskResponse,
  // Index management
  IndexInfo,
  ListIndicesResponse,
  CopyIndexOptions,
  CopyMoveIndexResponse,
  // Client
  ClientOptions,
  MultipleQueriesQuery,
  MultipleQueriesResponse,
  // Interfaces
  SearchIndex,
  SearchClient,
} from './types'

// Errors
export {
  AlgoliaError,
  ObjectNotFoundError,
  IndexNotFoundError,
  InvalidFilterError,
} from './types'

// Core functions
export {
  algoliasearch,
  clearAllIndices,
} from './algolia'

// Default export for compatibility
export { default } from './algolia'
