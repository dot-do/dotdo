/**
 * Query Router Worker
 *
 * Entry point worker that receives SQL/API queries and routes them to
 * appropriate execution paths based on query classification.
 *
 * Responsibilities:
 * - Parse incoming queries
 * - Classify query type (point_lookup, vector_search, analytics)
 * - Route to appropriate DO or execution path
 * - Aggregate results
 * - Handle errors and timeouts
 *
 * Execution Paths:
 * - point_lookup: IcebergMetadataDO for partition planning, then R2 for data
 * - vector_search: VectorShardDO for similarity search
 * - analytics: D1 for server-side or query plan for browser execution
 *
 * @module api/query-router
 * @see docs/plans/unified-analytics-architecture.md
 */

import type { Env } from './types'
import type {
  QueryType,
  ExecutionPath,
  QueryClassification,
  DistanceMetric,
  VectorFilter,
} from '../types/analytics-api'
import {
  HTTPEndpointRateLimiter,
  type HTTPRateLimitConfig,
} from './middleware/query-rate-limit'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parsed query from incoming request
 */
export interface ParsedQuery {
  /** Original raw query */
  raw: string | Record<string, unknown>
  /** Classified query type */
  type: QueryType
  /** Recommended execution path */
  executionPath: ExecutionPath
  /** Parsed table name (for point lookups) */
  table?: string
  /** Parsed key (for point lookups) */
  key?: string
  /** Parsed partition filter */
  partition?: Record<string, string | number>
  /** Parsed SQL (for analytics) */
  sql?: string
  /** Parsed vector query (for vector search) */
  vector?: number[]
  /** Vector search k parameter */
  k?: number
  /** Vector search metric */
  metric?: DistanceMetric
  /** Vector search filters */
  filters?: VectorFilter[]
  /** Request timeout in ms */
  timeout?: number
}

/**
 * Query execution result
 */
export interface QueryResult {
  /** Whether the query succeeded */
  success: boolean
  /** Result data */
  data?: unknown
  /** Error message if failed */
  error?: string
  /** Error code */
  errorCode?: string
  /** Timing metrics */
  timing: QueryTiming
}

/**
 * Timing metrics for query execution
 */
export interface QueryTiming {
  /** Total time from receipt to response */
  totalMs: number
  /** Time spent parsing the query */
  parseMs: number
  /** Time spent classifying the query */
  classifyMs: number
  /** Time spent routing to execution path */
  routeMs: number
  /** Time spent executing the query */
  executeMs: number
  /** Time spent aggregating results */
  aggregateMs?: number
}

/**
 * Request types accepted by the query router
 */
export type QueryRequest =
  | PointLookupQueryRequest
  | VectorSearchQueryRequest
  | SQLQueryRequest

export interface PointLookupQueryRequest {
  type: 'point_lookup'
  table: string
  key: string
  partition?: Record<string, string | number>
  timeout?: number
}

export interface VectorSearchQueryRequest {
  type: 'vector_search'
  query: number[]
  k?: number
  metric?: DistanceMetric
  filters?: VectorFilter[]
  namespace?: string
  includeVectors?: boolean
  includeMetadata?: boolean
  nprobe?: number
  timeout?: number
}

