/**
 * @dotdo/orama - Orama-compatible full-text search
 *
 * Drop-in replacement for @orama/orama backed by DO SQLite FTS5.
 * This in-memory implementation matches Orama API for testing.
 * Production version uses SQLite FTS5 in Durable Objects.
 *
 * @see https://docs.orama.com/
 */

// Types
export type {
  Schema,
  SchemaFieldType,
  Document,
  OramaConfig,
  Orama,
  SearchParams,
  SearchResult,
  SearchHit,
  WhereFilter,
  WhereOperator,
} from './types'

// Core functions
export {
  create,
  insert,
  insertMultiple,
  remove,
  update,
  search,
  count,
  getByID,
} from './orama'
