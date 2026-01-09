/**
 * @dotdo/orama types
 *
 * Orama-compatible type definitions for full-text search
 */

// ============================================================================
// SCHEMA TYPES
// ============================================================================

/**
 * Schema field types
 */
export type SchemaFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | `vector[${number}]`

/**
 * Schema definition
 */
export type Schema = {
  [key: string]: SchemaFieldType | Schema
}

/**
 * Document type inferred from schema
 */
export type Document<S extends Schema = Schema> = {
  id?: string
  [key: string]: unknown
}

// ============================================================================
// DATABASE TYPES
// ============================================================================

/**
 * Orama database configuration
 */
export interface OramaConfig<S extends Schema = Schema> {
  /** The schema defining document structure */
  schema: S
  /** Custom ID field name (default: 'id') */
  id?: string
  /** Default language for tokenization */
  language?: string
}

/**
 * Orama database instance
 */
export interface Orama<S extends Schema = Schema> {
  /** Schema definition */
  schema: S
  /** ID field name */
  id: string
  /** Language for tokenization */
  language: string
  /** Internal document storage */
  _docs: Map<string, Document<S>>
  /** Internal FTS index */
  _fts: Map<string, Set<string>>
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/**
 * Comparison operators for where filters
 */
export interface WhereOperator<T = unknown> {
  eq?: T
  ne?: T
  gt?: T
  gte?: T
  lt?: T
  lte?: T
  in?: T[]
  nin?: T[]
  contains?: string
  containsAny?: string[]
}

/**
 * Where filter definition
 */
export type WhereFilter = {
  [field: string]: WhereOperator
}

/**
 * Search parameters
 */
export interface SearchParams<S extends Schema = Schema> {
  /** Search term */
  term: string
  /** Maximum results */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Filter conditions */
  where?: WhereFilter
  /** Field boost weights */
  boost?: Record<string, number>
  /** Fields to search in */
  properties?: string[]
  /** Fuzzy match tolerance */
  tolerance?: number
  /** Exact match mode */
  exact?: boolean
}

/**
 * Search hit
 */
export interface SearchHit<S extends Schema = Schema> {
  /** Document ID */
  id: string
  /** Relevance score */
  score: number
  /** The matched document */
  document: Document<S>
}

/**
 * Search result
 */
export interface SearchResult<S extends Schema = Schema> {
  /** Total matching documents */
  count: number
  /** Search hits */
  hits: SearchHit<S>[]
  /** Time elapsed in ms */
  elapsed: {
    raw: number
    formatted: string
  }
}
