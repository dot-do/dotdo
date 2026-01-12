/**
 * Analytics Query Router
 *
 * Entry point for all analytics queries. Routes requests to the appropriate
 * execution path based on query type and complexity.
 *
 * Endpoints:
 * - POST /v1/search - Vector similarity search
 * - GET /v1/lookup/:table/:key - Point lookup (Iceberg)
 * - POST /v1/query - SQL query (browser or server execution)
 *
 * @module api/analytics/router
 * @see docs/plans/unified-analytics-architecture.md
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import type {
  VectorSearchRequest,
  VectorSearchResponse,
  VectorSearchResult,
  VectorFilter,
  PointLookupRequest,
  PointLookupResponse,
  PartitionFilter,
  SQLQueryRequest,
  SQLQueryResponse,
  QueryPlanResponse,
  QueryPlan,
  AnalyticsError,
  AnalyticsErrorCode,
  QueryType,
  ExecutionPath,
  QueryClassification,
  ValidationResult,
  DistanceMetric,
  ClientCapabilities,
} from '../../types/analytics-api'

// ============================================================================
// ROUTER SETUP
// ============================================================================

export const analyticsRouter = new Hono<{ Bindings: Env }>()

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate vector search request
 */
function validateVectorSearchRequest(body: unknown): ValidationResult<VectorSearchRequest> {
  const errors: string[] = []

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] }
  }

  const req = body as Record<string, unknown>

  // Validate query vector (required)
  if (!req.query) {
    errors.push('query vector is required')
  } else if (!Array.isArray(req.query)) {
    errors.push('query must be an array of numbers')
  } else if (req.query.length === 0) {
    errors.push('query vector cannot be empty')
  } else if (!req.query.every((v) => typeof v === 'number' && !isNaN(v))) {
    errors.push('query must contain only valid numbers')
  }

  // Validate k (optional, default: 10)
  if (req.k !== undefined) {
    if (typeof req.k !== 'number' || !Number.isInteger(req.k)) {
      errors.push('k must be an integer')
    } else if (req.k < 1 || req.k > 1000) {
      errors.push('k must be between 1 and 1000')
    }
  }

  // Validate metric (optional, default: cosine)
  if (req.metric !== undefined) {
    const validMetrics: DistanceMetric[] = ['cosine', 'euclidean', 'dot_product']
    if (!validMetrics.includes(req.metric as DistanceMetric)) {
      errors.push(`metric must be one of: ${validMetrics.join(', ')}`)
    }
  }

  // Validate filters (optional)
  if (req.filters !== undefined) {
    if (!Array.isArray(req.filters)) {
      errors.push('filters must be an array')
    } else {
      for (let i = 0; i < req.filters.length; i++) {
        const filter = req.filters[i] as Record<string, unknown>
        if (!filter.field || typeof filter.field !== 'string') {
          errors.push(`filters[${i}].field must be a string`)
        }
        if (!filter.operator || typeof filter.operator !== 'string') {
          errors.push(`filters[${i}].operator must be a string`)
        }
        if (filter.value === undefined) {
          errors.push(`filters[${i}].value is required`)
        }
      }
    }
  }

  // Validate nprobe (optional, default: 20)
  if (req.nprobe !== undefined) {
    if (typeof req.nprobe !== 'number' || !Number.isInteger(req.nprobe)) {
      errors.push('nprobe must be an integer')
    } else if (req.nprobe < 1 || req.nprobe > 100) {
      errors.push('nprobe must be between 1 and 100')
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      query: req.query as number[],
      k: (req.k as number) ?? 10,
      metric: (req.metric as DistanceMetric) ?? 'cosine',
      filters: req.filters as VectorFilter[] | undefined,
      namespace: req.namespace as string | undefined,
      includeVectors: (req.includeVectors as boolean) ?? false,
      includeMetadata: (req.includeMetadata as boolean) ?? true,
      nprobe: (req.nprobe as number) ?? 20,
    },
  }
}

/**
 * Validate SQL query request
 */
