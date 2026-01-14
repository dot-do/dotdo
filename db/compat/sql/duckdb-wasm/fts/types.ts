/**
 * Type definitions for DuckDB FTS (Full Text Search) extension wrapper
 *
 * DuckDB's FTS extension provides:
 * - BM25 ranking algorithm for relevance scoring
 * - Snowball stemmer support for 20+ languages
 * - Porter stemmer as default
 *
 * @module @dotdo/duckdb-wasm/fts/types
 * @see https://duckdb.org/docs/extensions/full_text_search
 */

// ============================================================================
// STEMMER LANGUAGES
// ============================================================================

/**
 * Supported stemmer languages for the Snowball stemmer
 *
 * The Snowball stemmer is an algorithm for reducing words to their root form.
 * Different languages have different stemming rules.
 *
 * @see https://snowballstem.org/algorithms/
 */
export type StemmerLanguage =
  | 'arabic'
  | 'basque'
  | 'catalan'
  | 'danish'
  | 'dutch'
  | 'english'
  | 'finnish'
  | 'french'
  | 'german'
  | 'greek'
  | 'hindi'
  | 'hungarian'
  | 'indonesian'
  | 'irish'
  | 'italian'
  | 'lithuanian'
  | 'nepali'
  | 'norwegian'
  | 'porter'     // Porter stemmer (English, classic algorithm)
  | 'portuguese'
  | 'romanian'
  | 'russian'
  | 'serbian'
  | 'spanish'
  | 'swedish'
  | 'tamil'
  | 'turkish'
  | 'none'       // No stemming (exact match only)

// ============================================================================
// FTS INDEX CONFIGURATION
// ============================================================================

/**
 * Configuration options for creating a Full Text Search index
 */
export interface FTSIndexConfig {
  /**
   * The table name to index
   */
  table: string

  /**
   * Column(s) to include in the FTS index
   * Can be a single column name or array of column names
   */
  columns: string | string[]

  /**
   * Name for the FTS index (auto-generated if not specified)
   * Format: fts_main_{table}_{columns}
   */
  indexName?: string

  /**
   * Stemmer language for word normalization
   * @default 'porter'
   */
  stemmer?: StemmerLanguage

  /**
   * Stopwords to exclude from indexing
   * @default 'english' (uses built-in English stopwords)
   */
  stopwords?: 'english' | 'none' | string[]

  /**
   * Whether to ignore case in search
   * @default true
   */
  ignoreCase?: boolean

  /**
   * Whether to strip accents from characters
   * @default true
   */
  stripAccents?: boolean

  /**
   * Whether to ignore punctuation
   * @default true
   */
  ignorePunctuation?: boolean

  /**
   * Minimum word length to index
   * Words shorter than this are ignored
   * @default 1
   */
  minWordLength?: number

  /**
   * Maximum word length to index
   * Words longer than this are truncated
   * @default 255
   */
  maxWordLength?: number

  /**
   * Document ID column name (must be unique)
   * If not specified, uses the first column or rowid
   */
  docIdColumn?: string

  /**
   * Whether to overwrite existing index with same name
   * @default false
   */
  overwrite?: boolean
}

// ============================================================================
// FTS INDEX METADATA
// ============================================================================

/**
 * Metadata about an existing FTS index
 */
export interface FTSIndexInfo {
  /**
   * Index name
   */
  name: string

  /**
   * Source table name
   */
  table: string

  /**
   * Indexed columns
   */
  columns: string[]

  /**
   * Stemmer language used
   */
  stemmer: StemmerLanguage

  /**
   * Document ID column
   */
  docIdColumn: string

  /**
   * When the index was created
   */
  createdAt?: Date

  /**
   * Number of indexed documents
   */
  documentCount?: number
}

// ============================================================================
// SEARCH OPTIONS
// ============================================================================

/**
 * Options for FTS search queries
 */
export interface FTSSearchOptions {
  /**
   * Maximum number of results to return
   * @default 10
   */
  limit?: number

  /**
   * Number of results to skip (for pagination)
   * @default 0
   */
  offset?: number

  /**
   * Minimum BM25 score threshold
   * Results below this score are excluded
   * @default 0
   */
  minScore?: number

  /**
   * Columns to return in results (in addition to docId and score)
   * Use '*' for all columns from the source table
   * @default ['*']
   */
  select?: string[] | '*'

  /**
   * Additional WHERE clause conditions (applied after FTS)
   * Example: "status = 'active'"
   */
  where?: string

  /**
   * Sort order for results
   * @default 'score_desc' (highest relevance first)
   */
  orderBy?: 'score_desc' | 'score_asc' | string

  /**
   * Whether to include match highlights in results
   * @default false
   */
  highlight?: boolean

  /**
   * HTML tag for highlighting matched terms
   * @default '<b>'
   */
  highlightTag?: string

  /**
   * BM25 tuning parameter k1 (term frequency saturation)
   * Higher values give more weight to term frequency
   * @default 1.2
   */
  bm25K1?: number

  /**
   * BM25 tuning parameter b (document length normalization)
   * 0 = no length normalization, 1 = full normalization
   * @default 0.75
   */
  bm25B?: number

