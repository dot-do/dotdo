/**
 * db/clickhouse - ClickHouse Client Wrapper
 *
 * Provides a typed wrapper around @clickhouse/client-web for use in
 * Cloudflare Workers and edge environments.
 *
 * @example
 * ```typescript
 * import { createClickHouseClient, query } from './db/clickhouse'
 *
 * const client = createClickHouseClient({
 *   url: env.CLICKHOUSE_URL,
 *   username: env.CLICKHOUSE_USER,
 *   password: env.CLICKHOUSE_PASSWORD,
 * })
 *
 * const users = await query(client, {
 *   sql: "SELECT * FROM users WHERE tenant_id = {tenant_id:String}",
 *   params: { tenant_id: 'tenant-123' },
 * })
 * ```
 *
 * @see https://github.com/ClickHouse/clickhouse-js
 * @see https://clickhouse.com/docs/integrations/javascript
 */

import {
  createClient,
  type ClickHouseClient,
  type ClickHouseSettings,
  type QueryParams,
} from '@clickhouse/client-web'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * ClickHouse connection configuration
 */
export interface ClickHouseConfig {
  /** ClickHouse HTTP(S) URL */
  url: string
  /** Username for authentication */
  username: string
  /** Password for authentication */
  password: string
  /** Default database */
  database?: string
  /** Application name for query logs */
  application?: string
  /** Request timeout in milliseconds */
  requestTimeout?: number
  /** Keep-alive configuration */
  keepAlive?: {
    enabled?: boolean
    socketTtlMs?: number
  }
  /** Default settings applied to all queries */
  defaultSettings?: ClickHouseSettings
}

/**
 * Query execution options
 */
export interface QueryOptions<P = Record<string, unknown>> {
  /** SQL query with optional {param:Type} placeholders */
  sql: string
  /** Query parameters for safe parameterization */
  params?: P
  /** Output format (default: JSONEachRow) */
  format?: QueryFormat
  /** Query-specific settings */
  settings?: ClickHouseSettings
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Supported output formats
 */
export type QueryFormat =
  | 'JSON'
  | 'JSONEachRow'
  | 'JSONStringsEachRow'
  | 'JSONCompact'
  | 'JSONCompactEachRow'
  | 'CSV'
  | 'CSVWithNames'
  | 'TabSeparated'
  | 'TabSeparatedWithNames'

/**
 * Query result with metadata
 */
export interface QueryResult<T> {
  /** Result rows */
  data: T[]
  /** Query ID for debugging */
  queryId: string
  /** Response metadata */
  meta?: {
    columns?: Array<{ name: string; type: string }>
    rows?: number
    statistics?: {
      elapsed: number
      rows_read: number
      bytes_read: number
    }
  }
}

/**
 * Insert options
 */
export interface InsertOptions {
  /** Table name */
  table: string
  /** Format of input data (default: JSONEachRow) */
  format?: 'JSONEachRow' | 'JSONCompactEachRow' | 'CSV' | 'TabSeparated'
  /** Columns to insert (optional, uses all if not specified) */
  columns?: string[]
}

/**
 * Command result (for DDL operations)
 */
export interface CommandResult {
  /** Query ID */
  queryId: string
}

// ============================================================================
// Client Factory
// ============================================================================

/**
 * Create a ClickHouse client instance
 *
 * @example
 * ```typescript
 * const client = createClickHouseClient({
 *   url: 'https://your-instance.clickhouse.cloud:8443',
 *   username: 'default',
 *   password: 'your-password',
 *   database: 'default',
 * })
 * ```
 */
export function createClickHouseClient(
  config: ClickHouseConfig
): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    application: config.application ?? 'dotdo',
    request_timeout: config.requestTimeout ?? 30_000,
    keep_alive: config.keepAlive,
    clickhouse_settings: config.defaultSettings,
  })
}

/**
 * Create client from environment variables
 */
