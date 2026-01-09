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
// Anonymous User & GET HTTP Interface
// ============================================================================

/**
 * Anonymous client configuration for public read-only queries
 */
export interface AnonymousConfig {
  /** ClickHouse HTTP(S) URL */
  url: string
  /** Default database */
  database?: string
  /** Default settings for anonymous queries */
  settings?: ClickHouseSettings
}

/**
 * Create an anonymous (read-only) client
 *
 * Uses the 'default' user with no password for public data access.
 * Should only be used with tables that have appropriate row policies.
 */
export function createAnonymousClient(config: AnonymousConfig): ClickHouseClient {
  return createClient({
    url: config.url,
    username: 'default',
    password: '',
    database: config.database,
    application: 'dotdo-anonymous',
    clickhouse_settings: {
      readonly: 1,
      max_execution_time: 10,
      max_result_rows: 1000,
      ...config.settings,
    },
  })
}

/**
 * Build a GET URL for cacheable ClickHouse queries
 *
 * ClickHouse supports queries via GET requests with the query in the URL.
 * This enables CDN caching for read-only queries.
 *
 * @example
 * ```typescript
 * const url = buildGetUrl({
 *   baseUrl: 'https://clickhouse.example.com:8443',
 *   sql: "SELECT * FROM events WHERE date = {date:Date}",
 *   params: { date: '2025-01-09' },
 *   format: 'JSONEachRow',
 * })
 * ```
 */
export function buildGetUrl(options: {
  baseUrl: string
  sql: string
  params?: Record<string, unknown>
  format?: QueryFormat
  database?: string
  settings?: Record<string, string | number>
}): string {
  const url = new URL(options.baseUrl)

  // Substitute parameters into query
  let query = options.sql
  if (options.params) {
    for (const [name, value] of Object.entries(options.params)) {
      const placeholder = new RegExp(`\\{${name}:\\w+\\}`, 'g')
      const formatted = formatParamValue(value)
      query = query.replace(placeholder, formatted)
    }
  }

  url.searchParams.set('query', query.trim())

  if (options.format) {
    url.searchParams.set('default_format', options.format)
  }

  if (options.database) {
    url.searchParams.set('database', options.database)
  }

  // Add settings as URL params
  if (options.settings) {
    for (const [key, value] of Object.entries(options.settings)) {
      url.searchParams.set(key, String(value))
    }
  }

  // Always set readonly for GET requests
  url.searchParams.set('readonly', '1')

  return url.toString()
}

function formatParamValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`
  }
  if (typeof value === 'number') {
    return String(value)
  }
  if (value instanceof Date) {
    return `'${value.toISOString().split('T')[0]}'`
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatParamValue).join(', ')}]`
  }
  return String(value)
}

// ============================================================================
// SWR-Style Cache with Cloudflare Cache API
// ============================================================================

/**
 * Cache configuration for SWR-style caching
 */
export interface CacheConfig {
  /** Time-to-live for fresh data (seconds) */
  ttl: number
  /** Stale-while-revalidate window (seconds) */
  swr: number
  /** Cache key prefix */
  prefix?: string
  /** Tags for cache invalidation */
  tags?: string[]
}

/**
 * Cached query result
 */
export interface CachedResult<T> {
  data: T[]
  /** Whether the data came from cache */
  cached: boolean
  /** Whether revalidation is happening in background */
  revalidating: boolean
  /** Cache age in seconds */
  age?: number
  /** When the cache entry expires */
  expires?: Date
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: 60, // 1 minute fresh
  swr: 3600, // 1 hour stale-while-revalidate
  prefix: 'ch:',
}

/**
 * SWR-style cached query executor
 *
 * Uses Cloudflare's Cache API for edge caching with stale-while-revalidate.
 *
 * @example
 * ```typescript
 * const cache = new ClickHouseCache({
 *   baseUrl: env.CLICKHOUSE_URL,
 *   database: 'analytics',
 * })
 *
 * // First call fetches from ClickHouse
 * const result1 = await cache.query({
 *   sql: "SELECT count() FROM events",
 *   cache: { ttl: 60, swr: 300 },
 * })
 *
 * // Second call returns cached data
 * const result2 = await cache.query({
 *   sql: "SELECT count() FROM events",
 *   cache: { ttl: 60, swr: 300 },
 * })
 * ```
 */
export class ClickHouseCache {
  private baseUrl: string
  private database?: string
  private defaultSettings: Record<string, string | number>
  private cache: Cache | null = null

  constructor(options: {
    baseUrl: string
    database?: string
    settings?: Record<string, string | number>
  }) {
    this.baseUrl = options.baseUrl
    this.database = options.database
    this.defaultSettings = {
      readonly: 1,
      max_execution_time: 30,
      max_result_rows: 10000,
      ...options.settings,
    }
  }

  /**
   * Execute a cached query with SWR semantics
   */
  async query<T = Record<string, unknown>>(options: {
    sql: string
    params?: Record<string, unknown>
    format?: QueryFormat
    cache?: Partial<CacheConfig>
    /** Force bypass cache and fetch fresh */
    bypass?: boolean
    /** Execution context for waitUntil */
    ctx?: ExecutionContext
  }): Promise<CachedResult<T>> {
    const cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...options.cache }
    const format = options.format ?? 'JSONEachRow'

    // Build the GET URL (this is our cache key)
    const url = buildGetUrl({
      baseUrl: this.baseUrl,
      sql: options.sql,
      params: options.params,
      format,
      database: this.database,
      settings: this.defaultSettings,
    })

    // Create cache key with prefix
    const cacheKey = new Request(`https://cache.local/${cacheConfig.prefix}${encodeURIComponent(url)}`)

    // Get the cache instance
    if (!this.cache) {
      this.cache = await caches.open('clickhouse')
    }

