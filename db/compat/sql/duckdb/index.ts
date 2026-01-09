/**
 * @dotdo/duckdb - DuckDB SDK compat
 *
 * Drop-in replacement for duckdb-node backed by DO SQLite.
 * This implementation provides the full DuckDB Node.js API including:
 * - Database - Database creation and management
 * - run() - Execute DDL/DML statements
 * - all() - Execute SELECT queries returning all rows
 * - each() - Row-by-row iteration
 * - get() - Single row retrieval
 * - Prepared statements - prepare(), bind(), all(), finalize()
 * - Async API - open(), connect()
 * - Aggregate functions - COUNT, SUM, AVG, MIN, MAX
 *
 * @example
 * ```typescript
 * import { Database, open } from '@dotdo/duckdb'
 *
 * // Sync API
 * const db = new Database(':memory:')
 * db.run('CREATE TABLE users (id INTEGER, name VARCHAR)')
 * db.run('INSERT INTO users VALUES (?, ?)', [1, 'Alice'])
 * const rows = db.all('SELECT * FROM users')
 *
 * // Prepared statements
 * const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
 * const result = stmt.all(1)
 * stmt.finalize()
 *
 * // Async API
 * const asyncDb = await open(':memory:')
 * const conn = await asyncDb.connect()
 * const result2 = await conn.all('SELECT * FROM users')
 *
 * db.close()
 * ```
 *
 * @see https://duckdb.org/docs/api/nodejs/reference
 */

// Types
export type {
  // Configuration types
  AccessMode,
  DatabaseConfig,
  ExtendedDuckDBConfig,

  // Result types
  QueryResult,
  ColumnInfo,

  // Callback types
  DatabaseCallback,
  CloseCallback,
  RunCallback,
  AllCallback,
  GetCallback,
  EachRowCallback,
  EachCompleteCallback,
  FinalizeCallback,

  // Interface types
  IDatabase,
  IConnection,
  IStatement,
} from './types'

// Error classes
export { DuckDBError } from './types'

// Core classes and functions
export { Database, Connection, Statement, open, default as duckdb } from './duckdb'