export interface SQLQueryRequest {
  type?: 'analytics' | 'sql'
  sql: string
  params?: (string | number | boolean | null)[]
  executionHint?: 'client' | 'server' | 'auto'
  limit?: number
  timeout?: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default timeout for queries in ms */
const DEFAULT_TIMEOUT_MS = 30000

/** Maximum timeout allowed in ms */
const MAX_TIMEOUT_MS = 300000

/** Default k for vector search */
const DEFAULT_K = 10

/** Maximum k for vector search */
const MAX_K = 1000

// ============================================================================
// QUERY PARSER
// ============================================================================

/**
 * Parse an incoming query request
 *
 * @param request - The incoming Request object
 * @returns Parsed query with classification
 */
export async function parseQuery(request: Request): Promise<ParsedQuery> {
  const url = new URL(request.url)
  const method = request.method

  // Handle GET requests for point lookups
  // Pattern: /lookup/:table/:key
  if (method === 'GET' && url.pathname.startsWith('/lookup/')) {
    const parts = url.pathname.slice('/lookup/'.length).split('/')
    if (parts.length >= 2) {
      const [table, key] = parts
      const partition: Record<string, string | number> = {}

      // Extract partition hints from query params
      for (const [k, v] of url.searchParams) {
        if (k !== 'timeout') {
          partition[k] = v
        }
      }

      return {
        raw: url.pathname,
        type: 'point_lookup',
        executionPath: 'point_lookup',
        table,
        key,
        partition: Object.keys(partition).length > 0 ? partition : undefined,
        timeout: url.searchParams.has('timeout')
          ? parseInt(url.searchParams.get('timeout')!, 10)
          : undefined,
      }
    }
  }

  // Handle POST requests
  if (method === 'POST') {
    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const body = await request.json() as Record<string, unknown>

      // Vector search request
      if (body.type === 'vector_search' || Array.isArray(body.query)) {
        return parseVectorSearchRequest(body)
      }

      // Point lookup request
      // Match if explicit type OR if table is present (key validation happens in parser)
      if (body.type === 'point_lookup' || body.table) {
        return parsePointLookupRequest(body)
      }

      // SQL query request
      if (body.sql || body.type === 'analytics' || body.type === 'sql') {
        return parseSQLRequest(body)
      }

      // Unknown request type
      throw new QueryParseError('Unable to determine query type from request body')
    }
  }

  throw new QueryParseError(`Unsupported request method or content type: ${method}`)
}

/**
 * Parse a vector search request
 */
function parseVectorSearchRequest(body: Record<string, unknown>): ParsedQuery {
  if (!body.query || !Array.isArray(body.query)) {
    throw new QueryParseError('Vector search requires a "query" array')
  }

  const query = body.query as number[]
  if (query.length === 0) {
    throw new QueryParseError('Query vector cannot be empty')
  }

  if (!query.every((v) => typeof v === 'number' && !isNaN(v))) {
    throw new QueryParseError('Query vector must contain only valid numbers')
  }

  const k = typeof body.k === 'number' ? Math.min(Math.max(1, body.k), MAX_K) : DEFAULT_K
  const metric = validateMetric(body.metric as string | undefined)
  const filters = body.filters as VectorFilter[] | undefined

  return {
    raw: body,
    type: 'vector_search',
    executionPath: 'point_lookup', // Vector search uses specialized path
    vector: query,
    k,
    metric,
    filters,
    timeout: typeof body.timeout === 'number' ? body.timeout : undefined,
  }
}

/**
 * Parse a point lookup request
 */
function parsePointLookupRequest(body: Record<string, unknown>): ParsedQuery {
  const table = body.table as string
  const key = body.key as string

  if (!table || typeof table !== 'string') {
    throw new QueryParseError('Point lookup requires a "table" string')
  }

  if (!key || typeof key !== 'string') {
    throw new QueryParseError('Point lookup requires a "key" string')
  }

  // Validate table name format
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new QueryParseError('Invalid table name format')
  }

  const partition = body.partition as Record<string, string | number> | undefined

  return {
    raw: body,
    type: 'point_lookup',
    executionPath: 'point_lookup',
    table,
    key,
    partition,
    timeout: typeof body.timeout === 'number' ? body.timeout : undefined,
  }
}

/**
 * Parse a SQL query request
 */
function parseSQLRequest(body: Record<string, unknown>): ParsedQuery {
  const sql = body.sql as string

  if (!sql || typeof sql !== 'string') {
    throw new QueryParseError('SQL query requires a "sql" string')
  }

  if (sql.trim().length === 0) {
    throw new QueryParseError('SQL query cannot be empty')
  }

  // Classify the SQL query
  const classification = classifySQL(sql)

  return {
    raw: body,
    type: classification.type,
    executionPath: classification.executionPath,
    sql,
    timeout: typeof body.timeout === 'number' ? body.timeout : undefined,
  }
}

/**
 * Validate distance metric
 */
function validateMetric(metric?: string): DistanceMetric {
  if (!metric) return 'cosine'

  const validMetrics: DistanceMetric[] = ['cosine', 'euclidean', 'dot_product']
  if (!validMetrics.includes(metric as DistanceMetric)) {
    throw new QueryParseError(`Invalid metric: ${metric}. Must be one of: ${validMetrics.join(', ')}`)
  }

  return metric as DistanceMetric
}

