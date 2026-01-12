/**
 * @dotdo/cubejs - REST API Compatible Endpoints
 *
 * Provides a Cube.js-compatible REST API that can be used with
 * existing Cube.js clients and SDKs.
 *
 * @example
 * ```typescript
 * import { createCubeAPI } from '@dotdo/cubejs'
 *
 * const api = createCubeAPI({
 *   cubes: [ordersSchema, customersSchema],
 *   apiToken: 'your_api_token',
 *   dataSource: async (query) => {
 *     // Execute query and return data
 *     return await db.query(sql)
 *   },
 * })
 *
 * // Use with Hono, Workers, etc.
 * export default {
 *   fetch: api.fetch,
 * }
 * ```
 */

import type { CubeSchema, Measure, Dimension } from './schema'
import type { CubeQuery } from './query'
import { normalizeQuery, getQueryCubes, validateQueryMembers } from './query'
import { AuthenticationError, QueryError, ValidationError } from './errors'
import { generateSQL } from './sql'

// =============================================================================
// API Types
// =============================================================================

/**
 * Security context passed with requests
 */
export interface SecurityContext {
  [key: string]: unknown
}

/**
 * API configuration options
 */
export interface CubeAPIOptions {
  /**
   * Registered cube schemas
   */
  cubes: CubeSchema[]

  /**
   * API token for authentication
   */
  apiToken: string

  /**
   * Custom authentication function
   */
  checkAuth?: (request: Request, securityContext?: SecurityContext) => boolean | Promise<boolean>

  /**
   * Query transformer for multi-tenancy
   */
  queryTransformer?: (query: CubeQuery, securityContext?: SecurityContext) => CubeQuery

  /**
   * Data source function to execute queries
   */
  dataSource?: (query: CubeQuery, sql: string, securityContext?: SecurityContext) => Promise<unknown[]>

  /**
   * Base path for API routes
   * @default '/cubejs-api/v1'
   */
  basePath?: string

  /**
   * Enable CORS
   * @default true
   */
  cors?: boolean
}

/**
 * Query result response
 */
export interface QueryResult {
  data: unknown[]
  annotation: {
    measures: Record<string, { title: string; shortTitle: string; type: string }>
    dimensions: Record<string, { title: string; shortTitle: string; type: string }>
    segments: Record<string, { title: string; shortTitle: string }>
    timeDimensions: Record<string, { title: string; shortTitle: string; type: string }>
  }
  query?: CubeQuery
  refreshKeyValues?: unknown[]
  lastRefreshTime?: string
  usedPreAggregations?: Record<string, unknown>
  transformedQuery?: CubeQuery
  requestId?: string
  rowLimitWarning?: boolean
}

/**
 * Meta response
 */
export interface MetaResponse {
  cubes: Array<{
    name: string
    title?: string
    description?: string
    measures: Array<{
      name: string
      title?: string
      shortTitle?: string
      type: string
      aggType?: string
      drillMembers?: string[]
    }>
    dimensions: Array<{
      name: string
      title?: string
      shortTitle?: string
      type: string
      primaryKey?: boolean
    }>
    segments?: Array<{
      name: string
      title?: string
      shortTitle?: string
    }>
  }>
}

/**
 * Dry run response
 */
export interface DryRunResponse {
  normalizedQueries: CubeQuery[]
  queryType: string
  pivotQuery: Record<string, unknown>
}

/**
 * SQL response
 */
export interface SQLResponse {
  sql: {
    sql: string[]
    params?: unknown[]
    preAggregations?: unknown[]
  }
}

// =============================================================================
// Cube API
// =============================================================================

/**
 * Cube.js-compatible REST API handler
 */
export class CubeAPI {
  private schemas: Map<string, CubeSchema>
  private validMeasures: Set<string>
  private validDimensions: Set<string>
  private validSegments: Set<string>
  private options: CubeAPIOptions

  constructor(options: CubeAPIOptions) {
    this.options = {
      basePath: '/cubejs-api/v1',
      cors: true,
      ...options,
    }

    this.schemas = new Map()
    this.validMeasures = new Set()
    this.validDimensions = new Set()
    this.validSegments = new Set()

    for (const cube of options.cubes) {
      this.registerCube(cube)
    }
  }

  /**
   * Register a cube schema
   */
  private registerCube(schema: CubeSchema): void {
    this.schemas.set(schema.name, schema)

    // Register measures
    for (const measureName of Object.keys(schema.measures)) {
      this.validMeasures.add(`${schema.name}.${measureName}`)
    }

    // Register dimensions
    for (const dimName of Object.keys(schema.dimensions)) {
      this.validDimensions.add(`${schema.name}.${dimName}`)
    }

    // Register segments
    if (schema.segments) {
      for (const segName of Object.keys(schema.segments)) {
        this.validSegments.add(`${schema.name}.${segName}`)
      }
    }
  }

