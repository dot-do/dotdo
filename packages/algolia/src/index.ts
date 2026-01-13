/**
 * @dotdo/algolia - Algolia SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for algoliasearch with in-memory backend.
 * This implementation matches the Algolia JavaScript API.
 *
 * @example
 * ```typescript
 * import algoliasearch from '@dotdo/algolia'
 *
 * const client = algoliasearch('APP_ID', 'API_KEY')
 * const index = client.initIndex('products')
 *
 * // Save objects
 * await index.saveObject({ objectID: '1', name: 'iPhone', price: 999 })
 * await index.saveObjects([
 *   { objectID: '2', name: 'MacBook', price: 2499 },
 *   { objectID: '3', name: 'iPad', price: 799 },
 * ])
 *
 * // Search
 * const { hits } = await index.search('iPhone')
 * console.log(hits) // [{ objectID: '1', name: 'iPhone', price: 999 }]
 *
 * // Search with filters
 * const results = await index.search('', {
 *   filters: 'price < 1000',
 *   facets: ['brand'],
 * })
 *
 * // Browse all objects
 * await index.browseObjects({
 *   batch: (hits) => console.log(hits),
 * })
 * ```
 *
 * @see https://www.algolia.com/doc/api-client/getting-started/install/javascript/
 */

// Core functions
export {
  algoliasearch,
  clearAllIndices,
  default,
} from './client'

// Error types
export {
  AlgoliaError,
  ObjectNotFoundError,
  IndexNotFoundError,
  InvalidFilterError,
} from './types'

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