// ============================================================================
// QUERY CLASSIFIER
// ============================================================================

/**
 * Classify a SQL query to determine execution path
 *
 * @param sql - The SQL query string
 * @returns Query classification with type and execution path
 */
export function classifySQL(sql: string): QueryClassification {
  const normalizedSql = sql.toLowerCase().trim()

  // Check for point lookup pattern: SELECT ... WHERE id = ...
  const isPointLookup = isPointLookupQuery(normalizedSql)

  // Check for analytics patterns: aggregations, GROUP BY, window functions
  const isAnalytics = isAnalyticsQuery(normalizedSql)

  // Check for federated patterns: JOINs or UNION
  const isFederated = isFederatedQuery(normalizedSql)

  let type: QueryType
  let executionPath: ExecutionPath
  let estimatedCost: QueryClassification['estimatedCost']

  if (isPointLookup) {
    type = 'point_lookup'
    executionPath = 'point_lookup'
    estimatedCost = {
      computeMs: 100,
      dataSizeBytes: 1024,
      monetaryCost: 0.00014,
    }
  } else if (isFederated) {
    type = 'federated'
    executionPath = 'federated_query'
    estimatedCost = {
      computeMs: 400,
      dataSizeBytes: 10 * 1024 * 1024,
      monetaryCost: 0.002,
    }
  } else if (isAnalytics) {
    type = 'analytics'
    executionPath = 'browser_execute'
    estimatedCost = {
      computeMs: 3000,
      dataSizeBytes: 50 * 1024 * 1024,
      monetaryCost: 0.009,
    }
  } else {
    // Default to browser execution for simple queries
    type = 'analytics'
    executionPath = 'browser_execute'
    estimatedCost = {
      computeMs: 1000,
      dataSizeBytes: 10 * 1024 * 1024,
      monetaryCost: 0.009,
    }
  }

  return { type, executionPath, estimatedCost }
}

/**
 * Check if SQL is a point lookup query
 */
function isPointLookupQuery(sql: string): boolean {
  return (
    sql.includes('select') &&
    sql.includes('where') &&
    (sql.includes('= ') || sql.includes("= '") || sql.includes('= ?')) &&
    !sql.includes('join') &&
    !sql.includes('group by') &&
    !sql.includes('order by') &&
    !sql.includes('limit') &&
    !hasAggregation(sql)
  )
}

/**
 * Check if SQL is an analytics query
 */
function isAnalyticsQuery(sql: string): boolean {
  return (
    hasAggregation(sql) ||
    sql.includes('group by') ||
    sql.includes('over(') ||
    sql.includes('partition by')
  )
}

/**
 * Check if SQL is a federated query
 */
function isFederatedQuery(sql: string): boolean {
  return sql.includes('join') || sql.includes('union')
}

/**
 * Check if SQL has aggregation functions
 */
function hasAggregation(sql: string): boolean {
  return (
    sql.includes('count(') ||
    sql.includes('sum(') ||
    sql.includes('avg(') ||
    sql.includes('max(') ||
    sql.includes('min(') ||
    sql.includes('array_agg(') ||
    sql.includes('string_agg(')
  )
}

// ============================================================================
// QUERY ROUTER
// ============================================================================

/**
 * Route a parsed query to the appropriate execution path
 *
 * @param query - The parsed query
 * @param env - Cloudflare environment bindings
 * @returns Query execution result
 */
export async function routeQuery(query: ParsedQuery, env: Env): Promise<QueryResult> {
  const startTime = Date.now()
  const timeout = Math.min(query.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)

  const timing: QueryTiming = {
    totalMs: 0,
    parseMs: 0,
    classifyMs: 0,
    routeMs: 0,
    executeMs: 0,
  }

  const routeStart = Date.now()

  try {
    // Create abort controller for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    let result: QueryResult

    try {
      switch (query.type) {
        case 'point_lookup':
          result = await executePointLookup(query, env, timing)
          break

        case 'vector_search':
          result = await executeVectorSearch(query, env, timing)
          break

        case 'analytics':
        case 'federated':
          result = await executeAnalyticsQuery(query, env, timing)
          break

        default:
          throw new QueryRouteError(`Unknown query type: ${query.type}`)
      }
    } finally {
      clearTimeout(timeoutId)
    }

    timing.routeMs = Date.now() - routeStart
    timing.totalMs = Date.now() - startTime

    return {
      ...result,
      timing,
    }
  } catch (error) {
    timing.routeMs = Date.now() - routeStart
    timing.totalMs = Date.now() - startTime

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: 'Query timeout exceeded',
        errorCode: 'QUERY_TIMEOUT',
        timing,
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: error instanceof QueryRouteError ? 'ROUTE_ERROR' : 'INTERNAL_ERROR',
      timing,
    }
  }
}