  /**
   * Handle an incoming request
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // CORS headers
    const corsHeaders: Record<string, string> = this.options.cors
      ? {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-security-context',
        }
      : {}

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    try {
      // Extract security context
      const securityContext = this.extractSecurityContext(request)

      // Authenticate
      const isAuthenticated = await this.authenticate(request, securityContext)
      if (!isAuthenticated) {
        return this.errorResponse(401, 'Unauthorized', corsHeaders)
      }

      // Route request
      const basePath = this.options.basePath!

      if (path === `${basePath}/load` && request.method === 'POST') {
        const result = await this.handleLoad(request, securityContext)
        return this.jsonResponse(result, corsHeaders)
      }

      if (path === `${basePath}/sql` && request.method === 'POST') {
        const result = await this.handleSQL(request, securityContext)
        return this.jsonResponse(result, corsHeaders)
      }

      if (path === `${basePath}/meta` && request.method === 'GET') {
        const result = await this.handleMeta()
        return this.jsonResponse(result, corsHeaders)
      }

      if (path === `${basePath}/dry-run` && request.method === 'POST') {
        const result = await this.handleDryRun(request, securityContext)
        return this.jsonResponse(result, corsHeaders)
      }

      return this.errorResponse(404, 'Not found', corsHeaders)
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return this.errorResponse(401, error.message, corsHeaders)
      }
      if (error instanceof ValidationError) {
        return this.errorResponse(400, error.message, corsHeaders)
      }
      if (error instanceof QueryError) {
        return this.errorResponse(error.statusCode ?? 400, error.message, corsHeaders)
      }

      console.error('CubeAPI error:', error)
      return this.errorResponse(500, 'Internal server error', corsHeaders)
    }
  }

  // ===========================================================================
  // Endpoint Handlers
  // ===========================================================================

  /**
   * Handle /load endpoint
   */
  private async handleLoad(
    request: Request,
    securityContext?: SecurityContext
  ): Promise<QueryResult> {
    const body = await request.json() as { query: CubeQuery }
    let query = body.query

    // Validate query
    this.validateQuery(query)

    // Transform query
    if (this.options.queryTransformer) {
      query = this.options.queryTransformer(query, securityContext)
    }

    // Normalize query
    const normalizedQuery = normalizeQuery(query)

    // Generate SQL
    const sql = generateSQL(normalizedQuery, this.schemas)

    // Execute query
    let data: unknown[] = []
    if (this.options.dataSource) {
      data = await this.options.dataSource(normalizedQuery, sql, securityContext)
    }

    // Build annotation
    const annotation = this.buildAnnotation(normalizedQuery)

    return {
      data,
      annotation,
      query: normalizedQuery,
      lastRefreshTime: new Date().toISOString(),
      requestId: this.generateRequestId(),
    }
  }

  /**
   * Handle /sql endpoint
   */
  private async handleSQL(
    request: Request,
    securityContext?: SecurityContext
  ): Promise<SQLResponse> {
    const body = await request.json() as { query: CubeQuery }
    let query = body.query

    // Validate query
    this.validateQuery(query)

    // Transform query
    if (this.options.queryTransformer) {
      query = this.options.queryTransformer(query, securityContext)
    }

    // Normalize query
    const normalizedQuery = normalizeQuery(query)

    // Generate SQL
    const sql = generateSQL(normalizedQuery, this.schemas)

    return {
      sql: {
        sql: [sql],
        params: [],
      },
    }
  }

  /**
   * Handle /meta endpoint
   */
  private async handleMeta(): Promise<MetaResponse> {
    const cubes: MetaResponse['cubes'] = []

    for (const [name, schema] of Array.from(this.schemas)) {
      const cubeMeta: MetaResponse['cubes'][0] = {
        name,
        title: schema.title,
        description: schema.description,
        measures: [],
        dimensions: [],
        segments: [],
      }

      // Add measures
      for (const [measureName, measure] of Object.entries(schema.measures)) {
        cubeMeta.measures.push({
          name: `${name}.${measureName}`,
          title: measure.title || this.toTitle(measureName),
          shortTitle: measure.shortTitle || measureName,
          type: this.measureTypeToAnnotationType(measure.type),
          aggType: measure.type,
          drillMembers: measure.drillMembers,
        })
      }

      // Add dimensions
      for (const [dimName, dimension] of Object.entries(schema.dimensions)) {
        cubeMeta.dimensions.push({
          name: `${name}.${dimName}`,
          title: dimension.title || this.toTitle(dimName),
          shortTitle: dimension.shortTitle || dimName,
          type: dimension.type,
          primaryKey: dimension.primaryKey,
        })
      }

      // Add segments
      if (schema.segments) {
        for (const [segName, segment] of Object.entries(schema.segments)) {
          cubeMeta.segments!.push({
            name: `${name}.${segName}`,
            title: segment.title || this.toTitle(segName),
            shortTitle: segName,
          })
        }
      }

      cubes.push(cubeMeta)
    }

    return { cubes }
  }

