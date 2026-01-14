/**
 * @dotdo/db/compat/sql - SQL Database Compat SDKs
 *
 * Drop-in replacements for popular SQL database client libraries,
 * backed by DO SQLite for edge-native execution.
 *
 * Included adapters:
 * - postgres (pg) - PostgreSQL
 * - mysql (mysql2) - MySQL
 * - turso (@libsql/client) - Turso/libSQL
 * - planetscale (@planetscale/database) - PlanetScale
 * - neon (@neondatabase/serverless) - Neon
 * - tidb (mysql2 compatible) - TiDB
 * - cockroach (pg compatible) - CockroachDB
 * - duckdb (duckdb-node) - DuckDB
 * - duckdb-wasm - DuckDB WASM for Cloudflare Workers
 *
 * @example
 * ```typescript
 * import { postgres, mysql, turso, neon } from '@dotdo/db/compat/sql'
 *
 * // PostgreSQL
 * const pg = new postgres.Client({ host: 'localhost' })
 * await pg.connect()
 *
 * // MySQL
 * const conn = await mysql.createConnection({ host: 'localhost' })
 *
 * // Turso
 * const client = turso.createClient({ url: 'libsql://...' })
 *
 * // Neon
 * const sql = neon.neon(process.env.DATABASE_URL)
 * ```
 */

// PostgreSQL (pg) compat
export * as postgres from './postgres'
export { Client as PgClient, Pool as PgPool } from './postgres'

// MySQL (mysql2) compat
export * as mysql from './mysql'
export { createConnection as createMySQLConnection, createPool as createMySQLPool } from './mysql'

// Turso (libSQL) compat
export * as turso from './turso'
export { createClient as createTursoClient } from './turso'

// PlanetScale compat
export * as planetscale from './planetscale'
export { connect as connectPlanetScale } from './planetscale'

// Neon compat
export * as neon from './neon'
export { neon as neonSQL, Client as NeonClient, Pool as NeonPool } from './neon'

// TiDB compat (MySQL-compatible)
export * as tidb from './tidb'
export { createConnection as createTiDBConnection, createPool as createTiDBPool } from './tidb'

// CockroachDB compat (PostgreSQL-compatible)
export * as cockroach from './cockroach'
export { Client as CockroachClient, Pool as CockroachPool } from './cockroach'

// DuckDB compat
export * as duckdb from './duckdb'
export { Database as DuckDBDatabase, Connection as DuckDBConnection, open as openDuckDB } from './duckdb'

// DuckDB WASM for Cloudflare Workers
export * as duckdbWasm from './duckdb-wasm'
export { createDuckDB, instantiateDuckDB } from './duckdb-wasm'
