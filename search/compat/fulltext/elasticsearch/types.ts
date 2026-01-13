/**
 * @dotdo/elasticsearch types
 *
 * Elasticsearch SDK-compatible type definitions
 *
 * @see https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html
 */

// ============================================================================
// CLIENT TYPES
// ============================================================================

/**
 * Client options
 */
export interface ClientOptions {
  node?: string
  nodes?: string[]
  auth?: {
    username: string
    password: string
  } | {
    apiKey: string | { id: string; api_key: string }
  }
  cloud?: {
    id: string
    username?: string
    password?: string
  }
  maxRetries?: number
  requestTimeout?: number
  sniffOnStart?: boolean
  sniffOnConnectionFault?: boolean
  sniffInterval?: number | boolean
  name?: string
  headers?: Record<string, string>
  /** DO namespace binding (for production) */
  doNamespace?: DurableObjectNamespace
}

// ============================================================================
// DOCUMENT TYPES
// ============================================================================

/**
 * Index request parameters
 */
export interface IndexRequest<T = Record<string, unknown>> {
  index: string
  id?: string
  document?: T
  body?: T  // Legacy support
  routing?: string
  refresh?: boolean | 'wait_for'
  timeout?: string
  version?: number
  version_type?: 'internal' | 'external' | 'external_gte'
  pipeline?: string
  require_alias?: boolean
  op_type?: 'index' | 'create'
}

/**
 * Index response
 */
export interface IndexResponse {
  _index: string
  _id: string
  _version: number
  result: 'created' | 'updated'
  _shards: {
    total: number
    successful: number
    failed: number
  }
  _seq_no: number
  _primary_term: number
}

/**
 * Get request parameters
 */
export interface GetRequest {
  index: string
  id: string
  _source?: boolean | string[]
  _source_includes?: string[]
  _source_excludes?: string[]
  routing?: string
  preference?: string
  realtime?: boolean
  refresh?: boolean
  stored_fields?: string[]
  version?: number
  version_type?: 'internal' | 'external' | 'external_gte'
}

/**
 * Get response
 */
export interface GetResponse<T = Record<string, unknown>> {
  _index: string
  _id: string
  _version?: number
  _seq_no?: number
  _primary_term?: number
  found: boolean
  _source?: T
}

/**
 * Multi-get request
 */
export interface MgetRequest {
  index?: string
  body?: {
    docs?: Array<{
      _index?: string
      _id: string
      _source?: boolean | string[]
      routing?: string
    }>
    ids?: string[]
  }
  docs?: Array<{
    _index?: string
    _id: string
    _source?: boolean | string[]
    routing?: string
  }>
  ids?: string[]
  _source?: boolean | string[]
  _source_includes?: string[]
  _source_excludes?: string[]
  routing?: string
}

/**
 * Multi-get response
 */
export interface MgetResponse<T = Record<string, unknown>> {
  docs: GetResponse<T>[]
}

/**
 * Delete request parameters
 */
export interface DeleteRequest {
  index: string
  id: string
  routing?: string
  refresh?: boolean | 'wait_for'
  timeout?: string
  version?: number
  version_type?: 'internal' | 'external' | 'external_gte'
  if_seq_no?: number
  if_primary_term?: number
}

/**
 * Delete response
 */
export interface DeleteResponse {
  _index: string
  _id: string
  _version: number
  result: 'deleted' | 'not_found'
  _shards: {
    total: number
    successful: number
    failed: number
  }
  _seq_no: number
  _primary_term: number
}

/**
 * Update request parameters
 */
export interface UpdateRequest<T = Record<string, unknown>> {
  index: string
  id: string
  body?: {
    doc?: Partial<T>
    doc_as_upsert?: boolean
    script?: {
      source: string
      lang?: string
      params?: Record<string, unknown>
    }
    upsert?: T
    scripted_upsert?: boolean
    detect_noop?: boolean
    _source?: boolean | string[]
  }
  doc?: Partial<T>
  doc_as_upsert?: boolean
  script?: {
    source: string
    lang?: string
    params?: Record<string, unknown>
  }
  upsert?: T
  routing?: string
  refresh?: boolean | 'wait_for'
  timeout?: string
  retry_on_conflict?: number
  _source?: boolean | string[]
  _source_includes?: string[]
  _source_excludes?: string[]
  if_seq_no?: number
  if_primary_term?: number
}

/**
 * Update response
 */
export interface UpdateResponse<T = Record<string, unknown>> {
  _index: string
  _id: string
  _version: number
  result: 'updated' | 'noop' | 'created'
  _shards: {
    total: number
    successful: number
    failed: number
  }
  _seq_no: number
  _primary_term: number
  get?: {
    found: boolean
    _source: T
  }
}

/**
 * Delete by query request
 */
