/**
 * @dotdo/postgres - PostgreSQL SDK compat
 *
 * Drop-in replacement for pg (node-postgres) backed by DO SQLite.
 * This implementation provides the full pg Client and Pool API including:
 * - Client - Single database connection
 * - Pool - Connection pooling
 * - query() - Execute parameterized queries
 * - connect()/release() - Connection management
 * - Transactions (BEGIN/COMMIT/ROLLBACK)
 * - Event handling (connect, end, error, notification)
 *
 * @example
 * ```typescript
 * import { Client, Pool } from '@dotdo/postgres'
 *
 * // Using Client
 * const client = new Client({
 *   host: 'localhost',
 *   database: 'mydb',
 *   user: 'postgres',
 *   password: 'secret',
 * })
 * await client.connect()
 * const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [1])
 * await client.end()
 *
 * // Using Pool
 * const pool = new Pool({
 *   connectionString: 'postgres://localhost/mydb',
 *   max: 20,
 * })
 * const { rows } = await pool.query('SELECT * FROM users')
 *
 * // Pool with checkout
 * const client = await pool.connect()
 * await client.query('BEGIN')
 * await client.query('INSERT INTO users (name) VALUES ($1)', ['Alice'])
 * await client.query('COMMIT')
 * client.release()
 *
 * await pool.end()
 * ```
 *
 * @see https://node-postgres.com/
 */

// Types
export type {
  // Value types
  Value,
  QueryValue,
  QueryParams,

  // Result types
  FieldDef,
  QueryResult,
  QueryArrayResult,

  // Query types
  QueryConfig,
  Submittable,
  Query,

  // Notification types
  Notification,

  // Connection types
  ConnectionConfig,
  TLSConfig,
  Connection,

  // Pool types
  PoolConfig,
  PoolClient,
  Pool as IPool,

  // Client types
  ClientConfig,
  Client as IClient,

  // Cursor types
  Cursor,

  // Type parsing
  TypeParser,
  CustomTypesConfig,
  TypeParsers,

  // Extended DO config
  ExtendedPostgresConfig,
} from './types'

// Error classes
export { DatabaseError, ConnectionError, types } from './types'

// Core classes
export { Client, Pool, native, default as pg } from './postgres'