  /**
   * Fields to boost in scoring (column -> boost factor)
   * Example: { title: 2.0, body: 1.0 }
   */
  boosts?: Record<string, number>

  /**
   * Whether to use fuzzy matching
   * @default false
   */
  fuzzy?: boolean

  /**
   * Maximum edit distance for fuzzy matching
   * @default 2
   */
  fuzzyMaxDistance?: number
}

// ============================================================================
// SEARCH RESULTS
// ============================================================================

/**
 * A single search result with BM25 relevance score
 */
export interface FTSSearchResult<T = Record<string, unknown>> {
  /**
   * Document ID (from docIdColumn)
   */
  docId: string | number

  /**
   * BM25 relevance score
   * Higher scores indicate better matches
   */
  score: number

  /**
   * Document data from the source table
   */
  document: T

  /**
   * Highlighted matches (if highlight option enabled)
   * Maps column name to highlighted text
   */
  highlights?: Record<string, string>
}

/**
 * Full text search results with metadata
 */
export interface FTSSearchResults<T = Record<string, unknown>> {
  /**
   * Array of search results, ordered by relevance
   */
  results: FTSSearchResult<T>[]

  /**
   * Total number of matching documents (before limit/offset)
   */
  totalCount: number

  /**
   * Maximum score among all results
   */
  maxScore: number

  /**
   * Query execution time in milliseconds
   */
  queryTimeMs: number

  /**
   * The search query that was executed
   */
  query: string

  /**
   * Parsed/normalized search terms
   */
  searchTerms: string[]
}

// ============================================================================
// CREATE/DROP RESULTS
// ============================================================================

/**
 * Result from creating an FTS index
 */
export interface FTSCreateResult {
  /**
   * Whether the index was created successfully
   */
  success: boolean

  /**
   * Index name (generated or provided)
   */
  indexName: string

  /**
   * Source table name
   */
  table: string

  /**
   * Indexed columns
   */
  columns: string[]

  /**
   * Time to create the index in milliseconds
   */
  createTimeMs: number

  /**
   * Number of documents indexed
   */
  documentCount: number

  /**
   * Error if creation failed
   */
  error?: Error
}

/**
 * Result from dropping an FTS index
 */
export interface FTSDropResult {
  /**
   * Whether the index was dropped successfully
   */
  success: boolean

  /**
   * Index name that was dropped
   */
  indexName: string

  /**
   * Error if drop failed
   */
  error?: Error
}

/**
 * Result from rebuilding an FTS index
 */
export interface FTSRebuildResult {
  /**
   * Whether the rebuild was successful
   */
  success: boolean

  /**
   * Index name that was rebuilt
   */
  indexName: string

  /**
   * Time to rebuild in milliseconds
   */
  rebuildTimeMs: number

  /**
   * Number of documents after rebuild
   */
  documentCount: number

  /**
   * Error if rebuild failed
   */
  error?: Error
}

// ============================================================================
// TOKENIZER OPTIONS
// ============================================================================

/**
 * Options for text tokenization (advanced)
 */
export interface TokenizerOptions {
  /**
   * Stemmer to use
   * @default 'porter'
   */
  stemmer?: StemmerLanguage

  /**
   * Whether to lowercase tokens
   * @default true
   */
  lowercase?: boolean

  /**
   * Whether to remove stopwords
   * @default true
   */
  removeStopwords?: boolean

  /**
   * Custom stopwords list
   */
  stopwords?: string[]

  /**
   * Regular expression for word boundaries
   * @default /\W+/
   */
  wordBoundary?: RegExp | string

  /**
   * Whether to split on CamelCase
   * @default false
   */
  splitCamelCase?: boolean
}

/**
 * Result from tokenizing text
 */
export interface TokenizeResult {
  /**
   * Original input text
   */
  original: string

  /**
   * Array of tokens
   */
  tokens: string[]

  /**
   * Stemmed tokens (if stemmer applied)
   */
  stems?: string[]
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Error types specific to FTS operations
 */
export enum FTSErrorCode {
  /** Index already exists */
  INDEX_EXISTS = 'INDEX_EXISTS',
  /** Index not found */
  INDEX_NOT_FOUND = 'INDEX_NOT_FOUND',
  /** Table not found */
  TABLE_NOT_FOUND = 'TABLE_NOT_FOUND',
  /** Column not found in table */
  COLUMN_NOT_FOUND = 'COLUMN_NOT_FOUND',
  /** Extension loading failed */
  EXTENSION_LOAD_FAILED = 'EXTENSION_LOAD_FAILED',
  /** Invalid search query */
  INVALID_QUERY = 'INVALID_QUERY',
  /** Index is out of sync with table */
  INDEX_STALE = 'INDEX_STALE',
  /** General FTS error */
  FTS_ERROR = 'FTS_ERROR',
}

/**
 * Custom error class for FTS operations
 */
export class FTSError extends Error {
  code: FTSErrorCode
  details?: Record<string, unknown>

  constructor(
    code: FTSErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'FTSError'
    this.code = code
    this.details = details
  }
}
