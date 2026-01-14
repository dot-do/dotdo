/**
 * SearchEngine Types - Full-text search primitives
 *
 * Provides types for a comprehensive search engine:
 * - SearchQuery: Query with filters, facets, sort, pagination
 * - SearchResult: Results with hits, facets, highlights
 * - InvertedIndex: Core index structure
 * - Analyzers: Text analysis pipelines
 */

// =============================================================================
// Analyzer Types
// =============================================================================

/**
 * Text analyzer types for tokenization
 */
export type AnalyzerType = 'standard' | 'keyword' | 'ngram' | 'edge-ngram' | 'whitespace' | 'lowercase'

/**
 * Analyzer configuration
 */
export interface AnalyzerConfig {
  /** Analyzer type */
  type: AnalyzerType
  /** Minimum n-gram size (for ngram/edge-ngram) */
  minGram?: number
  /** Maximum n-gram size (for ngram/edge-ngram) */
  maxGram?: number
  /** Stop words to filter out */
  stopWords?: string[]
  /** Custom token filters */
  tokenFilters?: TokenFilter[]
}

/**
 * Token filter types
 */
export type TokenFilter = 'lowercase' | 'stemmer' | 'stop' | 'ascii-folding' | 'synonym'

// =============================================================================
// Index Mapping Types
// =============================================================================

/**
 * Field type for indexing
 */
export type FieldType = 'text' | 'keyword' | 'number' | 'boolean' | 'date' | 'geo_point'

/**
 * Field mapping configuration
 */
export interface FieldMapping {
  /** Field data type */
  type: FieldType
  /** Analyzer for text fields */
  analyzer?: AnalyzerType
  /** Whether to index this field for search */
  index?: boolean
  /** Whether to store the original value */
  store?: boolean
  /** Whether to enable faceting on this field */
  facet?: boolean
  /** Boost factor for relevance scoring */
  boost?: number
}

/**
 * Index mapping configuration
 */
export interface IndexMapping {
  /** Field mappings */
  fields: Record<string, FieldMapping>
  /** Default analyzer for text fields */
  defaultAnalyzer?: AnalyzerType
  /** Index settings */
  settings?: IndexSettings
}

/**
 * Index settings
 */
export interface IndexSettings {
  /** Number of shards (for distributed index) */
  numberOfShards?: number
  /** Refresh interval in milliseconds */
  refreshInterval?: number
  /** Maximum result window */
  maxResultWindow?: number
}

// =============================================================================
// Filter Types
// =============================================================================

/**
 * Filter operators
 */
export type FilterOperator =
  | 'eq'       // equals
  | 'ne'       // not equals
  | 'gt'       // greater than
  | 'gte'      // greater than or equal
  | 'lt'       // less than
  | 'lte'      // less than or equal
  | 'in'       // in array
  | 'nin'      // not in array
  | 'exists'   // field exists
  | 'prefix'   // prefix match
  | 'range'    // range query
  | 'regex'    // regex match

/**
 * Search filter definition
 */
export interface SearchFilter {
  /** Field to filter on */
  field: string
  /** Filter operator */
  operator: FilterOperator
  /** Filter value(s) */
  value: unknown
  /** For range queries: upper bound */
  to?: unknown
}

// =============================================================================
// Sort Types
// =============================================================================

/**
 * Sort order
 */
export type SortOrder = 'asc' | 'desc'

/**
 * Sort option
 */
export interface SortOption {
  /** Field to sort by (use '_score' for relevance) */
  field: string
  /** Sort order */
  order: SortOrder
}

// =============================================================================
// Facet Types
// =============================================================================

/**
 * Facet value with count
 */
export interface FacetValue {
  /** Facet value */
  value: string | number | boolean
  /** Number of documents with this value */
  count: number
}

/**
 * Facet result for a field
 */
export interface Facet {
  /** Field name */
  field: string
  /** Facet values with counts */
  values: FacetValue[]
  /** Total unique values */
  totalValues: number
}

/**
 * Facet request configuration
 */
export interface FacetRequest {
  /** Field to facet on */
  field: string
  /** Maximum number of facet values to return */
  size?: number
  /** Minimum count threshold */
  minCount?: number
  /** Sort facets by count or value */
  sortBy?: 'count' | 'value'
}

// =============================================================================
// Highlight Types
// =============================================================================

/**
 * Highlight configuration
 */
export interface HighlightConfig {
  /** Fields to highlight */
  fields: string[]
  /** Pre-tag for highlighting (default: <em>) */
  preTag?: string
  /** Post-tag for highlighting (default: </em>) */
  postTag?: string
  /** Fragment size in characters */
  fragmentSize?: number
  /** Number of fragments to return */
  numberOfFragments?: number
}

/**
 * Highlighted snippets for a document
 */
