/**
 * @dotdo/tidb - TiDB SDK compat
 *
 * Drop-in replacement for mysql2/promise backed by DO SQLite.
 * TiDB is MySQL wire-protocol compatible, so we provide the
 * same mysql2/promise API.
 *
 * This implementation provides:
 * - createConnection - Single database connection
 * - createPool - Connection pooling
 * - query() / execute() - Execute parameterized queries with ? placeholders
 * - Transactions (beginTransaction/commit/rollback)
 * - Result types (RowDataPacket, ResultSetHeader)
 *
 * @example
 * ```typescript
 * import mysql from '@dotdo/tidb'
 * // or
 * import { createConnection, createPool } from '@dotdo/tidb'
 *
 * // Using Connection
 * const connection = await mysql.createConnection({
 *   host: 'gateway01.us-east-1.prod.aws.tidbcloud.com',
 *   port: 4000,
 *   user: 'root',
 *   database: 'test',
 *   ssl: { rejectUnauthorized: true },
 * })
 * const [rows] = await connection.query('SELECT * FROM users WHERE id = ?', [1])
 * await connection.end()
 *
 * // Using Pool
 * const pool = mysql.createPool({
 *   host: 'localhost',
 *   connectionLimit: 10,
 * })
 * const [rows] = await pool.query('SELECT * FROM users')
 *
 * // Using execute for prepared statements
 * const [result] = await connection.execute<mysql.ResultSetHeader>(
 *   'INSERT INTO users (name) VALUES (?)',
 *   ['Alice']
 * )
 * console.log(result.insertId)
 *
 * // Pool with getConnection
 * const conn = await pool.getConnection()
 * await conn.beginTransaction()
 * await conn.query('INSERT INTO users (name) VALUES (?)', ['Bob'])
 * await conn.commit()
 * conn.release()
 *
 * await pool.end()
 * ```
 *
 * @see https://docs.pingcap.com/tidb/stable
 * @see https://sidorares.github.io/node-mysql2/docs
 */

// Types
export type {
  // Value types
  Value,
  QueryValue,
  QueryParams,

  // Result types
  FieldPacket,
  RowDataPacket,
  ResultSetHeader,
  OkPacket,
  QueryResult,
  ExecuteResult,

  // Query types
  QueryOptions,
  PreparedStatementInfo,

  // Connection types
  ConnectionOptions,
  Connection,

  // Pool types
  PoolOptions,
  PoolConnection,
  Pool,

  // Extended DO config
  ExtendedTiDBConfig,
} from './types'

// Error classes
export { TiDBError, ConnectionError, Types } from './types'

// Core factory functions and default export
export { createConnection, createPool, mysql, default as mysql2 } from './tidb'
