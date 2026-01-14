/**
 * @dotdo/elasticsearch types
 *
 * Elasticsearch SDK-compatible type definitions
 * for the Elasticsearch compat layer backed by unified primitives
 *
 * @see https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/
 */

// ============================================================================
// DOCUMENT TYPES
// ============================================================================

/**
 * Generic document type
 */
export interface Document {
  [key: string]: unknown
}

/**
 * Document with metadata
 */
export interface Hit<T extends Document = Document> {
  _index: string
  _id: string
  _score: number | null
  _source: T
  highlight?: Record<string, string[]>
  sort?: unknown[]
}

/**
 * Search hits container
 */
export interface SearchHits<T extends Document = Document> {
  total: { value: number; relation: 'eq' | 'gte' }
  max_score: number | null
  hits: Hit<T>[]
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Match query - full-text search with analysis
 */
export interface MatchQuery {
  match: {
    [field: string]:
      | string
      | {
          query: string
          operator?: 'or' | 'and'
          fuzziness?: string | number
          minimum_should_match?: string | number
          analyzer?: string
          boost?: number
        }
  }
}

/**
 * Multi-match query - search across multiple fields
 */
export interface MultiMatchQuery {
  multi_match: {
    query: string
    fields: string[]
    type?: 'best_fields' | 'most_fields' | 'cross_fields' | 'phrase' | 'phrase_prefix'
    operator?: 'or' | 'and'
    fuzziness?: string | number
    minimum_should_match?: string | number
  }
}

/**
 * Term query - exact value matching (not analyzed)
 */
export interface TermQuery {
  term: {
    [field: string]: string | number | boolean | { value: string | number | boolean; boost?: number }
  }
}

/**
 * Terms query - match any of the specified values
 */
export interface TermsQuery {
  terms: {
    [field: string]: (string | number | boolean)[]
  }
}

/**
 * Range query - range comparisons
 */
export interface RangeQuery {
  range: {
    [field: string]: {
      gt?: number | string | Date
      gte?: number | string | Date
      lt?: number | string | Date
      lte?: number | string | Date
      boost?: number
      format?: string
    }
  }
}

/**
 * Exists query - field exists
 */
export interface ExistsQuery {
  exists: {
    field: string
  }
}

/**
 * Prefix query - prefix matching
 */
export interface PrefixQuery {
  prefix: {
    [field: string]: string | { value: string; boost?: number }
  }
}

/**
 * Wildcard query - wildcard pattern matching
 */
export interface WildcardQuery {
  wildcard: {
    [field: string]: string | { value: string; boost?: number }
  }
}

/**
 * Regexp query - regular expression matching
 */
export interface RegexpQuery {
  regexp: {
    [field: string]: string | { value: string; flags?: string; boost?: number }
  }
}

/**
 * Fuzzy query - fuzzy matching
 */
export interface FuzzyQuery {
  fuzzy: {
    [field: string]:
      | string
      | {
          value: string
          fuzziness?: string | number
          prefix_length?: number
          max_expansions?: number
          boost?: number
        }
  }
}

/**
 * Match phrase query - phrase matching
 */
export interface MatchPhraseQuery {
  match_phrase: {
    [field: string]: string | { query: string; slop?: number; boost?: number }
  }
}

/**
 * Match phrase prefix query - phrase prefix matching
 */
export interface MatchPhrasePrefixQuery {
  match_phrase_prefix: {
    [field: string]: string | { query: string; max_expansions?: number; boost?: number }
  }
}

/**
 * IDs query - match by document IDs
 */
export interface IdsQuery {
  ids: {
    values: string[]
  }
}

/**
 * Bool query - compound boolean queries
 */
export interface BoolQuery {
  bool: {
    must?: Query[]
    filter?: Query[]
    should?: Query[]
    must_not?: Query[]
    minimum_should_match?: string | number
    boost?: number
  }
}

/**
 * Match all query
 */
export interface MatchAllQuery {
  match_all: { boost?: number }
}

/**
 * Match none query
 */
export interface MatchNoneQuery {
  match_none: Record<string, never>
}

/**
 * Nested query - query nested objects
 */
export interface NestedQuery {
  nested: {
    path: string
    query: Query
    score_mode?: 'avg' | 'sum' | 'min' | 'max' | 'none'
    ignore_unmapped?: boolean
  }
}

/**
 * Function score query - customize scoring
 */
export interface FunctionScoreQuery {
  function_score: {
    query?: Query
    functions?: ScoreFunction[]
    boost_mode?: 'multiply' | 'replace' | 'sum' | 'avg' | 'max' | 'min'
    score_mode?: 'multiply' | 'sum' | 'avg' | 'first' | 'max' | 'min'
    max_boost?: number
    min_score?: number
  }
}

/**
 * Score function for function_score query
 */
export interface ScoreFunction {
  filter?: Query
  weight?: number
  random_score?: { seed?: number | string; field?: string }
  field_value_factor?: {
    field: string
    factor?: number
    modifier?: 'none' | 'log' | 'log1p' | 'log2p' | 'ln' | 'ln1p' | 'ln2p' | 'square' | 'sqrt' | 'reciprocal'
    missing?: number
  }
  script_score?: { script: { source: string; params?: Record<string, unknown> } }
  decay?: {
    [field: string]: {
      origin?: string | number
      scale?: string | number
      offset?: string | number
      decay?: number
    }
  }
}

/**
 * KNN query - vector similarity search
 */
export interface KnnQuery {
  knn: {
    field: string
    query_vector: number[]
    k: number
    num_candidates?: number
    filter?: Query
    similarity?: number
    boost?: number
  }
}

/**
 * Combined query union type
 */
export type Query =
  | MatchQuery
  | MultiMatchQuery
  | TermQuery
  | TermsQuery
  | RangeQuery
  | ExistsQuery
  | PrefixQuery
  | WildcardQuery
  | RegexpQuery
  | FuzzyQuery
  | MatchPhraseQuery
  | MatchPhrasePrefixQuery
  | IdsQuery
  | BoolQuery
  | MatchAllQuery
  | MatchNoneQuery
  | NestedQuery
  | FunctionScoreQuery
  | KnnQuery

// ============================================================================
// AGGREGATION TYPES
// ============================================================================

/**
 * Terms aggregation
 */
export interface TermsAggregation {
  terms: {
    field: string
    size?: number
    min_doc_count?: number
    order?: { [key: string]: 'asc' | 'desc' } | Array<{ [key: string]: 'asc' | 'desc' }>
    missing?: string | number
  }
}

/**
 * Histogram aggregation
 */
export interface HistogramAggregation {
  histogram: {
    field: string
    interval: number
    min_doc_count?: number
    offset?: number
    order?: { [key: string]: 'asc' | 'desc' }
    extended_bounds?: { min: number; max: number }
    hard_bounds?: { min: number; max: number }
    missing?: number
  }
}

/**
 * Date histogram aggregation
 */
export interface DateHistogramAggregation {
  date_histogram: {
    field: string
    calendar_interval?: string
    fixed_interval?: string
    min_doc_count?: number
    offset?: string
    time_zone?: string
    format?: string
    order?: { [key: string]: 'asc' | 'desc' }
    extended_bounds?: { min: number | string; max: number | string }
    hard_bounds?: { min: number | string; max: number | string }
    missing?: string
  }
}

/**
 * Range aggregation
 */
export interface RangeAggregation {
  range: {
    field: string
    ranges: Array<{
      key?: string
      from?: number
      to?: number
    }>
    keyed?: boolean
  }
}

/**
 * Date range aggregation
 */
export interface DateRangeAggregation {
  date_range: {
    field: string
    format?: string
    time_zone?: string
    ranges: Array<{
      key?: string
      from?: string | number
      to?: string | number
    }>
    keyed?: boolean
  }
}

/**
 * Avg metric aggregation
 */
export interface AvgAggregation {
  avg: {
    field: string
    missing?: number
  }
}

/**
 * Sum metric aggregation
 */
export interface SumAggregation {
  sum: {
    field: string
    missing?: number
  }
}

/**
 * Min metric aggregation
 */
export interface MinAggregation {
  min: {
    field: string
    missing?: number
  }
}

/**
 * Max metric aggregation
 */
export interface MaxAggregation {
  max: {
    field: string
    missing?: number
  }
}

/**
 * Value count aggregation
 */
export interface ValueCountAggregation {
  value_count: {
    field: string
  }
}

/**
 * Cardinality aggregation (distinct count)
 */
export interface CardinalityAggregation {
  cardinality: {
    field: string
    precision_threshold?: number
    missing?: string | number
  }
}

/**
 * Stats aggregation
 */
export interface StatsAggregation {
  stats: {
    field: string
    missing?: number
  }
}

/**
 * Extended stats aggregation
 */
export interface ExtendedStatsAggregation {
  extended_stats: {
    field: string
    missing?: number
    sigma?: number
  }
}

/**
 * Percentiles aggregation
 */
export interface PercentilesAggregation {
  percentiles: {
    field: string
    percents?: number[]
    keyed?: boolean
    missing?: number
  }
}

/**
 * Top hits aggregation
 */
export interface TopHitsAggregation {
  top_hits: {
    size?: number
    from?: number
    sort?: SortItem[]
    _source?: boolean | string[] | { includes?: string[]; excludes?: string[] }
  }
}

/**
 * Filter aggregation
 */
export interface FilterAggregation {
  filter: Query
  aggs?: Record<string, Aggregation>
}

/**
 * Filters aggregation
 */
export interface FiltersAggregation {
  filters: {
    filters: Record<string, Query> | Query[]
    other_bucket?: boolean
    other_bucket_key?: string
  }
  aggs?: Record<string, Aggregation>
}

/**
 * Nested aggregation
 */
export interface NestedAggregation {
  nested: {
    path: string
  }
  aggs?: Record<string, Aggregation>
}

/**
 * Aggregation with sub-aggregations
 */
export interface AggregationContainer {
  aggs?: Record<string, Aggregation>
}

/**
 * Combined aggregation union type
 */
export type Aggregation = (
  | TermsAggregation
  | HistogramAggregation
  | DateHistogramAggregation
  | RangeAggregation
  | DateRangeAggregation
  | AvgAggregation
  | SumAggregation
  | MinAggregation
  | MaxAggregation
  | ValueCountAggregation
  | CardinalityAggregation
  | StatsAggregation
  | ExtendedStatsAggregation
  | PercentilesAggregation
  | TopHitsAggregation
  | FilterAggregation
  | FiltersAggregation
  | NestedAggregation
) &
  AggregationContainer

// ============================================================================
// AGGREGATION RESULTS
// ============================================================================

/**
 * Terms bucket
 */
export interface TermsBucket {
  key: string | number
  key_as_string?: string
  doc_count: number
  [key: string]: unknown
}

/**
 * Terms aggregation result
 */
export interface TermsAggregationResult {
  buckets: TermsBucket[]
  doc_count_error_upper_bound: number
  sum_other_doc_count: number
}

/**
 * Histogram bucket
 */
export interface HistogramBucket {
  key: number
  key_as_string?: string
  doc_count: number
  [key: string]: unknown
}

/**
 * Histogram aggregation result
 */
export interface HistogramAggregationResult {
  buckets: HistogramBucket[]
}

/**
 * Date histogram bucket
 */
export interface DateHistogramBucket {
  key: number
  key_as_string: string
  doc_count: number
  [key: string]: unknown
}

/**
 * Date histogram aggregation result
 */
export interface DateHistogramAggregationResult {
  buckets: DateHistogramBucket[]
}

/**
 * Range bucket
 */
export interface RangeBucket {
  key?: string
  from?: number
  from_as_string?: string
  to?: number
  to_as_string?: string
  doc_count: number
  [key: string]: unknown
}

/**
 * Range aggregation result
 */
export interface RangeAggregationResult {
  buckets: RangeBucket[] | Record<string, RangeBucket>
}

/**
 * Metric aggregation result
 */
export interface MetricAggregationResult {
  value: number | null
  value_as_string?: string
}

/**
 * Stats aggregation result
 */
export interface StatsAggregationResult {
  count: number
  min: number | null
  max: number | null
  avg: number | null
  sum: number
}

/**
 * Extended stats aggregation result
 */
export interface ExtendedStatsAggregationResult extends StatsAggregationResult {
  sum_of_squares: number | null
  variance: number | null
  variance_population: number | null
  variance_sampling: number | null
  std_deviation: number | null
  std_deviation_population: number | null
  std_deviation_sampling: number | null
  std_deviation_bounds?: {
    upper: number | null
    lower: number | null
    upper_population: number | null
    lower_population: number | null
    upper_sampling: number | null
    lower_sampling: number | null
  }
}

/**
 * Percentiles aggregation result
 */
export interface PercentilesAggregationResult {
  values: Record<string, number | null> | Array<{ key: number; value: number | null }>
}

/**
 * Top hits aggregation result
 */
export interface TopHitsAggregationResult<T extends Document = Document> {
  hits: SearchHits<T>
}

/**
 * Aggregation result union
 */
export type AggregationResult =
  | TermsAggregationResult
  | HistogramAggregationResult
  | DateHistogramAggregationResult
  | RangeAggregationResult
  | MetricAggregationResult
  | StatsAggregationResult
  | ExtendedStatsAggregationResult
  | PercentilesAggregationResult
  | TopHitsAggregationResult

// ============================================================================
// SORT TYPES
// ============================================================================

/**
 * Sort order
 */
export type SortOrder = 'asc' | 'desc'

/**
 * Sort mode for arrays
 */
export type SortMode = 'min' | 'max' | 'sum' | 'avg' | 'median'

/**
 * Sort item
 */
export interface SortItem {
  [field: string]:
    | SortOrder
    | {
        order?: SortOrder
        mode?: SortMode
        missing?: '_last' | '_first' | string | number
        unmapped_type?: string
        nested?: { path: string; filter?: Query }
      }
}

/**
 * Score sort
 */
export interface ScoreSort {
  _score: SortOrder | { order: SortOrder }
}

/**
 * Sort specification
 */
export type Sort = (SortItem | ScoreSort | string)[]

// ============================================================================
// HIGHLIGHT TYPES
// ============================================================================

/**
 * Highlight configuration
 */
export interface Highlight {
  fields: Record<
    string,
    {
      type?: 'unified' | 'plain' | 'fvh'
      fragment_size?: number
      number_of_fragments?: number
      no_match_size?: number
      pre_tags?: string[]
      post_tags?: string[]
      require_field_match?: boolean
      highlight_query?: Query
    }
  >
  pre_tags?: string[]
  post_tags?: string[]
  order?: 'score'
  encoder?: 'default' | 'html'
  require_field_match?: boolean
}

// ============================================================================
// SOURCE FILTERING
// ============================================================================

/**
 * Source filter configuration
 */
export type SourceFilter =
  | boolean
  | string
  | string[]
  | {
      includes?: string[]
      excludes?: string[]
    }

// ============================================================================
// SEARCH REQUEST/RESPONSE
// ============================================================================

/**
 * Search request body
 */
export interface SearchRequest<T extends Document = Document> {
  query?: Query
  aggs?: Record<string, Aggregation>
  aggregations?: Record<string, Aggregation>
  sort?: Sort
  from?: number
  size?: number
  _source?: SourceFilter
  highlight?: Highlight
  track_total_hits?: boolean | number
  track_scores?: boolean
  min_score?: number
  timeout?: string
  explain?: boolean
  version?: boolean
  seq_no_primary_term?: boolean
  stored_fields?: string[]
  docvalue_fields?: string[]
  script_fields?: Record<string, { script: { source: string; params?: Record<string, unknown> } }>
  post_filter?: Query
  search_after?: unknown[]
  pit?: { id: string; keep_alive?: string }
  knn?: KnnQuery['knn'] | Array<KnnQuery['knn']>
  rank?: { rrf?: { window_size?: number; rank_constant?: number } }
}

/**
 * Search response body
 */
export interface SearchResponse<T extends Document = Document> {
  took: number
  timed_out: boolean
  _shards: {
    total: number
    successful: number
    skipped: number
    failed: number
  }
  hits: SearchHits<T>
  aggregations?: Record<string, AggregationResult>
  _scroll_id?: string
  pit_id?: string
}

// ============================================================================
// INDEX OPERATIONS
// ============================================================================

/**
 * Index request (single document)
 */
export interface IndexRequest<T extends Document = Document> {
  index: string
  id?: string
  document: T
  refresh?: boolean | 'wait_for'
  routing?: string
  timeout?: string
  version?: number
  version_type?: 'internal' | 'external' | 'external_gte'
  if_seq_no?: number
  if_primary_term?: number
  pipeline?: string
  require_alias?: boolean
}

/**
 * Index response
 */
export interface IndexResponse {
  _index: string
  _id: string
  _version: number
  result: 'created' | 'updated' | 'deleted' | 'noop'
  _shards: {
    total: number
    successful: number
    failed: number
  }
  _seq_no: number
  _primary_term: number
}

/**
 * Get request
 */
export interface GetRequest {
  index: string
  id: string
  _source?: SourceFilter
  _source_excludes?: string[]
  _source_includes?: string[]
  stored_fields?: string[]
  routing?: string
  preference?: string
  realtime?: boolean
  refresh?: boolean
  version?: number
  version_type?: 'internal' | 'external' | 'external_gte'
}

/**
 * Get response
 */
export interface GetResponse<T extends Document = Document> {
  _index: string
  _id: string
  _version?: number
  _seq_no?: number
  _primary_term?: number
  found: boolean
  _source?: T
}

/**
 * Delete request
 */
export interface DeleteRequest {
  index: string
  id: string
  refresh?: boolean | 'wait_for'
  routing?: string
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
 * Update request
 */
export interface UpdateRequest<T extends Document = Document> {
  index: string
  id: string
  doc?: Partial<T>
  script?: {
    source: string
    lang?: string
    params?: Record<string, unknown>
  }
  upsert?: T
  doc_as_upsert?: boolean
  scripted_upsert?: boolean
  detect_noop?: boolean
  _source?: SourceFilter
  refresh?: boolean | 'wait_for'
  retry_on_conflict?: number
  routing?: string
  timeout?: string
  if_seq_no?: number
  if_primary_term?: number
}

/**
 * Update response
 */
export interface UpdateResponse<T extends Document = Document> {
  _index: string
  _id: string
  _version: number
  result: 'created' | 'updated' | 'deleted' | 'noop'
  _shards: {
    total: number
    successful: number
    failed: number
  }
  _seq_no: number
  _primary_term: number
  get?: GetResponse<T>
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * Bulk operation action
 */
export interface BulkOperationAction {
  _index?: string
  _id?: string
  routing?: string
  version?: number
  version_type?: 'internal' | 'external' | 'external_gte'
  if_seq_no?: number
  if_primary_term?: number
  require_alias?: boolean
  dynamic_templates?: Record<string, string>
}

/**
 * Bulk index operation
 */
export interface BulkIndexOperation<T extends Document = Document> {
  index: BulkOperationAction
  document?: T
}

/**
 * Bulk create operation
 */
export interface BulkCreateOperation<T extends Document = Document> {
  create: BulkOperationAction
  document?: T
}

/**
 * Bulk update operation
 */
export interface BulkUpdateOperation<T extends Document = Document> {
  update: BulkOperationAction
  doc?: Partial<T>
  script?: { source: string; lang?: string; params?: Record<string, unknown> }
  doc_as_upsert?: boolean
  upsert?: T
}

/**
 * Bulk delete operation
 */
export interface BulkDeleteOperation {
  delete: BulkOperationAction
}

/**
 * Bulk operation
 */
export type BulkOperation<T extends Document = Document> =
  | BulkIndexOperation<T>
  | BulkCreateOperation<T>
  | BulkUpdateOperation<T>
  | BulkDeleteOperation

/**
 * Bulk request
 */
export interface BulkRequest<T extends Document = Document> {
  index?: string
  operations: Array<BulkOperation<T> | T>
  refresh?: boolean | 'wait_for'
  routing?: string
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
  status: number
  _seq_no?: number
  _primary_term?: number
  _shards?: {
    total: number
    successful: number
    failed: number
  }
  error?: {
    type: string
    reason: string
    index?: string
    shard?: string
    index_uuid?: string
    caused_by?: { type: string; reason: string }
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
// INDEX MANAGEMENT
// ============================================================================

/**
 * Field mapping
 */
export interface FieldMapping {
  type:
    | 'text'
    | 'keyword'
    | 'long'
    | 'integer'
    | 'short'
    | 'byte'
    | 'double'
    | 'float'
    | 'half_float'
    | 'scaled_float'
    | 'date'
    | 'date_nanos'
    | 'boolean'
    | 'binary'
    | 'integer_range'
    | 'float_range'
    | 'long_range'
    | 'double_range'
    | 'date_range'
    | 'object'
    | 'nested'
    | 'geo_point'
    | 'geo_shape'
    | 'ip'
    | 'completion'
    | 'token_count'
    | 'dense_vector'
    | 'sparse_vector'
    | 'search_as_you_type'
    | 'alias'
    | 'flattened'
    | 'shape'
    | 'histogram'
    | 'constant_keyword'
  analyzer?: string
  search_analyzer?: string
  index?: boolean
  store?: boolean
  doc_values?: boolean
  norms?: boolean
  eager_global_ordinals?: boolean
  null_value?: unknown
  copy_to?: string | string[]
  coerce?: boolean
  ignore_malformed?: boolean
  ignore_above?: number
  format?: string
  normalizer?: string
  boost?: number
  fielddata?: boolean
  similarity?: string
  term_vector?: 'no' | 'yes' | 'with_positions' | 'with_offsets' | 'with_positions_offsets' | 'with_positions_payloads' | 'with_positions_offsets_payloads'
  fields?: Record<string, FieldMapping>
  properties?: Record<string, FieldMapping>
  dims?: number
  index_options?: 'docs' | 'freqs' | 'positions' | 'offsets'
  element_type?: string
  scaling_factor?: number
}

/**
 * Index mappings
 */
export interface IndexMappings {
  dynamic?: 'true' | 'false' | 'strict' | boolean
  dynamic_templates?: Array<{
    [name: string]: {
      match?: string
      match_mapping_type?: string
      path_match?: string
      path_unmatch?: string
      match_pattern?: 'simple' | 'regex'
      mapping: FieldMapping
    }
  }>
  properties?: Record<string, FieldMapping>
  _source?: {
    enabled?: boolean
    includes?: string[]
    excludes?: string[]
  }
  _routing?: {
    required?: boolean
  }
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
  max_terms_count?: number
  max_regex_length?: number
  routing?: {
    allocation?: {
      enable?: 'all' | 'primaries' | 'new_primaries' | 'none'
      include?: Record<string, string>
      exclude?: Record<string, string>
      require?: Record<string, string>
    }
  }
  analysis?: {
    analyzer?: Record<string, AnalyzerConfig>
    tokenizer?: Record<string, TokenizerConfig>
    filter?: Record<string, TokenFilterConfig>
    char_filter?: Record<string, CharFilterConfig>
    normalizer?: Record<string, NormalizerConfig>
  }
  [key: string]: unknown
}

/**
 * Analyzer configuration
 */
export interface AnalyzerConfig {
  type?: string
  tokenizer?: string
  char_filter?: string[]
  filter?: string[]
  stopwords?: string | string[]
  stopwords_path?: string
}

/**
 * Tokenizer configuration
 */
export interface TokenizerConfig {
  type: string
  [key: string]: unknown
}

/**
 * Token filter configuration
 */
export interface TokenFilterConfig {
  type: string
  [key: string]: unknown
}

/**
 * Char filter configuration
 */
export interface CharFilterConfig {
  type: string
  [key: string]: unknown
}

/**
 * Normalizer configuration
 */
export interface NormalizerConfig {
  type?: string
  char_filter?: string[]
  filter?: string[]
}

/**
 * Create index request
 */
export interface CreateIndexRequest {
  index: string
  mappings?: IndexMappings
  settings?: IndexSettings
  aliases?: Record<string, { filter?: Query; routing?: string; index_routing?: string; search_routing?: string }>
}

/**
 * Create index response
 */
export interface CreateIndexResponse {
  acknowledged: boolean
  shards_acknowledged: boolean
  index: string
}

/**
 * Delete index request
 */
export interface DeleteIndexRequest {
  index: string | string[]
  timeout?: string
  master_timeout?: string
  ignore_unavailable?: boolean
  allow_no_indices?: boolean
  expand_wildcards?: 'all' | 'open' | 'closed' | 'hidden' | 'none'
}

/**
 * Delete index response
 */
export interface DeleteIndexResponse {
  acknowledged: boolean
}

/**
 * Get index request
 */
export interface GetIndexRequest {
  index: string | string[]
  allow_no_indices?: boolean
  expand_wildcards?: 'all' | 'open' | 'closed' | 'hidden' | 'none'
  flat_settings?: boolean
  ignore_unavailable?: boolean
  include_defaults?: boolean
  local?: boolean
  master_timeout?: string
}

/**
 * Index info
 */
export interface IndexInfo {
  aliases: Record<string, { filter?: Query; routing?: string }>
  mappings: IndexMappings
  settings: { index: IndexSettings }
}

/**
 * Get index response
 */
export type GetIndexResponse = Record<string, IndexInfo>

/**
 * Index exists request
 */
export interface IndexExistsRequest {
  index: string | string[]
  allow_no_indices?: boolean
  expand_wildcards?: 'all' | 'open' | 'closed' | 'hidden' | 'none'
  flat_settings?: boolean
  ignore_unavailable?: boolean
  local?: boolean
}

// ============================================================================
// CLIENT OPTIONS
// ============================================================================

/**
 * Extended client options for DO backing
 */
export interface ElasticsearchClientOptions {
  /** DO namespace binding for storage */
  doNamespace?: DurableObjectNamespace
  /** Default index name */
  defaultIndex?: string
  /** Refresh behavior */
  refresh?: boolean | 'wait_for'
  /** Request timeout in ms */
  timeout?: number
  /** Max retries */
  maxRetries?: number
  /** Vector search configuration */
  vector?: {
    /** Vector dimensions */
    dimensions?: number
    /** Distance metric */
    metric?: 'cosine' | 'l2' | 'dot'
    /** HNSW M parameter */
    M?: number
    /** HNSW ef parameter */
    efConstruction?: number
  }
}

// ============================================================================
// CLIENT INTERFACE
// ============================================================================

/**
 * Elasticsearch Client interface
 */
export interface ElasticsearchClient {
  // Document operations
  index<T extends Document = Document>(request: IndexRequest<T>): Promise<IndexResponse>
  get<T extends Document = Document>(request: GetRequest): Promise<GetResponse<T>>
  delete(request: DeleteRequest): Promise<DeleteResponse>
  update<T extends Document = Document>(request: UpdateRequest<T>): Promise<UpdateResponse<T>>
  bulk<T extends Document = Document>(request: BulkRequest<T>): Promise<BulkResponse>
  search<T extends Document = Document>(request: { index: string | string[] } & SearchRequest<T>): Promise<SearchResponse<T>>

  // Index management
  indices: {
    create(request: CreateIndexRequest): Promise<CreateIndexResponse>
    delete(request: DeleteIndexRequest): Promise<DeleteIndexResponse>
    get(request: GetIndexRequest): Promise<GetIndexResponse>
    exists(request: IndexExistsRequest): Promise<boolean>
    refresh(request: { index: string | string[] }): Promise<{ _shards: { total: number; successful: number; failed: number } }>
    putMapping(request: { index: string; body: IndexMappings }): Promise<{ acknowledged: boolean }>
    getMapping(request: { index: string | string[] }): Promise<Record<string, { mappings: IndexMappings }>>
    putSettings(request: { index: string; body: IndexSettings }): Promise<{ acknowledged: boolean }>
    getSettings(request: { index: string | string[] }): Promise<Record<string, { settings: { index: IndexSettings } }>>
  }

  // Cluster operations
  cluster: {
    health(request?: { index?: string | string[]; level?: 'cluster' | 'indices' | 'shards' }): Promise<ClusterHealthResponse>
    stats(): Promise<ClusterStatsResponse>
  }

  // Client utilities
  ping(): Promise<boolean>
  info(): Promise<InfoResponse>
  close(): Promise<void>
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
}

/**
 * Cluster stats response
 */
export interface ClusterStatsResponse {
  cluster_name: string
  cluster_uuid: string
  timestamp: number
  status: 'green' | 'yellow' | 'red'
  indices: {
    count: number
    docs: { count: number; deleted: number }
    store: { size_in_bytes: number }
  }
  nodes: {
    count: { total: number }
  }
}

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
// ERROR TYPES
// ============================================================================

/**
 * Base Elasticsearch error
 */
export class ElasticsearchError extends Error {
  statusCode?: number
  body?: unknown

  constructor(message: string, statusCode?: number, body?: unknown) {
    super(message)
    this.name = 'ElasticsearchError'
    this.statusCode = statusCode
    this.body = body
  }
}

/**
 * Response error (from ES server)
 */
export class ResponseError extends ElasticsearchError {
  meta: {
    statusCode: number
    body: unknown
    headers?: Record<string, string>
  }

  constructor(statusCode: number, body: unknown, message?: string) {
    super(message || `Response Error: ${statusCode}`, statusCode, body)
    this.name = 'ResponseError'
    this.meta = { statusCode, body }
  }
}

/**
 * Connection error
 */
export class ConnectionError extends ElasticsearchError {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionError'
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends ElasticsearchError {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends ResponseError {
  constructor(body: unknown, message?: string) {
    super(404, body, message || 'Not Found')
    this.name = 'NotFoundError'
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends ResponseError {
  constructor(body: unknown, message?: string) {
    super(409, body, message || 'Conflict')
    this.name = 'ConflictError'
  }
}

/**
 * Bad request error (400)
 */
export class BadRequestError extends ResponseError {
  constructor(body: unknown, message?: string) {
    super(400, body, message || 'Bad Request')
    this.name = 'BadRequestError'
  }
}