export interface HighlightResult {
  /** Field name to highlighted snippets */
  [field: string]: string[]
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Pagination options
 */
export interface Pagination {
  /** Number of results to skip (offset) */
  offset?: number
  /** Maximum number of results to return (limit) */
  limit?: number
}

/**
 * Query options for advanced matching
 */
export interface QueryOptions {
  /** Fields to search in (default: all text fields) */
  fields?: string[]
  /** Enable fuzzy matching */
  fuzziness?: number | 'auto'
  /** Enable prefix matching */
  prefixLength?: number
  /** Minimum should match for multi-term queries */
  minimumShouldMatch?: number | string
  /** Query-time boost */
  boost?: number
  /** Default operator for multiple terms */
  defaultOperator?: 'AND' | 'OR'
  /** Enable phrase matching (preserve word order) */
  phrase?: boolean
  /** Phrase slop (words between phrase terms) */
  phraseSlop?: number
}

/**
 * Search query definition
 */
export interface SearchQuery {
  /** Query string (supports AND, OR, NOT, phrases) */
  query: string
  /** Filters to apply */
  filters?: SearchFilter[]
  /** Facets to compute */
  facets?: FacetRequest[]
  /** Sort options */
  sort?: SortOption[]
  /** Pagination */
  pagination?: Pagination
  /** Highlight configuration */
  highlight?: HighlightConfig
  /** Query options */
  options?: QueryOptions
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Individual search hit
 */
export interface SearchHit<T = Record<string, unknown>> {
  /** Document ID */
  id: string
  /** Relevance score */
  score: number
  /** Document source data */
  source: T
  /** Highlighted snippets */
  highlights?: HighlightResult
  /** Sort values (for pagination) */
  sortValues?: unknown[]
}

/**
 * Search result
 */
export interface SearchResult<T = Record<string, unknown>> {
  /** Matching documents */
  hits: SearchHit<T>[]
  /** Total number of matching documents */
  total: number
  /** Facet results */
  facets?: Facet[]
  /** Query execution time in milliseconds */
  took: number
  /** Maximum score */
  maxScore: number
}

// =============================================================================
// Document Types
// =============================================================================

/**
 * Document to index
 */
export interface IndexDocument<T = Record<string, unknown>> {
  /** Document ID (optional, auto-generated if not provided) */
  id?: string
  /** Document data */
  source: T
}

/**
 * Bulk operation types
 */
export type BulkOperation =
  | { type: 'index'; id?: string; source: Record<string, unknown> }
  | { type: 'update'; id: string; source: Partial<Record<string, unknown>> }
  | { type: 'delete'; id: string }

/**
 * Bulk operation result
 */
export interface BulkResult {
  /** Number of successful operations */
  successful: number
  /** Number of failed operations */
  failed: number
  /** Individual operation results */
  items: BulkItemResult[]
  /** Total time in milliseconds */
  took: number
}

/**
 * Individual bulk item result
 */
export interface BulkItemResult {
  /** Operation type */
  type: 'index' | 'update' | 'delete'
  /** Document ID */
  id: string
  /** Whether operation succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
}

// =============================================================================
// Index State Types
// =============================================================================

/**
 * Index statistics
 */
export interface IndexStats {
  /** Total documents in index */
  documentCount: number
  /** Total unique terms */
  termCount: number
  /** Index size in bytes (approximate) */
  sizeInBytes: number
  /** Last refresh timestamp */
  lastRefresh: number
}

/**
 * Parsed query token
 */
export interface QueryToken {
  /** Token type */
  type: 'term' | 'phrase' | 'operator' | 'field' | 'wildcard' | 'fuzzy'
  /** Token value */
  value: string
  /** Field qualifier (for field:value queries) */
  field?: string
  /** Fuzziness value */
  fuzziness?: number
  /** Whether negated */
  negated?: boolean
}

/**
 * Inverted index posting
 */
export interface Posting {
  /** Document ID */
  docId: string
  /** Term frequency in document */
  termFreq: number
  /** Field name */
  field: string
  /** Positions of term in field */
  positions?: number[]
}

/**
 * Inverted index entry for a term
 */
export interface IndexEntry {
  /** Document frequency (number of docs containing term) */
  docFreq: number
  /** Postings list */
  postings: Posting[]
}

// =============================================================================
// Interface Types
// =============================================================================

/**
 * Search engine interface
 */
export interface ISearchEngine<T = Record<string, unknown>> {
  /**
   * Execute a search query
   * @param query Search query
   * @returns Search results
   */
  search(query: SearchQuery | string): Promise<SearchResult<T>>

  /**
   * Index a single document
   * @param doc Document to index
   * @returns Document ID
   */
  index(doc: IndexDocument<T>): Promise<string>

  /**
   * Bulk index multiple documents
   * @param docs Documents to index
   * @returns Bulk result
   */
  bulkIndex(docs: IndexDocument<T>[]): Promise<BulkResult>

  /**
   * Delete a document by ID
   * @param id Document ID
   * @returns Whether document was deleted
   */
  delete(id: string): Promise<boolean>

  /**
   * Update a document
   * @param id Document ID
   * @param doc Partial document update
   * @returns Whether document was updated
   */
  update(id: string, doc: Partial<T>): Promise<boolean>

  /**
   * Get a document by ID
   * @param id Document ID
   * @returns Document or null
   */
  get(id: string): Promise<T | null>

  /**
   * Get index statistics
   * @returns Index stats
   */
  stats(): Promise<IndexStats>

  /**
   * Clear all documents from index
   */
  clear(): Promise<void>
}