export function createClientFromEnv(env: {
  CLICKHOUSE_URL: string
  CLICKHOUSE_USER: string
  CLICKHOUSE_PASSWORD: string
  CLICKHOUSE_DATABASE?: string
}): ClickHouseClient {
  return createClickHouseClient({
    url: env.CLICKHOUSE_URL,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    database: env.CLICKHOUSE_DATABASE,
  })
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Execute a SELECT query and return typed results
 *
 * @example
 * ```typescript
 * interface User {
 *   id: number
 *   name: string
 *   email: string
 * }
 *
 * const users = await query<User>(client, {
 *   sql: "SELECT * FROM users WHERE tenant_id = {tenant_id:String} LIMIT {limit:UInt32}",
 *   params: { tenant_id: 'tenant-123', limit: 100 },
 * })
 *
 * users.data.forEach(user => console.log(user.name))
 * ```
 */
export async function query<T = Record<string, unknown>>(
  client: ClickHouseClient,
  options: QueryOptions
): Promise<QueryResult<T>> {
  const resultSet = await client.query({
    query: options.sql,
    format: options.format ?? 'JSONEachRow',
    query_params: options.params as QueryParams,
    clickhouse_settings: options.settings,
    abort_signal: options.signal,
  })

  const data = (await resultSet.json()) as T[]

  return {
    data,
    queryId: resultSet.query_id,
  }
}

/**
 * Execute a query and stream results row by row
 *
 * @example
 * ```typescript
 * for await (const row of queryStream<User>(client, {
 *   sql: "SELECT * FROM large_table",
 * })) {
 *   console.log(row.name)
 * }
 * ```
 */
export async function* queryStream<T = Record<string, unknown>>(
  client: ClickHouseClient,
  options: QueryOptions
): AsyncGenerator<T, void, unknown> {
  const resultSet = await client.query({
    query: options.sql,
    format: options.format ?? 'JSONEachRow',
    query_params: options.params as QueryParams,
    clickhouse_settings: options.settings,
    abort_signal: options.signal,
  })

  const stream = resultSet.stream()

  for await (const rows of stream) {
    for (const row of rows) {
      yield row.json() as T
    }
  }
}

/**
 * Execute a single-row query (e.g., COUNT, aggregations)
 *
 * @example
 * ```typescript
 * const count = await queryOne<{ count: number }>(client, {
 *   sql: "SELECT count() as count FROM users WHERE active = 1",
 * })
 * console.log(`Total users: ${count?.count}`)
 * ```
 */
export async function queryOne<T = Record<string, unknown>>(
  client: ClickHouseClient,
  options: QueryOptions
): Promise<T | null> {
  const result = await query<T>(client, options)
  return result.data[0] ?? null
}

// ============================================================================
// Insert Functions
// ============================================================================

/**
 * Insert rows into a table
 *
 * @example
 * ```typescript
 * await insert(client, {
 *   table: 'events',
 *   values: [
 *     { tenant_id: 'tenant-123', event_type: 'click', timestamp: new Date() },
 *     { tenant_id: 'tenant-123', event_type: 'view', timestamp: new Date() },
 *   ],
 * })
 * ```
 */
export async function insert<T extends Record<string, unknown>>(
  client: ClickHouseClient,
  options: InsertOptions & { values: T[] }
): Promise<void> {
  await client.insert({
    table: options.table,
    values: options.values,
    format: options.format ?? 'JSONEachRow',
    columns: options.columns,
  })
}

/**
 * Insert a single row
 */
export async function insertOne<T extends Record<string, unknown>>(
  client: ClickHouseClient,
  table: string,
  value: T
): Promise<void> {
  await insert(client, { table, values: [value] })
}

// ============================================================================
// Command Functions (DDL)
// ============================================================================

/**
 * Execute a DDL command (CREATE, ALTER, DROP, etc.)
 *
 * @example
 * ```typescript
 * await command(client, `
 *   CREATE TABLE IF NOT EXISTS events (
 *     tenant_id String,
 *     event_type String,
 *     timestamp DateTime,
 *     payload String
 *   ) ENGINE = MergeTree()
 *   PARTITION BY toYYYYMM(timestamp)
 *   ORDER BY (tenant_id, timestamp)
 * `)
 * ```
 */
export async function command(
  client: ClickHouseClient,
  sql: string
): Promise<CommandResult> {
  const result = await client.command({ query: sql })
  return { queryId: result.query_id }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Ping the server to check connectivity
 */
export async function ping(client: ClickHouseClient): Promise<boolean> {
  try {
    const result = await client.ping()
    return result.success
  } catch {
    return false
  }
}

/**
 * Get server version
 */
export async function version(client: ClickHouseClient): Promise<string> {
  const result = await queryOne<{ version: string }>(client, {
    sql: 'SELECT version() as version',
  })
  return result?.version ?? 'unknown'
}

/**
 * Close the client connection
 */
export async function close(client: ClickHouseClient): Promise<void> {
  await client.close()
}

// ============================================================================
// Query Builder Helpers
// ============================================================================

/**
 * Parameter types for ClickHouse queries
 */
export type ParamType =
  | 'String'
  | 'UInt8'
  | 'UInt16'
  | 'UInt32'
  | 'UInt64'
  | 'Int8'
  | 'Int16'
  | 'Int32'
  | 'Int64'
  | 'Float32'
  | 'Float64'
  | 'Date'
  | 'DateTime'
  | 'DateTime64'
  | 'UUID'
  | 'IPv4'
  | 'IPv6'
  | 'Bool'
  | `Array(${string})`
  | `Nullable(${string})`
  | 'Identifier'

/**
 * Format a parameter placeholder
 *
 * @example
 * ```typescript
 * const sql = `SELECT * FROM users WHERE id = ${param('id', 'UInt64')}`
 * // Result: "SELECT * FROM users WHERE id = {id:UInt64}"
 * ```
 */
export function param(name: string, type: ParamType): string {
  return `{${name}:${type}}`
}

/**
 * Build an IN clause with array parameter
 *
 * @example
 * ```typescript
 * const sql = `SELECT * FROM users WHERE id IN ${inArray('ids', 'UInt64')}`
 * // Result: "SELECT * FROM users WHERE id IN {ids:Array(UInt64)}"
 * ```
 */
export function inArray(name: string, elementType: ParamType): string {
  return `{${name}:Array(${elementType})}`
}

// ============================================================================
// Table Helpers
// ============================================================================

/**
 * Check if a table exists
 */
export async function tableExists(
  client: ClickHouseClient,
  table: string,
  database?: string
): Promise<boolean> {
  const db = database ?? 'default'
  const result = await queryOne<{ count: number }>(client, {
    sql: `
      SELECT count() as count
      FROM system.tables
      WHERE database = {database:String} AND name = {table:String}
    `,
    params: { database: db, table },
  })
  return (result?.count ?? 0) > 0
}

/**
 * Get table columns with types
 */
export async function describeTable(
  client: ClickHouseClient,
  table: string,
  database?: string
): Promise<Array<{ name: string; type: string; default_type: string }>> {
  const db = database ?? 'default'
  const result = await query<{
    name: string
    type: string
    default_type: string
  }>(client, {
    sql: `
      SELECT name, type, default_type
      FROM system.columns
      WHERE database = {database:String} AND table = {table:String}
      ORDER BY position
    `,
    params: { database: db, table },
  })
  return result.data
}

/**
 * Get row count for a table
 */
export async function countRows(
  client: ClickHouseClient,
  table: string,
  where?: string
): Promise<number> {
  const sql = where
    ? `SELECT count() as count FROM ${table} WHERE ${where}`
    : `SELECT count() as count FROM ${table}`

  const result = await queryOne<{ count: number }>(client, { sql })
  return result?.count ?? 0
}

// ============================================================================
// Settings Presets
// ============================================================================

/**
 * Read-only settings for safe tenant queries
 */
export const READ_ONLY_SETTINGS: ClickHouseSettings = {
  readonly: 1,
  max_execution_time: 30,
  max_result_rows: 10000,
}

/**
 * Strict resource limits for untrusted queries
 */
export const STRICT_LIMITS: ClickHouseSettings = {
  readonly: 1,
  max_execution_time: 5,
  max_memory_usage: 100_000_000, // 100MB
  max_result_rows: 1000,
  max_rows_to_read: 1_000_000,
}

/**
 * Settings for bulk inserts
 */
export const BULK_INSERT_SETTINGS: ClickHouseSettings = {
  async_insert: 1,
  wait_for_async_insert: 0,
}

/**
 * Settings for analytics queries
 */
export const ANALYTICS_SETTINGS: ClickHouseSettings = {
  max_threads: 4,
  max_execution_time: 300,
  max_memory_usage: 10_000_000_000, // 10GB
}

// ============================================================================
// Re-exports
// ============================================================================

export { type ClickHouseClient, type ClickHouseSettings }
