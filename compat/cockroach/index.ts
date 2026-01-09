/**
 * @dotdo/cockroach - CockroachDB SDK compat
 *
 * Drop-in replacement for node-postgres (pg) for CockroachDB,
 * backed by DO SQLite. CockroachDB is PostgreSQL wire-protocol compatible.
 *
 * This implementation provides the pg Client and Pool API plus:
 * - AS OF SYSTEM TIME queries for time-travel
 * - SERIALIZABLE isolation level (CockroachDB default)
 * - Transaction retry handling
 * - Cluster routing for serverless deployments
 *
 * @example
 * ```typescript
 * import { Client, Pool } from '@dotdo/cockroach'
 *
 * // Using Client
 * const client = new Client({
 *   host: 'free-tier.gcp-us-central1.cockroachlabs.cloud',
 *   database: 'defaultdb',
 *   user: 'myuser',
 *   password: 'secret',
 *   ssl: { rejectUnauthorized: true },
 * })
 * await client.connect()
 *
 * // Standard queries
 * const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [1])
 *
 * // AS OF SYSTEM TIME for time-travel queries
 * const historical = await client.query(
 *   "SELECT * FROM users AS OF SYSTEM TIME '-10s'"
 * )
 *
 * // SERIALIZABLE transactions
 * await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE')
 * await client.query('INSERT INTO users (name) VALUES ($1)', ['Alice'])
 * await client.query('COMMIT')
 *
 * await client.end()
 *
 * // Using Pool
 * const pool = new Pool({
 *   connectionString: 'postgresql://root@localhost:26257/defaultdb',
 *   max: 20,
 * })
 * const result = await pool.query('SELECT * FROM users')
 * await pool.end()
 * ```
 *
 * @see https://www.cockroachlabs.com/docs/
 */

// Types (interfaces)
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

  // Client types
  ClientConfig,

  // Cursor types
  Cursor,

  // Type parsing
  TypeParser,
  CustomTypesConfig,
  TypeParsers,

  // CockroachDB-specific types
  IsolationLevel,
  TransactionOptions,
  AsOfSystemTimeConfig,
  CockroachConfig,
} from './types'

// Error classes
export { DatabaseError, ConnectionError, types } from './types'

// Core classes (implementations)
export { Client, Pool, crdb, default } from './cockroach'

// Re-export interfaces with different names for advanced usage
export type { Client as ClientInterface, Pool as PoolInterface } from './types'
