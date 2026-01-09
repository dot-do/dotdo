/**
 * @dotdo/turso - Turso/libSQL SDK compat
 *
 * Drop-in replacement for @libsql/client backed by DO SQLite.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://docs.turso.tech/sdk/ts/reference
 */

// Types
export type {
  Value,
  InValue,
  InArgs,
  InStatement,
  IntMode,
  TransactionMode,
  Row,
  ResultSet,
  Replicated,
  Config,
  ExtendedTursoConfig,
  Transaction,
  Client,
} from './types'

// Error classes
export { LibsqlError, LibsqlBatchError } from './types'

// Core functions
export { createClient, createResultSet, parseStatement } from './turso'