// ============================================================================
// EXECUTION HANDLERS
// ============================================================================

/**
 * Execute a point lookup query
 */
async function executePointLookup(
  query: ParsedQuery,
  env: Env,
  timing: QueryTiming
): Promise<QueryResult> {
  const executeStart = Date.now()

  const { table, key, partition, sql } = query

  // If we have SQL but no table/key, execute via D1
  if (sql && (!table || !key)) {
    return executeSQLPointLookup(query, env, timing, executeStart)
  }

  if (!table || !key) {
    return {
      success: false,
      error: 'Point lookup requires table and key, or SQL query',
      errorCode: 'INVALID_QUERY',
      timing,
    }
  }

  // Check if IcebergMetadataDO is available
  if (env.ICEBERG_METADATA) {
    try {
      const metadataDO = env.ICEBERG_METADATA.get(
        env.ICEBERG_METADATA.idFromName(`table:${table}`)
      )

      // Get partition plan
      const filters = partition
        ? Object.entries(partition).map(([column, value]) => ({
            column,
            operator: 'eq' as const,
            value,
          }))
        : []

      const response = await metadataDO.fetch(
        new Request('https://internal/plan/' + table, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters }),
        })
      )

      if (!response.ok) {
        throw new Error(`Iceberg metadata lookup failed: ${response.status}`)
      }

      const plan = await response.json() as { files: Array<{ filePath: string }> }

      // Fetch data from R2 if files found
      if (plan.files && plan.files.length > 0 && env.R2) {
        // For point lookup, we expect a single file or small number
        for (const file of plan.files.slice(0, 3)) {
          const obj = await env.R2.get(file.filePath)
          if (obj) {
            // TODO: Parse Parquet and find record by key
            // For now, return the file info
            timing.executeMs = Date.now() - executeStart
            return {
              success: true,
              data: {
                found: true,
                file: file.filePath,
                // Actual data would be extracted here
              },
              timing,
            }
          }
        }
      }
    } catch (error) {
      // Fall through to R2 direct lookup
    }
  }

  // Fall back to R2 direct lookup
  if (env.R2) {
    try {
      const basePath = `data/${table}`
      let objectPath = `${basePath}/${key}.json`

      // Apply partition path if available
      if (partition && Object.keys(partition).length > 0) {
        const partitionPath = Object.entries(partition)
          .map(([k, v]) => `${k}=${v}`)
          .join('/')
        objectPath = `${basePath}/${partitionPath}/${key}.json`
      }

      const obj = await env.R2.get(objectPath)

      timing.executeMs = Date.now() - executeStart

      if (obj) {
        const data = await obj.json()
        return {
          success: true,
          data: {
            found: true,
            data,
            source: { table, partition, file: objectPath },
          },
          timing,
        }
      }

      return {
        success: true,
        data: {
          found: false,
          source: { table, partition, file: objectPath },
        },
        timing,
      }
    } catch (error) {
      timing.executeMs = Date.now() - executeStart
      return {
        success: false,
        error: `R2 lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errorCode: 'STORAGE_ERROR',
        timing,
      }
    }
  }

  timing.executeMs = Date.now() - executeStart
  return {
    success: false,
    error: 'No storage backend available for point lookup',
    errorCode: 'NO_BACKEND',
    timing,
  }
}

/**
 * Execute a SQL-based point lookup query via D1
 */
async function executeSQLPointLookup(
  query: ParsedQuery,
  env: Env,
  timing: QueryTiming,
  executeStart: number
): Promise<QueryResult> {
  const { sql } = query

  if (!sql) {
    return {
      success: false,
      error: 'SQL query required',
      errorCode: 'INVALID_QUERY',
      timing,
    }
  }

  const db = env.ANALYTICS_DB || env.DB
  if (db) {
    try {
      const stmt = db.prepare(sql)
      const result = await stmt.all()

      timing.executeMs = Date.now() - executeStart

      return {
        success: true,
        data: {
          data: result.results,
          rowCount: result.results.length,
          meta: result.meta,
        },
        timing,
      }
    } catch (error) {
      timing.executeMs = Date.now() - executeStart
      return {
        success: false,
        error: `SQL execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errorCode: 'SQL_ERROR',
        timing,
      }
    }
  }

  timing.executeMs = Date.now() - executeStart
  return {
    success: false,
    error: 'No database backend available for SQL execution',
    errorCode: 'NO_BACKEND',
    timing,
  }
}