  /**
   * Handle /dry-run endpoint
   */
  private async handleDryRun(
    request: Request,
    securityContext?: SecurityContext
  ): Promise<DryRunResponse> {
    const body = await request.json() as { query: CubeQuery }
    let query = body.query

    // Validate query
    this.validateQuery(query)

    // Transform query
    if (this.options.queryTransformer) {
      query = this.options.queryTransformer(query, securityContext)
    }

    // Normalize query
    const normalizedQuery = normalizeQuery(query)

    return {
      normalizedQueries: [normalizedQuery],
      queryType: 'regularQuery',
      pivotQuery: {},
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Extract security context from request headers
   */
  private extractSecurityContext(request: Request): SecurityContext | undefined {
    const header = request.headers.get('x-security-context')
    if (!header) return undefined

    try {
      const decoded = atob(header)
      return JSON.parse(decoded)
    } catch {
      return undefined
    }
  }

  /**
   * Authenticate request
   */
  private async authenticate(
    request: Request,
    securityContext?: SecurityContext
  ): Promise<boolean> {
    if (this.options.checkAuth) {
      return this.options.checkAuth(request, securityContext)
    }

    const authHeader = request.headers.get('Authorization')
    return authHeader === this.options.apiToken
  }

  /**
   * Validate a query
   */
  private validateQuery(query: CubeQuery): void {
    const errors = validateQueryMembers(
      query,
      this.validMeasures,
      this.validDimensions,
      this.validSegments
    )

    if (errors.length > 0) {
      throw new ValidationError(errors.join('; '))
    }
  }

  /**
   * Build annotation for query result
   */
  private buildAnnotation(query: CubeQuery): QueryResult['annotation'] {
    const annotation: QueryResult['annotation'] = {
      measures: {},
      dimensions: {},
      segments: {},
      timeDimensions: {},
    }

    // Add measure annotations
    for (const measureName of query.measures || []) {
      const [cubeName, name] = measureName.split('.')
      const schema = this.schemas.get(cubeName)
      if (schema && schema.measures[name]) {
        const measure = schema.measures[name]
        annotation.measures[measureName] = {
          title: measure.title || this.toTitle(name),
          shortTitle: measure.shortTitle || name,
          type: this.measureTypeToAnnotationType(measure.type),
        }
      }
    }

    // Add dimension annotations
    for (const dimName of query.dimensions || []) {
      const [cubeName, name] = dimName.split('.')
      const schema = this.schemas.get(cubeName)
      if (schema && schema.dimensions[name]) {
        const dimension = schema.dimensions[name]
        annotation.dimensions[dimName] = {
          title: dimension.title || this.toTitle(name),
          shortTitle: dimension.shortTitle || name,
          type: dimension.type,
        }
      }
    }

    // Add time dimension annotations
    for (const timeDim of query.timeDimensions || []) {
      const [cubeName, name] = timeDim.dimension.split('.')
      const schema = this.schemas.get(cubeName)
      if (schema && schema.dimensions[name]) {
        const dimension = schema.dimensions[name]
        const key = timeDim.granularity
          ? `${timeDim.dimension}.${timeDim.granularity}`
          : timeDim.dimension

        annotation.timeDimensions[key] = {
          title: dimension.title || this.toTitle(name),
          shortTitle: dimension.shortTitle || name,
          type: dimension.type,
        }
      }
    }

    return annotation
  }

  /**
   * Convert measure type to annotation type
   */
  private measureTypeToAnnotationType(type: string): string {
    switch (type) {
      case 'count':
      case 'countDistinct':
      case 'countDistinctApprox':
      case 'sum':
      case 'avg':
      case 'min':
      case 'max':
      case 'runningTotal':
        return 'number'
      case 'number':
        return 'number'
      default:
        return 'string'
    }
  }

  /**
   * Convert camelCase/snake_case to Title Case
   */
  private toTitle(str: string): string {
    return str
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^\w/, (c) => c.toUpperCase())
      .trim()
  }

  /**
   * Generate a request ID
   */
  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Create JSON response
   */
  private jsonResponse(data: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    })
  }

  /**
   * Create error response
   */
  private errorResponse(
    status: number,
    message: string,
    headers: Record<string, string> = {}
  ): Response {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    })
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Cube.js-compatible API handler
 */
export function createCubeAPI(options: CubeAPIOptions): CubeAPI {
  return new CubeAPI(options)
}
