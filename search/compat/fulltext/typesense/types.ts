/**
 * @dotdo/typesense types
 *
 * Typesense SDK-compatible type definitions for full-text search
 *
 * @see https://typesense.org/docs/
 */

// ============================================================================
// FIELD TYPES
// ============================================================================

/**
 * Typesense field types
 */
export type FieldType =
  | 'string'
  | 'string[]'
  | 'int32'
  | 'int32[]'
  | 'int64'
  | 'int64[]'
  | 'float'
  | 'float[]'
  | 'bool'
  | 'bool[]'
  | 'geopoint'
  | 'geopoint[]'
  | 'object'
  | 'object[]'
  | 'auto'
  | 'string*'

/**
 * Field definition in a collection schema
 */
export interface Field {
  name: string
  type: FieldType
  optional?: boolean
  facet?: boolean
  index?: boolean
  sort?: boolean
  infix?: boolean
  locale?: string
  num_dim?: number
  reference?: string
}

// ============================================================================
// COLLECTION TYPES
// ============================================================================

/**
 * Collection schema for creation
 */
export interface CollectionSchema {
  name: string
  fields: Field[]
  default_sorting_field?: string
  token_separators?: string[]
  symbols_to_index?: string[]
  enable_nested_fields?: boolean
}

/**
 * Collection response (includes metadata)
 */
export interface Collection extends CollectionSchema {
  created_at: number
  num_documents: number
  num_memory_shards: number
}

/**
 * Collection update schema
 */
export interface CollectionUpdateSchema {
  fields?: Field[]
}

// ============================================================================
// DOCUMENT TYPES
// ============================================================================

/**
 * Base document type
 */
export interface Document {
  id?: string
  [key: string]: unknown
}

/**
 * Document with required ID (after indexing)
 */
export interface IndexedDocument extends Document {
  id: string
}

/**
 * Import response
 */
export interface ImportResponse {
  success: boolean
  error?: string
  document?: string
}

/**
 * Export options
 */
