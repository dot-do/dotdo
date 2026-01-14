/**
 * @dotdo/neon - Neon SDK compat
 *
 * Drop-in replacement for @neondatabase/serverless backed by DO SQLite.
 * This implementation provides the Neon serverless driver API including:
 * - neon() - SQL template tag function for HTTP queries
 * - Pool - Connection pooling (pg-compatible)
 * - Client - Single database connection (pg-compatible)
 * - neonConfig - Configuration options
 * - Transactions - Transaction batching
 *
 * @example
 * ```typescript
 * import { neon, neonConfig, Pool } from '@dotdo/neon'
 *
 * // SQL template tag (main API)
 * const sql = neon(process.env.DATABASE_URL)
 * const result = await sql`SELECT * FROM users WHERE id = ${userId}`
 *
 * // Pool for connection reuse
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL })
 * const client = await pool.connect()
 * const { rows } = await client.query('SELECT * FROM users')
 * client.release()
 *
 * // Configuration
 * neonConfig.fetchConnectionCache = true
 * neonConfig.poolQueryViaFetch = true
 *
 * // Transaction support
 * const tx = await sql.transaction([
 *   sql`INSERT INTO users (name) VALUES ('Alice')`,
 *   sql`INSERT INTO users (name) VALUES ('Bob')`
 * ])
 * ```
 *
 * @see https://neon.tech/docs/serverless/serverless-driver
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

  // Options types
  NeonOptions,
  NeonConfig,

  // Connection types
  ConnectionConfig,
  TLSConfig,

  // Pool types
  PoolConfig,
  PoolClient,
  Pool as IPool,

  // Client types
  ClientConfig,
  Client as IClient,

  // SQL function types
  NeonSqlFunction,
  TransactionCallback,
} from './types'

// Error classes
export { NeonDbError, ConnectionError, types } from './types'

// Core exports
export { neon, neonConfig, Client, Pool, resetDatabase } from './neon'

// Default export
import { neon, neonConfig, Client, Pool } from './neon'
import { types, NeonDbError, ConnectionError } from './types'

export default {
  neon,
  neonConfig,
  Client,
  Pool,
  types,
  NeonDbError,
  ConnectionError,
}