    // Check cache unless bypassing
    if (!options.bypass) {
      const cached = await this.cache.match(cacheKey)

      if (cached) {
        const age = this.getCacheAge(cached)
        const isStale = age > cacheConfig.ttl
        const isExpired = age > cacheConfig.ttl + cacheConfig.swr

        if (!isExpired) {
          const data = await this.parseResponse<T>(cached.clone(), format)

          // If stale, revalidate in background
          if (isStale && options.ctx) {
            options.ctx.waitUntil(this.revalidate(url, cacheKey, cacheConfig))
          }

          return {
            data,
            cached: true,
            revalidating: isStale,
            age,
            expires: new Date(Date.now() + (cacheConfig.ttl + cacheConfig.swr - age) * 1000),
          }
        }
      }
    }

    // Fetch fresh data
    const response = await this.fetchFromClickHouse(url)
    const data = await this.parseResponse<T>(response.clone(), format)

    // Store in cache
    await this.cacheResponse(cacheKey, response, cacheConfig)

    return {
      data,
      cached: false,
      revalidating: false,
    }
  }

  /**
   * Execute a query with Cloudflare fetch cache (cf.cacheTtl)
   *
   * Uses Cloudflare's built-in fetch caching via the cf object.
   * Simpler than Cache API but less control.
   */
  async queryWithFetchCache<T = Record<string, unknown>>(options: {
    sql: string
    params?: Record<string, unknown>
    format?: QueryFormat
    /** Cache TTL in seconds */
    cacheTtl?: number
    /** Cache everything including errors */
    cacheEverything?: boolean
  }): Promise<T[]> {
    const format = options.format ?? 'JSONEachRow'

    const url = buildGetUrl({
      baseUrl: this.baseUrl,
      sql: options.sql,
      params: options.params,
      format,
      database: this.database,
      settings: this.defaultSettings,
    })

    const response = await fetch(url, {
      cf: {
        cacheTtl: options.cacheTtl ?? 60,
        cacheEverything: options.cacheEverything ?? true,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`ClickHouse error: ${error}`)
    }

    return this.parseResponse<T>(response, format)
  }

  /**
   * Invalidate cached queries by prefix/pattern
   */
  async invalidate(pattern?: string): Promise<void> {
    if (!this.cache) {
      this.cache = await caches.open('clickhouse')
    }

    // Note: Cache API doesn't support pattern matching
    // For full invalidation, you'd need to track keys separately
    // This is a simplified version that clears by exact key
    if (pattern) {
      const cacheKey = new Request(`https://cache.local/${DEFAULT_CACHE_CONFIG.prefix}${pattern}`)
      await this.cache.delete(cacheKey)
    }
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private async fetchFromClickHouse(url: string): Promise<Response> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip',
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`ClickHouse error: ${error}`)
    }

    return response
  }

  private async parseResponse<T>(
    response: Response,
    format: QueryFormat
  ): Promise<T[]> {
    const text = await response.text()

    if (!text.trim()) {
      return []
    }

    if (format === 'JSONEachRow' || format === 'JSONCompactEachRow') {
      return text
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as T)
    }

    if (format === 'JSON') {
      const parsed = JSON.parse(text)
      return (parsed.data ?? parsed) as T[]
    }

    // For non-JSON formats, return raw text wrapped
    return [{ raw: text } as unknown as T]
  }

  private async cacheResponse(
    cacheKey: Request,
    response: Response,
    config: CacheConfig
  ): Promise<void> {
    if (!this.cache) return

    const headers = new Headers(response.headers)
    headers.set('Cache-Control', `max-age=${config.ttl + config.swr}`)
    headers.set('X-Cache-Date', new Date().toISOString())

    if (config.tags?.length) {
      headers.set('Cache-Tag', config.tags.join(','))
    }

    const cachedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })

    await this.cache.put(cacheKey, cachedResponse)
  }

  private getCacheAge(response: Response): number {
    const cacheDate = response.headers.get('X-Cache-Date')
    if (!cacheDate) return Infinity

    const cached = new Date(cacheDate).getTime()
    return Math.floor((Date.now() - cached) / 1000)
  }

  private async revalidate(
    url: string,
    cacheKey: Request,
    config: CacheConfig
  ): Promise<void> {
    try {
      const response = await this.fetchFromClickHouse(url)
      await this.cacheResponse(cacheKey, response, config)
    } catch (error) {
      // Revalidation failed, keep stale data
      console.error('Cache revalidation failed:', error)
    }
  }
}

// ============================================================================
// Factory Functions for Cached Queries
// ============================================================================

/**
 * Create a cached ClickHouse query function
 *
 * @example
 * ```typescript
 * const cachedQuery = createCachedQuery({
 *   baseUrl: env.CLICKHOUSE_URL,
 *   database: 'analytics',
 * })
 *
 * // In your handler
 * const events = await cachedQuery<Event>({
 *   sql: "SELECT * FROM events WHERE date = today()",
 *   cache: { ttl: 60, swr: 300 },
 *   ctx: ctx, // ExecutionContext for background revalidation
 * })
 * ```
 */
export function createCachedQuery(options: {
  baseUrl: string
  database?: string
  settings?: Record<string, string | number>
}): ClickHouseCache['query'] {
  const cache = new ClickHouseCache(options)
  return cache.query.bind(cache)
}

/**
 * Create an anonymous cached query function for public data
 */
export function createPublicQuery(options: {
  baseUrl: string
  database?: string
}): ClickHouseCache {
  return new ClickHouseCache({
    ...options,
    settings: {
      readonly: 1,
      max_execution_time: 5,
      max_result_rows: 100,
    },
  })
}

// ============================================================================
// Re-exports
// ============================================================================

export { type ClickHouseClient, type ClickHouseSettings }