/**
 * Execute a vector search query
 */
async function executeVectorSearch(
  query: ParsedQuery,
  env: Env,
  timing: QueryTiming
): Promise<QueryResult> {
  const executeStart = Date.now()

  const { vector, k = DEFAULT_K, metric = 'cosine', filters } = query

  if (!vector || !Array.isArray(vector)) {
    return {
      success: false,
      error: 'Vector search requires a query vector',
      errorCode: 'INVALID_QUERY',
      timing,
    }
  }

  // Check if Cloudflare Vectorize is available
  if (env.VECTORS) {
    try {
      const results = await env.VECTORS.query(new Float32Array(vector), {
        topK: k,
        returnMetadata: 'all',
        returnValues: false,
      })

      timing.executeMs = Date.now() - executeStart

      return {
        success: true,
        data: {
          results: results.matches.map((match) => ({
            id: match.id,
            score: match.score,
            metadata: match.metadata,
          })),
          stats: {
            vectorsScanned: results.count,
            cacheHitRate: 0,
          },
        },
        timing,
      }
    } catch (error) {
      timing.executeMs = Date.now() - executeStart
      return {
        success: false,
        error: `Vectorize query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errorCode: 'VECTOR_ERROR',
        timing,
      }
    }
  }

  // Check if VectorShardDO is available
  if (env.VECTOR_SHARD) {
    try {
      // For now, route to a single shard
      // TODO: Implement coordinator pattern for multi-shard search
      const shardDO = env.VECTOR_SHARD.get(
        env.VECTOR_SHARD.idFromName('shard-0')
      )

      const response = await shardDO.fetch(
        new Request('https://internal/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: vector, k, metric }),
        })
      )

      if (!response.ok) {
        throw new Error(`Vector shard search failed: ${response.status}`)
      }

      const results = await response.json() as {
        results: Array<{ id: string; score: number }>
      }

      timing.executeMs = Date.now() - executeStart

      return {
        success: true,
        data: {
          results: results.results,
          stats: {
            vectorsScanned: results.results.length,
            cacheHitRate: 0,
          },
        },
        timing,
      }
    } catch (error) {
      timing.executeMs = Date.now() - executeStart
      return {
        success: false,
        error: `Vector shard search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errorCode: 'VECTOR_ERROR',
        timing,
      }
    }
  }

  timing.executeMs = Date.now() - executeStart
  return {
    success: false,
    error: 'No vector search backend available',
    errorCode: 'NO_BACKEND',
    timing,
  }
}

/**
 * Execute an analytics/SQL query
 */