export interface DeleteByQueryRequest {
  index: string | string[]
  body?: {
    query?: QueryDsl
  }
  query?: QueryDsl
  routing?: string
  refresh?: boolean
  timeout?: string
  scroll_size?: number
  conflicts?: 'abort' | 'proceed'
}

/**
 * Delete by query response
 */
export interface DeleteByQueryResponse {
  took: number
  timed_out: boolean
  total: number
  deleted: number
  batches: number
  version_conflicts: number
  noops: number
  retries: {
    bulk: number
    search: number
  }
  failures: unknown[]
}

/**
 * Update by query request
 */
export interface UpdateByQueryRequest {
  index: string | string[]
  body?: {
    query?: QueryDsl
    script?: {
      source: string
      lang?: string
      params?: Record<string, unknown>
    }
  }
  query?: QueryDsl
  script?: {
    source: string
    lang?: string
    params?: Record<string, unknown>
  }
  routing?: string
  refresh?: boolean
  timeout?: string
  scroll_size?: number
  conflicts?: 'abort' | 'proceed'
}

/**
 * Update by query response
 */
export interface UpdateByQueryResponse {
  took: number
  timed_out: boolean
  total: number
  updated: number
  deleted: number
  batches: number
  version_conflicts: number
  noops: number
  retries: {
    bulk: number
    search: number
  }
  failures: unknown[]
}

// ============================================================================
// BULK TYPES
// ============================================================================

/**
 * Bulk action types
 */
export type BulkAction =
  | { index: { _index?: string; _id?: string; routing?: string; version?: number; version_type?: string } }
  | { create: { _index?: string; _id?: string; routing?: string } }
  | { update: { _index?: string; _id: string; routing?: string; retry_on_conflict?: number } }
  | { delete: { _index?: string; _id: string; routing?: string } }

/**
 * Bulk request
 */
export interface BulkRequest<T = Record<string, unknown>> {
  index?: string
  body?: Array<BulkAction | T>
  operations?: Array<BulkAction | T>
  routing?: string
  refresh?: boolean | 'wait_for'
  timeout?: string
  pipeline?: string
  require_alias?: boolean
}

/**
 * Bulk response item
 */
export interface BulkResponseItem {
  _index: string
  _id: string
  _version?: number
  result?: 'created' | 'updated' | 'deleted' | 'noop'
  _shards?: {
    total: number
    successful: number
    failed: number
  }
  status: number
  _seq_no?: number
  _primary_term?: number
  error?: {
    type: string
    reason: string
    caused_by?: {
      type: string
      reason: string
    }
  }
}

/**
 * Bulk response
 */
