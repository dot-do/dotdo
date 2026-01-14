/**
 * @dotdo/typesense - Typesense SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for typesense backed by DO SQLite with FTS5.
 * This implementation matches the Typesense JavaScript API.
 *
 * @example
 * ```typescript
 * import Typesense from '@dotdo/typesense'
 *
 * const client = new Typesense.Client({
 *   nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
 *   apiKey: 'xyz',
 * })
 *
 * // Create a collection
 * await client.collections().create({
 *   name: 'products',
 *   fields: [
 *     { name: 'name', type: 'string' },
 *     { name: 'price', type: 'float' },
 *     { name: 'category', type: 'string', facet: true },
 *     { name: 'in_stock', type: 'bool' },
 *     { name: 'location', type: 'geopoint' },
 *   ],
 *   default_sorting_field: 'price',
 * })
 *
 * // Index documents
 * await client.collections('products').documents().create({
 *   id: '1',
 *   name: 'iPhone 15',
 *   price: 999,
 *   category: 'Electronics',
 *   in_stock: true,
 *   location: [37.7749, -122.4194],
 * })
 *
 * // Bulk import
 * const results = await client.collections('products').documents().import([
 *   { id: '2', name: 'MacBook Pro', price: 2499, category: 'Electronics' },
 *   { id: '3', name: 'iPad Air', price: 599, category: 'Electronics' },
 * ])
 *
 * // Search
 * const searchResults = await client.collections('products').documents().search({
 *   q: 'iPhone',
 *   query_by: 'name',
 *   filter_by: 'price:<1000 && category:Electronics',
 *   sort_by: 'price:asc',
 *   facet_by: 'category',
 * })
 *
 * // Geo search
 * const nearbyProducts = await client.collections('products').documents().search({
 *   q: '*',
 *   query_by: 'name',
 *   filter_by: 'location:(37.7749, -122.4194, 10 km)',
 *   sort_by: 'location(37.7749, -122.4194):asc',
 * })
 *
 * // Multi-search
 * const multiResults = await client.multiSearch.perform({
 *   searches: [
 *     { collection: 'products', q: 'phone', query_by: 'name' },
 *     { collection: 'products', q: 'laptop', query_by: 'name' },
 *   ]
 * })
 *
 * // Get document
 * const product = await client.collections('products').documents('1').retrieve()
 *
 * // Update document
 * await client.collections('products').documents('1').update({ price: 899 })
 *
 * // Delete document
 * await client.collections('products').documents('1').delete()
 * ```
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
} from '../../search/compat/fulltext/typesense/types'

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
} from '../../search/compat/fulltext/typesense/types'

// Core functions
export {
  clearAllCollections,
} from '../../search/compat/fulltext/typesense/typesense'

// Default export for compatibility
export { default } from '../../search/compat/fulltext/typesense/typesense'