async function executeAnalyticsQuery(
  query: ParsedQuery,
  env: Env,
  timing: QueryTiming
): Promise<QueryResult> {
  const executeStart = Date.now()

  const { sql, executionPath } = query

  if (!sql) {
    return {
      success: false,
      error: 'SQL query required',
      errorCode: 'INVALID_QUERY',
      timing,
    }
  }

  // For browser execution path, return a query plan
  if (executionPath === 'browser_execute') {
    timing.executeMs = Date.now() - executeStart
    return {
      success: true,
      data: {
        plan: {
          type: 'client_execute',
          optimizedSql: sql,
          dataFiles: [], // TODO: Generate from Iceberg manifest
          estimates: {
            rowCount: 1000,
            dataSizeBytes: 10 * 1024 * 1024,
            executionTimeMs: 1000,
          },
        },
      },
      timing,
    }
  }

  // Server-side execution via D1
  const db = env.ANALYTICS_DB || env.DB
  if (db) {
    try {
      const stmt = db.prepare(sql)
      const result = await stmt.all()

      timing.executeMs = Date.now() - executeStart

      return {
        success: true,
        data: {
          data: result.results,
          rowCount: result.results.length,
          meta: result.meta,
        },
        timing,
      }
    } catch (error) {
      timing.executeMs = Date.now() - executeStart
      return {
        success: false,
        error: `SQL execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errorCode: 'SQL_ERROR',
        timing,
      }
    }
  }

  // Federated query via multi-worker fan-out
  if (executionPath === 'federated_query') {
    // TODO: Implement federated query execution
    timing.executeMs = Date.now() - executeStart
    return {
      success: false,
      error: 'Federated query execution not yet implemented',
      errorCode: 'NOT_IMPLEMENTED',
      timing,
    }
  }

  timing.executeMs = Date.now() - executeStart
  return {
    success: false,
    error: 'No database backend available for SQL execution',
    errorCode: 'NO_BACKEND',
    timing,
  }
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Error thrown when query parsing fails
 */
export class QueryParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryParseError'
  }
}

/**
 * Error thrown when query routing fails
 */
export class QueryRouteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryRouteError'
  }
}

// ============================================================================
// WORKER EXPORT
// ============================================================================

/**
 * Default rate limit configuration for query router
 * 100 requests per minute per IP
 */
const DEFAULT_RATE_LIMIT_CONFIG: HTTPRateLimitConfig = {
  requestsPerWindow: 100,
  windowMs: 60000, // 1 minute
  keyStrategy: 'ip',
  windowStrategy: 'fixed',
  failOpen: true,
}

// Global rate limiter instance for the worker
const rateLimiter = new HTTPEndpointRateLimiter(DEFAULT_RATE_LIMIT_CONFIG)

/**
 * Query Router Worker fetch handler
 *
 * Standalone worker that handles query routing. Can be deployed
 * independently or used as part of the main API.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const startTime = Date.now()

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    // Health check
    const url = new URL(request.url)
    if (url.pathname === '/health') {
      return Response.json(
        {
          status: 'ok',
          timestamp: new Date().toISOString(),
          capabilities: {
            vectorize: !!env.VECTORS,
            vectorShard: !!env.VECTOR_SHARD,
            icebergMetadata: !!env.ICEBERG_METADATA,
            r2: !!env.R2,
            d1: !!(env.DB || env.ANALYTICS_DB),
          },
        },
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    // Check rate limit for query endpoints
    const rateLimitResult = await rateLimiter.check(request)

    // Build base headers including rate limit headers
    const baseHeaders: HeadersInit = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...rateLimitResult.headers,
    }

    // If rate limited, return 429 response
    if (!rateLimitResult.allowed) {
      return Response.json(
        {
          error: rateLimitResult.error?.message ?? 'rate limit exceeded',
          code: rateLimitResult.error?.code ?? 'RATE_LIMIT_EXCEEDED',
          retryAfter: rateLimitResult.retryAfterMs
            ? Math.ceil(rateLimitResult.retryAfterMs / 1000)
            : undefined,
        },
        {
          status: 429,
          headers: baseHeaders,
        }
      )
    }

    try {
      const parseStart = Date.now()
      const query = await parseQuery(request)
      const parseMs = Date.now() - parseStart

      const result = await routeQuery(query, env)

      // Add parse timing
      result.timing.parseMs = parseMs

      const headers: HeadersInit = {
        ...baseHeaders,
        'X-Query-Type': query.type,
        'X-Execution-Path': query.executionPath,
        'X-Total-Time-Ms': String(result.timing.totalMs),
      }

      return Response.json(result, {
        status: result.success ? 200 : 400,
        headers,
      })
    } catch (error) {
      const timing: QueryTiming = {
        totalMs: Date.now() - startTime,
        parseMs: 0,
        classifyMs: 0,
        routeMs: 0,
        executeMs: 0,
      }

      if (error instanceof QueryParseError) {
        return Response.json(
          {
            success: false,
            error: error.message,
            errorCode: 'PARSE_ERROR',
            timing,
          },
          {
            status: 400,
            headers: baseHeaders,
          }
        )
      }

      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorCode: 'INTERNAL_ERROR',
          timing,
        },
        {
          status: 500,
          headers: baseHeaders,
        }
      )
    }
  },
}
