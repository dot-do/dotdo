/**
 * @dotdo/elasticsearch - Elasticsearch SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for @elastic/elasticsearch backed by DO SQLite with FTS5.
 * This implementation matches the Elasticsearch JavaScript API.
 *
 * @example
 * ```typescript
 * import { Client } from '@dotdo/elasticsearch'
 *
 * const client = new Client({ node: 'http://localhost:9200' })
 *
 * // Create an index
 * await client.indices.create({
 *   index: 'products',
 *   body: {
 *     mappings: {
 *       properties: {
 *         name: { type: 'text' },
 *         price: { type: 'float' },
 *         tags: { type: 'keyword' },
 *       }
 *     }
 *   }
 * })
 *
 * // Index documents
 * await client.index({
 *   index: 'products',
 *   id: '1',
 *   body: { name: 'iPhone', price: 999, tags: ['electronics', 'phone'] }
 * })
 *
 * // Bulk operations
 * await client.bulk({
 *   body: [
 *     { index: { _index: 'products', _id: '2' } },
 *     { name: 'MacBook', price: 2499, tags: ['electronics', 'laptop'] },
 *     { index: { _index: 'products', _id: '3' } },
 *     { name: 'iPad', price: 799, tags: ['electronics', 'tablet'] },
 *   ]
 * })
 *
 * // Search with Query DSL
 * const { hits } = await client.search({
 *   index: 'products',
 *   body: {
 *     query: {
 *       bool: {
 *         must: [
 *           { match: { name: 'iPhone' } }
 *         ],
 *         filter: [
 *           { range: { price: { lte: 1000 } } }
 *         ]
 *       }
 *     },
 *     aggs: {
 *       tags: { terms: { field: 'tags' } }
 *     }
 *   }
 * })
 *
 * // Get document
 * const doc = await client.get({ index: 'products', id: '1' })
 *
 * // Delete document
 * await client.delete({ index: 'products', id: '1' })
 *
 * // Delete by query
 * await client.deleteByQuery({
 *   index: 'products',
 *   body: {
 *     query: { range: { price: { gt: 2000 } } }
 *   }
 * })
 * ```
 *
 * @see https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html
 */

// Types
export type {
  // Client
  ClientOptions,
  Client as ClientType,
  IndicesClient,
  ClusterClient,
  InfoResponse,

  // Document APIs
  IndexRequest,
  IndexResponse,
  GetRequest,
  GetResponse,
  MgetRequest,
  MgetResponse,
  DeleteRequest,
  DeleteResponse,
  UpdateRequest,
  UpdateResponse,
  DeleteByQueryRequest,
  DeleteByQueryResponse,
  UpdateByQueryRequest,
  UpdateByQueryResponse,

  // Bulk
  BulkAction,
  BulkRequest,
  BulkResponse,
  BulkResponseItem,

  // Search
  SearchRequest,
  SearchResponse,
  SearchHit,
  CountRequest,
  CountResponse,
  ScrollRequest,
  ClearScrollRequest,
  ClearScrollResponse,

  // Query DSL
  QueryDsl,
  AggregationDsl,
  AggregationResult,
  AggregationBucket,
  SortOption,
  SourceFilter,
  HighlightOptions,

  // Index Management
  IndicesCreateRequest,
  IndicesCreateResponse,
  IndicesDeleteRequest,
  IndicesDeleteResponse,
  IndicesExistsRequest,
  IndicesGetRequest,
  IndicesGetResponse,
  IndicesGetMappingRequest,
  IndicesGetMappingResponse,
  IndicesPutMappingRequest,
  IndicesPutMappingResponse,
  IndicesGetSettingsRequest,
  IndicesGetSettingsResponse,
  IndicesPutSettingsRequest,
  IndicesPutSettingsResponse,
  IndicesRefreshRequest,
  IndicesRefreshResponse,
  IndicesStatsRequest,
  IndicesStatsResponse,
  IndicesUpdateAliasesRequest,
  IndicesUpdateAliasesResponse,
  IndicesGetAliasRequest,
  IndicesGetAliasResponse,
  IndicesFlushRequest,
  IndicesFlushResponse,
  AliasAction,
  IndexMappings,
  IndexSettings,
  MappingProperty,

  // Cluster
  ClusterHealthRequest,
  ClusterHealthResponse,
} from '../../search/compat/fulltext/elasticsearch/types'

// Errors
export {
  ElasticsearchError,
  DocumentNotFoundError,
  IndexNotFoundError,
  IndexAlreadyExistsError,
  VersionConflictError,
  ValidationError,
} from '../../search/compat/fulltext/elasticsearch/types'

// Core
export {
  Client,
  clearAllIndices,
} from '../../search/compat/fulltext/elasticsearch/elasticsearch'

// Default export for compatibility
export { Client as default } from '../../search/compat/fulltext/elasticsearch/elasticsearch'