function validateSQLQueryRequest(body: unknown): ValidationResult<SQLQueryRequest> {
  const errors: string[] = []

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] }
  }

  const req = body as Record<string, unknown>

  // Validate SQL (required)
  if (!req.sql) {
    errors.push('sql is required')
  } else if (typeof req.sql !== 'string') {
    errors.push('sql must be a string')
  } else if (req.sql.trim().length === 0) {
    errors.push('sql cannot be empty')
  }

  // Validate executionHint (optional)
  if (req.executionHint !== undefined) {
    const validHints = ['client', 'server', 'auto']
    if (!validHints.includes(req.executionHint as string)) {
      errors.push(`executionHint must be one of: ${validHints.join(', ')}`)
    }
  }

  // Validate limit (optional, default: 10000)
  if (req.limit !== undefined) {
    if (typeof req.limit !== 'number' || !Number.isInteger(req.limit)) {
      errors.push('limit must be an integer')
    } else if (req.limit < 1 || req.limit > 100000) {
      errors.push('limit must be between 1 and 100000')
    }
  }

  // Validate timeout (optional, default: 30000)
  if (req.timeout !== undefined) {
    if (typeof req.timeout !== 'number' || !Number.isInteger(req.timeout)) {
      errors.push('timeout must be an integer')
    } else if (req.timeout < 1000 || req.timeout > 300000) {
      errors.push('timeout must be between 1000 and 300000 ms')
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      sql: req.sql as string,
      executionHint: (req.executionHint as 'client' | 'server' | 'auto') ?? 'auto',
      clientCapabilities: req.clientCapabilities as ClientCapabilities | undefined,
      params: req.params as (string | number | boolean | null)[] | undefined,
      limit: (req.limit as number) ?? 10000,
      timeout: (req.timeout as number) ?? 30000,
    },
  }
}

// ============================================================================
// QUERY CLASSIFICATION
// ============================================================================

/**
 * Classify a SQL query to determine execution path
 */