export interface BulkResponse {
  took: number
  errors: boolean
  items: Array<{
    index?: BulkResponseItem
    create?: BulkResponseItem
    update?: BulkResponseItem
    delete?: BulkResponseItem
  }>
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/**
 * Query DSL
 */
export interface QueryDsl {
  match_all?: Record<string, unknown>
  match?: Record<string, string | { query: string; operator?: 'and' | 'or'; fuzziness?: string | number; prefix_length?: number }>
  multi_match?: {
    query: string
    fields: string[]
    type?: 'best_fields' | 'most_fields' | 'cross_fields' | 'phrase' | 'phrase_prefix' | 'bool_prefix'
    operator?: 'and' | 'or'
    fuzziness?: string | number
  }
  term?: Record<string, string | number | boolean | { value: string | number | boolean; boost?: number }>
  terms?: Record<string, (string | number | boolean)[]>
  range?: Record<string, {
    gt?: number | string
    gte?: number | string
    lt?: number | string
    lte?: number | string
    boost?: number
    format?: string
    time_zone?: string
  }>
  bool?: {
    must?: QueryDsl | QueryDsl[]
    must_not?: QueryDsl | QueryDsl[]
    should?: QueryDsl | QueryDsl[]
    filter?: QueryDsl | QueryDsl[]
    minimum_should_match?: number | string
    boost?: number
  }
  exists?: {
    field: string
    boost?: number
  }
  prefix?: Record<string, string | { value: string; boost?: number; case_insensitive?: boolean }>
  wildcard?: Record<string, string | { value: string; boost?: number; case_insensitive?: boolean }>
  regexp?: Record<string, string | { value: string; flags?: string; boost?: number }>
  fuzzy?: Record<string, string | { value: string; fuzziness?: string | number; prefix_length?: number; transpositions?: boolean }>
  ids?: {
    values: string[]
  }
  match_phrase?: Record<string, string | { query: string; slop?: number }>
  match_phrase_prefix?: Record<string, string | { query: string; max_expansions?: number }>
  query_string?: {
    query: string
    default_field?: string
    fields?: string[]
    default_operator?: 'and' | 'or'
    analyze_wildcard?: boolean
  }
  simple_query_string?: {
    query: string
    fields?: string[]
    default_operator?: 'and' | 'or'
    analyze_wildcard?: boolean
  }
  nested?: {
    path: string
    query: QueryDsl
    score_mode?: 'avg' | 'sum' | 'min' | 'max' | 'none'
    ignore_unmapped?: boolean
  }
  geo_distance?: {
    distance: string
    [field: string]: string | {
      lat: number
      lon: number
    }
  }
  geo_bounding_box?: {
    [field: string]: {
      top_left: { lat: number; lon: number } | string
      bottom_right: { lat: number; lon: number } | string
    }
  }
}

/**
 * Sort options
 */
export type SortOption = string | Record<string, 'asc' | 'desc' | { order: 'asc' | 'desc'; mode?: 'min' | 'max' | 'avg' | 'sum'; missing?: '_last' | '_first' | string | number }>

/**
 * Aggregation types
 */
export interface AggregationDsl {
  terms?: {
    field: string
    size?: number
    order?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
    min_doc_count?: number
    include?: string | string[]
    exclude?: string | string[]
    missing?: string | number
  }
  avg?: { field: string; missing?: number }
  sum?: { field: string; missing?: number }
  min?: { field: string; missing?: number }
  max?: { field: string; missing?: number }
  count?: { field: string }
  cardinality?: { field: string; precision_threshold?: number }
  value_count?: { field: string }
  stats?: { field: string }
  extended_stats?: { field: string }
  percentiles?: { field: string; percents?: number[] }
  percentile_ranks?: { field: string; values: number[] }
  histogram?: {
    field: string
    interval: number
    min_doc_count?: number
    extended_bounds?: { min: number; max: number }
    offset?: number
    order?: Record<string, 'asc' | 'desc'>
  }
  date_histogram?: {
    field: string
    calendar_interval?: string
    fixed_interval?: string
    interval?: string  // Deprecated but supported
    format?: string
    time_zone?: string
    min_doc_count?: number
    extended_bounds?: { min: string | number; max: string | number }
    offset?: string
    order?: Record<string, 'asc' | 'desc'>
  }
  range?: {
    field: string
    ranges: Array<{ from?: number; to?: number; key?: string }>
  }
  date_range?: {
    field: string
    format?: string
    time_zone?: string
    ranges: Array<{ from?: string | number; to?: string | number; key?: string }>
  }
  filter?: QueryDsl
  filters?: {
    filters: Record<string, QueryDsl>
    other_bucket?: boolean
    other_bucket_key?: string
  }
  nested?: {
    path: string
  }
  reverse_nested?: Record<string, unknown>
  top_hits?: {
    size?: number
    from?: number
    sort?: SortOption[]
    _source?: boolean | string[] | { includes?: string[]; excludes?: string[] }
  }
  global?: Record<string, unknown>
  missing?: { field: string }
  composite?: {
    size?: number
    sources: Array<Record<string, AggregationDsl>>
    after?: Record<string, unknown>
  }
  aggs?: Record<string, AggregationDsl>
  aggregations?: Record<string, AggregationDsl>
}

/**
 * Highlight options
 */
export interface HighlightOptions {
  fields: Record<string, {
    pre_tags?: string[]
    post_tags?: string[]
    fragment_size?: number
    number_of_fragments?: number
    type?: 'unified' | 'plain' | 'fvh'
    order?: 'score' | 'none'
    require_field_match?: boolean
    boundary_scanner?: 'sentence' | 'word' | 'chars'
    boundary_max_scan?: number
    no_match_size?: number
    highlight_query?: QueryDsl
  } | Record<string, never>>
  pre_tags?: string[]
  post_tags?: string[]
  fragment_size?: number
  number_of_fragments?: number
  type?: 'unified' | 'plain' | 'fvh'
  order?: 'score' | 'none'
  require_field_match?: boolean
  encoder?: 'default' | 'html'
}

/**
 * Source filtering
 */
export type SourceFilter = boolean | string[] | { includes?: string[]; excludes?: string[] }

/**
 * kNN query for vector similarity search
 */
export interface KnnQuery {
  /** The name of the vector field to search against */
  field: string
  /** The query vector */
  query_vector: number[]
  /** Number of nearest neighbors to return (k) */
  k: number
  /** Number of candidates to consider from each shard */
  num_candidates: number
  /** Optional filter to apply before kNN search */
  filter?: QueryDsl
  /** Optional boost factor */
  boost?: number
  /** Optional similarity threshold (minimum score) */
  similarity?: number
}

/**
 * RRF (Reciprocal Rank Fusion) ranking options
 */
export interface RRFOptions {
  /** Size of the window to consider for RRF */
  window_size?: number
  /** Rank constant for RRF formula (default: 60) */
  rank_constant?: number
}

/**
 * Rank options for combining search results
 */
export interface RankOptions {
  /** RRF ranking configuration */
  rrf?: RRFOptions
}

/**
 * Search request
 */
export interface SearchRequest {
  index?: string | string[]
  body?: {
    query?: QueryDsl
    knn?: KnnQuery | KnnQuery[]
    rank?: RankOptions
    aggs?: Record<string, AggregationDsl>
    aggregations?: Record<string, AggregationDsl>
    sort?: SortOption[]
    from?: number
    size?: number
    _source?: SourceFilter
    highlight?: HighlightOptions
    track_total_hits?: boolean | number
    min_score?: number
    post_filter?: QueryDsl
    collapse?: {
      field: string
      inner_hits?: {
        name?: string
        size?: number
        sort?: SortOption[]
        _source?: SourceFilter
      }
    }
    search_after?: (string | number | null)[]
    pit?: {
      id: string
      keep_alive?: string
    }
    suggest?: Record<string, {
      text?: string
      term?: { field: string; size?: number; suggest_mode?: string }
      phrase?: { field: string; size?: number }
      completion?: { field: string; size?: number; skip_duplicates?: boolean; fuzzy?: boolean | { fuzziness?: string | number } }
    }>
  }
  query?: QueryDsl
  /** kNN query for vector similarity search */
  knn?: KnnQuery | KnnQuery[]
  /** Rank options for combining multiple search results (e.g., RRF) */
  rank?: RankOptions
  aggs?: Record<string, AggregationDsl>
  aggregations?: Record<string, AggregationDsl>
  sort?: SortOption[]
  from?: number
  size?: number
  _source?: SourceFilter
  highlight?: HighlightOptions
  track_total_hits?: boolean | number
  timeout?: string
  routing?: string
  preference?: string
  allow_partial_search_results?: boolean
  batched_reduce_size?: number
  ccs_minimize_roundtrips?: boolean
  docvalue_fields?: string[]
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
  explain?: boolean
  ignore_throttled?: boolean
  ignore_unavailable?: boolean
  lenient?: boolean
  max_concurrent_shard_requests?: number
  pre_filter_shard_size?: number
  request_cache?: boolean
  rest_total_hits_as_int?: boolean
  scroll?: string
  search_type?: 'query_then_fetch' | 'dfs_query_then_fetch'
  seq_no_primary_term?: boolean
  stats?: string[]
  stored_fields?: string[]
  suggest_field?: string
  suggest_text?: string
  terminate_after?: number
  typed_keys?: boolean
  version?: boolean
}

/**
 * Search hit
 */
export interface SearchHit<T = Record<string, unknown>> {
  _index: string
  _id: string
  _score: number | null
  _source?: T
  _version?: number
  _seq_no?: number
  _primary_term?: number
  fields?: Record<string, unknown[]>
  highlight?: Record<string, string[]>
  sort?: (string | number | null)[]
  matched_queries?: string[]
  inner_hits?: Record<string, {
    hits: {
      total: { value: number; relation: 'eq' | 'gte' }
      max_score: number | null
      hits: SearchHit<T>[]
    }
  }>
}

/**
 * Aggregation bucket
 */
export interface AggregationBucket {
  key: string | number
  key_as_string?: string
  doc_count: number
  [key: string]: unknown
}

/**
 * Aggregation result
 */
export interface AggregationResult {
  buckets?: AggregationBucket[]
  value?: number
  doc_count?: number
  doc_count_error_upper_bound?: number
  sum_other_doc_count?: number
  values?: Record<string, number>
  count?: number
  min?: number
  max?: number
  avg?: number
  sum?: number
  std_deviation?: number
  variance?: number
  [key: string]: unknown
}

/**
 * Search response
 */
export interface SearchResponse<T = Record<string, unknown>> {
  took: number
  timed_out: boolean
  _shards: {
    total: number
    successful: number
    skipped: number
    failed: number
    failures?: Array<{
      shard: number
      index: string
      node: string
      reason: {
        type: string
        reason: string
      }
    }>
  }
  hits: {
    total: { value: number; relation: 'eq' | 'gte' }
    max_score: number | null
    hits: SearchHit<T>[]
  }
  aggregations?: Record<string, AggregationResult>
  _scroll_id?: string
  suggest?: Record<string, Array<{
    text: string
    offset: number
    length: number
    options: Array<{
      text: string
      score: number
      freq?: number
    }>
  }>>
  pit_id?: string
}

/**
 * Count request
 */
export interface CountRequest {
  index?: string | string[]
  body?: {
    query?: QueryDsl
  }
  query?: QueryDsl
  routing?: string
  preference?: string
  ignore_unavailable?: boolean
  allow_no_indices?: boolean
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
  min_score?: number
  lenient?: boolean
  terminate_after?: number
}

/**
 * Count response
 */
export interface CountResponse {
  count: number
  _shards: {
    total: number
    successful: number
    skipped: number
    failed: number
  }
}

/**
 * Scroll request
 */
export interface ScrollRequest {
  scroll_id: string
  scroll?: string
  body?: {
    scroll_id: string
    scroll?: string
  }
  rest_total_hits_as_int?: boolean
}

/**
 * Clear scroll request
 */
export interface ClearScrollRequest {
  scroll_id?: string | string[]
  body?: {
    scroll_id?: string | string[]
  }
}

/**
 * Clear scroll response
 */
export interface ClearScrollResponse {
  succeeded: boolean
  num_freed: number
}

// ============================================================================
// INDEX MANAGEMENT TYPES
// ============================================================================

/**
 * Index mapping field type
 */
export interface MappingProperty {
  type?: 'text' | 'keyword' | 'long' | 'integer' | 'short' | 'byte' | 'double' | 'float' | 'half_float' | 'scaled_float' | 'date' | 'boolean' | 'binary' | 'integer_range' | 'float_range' | 'long_range' | 'double_range' | 'date_range' | 'ip' | 'completion' | 'geo_point' | 'geo_shape' | 'alias' | 'flattened' | 'shape' | 'histogram' | 'constant_keyword' | 'aggregate_metric_double' | 'dense_vector' | 'object' | 'nested' | 'join'
  properties?: Record<string, MappingProperty>
  fields?: Record<string, MappingProperty>
  analyzer?: string
  search_analyzer?: string
  normalizer?: string
  index?: boolean
  store?: boolean
  doc_values?: boolean
  fielddata?: boolean
  norms?: boolean
  boost?: number
  null_value?: string | number | boolean
  copy_to?: string | string[]
  ignore_above?: number
  coerce?: boolean
  ignore_malformed?: boolean
  format?: string
  locale?: string
  scaling_factor?: number
  dims?: number
  similarity?: string
  term_vector?: 'no' | 'yes' | 'with_positions' | 'with_offsets' | 'with_positions_offsets' | 'with_positions_payloads' | 'with_positions_offsets_payloads'
  enabled?: boolean
  dynamic?: boolean | 'strict' | 'runtime'
  meta?: Record<string, string>
}

/**
 * Index mappings
 */
export interface IndexMappings {
  properties?: Record<string, MappingProperty>
  dynamic?: boolean | 'strict' | 'runtime'
  _source?: {
    enabled?: boolean
    includes?: string[]
    excludes?: string[]
  }
  _routing?: {
    required?: boolean
  }
  _meta?: Record<string, unknown>
  runtime?: Record<string, {
    type: string
    script?: {
      source: string
      lang?: string
    }
  }>
}

/**
 * Index settings
 */
export interface IndexSettings {
  number_of_shards?: number
  number_of_replicas?: number
  refresh_interval?: string
  max_result_window?: number
  max_inner_result_window?: number
  max_rescore_window?: number
  max_docvalue_fields_search?: number
  max_script_fields?: number
  max_ngram_diff?: number
  max_shingle_diff?: number
  max_refresh_listeners?: number
  analyze?: {
    max_token_count?: number
  }
  highlight?: {
    max_analyzed_offset?: number
  }
  max_terms_count?: number
  max_regex_length?: number
  routing_partition_size?: number
  default_pipeline?: string
  final_pipeline?: string
  hidden?: boolean
  'sort.field'?: string | string[]
  'sort.order'?: 'asc' | 'desc' | ('asc' | 'desc')[]
  analysis?: {
    analyzer?: Record<string, {
      type?: string
      tokenizer?: string
      filter?: string[]
      char_filter?: string[]
    }>
    tokenizer?: Record<string, {
      type: string
      [key: string]: unknown
    }>
    filter?: Record<string, {
      type: string
      [key: string]: unknown
    }>
    char_filter?: Record<string, {
      type: string
      [key: string]: unknown
    }>
    normalizer?: Record<string, {
      type?: string
      filter?: string[]
      char_filter?: string[]
    }>
  }
  index?: {
    number_of_shards?: number
    number_of_replicas?: number
    refresh_interval?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * Create index request
 */
export interface IndicesCreateRequest {
  index: string
  body?: {
    settings?: IndexSettings
    mappings?: IndexMappings
    aliases?: Record<string, {
      filter?: QueryDsl
      routing?: string
      is_write_index?: boolean
    }>
  }
  settings?: IndexSettings
  mappings?: IndexMappings
  aliases?: Record<string, {
    filter?: QueryDsl
    routing?: string
    is_write_index?: boolean
  }>
  wait_for_active_shards?: number | 'all'
  timeout?: string
  master_timeout?: string
  include_type_name?: boolean
}

/**
 * Create index response
 */
export interface IndicesCreateResponse {
  acknowledged: boolean
  shards_acknowledged: boolean
  index: string
}

/**
 * Delete index request
 */
export interface IndicesDeleteRequest {
  index: string | string[]
  timeout?: string
  master_timeout?: string
  ignore_unavailable?: boolean
  allow_no_indices?: boolean
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
}

/**
 * Delete index response
 */
export interface IndicesDeleteResponse {
  acknowledged: boolean
}

/**
 * Index exists request
 */
export interface IndicesExistsRequest {
  index: string | string[]
  allow_no_indices?: boolean
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
  flat_settings?: boolean
  ignore_unavailable?: boolean
  include_defaults?: boolean
  local?: boolean
}

/**
 * Get index request
 */
export interface IndicesGetRequest {
  index: string | string[]
  allow_no_indices?: boolean
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
  flat_settings?: boolean
  ignore_unavailable?: boolean
  include_defaults?: boolean
  local?: boolean
  master_timeout?: string
  features?: ('aliases' | 'mappings' | 'settings')[]
}

/**
 * Get index response
 */
export interface IndicesGetResponse {
  [indexName: string]: {
    aliases: Record<string, {
      filter?: QueryDsl
      routing?: string
      is_write_index?: boolean
    }>
    mappings: IndexMappings
    settings: {
      index: IndexSettings & {
        creation_date?: string
        uuid?: string
        version?: {
          created: string
        }
        provided_name?: string
      }
    }
  }
}

/**
 * Get mappings request
 */
export interface IndicesGetMappingRequest {
  index?: string | string[]
  allow_no_indices?: boolean
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
  ignore_unavailable?: boolean
  local?: boolean
  master_timeout?: string
}

/**
 * Get mappings response
 */
export interface IndicesGetMappingResponse {
  [indexName: string]: {
    mappings: IndexMappings
  }
}

/**
 * Put mapping request
 */
export interface IndicesPutMappingRequest {
  index: string | string[]
  body?: IndexMappings
  properties?: Record<string, MappingProperty>
  dynamic?: boolean | 'strict' | 'runtime'
  allow_no_indices?: boolean
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
  ignore_unavailable?: boolean
  master_timeout?: string
  timeout?: string
  write_index_only?: boolean
}

/**
 * Put mapping response
 */
export interface IndicesPutMappingResponse {
  acknowledged: boolean
}

/**
 * Get settings request
 */
export interface IndicesGetSettingsRequest {
  index?: string | string[]
  name?: string | string[]
  allow_no_indices?: boolean
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
  flat_settings?: boolean
  ignore_unavailable?: boolean
  include_defaults?: boolean
  local?: boolean
  master_timeout?: string
}

/**
 * Get settings response
 */
export interface IndicesGetSettingsResponse {
  [indexName: string]: {
    settings: {
      index: IndexSettings & {
        creation_date?: string
        uuid?: string
        version?: {
          created: string
        }
        provided_name?: string
      }
    }
  }
}

/**
 * Put settings request
 */
export interface IndicesPutSettingsRequest {
  index?: string | string[]
  body?: IndexSettings
  settings?: IndexSettings
  allow_no_indices?: boolean
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
  flat_settings?: boolean
  ignore_unavailable?: boolean
  master_timeout?: string
  preserve_existing?: boolean
  timeout?: string
}

/**
 * Put settings response
 */
export interface IndicesPutSettingsResponse {
  acknowledged: boolean
}

/**
 * Refresh request
 */
export interface IndicesRefreshRequest {
  index?: string | string[]
  allow_no_indices?: boolean
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
  ignore_unavailable?: boolean
}

/**
 * Refresh response
 */
export interface IndicesRefreshResponse {
  _shards: {
    total: number
    successful: number
    failed: number
  }
}

/**
 * Flush request
 */
export interface IndicesFlushRequest {
  index?: string | string[]
  allow_no_indices?: boolean
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
  force?: boolean
  ignore_unavailable?: boolean
  wait_if_ongoing?: boolean
}

/**
 * Flush response
 */
export interface IndicesFlushResponse {
  _shards: {
    total: number
    successful: number
    failed: number
  }
}

/**
 * Stats request
 */
export interface IndicesStatsRequest {
  index?: string | string[]
  metric?: string | string[]
  completion_fields?: string | string[]
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
  fielddata_fields?: string | string[]
  fields?: string | string[]
  forbid_closed_indices?: boolean
  groups?: string | string[]
  include_segment_file_sizes?: boolean
  include_unloaded_segments?: boolean
  level?: 'cluster' | 'indices' | 'shards'
}

/**
 * Stats response (simplified)
 */
export interface IndicesStatsResponse {
  _shards: {
    total: number
    successful: number
    failed: number
  }
  _all: {
    primaries: {
      docs: { count: number; deleted: number }
      store: { size_in_bytes: number }
    }
    total: {
      docs: { count: number; deleted: number }
      store: { size_in_bytes: number }
    }
  }
  indices: Record<string, {
    uuid: string
    primaries: {
      docs: { count: number; deleted: number }
      store: { size_in_bytes: number }
    }
    total: {
      docs: { count: number; deleted: number }
      store: { size_in_bytes: number }
    }
  }>
}

// ============================================================================
// ALIAS TYPES
// ============================================================================

/**
 * Alias actions
 */
export interface AliasAction {
  add?: {
    index?: string
    indices?: string[]
    alias: string
    filter?: QueryDsl
    routing?: string
    is_write_index?: boolean
  }
  remove?: {
    index?: string
    indices?: string[]
    alias: string
  }
  remove_index?: {
    index: string
  }
}

/**
 * Update aliases request
 */
export interface IndicesUpdateAliasesRequest {
  body?: {
    actions: AliasAction[]
  }
  actions?: AliasAction[]
  timeout?: string
  master_timeout?: string
}

/**
 * Update aliases response
 */
export interface IndicesUpdateAliasesResponse {
  acknowledged: boolean
}

/**
 * Get alias request
 */
export interface IndicesGetAliasRequest {
  index?: string | string[]
  name?: string | string[]
  allow_no_indices?: boolean
  expand_wildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all'
  ignore_unavailable?: boolean
  local?: boolean
}

/**
 * Get alias response
 */
export interface IndicesGetAliasResponse {
  [indexName: string]: {
    aliases: Record<string, {
      filter?: QueryDsl
      routing?: string
      is_write_index?: boolean
    }>
  }
}

// ============================================================================
// CLUSTER TYPES
// ============================================================================

/**
 * Cluster health request
 */
export interface ClusterHealthRequest {
  index?: string | string[]
  level?: 'cluster' | 'indices' | 'shards'
  local?: boolean
  master_timeout?: string
  timeout?: string
  wait_for_active_shards?: number | 'all'
  wait_for_events?: 'immediate' | 'urgent' | 'high' | 'normal' | 'low' | 'languid'
  wait_for_no_initializing_shards?: boolean
  wait_for_no_relocating_shards?: boolean
  wait_for_nodes?: string
  wait_for_status?: 'green' | 'yellow' | 'red'
}

/**
 * Cluster health response
 */
export interface ClusterHealthResponse {
  cluster_name: string
  status: 'green' | 'yellow' | 'red'
  timed_out: boolean
  number_of_nodes: number
  number_of_data_nodes: number
  active_primary_shards: number
  active_shards: number
  relocating_shards: number
  initializing_shards: number
  unassigned_shards: number
  delayed_unassigned_shards: number
  number_of_pending_tasks: number
  number_of_in_flight_fetch: number
  task_max_waiting_in_queue_millis: number
  active_shards_percent_as_number: number
  indices?: Record<string, {
    status: 'green' | 'yellow' | 'red'
    number_of_shards: number
    number_of_replicas: number
    active_primary_shards: number
    active_shards: number
    relocating_shards: number
    initializing_shards: number
    unassigned_shards: number
  }>
}

// ============================================================================
// INFO TYPES
// ============================================================================

/**
 * Info response
 */
export interface InfoResponse {
  name: string
  cluster_name: string
  cluster_uuid: string
  version: {
    number: string
    build_flavor: string
    build_type: string
    build_hash: string
    build_date: string
    build_snapshot: boolean
    lucene_version: string
    minimum_wire_compatibility_version: string
    minimum_index_compatibility_version: string
  }
  tagline: string
}

// ============================================================================
// CLIENT INTERFACE
// ============================================================================

/**
 * Indices namespace
 */
export interface IndicesClient {
  create(params: IndicesCreateRequest): Promise<IndicesCreateResponse>
  delete(params: IndicesDeleteRequest): Promise<IndicesDeleteResponse>
  exists(params: IndicesExistsRequest): Promise<boolean>
  get(params: IndicesGetRequest): Promise<IndicesGetResponse>
  getMapping(params?: IndicesGetMappingRequest): Promise<IndicesGetMappingResponse>
  putMapping(params: IndicesPutMappingRequest): Promise<IndicesPutMappingResponse>
  getSettings(params?: IndicesGetSettingsRequest): Promise<IndicesGetSettingsResponse>
  putSettings(params: IndicesPutSettingsRequest): Promise<IndicesPutSettingsResponse>
  refresh(params?: IndicesRefreshRequest): Promise<IndicesRefreshResponse>
  flush(params?: IndicesFlushRequest): Promise<IndicesFlushResponse>
  stats(params?: IndicesStatsRequest): Promise<IndicesStatsResponse>
  updateAliases(params: IndicesUpdateAliasesRequest): Promise<IndicesUpdateAliasesResponse>
  getAlias(params?: IndicesGetAliasRequest): Promise<IndicesGetAliasResponse>
}

/**
 * Cluster namespace
 */
export interface ClusterClient {
  health(params?: ClusterHealthRequest): Promise<ClusterHealthResponse>
}

/**
 * Elasticsearch Client interface
 */
export interface Client {
  // Document APIs
  index<T = Record<string, unknown>>(params: IndexRequest<T>): Promise<IndexResponse>
  get<T = Record<string, unknown>>(params: GetRequest): Promise<GetResponse<T>>
  mget<T = Record<string, unknown>>(params: MgetRequest): Promise<MgetResponse<T>>
  delete(params: DeleteRequest): Promise<DeleteResponse>
  update<T = Record<string, unknown>>(params: UpdateRequest<T>): Promise<UpdateResponse<T>>
  deleteByQuery(params: DeleteByQueryRequest): Promise<DeleteByQueryResponse>
  updateByQuery(params: UpdateByQueryRequest): Promise<UpdateByQueryResponse>
  bulk<T = Record<string, unknown>>(params: BulkRequest<T>): Promise<BulkResponse>

  // Search APIs
  search<T = Record<string, unknown>>(params?: SearchRequest): Promise<SearchResponse<T>>
  count(params?: CountRequest): Promise<CountResponse>
  scroll<T = Record<string, unknown>>(params: ScrollRequest): Promise<SearchResponse<T>>
  clearScroll(params?: ClearScrollRequest): Promise<ClearScrollResponse>

  // Index management
  indices: IndicesClient

  // Cluster
  cluster: ClusterClient

  // Info
  info(): Promise<InfoResponse>

  // Helpers (optional)
  helpers?: {
    bulk<T = Record<string, unknown>>(options: {
      datasource: Iterable<T> | AsyncIterable<T>
      onDocument: (doc: T) => BulkAction | [BulkAction, unknown]
      refresh?: boolean | 'wait_for'
      onDrop?: (doc: { document: T; error: { type: string; reason: string } }) => void
    }): Promise<{
      total: number
      successful: number
      failed: number
      time: number
      bytes: number
      aborted: boolean
    }>
  }

  // Close connection
  close(): Promise<void>
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Elasticsearch error
 */
export class ElasticsearchError extends Error {
  statusCode?: number
  body?: {
    error?: {
      type: string
      reason: string
      root_cause?: Array<{
        type: string
        reason: string
      }>
    }
    status?: number
  }
  meta?: {
    statusCode: number
    headers: Record<string, string>
    body: unknown
  }

  constructor(message: string, statusCode?: number) {
    super(message)
    this.name = 'ElasticsearchError'
    this.statusCode = statusCode
  }
}

/**
 * Document not found error
 */
export class DocumentNotFoundError extends ElasticsearchError {
  constructor(index: string, id: string) {
    super(`Document not found: ${index}/${id}`, 404)
    this.name = 'DocumentNotFoundError'
    this.body = {
      error: {
        type: 'document_missing_exception',
        reason: `Document not found: ${index}/${id}`,
      },
      status: 404,
    }
  }
}

/**
 * Index not found error
 */
export class IndexNotFoundError extends ElasticsearchError {
  constructor(index: string) {
    super(`Index not found: ${index}`, 404)
    this.name = 'IndexNotFoundError'
    this.body = {
      error: {
        type: 'index_not_found_exception',
        reason: `no such index [${index}]`,
        root_cause: [{
          type: 'index_not_found_exception',
          reason: `no such index [${index}]`,
        }],
      },
      status: 404,
    }
  }
}

/**
 * Index already exists error
 */
export class IndexAlreadyExistsError extends ElasticsearchError {
  constructor(index: string) {
    super(`Index already exists: ${index}`, 400)
    this.name = 'IndexAlreadyExistsError'
    this.body = {
      error: {
        type: 'resource_already_exists_exception',
        reason: `index [${index}] already exists`,
      },
      status: 400,
    }
  }
}

/**
 * Version conflict error
 */
export class VersionConflictError extends ElasticsearchError {
  constructor(index: string, id: string) {
    super(`Version conflict: ${index}/${id}`, 409)
    this.name = 'VersionConflictError'
    this.body = {
      error: {
        type: 'version_conflict_engine_exception',
        reason: `[${id}]: version conflict`,
      },
      status: 409,
    }
  }
}

/**
 * Validation error
 */
export class ValidationError extends ElasticsearchError {
  constructor(message: string) {
    super(message, 400)
    this.name = 'ValidationError'
    this.body = {
      error: {
        type: 'action_request_validation_exception',
        reason: message,
      },
      status: 400,
    }
  }
}
