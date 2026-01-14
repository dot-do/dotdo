/**
 * @dotdo/elasticsearch - Elasticsearch SDK compat
 *
 * Drop-in replacement for @elastic/elasticsearch backed by DO SQLite with FTS5.
 * This in-memory implementation matches the Elasticsearch JavaScript API.
 * Production version routes to Durable Objects based on config.
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
} from './types'

// Errors
export {
  ElasticsearchError,
  DocumentNotFoundError,
  IndexNotFoundError,
  IndexAlreadyExistsError,
  VersionConflictError,
  ValidationError,
} from './types'

// Core
export {
  Client,
  clearAllIndices,
} from './elasticsearch'

// Default export for compatibility
export { Client as default } from './elasticsearch'