function classifyQuery(sql: string): QueryClassification {
  const normalizedSql = sql.toLowerCase().trim()

  // Point lookup: SELECT with WHERE on primary key
  const isPointLookup =
    normalizedSql.includes('select') &&
    normalizedSql.includes('where') &&
    (normalizedSql.includes('= ') || normalizedSql.includes('= \'')) &&
    !normalizedSql.includes('join') &&
    !normalizedSql.includes('group by') &&
    !normalizedSql.includes('order by')

  // Analytics: Aggregations, GROUP BY, window functions
  const isAnalytics =
    normalizedSql.includes('group by') ||
    normalizedSql.includes('count(') ||
    normalizedSql.includes('sum(') ||
    normalizedSql.includes('avg(') ||
    normalizedSql.includes('max(') ||
    normalizedSql.includes('min(') ||
    normalizedSql.includes('over(')

  // Federated: JOINs or UNION
  const isFederated = normalizedSql.includes('join') || normalizedSql.includes('union')

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
      dataSizeBytes: 10 * 1024 * 1024, // 10MB estimate
      monetaryCost: 0.002,
    }
  } else if (isAnalytics) {
    type = 'analytics'
    executionPath = 'browser_execute' // Prefer browser for analytics
    estimatedCost = {
      computeMs: 3000,
      dataSizeBytes: 50 * 1024 * 1024, // 50MB estimate
      monetaryCost: 0.009, // Just egress
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

// ============================================================================
// ERROR HELPERS
// ============================================================================

/**
 * Create an analytics error response
 */
function analyticsError(
  code: AnalyticsErrorCode,
  message: string,
  details?: Record<string, unknown>
): AnalyticsError {
  return { code, message, details }
}

// ============================================================================
// VECTOR SEARCH ENDPOINT
// ============================================================================

/**
 * POST /v1/search - Vector similarity search
 *
 * Routes queries to VectorSearchCoordinatorDO for execution.
 * Supports filtering, multiple distance metrics, and configurable recall.
 */
analyticsRouter.post('/v1/search', async (c) => {
  const startTime = Date.now()

  // Parse and validate request
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: analyticsError('INVALID_QUERY', 'Invalid JSON body') },
      400
    )
  }

  const validation = validateVectorSearchRequest(body)
  if (!validation.valid) {
    return c.json(
      {
        error: analyticsError('INVALID_VECTOR', 'Validation failed', {
          errors: validation.errors,
        }),
      },
      400
    )
  }

  const request = validation.data!

  // TODO: Route to VectorSearchCoordinatorDO when implemented
  // For now, return a mock response structure

  // Check if VECTORS binding is available (Cloudflare Vectorize)
  if (c.env.VECTORS) {
    try {
      // Use Vectorize as fallback/primary engine
      const results = await c.env.VECTORS.query(new Float32Array(request.query), {
        topK: request.k,
        returnMetadata: request.includeMetadata ? 'all' : 'none',
        returnValues: request.includeVectors,
      })

      const searchResults: VectorSearchResult[] = results.matches.map((match) => ({
        id: match.id,
        score: match.score,
        metadata: match.metadata as Record<string, unknown> | undefined,
        vector: match.values ? Array.from(match.values) : undefined,
      }))

      const response: VectorSearchResponse = {
        results: searchResults,
        timing: {
          total: Date.now() - startTime,
        },
        stats: {
          clustersSearched: 1, // Vectorize handles internally
          vectorsScanned: results.count,
          cacheHitRate: 0, // Not available from Vectorize
        },
      }

      return c.json(response)
    } catch (error) {
      return c.json(
        {
          error: analyticsError('INTERNAL_ERROR', 'Vector search failed', {
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
        },
        500
      )
    }
  }

  // Return placeholder response when VectorSearchCoordinatorDO is not available
  const response: VectorSearchResponse = {
    results: [],
    timing: {
      total: Date.now() - startTime,
      centroidSearch: 0,
      clusterLoad: 0,
      rerank: 0,
    },
    stats: {
      clustersSearched: 0,
      vectorsScanned: 0,
      cacheHitRate: 0,
    },
  }

  return c.json(response)
})

// ============================================================================
// POINT LOOKUP ENDPOINT
// ============================================================================

/**
 * GET /v1/lookup/:table/:key - Point lookup
 *
 * Routes to IcebergMetadataDO for partition planning, then fetches from R2.
 * Optimized for single-record retrieval with partition hints.
 */
analyticsRouter.get('/v1/lookup/:table/:key', async (c) => {
  const startTime = Date.now()
  const table = c.req.param('table')
  const key = c.req.param('key')

  // Parse optional partition hints from query params
  const partition: PartitionFilter = {}
  const ns = c.req.query('ns')
  const type = c.req.query('type')
  const date = c.req.query('date')

  if (ns) partition.ns = ns
  if (type) partition.type = type
  if (date) partition.date = date

  // Validate table name
  if (!table || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    return c.json(
      { error: analyticsError('INVALID_QUERY', 'Invalid table name') },
      400
    )
  }

  // Validate key
  if (!key || key.length === 0) {
    return c.json(
      { error: analyticsError('INVALID_QUERY', 'Key is required') },
      400
    )
  }

  // TODO: Route to IcebergMetadataDO when implemented
  // For now, check if R2 is available and attempt direct lookup

  const metadataLookupStart = Date.now()
  const metadataLookupTime = Date.now() - metadataLookupStart

  const partitionPruneStart = Date.now()
  const partitionPruneTime = Date.now() - partitionPruneStart

  const dataFetchStart = Date.now()

  // Try R2 lookup if binding available
  if (c.env.R2) {
    try {
      // Construct path based on table and key
      // Convention: data/{table}/{partition_path}/{key}.parquet or data/{table}/{key}.json
      const basePath = `data/${table}`
      let objectPath = `${basePath}/${key}.json`

      // Apply partition path if available
      if (Object.keys(partition).length > 0) {
        const partitionPath = Object.entries(partition)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${v}`)
          .join('/')
        objectPath = `${basePath}/${partitionPath}/${key}.json`
      }

      const object = await c.env.R2.get(objectPath)

      if (object) {
        const data = await object.json() as Record<string, unknown>
        const dataFetchTime = Date.now() - dataFetchStart

        const response: PointLookupResponse = {
          found: true,
          data,
          timing: {
            total: Date.now() - startTime,
            metadataLookup: metadataLookupTime,
            partitionPrune: partitionPruneTime,
            dataFetch: dataFetchTime,
          },
          source: {
            table,
            partition: Object.entries(partition)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => `${k}=${v}`)
              .join('/') || 'default',
            file: objectPath,
          },
        }

        return c.json(response)
      }
    } catch (error) {
      // Fall through to not found
    }
  }

  // Record not found
  const dataFetchTime = Date.now() - dataFetchStart

  const response: PointLookupResponse = {
    found: false,
    timing: {
      total: Date.now() - startTime,
      metadataLookup: metadataLookupTime,
      partitionPrune: partitionPruneTime,
      dataFetch: dataFetchTime,
    },
    source: {
      table,
      partition: Object.entries(partition)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join('/') || 'default',
      file: '',
    },
  }

  return c.json(response, 404)
})

// ============================================================================
// SQL QUERY ENDPOINT
// ============================================================================

/**
 * POST /v1/query - SQL query
 *
 * Parses SQL, generates query plan, and either:
 * - Returns plan for client-side DuckDB-WASM execution
 * - Executes server-side for complex queries
 */
analyticsRouter.post('/v1/query', async (c) => {
  const startTime = Date.now()

  // Parse and validate request
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: analyticsError('INVALID_QUERY', 'Invalid JSON body') },
      400
    )
  }

  const validation = validateSQLQueryRequest(body)
  if (!validation.valid) {
    return c.json(
      {
        error: analyticsError('INVALID_QUERY', 'Validation failed', {
          errors: validation.errors,
        }),
      },
      400
    )
  }

  const request = validation.data!
  const planningStart = Date.now()

  // Classify the query
  const classification = classifyQuery(request.sql)
  const planningTime = Date.now() - planningStart

  // Determine execution path
  const shouldExecuteOnClient =
    request.executionHint === 'client' ||
    (request.executionHint === 'auto' &&
      classification.executionPath === 'browser_execute' &&
      request.clientCapabilities?.duckdbWasm)

  if (shouldExecuteOnClient) {
    // Generate query plan for client-side execution
    const plan: QueryPlan = {
      type: 'client_execute',
      dataFiles: [], // TODO: Generate presigned URLs from Iceberg manifests
      optimizedSql: request.sql, // TODO: Apply pushdown optimizations
      estimates: {
        rowCount: 1000, // Placeholder
        dataSizeBytes: classification.estimatedCost.dataSizeBytes,
        executionTimeMs: classification.estimatedCost.computeMs,
      },
      pushdownFilters: [], // TODO: Extract from WHERE clause
    }

    // If R2 is available, we could generate presigned URLs here
    // For now, return the plan structure

    const response: QueryPlanResponse = {
      plan,
      timing: {
        total: Date.now() - startTime,
        planning: planningTime,
      },
    }

    return c.json(response)
  }

  // Server-side execution
  const executionStart = Date.now()

  // TODO: Execute via D1 or federated query engine
  // For now, attempt D1 execution if available

  if (c.env.DB || c.env.ANALYTICS_DB) {
    const db = c.env.ANALYTICS_DB || c.env.DB
    try {
      const stmt = db!.prepare(request.sql)
      const boundStmt = request.params ? stmt.bind(...request.params) : stmt

      const result = await boundStmt.all()
      const executionTime = Date.now() - executionStart

      const serializationStart = Date.now()
      const data = result.results as Record<string, unknown>[]
      const serializationTime = Date.now() - serializationStart

      // Extract column metadata from first row
      const columns = data.length > 0
        ? Object.keys(data[0]!).map((name) => ({
            name,
            type: typeof data[0]![name],
          }))
        : []

      const limit = request.limit ?? 10000
      const response: SQLQueryResponse = {
        data: data.slice(0, limit),
        columns,
        rowCount: Math.min(data.length, limit),
        truncated: data.length > limit,
        timing: {
          total: Date.now() - startTime,
          planning: planningTime,
          execution: executionTime,
          serialization: serializationTime,
        },
      }

      return c.json(response)
    } catch (error) {
      return c.json(
        {
          error: analyticsError('INVALID_QUERY', 'Query execution failed', {
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
        },
        400
      )
    }
  }

  // No execution engine available - return plan for client execution
  const plan: QueryPlan = {
    type: 'client_execute',
    dataFiles: [],
    optimizedSql: request.sql,
    estimates: {
      rowCount: 0,
      dataSizeBytes: 0,
      executionTimeMs: 0,
    },
  }

  const response: QueryPlanResponse = {
    plan,
    timing: {
      total: Date.now() - startTime,
      planning: planningTime,
    },
  }

  return c.json(response)
})

// ============================================================================
// UTILITY ENDPOINTS
// ============================================================================

/**
 * GET /v1/health - Health check
 */
analyticsRouter.get('/v1/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    capabilities: {
      vectorSearch: !!c.env.VECTORS,
      r2Storage: !!c.env.R2,
      d1Database: !!(c.env.DB || c.env.ANALYTICS_DB),
    },
  })
})

/**
 * GET /v1/classify - Classify a query without executing
 */
analyticsRouter.post('/v1/classify', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { error: analyticsError('INVALID_QUERY', 'Invalid JSON body') },
      400
    )
  }

  const req = body as Record<string, unknown>
  if (!req.sql || typeof req.sql !== 'string') {
    return c.json(
      { error: analyticsError('INVALID_QUERY', 'sql is required') },
      400
    )
  }

  const classification = classifyQuery(req.sql as string)
  return c.json(classification)
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Catch-all for unknown routes
 */
analyticsRouter.all('*', (c) => {
  return c.json(
    {
      error: analyticsError('INVALID_QUERY', `Not found: ${c.req.path}`),
    },
    404
  )
})