export interface ExportOptions {
  filter_by?: string
  include_fields?: string
  exclude_fields?: string
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/**
 * Search parameters
 */
export interface SearchParams {
  q: string
  query_by: string | string[]
  query_by_weights?: number[]
  prefix?: boolean | boolean[]
  filter_by?: string
  sort_by?: string
  facet_by?: string
  max_facet_values?: number
  facet_query?: string
  num_typos?: number | string
  page?: number
  per_page?: number
  limit?: number
  offset?: number
  group_by?: string
  group_limit?: number
  include_fields?: string
  exclude_fields?: string
  highlight_fields?: string
  highlight_full_fields?: string
  highlight_affix_num_tokens?: number
  highlight_start_tag?: string
  highlight_end_tag?: string
  snippet_threshold?: number
  drop_tokens_threshold?: number
  typo_tokens_threshold?: number
  pinned_hits?: string
  hidden_hits?: string
  enable_overrides?: boolean
  prioritize_exact_match?: boolean
  exhaustive_search?: boolean
  search_cutoff_ms?: number
  use_cache?: boolean
  cache_ttl?: number
  min_len_1typo?: number
  min_len_2typo?: number
  vector_query?: string
  remote_embedding_timeout_ms?: number
  remote_embedding_num_tries?: number
}

/**
 * Search highlight
 */
export interface SearchHighlight {
  field: string
  snippet?: string
  value?: string
  snippets?: string[]
  indices?: number[]
  matched_tokens: string[] | string[][]
}

/**
 * Search hit
 */
export interface SearchHit<T = Document> {
  document: T
  highlights?: SearchHighlight[]
  text_match?: number
  text_match_info?: {
    best_field_score: string
    best_field_weight: number
    fields_matched: number
    score: string
    tokens_matched: number
  }
  geo_distance_meters?: { [field: string]: number }
  vector_distance?: number
}

/**
 * Facet count
 */
export interface FacetCount {
  count: number
  highlighted: string
  value: string
}

/**
 * Facet stats
 */
export interface FacetStats {
  avg?: number
  max?: number
  min?: number
  sum?: number
  total_values?: number
}

/**
 * Facet result
 */
export interface FacetResult {
  field_name: string
  counts: FacetCount[]
  stats?: FacetStats
}

/**
 * Search result
 */
export interface SearchResult<T = Document> {
  facet_counts?: FacetResult[]
  found: number
  out_of: number
  page: number
  request_params: SearchParams
  search_time_ms: number
  hits: SearchHit<T>[]
  grouped_hits?: {
    group_key: string[]
    hits: SearchHit<T>[]
  }[]
}

/**
 * Multi-search request
 */
export interface MultiSearchRequest {
  searches: (SearchParams & { collection: string })[]
}

/**
 * Multi-search result
 */
export interface MultiSearchResult<T = Document> {
  results: SearchResult<T>[]
}

// ============================================================================
// GEO TYPES
// ============================================================================

/**
 * Geo point [lat, lng]
 */
export type GeoPoint = [number, number]

/**
 * Geo distance unit
 */
export type GeoDistanceUnit = 'km' | 'mi' | 'm'

// ============================================================================
// CLIENT TYPES
// ============================================================================

/**
 * Node configuration
 */
export interface NodeConfiguration {
  host: string
  port: number
  protocol: 'http' | 'https'
  path?: string
}

/**
 * Client configuration
 */
export interface ClientConfig {
  nodes: NodeConfiguration[]
  apiKey: string
  connectionTimeoutSeconds?: number
  retryIntervalSeconds?: number
  numRetries?: number
  healthcheckIntervalSeconds?: number
  nearestNode?: NodeConfiguration
  additionalHeaders?: Record<string, string>
  sendApiKeyAsQueryParam?: boolean
  useServerSideSearchCache?: boolean
  cacheSearchResultsForSeconds?: number
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error'
}

// ============================================================================
// API INTERFACES
// ============================================================================

/**
 * Documents API
 */
export interface DocumentsApi<T = Document> {
  create(document: T, options?: { action?: 'create' | 'upsert' | 'update' | 'emplace' }): Promise<T & { id: string }>
  upsert(document: T): Promise<T & { id: string }>
  update(document: Partial<T> & { id: string }, options?: { filter_by?: string }): Promise<T & { id: string }>
  delete(options?: { filter_by?: string }): Promise<{ num_deleted: number }>
  search(params: SearchParams): Promise<SearchResult<T>>
  export(options?: ExportOptions): Promise<string>
  import(documents: T[] | string, options?: { action?: 'create' | 'upsert' | 'update' | 'emplace'; batch_size?: number }): Promise<ImportResponse[]>
}

/**
 * Single document API
 */
export interface DocumentApi<T = Document> {
  retrieve(): Promise<T & { id: string }>
  update(document: Partial<T>): Promise<T & { id: string }>
  delete(): Promise<T & { id: string }>
}

/**
 * Collection API
 */
export interface CollectionApi<T = Document> {
  retrieve(): Promise<Collection>
  update(schema: CollectionUpdateSchema): Promise<Collection>
  delete(): Promise<Collection>
  documents(): DocumentsApi<T>
  documents(id: string): DocumentApi<T>
}

/**
 * Collections API
 */
export interface CollectionsApi {
  create(schema: CollectionSchema): Promise<Collection>
  retrieve(): Promise<Collection[]>
}

/**
 * Client interface
 */
export interface TypesenseClient {
  collections(): CollectionsApi
  collections<T = Document>(name: string): CollectionApi<T>
  multiSearch: {
    perform<T = Document>(request: MultiSearchRequest, options?: { useCache?: boolean; cacheTtl?: number }): Promise<MultiSearchResult<T>>
  }
  health: {
    retrieve(): Promise<{ ok: boolean }>
  }
  metrics: {
    retrieve(): Promise<Record<string, unknown>>
  }
  debug: {
    retrieve(): Promise<{ state: number; version: string }>
  }
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Typesense API error
 */
export class TypesenseError extends Error {
  httpStatus?: number

  constructor(message: string, httpStatus?: number) {
    super(message)
    this.name = 'TypesenseError'
    this.httpStatus = httpStatus
  }
}

/**
 * Object not found error
 */
export class ObjectNotFound extends TypesenseError {
  constructor(message: string = 'Not Found') {
    super(message, 404)
    this.name = 'ObjectNotFound'
  }
}

/**
 * Object already exists error
 */
export class ObjectAlreadyExists extends TypesenseError {
  constructor(message: string = 'Already Exists') {
    super(message, 409)
    this.name = 'ObjectAlreadyExists'
  }
}

/**
 * Object unprocessable error
 */
export class ObjectUnprocessable extends TypesenseError {
  constructor(message: string = 'Unprocessable Entity') {
    super(message, 422)
    this.name = 'ObjectUnprocessable'
  }
}

/**
 * Request malformed error
 */
export class RequestMalformed extends TypesenseError {
  constructor(message: string = 'Bad Request') {
    super(message, 400)
    this.name = 'RequestMalformed'
  }
}

/**
 * Request unauthorized error
 */
export class RequestUnauthorized extends TypesenseError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401)
    this.name = 'RequestUnauthorized'
  }
}

/**
 * Server error
 */
export class ServerError extends TypesenseError {
  constructor(message: string = 'Internal Server Error') {
    super(message, 500)
    this.name = 'ServerError'
  }
}

/**
 * Missing configuration error
 */
export class MissingConfigurationError extends TypesenseError {
  constructor(message: string) {
    super(message)
    this.name = 'MissingConfigurationError'
  }
}
