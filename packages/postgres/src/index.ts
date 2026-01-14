/**
 * @dotdo/postgres - PostgreSQL Package for Cloudflare Workers
 *
 * Drop-in replacement for pg (node-postgres) that runs on Cloudflare Workers
 * using an in-memory SQL engine. Perfect for testing and edge-native execution.
 *
 * Features:
 * - API-compatible with `pg` npm package
 * - Client and Pool classes with full event support
 * - Parameterized queries with $1, $2, ... placeholders
 * - Transaction support (BEGIN/COMMIT/ROLLBACK/SAVEPOINT)
 * - Connection pooling with configurable limits
 * - PostgreSQL-style error handling with SQLSTATE codes
 * - In-memory SQL backend for testing
 *
 * @example Basic Client usage
 * ```typescript
 * import { Client } from '@dotdo/postgres'
 *
 * const client = new Client({
 *   host: 'localhost',
 *   database: 'mydb',
 *   user: 'postgres',
 *   password: 'secret',
 * })
 *
 * await client.connect()
 * const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [1])
 * console.log(rows)
 * await client.end()
 * ```
 *
 * @example Using Pool for connection management
 * ```typescript
 * import { Pool } from '@dotdo/postgres'
 *
 * const pool = new Pool({
 *   connectionString: 'postgres://localhost/mydb',
 *   max: 20,
 * })
 *
 * // Simple query
 * const { rows } = await pool.query('SELECT * FROM users')
 *
 * // Transaction with checkout
 * const client = await pool.connect()
 * try {
 *   await client.query('BEGIN')
 *   await client.query('INSERT INTO users (name) VALUES ($1)', ['Alice'])
 *   await client.query('COMMIT')
 * } catch (e) {
 *   await client.query('ROLLBACK')
 *   throw e
 * } finally {
 *   client.release()
 * }
 *
 * await pool.end()
 * ```
 *
 * @see https://node-postgres.com/
 */

// ============================================================================
// CORE CLASSES
// ============================================================================

export { Client, PostgresClient } from './client'
export { Pool, PostgresPool } from './pool'

// ============================================================================
// TYPES
// ============================================================================

export {
  // Value types
  type Value,
  type QueryValue,
  type QueryParams,
  // Result types
  type FieldDef,
  type QueryResult,
  type QueryArrayResult,
  // Query types
  type QueryConfig,
  type Submittable,
  type Query,
  // Notification types
  type Notification,
  // Connection types
  type ConnectionConfig,
  type TLSConfig,
  type Connection,
  // Pool types
  type PoolConfig,
  type PoolClient,
  type Pool as IPool,
  // Client types
  type ClientConfig,
  type Client as IClient,
  // Cursor types
  type Cursor,
  // Type parsing
  type TypeParser,
  type CustomTypesConfig,
  type TypeParsers,
  // Extended config
  type ExtendedPostgresConfig,
} from './types'

// ============================================================================
// ERROR CLASSES
// ============================================================================

export { DatabaseError, ConnectionError } from './types'

// ============================================================================
// TYPE CONSTANTS
// ============================================================================

export { types } from './types'

// ============================================================================
// QUERY UTILITIES
// ============================================================================

export {
  literal,
  identifier,
  sql,
  query,
  prepared,
  type QueryConfig as QueryBuilderConfig,
} from './query'

// ============================================================================
// IN-MEMORY BACKEND
// ============================================================================

export {
  InMemorySQLEngine,
  createInMemoryEngine,
  SQLError,
  SQLParseError,
  TableNotFoundError,
  TableExistsError,
  UniqueConstraintError,
  type SQLValue,
  type StorageValue,
  type TableSchema,
  type StoredRow,
  type ExecutionResult,
} from './backends/memory'

// ============================================================================
// NATIVE BINDING (SIMULATED)
// ============================================================================

import { Client as PostgresClientClass } from './client'
import { Pool as PostgresPoolClass } from './pool'

/**
 * Create a new native PostgreSQL binding (simulated)
 * Returns the same Client and Pool classes for compatibility.
 */
export function native(): { Client: typeof PostgresClientClass; Pool: typeof PostgresPoolClass } {
  return { Client: PostgresClientClass, Pool: PostgresPoolClass }
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

import { types as typeConstants } from './types'
import { DatabaseError as DbError, ConnectionError as ConnError } from './types'

/**
 * Default export matching pg module structure
 */
export default {
  Client: PostgresClientClass,
  Pool: PostgresPoolClass,
  types: typeConstants,
  DatabaseError: DbError,
  ConnectionError: ConnError,
  native,
}
